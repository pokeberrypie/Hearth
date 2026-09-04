package com.hearth.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.net.Uri;
import android.provider.MediaStore;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.util.Log;
import android.webkit.DownloadListener;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;

import com.janeasystems.rn_nodejs_mobile.RNNodeJsMobileModule;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.List;

/**
 * The engine half of the app: start the embedded Node server, point a WebView
 * at it once it says it is listening, done. Everything Hearth actually does
 * happens in the same public/app.js the desktop build serves — this class owns
 * none of that, on purpose.
 *
 * This runs in the `:engine` process (see AndroidManifest). It reports failure
 * by leaving breadcrumbs in Diagnostics files and finishing; BootstrapActivity,
 * in the surviving main process, is what puts them on screen.
 *
 * The two things a WebView will not do on its own are file uploads and file
 * downloads, and Hearth is built around both — importing character cards and
 * lorebooks, exporting backups. Both are wired up below; without them every
 * import button on the phone did nothing at all, silently.
 */
public class MainActivity extends AppCompatActivity {
  private static final String TAG = "Hearth";
  private static final String SYSTEM_CHANNEL = "_SYSTEM_";
  private static final int FILE_CHOOSER = 71;

  private WebView webView;
  private volatile boolean loaded = false;
  /** What to reload if the first attempt loses the race with the server. */
  private String loadedUrl = "http://127.0.0.1:7870/";
  private int retries = 0;
  private volatile boolean nodeStarted = false;

