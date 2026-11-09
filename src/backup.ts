import { Unzip, UnzipInflate, unzipSync } from "fflate";
import { closeSync, createReadStream, openSync, writeSync } from "node:fs";
import { readCard, normalise } from "./cards";

/**
 * One file from a backup, read on demand.
 *
 * It used to carry its bytes. A whole SillyTavern folder is mostly character
 * PNGs and backgrounds, and holding every one of them at once is a gigabyte or
 * two — fine on a desktop, fatal on a phone, where the runtime is killed
 * outright and the app vanishes mid-import. A thunk instead means the folder
 * walk holds nothing but paths, and peak memory is one file.
 */
export type Entry = { path: string; read: () => Uint8Array };

/** Flattens a zip, dropping directory records and macOS resource forks. */
export function readZip(buf: Uint8Array): Entry[] {
  const files = unzipSync(buf);
  return Object.entries(files)
    .filter(([p, b]) => b.length > 0 && !p.endsWith("/") && !p.includes("__MACOSX"))
    .map(([path, bytes]) => ({ path, read: () => bytes }));
}

/**
 * Walks a zip on disk, one entry at a time, without ever holding the archive.
 *
 * readZip() below inflates the whole thing into memory at once, which is fine
 * for a handful of cards and impossible for a real SillyTavern backup — theirs
 * is four gigabytes. This pushes the file through fflate's streaming reader
 * instead, so the most that is ever in memory is a single entry, and `want`
 * decides which entries are even worth inflating: a full backup is mostly
 * node_modules and git objects, and skipping those is most of the win.
 *
 * UnzipInflate rather than the async variant on purpose — the async one wants
 * workers, which the embedded runtime on a phone does not have.
 */
export function eachZipEntry(
  path: string,
  want: (name: string) => boolean,
  /** Where to put an entry, or null to skip it entirely. */
  destFor: (name: string) => string | null,
): Promise<{ seen: number; taken: number }> {
  return new Promise((resolve, reject) => {
    const uz = new Unzip();
    uz.register(UnzipInflate);
    let seen = 0;
    let taken = 0;
    let failed: Error | null = null;

    uz.onfile = (file) => {
      seen++;
      // A directory record, or something not being imported: never started, so
      // fflate walks past its bytes instead of decompressing them. On a real
      // backup that skips node_modules and the git objects, which is most of it.
      if (file.name.endsWith("/") || !want(file.name)) return;
      const dest = destFor(file.name);
      if (!dest) return;

      /**
       * Written through to disk as it inflates, never assembled in memory.
       *
       * Collecting an entry's chunks and concatenating them at the end is the
       * obvious way to write this, and it is what killed the runtime: a single
       * chat transcript out of SillyTavern runs to tens of megabytes, every
       * chunk of it is a fresh allocation, and V8 on a phone died inside a
       * major collection trying to compact around them. Held this way the
       * ceiling is one chunk, whatever the entry weighs.
       */
      let fd: number | null = null;
      file.ondata = (err, chunk, final) => {
        if (err) { failed ??= err as Error; return; }
        try {
          if (fd === null) fd = openSync(dest, "w");
          if (chunk?.length) writeSync(fd, chunk, 0, chunk.length);
          if (final) { closeSync(fd); fd = null; taken++; }
        } catch (e) {
          failed ??= e as Error;
          if (fd !== null) { try { closeSync(fd); } catch {} fd = null; }
        }
      };
      file.start();
    };

    const stream = createReadStream(path);
    stream.on("data", (chunk) => {
      // A Buffer is already a Uint8Array; copying it would double the churn.
      try { uz.push(chunk as unknown as Uint8Array, false); }
      catch (e) { stream.destroy(); reject(e); }
    });
    stream.on("error", reject);
    stream.on("end", () => {
      try { uz.push(new Uint8Array(0), true); } catch (e) { return reject(e); }
      failed ? reject(failed) : resolve({ seen, taken });
    });
  });
}

const text = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);
const base = (p: string) => p.split("/").pop() ?? p;
const seg = (p: string) => p.split("/").filter(Boolean);

/** Matches a folder name anywhere in the path, case-insensitively. */
const inFolder = (p: string, name: string) =>
  seg(p).slice(0, -1).some((s) => s.toLowerCase() === name.toLowerCase());

type Loose =
  | { kind: "lorebook"; entries: unknown[] }
  | { kind: "character"; card: ReturnType<typeof normalise> }
  | { kind: "preset"; json: any }
  | { kind: "chat"; character: string; lines: any[] }
  | { kind: "picture" };

