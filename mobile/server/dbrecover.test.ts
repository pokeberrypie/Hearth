/**
 * Damaging a real Hearth library in the ways a phone can, and checking what
 * comes back.
 *
 * sql.js lives in mobile/node_modules, which only exists after `npm install`
 * in mobile/ — so without it these skip rather than fail the desktop suite.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALTER_TABLES, CREATE_CHAT_MEMBERS, CREATE_KITS, CREATE_SHARES, CREATE_TABLES } from "../../src/schema";

const modules = join(import.meta.dir, "..", "node_modules", "sql.js");
const have = existsSync(modules);
const WASM = join(modules, "dist", "sql-wasm.wasm");

const loadSql = async () => {
  const init = (await import("sql.js")).default;
  return init({ locateFile: () => WASM });
};

function setup(d: any) {
  d.run("PRAGMA foreign_keys = ON;");
  d.run(CREATE_TABLES);
  for (const s of ALTER_TABLES) { try { d.run(s); } catch {} }
  d.run(CREATE_CHAT_MEMBERS);
  d.run(CREATE_SHARES);
  d.run(CREATE_KITS);
}

const MESSAGES = 4000;
/** Every tenth message is long enough to spill onto overflow pages. */
const body = (i: number) => (i % 10 === 0 ? "a long evening. ".repeat(600) : "hello there. ".repeat(20)) + `#${i}`;

async function library() {
  const SQL = await loadSql();
  const d = new SQL.Database();
  setup(d);
  d.run("INSERT INTO settings (key, value) VALUES ('model', 'kept-model')");
  d.run("INSERT INTO characters (id, name, created_at) VALUES ('c1', 'Wren', 1)");
  d.run("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch1', 'c1', 'By the fire', 1, 1)");
  d.run("BEGIN");
  for (let i = 0; i < MESSAGES; i++) {
    d.run("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, 'ch1', 'user', ?, ?)", [`m${i}`, body(i), i]);
  }
  d.run("COMMIT");
  const bytes = d.export();
  d.close();
  return { SQL, bytes };
}

const messagesIn = (SQL: any, bytes: Uint8Array) => {
  const d = new SQL.Database(bytes);
  const rows = d.exec("SELECT id, content FROM messages")[0]?.values ?? [];
  const check = d.exec("PRAGMA integrity_check")[0].values[0][0];
  d.close();
  return { rows: rows as [string, string][], check };
};

