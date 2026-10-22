/**
 * Gives a cross-compiled Hearth.exe what Bun's --windows-* flags would have on Windows: the icon,
 * the version info and no console window. Rewrites only the resource section, in place — Bun's
 * .bun section comes after it and must not move, which is why resedit cannot simply be run on the file.
 *
 *   npm install resedit@2 pe-library   (once, anywhere on NODE_PATH)
 *   node scripts/brand-exe.cjs dist/desktop/Hearth.exe dist/desktop/Hearth.exe installer/hearth.ico 0.2.7.0
 */
const fs = require("fs");
const PE = require("pe-library");
const ResEdit = require("resedit");
const [, , input, output, icoPath, version] = process.argv;
const orig = fs.readFileSync(input);
const pe = orig.readUInt32LE(0x3c);
const nsec = orig.readUInt16LE(pe + 6);
const optSize = orig.readUInt16LE(pe + 20);
const opt = pe + 24;
const secTab = opt + optSize;
const sections = [...Array(nsec)].map((_, i) => {
  const o = secTab + 40 * i;
  return { o, name: orig.toString("latin1", o, o + 8).replace(/\0+$/, ""), vsize: orig.readUInt32LE(o + 8), va: orig.readUInt32LE(o + 12),
    rsize: orig.readUInt32LE(o + 16), rptr: orig.readUInt32LE(o + 20) };
});
const rsrc = sections.find((s) => s.name === ".rsrc");
const last = sections[nsec - 1];
if (last.name !== ".bun") throw new Error("expected .bun last, got " + last.name);
// A copy without the .bun section, which resedit is willing to edit.
const stripped = Buffer.from(orig.subarray(0, last.rptr));
stripped.writeUInt16LE(nsec - 1, pe + 6);
stripped.fill(0, last.o, last.o + 40);
const exe = PE.NtExecutable.from(stripped, { ignoreCert: true });
const res = PE.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const gid = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
for (const g of groups) if (g.id !== gid) console.log("note: extra icon group", g.id);
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map((i) => i.data));
// Drop icon images no group points at any more (the old, larger ones), or the section would not shrink.
const used = new Set(ResEdit.Resource.IconGroupEntry.fromEntries(res.entries).flatMap((g) => g.icons.map((i) => i.iconID)));
res.entries = res.entries.filter((e) => e.type !== 3 || used.has(e.id));
const vers = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
const v = vers[0] ?? ResEdit.Resource.VersionInfo.createEmpty();
const [a, b, c, d] = version.split(".").map(Number);
v.setFileVersion(a, b, c, d, 1033); v.setProductVersion(a, b, c, d, 1033);
v.setStringValues({ lang: 1033, codepage: 1200 }, {
  FileDescription: "Hearth — local-first roleplay", ProductName: "Hearth", InternalName: "Hearth",
  OriginalFilename: "Hearth.exe", FileVersion: version, ProductVersion: version, CompanyName: "Hearth", LegalCopyright: "MIT License",
});
v.outputToResourceEntries(res.entries);
res.outputResource(exe);
const gen = Buffer.from(exe.generate());
const gpe = gen.readUInt32LE(0x3c), gn = gen.readUInt16LE(gpe + 6), gsec = gpe + 24 + gen.readUInt16LE(gpe + 20);
let nr = null;
for (let i = 0; i < gn; i++) {
  const o = gsec + 40 * i;
  if (gen.toString("latin1", o, o + 8).replace(/\0+$/, "") === ".rsrc")
    nr = { vsize: gen.readUInt32LE(o + 8), va: gen.readUInt32LE(o + 12), rsize: gen.readUInt32LE(o + 16), rptr: gen.readUInt32LE(o + 20) };
}
console.log("old .rsrc", rsrc.va.toString(16), rsrc.vsize, rsrc.rsize, " new", nr.va.toString(16), nr.vsize);
if (nr.va !== rsrc.va) throw new Error("the resource section would move");
if (nr.vsize > rsrc.rsize) throw new Error(`new resources (${nr.vsize}) do not fit in ${rsrc.rsize}`);
// Into the original, in place: the bytes, the section's size, the resource directory's size, and the subsystem.
const out = Buffer.from(orig);
out.fill(0, rsrc.rptr, rsrc.rptr + rsrc.rsize);
gen.copy(out, rsrc.rptr, nr.rptr, nr.rptr + nr.vsize);
out.writeUInt32LE(nr.vsize, rsrc.o + 8);
const dd = opt + (orig.readUInt16LE(opt) === 0x20b ? 112 : 96);
out.writeUInt32LE(rsrc.va, dd + 2 * 8);
out.writeUInt32LE(nr.vsize, dd + 2 * 8 + 4);
out.writeUInt16LE(2, opt + 68); // IMAGE_SUBSYSTEM_WINDOWS_GUI: no console window
fs.writeFileSync(output, out);
console.log("wrote", output, out.length, "bytes (was", orig.length + ")");