/** What a file on its own is, by what is in it; null when it is none of the things this import brings in. */
export function looseKind(name: string, read: () => Uint8Array): Loose | null {
  const lower = name.toLowerCase();
  if (/\.(png|jpe?g|webp)$/.test(lower)) {
    if (lower.endsWith(".png")) { try { return { kind: "character", card: readCard(read(), name) }; } catch { /* a picture, not a card */ } }
    return { kind: "picture" };
  }
  if (lower.endsWith(".jsonl")) {
    const lines = text(read()).split("\n").map((l) => l.trim()).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const head = lines[0];
    if (lines.length < 2 || !head || typeof head !== "object" || !("character_name" in head || "user_name" in head)) return null;
    return { kind: "chat", character: String(head.character_name ?? ""), lines };
  }
  if (!lower.endsWith(".json")) return null;
  let j: any;
  try { j = JSON.parse(text(read())); } catch { return null; }
  if (!j || typeof j !== "object") return null;
  const isEntry = (x: any) => x && typeof x === "object" && typeof x.content === "string" && ("key" in x || "keys" in x);
  const entries = Array.isArray(j) ? j : Array.isArray(j.entries) ? j.entries : j.entries && typeof j.entries === "object" ? Object.values(j.entries) : null;
  if (entries && entries.length && entries.some(isEntry)) return { kind: "lorebook", entries };
  if (Array.isArray(j)) return null;
  const d = j.data && typeof j.data === "object" ? j.data : j;
  if (String(j.spec ?? "").startsWith("chara_card") || (typeof d.name === "string" && ("first_mes" in d || "char_greeting" in d))) {
    return { kind: "character", card: normalise(j) };
  }
  if (Array.isArray(j.prompts) || Array.isArray(j.prompt_order) || ("temperature" in j && ("top_p" in j || "openai_max_tokens" in j || "max_length" in j))) {
    return { kind: "preset", json: j };
  }
  return null;
}

export type Plan = {
  characters: { file: string; card: ReturnType<typeof normalise>; png: (() => Uint8Array) | null }[];
  personas: { name: string; description: string; avatarFile: string | null; active: boolean }[];
  avatars: Map<string, () => Uint8Array>;
  lorebooks: { name: string; entries: unknown[] }[];
  presets: { name: string; json: any }[];
  chats: { character: string; file: string; lines: any[] }[];
  backgrounds: { name: string; read: () => Uint8Array }[];
  notes: string[];
};

/**
 * Walks a SillyTavern data folder (zipped) and works out what it contains.
 * Layouts differ between versions, so match on folder names rather than a
 * fixed tree, and tolerate anything unrecognised.
 */
