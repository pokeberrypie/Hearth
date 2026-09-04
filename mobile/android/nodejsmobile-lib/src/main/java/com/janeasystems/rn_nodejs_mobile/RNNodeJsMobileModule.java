package com.janeasystems.rn_nodejs_mobile;

/**
 * A plain-Java rewrite of nodejs-mobile-react-native's own module class,
 * stripped of every React Native dependency (ReactContextBaseJavaModule,
 * @ReactMethod, the JS bridge event emitter, promises).
 *
 * The package and class name are NOT cosmetic — native-lib.cpp calls back
 * into Java by the hardcoded name
 * `com/janeasystems/rn_nodejs_mobile/RNNodeJsMobileModule`, found via JNI's
 * FindClass, and looks up a static `sendMessageToApplication(String,String)`
 * by name. Rename either half and the compiled .so can no longer find its
 * way back into Java. Everything else in this file — every non-native
 * method, every import — was free to change; only the package, the class
 * name, the four `native` declarations, and `sendMessageToApplication`'s
 * signature had to survive intact.
 *
 * Asset-copying logic (copyNodeJsAssets, copyAssetFolder, …) is verbatim
 * from the original: nodejs-mobile always ships a project as assets bundled
 * into the APK, and the embedded Node cannot read APK assets directly — they
 * have to land on a real filesystem path first, once, the first time this
 * build of the app runs.
 */

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.system.ErrnoException;
import android.system.Os;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.concurrent.Semaphore;

public class RNNodeJsMobileModule {

  private static final String TAG = "HearthNode";
  private static final String NODEJS_PROJECT_DIR = "nodejs-project";
  private static final String NODEJS_BUILTIN_MODULES = "nodejs-builtin_modules";
  private static final String TRASH_DIR = "nodejs-project-trash";
  private static final String SHARED_PREFS = "NODEJS_MOBILE_PREFS";
  private static final String LAST_UPDATED_TIME = "NODEJS_MOBILE_APK_LastUpdateTime";
  private static final String BUILTIN_NATIVE_ASSETS_PREFIX = "nodejs-native-assets-";
  private static final String SYSTEM_CHANNEL = "_SYSTEM_";

  private static String trashDirPath;
  private static String filesDirPath;
  private static String nodeJsProjectPath;
  private static String builtinModulesPath;
  private static String nativeAssetsPath;

  private static long lastUpdateTime = 1;
  private static long previousLastUpdateTime = 0;
  private static final Semaphore initSemaphore = new Semaphore(1);
  private static boolean initCompleted = false;

  private static AssetManager assetManager;
  private static Context appContext;

  private static boolean _startedNodeAlready = false;

  /** Whoever wants messages from the Node process (MainActivity). */
  public interface Listener {
    void onNodeMessage(String channelName, String message);
  }
  private static Listener listener;
  public static void setListener(Listener l) { listener = l; }

  private static boolean librariesLoaded = false;

  /**
   * Was a bare `static {}` block. A failure there (UnsatisfiedLinkError, if
   * the device's ABI has no matching .so, or any other native-load problem)
   * happens at class-initialization time — the JVM wraps it in an
   * ExceptionInInitializerError that a normal try/catch around a method call
   * cannot intercept, so it reached MainActivity as an unexplained instant
   * crash with no usable message anywhere. Loading explicitly, from a method
   * `init()` calls inside its own try/catch, turns that into an ordinary,
   * catchable exception instead — see MainActivity's use of this.
   */
  public static void loadNativeLibraries() {
    if (librariesLoaded) return;
    System.loadLibrary("nodejs-mobile-react-native-native-lib");
    System.loadLibrary("node");
    librariesLoaded = true;
  }

