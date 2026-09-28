/**
 * Getting a library back out of a damaged database file.
 *
 * sql.js holds the whole database in memory and the phone only ever sees it
 * as one file, rewritten wholesale on every flush. For a long time that
 * rewrite was a plain writeFileSync over the top of the only copy: truncate,
 * then write. Android kills backgrounded apps without warning, and a kill (or
 * a full disk) partway through leaves the head of a new file and none of its
 * tail. The next launch fails on its very first statement with "database disk
 * image is malformed", and the app will not open at all — with everything the
 * person has ever written sitting, mostly intact, in the file it refuses.
 *
 * Flushes are atomic now (see db.mobile.ts), so this should not happen again.
 * This file is for the copies it already happened to, and for whatever else
 * might one day do the same.
 *
 * "Mostly intact" is the important part. A truncated file is a correct file
 * with its last pages missing, and SQLite only fails when a query walks into
 * one. So rather than giving up on a table at its first bad page, each one is
 * read in rowid order, and when the read dies, the walk skips ahead until the
 * b-tree answers again — losing the rows that were on the missing pages, and
 * keeping every one that was not. sql.js has no `.recover`; this is the part
 * of it that matters here.
 *
 * Nothing here ever deletes anything. The damaged file is kept beside the
 * recovered one (db.mobile.ts sees to that before this runs), so a better tool
 * on a desktop can have another go at it later.
 */
import type { Database, SqlJsStatic } from "sql.js";

export type Diagnosis = { ok: true } | { ok: false; problem: string };

/**
 * Cheap checks on the raw bytes, before SQLite is asked anything.
 *
 * A truncated file is the case this exists for, and the header says exactly
 * how long the file should be — so it is caught here in constant time, even
 * when the missing pages are ones that a quick_check would happen to pass.
 */
export function inspectHeader(bytes: Uint8Array): Diagnosis {
  if (bytes.length === 0) return { ok: false, problem: "the file is empty" };
  const magic = "SQLite format 3\0";
  if (bytes.length < 100) return { ok: false, problem: `the file is only ${bytes.length} bytes long` };
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic.charCodeAt(i)) return { ok: false, problem: "the file does not start with a SQLite header" };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawSize = view.getUint16(16);
  const pageSize = rawSize === 1 ? 65536 : rawSize;
  const pages = view.getUint32(28);
  // The page count in the header is only trusted when the two change counters
  // agree; otherwise SQLite itself ignores it and goes by the file's length.
  const counted = view.getUint32(24) === view.getUint32(92);
  if (counted && pages > 0 && pageSize >= 512) {
    const expected = pages * pageSize;
    if (bytes.length < expected) {
      return { ok: false, problem: `the file is cut short: ${bytes.length} of ${expected} bytes` };
    }
  }
  return { ok: true };
}

/** SQLite's own opinion, for damage that is not a missing tail. */
export function quickCheck(db: Database): Diagnosis {
  try {
    const rows = db.exec("PRAGMA quick_check");
    const found = rows[0]?.values.map((r) => String(r[0])) ?? [];
    if (found.length === 1 && found[0] === "ok") return { ok: true };
    return { ok: false, problem: `quick_check: ${found.slice(0, 5).join("; ") || "no answer"}` };
  } catch (e) {
    return { ok: false, problem: `quick_check: ${(e as Error).message}` };
  }
}

export type TableResult = { table: string; rows: number; gaps: number; unreadable: number };
export type Recovery = {
  bytes: Uint8Array;
  fromDamaged: TableResult[];
  fromSnapshot: TableResult[];
  notes: string[];
};

/**
 * The file without a torn last page.
 *
 * A write cut off partway through a page leaves its head — the cell pointers
 * — and not its tail, which is where SQLite keeps the rows themselves. Read
 * back, the missing part is zeros, and SQLite hands over whatever the pointers
 * land on without complaint: a message that simply stops halfway through. A
 * page that is missing entirely is always noticed. So the torn page goes, and
 * what was on it is reported as lost rather than returned mangled.
 */
