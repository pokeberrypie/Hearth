/**
 * The Android drop-in for `src/db.ts`.
 *
 * `bun:sqlite` does not exist under Node, and nodejs-mobile's Node build has
 * no native-module toolchain worth trusting sight-unseen on a phone this
 * session cannot test on — so this uses `sql.js` (SQLite compiled to WASM)
 * instead of a native binding. Everything else about the database — the
 * schema, the migrations, the settings table — comes from `../../src/schema`,
 * the same file `src/db.ts` reads, so the two engines can never quietly drift
 * onto different tables. A backup exported from one platform is a plain
 * SQLite file either platform can open.
 *
 * The Statement/Database shape below reproduces exactly the slice of
 * `bun:sqlite`'s API that `src/index.ts` and friends actually call —
 * `db.query(sql).all/get/run(...params)`, `db.exec(sql)`,
 * `db.transaction(fn)` — so none of that code needed to change to run here.
 * See mobile/README.md for how this file gets wired in at bundle time.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { ALTER_TABLES, CREATE_CHAT_MEMBERS, CREATE_SHARES, CREATE_TABLES, DEFAULTS, KEY_FIELDS } from "../../src/schema";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = join(DATA_DIR, "hearth.db");

// sql.js needs its own WASM file located. The whole server, this file
// included, is bundled into one `main.js` (see mobile/build.mjs), so
// `__dirname` here is that bundle's own directory — the same place
// build.mjs copies `sql-wasm.wasm` to, right beside it.
const wasmPath = process.env.HEARTH_SQLJS_WASM ?? join(__dirname, "sql-wasm.wasm");

let sqldb: SqlJsDatabase;
let ready: Promise<void>;

function load() {
  ready = initSqlJs({ locateFile: () => wasmPath }).then((SQL) => {
    const existing = existsSync(DB_PATH) ? readFileSync(DB_PATH) : undefined;
    sqldb = new SQL.Database(existing);
    sqldb.run("PRAGMA foreign_keys = ON;");
    sqldb.run(CREATE_TABLES);
    for (const stmt of ALTER_TABLES) {
      try { sqldb.run(stmt); } catch {}
    }
    sqldb.run(CREATE_CHAT_MEMBERS);
    sqldb.run(CREATE_SHARES);
  });
}
load();

/**
 * Every route in `src/index.ts` calls the database synchronously — that is
 * how `bun:sqlite` works, and rewriting every call site to `await` would mean
 * rewriting most of the file. `initSqlJs()` is the one genuinely async step
 * (compiling the WASM module), so `serve.mobile.ts` awaits `dbReady` once,
 * before the Hono app is ever asked to handle a request. Nothing after that
 * point needs to be async on this account.
 */
export const dbReady = ready;

// ---- disk persistence -------------------------------------------------

// sql.js keeps the whole database in memory; nothing reaches the phone's
// storage until this runs. Writing after every single INSERT would mean
// re-serializing the entire database on every keystroke-adjacent action, so
// writes are coalesced into one flush shortly after the last mutation —
// except `flush()` itself, which is synchronous and unconditional, and is
// what the app's pause/background handler and shutdown path call.
let pending: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush() {
  if (pending) clearTimeout(pending);
  pending = setTimeout(flush, 400);
}
export function flush() {
  if (pending) { clearTimeout(pending); pending = null; }
  if (!sqldb) return;
  writeFileSync(DB_PATH, Buffer.from(sqldb.export()));
}

// ---- bun:sqlite-shaped surface ------------------------------------------

class Stmt {
  constructor(private sql: string) {}

  all(...params: any[]): any[] {
    const stmt = sqldb.prepare(this.sql);
    try {
      if (params.length) stmt.bind(params as any);
      const rows: any[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(...params: any[]): any {
    const stmt = sqldb.prepare(this.sql);
    try {
      if (params.length) stmt.bind(params as any);
      return stmt.step() ? stmt.getAsObject() : undefined;
    } finally {
      stmt.free();
    }
  }

  run(...params: any[]): { changes: number; lastInsertRowid: number } {
    sqldb.run(this.sql, params.length ? (params as any) : undefined);
    scheduleFlush();
    return { changes: sqldb.getRowsModified(), lastInsertRowid: 0 };
  }
}

class DB {
  query(sql: string) { return new Stmt(sql); }

  exec(sql: string) {
    sqldb.run(sql);
    scheduleFlush();
  }

  /** Mirrors `bun:sqlite`'s `Database.transaction`: wrap, then call the
   *  returned function with whatever arguments the caller supplies. */
  transaction<A extends any[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A) => {
      sqldb.run("BEGIN");
      try {
        const result = fn(...args);
        sqldb.run("COMMIT");
        scheduleFlush();
        return result;
      } catch (err) {
        try { sqldb.run("ROLLBACK"); } catch {}
        throw err;
      }
    };
  }

  close() {
    flush();
  }
}

export const db = new DB();

export const now = () => Date.now();
export const uid = () => randomUUID();

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
