import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ALTER_TABLES, CREATE_CHAT_MEMBERS, CREATE_KITS, CREATE_SHARES, CREATE_TABLES, DEFAULTS, KEY_FIELDS } from "./schema";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, "hearth.db"), { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(CREATE_TABLES);
db.exec(CREATE_CHAT_MEMBERS);
db.exec(CREATE_SHARES);
db.exec(CREATE_KITS);

/*
 * Additive migrations. Safe to run repeatedly — each is ignored once applied.
 *
 * After every CREATE, and that ordering is load-bearing. These used to run
 * between the first CREATE and the rest, which worked for years because every
 * migration happened to touch a table in that first batch. The first one that
 * did not — a column on `shares` — failed on a fresh install, where the table
 * did not exist yet, and the failure is swallowed on purpose because that is
 * how "already applied" is detected. So the column was simply missing, on new
 * copies only, with nothing said. Upgrades were fine, which is the worst
 * version of this: it works everywhere it is tested and is broken for
 * everybody arriving for the first time.
 */
for (const stmt of ALTER_TABLES) {
  try { db.exec(stmt); } catch {}
}

export const now = () => Date.now();
export const uid = () => crypto.randomUUID();

// ---- settings -------------------------------------------------------------

export { KEY_FIELDS };

export function getSetting(key: string): string {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? DEFAULTS[key] ?? "";
}

export function getSettings(): Record<string, string> {
  const out = { ...DEFAULTS };
  const rows = db.query("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setSettings(patch: Record<string, string>) {
  const stmt = db.query(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const tx = db.transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) stmt.run(k, v);
  });
  tx(Object.entries(patch).map(([k, v]) => [k, String(v)]));
}

// ---- restoring a backup ---------------------------------------------------

/**
 * Brings a whole Hearth database — a restored backup's — into this one.
 *
 * The backup's rows win where both have the same key: restoring is moving a
 * library in, and the copy being moved is the one that counts. Rows only this
 * copy has are left alone, so nothing here is ever lost to a restore. Columns
 * are matched by name, which lets a backup from an older Hearth come in under
 * a newer schema — whatever it lacks takes its default.
 *
 * mobile/server/db.mobile.ts has the same function for the phone's engine.
 */
export function mergeDatabase(bytes: Uint8Array): { counts: Record<string, number>; notes: string[] } {
  const notes: string[] = [];
  const counts: Record<string, number> = {};
  const tmp = join(DATA_DIR, `restore-${crypto.randomUUID()}.db`);
  writeFileSync(tmp, bytes);
  const q = (n: string) => `"${n.replace(/"/g, '""')}"`;
  // Off for the copy: rows arrive table by table, so a message can come in
  // before its chat. It cannot be changed inside a transaction, hence here.
  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    db.query("ATTACH DATABASE ? AS restore").run(tmp);
    try {
      const check = db.query("PRAGMA restore.quick_check").get() as Record<string, string> | undefined;
      const verdict = check ? Object.values(check)[0] : "no answer";
      if (verdict !== "ok") throw new Error(`That backup's database is damaged (${verdict}).`);

      const mine = new Set((db.query("SELECT name FROM main.sqlite_master WHERE type = 'table'").all() as
        { name: string }[]).map((r) => r.name));
      const theirs = db.query(
        "SELECT name, sql FROM restore.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      ).all() as { name: string; sql: string }[];
      const cols = (schema: string, t: string) =>
        (db.query(`PRAGMA ${schema}.table_info(${q(t)})`).all() as { name: string }[]).map((r) => r.name);

      db.transaction(() => {
        for (const t of theirs) {
          if (!mine.has(t.name)) {
            // Not one of Hearth's: keep it as it was rather than drop it.
            try { db.exec(t.sql); } catch (e) { notes.push(`${t.name}: could not be recreated`); continue; }
          }
          const here = new Set(cols("main", t.name));
          const shared = cols("restore", t.name).filter((c) => here.has(c)).map(q).join(", ");
          if (!shared) continue;
          const r = db.query(
            `INSERT OR REPLACE INTO main.${q(t.name)} (${shared}) SELECT ${shared} FROM restore.${q(t.name)}`,
          ).run();
          counts[t.name] = r.changes;
        }
      })();
    } finally {
      db.exec("DETACH DATABASE restore");
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
    try { rmSync(tmp, { force: true }); } catch {}
  }
  return { counts, notes };
}
