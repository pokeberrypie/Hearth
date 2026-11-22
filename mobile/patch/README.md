# Patches for the prebuilt APK

Hearth's APK is assembled from a compiled base (v58) rather than a fresh Gradle build, so Java changes reach it
as extra code and manifest edits:

- `CallActivity.java` — v58's `MainActivity`, able to take a call: grants the page the microphone (after
  Android's own permission prompt) and lets a spoken reply play without a tap. Compiled into `classes5.dex`
  beside the launcher; the manifest's `com.hearth.app.MainActivity` is renamed to `com.hearth.app.CallActivity`
  (same length), and the launcher starts it.
- `addperm.py` — adds `<uses-permission>` elements to a compiled `AndroidManifest.xml` (here `RECORD_AUDIO` and
  `MODIFY_AUDIO_SETTINGS`) by copying the `INTERNET` one and appending its name to the string pool.

A real Gradle build needs none of this: `MainActivity.java` and `AndroidManifest.xml` carry the same changes.

## Building the APK

```bash
APKSIG_JAR=/path/to/apksig-8.7.3.jar mobile/patch/build-apk.sh <versionCode>
```

Builds from `releases/Hearth-0.2.7.apk` (the last release, which already carries `CallActivity`, the launcher and the
permissions): runs the tests, swaps in the server bundle, sets the version (`version.py`), repacks every other entry
exactly as it was (`repack.py`) and signs with the Hearth debug key (`Sign.java`, Google's apksig), then verifies the
signature and prints the certificate. The key is `~/.android/debug.keystore` (or `HEARTH_KEYSTORE`) and is **never**
kept in this repository; the script refuses any key but the one every install carries
(`C2:7F:60:A5:…:E3:FF`), since Android will not update an app with another.
