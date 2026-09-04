/**
 * Prepended verbatim to the bundled `main.js` (see build.mjs's `banner`), so
 * it runs before a single module of the bundle is evaluated. That timing is
 * the entire reason this file exists as a banner rather than as an import.
 *
 * It does two things:
 *
 * 1. Pins the working directory. Hearth's server creates `data/uploads` and
 *    friends with *relative* paths, at module scope — the same way the
 *    desktop build does. serve.mobile.ts calls process.chdir(__dirname) for
 *    this, but that call sits in a module body, and ES imports are evaluated
 *    before it: by the time it runs, src/index.ts has already tried to mkdir
 *    'data/uploads' against nodejs-mobile's inherited working directory,
 *    which on Android is the filesystem root. That fails with EACCES and
 *    takes the whole app down. Doing it here, first, is what makes every
 *    relative path in the shared server code mean what it means on desktop.
 *
 * 2. Makes a JavaScript startup failure visible on the phone. nodejs-mobile
 *    runs Node inside the app's own process, so an uncaught error takes the
 *    entire app down and the stack trace goes only to logcat — which needs a
 *    computer and a cable to read. The files written here land in the app's
 *    filesDir, one directory above this bundle, where BootstrapActivity reads
 *    them and draws them on screen. Diagnostics.java uses the same filenames.
 */
(function () {
  var fs = require("fs");
  var path = require("path");
  var dir = path.join(__dirname, "..");

  /**
   * `File` is a global from Node 20 onwards. nodejs-mobile ships Node 18,
   * where it exists only as `require("buffer").File` — so every upload route,
   * which sorts the parts of a multipart form with `part instanceof File`,
   * threw ReferenceError on the phone and answered 500. That is the whole
   * import surface: character cards, lorebooks, presets, personas, avatars,
   * wallpapers and the SillyTavern backup.
   *
   * Defining it here rather than editing eleven call sites keeps the server
   * source identical on both platforms, which is the point of the shared
   * build. undici backs both `buffer.File` and the parts that formData()
   * produces, so the instanceof holds.
   */
  /**
   * The most a single upload may be on this runtime.
   *
   * Restoring a SillyTavern backup reads the whole multipart body into memory
   * and then fflate's unzipSync inflates every entry of the archive at once,
   * so peak memory is a couple of times the file's size. A desktop shrugs at
   * that; nodejs-mobile on a phone is killed outright, and a native abort
   * cannot be caught or reported — the app simply vanishes mid-restore, which
   * is a frightening thing to have happen to a backup.
   *
   * Refusing early is worse than succeeding and far better than dying: the
   * import route checks Content-Length against this before it reads a byte,
   * and says what to do instead. Only the mobile build sets it.
   */
  globalThis.__hearthMaxUpload = 160 * 1024 * 1024;

  if (typeof globalThis.File === "undefined") {
    try {
      var File = require("buffer").File;
      if (File) globalThis.File = File;
    } catch (e) {}
  }

  // Before anything else: see (1) above.
  process.chdir(__dirname);

  /**
   * Keep the database out of the folder nodejs-mobile throws away.
   *
   * Everything the app has — characters, chats, lorebooks, every uploaded
   * picture — lived in ./data, which is inside nodejs-project. That folder is
   * not the app's to keep: on any version change nodejs-mobile renames it to
   * a trash folder, copies a fresh one out of the APK and then empties the
   * trash, because it is meant to hold only the bundled server. So every
   * update silently destroyed the library, and there is no warning and nothing
   * left behind afterwards.
   *
   * One level up, in filesDir itself, is untouched by any of that. Anything
   * already in the old place is moved rather than abandoned — though after an
   * update there is nothing left to move, which is the whole problem.
   */
  var filesDir = path.join(__dirname, "..");
  var dataDir = path.join(filesDir, "data");
  var legacy = path.join(__dirname, "data");
  try {
    if (fs.existsSync(legacy) && !fs.existsSync(dataDir)) fs.renameSync(legacy, dataDir);
  } catch (e) {}
  process.env.DATA_DIR = dataDir;

  function write(name, text) {
    try {
      fs.writeFileSync(path.join(dir, name), String(text));
    } catch (e) {}
  }

  // A stale report from a previous launch would be read as this launch's.
  try {
    fs.unlinkSync(path.join(dir, "node-error.txt"));
  } catch (e) {}

  globalThis.__hearthStage = function (stage) {
    write("startup-stage.txt", stage);
  };

  globalThis.__hearthReport = function (label, err) {
    var detail = err && err.stack ? err.stack : String(err);
    write("node-error.txt", label + "\n\n" + detail);
  };

  // Reaching here at all rules out every native failure before JavaScript.
  globalThis.__hearthStage("JS_ENTERED");

  process.on("uncaughtException", function (err) {
    globalThis.__hearthReport("Uncaught exception", err);
    process.exit(1);
  });

  process.on("unhandledRejection", function (err) {
    globalThis.__hearthReport("Unhandled promise rejection", err);
    process.exit(1);
  });
})();
