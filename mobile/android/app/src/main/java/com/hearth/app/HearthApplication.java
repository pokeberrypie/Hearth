package com.hearth.app;

import android.app.Application;
import android.content.Context;
import android.util.Log;

/**
 * Installs a global crash handler before anything else in the app runs.
 *
 * The one thing this exists to catch is a failure that reaches Java at all —
 * a native-library load error, or an exception on the asset-copy thread.
 * A crash writes its full stack trace to a Diagnostics file, which
 * BootstrapActivity reads and puts on screen, so whoever is holding the phone
 * can just read it and say what it says.
 *
 * This class is instantiated once per process, so the handler covers `:engine`
 * (where Node lives) as well as the launcher process.
 */
public class HearthApplication extends Application {
  @Override
  public void onCreate() {
    super.onCreate();
    final Context appContext = getApplicationContext();
    final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();

    Thread.setDefaultUncaughtExceptionHandler((thread, ex) -> {
      // Make the report survive even if Android kills this process before an
      // activity can be drawn. BootstrapActivity reads it on the next launch,
      // and immediately if it is the engine process that died.
      Diagnostics.write(appContext, Diagnostics.JAVA_CRASH, Log.getStackTraceString(ex));

      // Starting a report activity during an uncaught exception is racy: the
      // crashing process is normally torn down before it can draw. Preserve
      // the trace above and let Android finish the crash.
      if (previous != null) previous.uncaughtException(thread, ex);
      android.os.Process.killProcess(android.os.Process.myPid());
    });
  }
}
