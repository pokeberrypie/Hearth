package com.hearth.app;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Startup breadcrumbs, kept in plain files under getFilesDir().
 *
 * Files, not SharedPreferences, for one reason: Hearth runs in two processes.
 * MainActivity (and with it the embedded Node runtime) lives in `:engine`,
 * BootstrapActivity in the main process, and the *whole point* of that split
 * is that the launcher survives when the engine dies. SharedPreferences are
 * per-process caches and do not reliably cross that boundary; a file does.
 *
 * The embedded Node runtime writes to the same two filenames from JavaScript
 * — see the banner mobile/build.mjs prepends to main.js. That is what makes
 * a JS-side startup failure readable on the phone instead of only in logcat,
 * which needs a computer and a USB cable to see.
 */
final class Diagnostics {
  /** How far startup got. Written by Java before each native call and by main.js on entry. */
  static final String STAGE = "startup-stage.txt";
  /** A JavaScript error from inside the embedded Node runtime. */
  static final String NODE_ERROR = "node-error.txt";
  /** An uncaught Java exception, from HearthApplication's handler. */
  static final String JAVA_CRASH = "crash-trace.txt";

  private Diagnostics() {}

  static void write(Context context, String name, String text) {
    try (FileOutputStream out = new FileOutputStream(new File(context.getFilesDir(), name))) {
      out.write(text.getBytes(StandardCharsets.UTF_8));
      out.getFD().sync();
    } catch (Exception ignored) {}
  }

  static String read(Context context, String name) {
    File file = new File(context.getFilesDir(), name);
    if (!file.exists()) return null;
    try (FileInputStream in = new FileInputStream(file)) {
      ByteArrayOutputStream buffer = new ByteArrayOutputStream();
      byte[] chunk = new byte[4096];
      int read;
      while ((read = in.read(chunk)) != -1) buffer.write(chunk, 0, read);
      String text = new String(buffer.toByteArray(), StandardCharsets.UTF_8).trim();
      return text.isEmpty() ? null : text;
    } catch (Exception e) {
      return null;
    }
  }

  static void clear(Context context, String... names) {
    for (String name : names) new File(context.getFilesDir(), name).delete();
  }

  /** True when there is a failure worth putting on screen. */
  static boolean hasFailure(Context context) {
    return read(context, JAVA_CRASH) != null
        || read(context, NODE_ERROR) != null
        || read(context, STAGE) != null;
  }

  /**
   * The most specific report available, most-informative source first: a Java
   * stack trace beats a JavaScript one, and either beats a bare stage marker.
   */
  static String report(Context context) {
    String javaCrash = read(context, JAVA_CRASH);
    String nodeError = read(context, NODE_ERROR);
    String stage = read(context, STAGE);

    if (javaCrash != null) return "Java exception:\n\n" + javaCrash;
    if (nodeError != null) {
      return "The embedded Node server failed to start.\n\n" + nodeError
          + (stage != null ? "\n\nLast stage reached: " + stage : "");
    }
    if (stage != null) {
      return "No Java or JavaScript error was recorded, so the runtime was"
          + " stopped from outside it (a native abort, or Android killing the"
          + " process).\n\nLast stage reached: " + stage + "\n\n" + explain(stage);
    }
    return "ENGINE_PROCESS_DIED\n\nThe embedded Node runtime stopped before"
        + " Hearth could start, without recording a reason.";
  }

  private static String explain(String stage) {
    switch (stage) {
      case "NODE_RUNTIME_INIT":
        return "Died loading libnode.so — an ABI, linker or page-size problem.";
      case "NODE_RUNTIME_START":
        return "libnode.so loaded, so this is not an ABI problem. Node itself"
            + " stopped before main.js ran far enough to report anything.";
      case "JS_ENTERED":
        return "main.js started running, then the process was killed without"
            + " an error reaching the reporter — most likely a native abort"
            + " inside the sql.js WASM module.";
      case "DB_READY":
        return "The database opened. The failure is later, in HTTP setup.";
      case "LISTENING":
        return "The server was listening; the failure is after startup.";
      default:
        return "";
    }
  }
}
