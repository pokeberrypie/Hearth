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
import {
  closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync,
  unlinkSync, writeFileSync, writeSync,
} from "node:fs";
import { join } from "node:path";
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from "sql.js";
import { ALTER_TABLES, CREATE_CHAT_MEMBERS, CREATE_KITS, CREATE_SHARES, CREATE_TABLES, DEFAULTS, KEY_FIELDS } from "../../src/schema";
import { copyAll, describe, inspectHeader, quickCheck, recover, summarise } from "./dbrecover";

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

/**
 * Whether `sqldb` is something that may be written over the file on disk.
 *
 * Only true once the database has opened and passed its checks. Before that
 * — or when opening failed — a flush would be writing a half-loaded or
 * damaged image over the one copy of someone's library, and the exit handler
 * in serve.mobile.ts runs flush() on every way out, failed starts included.
 */
let healthy = false;

/** What this start-up rebuilt, if it rebuilt anything; null otherwise. */
export let lastRecovery: string | null = null;

/**
 * Hearth's schema and migrations, the same ones src/db.ts runs — and in the
 * same order: every CREATE, then the migrations. An ALTER against a table
 * that does not exist yet throws, the throw is swallowed on purpose because
 * that is how "already applied" is detected, and the column is then missing
 * for good on every fresh install. The desktop hit this with `shares`.
 */
export function setup(d: SqlJsDatabase) {
  d.run("PRAGMA foreign_keys = ON;");
  d.run(CREATE_TABLES);
  d.run(CREATE_CHAT_MEMBERS);
  d.run(CREATE_SHARES);
  d.run(CREATE_KITS);
  for (const stmt of ALTER_TABLES) {
    try { d.run(stmt); } catch {}
  }
}

/**
 * The last copy of the database known to be whole, refreshed now and then
 * from a flush. It is what fills in anything a damaged file has lost, and it
 * is never written over by anything that has not just passed its checks.
 */
const GOOD_PATH = join(DATA_DIR, "hearth.db.good");
const GOOD_EVERY_MS = 6 * 60 * 60 * 1000;

/** `2026-09-28-14-05-09`, for names that sort in the order they happened. */
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

/**
 * Replaces `path` with `bytes` so that, at every instant, the file on disk is
 * either entirely the old one or entirely the new one.
 *
 * writeFileSync on the real path truncates it first and then writes, and a
 * process killed in between — which Android does to backgrounded apps
 * without asking — leaves the head of the new file and nothing else. That is
 * the "database disk image is malformed" this whole file now guards against.
 * Written beside it, synced, then renamed over it, there is no such moment.
 */
function writeAtomic(path: string, bytes: Uint8Array) {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    let off = 0;
    while (off < bytes.length) off += writeSync(fd, bytes, off, bytes.length - off);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  // The rename itself lives in the directory; sync that too where allowed.
  try { const d = openSync(DATA_DIR, "r"); try { fsyncSync(d); } finally { closeSync(d); } } catch {}
}

function refreshGood(bytes: Uint8Array) {
  try { writeAtomic(GOOD_PATH, bytes); } catch (e) { console.error("Could not refresh hearth.db.good:", e); }
}

/**
 * Opens the database on disk, and when it is damaged, gets the library back
 * out of it rather than refusing to start.
 *
 * In order, and the order is the point: the damaged file is copied aside
 * first, and if that copy cannot be made nothing else happens — the app
 * reports the failure and the original is left exactly as it was. Only once
 * a copy exists does the rebuilt database take its place.
 */
