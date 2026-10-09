/**
 * Where a chat's notes go, and what happens when that book is replaced.
 *
 * The case that was reported: a chat keeps its notes in a lorebook; the book
 * is exported, corrected, imported back, and the old one deleted. The import
 * is a new book with the same name. The chat used to forget it had a book at
 * all and stop taking notes, silently and for good — or, on carrying on, make
 * a third book beside the two.
 */

import { describe, expect, test } from "bun:test";

import { db, wipe } from "./test-support";

const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function seed() {
  wipe();
  const t = Date.now();
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('wren', 'Wren', ?)").run(t);
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'wren', 'Evening', ?, ?)").run(t, t);
  db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES ('m1', 'ch', 'user', 'Hello.', ?)").run(t);
  const book = async (name: string) => (await (await send("/api/lorebooks", "POST", { name })).json()).id as string;
  return { book };
}
const notesOf = async () => (await (await ask("/api/chats/ch/autolore")).json()).book;
const linkedTo = (bookId: string) =>
  !!db.query("SELECT 1 FROM lorebook_links WHERE book_id = ? AND scope = 'chat' AND target_id = 'ch'").get(bookId);

describe("a chat's notes book", () => {
  test("can be pointed at any book, and the book is attached to the chat", async () => {
    const { book } = await seed();
    const a = await book("Wren — notes");
    const b = await book("Wren — corrected");
    await send("/api/chats/ch/autolore", "PUT", { book_id: a });
    expect((await notesOf()).id).toBe(a);
    await send("/api/chats/ch/autolore", "PUT", { book_id: b });
    expect((await notesOf()).id).toBe(b);
    expect(linkedTo(b)).toBe(true);
  });

  test("moving it to another book keeps the clock, so nothing since the last note is skipped", async () => {
    const { book } = await seed();
    const a = await book("A");
    await send("/api/chats/ch/autolore", "PUT", { book_id: a });
    db.query("UPDATE chats SET auto_lore_at = 12345 WHERE id = 'ch'").run();
    await send("/api/chats/ch/autolore", "PUT", { book_id: await book("B") });
    expect((db.query("SELECT auto_lore_at FROM chats WHERE id = 'ch'").get() as any).auto_lore_at).toBe(12345);
  });

  test("a deleted book is found again under its name — the re-imported copy", async () => {
    const { book } = await seed();
    const old = await book("Wren — notes");
    await send("/api/chats/ch/autolore", "PUT", { book_id: old });
    const fixed = await book("Wren — notes");          // the corrected import
    await ask(`/api/lorebooks/${old}`, { method: "DELETE" });
    const now = await notesOf();
    expect(now.id).toBe(fixed);
    expect(linkedTo(fixed)).toBe(true);
  });

  test("with nothing to take over, the chat lets go and will ask again", async () => {
    const { book } = await seed();
    const old = await book("Only copy");
    await send("/api/chats/ch/autolore", "PUT", { book_id: old });
    await ask(`/api/lorebooks/${old}`, { method: "DELETE" });
    expect(await notesOf()).toBeNull();
    expect((db.query("SELECT auto_lore_asked FROM chats WHERE id = 'ch'").get() as any).auto_lore_asked).toBe(0);
  });

  test("turning notes off", async () => {
    const { book } = await seed();
    await send("/api/chats/ch/autolore", "PUT", { book_id: await book("A") });
    await send("/api/chats/ch/autolore", "PUT", {});
    expect(await notesOf()).toBeNull();
  });
});
