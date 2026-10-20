/**
 * The narrator's marks for Story World: time passing and what it does to the
 * party, things that happened, groups named, and the party's standing — read,
 * kept in the chronicle, and taken back with the reply they were written in.
 *
 *   bun test src/storyverbs.test.ts
 */

import { beforeEach, describe, expect, test } from "bun:test";

import { db, setSettings, wipe } from "./test-support";
import { resolveVerbs } from "./verbs";
import { afterTime, rationDays, type Sheet } from "./tabletop";

const { app, applyVerbs } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body?: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("reading the marks", () => {
  const read = (t: string) => resolveVerbs(t, (i) => JSON.stringify(i)).intents;

  test("time, and rests as lengths of time", () => {
    expect(read("[[time: three days]] [[rest: long]] [[rest: short]] [[rest: a night's sleep]]")).toEqual([
      { kind: "time", said: "three days" },
      { kind: "time", said: "8 hours" },
      { kind: "time", said: "1 hour" },
      { kind: "time", said: "8 hours" },
    ]);
  });

  test("events, factions and standing", () => {
    expect(read("[[event: The mill burns.]] [[faction: The Blackthorn Guild — smugglers]] [[standing: The Blackthorn Guild +]] [[reputation: the watch, down]]")).toEqual([
      { kind: "event", title: "The mill burns" },
      { kind: "faction", name: "The Blackthorn Guild", brief: "smugglers" },
      { kind: "standing", who: "The Blackthorn Guild", way: "+" },
      { kind: "standing", who: "the watch", way: "down" },
    ]);
  });

  test("a standing with no direction, or a faction that is a sentence, is not a mark", () => {
    expect(read("[[standing: the Guild]] [[faction: a crowd of angry people gathers by the well and starts shouting]]")).toEqual([]);
  });
});

describe("what time does to a character", () => {
  const sheet = (over: Partial<Sheet> = {}): Sheet => ({
    klass: "rogue", level: 1, maxHp: 12, hp: 3,
    abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
    skills: [], inventory: ["Rope, forty feet", "Rations for a week"], notes: "", ...over,
  });

  test("a long rest heals fully; a short one by a quarter; less than an hour, not at all", () => {
    expect(afterTime(sheet(), 8 * 60, 0)).toMatchObject({ healed: 9, sheet: { hp: 12 } });
    expect(afterTime(sheet(), 90, 0)).toMatchObject({ healed: 3, sheet: { hp: 6 } });
    expect(afterTime(sheet(), 30, 0)).toMatchObject({ healed: 0, sheet: { hp: 3 } });
  });

  test("each night eats a day of rations, and running out is said plainly", () => {
    let r = afterTime(sheet(), 3 * 1440, 3);
    expect(r.sheet.inventory).toEqual(["Rope, forty feet", "Rations (4 days)"]);
    expect(r.rations).toBe("4 days of rations left");
    r = afterTime(r.sheet, 5 * 1440, 5);
    expect(r.sheet.inventory[1]).toBe("Rations (none left)");
    expect(r.rations).toBe("rations ran out 1 day ago");
  });

  test("supplies that do not say how much are left alone", () => {
    expect(rationDays("Rations for a week")).toBe(7);
    expect(rationDays("Rations (3 days)")).toBe(3);
    expect(rationDays("five days of rations")).toBe(5);
    expect(rationDays("Rations x4")).toBe(4);
    expect(rationDays("Some rations")).toBeNull();
    expect(rationDays("A fine sword")).toBeNull();
    expect(afterTime(sheet({ inventory: ["Some rations"] }), 2 * 1440, 2).sheet.inventory).toEqual(["Some rations"]);
  });
});

