import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { homedir } from "node:os";

export type DirEntry = { name: string; path: string };

/** Everything the importer would take from a folder or an archive. */
export const isWanted = (relative: string) => WANTED.some((re) => re.test(relative));

/** Directory listing for the picker: folders, plus any archive worth importing. */
export function listDir(target?: string) {
  const path = resolve(target && target.trim() ? target : homedir());
  const parent = dirname(path);
  let dirs: DirEntry[] = [];
  let error: string | null = null;

  try {
    dirs = readdirSync(path)
      .filter((n) => !n.startsWith("."))
      .map((n) => ({ name: n, path: join(path, n) }))
      .filter((e) => {
        try { return statSync(e.path).isDirectory(); } catch { return false; }
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } catch (e: any) {
    error = e?.code === "EACCES" ? "No permission to read that folder." : "Could not open that folder.";
  }

  /**
   * Archives are listed too, because on a phone that is how a SillyTavern
   * install arrives — you cannot browse into another app's folder, but its
   * backup lands in Downloads like anything else. Picking one imports it
   * without unpacking it first; see eachZipEntry.
   */
  let zips: { name: string; path: string; size: number }[] = [];
  try {
    zips = readdirSync(path)
      .filter((n) => /\.zip$/i.test(n) && !n.startsWith("."))
      .map((n) => {
        const full = join(path, n);
        try { return { name: n, path: full, size: statSync(full).size }; } catch { return null; }
      })
      .filter((z): z is { name: string; path: string; size: number } => !!z)
      .sort((a, b) => b.size - a.size);
  } catch {}

  return {
    path,
    parent: parent === path ? null : parent,
    crumbs: crumbsFor(path),
    dirs,
    zips,
    ...inspect(path),
    error,
  };
}

function crumbsFor(path: string): DirEntry[] {
  const parts = path.split(sep).filter(Boolean);
  const out: DirEntry[] = [];
  let acc = path.startsWith(sep) ? sep : "";
  for (const p of parts) {
    acc = acc === sep ? sep + p : acc ? acc + sep + p : p;
    out.push({ name: p, path: acc });
  }
  return out;
}

const has = (path: string, child: string) => {
  try { return statSync(join(path, child)).isDirectory(); } catch { return false; }
};
const hasFile = (path: string, child: string) => {
  try { return statSync(join(path, child)).isFile(); } catch { return false; }
};

/**
 * Works out whether a folder is a SillyTavern install, a user folder inside
 * one, or neither — and says which so the picker can point somewhere useful.
 */
export function inspect(path: string) {
  if (has(path, "characters") || hasFile(path, "settings.json")) {
    return { kind: "user" as const, target: path, hint: "A SillyTavern user folder." };
  }
  if (has(path, "data")) {
    const users = safeList(join(path, "data")).filter((u) => has(join(path, "data", u), "characters"));
    if (users.length) {
      return {
        kind: "root" as const,
        target: join(path, "data", users[0]),
        users,
        hint: `A SillyTavern install with ${users.length} user folder${users.length > 1 ? "s" : ""}.`,
      };
    }
  }
  return { kind: "none" as const, target: null, hint: "" };
}

function safeList(p: string) {
  try { return readdirSync(p).filter((n) => !n.startsWith(".")); } catch { return []; }
}

export const WANTED = [
  /(^|\/)settings\.json$/i,
  // SillyTavern also exports personas on their own; the name carries the date
  // it was exported, so match the stem rather than the whole thing.
  /(^|\/)personas[^/]*\.json$/i,
  /(^|\/)characters\/[^/]+\.(png|json)$/i,
  /(^|\/)user avatars\/[^/]+\.(png|jpe?g|webp)$/i,
  /(^|\/)worlds\/[^/]+\.json$/i,
  /(^|\/)(openai settings|textgen settings|presets)\/[^/]+\.json$/i,
  /(^|\/)backgrounds\/[^/]+\.(png|jpe?g|webp)$/i,
  /(^|\/)chats\/.+\.jsonl$/i,
];
const SKIP = /(^|\/)(thumbnails|_uploads|uploads|backups|node_modules|\.git)(\/|$)/i;

/** Collects only the files the importer can use, as relative paths. */
/**
 * Sensible starting points, plus any SillyTavern install sitting where one
 * usually sits. Matters most on Termux, where the useful paths are long and
 * nobody wants to type /data/data/com.termux/files/home from a phone keyboard.
 */
export function places() {
  const home = homedir();
  const termux = process.env.PREFIX?.includes("com.termux");

  const candidates: { name: string; path: string }[] = [
    { name: "Home", path: home },
    { name: "Downloads", path: join(home, "Downloads") },
    { name: "Documents", path: join(home, "Documents") },
    { name: "Desktop", path: join(home, "Desktop") },
  ];

  if (termux) {
    candidates.push(
      { name: "Phone storage", path: join(home, "storage", "shared") },
      { name: "Downloads", path: join(home, "storage", "downloads") },
      { name: "SD card", path: "/sdcard" },
    );
  }

  /**
   * Android's shared storage, offered whether or not this looks like Termux.
   * On the phone `home` is the app's own sandbox, which is the one place a
   * SillyTavern install certainly is not — without these the folder picker
   * opened on /data and had nowhere to go.
   */
  for (const [name, path] of [
    ["Phone storage", "/storage/emulated/0"],
    ["SD card", "/sdcard"],
    ["Downloads", "/storage/emulated/0/Download"],
    ["Documents", "/storage/emulated/0/Documents"],
  ] as const) {
    candidates.push({ name, path });
  }

  const roots = [home, join(home, "storage", "shared"), "/sdcard", "/storage/emulated/0",
                 "/storage/emulated/0/Download", "/storage/emulated/0/Documents",
                 join(home, "Desktop"), join(home, "Documents")];
  const found: { name: string; path: string }[] = [];
  for (const r of roots) {
    for (const n of ["SillyTavern", "sillytavern", "SillyTavern-Launcher", "ST"]) {
      const p = join(r, n);
      if (inspect(p).kind !== "none") found.push({ name: `Found: ${n}`, path: p });
      // Since 1.12 the things worth importing live one level further down, in
      // data/<user>. Point at that directly when it is there — a scan of the
      // folder above it works too, but this is the part you actually want.
      for (const sub of ["data/default-user", "data"]) {
        const deep = join(p, sub);
        if (inspect(deep).kind !== "none") found.push({ name: `Found: ${n}/${sub}`, path: deep });
      }
    }
  }

  const seen = new Set<string>();
  const dedupe = (list: { name: string; path: string }[]) =>
    list.filter((e) => {
      if (seen.has(e.path)) return false;
      try { statSync(e.path); } catch { return false; }
      seen.add(e.path);
      return true;
    });

  return { found: dedupe(found), places: dedupe(candidates), termux: !!termux };
}

/**
 * Every importable file under a folder, as paths and thunks.
 *
 * Reading each one here would mean holding a whole SillyTavern install in
 * memory at once — a gigabyte or two of character art. The caller reads them
 * one at a time instead; see Entry in backup.ts.
 */
export function collect(root: string, limit = 20000) {
  const out: { path: string; read: () => Uint8Array }[] = [];
  let skipped = 0;

  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > 6 || out.length >= limit) return;
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (n.startsWith(".")) continue;
      const full = join(dir, n);
      const r = rel ? `${rel}/${n}` : n;
      if (SKIP.test(r)) continue;
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full, r, depth + 1); continue; }
      if (!WANTED.some((re) => re.test(r))) continue;
      // statSync above already proved it is there and readable enough to
      // describe; a file that disappears before the read is counted then.
      out.push({ path: r, read: () => new Uint8Array(readFileSync(full)) });
      if (out.length >= limit) return;
    }
  };

  walk(resolve(root), "", 0);
  return { entries: out, skipped };
}