function open(SQL: SqlJsStatic): SqlJsDatabase {
  // A flush that died before its rename leaves this behind; it is, by
  // construction, never the only copy of anything.
  try { unlinkSync(`${DB_PATH}.tmp`); } catch {}

  if (!existsSync(DB_PATH)) {
    const fresh = new SQL.Database();
    setup(fresh);
    return fresh;
  }

  const bytes = readFileSync(DB_PATH);
  let problem: string | null = null;
  const header = inspectHeader(bytes);
  if (!header.ok) problem = header.problem;

  if (!problem) {
    let d: SqlJsDatabase | null = null;
    try {
      d = new SQL.Database(bytes);
      const check = quickCheck(d);
      if (!check.ok) problem = check.problem;
      else {
        setup(d);
        // Whole, and has just proved it: this is what a snapshot is for.
        if (!existsSync(GOOD_PATH) || Date.now() - statSync(GOOD_PATH).mtimeMs > GOOD_EVERY_MS) refreshGood(bytes);
        return d;
      }
    } catch (e) {
      problem = (e as Error).message;
    }
    try { d?.close(); } catch {}
  }

  const when = stamp();
  const keptAs = `hearth.db.damaged-${when}`;
  // The one step allowed to stop everything. Without this copy, the next
  // line would be rewriting the only evidence of what was there.
  copyFileSync(DB_PATH, join(DATA_DIR, keptAs));

  // The build that first repaired a phone kept its once-a-launch copy as
  // hearth.db.prev. A phone updated from it has that and no .good yet.
  const PREV_PATH = join(DATA_DIR, "hearth.db.prev");
  const snapshot = existsSync(GOOD_PATH) ? readFileSync(GOOD_PATH)
    : existsSync(PREV_PATH) ? readFileSync(PREV_PATH) : null;
  const result = recover(SQL, bytes, snapshot, setup);
  const report = describe(result, problem, keptAs);
  console.error(report);
  try { writeFileSync(join(DATA_DIR, `recovery-${when}.txt`), report); } catch {}
  lastRecovery = report;

  writeAtomic(DB_PATH, result.bytes);
  const recovered = new SQL.Database(result.bytes);
  recovered.run("PRAGMA foreign_keys = ON;");
  // Said once, on the next screen the person sees; public/app.js clears it.
  recovered.run(
    "INSERT INTO settings (key, value) VALUES ('recovery_notice', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [summarise(result, problem, keptAs)],
  );
  return recovered;
}

let sqlModule: SqlJsStatic;

function load() {
  ready = initSqlJs({ locateFile: () => wasmPath }).then((SQL) => {
    sqlModule = SQL;
    sqldb = open(SQL);
    healthy = true;
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
let lastGood = Date.now();
function scheduleFlush() {
  if (pending) clearTimeout(pending);
  pending = setTimeout(flush, 400);
}
export function flush() {
  if (pending) { clearTimeout(pending); pending = null; }
  if (!sqldb || !healthy) return;
  const bytes = sqldb.export();
  writeAtomic(DB_PATH, bytes);
  // An image straight out of memory is whole by construction, so it can
  // stand as the known-good copy — just not on every flush, which would
  // double the writing for no gain.
  if (Date.now() - lastGood > GOOD_EVERY_MS) { lastGood = Date.now(); refreshGood(bytes); }
}

/**
 * Brings a whole Hearth database — a restored backup's — into this one. Same
 * contract as src/db.ts: the backup's rows win where both have the same key,
 * and the answer is how many rows each table took.
 *
 * Read with the same walker that rescues damaged files, so a backup with a
 * bad page still gives up everything else rather than nothing.
 */
export function mergeDatabase(bytes: Uint8Array): { counts: Record<string, number>; notes: string[] } {
  const notes: string[] = [];
  sqldb.run("PRAGMA foreign_keys = OFF;");
  let results;
  try {
    results = copyAll(sqlModule, bytes, sqldb, "backup", notes, "REPLACE");
  } finally {
    sqldb.run("PRAGMA foreign_keys = ON;");
  }
  flush();
  const counts: Record<string, number> = {};
  for (const r of results) {
    counts[r.table] = r.rows;
    if (r.gaps || r.unreadable) notes.push(`${r.table}: some rows in the backup could not be read`);
  }
  return { counts, notes };
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