describe("in a game", () => {
  const CHAT = "chat-sv";
  const PLAYER = "persona-sv";
  beforeEach(() => {
    wipe();
    setSettings({ mode: "tabletop" });
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('gk', 'The Gamekeeper', 1)").run();
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?, 'gk', 'A game', 1, 1)").run(CHAT);
    db.query("INSERT INTO personas (id, name, created_at) VALUES (?, 'Iva Grant', 1)").run(PLAYER);
    db.query("INSERT INTO sheets (owner_id, owner_kind, sheet, updated_at) VALUES (?, 'persona', ?, 1)").run(PLAYER, JSON.stringify({
      klass: "rogue", level: 1, maxHp: 8, hp: 2, abilities: { str: 12, dex: 16, con: 11, int: 10, wis: 10, cha: 13 },
      skills: [], inventory: ["Rations for a week"], notes: "",
    }));
  });
  const state = async () => (await ask(`/api/chats/${CHAT}/chronicle`)).json();
  const sheet = () => JSON.parse((db.query("SELECT sheet FROM sheets WHERE owner_id = ?").get(PLAYER) as any).sheet);

  test("a night's rest moves the clock, heals, eats a day's food, and says so in the reply", async () => {
    const out = applyVerbs(CHAT, "You make camp under the oaks. [[rest: long]]", PLAYER);
    expect(out).toContain("[[passed: 8 hours]]");
    expect(out).toContain("[[hp: Iva Grant +6, 8/8]]");
    expect((await state()).now.minute).toBe(8 * 60);
    expect(sheet().hp).toBe(8);
    // Eight hours from midnight does not cross one: no food eaten yet.
    expect(sheet().inventory).toEqual(["Rations for a week"]);
    const days = applyVerbs(CHAT, "[[time: three days]]", PLAYER);
    expect(days).toContain("[[supplies: Iva Grant — 4 days of rations left]]");
    expect(sheet().inventory).toEqual(["Rations (4 days)"]);
  });

  test("time it cannot read moves nothing, and its brackets stay as written", async () => {
    const out = applyVerbs(CHAT, "[[time: a while]]", PLAYER);
    expect(out).toBe("[[time: a while]]");
    expect((await state()).entries).toEqual([]);
  });

  test("events go into the chronicle as the narrator's", async () => {
    applyVerbs(CHAT, "[[event: The mill burns]]", PLAYER);
    expect((await state()).entries[0]).toMatchObject({ kind: "event", title: "The mill burns", source: "narrator" });
  });

  test("a group named is put forward once, and standing moves only with a faction that exists", async () => {
    expect(applyVerbs(CHAT, "[[standing: The Blackthorn Guild +]]", PLAYER)).toBe("[[standing: The Blackthorn Guild +]]");
    applyVerbs(CHAT, "[[faction: The Blackthorn Guild — smugglers who own the docks]]", PLAYER);
    applyVerbs(CHAT, "[[faction: blackthorn guild]]", PLAYER);
    let s = await state();
    expect(s.proposals.filter((p: any) => p.kind === "faction")).toHaveLength(1);
    expect(JSON.parse(s.proposals[0].data).arms.charge.type).toBe("thorned_vine");
    s = await (await send(`/api/chronicle/${s.proposals[0].id}/accept`, "POST")).json();
    expect(applyVerbs(CHAT, "The dockhands nod at you now. [[standing: The Blackthorn Guild +]]", PLAYER))
      .toContain("[[standing: The Blackthorn Guild +10]]");
    applyVerbs(CHAT, "[[standing: the blackthorn guild, down]]", PLAYER);
    applyVerbs(CHAT, "[[standing: the blackthorn guild, down]]", PLAYER);
    expect((await state()).factions[0].standing).toBe(-10);
  });

  test("the narrator's marks belong to their reply, and go when it is rerolled", async () => {
    // A reply, saved the way the generation route saves one.
    applyVerbs(CHAT, "[[time: two days]] [[event: The bridge falls]]", PLAYER);
    db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES ('r1', ?, 'assistant', 'x', ?)").run(CHAT, Date.now());
    db.query("UPDATE chronicle SET message_id = 'r1' WHERE chat_id = ? AND source = 'narrator' AND message_id IS NULL").run(CHAT);
    expect((await state()).now.day).toBe(2);
    // A table refuses edits unless it has been told it may; this one has.
    setSettings({ tabletop_edits: "1" });
    expect((await send("/api/messages/r1", "PUT", { content: "Nothing happened." })).status).toBe(200);
    const s = await state();
    expect(s.now.day).toBe(0);
    expect(s.entries).toEqual([]);
  });
});

test("through a real reply: the narrator's marks are tied to the message the reply was saved as", async () => {
  const realFetch = globalThis.fetch;
  const enc = new TextEncoder();
  globalThis.fetch = (async () => new Response(new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "You walk on. [[time: two days]] [[event: The bridge falls]]" } }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  }), { headers: { "content-type": "text/event-stream" } })) as any;
  try {
    wipe();
    setSettings({ mode: "tabletop", provider: "openrouter", key_openrouter: "sk-test", model: "test/model", steward_on: "0" });
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('gk', 'The Gamekeeper', 1)").run();
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('live', 'gk', 'A game', 1, 1)").run();
    const res = await send("/api/chats/live/generate", "POST", { mode: "reply", content: "We go on." });
    await res.text();
    const reply = db.query("SELECT id, content FROM messages WHERE chat_id = 'live' AND role = 'assistant'").get() as any;
    expect(reply.content).toContain("[[passed: two days]]");
    const tied = db.query("SELECT kind, message_id FROM chronicle WHERE chat_id = 'live' ORDER BY created_at").all();
    expect(tied).toEqual([{ kind: "time", message_id: reply.id }, { kind: "event", message_id: reply.id }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
