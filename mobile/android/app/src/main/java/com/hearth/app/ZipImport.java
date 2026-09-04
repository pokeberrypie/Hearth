package com.hearth.app;

import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Unpacks the importable part of a SillyTavern backup, in Java.
 *
 * The server does this itself on the desktop, streaming the archive through
 * fflate. That does not survive on a phone: a real backup is four gigabytes and
 * almost certainly ZIP64, fflate's streaming reader holds on to input it cannot
 * yet place, and V8 died inside a major collection about fifty files in — with
 * the entries themselves written straight to disk, so the memory was never the
 * app's own to give back.
 *
 * java.util.zip has none of those problems. It streams, it understands ZIP64,
 * and none of it is on the JavaScript heap. What lands here is a folder the
 * ordinary folder import already knows how to read, so nothing downstream had
 * to change.
 *
 * Only the parts worth importing are extracted. A SillyTavern install is mostly
 * node_modules and git objects; skipping those is the difference between four
 * gigabytes and a few hundred megabytes.
 */
final class ZipImport {
  private static final String TAG = "Hearth";

  /** Mirrors WANTED in src/localfs.ts. Keep the two in step. */
  private static final Pattern[] WANTED = {
    Pattern.compile("(^|/)settings\\.json$", Pattern.CASE_INSENSITIVE),
    // SillyTavern also exports personas on their own; the name carries the
    // date it was exported, so match the stem rather than the whole thing.
    Pattern.compile("(^|/)personas[^/]*\\.json$", Pattern.CASE_INSENSITIVE),
    Pattern.compile("(^|/)characters/[^/]+\\.(png|json)$", Pattern.CASE_INSENSITIVE),
    Pattern.compile("(^|/)user avatars/[^/]+\\.(png|jpe?g|webp)$", Pattern.CASE_INSENSITIVE),
    Pattern.compile("(^|/)worlds/[^/]+\\.json$", Pattern.CASE_INSENSITIVE),
    Pattern.compile("(^|/)(openai settings|textgen settings|presets)/[^/]+\\.json$", Pattern.CASE_INSENSITIVE),
    Pattern.compile("(^|/)backgrounds/[^/]+\\.(png|jpe?g|webp)$", Pattern.CASE_INSENSITIVE),
    Pattern.compile("(^|/)chats/.+\\.jsonl$", Pattern.CASE_INSENSITIVE),
  };

  private static boolean wanted(String name) {
    for (Pattern p : WANTED) if (p.matcher(name).find()) return true;
    return false;
  }

  /** Where the last unpack put things, and how it is going. */
  static volatile String stagingPath = "";
  static volatile String state = "idle";   // idle | running | done | error
  static volatile int taken = 0;
  static volatile int seen = 0;
  static volatile String error = "";

  private ZipImport() {}

  /**
   * Starts unpacking. Returns the folder it will unpack into, straight away —
   * the work happens on its own thread and the page watches `state`.
   */
  static String start(File parent, String zipPath) {
    File out = new File(parent, "import-staging");
    stagingPath = out.getAbsolutePath();
    state = "running";
    taken = 0;
    seen = 0;
    error = "";

    new Thread(() -> {
      try {
        deleteTree(out);
        if (!out.mkdirs() && !out.isDirectory()) throw new IllegalStateException("Could not make a staging folder.");
        unpack(new File(zipPath), out);
        state = "done";
      } catch (Throwable t) {
        Log.e(TAG, "Unpacking " + zipPath + " failed", t);
        error = String.valueOf(t.getMessage());
        state = "error";
      }
    }, "hearth-unzip").start();

    return stagingPath;
  }

  private static void unpack(File zip, File out) throws Exception {
    byte[] buffer = new byte[64 * 1024];
    try (ZipInputStream in = new ZipInputStream(new FileInputStream(zip))) {
      ZipEntry entry;
      while ((entry = in.getNextEntry()) != null) {
        seen++;
        String name = entry.getName();
        if (entry.isDirectory() || !wanted(name)) { in.closeEntry(); continue; }

        // A zip may name an entry its way out of the folder being written to.
        File dest = new File(out, name.replace("\\", "/"));
        String root = out.getCanonicalPath() + File.separator;
        if (!dest.getCanonicalPath().startsWith(root)) { in.closeEntry(); continue; }

        File dir = dest.getParentFile();
        if (dir != null && !dir.isDirectory() && !dir.mkdirs()) { in.closeEntry(); continue; }

        try (OutputStream os = new FileOutputStream(dest)) {
          int read;
          while ((read = in.read(buffer)) != -1) os.write(buffer, 0, read);
        }
        in.closeEntry();
        taken++;
      }
    }
  }

  static void deleteTree(File f) {
    if (f == null || !f.exists()) return;
    File[] kids = f.listFiles();
    if (kids != null) for (File k : kids) deleteTree(k);
    // A staging folder left behind costs as much disk as the parts of a backup
    // worth importing, every time one is imported.
    if (!f.delete()) Log.w(TAG, "Could not remove " + f);
  }
}
