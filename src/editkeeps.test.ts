/** Editing a reply changes the words, and everything read from them follows: its time, and its place among the takes. */
import { beforeEach, expect, test } from "bun:test";
import { db, setSettings, wipe } from "./test-support";
const { app } = await import("./index");
const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body?: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  wipe();
  setSettings({ mode: "story", story_world: "1", steward_on: "0" });
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('j', 'Jaime Lannister', 1)").run();
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'j', 'The Road', 1, 1)").run();
  db.query(`INSERT INTO messages (id, chat_id, role, name, content, created_at, swipes, swipe_index) VALUES ('m1', 'ch', 'assistant', 'Jaime Lannister',
    'Three days later, they reached the inn.', 2, '["Three days later, they reached the inn.","Two days later, the rain stopped."]', 0)`).run();
  db.query(`INSERT INTO chronicle (id, chat_id, message_id, kind, span, title, source, visibility, created_at) VALUES ('t1', 'ch', 'm1', 'time', 4320, 'Three days later', 'narrator', 'table', 3)`).run();
});
const day = async () => (await (await ask("/api/chats/ch/chronicle")).json()).now.day;

test("a typo fixed in a reply that opens on a time skip keeps the skip", async () => {
  expect(await day()).toBe(3);
  await send("/api/messages/m1", "PUT", { content: "Three days later, they reached the inn at last." });
  expect(await day()).toBe(3);
});

test("the edited take stays edited after swiping away from it and back", async () => {
  await send("/api/messages/m1", "PUT", { content: "Three days later, they reached the inn at last." });
  await send("/api/messages/m1/swipe", "POST", { index: 1 });
  const back = await (await send("/api/messages/m1/swipe", "POST", { index: 0 })).json();
  expect(back.content).toBe("Three days later, they reached the inn at last.");
});

test("choosing another take reads the time that one opens on", async () => {
  await send("/api/messages/m1/swipe", "POST", { index: 1 });
  expect(await day()).toBe(2);
  await send("/api/messages/m1/swipe", "POST", { index: 0 });
  expect(await day()).toBe(3);
});

test("a new take is written from the world before the take it replaces, not after it", async () => {
  // The take on screen said she was taken to Bolton's camp, and the Steward wrote it down.
  db.query(`INSERT INTO chronicle (id, chat_id, message_id, kind, subject, field, title, source, visibility, created_at) VALUES ('s1', 'ch', 'm1', 'status', 'Yvenna Hightower', 'location', 'Bolton''s camp', 'steward', 'table', 4)`).run();
  db.query("INSERT INTO personas (id, name, created_at) VALUES ('y', 'Yvenna Hightower', 1)").run();
  db.query("UPDATE chats SET persona_id = 'y' WHERE id = 'ch'").run();
  const sent: any[] = [];
  const real = globalThis.fetch;
  setSettings({ provider: "openrouter", key_openrouter: "sk", model: "m" });
  globalThis.fetch = (async (_u: any, init: any) => {
    sent.push(JSON.parse(init.body));
    const enc = new TextEncoder();
    return new Response(new ReadableStream({ start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "They rode on." } }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n")); c.close();
    } }), { headers: { "content-type": "text/event-stream" } });
  }) as any;
  try { await (await send("/api/chats/ch/generate", "POST", { mode: "swipe" })).text(); } finally { globalThis.fetch = real; }
  const told = JSON.stringify(sent[0].messages);
  expect(told).not.toContain("Bolton's camp");
  // Nor three days on: the date is the one before that take opened "Three days later".
  expect(told).not.toMatch(/Today in the story:[^"]*\b(4|fourth)\b/);
});