  /** Call once, from MainActivity.onCreate, before start(). */
  public static void init(Context context) {
    // First real use of a native method (getCurrentABIName, just below) is
    // in this method — the libraries have to be loaded before it, and the
    // caller (MainActivity) wraps this whole call in a try/catch.
    loadNativeLibraries();

    appContext = context.getApplicationContext();
    filesDirPath = appContext.getFilesDir().getAbsolutePath();
    nodeJsProjectPath = filesDirPath + "/" + NODEJS_PROJECT_DIR;
    builtinModulesPath = filesDirPath + "/" + NODEJS_BUILTIN_MODULES;
    trashDirPath = filesDirPath + "/" + TRASH_DIR;
    nativeAssetsPath = BUILTIN_NATIVE_ASSETS_PREFIX + getCurrentABIName();

    try {
      Os.setenv("TMPDIR", appContext.getCacheDir().getAbsolutePath(), true);
    } catch (ErrnoException e) {
      e.printStackTrace();
    }

    registerNodeDataDirPath(filesDirPath);
    asyncInit();
  }

  private static void asyncInit() {
    if (wasAPKUpdated()) {
      try {
        initSemaphore.acquire();
        new Thread(() -> {
          emptyTrash();
          try {
            copyNodeJsAssets();
            initCompleted = true;
          } catch (IOException e) {
            throw new RuntimeException("Node assets copy failed", e);
          }
          initSemaphore.release();
          emptyTrash();
        }).start();
      } catch (InterruptedException ie) {
        initSemaphore.release();
        ie.printStackTrace();
      }
    } else {
      initCompleted = true;
    }
  }

  /** Starts nodejs-project/main.js. Safe to call more than once — only the first call does anything. */
  public static void start() {
    if (_startedNodeAlready) return;
    _startedNodeAlready = true;
    new Thread(() -> {
      waitForInit();
      startNodeWithArguments(
        new String[]{ "node", nodeJsProjectPath + "/main.js" },
        nodeJsProjectPath + ":" + builtinModulesPath,
        true
      );
    }).start();
  }

  // Called from JNI when a message arrives from the Node side.
  public static void sendMessageToApplication(String channelName, String msg) {
    if (listener != null) listener.onNodeMessage(channelName, msg);
  }

  public static void sendToNode(String channel, String msg) {
    sendMessageToNodeChannel(channel, msg);
  }

  // ---- native (implemented in native-lib.cpp / rn-bridge.cpp) --------------

  public static native void registerNodeDataDirPath(String dataDir);
  public static native String getCurrentABIName();
  public static native Integer startNodeWithArguments(String[] arguments, String modulesPath, boolean option_redirectOutputToLogcat);
  public static native void sendMessageToNodeChannel(String channelName, String msg);

  // ---- asset staging (verbatim from nodejs-mobile-react-native) ------------

  private static void waitForInit() {
    if (!initCompleted) {
      try {
        initSemaphore.acquire();
        initSemaphore.release();
      } catch (InterruptedException ie) {
        initSemaphore.release();
        ie.printStackTrace();
      }
    }
  }

  private static boolean wasAPKUpdated() {
    SharedPreferences prefs = appContext.getSharedPreferences(SHARED_PREFS, Context.MODE_PRIVATE);
    previousLastUpdateTime = prefs.getLong(LAST_UPDATED_TIME, 0);
    try {
      PackageInfo packageInfo = appContext.getPackageManager().getPackageInfo(appContext.getPackageName(), 0);
      lastUpdateTime = packageInfo.lastUpdateTime;
    } catch (PackageManager.NameNotFoundException e) {
      e.printStackTrace();
    }
    return lastUpdateTime != previousLastUpdateTime;
  }

  private static void saveLastUpdateTime() {
    SharedPreferences prefs = appContext.getSharedPreferences(SHARED_PREFS, Context.MODE_PRIVATE);
    SharedPreferences.Editor editor = prefs.edit();
    editor.putLong(LAST_UPDATED_TIME, lastUpdateTime);
    editor.commit();
  }

  private static void emptyTrash() {
    File trash = new File(trashDirPath);
    if (trash.exists()) deleteFolderRecursively(trash);
  }

