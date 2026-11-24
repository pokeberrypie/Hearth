"""Rebuild the APK from the last release: the server bundle swapped in, the manifest's versionCode set, the boot
screen's own files (boot.html, hearthfire.js: shown out of the APK while the server wakes) replaced by the repo's,
every other entry copied exactly as it was (compression included).
Usage: repack.py base.apk bundle_dir manifest.xml out.apk [assets_dir]"""
import os, sys, zipfile
base, bundle, manifest, out = sys.argv[1:5]
assets = sys.argv[5] if len(sys.argv) > 5 else None
BOOT = ["boot.html", "hearthfire.js"]
swap = {f"assets/{n}": os.path.join(assets, n) for n in BOOT if assets and os.path.isfile(os.path.join(assets, n))}
with zipfile.ZipFile(base) as src, zipfile.ZipFile(out, "w") as dst:
    for i in src.infolist():
        if i.filename.startswith("assets/nodejs-project/") or i.filename == "AndroidManifest.xml":
            continue
        if i.filename in swap:
            dst.write(swap[i.filename], i.filename, compress_type=i.compress_type)
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
print(f"repacked: {n} bundle files, boot screen: {', '.join(sorted(os.path.basename(k) for k in swap)) or 'kept'}")