test("someone of the cast who is elsewhere is told as elsewhere, not as one of those here — nor their aims as the room's", async () => {
  db.query("INSERT INTO personas (id, name, created_at) VALUES ('y', 'Yvenna Hightower', 1)").run();
  db.query("UPDATE chats SET persona_id = 'y' WHERE id = 'ch'").run();
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('t', 'Tywin Lannister', 1)").run();
  db.query("INSERT INTO chat_members (id, chat_id, character_id, position, muted) VALUES ('a', 'ch', 'j', 0, 0), ('b', 'ch', 't', 1, 0)").run();
  const st = (id: string, who: string, where: string) => db.query(`INSERT INTO chronicle (id, chat_id, kind, subject, field, title, source, visibility, created_at) VALUES (?, 'ch', 'status', ?, 'location', ?, 'steward', 'table', 5)`).run(id, who, where);
  st("l1", "Yvenna Hightower", "seated on the bench by the fire");
  st("l2", "Jaime Lannister", "on the bench beside Yvenna");
  st("l3", "Tywin Lannister", "the Tower of the Hand, at his desk");
  await send("/api/chats/ch/offstage/goal", "POST", { who: "Tywin Lannister", goal: "ready the realm's answer", why: "" });
  const sections = (await (await send("/api/chats/ch/inspect", "POST", {})).json()).sections as any[];
  const world = sections.find((x) => x.label === "Story World").content as string;
  const here = world.split("Elsewhere, as far as the record shows")[0];
  expect(here).toContain("Jaime Lannister — location: on the bench");
  expect(here).not.toContain("Tywin Lannister —");
  expect(world).toContain("Elsewhere, as far as the record shows");
  expect(world).not.toContain("Tywin Lannister wants");
  // And the cast listed with the character being written agrees with it.
  const system = (await (await send("/api/chats/ch/inspect", "POST", {})).json()).system as string;
  expect(system.split("# Elsewhere now")[0]).not.toContain("**Tywin Lannister**");
  expect(system).toContain("# Elsewhere now");
});

test("a date set to put the story right moves what came before with it, once", async () => {
  db.query("DELETE FROM chronicle").run();
  const post = (b: any) => send("/api/chats/ch/chronicle", "POST", b);
  await post({ kind: "set", day: 100 });
  await post({ kind: "event", title: "The joust" });
  await post({ kind: "time", text: "2 days" });
  await post({ kind: "event", title: "The feast" });
  // Thirteen years on, by hand: the date had been wrong all along.
  const set = (await (await post({ kind: "set", day: 5000 })).json()).entries.filter((e: any) => e.kind === "set").at(-1).id;
  const r = await (await send(`/api/chronicle/${set}/correct`, "POST")).json();
  const ev = (t: string) => r.entries.find((e: any) => e.title === t).day;
  expect(ev("The feast")).toBe(5000);
  expect(ev("The joust")).toBe(4998);
  expect(r.now.day).toBe(5000);
  expect((await send(`/api/chronicle/${set}/correct`, "POST")).status).toBe(400);
});

test("a correction moves everything before it, even what was written in the same moment", async () => {
  db.query("DELETE FROM chronicle").run();
  const ins = db.query("INSERT INTO chronicle (id, chat_id, kind, day, minute, title, source, visibility, created_at) VALUES (?, 'ch', ?, ?, 0, ?, 'steward', 'table', 50)");
  ins.run("s0", "set", 100, "");
  ins.run("e1", "event", 100, "The joust");
  ins.run("s1", "set", 5000, "");
  const r = await (await send("/api/chronicle/s1/correct", "POST")).json();
  expect(r.entries.find((e: any) => e.title === "The joust").day).toBe(5000);
});

test("a fact of a word or two is an answer broken off, and the narrator is not told it", async () => {
  db.query("INSERT INTO chronicle (id, chat_id, kind, title, source, visibility, created_at) VALUES ('f1', 'ch', 'consequence', 'Word', 'offstage', 'hidden', 5), ('f2', 'ch', 'consequence', 'The river lords have letters', 'offstage', 'hidden', 6)").run();
  const world = ((await (await send("/api/chats/ch/inspect", "POST", {})).json()).sections as any[]).find((x) => x.label === "Story World")?.content ?? "";
  expect(world).toContain("The river lords have letters");
  expect(world).not.toMatch(/; Word\b|: Word\b/);
});