  private static boolean deleteFolderRecursively(File file) {
    try {
      boolean res = true;
      File[] children = file.listFiles();
      if (children != null) {
        for (File childFile : children) {
          res &= childFile.isDirectory() ? deleteFolderRecursively(childFile) : childFile.delete();
        }
      }
      res &= file.delete();
      return res;
    } catch (Exception e) {
      e.printStackTrace();
      return false;
    }
  }

  private static boolean copyNativeAssetsFrom() throws IOException {
    ArrayList<String> nativeDirs = readFileFromAssets(nativeAssetsPath + "/dir.list");
    ArrayList<String> nativeFiles = readFileFromAssets(nativeAssetsPath + "/file.list");
    if (nativeFiles.size() > 0) {
      for (String dir : nativeDirs) new File(nodeJsProjectPath + "/" + dir).mkdirs();
      for (String file : nativeFiles) {
        copyAsset(nativeAssetsPath + "/" + file, nodeJsProjectPath + "/" + file);
      }
    }
    return true;
  }

  private static void copyNodeJsAssets() throws IOException {
    assetManager = appContext.getAssets();

    File nodeDirReference = new File(nodeJsProjectPath);
    if (nodeDirReference.exists()) {
      File trash = new File(trashDirPath);
      nodeDirReference.renameTo(trash);
    }

    ArrayList<String> dirs = readFileFromAssets("dir.list");
    ArrayList<String> files = readFileFromAssets("file.list");

    if (dirs.size() > 0 && files.size() > 0) {
      Log.d(TAG, "Node assets copy using pre-built lists");
      for (String dir : dirs) new File(filesDirPath + "/" + dir).mkdirs();
      for (String file : files) copyAsset(file, filesDirPath + "/" + file);
    } else {
      Log.d(TAG, "Node assets copy enumerating APK assets");
      copyAssetFolder(NODEJS_PROJECT_DIR, nodeJsProjectPath);
    }

    copyNativeAssetsFrom();

    File modulesDirReference = new File(builtinModulesPath);
    if (modulesDirReference.exists()) deleteFolderRecursively(modulesDirReference);
    // Hearth ships no built-in native Node modules. An absent asset path is
    // indistinguishable from a file to copyAssetFolder(), so create the empty
    // destination ourselves when the APK contains no such directory.
    String[] builtinFiles = assetManager.list("builtin_modules");
    if (builtinFiles != null && builtinFiles.length > 0) {
      copyAssetFolder("builtin_modules", builtinModulesPath);
    } else {
      modulesDirReference.mkdirs();
    }

    saveLastUpdateTime();
    Log.d(TAG, "Node assets copy completed successfully");
  }

  private static ArrayList<String> readFileFromAssets(String filename) {
    ArrayList<String> lines = new ArrayList<>();
    try {
      BufferedReader reader = new BufferedReader(new InputStreamReader(assetManager.open(filename)));
      String line;
      while ((line = reader.readLine()) != null) lines.add(line);
      reader.close();
    } catch (FileNotFoundException e) {
      Log.d(TAG, "File not found: " + filename);
    } catch (IOException e) {
      lines = new ArrayList<>();
      e.printStackTrace();
    }
    return lines;
  }

  private static void copyAssetFolder(String fromAssetPath, String toPath) throws IOException {
    String[] files = assetManager.list(fromAssetPath);
    if (files == null || files.length == 0) {
      copyAsset(fromAssetPath, toPath);
    } else {
      new File(toPath).mkdirs();
      for (String file : files) copyAssetFolder(fromAssetPath + "/" + file, toPath + "/" + file);
    }
  }

  private static void copyAsset(String fromAssetPath, String toPath) throws IOException {
    InputStream in = assetManager.open(fromAssetPath);
    new File(toPath).createNewFile();
    OutputStream out = new FileOutputStream(toPath);
    copyFile(in, out);
    in.close();
    out.flush();
    out.close();
  }

  private static void copyFile(InputStream in, OutputStream out) throws IOException {
    byte[] buffer = new byte[1024];
    int read;
    while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
  }
}
