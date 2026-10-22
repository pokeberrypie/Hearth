/**
 * Remembering: a promise made long ago comes back when the scene tests it,
 * and stays away when the scene is about something else.
 *
 *   bun test src/recall.test.ts
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { conceptsIn, isCommitment, recall, related } from "./recall";
import { normaliseEntry, type Bond, type Entry } from "./chronicle";
import { db, setSettings, wipe } from "./test-support";
const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body?: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });
let story = "Morning.";
beforeEach(() => {
  globalThis.fetch = (async (_u: any, init: any) => {
    const body = JSON.parse(init.body);
    if (body.stream) {
      const enc = new TextEncoder();
      return new Response(new ReadableStream({ start(c) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: story } }] })}\n\n`));
        c.enqueue(enc.encode("data: [DONE]\n\n")); c.close();
      } }), { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ choices: [{ message: { content: "NONE" } }] });
  }) as any;
});

const PROMISE = "Jaime promised Yvenna he would never hide anything that touched their marriage";
const PROMISE_QUOTE = "\"I will never keep anything from you again,\" Jaime swore, rain running off the eaves.";
const ev = (id: string, title: string, o: Partial<Entry> = {}) =>
  normaliseEntry({ id, kind: "event", title, source: "steward", visibility: "table", created_at: 1, day: 3, ...o });

describe("in code: what something is about, in other words", () => {
  test("hiding a letter is about honesty, though it never says lie", () => {
    expect([...conceptsIn("He slipped Cersei's letter into his doublet, saying nothing to her.")]).toContain("honesty");
    expect([...conceptsIn(PROMISE)]).toEqual(expect.arrayContaining(["honesty", "marriage"]));
    expect(isCommitment(PROMISE)).toBe(true);
    expect(isCommitment("Loras won the tourney")).toBe(false);
  });

  const base = {
    bonds: [] as Bond[], present: ["Jaime Lannister", "Yvenna Hightower"], everyone: ["Jaime Lannister", "Yvenna Hightower", "Loras Tyrell", "Olenna Tyrell"],
    inContext: new Set<string>(), threads: [] as string[], when: () => "Day 3",
  };
  const entries = [
    ev("p", PROMISE, { evidence: PROMISE_QUOTE, body: "With Jaime Lannister, Yvenna Hightower." }),
    ev("t", "Loras won the tourney at Highgarden", { body: "With Loras Tyrell." }),
    ev("x", "The Offstage ledger", { visibility: "private" }),
  ];

  test("tested by the scene: comes back, quoted, marked as a promise and with who was there", () => {
    const r = recall({ ...base, entries, recent: "Jaime folded Cersei's letter and slipped it into his doublet, saying nothing." });
    expect(r.events.map((e) => e.id)).toEqual(["p"]);
    expect(r.events[0].line).toContain("— “‘I will never keep anything from you again,’ Jaime swore, rain running off the eaves.”");
    expect(r.events[0].line).toContain("may test it");
    expect(r.events[0].line).toContain("Only Jaime Lannister, Yvenna Hightower were there");
  });

  test("Jaime being here is not enough: a scene about horses remembers nothing", () => {
    expect(recall({ ...base, entries, recent: "Jaime saddled the grey mare and checked her hooves." }).events).toEqual([]);
  });

  test("never what is private, never what is already in the conversation, never the same thing twice", () => {
    const more = [...entries, ev("p2", PROMISE, { evidence: PROMISE_QUOTE, created_at: 2 })];
    expect(recall({ ...base, entries: more, recent: "He kept the secret from her; another lie." }).events.map((e) => e.id)).toEqual(["p"]);
    const inIt = recall({ ...base, entries: [ev("p", PROMISE, { message_id: "m9" })], inContext: new Set(["m9"]), recent: "a lie" });
    expect(inIt.events).toEqual([]);
    expect(recall({ ...base, entries, present: [], recent: "The Offstage ledger was private" }).events).toEqual([]);
  });

  test("bonds have their own room: a crowded scene of events never pushes out why the two people here feel as they do", () => {
    const crowd = Array.from({ length: 12 }, (_, i) => ev(`c${i}`, `The council argued about the succession and the crown, ${i}`, { created_at: 10 + i }));
    const bond: Bond = { from: "Jaime Lannister", to: "Yvenna Hightower", score: 82, label: "devoted", memory: "",
      history: [normaliseEntry({ id: "b1", kind: "bond", subject: "Jaime Lannister", object: "Yvenna Hightower", amount: 15, title: "devoted",
        evidence: "He took her hand in front of the whole court.", created_at: 3, day: 2 })] };
    const r = recall({ ...base, entries: crowd, bonds: [bond], recent: "The council argued about the crown and the succession." });
    expect(r.events.length).toBe(5);
    expect(r.bonds.map((b) => b.line)).toEqual(["Jaime Lannister toward Yvenna Hightower: devoted (82/100). What made it so: Day 3: “He took her hand in front of the whole court.”"]);
    // And only between people who are both here.
    expect(recall({ ...base, present: ["Jaime Lannister"], entries: [], bonds: [bond], recent: "" }).bonds).toEqual([]);
  });

  test("the same matter, put two ways: a planned scene and a thread", () => {
    expect(related("The Hightower Wedding", "Jaime and Yvenna marry in the Sept of Baelor")).toBe(true);
    expect(related("The Missing Contract", "A ride to the kingswood")).toBe(false);
  });
});

describe("in the story: 150 messages on", () => {
  function seed() {
    wipe();
    setSettings({ mode: "story", provider: "openrouter", key_openrouter: "sk", model: "story/model", steward_on: "0", context_tokens: "300" });
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('j', 'Jaime Lannister', 1)").run();
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('o', 'Olenna Tyrell', 1)").run();
    db.query("INSERT INTO personas (id, name, created_at) VALUES ('y', 'Yvenna Hightower', 1)").run();
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at, persona_id) VALUES ('ch', 'j', 'The Hand', 1, 1, 'y')").run();
    const msg = db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES (?, 'ch', ?, ?, ?, ?)");
    msg.run("m-promise", "assistant", "Jaime Lannister", PROMISE_QUOTE, 10);
    msg.run("m-confess", "user", "Yvenna Hightower", "Yvenna told Olenna, alone in the garden, that she fears she is with child.", 11);
    for (let i = 0; i < 150; i++) msg.run(`f${i}`, i % 2 ? "user" : "assistant", i % 2 ? "Yvenna Hightower" : "Jaime Lannister", `Another long day at court went by, number ${i}, full of small talk and smaller food.`, 20 + i);
    const add = db.query("INSERT INTO chronicle (id, chat_id, kind, message_id, title, body, evidence, visibility, source, day, minute, created_at, amount) VALUES (?, 'ch', ?, ?, ?, ?, ?, ?, 'steward', 3, 600, ?, ?)");
    add.run("e-promise", "event", "m-promise", PROMISE, "With Jaime Lannister, Yvenna Hightower.", PROMISE_QUOTE, "table", 10, 0);
    add.run("e-confess", "event", "m-confess", "Yvenna confided to Olenna that she may be with child", "With Yvenna Hightower, Olenna Tyrell.", "she fears she is with child", "hidden", 11, 0);
    add.run("e-secret", "event", "m-promise", "Cersei paid the septa", "", "", "private", 12, 0);
    db.query("INSERT INTO chronicle (id, chat_id, kind, message_id, subject, object, title, evidence, visibility, source, day, minute, created_at, amount) VALUES ('b1', 'ch', 'bond', 'm-promise', 'Jaime Lannister', 'Yvenna Hightower', 'devoted', ?, 'table', 'steward', 3, 600, 13, 20)").run(PROMISE_QUOTE);
  }
  let clock = 1000;
  const say = (content: string) => db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES (?, 'ch', 'user', 'Yvenna Hightower', ?, ?)").run(`n${++clock}`, content, clock);
  const narrator = async () => JSON.stringify((await (await send("/api/chats/ch/inspect", "POST", {})).json()).sections);

  test("the promise comes back when he is about to break it — and not in a scene about horses", async () => {
    seed();
    say("Jaime folded Cersei's letter and slipped it into his doublet, saying nothing to Yvenna.");
    const told = await narrator();
    expect(told).toContain("From earlier in the story");
    expect(told).toContain("I will never keep anything from you again");
    expect(told).toContain("may test it");
    expect(told).not.toContain("Cersei paid the septa");
    seed();
    say("Jaime saddled the grey mare and checked her hooves.");
    const horses = await narrator();
    expect(horses).not.toContain("From earlier in the story");
    // His feeling for her is there either way, with why.
    expect(horses).toContain("Jaime Lannister toward Yvenna Hightower: devoted");
  });

  test("a confession is remembered as hers and Olenna's — not as something Jaime knows", async () => {
    seed();
    say("Jaime asked whether she was well; she had looked pale, and he wondered about a child.");
    const told = await narrator();
    expect(told).toContain("Yvenna confided to Olenna");
    expect(told).toContain("Only Yvenna Hightower, Olenna Tyrell were there");
    expect(told).toContain("A secret: never reveal it outright");
  });

  test("the words it came from, changed or gone: so is the memory", async () => {
    for (const change of ["edit", "delete"]) {
      seed();
      say("Jaime folded Cersei's letter and slipped it into his doublet, saying nothing to Yvenna.");
      if (change === "edit") await send("/api/messages/m-promise", "PUT", { content: "Jaime said nothing at all." });
      else await send("/api/messages/m-promise", "DELETE");
      const told = await narrator();
      expect(told).not.toContain(PROMISE);
    }
  });

  test("swiped: the reply it came from is replaced, and the memory goes with it", async () => {
    for (const swipe of [false, true]) {
      seed();
      // The promise, this time in the latest reply; then a swipe, or not; then a long while, then the letter.
      db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('m-last', 'ch', 'assistant', 'Jaime Lannister', ?, 500)").run(PROMISE_QUOTE);
      db.query("UPDATE chronicle SET message_id = 'm-last' WHERE id = 'e-promise'").run();
      if (swipe) await (await send("/api/chats/ch/generate", "POST", { mode: "swipe" })).text();
      for (let i = 0; i < 40; i++) say(`A quiet afternoon, number ${i}, with nothing much in it but weather and bread.`);
      say("Jaime folded Cersei's letter and slipped it into his doublet, saying nothing to Yvenna.");
      expect((await narrator()).includes(PROMISE)).toBe(!swipe);
    }
  });

  test("a planned scene knows the open threads it could pick up — and only those", async () => {
    seed();
    await send("/api/chats/ch/chronicle", "POST", { kind: "thread", name: "The Hightower Wedding" });
    await send("/api/chats/ch/chronicle", "POST", { kind: "thread", name: "The Dornish Debt" });
    const BOOK = "# The Hand\nA betrothal.\n## The Court\n### The Affirmation\nSetting: the Great Hall\nPurpose: Jaime makes the wedding public\nEnding: Jaime affirms the betrothal before the king";
    const imp = await (await send("/api/apocrypha/import", "POST", { text: BOOK })).json();
    await send("/api/chats/ch/apocrypha", "PUT", { book: imp.books[0].id });
    const told = await narrator();
    expect(told).toContain("Matters still open in the story that this scene could pick up, if it fits: The Hightower Wedding.");
    expect(told).not.toContain("could pick up, if it fits: The Hightower Wedding; The Dornish Debt");
  });

  test("switched off: nothing remembered into the prompt", async () => {
    seed();
    setSettings({ story_world: "0" });
    say("Jaime folded Cersei's letter and slipped it into his doublet, saying nothing to Yvenna.");
    expect(await narrator()).not.toContain("From earlier in the story");
  });
});

describe("the prompt inspector shows what was remembered, and why", () => {
  test("each memory with its reasons; and how many there were to choose from", async () => {
    wipe();
    setSettings({ mode: "story", provider: "openrouter", key_openrouter: "sk", model: "story/model", steward_on: "0", context_tokens: "200" });
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('j', 'Jaime Lannister', 1)").run();
    db.query("INSERT INTO personas (id, name, created_at) VALUES ('y', 'Yvenna Hightower', 1)").run();
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at, persona_id) VALUES ('ch', 'j', 'The Hand', 1, 1, 'y')").run();
    const msg = db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES (?, 'ch', ?, 'x', ?, ?)");
    msg.run("old", "assistant", PROMISE_QUOTE, 1);
    for (let i = 0; i < 60; i++) msg.run(`f${i}`, "assistant", `An ordinary day at court, number ${i}, and nothing in it.`, 10 + i);
    msg.run("now", "user", "Jaime slipped the letter into his doublet, saying nothing.", 100);
    db.query("INSERT INTO chronicle (id, chat_id, kind, message_id, title, body, evidence, visibility, source, day, created_at) VALUES ('e1', 'ch', 'event', 'old', ?, 'With Jaime Lannister, Yvenna Hightower.', ?, 'table', 'steward', 3, 1)").run(PROMISE, PROMISE_QUOTE);
    db.query("INSERT INTO chronicle (id, chat_id, kind, message_id, title, visibility, source, day, created_at) VALUES ('e2', 'ch', 'event', 'now', 'Jaime hid the letter', 'table', 'steward', 9, 2)").run();
    const r = await (await send("/api/chats/ch/inspect", "POST", {})).json();
    expect(r.remembered.looked).toEqual({ events: 2, inConversation: 1 });
    expect(r.remembered.events).toHaveLength(1);
    expect(r.remembered.events[0].line).toContain(PROMISE);
    expect(r.remembered.events[0].why).toEqual(expect.arrayContaining(["someone here was there", "a promise"]));
    expect(r.remembered.events[0].why.join(" ")).toContain("about honesty");
  });
});