test("left to the turn order, the one who answers is someone in the scene — never the one across the city", async () => {
  db.query("INSERT INTO personas (id, name, created_at) VALUES ('y', 'Yvenna Hightower', 1)").run();
  db.query("UPDATE chats SET persona_id = 'y' WHERE id = 'ch'").run();
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('t', 'Tywin Lannister', 1)").run();
  db.query("INSERT INTO chat_members (id, chat_id, character_id, position, muted) VALUES ('a', 'ch', 'j', 0, 0), ('b', 'ch', 't', 1, 0)").run();
  const st = (id: string, who: string, where: string) => db.query(`INSERT INTO chronicle (id, chat_id, kind, subject, field, title, source, visibility, created_at) VALUES (?, 'ch', 'status', ?, 'location', ?, 'steward', 'table', 5)`).run(id, who, where);
  st("l1", "Yvenna Hightower", "seated on the bench by the fire");
  st("l2", "Jaime Lannister", "on the bench beside Yvenna");
  st("l3", "Tywin Lannister", "the Tower of the Hand, at his desk");
  // Jaime has just spoken: by the list, or by who has spoken least, it would be Tywin's turn.
  db.query("UPDATE messages SET character_id = 'j' WHERE id = 'm1'").run();
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('u1', 'ch', 'user', 'Yvenna Hightower', 'And then?', 3)").run();
  const { nextSpeaker } = await import("./index");
  for (const order of ["", "list", "named"]) {
    db.query("UPDATE chats SET turn_order = ? WHERE id = 'ch'").run(order);
    const chat = db.query("SELECT * FROM chats WHERE id = 'ch'").get();
    for (let i = 0; i < 10; i++) expect(nextSpeaker(chat, undefined, () => i / 10).name).toBe("Jaime Lannister");
  }
});

test("how someone is placed is not where: seated at his desk in the Tower is not seated on the bench at the feast", async () => {
  db.query("INSERT INTO personas (id, name, created_at) VALUES ('y', 'Yvenna Hightower', 1)").run();
  db.query("UPDATE chats SET persona_id = 'y' WHERE id = 'ch'").run();
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('t', 'Tywin Lannister', 1)").run();
  db.query("INSERT INTO chat_members (id, chat_id, character_id, position, muted) VALUES ('a', 'ch', 'j', 0, 0), ('b', 'ch', 't', 1, 0)").run();
  const st = (id: string, who: string, where: string) => db.query(`INSERT INTO chronicle (id, chat_id, kind, subject, field, title, source, visibility, created_at) VALUES (?, 'ch', 'status', ?, 'location', ?, 'steward', 'table', 5)`).run(id, who, where);
  st("l1", "Yvenna Hightower", "seated on the bench by the fire");
  st("l3", "Tywin Lannister", "seated at his desk in the Tower of the Hand");
  const world = ((await (await send("/api/chats/ch/inspect", "POST", {})).json()).sections as any[]).find((x) => x.label === "Story World").content as string;
  expect(world.split("Elsewhere, as far as the record shows")[0]).not.toContain("Tywin Lannister —");
});

test("a correction says first what it will do, and can be taken back", async () => {
  db.query("DELETE FROM chronicle").run();
  const post = (b: any) => send("/api/chats/ch/chronicle", "POST", b);
  await post({ kind: "set", day: 100 });
  await post({ kind: "event", title: "The joust" });
  const set = (await (await post({ kind: "set", day: 5000 })).json()).entries.filter((e: any) => e.kind === "set").at(-1).id;
  const p = await (await send(`/api/chronicle/${set}/correct?preview=1`, "POST")).json();
  expect(p.shift).toBe(4900);
  expect(p.count).toBe(2);
  // A preview changes nothing.
  expect((await (await ask("/api/chats/ch/chronicle")).json()).entries.find((e: any) => e.title === "The joust").day).toBe(100);
  await send(`/api/chronicle/${set}/correct`, "POST");
  const back = await (await send(`/api/chronicle/${set}/correct?undo=1`, "POST")).json();
  expect(back.entries.find((e: any) => e.title === "The joust").day).toBe(100);
  // And it can be made again.
  expect((await send(`/api/chronicle/${set}/correct`, "POST")).status).toBe(200);
});