function wholePages(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 100) return bytes;
  const raw = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(16);
  const size = raw === 1 ? 65536 : raw;
  if (size < 512 || (size & (size - 1)) !== 0) return bytes;
  const whole = Math.floor(bytes.length / size) * size;
  return whole === bytes.length || whole === 0 ? bytes : bytes.subarray(0, whole);
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

function columnsOf(db: Database, table: string): string[] {
  const res = db.exec(`PRAGMA table_info(${q(table)})`);
  return (res[0]?.values ?? []).map((r) => String(r[1]));
}

/**
 * The first rowid above `x`, found by seeking rather than scanning. `ok` is
 * false when the seek itself runs into a page that is not there.
 */
function probe(db: Database, table: string, x: number): { ok: boolean; rowid: number | null } {
  const st = db.prepare(`SELECT rowid FROM ${q(table)} WHERE rowid > ? ORDER BY rowid LIMIT 1`);
  try {
    st.bind([x]);
    return { ok: true, rowid: st.step() ? Number(st.get()[0]) : null };
  } catch {
    return { ok: false, rowid: null };
  } finally {
    try { st.free(); } catch {}
  }
}

/**
 * Lowest rowid above a hole that the b-tree will still hand over, or null
 * when there is nothing readable past it. `after` is a point the caller has
 * already seen a seek fail from.
 *
 * A seek touches only the pages on the way down to one leaf, so it keeps
 * working past a missing leaf long after a scan has died on it. Doubling the
 * stride finds the far side of the hole quickly; bisecting back finds its
 * edge, so the rows lost are the ones that were actually on the missing pages
 * and no more.
 */
function nextReadable(db: Database, table: string, after: number): number | null {
  // Past the largest integer a double holds exactly, the search stops meaning
  // anything; a Hearth table is nowhere near it.
  const LIMIT = Number.MAX_SAFE_INTEGER;
  let bad = after;
  let stride = 1;
  let good: { x: number; rowid: number | null } | null = null;
  while (bad < LIMIT) {
    const x = Math.min(bad + stride, LIMIT);
    const p = probe(db, table, x);
    if (p.ok) { good = { x, rowid: p.rowid }; break; }
    bad = x;
    stride *= 2;
  }
  if (!good || good.rowid === null) return null;

  // `bad` fails and `good.x` answers; close the gap between them.
  let lo = bad;
  let hi = good.x;
  let hiRow = good.rowid;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const p = probe(db, table, mid);
    if (p.ok && p.rowid !== null) { hi = mid; hiRow = p.rowid; } else if (p.ok) break; else lo = mid;
  }
  return hiRow;
}

/**
 * Hands every row of `table` that can still be read to `onRow`, in rowid
 * order, and counts what had to be stepped over.
 *
 * The scan runs until it dies, then works out why. If the next rowid can
 * still be found by seeking, the page is fine and it is that one row that is
 * broken — most likely its overflow pages are gone — so it is left behind and
 * the scan carries on after it. If it cannot, a whole page is missing, and
 * nextReadable() finds where reading works again.
 */
function walk(
  src: Database,
  table: string,
  onRow: (names: string[], values: any[]) => void,
): { gaps: number; unreadable: number } {
  const out = { gaps: 0, unreadable: 0 };

  // A table without a rowid cannot be walked this way; take what a plain
  // scan gives before it fails, which for a table like that is the best on
  // offer. Hearth has none, but an extension might.
  let hasRowid = true;
  try { src.exec(`SELECT rowid FROM ${q(table)} LIMIT 0`); } catch { hasRowid = false; }
  if (!hasRowid) {
    const st = src.prepare(`SELECT * FROM ${q(table)}`);
    try {
      const names = st.getColumnNames();
      while (st.step()) onRow(names, st.get());
    } catch {
      out.gaps++;
    } finally {
      try { st.free(); } catch {}
    }
    return out;
  }

  let after = -Number.MAX_SAFE_INTEGER;
  // Each pass either finishes the table or moves `after` strictly forward,
  // so this ends; the cap is only there in case a damaged page lies about
  // its own contents in some way not thought of here.
  for (let pass = 0; pass < 1_000_000; pass++) {
    const st = src.prepare(`SELECT rowid AS "__hearth_rowid", * FROM ${q(table)} WHERE rowid > ? ORDER BY rowid`);
    let failed = false;
    try {
      st.bind([after]);
      const names = st.getColumnNames().slice(1);
      while (st.step()) {
        const v = st.get();
        after = Number(v[0]);
        onRow(names, v.slice(1));
      }
    } catch {
      failed = true;
    } finally {
      try { st.free(); } catch {}
    }
    if (!failed) break;

    const p = probe(src, table, after);
    if (p.ok) {
      if (p.rowid === null) break;
      out.unreadable++;
      after = p.rowid;
      continue;
    }
    out.gaps++;
    const next = nextReadable(src, table, after);
    if (next === null) break;
    after = next - 1;
  }
  return out;
}

