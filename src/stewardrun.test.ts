/**
 * The Steward in a chat: asked the right model in the right way, believed
 * only as far as the story bears it out, and taken back when the story
 * changes under it.
 *
 *   bun test src/stewardrun.test.ts
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { db, wipe, setSettings } from "./test-support";

const { app, stewardTurn } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body?: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });
afterEach(() => { globalThis.fetch = realFetch; });

/** What the fake provider was sent, and what it will answer next. */
let sent: any[] = [];
let answers: (string | number)[] = [];
function provider() {
  sent = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    sent.push(JSON.parse(init.body));
    const next = answers.shift() ?? "NONE";
    if (typeof next === "number") return new Response("upstream on fire", { status: next });
    return new Response(JSON.stringify({ choices: [{ message: { content: next } }] }), {
      headers: { "content-type": "application/json" },
    });
  }) as any;
}

const LINES = [
  "Loras came through the door at speed and stopped dead two steps inside. <status>Location: the stables</status>",
  "\"Well?\" Yvenna laughed, turning toward him. \"Have you nothing to say?\"",
  "Three days later, the court gathered in the Great Hall, and Jaime publicly affirmed his betrothal to Yvenna before the king.",
];

function seed(count = 3) {
  wipe();
  setSettings({ mode: "story", provider: "openrouter", key_openrouter: "sk-test", model: "story/model", steward_every: "3" });
  const t = Date.now() - 1_000_000;
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('loras', 'Loras Tyrell', ?)").run(t);
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('jaime', 'Jaime Lannister', ?)").run(t);
  db.query("INSERT INTO personas (id, name, created_at) VALUES ('yv', 'Yvenna Hightower', ?)").run(t);
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at, persona_id, is_group) VALUES ('ch', 'loras', 'The Hand', ?, ?, 'yv', 1)").run(t, t);
  db.query("INSERT INTO chat_members (id, chat_id, character_id, position) VALUES ('a', 'ch', 'loras', 0), ('b', 'ch', 'jaime', 1)").run();
  for (let i = 0; i < count; i++) {
    db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES (?, 'ch', ?, ?, ?, ?)")
      .run(`m${i + 1}`, i === 1 ? "user" : "assistant", i === 1 ? "" : i === 0 ? "Loras Tyrell" : "Jaime Lannister", LINES[i % 3], t + i * 1000);
  }
}
const chronicle = async () => (await ask("/api/chats/ch/chronicle")).json();
const GOOD = [
  'TIME | 3 days | "Three days later, the court gathered in the Great Hall"',
  'EVENT | Jaime affirms the betrothal | 2, 3 | "Jaime publicly affirmed his betrothal to Yvenna"',
].join("\n");

beforeEach(() => { answers = []; provider(); });

describe("when it reads", () => {
  test("after enough new messages, and not before", async () => {
    seed(2);
    await stewardTurn("ch");
    expect(sent).toHaveLength(0);
    seed(3);
    answers = [GOOD];
    await stewardTurn("ch");
    expect(sent).toHaveLength(1);
    // And not again until there is something new.
    await stewardTurn("ch");
    expect(sent).toHaveLength(1);
  });

  test("never, when switched off", async () => {
    seed(3);
    setSettings({ steward_on: "0" });
    await stewardTurn("ch");
    expect(sent).toHaveLength(0);
  });
});

describe("whom it asks, and how", () => {
  test("the story's model when it has none of its own", async () => {
    seed(3);
    answers = [GOOD];
    await stewardTurn("ch");
    expect(sent[0].model).toBe("story/model");
    expect(sent[0].messages[0].role).toBe("system");
  });

  test("its own model when it has one; Gemma gets its instructions in the request", async () => {
    seed(3);
    setSettings({ steward_model: "google/gemma-3-27b-it" });
    answers = [GOOD];
    await stewardTurn("ch");
    expect(sent[0].model).toBe("google/gemma-3-27b-it");
    expect(sent[0].messages.some((m: any) => m.role === "system")).toBe(false);
    expect(sent[0].messages[0].content).toContain("You keep the records for a story");
  });

  test("shown the room by number and the story without its tracker blocks", async () => {
    seed(3);
    answers = [GOOD];
    await stewardTurn("ch");
    const prompt = JSON.stringify(sent[0].messages);
    expect(prompt).toContain("1. Loras Tyrell (here)");
    expect(prompt).toContain("2. Jaime Lannister (here)");
    expect(prompt).toContain("3. Yvenna Hightower (the player, here)");
    expect(prompt).not.toContain("stables");
  });
});

