# Hearth for Android

A real Android app — not a shortcut to the desktop server. It runs its own
copy of Hearth's server, on the phone, with its own database, using a real
embedded Node.js runtime ([nodejs-mobile](https://github.com/nodejs-mobile))
inside a plain WebView shell. No PC has to be on. No network reachability is
needed. This is a different thing from the Termux setup in the main
`README.md`, which runs the desktop server directly on the phone through a
terminal — this is that same idea, packaged as an app icon instead.

## What's actually here

```
mobile/
  server/
    db.mobile.ts       sql.js-backed drop-in for src/db.ts (see below)
    serve.mobile.ts     Node entry point — the Android equivalent of src/serve.ts
  build.mjs              esbuild bundle: server/serve.mobile.ts -> dist/nodejs-project/main.js
  package.json            the bundler's own deps (esbuild, @hono/node-server, sql.js)
  android/                the Android Studio project. Open this folder directly.
    app/                  MainActivity + a WebView, nothing else
    nodejsmobile-lib/      the embedded Node runtime, as a local library module
```

**`src/index.ts` was not forked.** The same file that runs on desktop runs on
the phone, byte for byte — `mobile/build.mjs` bundles it with one redirect:
its `import ... from "./db"` resolves to `mobile/server/db.mobile.ts` instead
of the Bun original. Everything else — every route, `assemble()`, the whole
prompt pipeline, lorebooks, presets, groups — is exactly the code the desktop
tests cover. A bug fixed on desktop is fixed here too, automatically, the next
time this bundle is rebuilt.

**The one real substitution is the database.** `bun:sqlite` does not exist
under Node, and nodejs-mobile's Node build has no native-addon toolchain
worth trusting sight-unseen on a phone I do not have — so `db.mobile.ts` uses
[`sql.js`](https://sql.js.org) (SQLite compiled to WebAssembly) instead of a
native binding. It reproduces the exact slice of `bun:sqlite`'s API the rest
of the app calls (`db.query(sql).all/get/run(...)`, `db.exec(sql)`,
`db.transaction(fn)`), and both engines run the identical schema and
migrations from `src/schema.ts` — a backup exported from one platform is a
plain SQLite file the other can open without conversion.

## Building it

You need:
- **Android Studio** (simplest — it has its own JDK and can install the SDK/NDK
  for you), or the command-line SDK + a JDK 17+ + NDK 26.x + CMake 3.22.x on
  your own PATH.
- **Node.js** (any recent LTS) to run the bundler.

```bash
cd mobile
npm install                 # once
npm run bundle               # rebuild the server -> mobile/dist/nodejs-project

# Copy the fresh bundle into the Android project's assets. Repeat this after
# every change to src/*.ts or public/* before rebuilding the APK — the
# assets folder is a staged copy, not a symlink.
rm -rf android/app/src/main/assets/nodejs-project
cp -r dist/nodejs-project android/app/src/main/assets/nodejs-project

cd android
./gradlew assembleDebug      # -> app/build/outputs/apk/debug/app-debug.apk
```

Or open `mobile/android/` in Android Studio and hit Run once the assets are
copied — same result, with a device/emulator picker.

`local.properties` (your SDK path) is not checked in; Android Studio writes
it the first time you open the project. Building from the command line
without Android Studio needs one line by hand:
```
echo "sdk.dir=/path/to/your/Android/Sdk" > android/local.properties
```
(Forward slashes even on Windows — a Java Properties file treats backslash as
an escape character, and `C:\Users\...` silently parses wrong.)

If Gradle dies with **"Could not reserve enough space for 2097152KB object
heap"**, it has picked up a 32-bit JRE — on Windows, usually an old Java 8
under `Program Files (x86)` that happens to be first on `PATH`. A 32-bit
process cannot reserve the 2GB the build asks for. Point Gradle at a 64-bit
JDK 17 in `~/.gradle/gradle.properties` (machine-local, not checked in, and
forward slashes here too):
```
org.gradle.java.home=C:/path/to/jdk-17
```
Worth knowing that this failure is quiet if the build output is piped
anywhere: a pipeline reports the exit code of its *last* command, so
`./gradlew assembleDebug | tail` says 0 for a build that never ran.

## What was verified on a real device, and how

This machine has no Android SDK, emulator, or physical device of its own —
the SDK, NDK, JDK and Gradle were all installed from scratch in this session,
and every build here was produced blind. Two rounds actually reached a phone:

- **Round 1** crashed instantly with no information — the platform's own
  "Hearth keeps stopping" dialog, nothing else. Neither USB debugging (no
  cable available) nor wireless ADB debugging (the option did not appear in
  Developer settings on this device, and separately, the sandbox this was
  built in turned out to have no real route to the phone's LAN even once
  pairing was attempted) were usable to pull a log.
- So **`HearthApplication`** (a global `Thread.UncaughtExceptionHandler`,
  installed before anything else runs) and **`CrashActivity`** (a plain-View
  screen that shows the full stack trace with a copy-to-clipboard button)
  were added — the app now displays its own crash instead of just closing,
  which needs no cable, no debugging mode, and no network reachability at all.
- **Round 2, with that build, surfaced the real bug**, copied straight off
  the phone:
  ```
  java.lang.RuntimeException: Node assets copy failed
  Caused by: java.io.FileNotFoundException: builtin_modules
  ```
  `assets/builtin_modules/` had only a `.keep` placeholder file in it to
  keep the folder non-empty. Android's `aapt` packager silently drops any
  asset path starting with a dot (the same convention that excludes
  `.git`/`.svn`/`.DS_Store`) — so the folder shipped genuinely empty,
  `AssetManager.list()` returned nothing, and `copyAssetFolder()` fell back to
  treating `"builtin_modules"` as if it were a single file, which does not
  open. Fixed by using `placeholder.txt` instead — confirmed present in the
  built APK this time (`.keep` never actually was, despite sitting right there
  on disk, which is exactly what made this so quiet).
- **Round 3 (the current build) has not been confirmed on-device yet.**

If it still does not open cleanly, the crash screen is still built in — it
will show whatever the next real error is, copy-to-clipboard included.

## Known gaps

- **No release signing.** `assembleDebug` only. A Play Store or a signed
  release build needs a keystore, which I did not create — that is a
  deliberate decision for you to make, not mine to generate silently.
- **No legacy app icon.** The launcher icon is an adaptive icon (API 26+)
  only, which is also why `minSdk` is 26 rather than nodejs-mobile's own
  floor of 24. A phone from mid-2017 or later is unaffected.
- **arm64-v8a and armeabi-v7a (64- and 32-bit ARM).** Covers real phones from
  roughly the last decade. x86/x86_64 (emulator-only architectures) are
  dropped, so this APK will not install on an Intel-based emulator image —
  only on real ARM hardware.
- **`android:allowBackup="false"`.** Android's automatic backup is off, so a
  reinstall starts empty. Turning it on safely means scoping it to just the
  database file (not the multi-hundred-MB bundled Node runtime) — worth doing
  as a follow-up, not done here.
- **No file-picker import/export wiring on the WebView side.** Hearth's
  backup export/import and character-card upload use plain browser
  `<input type="file">`/download flows; whether Android's WebView file-chooser
  permission prompts need any extra plumbing in MainActivity is untested for
  the same reason everything else here is untested — no device.
