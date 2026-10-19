/**
 * Upgrading a library: everything that was there is still there, a copy of
 * how it was sits beside it, and going back to the old Hearth still works.
 *
 *   bun test src/upgrade.test.ts
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "./test-support";
import { ALTER_TABLES, CREATE_CHAT_MEMBERS, CREATE_KITS, CREATE_SHARES, CREATE_TABLES } from "./schema";
import { SCHEMA_LEVEL, isSnapshot, migrationProblems, planOpen, readLevel, snapshotName } from "./upgrade";

const { openLibrary } = await import("./db");

const FIXTURE = await Bun.file(new URL("./fixtures/library-0.2.6.sql", import.meta.url)).text();

let n = 0;
/** A fresh folder of its own, so no test sees another's library. */
function folder(): string {
  const dir = join(tmpdir(), "hearth-upgrade-test", `${process.pid}-${n++}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A folder holding the frozen 0.2.6 library, as a person upgrading would have it. */
function oldLibrary(): string {
  const dir = folder();
  const d = new Database(join(dir, "hearth.db"), { create: true });
  d.exec(FIXTURE);
  d.close();
  return dir;
}

type Rows = Record<string, Record<string, unknown>[]>;

/** Every row of every table, in a stable order, keeping only the columns asked for. */
function rowsOf(d: Database, columns?: Record<string, string[]>): Rows {
  const out: Rows = {};
  const tables = (d.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]).map((r) => r.name);
  for (const t of tables) {
    if (columns && !columns[t]) continue;
    const keep = columns?.[t];
    out[t] = (d.query(`SELECT * FROM "${t}" ORDER BY rowid`).all() as Record<string, unknown>[])
      .map((r) => (keep ? Object.fromEntries(keep.map((c) => [c, r[c]])) : r));
  }
  return out;
}

function columnsOf(d: Database): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const { name } of d.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]) {
    out[name] = (d.query(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((c) => c.name).sort();
  }
  return out;
}

const levelOf = (d: Database) =>
  (d.query("SELECT value FROM settings WHERE key = 'schema_level'").get() as { value: string } | null)?.value;

describe("the migrations", () => {
  test("never drop, rename, rewrite or delete — so the old Hearth can still open the result", () => {
    expect(migrationProblems([CREATE_TABLES, CREATE_CHAT_MEMBERS, CREATE_SHARES, CREATE_KITS, ...ALTER_TABLES]))
      .toEqual([]);
  });

  test("the check catches each of those, and is not fooled by a comment", () => {
    expect(migrationProblems(["DROP TABLE chats"])).toHaveLength(1);
    expect(migrationProblems(["ALTER TABLE chats RENAME COLUMN title TO name"])).toHaveLength(1);
    expect(migrationProblems(["UPDATE chats SET title = ''"])).toHaveLength(1);
    expect(migrationProblems(["DELETE FROM messages"])).toHaveLength(1);
    expect(migrationProblems(["-- we used to DROP TABLE here and UPDATE chats SET things\nALTER TABLE chats ADD COLUMN x TEXT"]))
      .toEqual([]);
    expect(migrationProblems(["ALTER TABLE chats ADD COLUMN updated_at_v2 INTEGER"])).toEqual([]);
  });
});

describe("deciding what to do on opening", () => {
  test("a new library is marked and not copied; an old one is copied, then marked", () => {
    expect(planOpen(null)).toEqual({ snapshot: false, mark: true, newer: false });
    expect(planOpen(0, 1)).toEqual({ snapshot: true, mark: true, newer: false });
    expect(planOpen(1, 1)).toEqual({ snapshot: false, mark: false, newer: false });
  });

  test("a library from a newer Hearth is left exactly as it is", () => {
    expect(planOpen(5, 1)).toEqual({ snapshot: false, mark: false, newer: true });
  });

  test("an unreadable level is a library from before levels", () => {
    for (const v of [undefined, null, "", "x", "-3", "1.5"]) expect(readLevel(v)).toBe(0);
    expect(readLevel("4")).toBe(4);
  });
});

describe("opening a 0.2.6 library", () => {
  test("every row it had is still there, unchanged", () => {
    const dir = oldLibrary();
    const before = new Database(join(dir, "hearth.db"));
    const shape = columnsOf(before);
    const was = rowsOf(before);
    before.close();

    const d = openLibrary(dir);
    // Only the columns the old library had: a migration may add columns, never change one.
    const now = rowsOf(d, shape);
    // And one row it may add: the level itself.
    expect(now.settings.filter((r) => r.key === "schema_level")).toEqual([{ key: "schema_level", value: String(SCHEMA_LEVEL) }]);
    now.settings = now.settings.filter((r) => r.key !== "schema_level");
    expect(now).toEqual(was);
    d.close();
  });

  test("the library as it was is set aside first, whole", () => {
    const dir = oldLibrary();
    const before = new Database(join(dir, "hearth.db"));
    const was = rowsOf(before);
    before.close();

    openLibrary(dir).close();
    const kept = join(dir, snapshotName(SCHEMA_LEVEL));
    expect(existsSync(kept)).toBe(true);
    const copy = new Database(kept, { readonly: true });
    expect(rowsOf(copy)).toEqual(was);
    // The copy is the old library, so it has no level of its own.
    expect(levelOf(copy)).toBeUndefined();
    copy.close();
  });

  test("is marked with this level, and is not copied again next time", () => {
    const dir = oldLibrary();
    openLibrary(dir).close();
    const kept = join(dir, snapshotName(SCHEMA_LEVEL));
    const first = statSync(kept).mtimeMs;

    const d = openLibrary(dir);
    expect(levelOf(d)).toBe(String(SCHEMA_LEVEL));
    d.close();
    expect(statSync(kept).mtimeMs).toBe(first);
    expect(readdirSync(dir).filter(isSnapshot)).toEqual([snapshotName(SCHEMA_LEVEL)]);
  });

  test("ends up the same shape as a library made fresh", () => {
    const upgraded = openLibrary(oldLibrary());
    const fresh = openLibrary(folder());
    expect(columnsOf(upgraded)).toEqual(columnsOf(fresh));
    upgraded.close();
    fresh.close();
  });

  test("a branch that shares its parent's notes book is left sharing it", () => {
    // Splitting books people already have is offered per chat, never done to them.
    const d = openLibrary(oldLibrary());
    const books = d.query("SELECT id, auto_lore_book_id FROM chats ORDER BY id").all();
    expect(books).toEqual([
      { id: "chat-branch", auto_lore_book_id: "b-notes" },
      { id: "chat-main", auto_lore_book_id: "b-notes" },
    ]);
    d.close();
  });
});

describe("other libraries", () => {
  test("a brand-new one gets no copy, only a level", () => {
    const dir = folder();
    const d = openLibrary(dir);
    expect(levelOf(d)).toBe(String(SCHEMA_LEVEL));
    d.close();
    expect(readdirSync(dir).filter(isSnapshot)).toEqual([]);
  });

  test("one a newer Hearth left behind is not copied, and keeps its level", () => {
    const dir = oldLibrary();
    const raw = new Database(join(dir, "hearth.db"));
    raw.query("INSERT INTO settings (key, value) VALUES ('schema_level', '99')").run();
    raw.close();

    const d = openLibrary(dir);
    expect(levelOf(d)).toBe("99");
    d.close();
    expect(readdirSync(dir).filter(isSnapshot)).toEqual([]);
  });

  test("only the latest copy is kept", () => {
    const dir = oldLibrary();
    const stale = new Database(join(dir, snapshotName(0)), { create: true });
    stale.close();
    openLibrary(dir).close();
    expect(readdirSync(dir).filter(isSnapshot)).toEqual([snapshotName(SCHEMA_LEVEL)]);
  });
});
