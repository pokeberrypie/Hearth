"""Set versionCode in a compiled AndroidManifest.xml (in place). Usage: version.py manifest.xml CODE"""
import struct, sys
path, code = sys.argv[1], int(sys.argv[2])
buf = bytearray(open(path, "rb").read())
off = 8
_, hsz, size = struct.unpack_from("<HHI", buf, off)
off += size
resmap = []
VERSION_CODE = 0x0101021B
done = False
while off < len(buf):
    typ, hsz, size = struct.unpack_from("<HHI", buf, off)
    if typ == 0x0180:
        resmap = list(struct.unpack_from("<%dI" % ((size - 8) // 4), buf, off + 8))
    if typ == 0x0102 and not done:
        astart, asize, acount = struct.unpack_from("<HHH", buf, off + 16 + 8)
        for i in range(acount):
            a = off + 16 + astart + i * asize
            name = struct.unpack_from("<i", buf, a + 4)[0]
            if 0 <= name < len(resmap) and resmap[name] == VERSION_CODE:
                old = struct.unpack_from("<I", buf, a + 16)[0]
                struct.pack_into("<I", buf, a + 16, code)
                print(f"versionCode {old} -> {code}")
                done = True
    off += size
if not done: raise SystemExit("no versionCode found")
open(path, "wb").write(buf)