  /** The upload the page is waiting on. Must be answered, even on a cancel. */
  private ValueCallback<Uri[]> pendingUpload;

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);

    // A debuggable build lets the page be inspected from a desktop over adb,
    // which is the only way to see what the WebView is doing on a device with
    // no browser console of its own. Read off the manifest flag at runtime, so
    // a release build never turns it on and no gradle feature has to be
    // enabled to ask the question.
    if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
      WebView.setWebContentsDebuggingEnabled(true);
    }

    webView = findViewById(R.id.webview);
    // A WebView paints white until its page does, and on a phone the page does
    // not arrive until the embedded server has woken up — so the app opened on
    // a white flash, then the hearth. The window behind is already this colour;
    // now the WebView is too, and there is nothing to see until the fire.
    webView.setBackgroundColor(0xFF16110E);
    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    // Hearth's own settings/character data lives in the server's SQLite file,
    // not in the WebView — this only covers small per-viewer conveniences the
    // frontend itself may keep in localStorage.
    settings.setDatabaseEnabled(true);
    settings.setAllowFileAccess(true);
    settings.setAllowContentAccess(true);

    webView.setWebViewClient(new WebViewClient() {
      @Override
      public void onPageFinished(WebView view, String url) {
        // Hearth is actually on screen, so nothing that happened on the way
        // here was a failure worth reporting on the next launch.
        if (url != null && url.startsWith("http")) {
          retries = 0;
          Diagnostics.clear(MainActivity.this,
              Diagnostics.STAGE, Diagnostics.NODE_ERROR, Diagnostics.JAVA_CRASH);
        }
      }

      /**
       * Try again rather than sitting on "Webpage not available".
       *
       * The embedded server and the WebView start together and the server is
       * a moment behind: it announces itself the instant it begins listening,
       * and a request made in that same instant can still be refused. Losing
       * that race left the app showing Chrome's error page for ever, because
       * nothing ever asked a second time — and from the outside that is
       * indistinguishable from the app being broken. Backs off, and gives up
       * after a few goes rather than looping.
       */
      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request == null || !request.isForMainFrame()) return;
        if (retries >= 6) return;
        final int attempt = ++retries;
        view.postDelayed(() -> view.loadUrl(loadedUrl), 400L * attempt);
      }
    });

    // Every <input type="file"> in the app — character cards, lorebooks,
    // presets, avatars, wallpapers, a whole SillyTavern backup.
    webView.setWebChromeClient(new WebChromeClient() {
      @Override
      public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                       FileChooserParams params) {
        if (pendingUpload != null) pendingUpload.onReceiveValue(null);
        pendingUpload = callback;
        try {
          Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
          pick.addCategory(Intent.CATEGORY_OPENABLE);
          // The page asks for ".png,.json" and the like — file extensions, which
          // Android's picker does not understand. Anything openable, then, and
          // the page validates what it is given, as it does on the desktop.
          pick.setType("*/*");
          if (params != null && params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
            pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
          }
          startActivityForResult(Intent.createChooser(pick, "Choose a file"), FILE_CHOOSER);
          return true;
        } catch (Exception e) {
          Log.e(TAG, "No file picker available", e);
          pendingUpload.onReceiveValue(null);
          pendingUpload = null;
          toast("No app on this phone can pick a file.");
          return false;
        }
      }
    });

    /**
     * The only thing the page cannot work out for itself.
     *
     * SillyTavern does not live in this app's sandbox or in the media
     * collections, so importing a real install means all-files access, and
     * that is granted by hand on a Settings screen rather than by a prompt.
     * Two methods, no arguments, no data in or out beyond a boolean — the page
     * is Hearth's own, served from this app's own loopback server.
     */
    webView.addJavascriptInterface(new Object() {
      @JavascriptInterface
      public boolean hasAllFiles() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.R || Environment.isExternalStorageManager();
      }

      /**
       * Unpacking a backup is Java's job, not the embedded runtime's — see
       * ZipImport. Returns the folder it unpacks into; the page watches
       * unpackState() and then imports that folder the ordinary way.
       */
      @JavascriptInterface
      public String unpackZip(String zipPath) {
        return ZipImport.start(getFilesDir(), zipPath);
      }

      /** "running 12/900", "done 431/12000", "error …", or "idle". */
      @JavascriptInterface
      public String unpackState() {
        String s = ZipImport.state;
        if ("error".equals(s)) return "error " + ZipImport.error;
        if ("idle".equals(s)) return "idle";
        return s + " " + ZipImport.taken + "/" + ZipImport.seen;
      }

      /** Called once the import has read it, so it does not sit on the disk. */
      @JavascriptInterface
      public void clearUnpacked() {
        ZipImport.deleteTree(new java.io.File(getFilesDir(), "import-staging"));
        ZipImport.state = "idle";
      }

      @JavascriptInterface
      public void requestAllFiles() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
        runOnUiThread(() -> {
          try {
            Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                                  Uri.parse("package:" + getPackageName()));
            startActivity(i);
          } catch (Exception e) {
            // Some builds only offer the whole-list screen.
            try { startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)); }
            catch (Exception ignored) { toast("This phone has no all-files access screen."); }
          }
        });
      }
    }, "HearthHost");

    // Every export is a plain navigation to a /api/... URL that answers with
    // content-disposition: attachment. A WebView drops those on the floor
    // unless something is listening, which is why every export button did
    // nothing. The system DownloadManager is no use here — the server is
    // inside this process — so the file is fetched and saved here instead.
    webView.setDownloadListener(new DownloadListener() {
      @Override
      public void onDownloadStart(String url, String userAgent, String disposition,
                                  String mimeType, long size) {
        saveDownload(url, disposition, mimeType);
      }
    });

    RNNodeJsMobileModule.setListener((channel, message) -> {
      Log.i(TAG, "node[" + channel + "]: " + message);
      if (message != null && message.startsWith("ready:")) {
        String port = message.substring("ready:".length());
        runOnUiThread(() -> loadHearth(port));
      }
    });
    /*
     * The hearth, immediately.
     *
     * Node takes several seconds on a cold start — longer the first time, when
     * it is unpacking the project out of the APK — and until it is listening
     * there is nothing to show. That used to be a blank screen for the whole
     * wait. This page is in the APK and needs nothing else to draw, so it is up
     * within a frame, and the fire has climbed by the time the app is ready.
     */
    webView.loadUrl("file:///android_asset/boot.html");

    try {
      Diagnostics.write(this, Diagnostics.STAGE, "NODE_RUNTIME_INIT");
      RNNodeJsMobileModule.init(this);
      Diagnostics.write(this, Diagnostics.STAGE, "NODE_RUNTIME_START");
      RNNodeJsMobileModule.start();
      nodeStarted = true;
    } catch (Throwable error) {
      // loadNativeLibraries() is deliberately no longer a static initializer,
      // so linker and ABI failures arrive here as a real, displayable error.
      reportEngineError(error);
      return;
    }

    // Node can take a moment on first launch (it is unpacking the bundled
    // project out of the APK the very first time). If the "ready" message
    // somehow never arrives, try the default port anyway rather than sitting
    // on a blank screen forever.
    webView.postDelayed(() -> { if (!loaded) loadHearth("7870"); }, 8000);
  }

  private void loadHearth(String port) {
    if (loaded) return;
    loaded = true;
    // #lit says the fire has already been burning on the way in, so the app's
    // own copy picks it up at full height and draws back rather than starting
    // the climb over again. Kept on `loadedUrl` so a reload after an error
    // still says it.
    loadedUrl = "http://127.0.0.1:" + port + "/#lit";
    webView.loadUrl(loadedUrl);
  }

  // ---- uploads --------------------------------------------------------------

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode != FILE_CHOOSER) return;
    if (pendingUpload == null) return;

    Uri[] picked = null;
    if (resultCode == Activity.RESULT_OK && data != null) {
      if (data.getClipData() != null) {
        // "Import several at once is fine", says the desktop copy — so it is.
        List<Uri> all = new ArrayList<>();
        for (int i = 0; i < data.getClipData().getItemCount(); i++) {
          all.add(data.getClipData().getItemAt(i).getUri());
        }
        picked = all.toArray(new Uri[0]);
      } else if (data.getData() != null) {
        picked = new Uri[]{ data.getData() };
      }
    }
    // Null is the answer for a cancel. Without it the page's file input stays
    // waiting for ever and will not open a second time.
    pendingUpload.onReceiveValue(picked);
    pendingUpload = null;
  }

  // ---- downloads ------------------------------------------------------------

  /** The filename the server asked for, falling back to the URL's last segment. */
  private static String filenameFrom(String disposition, String url) {
    if (disposition != null) {
      java.util.regex.Matcher m = java.util.regex.Pattern
          .compile("filename\\*?=(?:UTF-8'')?\"?([^\";]+)\"?", java.util.regex.Pattern.CASE_INSENSITIVE)
          .matcher(disposition);
      if (m.find()) {
        try {
          return URLDecoder.decode(m.group(1).trim(), "UTF-8");
        } catch (Exception ignored) {
          return m.group(1).trim();
        }
      }
    }
    String tail = url.substring(url.lastIndexOf('/') + 1);
    int q = tail.indexOf('?');
    if (q >= 0) tail = tail.substring(0, q);
    return tail.isEmpty() ? "hearth-download" : tail;
  }

  private void saveDownload(String url, String disposition, String mimeType) {
    final String name = filenameFrom(disposition, url);
    toast("Saving " + name + "…");
    new Thread(() -> {
      String result;
      try {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(120000);
        conn.connect();
        try (InputStream in = conn.getInputStream()) {
          result = writeToDownloads(name, mimeType, in);
        }
        conn.disconnect();
      } catch (Exception e) {
        Log.e(TAG, "Download failed: " + url, e);
        result = null;
      }
      final String saved = result;
      runOnUiThread(() -> toast(saved != null ? "Saved to " + saved : "Could not save " + name));
    }).start();
  }

  /**
   * Writes into the phone's Downloads folder, where a file manager and every
   * other app can see it — the point of an export is to hand the file to
   * something else. On Android 10 and later MediaStore does this without any
   * storage permission; before that there is no such route without asking for
   * one, so the app's own external folder is used instead.
   */
  private String writeToDownloads(String name, String mimeType, InputStream in) throws Exception {
    String type = (mimeType == null || mimeType.isEmpty()) ? "application/octet-stream" : mimeType;

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ContentValues values = new ContentValues();
      values.put(MediaStore.Downloads.DISPLAY_NAME, name);
      values.put(MediaStore.Downloads.MIME_TYPE, type);
      values.put(MediaStore.Downloads.IS_PENDING, 1);
      Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
      if (target == null) throw new IllegalStateException("Downloads folder refused the file.");
      try (OutputStream out = getContentResolver().openOutputStream(target)) {
        copy(in, out);
      }
      values.clear();
      values.put(MediaStore.Downloads.IS_PENDING, 0);
      getContentResolver().update(target, values, null, null);
      return "Downloads/" + name;
    }

    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
    if (dir != null && !dir.exists()) dir.mkdirs();
    File out = new File(dir, name);
    try (OutputStream os = new FileOutputStream(out)) {
      copy(in, os);
    }
    return out.getAbsolutePath();
  }

  private static void copy(InputStream in, OutputStream out) throws Exception {
    byte[] buffer = new byte[16 * 1024];
    int read;
    while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
    out.flush();
  }

  private void toast(String message) {
    runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_SHORT).show());
  }

  // ---- lifecycle ------------------------------------------------------------

  private void reportEngineError(Throwable error) {
    Log.e(TAG, "Embedded Node startup failed", error);
    Diagnostics.write(this, Diagnostics.JAVA_CRASH, Log.getStackTraceString(error));
    setResult(RESULT_CANCELED);
    finish();
  }

  @Override
  protected void onPause() {
    super.onPause();
    // Tells the embedded server to flush the database to disk — Android can
    // kill a backgrounded app without warning, and anything not written down
    // by then did not happen. See mobile/server/serve.mobile.ts.
    if (nodeStarted) RNNodeJsMobileModule.sendToNode(SYSTEM_CHANNEL, "pause");
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (nodeStarted) RNNodeJsMobileModule.sendToNode(SYSTEM_CHANNEL, "resume");
  }

  @Override
  public void onBackPressed() {
    if (webView.canGoBack()) {
      webView.goBack();
      return;
    }
    // Backing out of a working app is not a crash — say so, or the launcher
    // would greet the user with a failure report on the way out.
    setResult(RESULT_OK);
    super.onBackPressed();
  }
}
