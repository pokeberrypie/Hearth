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