export function planBackup(entries: Entry[]): Plan {
  const plan: Plan = {
    characters: [], personas: [], avatars: new Map(),
    lorebooks: [], presets: [], chats: [], backgrounds: [], notes: [],
  };

  let settings: any = null;

  for (const e of entries) {
    const name = base(e.path);
    const lower = e.path.toLowerCase();

    try {
      if (name.toLowerCase() === "settings.json") {
        /**
         * A real backup holds several files called settings.json — the repo's
         * own .vscode one, SillyTavern's default content, an extension's, and
         * the user's. Only the last has personas in it, and it is not reliably
         * the one walked last, so taking whichever came by most recently threw
         * the personas away perhaps three times out of four. Here: keep the one
         * that actually carries them, and fall back to the first of the rest so
         * a backup with none still yields whatever else settings.json holds.
         */
        const j = JSON.parse(text(e.read()));
        const found = j?.power_user?.personas ?? j?.personas;
        if (found && typeof found === "object" && Object.keys(found).length) settings = j;
        else settings ??= j;
        continue;
      }

      /**
       * SillyTavern also exports personas on their own, and the file is the
       * same three fields settings.json keeps them under, hoisted to the top
       * level: personas, persona_descriptions, default_persona. Recognised by
       * that shape rather than by its name, which carries the date it was
       * exported and so is never the same twice.
       */
      if (lower.endsWith(".json") && !inFolder(e.path, "characters")) {
        const maybe = JSON.parse(text(e.read()));
        if (maybe && typeof maybe === "object" && maybe.personas &&
            typeof maybe.personas === "object" && !Array.isArray(maybe.personas)) {
          // A settings.json already read wins; it knows which persona is active.
          settings ??= {
            personas: maybe.personas,
            persona_descriptions: maybe.persona_descriptions ?? {},
            user_avatar: maybe.default_persona ?? maybe.user_avatar ?? "",
          };
          continue;
        }
      }

      if (inFolder(e.path, "characters") && lower.endsWith(".png")) {
        // The card is parsed now (it is only the PNG's text chunks); the image
        // itself stays on disk until the import actually writes it out.
        plan.characters.push({ file: name, card: readCard(e.read(), name), png: e.read });
        continue;
      }

      if ((inFolder(e.path, "User Avatars") || inFolder(e.path, "user avatars")) &&
          /\.(png|jpe?g|webp)$/i.test(lower)) {
        plan.avatars.set(name, e.read);
        continue;
      }

      if (inFolder(e.path, "worlds") && lower.endsWith(".json")) {
        const j = JSON.parse(text(e.read()));
        const raw = j.entries ?? {};
        const list = Array.isArray(raw) ? raw : Object.values(raw);
        plan.lorebooks.push({ name: name.replace(/\.json$/i, ""), entries: list });
        continue;
      }

      if ((inFolder(e.path, "OpenAI Settings") || inFolder(e.path, "TextGen Settings") ||
           inFolder(e.path, "presets")) && lower.endsWith(".json")) {
        plan.presets.push({ name: name.replace(/\.json$/i, ""), json: JSON.parse(text(e.read())) });
        continue;
      }

      if (inFolder(e.path, "backgrounds") && /\.(png|jpe?g|webp)$/i.test(lower)) {
        plan.backgrounds.push({ name, read: e.read });
        continue;
      }

      if (lower.endsWith(".jsonl") && seg(e.path).some((s) => s.toLowerCase() === "chats")) {
        const parts = seg(e.path);
        const ci = parts.findIndex((s) => s.toLowerCase() === "chats");
        const character = parts[ci + 1] && parts[ci + 1] !== name ? parts[ci + 1] : "";
        const lines = text(e.read())
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => { try { return JSON.parse(l); } catch { return null; } })
          .filter(Boolean);
        if (lines.length) plan.chats.push({ character, file: name, lines });
        continue;
      }

      // A file picked by hand comes with no folder around it, so none of the above knows it: a lorebook, a card, a
      // preset or a chat chosen one at a time was passed over without a word — "loose files", the button says.
      // Known by what is in it instead. Only a file with no folder at all: a whole backup holds a great deal of
      // other JSON, which is left alone as it always was.
      if (seg(e.path).length === 1) {
        const loose = looseKind(name, e.read);
        if (loose) {
          if (loose.kind === "lorebook") plan.lorebooks.push({ name: name.replace(/\.json$/i, ""), entries: loose.entries });
          else if (loose.kind === "character") plan.characters.push({ file: name, card: loose.card, png: /\.png$/i.test(name) ? e.read : null });
          else if (loose.kind === "preset") plan.presets.push({ name: name.replace(/\.json$/i, ""), json: loose.json });
          else if (loose.kind === "chat") plan.chats.push({ character: loose.character, file: name, lines: loose.lines });
          else if (loose.kind === "picture") plan.avatars.set(name, e.read);
          continue;
        }
        if (/\.(json|jsonl|png)$/i.test(name)) plan.notes.push(`${name}: not something Hearth knows how to bring in here`);
      }
    } catch (err: any) {
      plan.notes.push(`${e.path}: ${err?.message ?? "unreadable"}`);
    }
  }

  if (settings) {
    const pu = settings.power_user ?? {};
    const names: Record<string, string> = pu.personas ?? settings.personas ?? {};
    const descs: Record<string, any> =
      pu.persona_descriptions ?? settings.persona_descriptions ?? {};
    const activeAvatar: string = settings.user_avatar ?? "";

    // SillyTavern often leaves several avatar entries pointing at one person.
    // Collapse only true duplicates — same name AND same description — so two
    // genuinely different characters who share a name both survive.
    const best = new Map<string, (typeof plan.personas)[number]>();
    for (const [avatarFile, pname] of Object.entries(names)) {
      if (typeof pname !== "string" || !pname.trim()) continue;
      const d = descs[avatarFile];
      const entry = {
        name: pname.trim(),
        description: typeof d === "string" ? d : d?.description ?? "",
        avatarFile: plan.avatars.has(avatarFile) ? avatarFile : null,
        active: avatarFile === activeAvatar,
      };
      const key = `${entry.name.toLowerCase()}\u0000${entry.description.trim().slice(0, 400)}`;
      const prev = best.get(key);
      const score = (e: typeof entry) => (e.active ? 4 : 0) + (e.avatarFile ? 2 : 0);
      if (!prev || score(entry) > score(prev)) best.set(key, entry);
    }
    plan.personas = [...best.values()];
  }

  return plan;
}
