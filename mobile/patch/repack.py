"""Rebuild the APK from the last release: the server bundle swapped in, the manifest's versionCode set, every other
entry copied exactly as it was (compression included). Usage: repack.py base.apk bundle_dir manifest.xml out.apk"""
import os, sys, zipfile
base, bundle, manifest, out = sys.argv[1:5]
with zipfile.ZipFile(base) as src, zipfile.ZipFile(out, "w") as dst:
    for i in src.infolist():
        if i.filename.startswith("assets/nodejs-project/") or i.filename == "AndroidManifest.xml":
            continue
        dst.writestr(i, src.read(i.filename), compress_type=i.compress_type)
    dst.write(manifest, "AndroidManifest.xml", compress_type=zipfile.ZIP_DEFLATED)
    n = 0
    for root, _, files in os.walk(bundle):
        for f in sorted(files):
            p = os.path.join(root, f)
            if f.endswith(".map"): continue   # source maps are for debugging, not for the phone
            dst.write(p, "assets/nodejs-project/" + os.path.relpath(p, bundle).replace(os.sep, "/"), compress_type=zipfile.ZIP_DEFLATED)
            n += 1
print(f"repacked: {n} bundle files")
