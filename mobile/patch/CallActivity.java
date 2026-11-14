package com.hearth.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

/**
 * MainActivity, able to take a call: the page may use the microphone, once Android has been asked, and may start
 * speaking without a tap first — a spoken reply arrives seconds after the last touch, and a WebView refuses to play
 * sound that no tap started.
 *
 * Everything else is MainActivity's own. Its WebChromeClient is kept and every call it answered is passed to it;
 * the one added is onPermissionRequest, which a plain WebChromeClient answers with a refusal.
 */
public class CallActivity extends MainActivity {
  private static final String TAG = "HearthCall";
  private static final int MIC_REQUEST = 77;
  private PermissionRequest waiting;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    try {
      WebView web = findWebView(getWindow().getDecorView());
      if (web == null) { Log.w(TAG, "no WebView to give a microphone to"); return; }
      web.getSettings().setMediaPlaybackRequiresUserGesture(false);
      final WebChromeClient inner = web.getWebChromeClient();
      web.setWebChromeClient(new WebChromeClient() {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
          return inner != null ? inner.onShowFileChooser(view, callback, params) : super.onShowFileChooser(view, callback, params);
        }

        @Override
        public void onPermissionRequest(final PermissionRequest request) {
          runOnUiThread(() -> answer(request));
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
          if (waiting == request) waiting = null;
        }
      });
    } catch (Throwable t) {
      // A call that cannot be made is no reason for the app not to open.
      Log.e(TAG, "could not set up the microphone", t);
    }
  }

  /** The microphone, and only the microphone, and only from Hearth's own page. */
  private void answer(PermissionRequest request) {
    boolean wantsMic = false;
    for (String r : request.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsMic = true;
    Uri from = request.getOrigin();
    boolean ours = from != null && ("127.0.0.1".equals(from.getHost()) || "localhost".equals(from.getHost()));
    if (!wantsMic || !ours) { request.deny(); return; }
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
      request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
      return;
    }
    if (waiting != null) waiting.deny();
    waiting = request;
    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_REQUEST);
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
    if (requestCode != MIC_REQUEST) { super.onRequestPermissionsResult(requestCode, permissions, results); return; }
    PermissionRequest request = waiting;
    waiting = null;
    if (request == null) return;
    if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
      request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
    } else {
      request.deny();
    }
  }

  private static WebView findWebView(View v) {
    if (v instanceof WebView) return (WebView) v;
    if (v instanceof ViewGroup) {
      ViewGroup g = (ViewGroup) v;
      for (int i = 0; i < g.getChildCount(); i++) {
        WebView found = findWebView(g.getChildAt(i));
        if (found != null) return found;
      }
    }
    return null;
  }
}