describe("what it records", () => {
  test("time and events, in story order, tied to the message they quote", async () => {
    seed(3);
    answers = [GOOD];
    await stewardTurn("ch");
    const s = await chronicle();
    expect(s.now.day).toBe(3);
    expect(s.entries.map((e: any) => [e.kind, e.title, e.message_id, e.source])).toEqual([
      ["time", "3 days", "m3", "steward"],
      ["event", "Jaime affirms the betrothal", "m3", "steward"],
    ]);
    // The event happened after the three days, not before them.
    expect(s.entries[1]).toMatchObject({ day: 3, body: "With Jaime Lannister, Yvenna Hightower." });
    // And never in the message itself.
    expect((db.query("SELECT content FROM messages WHERE id = 'm3'").get() as any).content).toBe(LINES[2]);
  });

  test("a big jump waits for a person, and counts once accepted", async () => {
    seed(3);
    setSettings({ steward_ask_days: "2" });
    answers = [GOOD];
    await stewardTurn("ch");
    let s = await chronicle();
    expect(s.now.day).toBe(0);
    expect(s.proposals).toHaveLength(1);
    s = await (await send(`/api/chronicle/${s.proposals[0].id}/accept`, "POST")).json();
    expect(s.now.day).toBe(3);
    expect(s.proposals).toHaveLength(0);
  });

  test("an answer it cannot use changes nothing, and is logged", async () => {
    seed(3);
    answers = ["I think some time passed and maybe a wedding happened?"];
    await stewardTurn("ch");
    expect((await chronicle()).entries).toEqual([]);
    const runs = await (await ask("/api/chats/ch/steward")).json();
    expect(runs[0]).toMatchObject({ kept: 0, problem: "Nothing in the answer could be used." });
  });

  test("a failed call keeps what was already recorded from those same messages", async () => {
    seed(3);
    answers = [GOOD];
    await stewardTurn("ch");
    answers = [500];
    const r = await (await send("/api/chats/ch/steward/history", "POST")).json();
    expect(r.failed).toBe(1);
    expect(r.now.day).toBe(3);
    expect(r.entries.map((e: any) => e.title)).toEqual(["3 days", "Jaime affirms the betrothal"]);
    const runs = await (await ask("/api/chats/ch/steward")).json();
    expect(runs[0].problem).toContain("500");
  });
});

describe("when the story changes under it", () => {
  test("an edit takes back what it read in the old words, and they are read again", async () => {
    seed(3);
    answers = [GOOD];
    await stewardTurn("ch");
    await send("/api/messages/m3", "PUT", { content: "The court gathered that evening, and nothing was decided." });
    const s = await chronicle();
    expect(s.now.day).toBe(0);
    expect(s.entries).toEqual([]);
    expect((db.query("SELECT steward_at FROM chats WHERE id = 'ch'").get() as any).steward_at)
      .toBeLessThan((db.query("SELECT created_at FROM messages WHERE id = 'm3'").get() as any).created_at);
    // Taken back, not deleted.
    expect((db.query("SELECT COUNT(*) AS n FROM chronicle WHERE undone_at IS NOT NULL").get() as any).n).toBe(2);
  });

  test("switching to another swipe does the same", async () => {
    seed(3);
    db.query("UPDATE messages SET swipes = ?, swipe_index = 0 WHERE id = 'm3'").run(JSON.stringify([LINES[2], "Nothing happened for a while."]));
    answers = [GOOD];
    await stewardTurn("ch");
    await send("/api/messages/m3/swipe", "POST", { index: 1 });
    expect((await chronicle()).entries).toEqual([]);
  });

  test("a deleted message's events did not happen", async () => {
    seed(3);
    answers = [GOOD];
    await stewardTurn("ch");
    await send("/api/messages/m3", "DELETE");
    expect((await chronicle()).now.day).toBe(0);
  });

  test("what a person wrote by hand is never taken back with it", async () => {
    seed(3);
    await send("/api/chats/ch/chronicle", "POST", { kind: "event", title: "My own note" });
    await send("/api/messages/m3", "PUT", { content: "Changed." });
    expect((await chronicle()).entries.map((e: any) => e.title)).toEqual(["My own note"]);
  });
});

