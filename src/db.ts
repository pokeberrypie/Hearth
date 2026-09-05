import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ALTER_TABLES, CREATE_CHAT_MEMBERS, CREATE_SHARES, CREATE_TABLES, DEFAULTS, KEY_FIELDS } from "./schema";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, "hearth.db"), { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(CREATE_TABLES);

// Additive migrations. Safe to run repeatedly — each is ignored once applied.
for (const stmt of ALTER_TABLES) {
  try { db.exec(stmt); } catch {}
}

db.exec(CREATE_CHAT_MEMBERS);
db.exec(CREATE_SHARES);

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
