/**
 * A chat exported and imported again is the same chat.
 *
 * The export carried the messages and nothing else the chat had become: the
 * Story World's ledger, its calendar, who sat at a group's table, what each
 * reply had thought. Moving a chat to another device, or keeping one safe,
 * brought it back undated, empty of everything the story had established,
 * and alone.
 */

import { describe, expect, test } from "bun:test";

import { db, wipe } from "./test-support";

const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test${path}`, init), HOME);

function seed() {
  wipe();
  for (const [id, name] of [["j", "Jaime Lannister"], ["c", "Cersei Lannister"], ["r", "Robert Baratheon"]]) {
    db.query("INSERT INTO characters (id, name, created_at) VALUES (?, ?, 1)").run(id, name);
  }
  db.query(`INSERT INTO chats (id, character_id, title, created_at, updated_at, is_group, calendar, author_note, steward_at, offstage_day)
            VALUES ('ch', 'j', 'The Hand', 1, 1, 1, '{"id":"moons"}', 'Keep it grim.', 200, 18)`).run();
  db.query("INSERT INTO chat_members (id, chat_id, character_id, position, muted) VALUES ('x1','ch','j',0,0), ('x2','ch','c',1,1), ('x3','ch','r',2,0)").run();
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at, reasoning) VALUES ('m1','ch','user','','To court.',100,'')").run();
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at, reasoning) VALUES ('m2','ch','assistant','Robert Baratheon','The boar came.',200,'He is drunk.')").run();
  db.query(`INSERT INTO chronicle (id, chat_id, message_id, kind, day, title, subject, field, source, created_at)
            VALUES ('s1','ch','m2','status',18,'dead','Robert Baratheon','physical','steward',300)`).run();
  db.query(`INSERT INTO chronicle (id, chat_id, kind, day, title, subject, visibility, source, created_at)
            VALUES ('g1','ch','agenda',18,'crown Joffrey','Cersei Lannister','private','offstage',301)`).run();
  db.query(`INSERT INTO chronicle (id, chat_id, kind, day, title, subject, visibility, source, data, created_at)
            VALUES ('g2','ch','agenda',18,'','Cersei Lannister','private','offstage','{"of":"g1","status":"abandoned"}',302)`).run();
}

async function roundTrip() {
  const file = await (await ask("/api/chats/ch/export")).text();
  const form = new FormData();
  form.set("file", new File([file], "The Hand.json", { type: "application/json" }));
  form.set("character_id", "j");
  return (await ask("/api/chats/import", { method: "POST", body: form })).json();
}

describe("a chat, exported and brought back", () => {
  test("its world comes with it: the ledger, tied to its messages, with its links between entries intact", async () => {
    seed();
    const r = await roundTrip();
    expect(r.imported).toBe(2);
    const world = db.query("SELECT * FROM chronicle WHERE chat_id = ? ORDER BY created_at").all(r.id) as any[];
    expect(world.map((e) => e.kind)).toEqual(["status", "agenda", "agenda"]);
    // The death is tied to the new copy of the message it was read from.
    const robert = db.query("SELECT content FROM messages WHERE id = ?").get(world[0].message_id) as any;
    expect(robert.content).toBe("The boar came.");
    // The abandoning points at the new goal, not the old one.
    expect(JSON.parse(world[2].data).of).toBe(world[1].id);
    expect(world.every((e) => !["s1", "g1", "g2"].includes(e.id))).toBe(true);
  });

  test("its calendar, its notes, its table, its times, and what each reply thought", async () => {
    seed();
    const r = await roundTrip();
    const chat = db.query("SELECT * FROM chats WHERE id = ?").get(r.id) as any;
    expect(chat.calendar).toBe('{"id":"moons"}');
    expect(chat.author_note).toBe("Keep it grim.");
    expect(chat.steward_at).toBe(200);
    expect(chat.offstage_day).toBe(18);
    expect(chat.is_group).toBe(1);
    const members = db.query(`SELECT characters.name, muted FROM chat_members JOIN characters ON characters.id = character_id
                              WHERE chat_id = ? ORDER BY position`).all(r.id) as any[];
    expect(members).toEqual([{ name: "Jaime Lannister", muted: 0 }, { name: "Cersei Lannister", muted: 1 }, { name: "Robert Baratheon", muted: 0 }]);
    const msgs = db.query("SELECT created_at, reasoning FROM messages WHERE chat_id = ? ORDER BY created_at").all(r.id) as any[];
    expect(msgs).toEqual([{ created_at: 100, reasoning: "" }, { created_at: 200, reasoning: "He is drunk." }]);
  });

  test("imported twice, two chats: nothing collides", async () => {
    seed();
    const a = await roundTrip();
    const b = await roundTrip();
    expect(a.id).not.toBe(b.id);
    expect((db.query("SELECT COUNT(*) n FROM chronicle").get() as any).n).toBe(9);
  });

  test("an older export, with messages only, still comes in as it did", async () => {
    seed();
    const form = new FormData();
    form.set("file", new File([JSON.stringify({ hearth: 1, chat: { title: "Old", steward_at: 999 }, messages: [{ role: "user", content: "Hello." }] })], "Old.json"));
    form.set("character_id", "j");
    const r = await (await ask("/api/chats/import", { method: "POST", body: form })).json();
    expect(r.imported).toBe(1);
    expect((db.query("SELECT COUNT(*) n FROM chronicle WHERE chat_id = ?").get(r.id) as any).n).toBe(0);
    // And the Steward reads it afresh, to build its world again.
    expect((db.query("SELECT steward_at FROM chats WHERE id = ?").get(r.id) as any).steward_at).toBe(0);
  });
});

describe("a request the server did not expect", () => {
  test("a body that is not JSON is a clear 400 the page can show, not a bare 500", async () => {
    seed();
    const r = await ask("/api/lorebooks", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("That request could not be read.");
  });
});