test("building from history reads the whole chat in order, and replaces only the Steward's own work", async () => {
  seed(3);
  await send("/api/chats/ch/chronicle", "POST", { kind: "event", title: "My own note" });
  answers = [GOOD];
  const r = await (await send("/api/chats/ch/steward/history", "POST")).json();
  expect(r).toMatchObject({ runs: 1, kept: 2, failed: 0, unread: 0 });
  expect(r.entries.map((e: any) => e.title)).toEqual(["My own note", "3 days", "Jaime affirms the betrothal"]);
  answers = [GOOD];
  const again = await (await send("/api/chats/ch/steward/history", "POST")).json();
  expect(again.entries.map((e: any) => e.title)).toEqual(["My own note", "3 days", "Jaime affirms the betrothal"]);
});

describe("the tracker, in a chat", () => {
  const TRACKED = [
    'TIME | 3 days | "Three days later, the court gathered in the Great Hall"',
    'STATUS | 2 | location | the Great Hall | "the court gathered in the Great Hall"',
    'STATUS | 1 | mental | stunned | "Loras came through the door at speed and stopped dead"',
  ].join("\n");
  const inspect = async () =>
    (await (await send("/api/chats/ch/inspect", "POST", {})).json()).sections as { label: string; content: string }[];
  const storyWorld = async () => (await inspect()).find((s) => s.label === "Story World")?.content;

  test("how everyone is goes into Story World, and into the story model's prompt", async () => {
    seed(3);
    answers = [TRACKED];
    await stewardTurn("ch");
    const s = await chronicle();
    expect(s.status["Jaime Lannister"].location).toMatchObject({ value: "the Great Hall", source: "steward" });
    expect(s.status["Loras Tyrell"].mental.value).toBe("stunned");
    const brief = await storyWorld();
    expect(brief).toContain("Today in the story: Day 4.");
    expect(brief).toContain("- Loras Tyrell — mental: stunned");
    expect(brief).toContain("- Jaime Lannister — location: the Great Hall");
  });

  test("a chat with no calendar and no time passed is not told the date", async () => {
    seed(3);
    expect(await storyWorld()).toBeUndefined();
  });

  test("when a preset keeps the tracker, Hearth's own is neither asked for nor sent", async () => {
    seed(3);
    setSettings({ tracker_source: "preset" });
    answers = [TRACKED];
    await stewardTurn("ch");
    expect(JSON.stringify(sent[0].messages)).not.toContain("STATUS |");
    expect((await chronicle()).status).toEqual({});
    const brief = await storyWorld();
    expect(brief).toContain("Today in the story");
    expect(brief).not.toContain("right now");
  });

  test("reading the same messages again keeps what was already true", async () => {
    seed(3);
    answers = [TRACKED, TRACKED];
    await send("/api/chats/ch/steward/history", "POST");
    const r = await (await send("/api/chats/ch/steward/history", "POST")).json();
    expect(r.status["Jaime Lannister"].location.value).toBe("the Great Hall");
    expect(r.now.day).toBe(3);
    // And the Steward was told the world as it stood before those messages, not after.
    expect(JSON.stringify(sent[1].messages)).not.toContain("location: the Great Hall");
  });

  test("an edit takes a status back, and the one before it shows through", async () => {
    seed(3);
    await send("/api/chats/ch/chronicle", "POST", { kind: "status", subject: "Jaime Lannister", field: "where", value: "the window seat" });
    answers = [TRACKED];
    await stewardTurn("ch");
    expect((await chronicle()).status["Jaime Lannister"].location.value).toBe("the Great Hall");
    await send("/api/messages/m3", "PUT", { content: "Nobody moved." });
    expect((await chronicle()).status["Jaime Lannister"].location).toMatchObject({ value: "the window seat", source: "user" });
  });

  test("someone muted is away: named, but not tracked", async () => {
    seed(3);
    db.query("UPDATE chat_members SET muted = 1 WHERE character_id = 'jaime'").run();
    answers = [TRACKED];
    await stewardTurn("ch");
    expect(JSON.stringify(sent[0].messages)).toContain("2. Jaime Lannister\\n");
    expect((await chronicle()).status["Jaime Lannister"]).toBeUndefined();
  });

  test("a status by hand needs who, what and how", async () => {
    seed(3);
    expect((await send("/api/chats/ch/chronicle", "POST", { kind: "status", subject: "Loras Tyrell", field: "ambition", value: "x" })).status).toBe(400);
  });
});

