/**
 * What a route is sent that it cannot use: answered plainly, and nothing half done. Found by sending every route
 * every wrong thing — a hundred answered "Something went wrong" to a body that was null, a list or not JSON, and a
 * save that left a field out wiped it.
 */
import { beforeEach, expect, test } from "bun:test";
import { db, wipe } from "./test-support";
const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const raw = (path: string, method: string, body?: string, type = "application/json") =>
  app.fetch(new Request(`http://home.test/api${path}`, { method, headers: { "content-type": type }, body }), HOME);

beforeEach(() => {
  wipe();
  db.query("INSERT INTO characters (id, name, description, personality, scenario, first_message, created_at) VALUES ('c1', 'Jaime', 'A knight.', 'Dry.', 'The Red Keep.', 'Well?', 1)").run();
  db.query("INSERT INTO personas (id, name, description, created_at) VALUES ('p1', 'Yvenna', 'A Hightower.', 1)").run();
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'c1', 'The Hand', 1, 1)").run();
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('m1', 'ch', 'assistant', 'Jaime', 'Three days later, rain.', 2)").run();
  db.query("INSERT INTO chronicle (id, chat_id, message_id, kind, span, title, source, visibility, created_at) VALUES ('t1', 'ch', 'm1', 'time', 4320, 'Three days later', 'narrator', 'table', 3)").run();
});

test("a body that is not an object, or not JSON, is turned away before any route reads it", async () => {
  for (const body of ["null", "[1,2]", "\"hi\"", "7", "{\"a\":"]) {
    const r = await raw("/characters", "POST", body);
    expect([body, r.status]).toEqual([body, 400]);
  }
  // No body at all is not a bad body: "Stop" is sent so, and is answered.
  expect((await raw("/chats/ch/stop", "POST")).status).toBe(200);
  // The one route that takes a list still does.
  expect((await raw("/kits/import", "POST", "[]")).status).toBe(400); // an empty list: nothing in it, said so
  expect((await (await raw("/kits/import", "POST", "[]")).json()).error).toContain("nothing in that file");
});

test("a file upload sent as something else is told so, not 'Something went wrong'", async () => {
  const r = await raw("/import/characters", "POST", "{}");
  expect(r.status).toBe(400);
  // And a settings file that is JSON but not settings.
  for (const body of ["null", "[1]", "\"x\""]) {
    const form = new FormData();
    form.set("file", new Blob([body]), "settings.json");
    const res = await app.fetch(new Request("http://home.test/api/import/settings", { method: "POST", body: form }), HOME);
    expect([body, res.status]).toEqual([body, 400]);
  }
});

test("fields of the wrong kind are not words, and do not crash the save", async () => {
  expect((await raw("/characters", "POST", JSON.stringify({ name: ["Arya"] }))).status).toBe(400);
  expect((await raw("/personas", "POST", JSON.stringify({ name: 5 }))).status).toBe(400);
  expect((await raw("/lorebooks", "POST", JSON.stringify({ name: {}, entries: "x" }))).status).toBe(200);
  expect((await raw("/chats/ch", "PUT", JSON.stringify({ title: 7 }))).status).toBe(200);
  expect((db.query("SELECT title FROM chats WHERE id = 'ch'").get() as any).title).toBe("The Hand");
});

test("a save that leaves a field out keeps it", async () => {
  expect((await raw("/characters/c1", "PUT", JSON.stringify({ description: "A knight of the Kingsguard." }))).status).toBe(200);
  expect(db.query("SELECT name, description, personality, scenario, first_message FROM characters WHERE id = 'c1'").get())
    .toEqual({ name: "Jaime", description: "A knight of the Kingsguard.", personality: "Dry.", scenario: "The Red Keep.", first_message: "Well?" });
  expect((await raw("/personas/p1", "PUT", JSON.stringify({}))).status).toBe(200);
  expect(db.query("SELECT name, description FROM personas WHERE id = 'p1'").get()).toEqual({ name: "Yvenna", description: "A Hightower." });
  expect((await raw("/characters/nobody", "PUT", JSON.stringify({ name: "X" }))).status).toBe(404);
});

