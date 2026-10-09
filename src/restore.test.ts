/**
 * Hearth can read its own backups.
 *
 * It could always write one — /backup/export zips hearth.db and the uploads
 * folder — but the only importer understood SillyTavern's layout, so feeding
 * the zip back in found nothing. Export, reinstall, import is the obvious way
 * to move a library, and on a phone whose installed copy was signed with a
 * key that no longer exists it is the only way: and it would have restored an
 * empty library after the old one had already been uninstalled.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync } from "fflate";

import { db, wipe, setSettings, getSettings, TEST_DIR } from "./test-support";
import { STARTER } from "./starter";

const { app, ensureStarterCharacter } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`http://home.test${path}`, init), HOME);

const PICTURE = join(TEST_DIR, "uploads", "restore-test-portrait.png");

/** A small but real library: a character, a chat with a reply, a setting, a picture. */
function seed() {
  wipe();
  ensureStarterCharacter();
  const t = Date.now();
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('wren', 'Wren', ?)").run(t);
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('evening', 'wren', 'By the fire', ?, ?)")
    .run(t, t);
  db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES ('m1', 'evening', 'user', 'Is the kettle on?', ?)").run(t);
  db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES ('m2', 'evening', 'assistant', 'Always.', ?)").run(t + 1);
  setSettings({ model: "restored-model" });
  mkdirSync(dirname(PICTURE), { recursive: true });
  writeFileSync(PICTURE, "not really a png");
}

/** What a fresh install looks like: nothing but its own narrator. */
function freshInstall() {
  wipe();
  rmSync(PICTURE, { force: true });
  ensureStarterCharacter();
}

/** Reads the import's event stream through to its last word. */
async function finish(res: Response) {
  const text = await res.text();
  const events = text.split("\n\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)));
  const err = events.find((e) => e.error);
  if (err) throw new Error(err.error);
  return events.find((e) => e.finished);
}

function expectRestored(result: any) {
  expect(result).toBeDefined();
  expect(result.reload).toBe(true);
  expect(result.count.chats).toBe(1);
  expect(result.count.messages).toBe(2);
  expect(result.count.pictures).toBeGreaterThanOrEqual(1);

  const msgs = db.query("SELECT content FROM messages WHERE chat_id = 'evening' ORDER BY created_at").all() as any[];
  expect(msgs.map((m) => m.content)).toEqual(["Is the kettle on?", "Always."]);
  expect((db.query("SELECT name FROM characters WHERE id = 'wren'").get() as any).name).toBe("Wren");
  expect(getSettings().model).toBe("restored-model");
  expect(readFileSync(PICTURE, "utf8")).toBe("not really a png");
  // The fresh install's narrator went; the backup's stayed. One, not two.
  expect((db.query("SELECT COUNT(*) AS n FROM characters WHERE name = ?").get(STARTER.name) as any).n).toBe(1);
}

describe("restoring a Hearth backup", () => {
  test("an exported zip, uploaded, brings the whole library back", async () => {
    seed();
    const zip = new Uint8Array(await (await ask("/api/backup/export")).arrayBuffer());
    freshInstall();
    expect(db.query("SELECT id FROM chats").all().length).toBe(0);

    const fd = new FormData();
    fd.append("file", new File([zip], "hearth-backup.zip"));
    expectRestored(await finish(await ask("/api/import/backup", { method: "POST", body: fd })));
  });

  test("the same backup unpacked to a folder, the way the phone sends it", async () => {
    seed();
    const zip = new Uint8Array(await (await ask("/api/backup/export")).arrayBuffer());
    const folder = join(tmpdir(), `hearth-restore-${crypto.randomUUID()}`);
    for (const [name, bytes] of Object.entries(unzipSync(zip))) {
      if (name.endsWith("/")) continue;
      mkdirSync(dirname(join(folder, name)), { recursive: true });
      writeFileSync(join(folder, name), bytes);
    }
    freshInstall();

    const fd = new FormData();
    fd.append("localPath", folder);
    expectRestored(await finish(await ask("/api/import/backup", { method: "POST", body: fd })));
    rmSync(folder, { recursive: true, force: true });
  });

  test("rows only this copy has are left alone", async () => {
    seed();
    const zip = new Uint8Array(await (await ask("/api/backup/export")).arrayBuffer());
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('newcomer', 'Newcomer', 1)").run();

    const fd = new FormData();
    fd.append("file", new File([zip], "hearth-backup.zip"));
    await finish(await ask("/api/import/backup", { method: "POST", body: fd }));
    expect(db.query("SELECT id FROM characters WHERE id = 'newcomer'").get()).toBeTruthy();
    expect(db.query("SELECT id FROM characters WHERE id = 'wren'").get()).toBeTruthy();
  });

  test("the archive filter keeps a Hearth backup's files", async () => {
    const { isWanted } = await import("./localfs");
    expect(isWanted("hearth.db")).toBe(true);
    expect(isWanted("uploads/abc.png")).toBe(true);
    expect(isWanted("uploads/wallpapers/hall.jpg")).toBe(true);
    // Only at the root: a SillyTavern tree's own folders are not Hearth's.
    expect(isWanted("SillyTavern/data/hearth.db")).toBe(false);
  });
});