describe.skipIf(!have)("recovering a damaged database", () => {
  test("the header gives a truncated file away, and passes a whole one", async () => {
    const { inspectHeader } = await import("./dbrecover");
    const { bytes } = await library();
    expect(inspectHeader(bytes).ok).toBe(true);
    const cut = inspectHeader(bytes.slice(0, Math.floor(bytes.length / 2)));
    expect(cut.ok).toBe(false);
    expect(!cut.ok && cut.problem).toContain("cut short");
    expect(inspectHeader(new Uint8Array(0)).ok).toBe(false);
  });

  test("a file cut off mid-write gives back everything before the cut, intact", async () => {
    const { recover } = await import("./dbrecover");
    const { SQL, bytes } = await library();

    for (const frac of [0.9, 0.6, 0.3]) {
      const cut = bytes.slice(0, Math.floor(bytes.length * frac) + 777);
      // This is the failure on the phone, reproduced.
      const broken = new SQL.Database(cut);
      expect(() => broken.run(CREATE_TABLES)).toThrow(/malformed/);
      broken.close();

      const r = recover(SQL, cut, null, setup);
      const { rows, check } = messagesIn(SQL, r.bytes);
      expect(check).toBe("ok");
      // Roughly the share of the file that survived, give or take the pages
      // that were not message pages.
      expect(rows.length).toBeGreaterThan(MESSAGES * frac * 0.5);
      // Nothing that came back is garbled.
      for (const [id, content] of rows) expect(content).toBe(body(Number(id.slice(1))));
      // The small tables at the front of the file are always whole.
      const d = new SQL.Database(r.bytes);
      expect(d.exec("SELECT value FROM settings WHERE key = 'model'")[0].values[0][0]).toBe("kept-model");
      expect(d.exec("SELECT name FROM characters")[0].values[0][0]).toBe("Wren");
      d.close();
    }
  });

  test("a hole in the middle skips the missing pages and keeps reading past them", async () => {
    const { recover } = await import("./dbrecover");
    const { SQL, bytes } = await library();
    const pageSize = new DataView(bytes.buffer).getUint16(16);
    const holed = bytes.slice();
    // Zero a run of pages well inside the messages table.
    const from = Math.floor(holed.length / pageSize / 2) * pageSize;
    holed.fill(0, from, from + pageSize * 8);

    const r = recover(SQL, holed, null, setup);
    const { rows, check } = messagesIn(SQL, r.bytes);
    expect(check).toBe("ok");
    const got = new Set(rows.map(([id]) => Number(id.slice(1))));
    // The last message is well past the hole; a reader that stopped at the
    // first bad page would never reach it.
    expect(got.has(MESSAGES - 1)).toBe(true);
    expect(got.has(0)).toBe(true);
    expect(rows.length).toBeGreaterThan(MESSAGES * 0.8);
    expect(r.fromDamaged.find((t) => t.table === "messages")!.gaps + r.fromDamaged.find((t) => t.table === "messages")!.unreadable).toBeGreaterThan(0);
  });

  test("the last known-good copy fills in what the damaged file lost, and overrides nothing", async () => {
    const { recover } = await import("./dbrecover");
    const { SQL, bytes } = await library();
    // The snapshot is older: the model setting was since changed.
    const old = new SQL.Database(bytes);
    old.run("UPDATE settings SET value = 'old-model' WHERE key = 'model'");
    const snapshot = old.export();
    old.close();

    const cut = bytes.slice(0, Math.floor(bytes.length * 0.4));
    const r = recover(SQL, cut, snapshot, setup);
    const { rows, check } = messagesIn(SQL, r.bytes);
    expect(check).toBe("ok");
    expect(rows.length).toBe(MESSAGES);
    const d = new SQL.Database(r.bytes);
    expect(d.exec("SELECT value FROM settings WHERE key = 'model'")[0].values[0][0]).toBe("kept-model");
    d.close();
  });
});

describe.skipIf(!have)("opening the database on the phone", () => {
  test("a damaged file is kept aside, rebuilt, reported, and flushed atomically after", async () => {
    const { SQL, bytes } = await library();
    const dir = mkdtempSync(join(tmpdir(), "hearth-recover-"));
    const cut = bytes.slice(0, Math.floor(bytes.length * 0.7));
    writeFileSync(join(dir, "hearth.db"), cut);

    process.env.DATA_DIR = dir;
    process.env.HEARTH_SQLJS_WASM = WASM;
    const mobile = await import("./db.mobile");
    await mobile.dbReady;

    const files = readdirSync(dir);
    const kept = files.find((f) => f.startsWith("hearth.db.damaged-"))!;
    expect(kept).toBeDefined();
    // Byte for byte what was there.
    expect(Buffer.from(readFileSync(join(dir, kept))).equals(Buffer.from(cut))).toBe(true);
    expect(files.some((f) => /^recovery-.*\.txt$/.test(f))).toBe(true);
    expect(mobile.lastRecovery).toContain("cut short");

    // The rebuilt file on disk opens clean, and the app says so once.
    const onDisk = new SQL.Database(readFileSync(join(dir, "hearth.db")));
    expect(onDisk.exec("PRAGMA integrity_check")[0].values[0][0]).toBe("ok");
    onDisk.close();
    expect(mobile.getSetting("recovery_notice")).toContain("rebuilt");
    expect(mobile.getSetting("model")).toBe("kept-model");

    // Writes still land, through the atomic path.
    mobile.setSettings({ model: "after" });
    mobile.flush();
    expect(files.includes("hearth.db.tmp")).toBe(false);
    const again = new SQL.Database(readFileSync(join(dir, "hearth.db")));
    expect(again.exec("SELECT value FROM settings WHERE key = 'model'")[0].values[0][0]).toBe("after");
    again.close();
  });
});