/**
 * The ordinary tables in a database, with the SQL that made them — walked
 * like any other table, because the schema is a table too, and after years
 * of migrations rewriting it, its pages are as likely to be at the lost end
 * of a file as anything else's.
 */
function tablesOf(db: Database): { name: string; sql: string }[] {
  const out: { name: string; sql: string }[] = [];
  walk(db, "sqlite_master", (names, v) => {
    const row = Object.fromEntries(names.map((n, i) => [n, v[i]]));
    if (row.type !== "table" || String(row.name).startsWith("sqlite_")) return;
    out.push({ name: String(row.name), sql: String(row.sql ?? "") });
  });
  return out;
}

/**
 * Copies every row of `table` in `src` that can still be read into the same
 * table of `dst`, and says how many made it.
 *
 * Rows already in `dst` with the same key win — `INSERT OR IGNORE` — which is
 * what lets a second, older source fill in holes without undoing anything the
 * first one supplied.
 */
function copyTable(src: Database, dst: Database, table: string): TableResult {
  const wanted = new Set(columnsOf(dst, table));
  let rows = 0;
  let insert: ReturnType<Database["prepare"]> | null = null;
  let insertCols: string[] = [];
  try {
    const { gaps, unreadable } = walk(src, table, (names, values) => {
      if (!insert) {
        insertCols = names.filter((n) => wanted.has(n));
        if (!insertCols.length) return;
        insert = dst.prepare(
          `INSERT OR IGNORE INTO ${q(table)} (${insertCols.map(q).join(", ")}) VALUES (${insertCols.map(() => "?").join(", ")})`,
        );
      }
      insert.run(insertCols.map((c) => values[names.indexOf(c)]));
      if (dst.getRowsModified() > 0) rows++;
    });
    return { table, rows, gaps, unreadable };
  } finally {
    try { insert?.free(); } catch {}
  }
}

/**
 * Builds a fresh, healthy database out of whatever can still be read.
 *
 * `setup` creates Hearth's schema on the empty database first, so the result
 * is a normal, current library whatever state the damaged file's schema was
 * in. Then every readable row of the damaged file goes in, and after that the
 * last known-good snapshot, if there is one, fills in anything that was on a
 * lost page — it is older, so it only adds and never overwrites.
 */