describe("bonds and factions, in a chat", () => {
  const FACTION_LINE = 'FACTION | The Royal Court | the king and those about him | crown | "the court gathered in the Great Hall"';
  const BONDS = [
    'BOND | 2 | 3 | + | betrothed | "Jaime publicly affirmed his betrothal to Yvenna"',
    'BOND | 2 | 3 | +++ | "Jaime publicly affirmed his betrothal to Yvenna"',
    FACTION_LINE,
  ].join("\n");

  test("a bond moves one step, one way round, with its evidence", async () => {
    seed(3);
    answers = [BONDS];
    await stewardTurn("ch");
    const s = await chronicle();
    expect(s.bonds).toEqual([{ from: "Jaime Lannister", to: "Yvenna Hightower", score: 55, label: "betrothed",
      memory: "Jaime publicly affirmed his betrothal to Yvenna", changes: 1 }]);
  });

  test("a faction waits to be accepted, then exists with arms drawn from its emblem", async () => {
    seed(3);
    answers = [BONDS];
    await stewardTurn("ch");
    let s = await chronicle();
    expect(s.factions).toEqual([]);
    const prop = s.proposals.find((p: any) => p.kind === "faction");
    expect(prop.title).toBe("The Royal Court");
    expect(JSON.parse(prop.data).arms.charge.type).toBe("crown");
    s = await (await send(`/api/chronicle/${prop.id}/accept`, "POST")).json();
    expect(s.factions).toHaveLength(1);
    expect(s.factions[0]).toMatchObject({ name: "The Royal Court", description: "the king and those about him", standing: 0 });
    const svg = await (await ask(`/api/chats/ch/factions/${s.factions[0].key}/arms.svg`)).text();
    expect(svg).toContain('aria-label="Arms of The Royal Court"');
    expect(svg).toContain("M6 6H94");
  });

  test("a faction already known or already waiting is not put forward again", async () => {
    seed(3);
    answers = [BONDS, FACTION_LINE];
    await stewardTurn("ch");
    // Something new to read, so the next run is not a re-reading of the same words.
    setSettings({ steward_every: "1" });
    db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('m4', 'ch', 'assistant', 'Loras Tyrell', ?, ?)")
      .run("The court gathered in the Great Hall again that evening, and the king said nothing.", Date.now());
    await stewardTurn("ch");
    expect(JSON.stringify(sent[1].messages)).toContain("Factions already known: The Royal Court");
    expect((await chronicle()).proposals.filter((p: any) => p.kind === "faction")).toHaveLength(1);
  });

  test("factions by hand: made, given arms, renamed, and gone", async () => {
    seed(3);
    let s = await (await send("/api/chats/ch/chronicle", "POST", { kind: "faction", name: "House Hightower",
      arms: { field: { colours: ["silver"] }, charge: { type: "tower", colour: "gold" } }, members: ["Yvenna Hightower"] })).json();
    const key = s.factions[0].key;
    // Gold on silver breaks the rule of tincture, and is corrected rather than refused.
    expect(s.factions[0].arms.charge).toEqual({ type: "tower", colour: "gules", count: 1 });
    expect(s.factions[0].members).toEqual(["Yvenna Hightower"]);
    s = await (await send("/api/chats/ch/chronicle", "POST", { kind: "faction", key, name: "The Hightowers of Oldtown" })).json();
    expect(s.factions[0]).toMatchObject({ key, name: "The Hightowers of Oldtown", members: ["Yvenna Hightower"] });
    expect(s.factions[0].arms.charge.type).toBe("tower");
    s = await (await send("/api/chats/ch/chronicle", "POST", { kind: "standing", key, amount: -20 })).json();
    expect(s.factions[0].standing).toBe(-20);
    s = await (await send("/api/chats/ch/chronicle", "POST", { kind: "faction", key, gone: true })).json();
    expect(s.factions).toEqual([]);
    expect((await send("/api/chats/ch/chronicle", "POST", { kind: "standing", key: "nope", amount: 5 })).status).toBe(404);
  });

  test("with the rule switched off, arms are drawn as chosen", async () => {
    seed(3);
    setSettings({ heraldry_contrast: "0" });
    const s = await (await send("/api/chats/ch/chronicle", "POST", { kind: "faction", name: "Gilt",
      arms: { field: { colours: ["silver"] }, charge: { type: "tower", colour: "gold" } } })).json();
    expect(s.factions[0].arms.charge.colour).toBe("or");
  });

  test("a story on the modern calendar gets badges, not shields", async () => {
    seed(3);
    await send("/api/chats/ch/calendar", "PUT", { id: "modern" });
    const s = await (await send("/api/chats/ch/chronicle", "POST", { kind: "faction", name: "Hightower Holdings" })).json();
    const svg = await (await ask(`/api/chats/ch/factions/${s.factions[0].key}/arms.svg`)).text();
    expect(svg).toContain("A46 46");
  });

  test("a bond by hand can be set outright", async () => {
    seed(3);
    const s = await (await send("/api/chats/ch/chronicle", "POST", { kind: "bond", from: "Cersei Lannister", to: "Yvenna Hightower", score: 0, label: "open enmity" })).json();
    expect(s.bonds[0]).toMatchObject({ score: 0, label: "open enmity" });
    expect((await send("/api/chats/ch/chronicle", "POST", { kind: "bond", from: "Cersei", to: "Cersei" })).status).toBe(400);
  });

  test("a branch takes its bonds and factions with it", async () => {
    seed(3);
    answers = [BONDS];
    await stewardTurn("ch");
    await send("/api/chats/ch/chronicle", "POST", { kind: "faction", name: "House Hightower" });
    const branch = await (await ask("/api/messages/m3/branch", { method: "POST" })).json();
    const s = await (await ask(`/api/chats/${branch.id}/chronicle`)).json();
    expect(s.bonds[0].score).toBe(55);
    expect(s.factions.map((f: any) => f.name)).toEqual(["House Hightower"]);
  });
});

test("the server finds the charges wherever a build keeps them", async () => {
  const { readAssetsWith } = await import("./index");
  seed(3);
  const files: Record<string, string> = {
    "/charges/manifest.json": JSON.stringify({ assets: [{ id: "only_one", svg: "x/only_one.svg" }] }),
    "/charges/x/only_one.svg": '<svg viewBox="0 0 100 100"><path fill="currentColor" d="M10,10 90,10 90,90Z"/></svg>',
  };
  readAssetsWith(async (p) => files[p] ?? null);
  try {
    const s = await (await send("/api/chats/ch/chronicle", "POST", { kind: "faction", name: "Anyone" })).json();
    expect(s.factions[0].arms.charge.type).toBe("only_one");
  } finally {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    readAssetsWith(async (p) => { try { return readFileSync(join("public", p), "utf8"); } catch { return null; } });
  }
});
