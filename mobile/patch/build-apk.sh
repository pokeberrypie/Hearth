#!/bin/bash
# The APK, from the last release: tests first, then the server bundle swapped in, the version set, signed with the
# Hearth debug key and verified. Run from the repo root:  mobile/patch/build-apk.sh VERSIONCODE
#   HEARTH_KEYSTORE  the debug keystore (default ~/.android/debug.keystore) — never in the repo
#   APKSIG_JAR       Google's apksig (dl.google.com/android/maven2/com/android/tools/build/apksig/8.7.3/apksig-8.7.3.jar)
# The release it builds from already carries mobile/patch's CallActivity and permissions; see README.md here.
set -euo pipefail
N=${1:?versionCode}
KEY=${HEARTH_KEYSTORE:-$HOME/.android/debug.keystore}
APKSIG=${APKSIG_JAR:?set APKSIG_JAR to apksig.jar}
BASE=releases/Hearth-0.2.7.apk
W=$(mktemp -d)
test -s "$KEY" || { echo "no keystore at $KEY"; exit 1; }
CERT=$(keytool -list -v -keystore "$KEY" -storepass android -alias androiddebugkey 2>/dev/null | grep -m1 "SHA256:" | awk '{print $2}')
[ "$CERT" = "C2:7F:60:A5:2F:F1:1C:65:A6:B0:40:FC:3F:0F:3A:65:9C:00:DB:6E:EC:A3:94:D5:3D:D4:B1:71:8A:AD:E3:FF" ] || { echo "that is not the Hearth key ($CERT)"; exit 1; }

bun test > "$W/test.log" 2>&1 || { grep -E "^\(fail\)| fail$" "$W/test.log"; echo "TESTS FAILED — no build"; exit 1; }
grep -E " pass$| fail$" "$W/test.log"
bun test ./src/chaos.slow.ts > "$W/chaos.log" 2>&1 || { tail -5 "$W/chaos.log"; echo "CHAOS FAILED — no build"; exit 1; }
bun run scripts/build-desktop.ts > "$W/desktop.log" 2>&1 || { tail -5 "$W/desktop.log"; echo "DESKTOP BUILD FAILED"; exit 1; }
npx tsc --noEmit -p . > "$W/tsc.log" 2>&1 || { grep error "$W/tsc.log" | head; echo "TYPECHECK FAILED — no build"; exit 1; }

(cd mobile && node build.mjs)
unzip -p "$BASE" AndroidManifest.xml > "$W/AndroidManifest.xml"
python3 -I mobile/patch/version.py "$W/AndroidManifest.xml" "$N"
# The boot screen (boot.html, hearthfire.js) goes in from mobile/android's assets: src/hearthfire.test.ts holds its
# hearthfire.js to the app's own, so the drawing on the way in is the one the app carries on.
python3 -I mobile/patch/repack.py "$BASE" mobile/dist/nodejs-project "$W/AndroidManifest.xml" "$W/unsigned.apk" mobile/android/app/src/main/assets
javac -nowarn -cp "$APKSIG" -d "$W" mobile/patch/Sign.java 2>&1 | grep -v JAVA_TOOL || true
java -cp "$W:$APKSIG" Sign "$W/unsigned.apk" "$W/signed.apk" "$KEY" 2>&1 | grep -v JAVA_TOOL
cp "$W/signed.apk" "$BASE"
sed -i -E "s/versionCode [0-9]+/versionCode $N/" mobile/android/app/build.gradle
rm -f releases/Hearth-0.2.7-windows.zip && (cd dist/desktop && zip -q -9 ../../releases/Hearth-0.2.7-windows.zip Hearth.exe)
rm -rf "$W"
echo "BUILD $N OK"