test("an edit with no words changes nothing — not even what the reply did", async () => {
  expect((await raw("/messages/m1", "PUT", JSON.stringify({}))).status).toBe(400);
  expect((db.query("SELECT undone_at FROM chronicle WHERE id = 't1'").get() as any).undone_at).toBeNull();
  expect((await raw("/messages/nope", "PUT", JSON.stringify({ content: "x" }))).status).toBe(404);
});

test("rows whose parent is gone for good are cleared at start, and nothing that still has one", async () => {
  const { dropOrphans } = await import("./index");
  db.query("PRAGMA foreign_keys = OFF").run();
  db.query("INSERT INTO chronicle (id, chat_id, kind, title, source, visibility, created_at) VALUES ('o1', 'gone-chat', 'event', 'x', 'user', 'table', 1)").run();
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('o2', 'gone-chat', 'user', '', 'x', 1)").run();
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('o3', 'gone-character', 'x', 1, 1)").run();
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('o4', 'o3', 'user', '', 'x', 1)").run();
  db.query("PRAGMA foreign_keys = ON").run();
  // A chat in the bin still has its row: what hangs off it is not orphaned.
  db.query("UPDATE chats SET deleted_at = 5 WHERE id = 'ch'").run();
  // Every orphan gone: counted or not, since a chat's own messages may go with it by the database's rule (a
  // cascade SQLite does not count in what it says it changed, depending on its version).
  expect(dropOrphans()).toBeGreaterThanOrEqual(3);
  expect(db.query("SELECT id FROM messages WHERE id IN ('o2','o4') UNION ALL SELECT id FROM chats WHERE id = 'o3' UNION ALL SELECT id FROM chronicle WHERE id = 'o1'").all()).toEqual([]);
  expect((db.query("SELECT COUNT(*) AS n FROM messages WHERE chat_id = 'ch'").get() as any).n).toBe(1);
  expect((db.query("SELECT COUNT(*) AS n FROM chronicle WHERE chat_id = 'ch'").get() as any).n).toBe(1);
  expect(dropOrphans()).toBe(0);
  // And it is done when the app starts, not only when asked.
  const { ensureStarterCharacter } = await import("./index");
  db.query("PRAGMA foreign_keys = OFF").run();
  db.query("INSERT INTO chronicle (id, chat_id, kind, title, source, visibility, created_at) VALUES ('o5', 'gone-chat', 'event', 'x', 'user', 'table', 1)").run();
  db.query("PRAGMA foreign_keys = ON").run();
  ensureStarterCharacter();
  expect(db.query("SELECT id FROM chronicle WHERE id = 'o5'").get()).toBeNull();
});

test("a file the page made is handed back by an ordinary address — what the phone can fetch, unlike a blob:", async () => {
  const make = async (body: unknown) => (await raw("/download", "POST", JSON.stringify(body))).json();
  const fetchIt = (url: string) => app.fetch(new Request(`http://home.test${url}`), HOME);
  const t = await make({ name: "The Long Night.json", text: '{"hearth":"apocrypha"}', type: "application/json" });
  const r = await fetchIt(t.url);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe("application/json");
  expect(r.headers.get("content-disposition")).toContain('filename="The Long Night.json"');
  expect(await r.text()).toBe('{"hearth":"apocrypha"}');
  // A picture arrives as itself.
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
  const p = await make({ name: "face.png", type: "image/png", base64: Buffer.from(png).toString("base64") });
  expect(new Uint8Array(await (await fetchIt(p.url)).arrayBuffer())).toEqual(png);
  // A name that would climb out of the folder is made safe; nothing is nothing; an unknown token is gone.
  const odd = await make({ name: "../../etc/passwd", text: "x" });
  expect((await fetchIt(odd.url)).headers.get("content-disposition")).not.toContain("/");
  expect((await raw("/download", "POST", JSON.stringify({ name: "x" }))).status).toBe(400);
  expect((await fetchIt("/api/download/nope")).status).toBe(404);
});