export function recover(
  SQL: SqlJsStatic,
  damaged: Uint8Array | null,
  snapshot: Uint8Array | null,
  setup: (db: Database) => void,
): Recovery {
  const notes: string[] = [];
  const dst = new SQL.Database();
  setup(dst);
  // Rows arrive table by table, in whatever order the file had them, so a
  // message can land before its chat. Checking that is for afterwards.
  dst.run("PRAGMA foreign_keys = OFF;");

  const drain = (bytes: Uint8Array | null, label: string): TableResult[] => {
    if (!bytes || bytes.length === 0) return [];
    let src: Database;
    try {
      src = new SQL.Database(bytes);
      /*
       * Without this, a file whose schema has lost a page cannot be asked
       * anything at all — every statement loads the schema first and fails
       * with it, which is exactly the error the phone showed. With it, SQLite
       * carries on with as much of the schema as it could read. The database
       * is sql.js's in-memory copy, so nothing here can reach the file.
       */
      src.run("PRAGMA writable_schema = ON;");
    } catch (e) {
      notes.push(`${label}: could not be opened at all (${(e as Error).message})`);
      return [];
    }
    try {
      let tables: { name: string; sql: string }[];
      try {
        tables = tablesOf(src);
      } catch (e) {
        notes.push(`${label}: its list of tables is unreadable (${(e as Error).message})`);
        return [];
      }
      const have = new Set(tablesOf(dst).map((t) => t.name));
      const out: TableResult[] = [];
      dst.run("BEGIN");
      for (const t of tables) {
        if (!have.has(t.name)) {
          // Not one of Hearth's — something an extension or an older version
          // made. Keep it as it was rather than dropping it on the floor.
          try { dst.run(t.sql); have.add(t.name); }
          catch (e) { notes.push(`${label}: table ${t.name} could not be recreated (${(e as Error).message})`); continue; }
        }
        try { out.push(copyTable(src, dst, t.name)); }
        catch (e) { notes.push(`${label}: table ${t.name} failed (${(e as Error).message})`); }
      }
      dst.run("COMMIT");
      return out;
    } finally {
      try { src.close(); } catch {}
    }
  };

  const fromDamaged = drain(damaged && wholePages(damaged), "damaged file");
  const fromSnapshot = drain(snapshot, "snapshot");

  // Rows whose parent was on a lost page are kept, not deleted: they are
  // invisible until something points at them again, and harmless meanwhile,
  // and the alternative is throwing away someone's writing on a technicality.
  try {
    const orphans = dst.exec("PRAGMA foreign_key_check")[0]?.values.length ?? 0;
    if (orphans) notes.push(`${orphans} row(s) point at something that could not be recovered; they were kept`);
  } catch {}
  dst.run("PRAGMA foreign_keys = ON;");

  const bytes = dst.export();
  dst.close();
  return { bytes, fromDamaged, fromSnapshot, notes };
}

/** A plain-text account of what happened, for the file left beside the data. */
export function describe(r: Recovery, problem: string, keptAs: string): string {
  const line = (t: TableResult) =>
    `  ${t.table}: ${t.rows} row(s)` +
    (t.gaps ? `, ${t.gaps} damaged stretch(es) skipped` : "") +
    (t.unreadable ? `, ${t.unreadable} unreadable row(s) left behind` : "");
  const out = [
    "Hearth found its database damaged and rebuilt it.",
    "",
    `What was wrong: ${problem}`,
    `The damaged file was kept, untouched, as: ${keptAs}`,
    "",
    "Recovered from the damaged file:",
    ...(r.fromDamaged.length ? r.fromDamaged.map(line) : ["  nothing"]),
  ];
  if (r.fromSnapshot.length) {
    out.push("", "Filled in from the last known-good copy (rows the damaged file had lost):");
    out.push(...r.fromSnapshot.filter((t) => t.rows).map(line));
    if (!r.fromSnapshot.some((t) => t.rows)) out.push("  nothing was missing");
  }
  if (r.notes.length) out.push("", "Notes:", ...r.notes.map((n) => `  ${n}`));
  return out.join("\n") + "\n";
}

/** One paragraph of the same, for the notice the app shows on its next start. */
export function summarise(r: Recovery, problem: string, keptAs: string): string {
  const sum = (ts: TableResult[], key: "rows" | "gaps" | "unreadable") => ts.reduce((n, t) => n + t[key], 0);
  const got = sum(r.fromDamaged, "rows");
  const filled = sum(r.fromSnapshot, "rows");
  const holes = sum(r.fromDamaged, "gaps") + sum(r.fromDamaged, "unreadable");
  const parts = [
    `Hearth's database file was damaged (${problem}), so it was rebuilt from what could still be read:`,
    `${got} record(s) recovered`,
  ];
  let text = parts.join(" ");
  if (filled) text += `, and ${filled} more put back from the last known-good copy`;
  text += ".";
  text += holes
    ? " Some pages of the file were missing, so the most recent changes may not all be here."
    : " Nothing looked lost.";
  text += ` The damaged file has been kept, untouched, as ${keptAs}, and a full report is beside it.`;
  return text;
}
