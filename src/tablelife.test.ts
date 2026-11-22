/**
 * The Living World at the table works as well as it does in a story. Since its first build it simply did not run
 * there. Now the table's difficulty is how hard the world is on the party, a threat never waits to be asked
 * about (the dice settle it), and the Gamekeeper and the people at the table are never moved offstage.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db, setSettings, wipe } from "./test-support";
const { app, offstageTurn, forgetPresence, worldProtection, threatsAsk } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body?: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });
let sent: any[] = [];
let answers: string[] = [];
beforeEach(() => {
  sent = []; answers = [];
  globalThis.fetch = (async (_u: any, init: any) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    if (JSON.stringify(body.messages).includes("say who is physically there") || String(body.messages?.[0]?.content ?? "").includes("For each person in the list")) {
      return Response.json({ choices: [{ message: { content: "AWAY | Cersei Lannister | the Red Keep" } }] });
    }
    return Response.json({ choices: [{ message: { content: answers.shift() ?? "CHOOSE | NOTHING | a quiet day\nACT | reads in the garden | easy | none" } }] });
  }) as any;
});
afterEach(() => { globalThis.fetch = realFetch; setSettings({ mode: "story" }); });

function table(difficulty = "faircount") {
  wipe();
  forgetPresence();
  setSettings({ mode: "tabletop", tabletop_difficulty: difficulty, tabletop_persona: "y", provider: "openrouter", key_openrouter: "sk", model: "story/model",
    steward_on: "0", offstage_level: "dynamic", offstage_protection: "sheltered", offstage_per_day: "6", offstage_threat_ask: "1" });
  db.query("INSERT INTO characters (id, name, created_at, world) VALUES ('g', 'The Gamekeeper', 1, 'both'), ('c', 'Cersei Lannister', 1, 'tabletop')").run();
  db.query("INSERT INTO personas (id, name, created_at) VALUES ('y', 'Yvenna Hightower', 1), ('b', 'Bran the Bold', 1)").run();
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at, persona_id) VALUES ('ch', 'g', 'The Road', 1, 1, 'y')").run();
  db.query("INSERT INTO chat_members (id, chat_id, character_id, position) VALUES ('x0', 'ch', 'g', 0), ('x1', 'ch', 'c', 1)").run();
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('m1', 'ch', 'assistant', 'The Gamekeeper', 'The road runs north.', 2)").run();
  db.query("INSERT INTO shares (id, chat_id, token, open, created_at) VALUES ('s', 'ch', 'st', 1, 1)").run();
  db.query("INSERT INTO players (id, share_id, token, name, persona_id, host, seen_at, created_at) VALUES ('p', 's', 't', 'Bran', 'b', 0, 0, 1)").run();
}
const deciding = () => sent.map((b) => JSON.stringify(b.messages)).filter((m) => m.includes("You are deciding for:"))
  .map((m) => m.match(/You are deciding for: ([^\\\n.]+)/)?.[1]);

describe("the Living World, at the table", () => {
  test("the dial is the difficulty, and nothing is held back to ask", () => {
    expect(worldProtection({ mode: "tabletop", tabletop_difficulty: "hearthlight", offstage_protection: "grim" })).toBe("sheltered");
    expect(worldProtection({ mode: "tabletop", tabletop_difficulty: "faircount", offstage_protection: "grim" })).toBe("fair");
    expect(worldProtection({ mode: "tabletop", tabletop_difficulty: "hardwinter", offstage_protection: "sheltered" })).toBe("grim");
    expect(worldProtection({ mode: "story", tabletop_difficulty: "hardwinter", offstage_protection: "sheltered" })).toBe("sheltered");
    expect(threatsAsk({ mode: "tabletop", offstage_threat_ask: "1" })).toBe(false);
    expect(threatsAsk({ mode: "story", offstage_threat_ask: "1" })).toBe(true);
  });

  test("a day passes at the table, not only in a story: someone offstage acts", async () => {
    table();
    await offstageTurn("ch"); // the first look notes the day
    db.query("INSERT INTO chronicle (id, chat_id, kind, span, title, source, created_at) VALUES ('d', 'ch', 'time', 86400, 'later', 'user', 5)").run();
    await offstageTurn("ch");
    expect(deciding()).toContain("Cersei Lannister");
  });

  test("the world moves its people, never the Gamekeeper or anyone playing", async () => {
    table();
    for (const who of ["The Gamekeeper", "Bran the Bold", "Bran", "Cersei Lannister"]) await send("/api/chats/ch/offstage/goal", "POST", { who, goal: "get north" });
    await send("/api/chats/ch/offstage/run", "POST");
    await send("/api/chats/ch/offstage/run", "POST");
    const who = new Set(deciding());
    expect(who.has("Cersei Lannister")).toBe(true);
    for (const never of ["The Gamekeeper", "Bran the Bold", "Bran", "Yvenna Hightower"]) expect(who.has(never)).toBe(false);
  });

  test("a threat comes straight in, and as something for the dice: a fight, or a check", async () => {
    table("hardwinter");
    await send("/api/chats/ch/offstage/goal", "POST", { who: "Cersei Lannister", goal: "be rid of Yvenna" });
    answers = ["CHOOSE | it | desperate\nACT | sends three sellswords to ambush Yvenna Hightower on the road | uncertain | grave\nFACT | Yvenna is dead"];
    expect((await (await send("/api/chats/ch/offstage/run", "POST")).json()).threats).toBe(1);
    const state = await (await ask("/api/chats/ch/chronicle")).json();
    expect(state.proposals.filter((p: any) => p.kind === "threat")).toEqual([]);
    const told = JSON.stringify((await (await send("/api/chats/ch/inspect", "POST", {})).json()).sections);
    expect(told).toContain("ambush Yvenna Hightower");
    expect(told).toContain("[[fight: the attackers]]");
    expect(told).not.toContain("Yvenna is dead");
  });

  test("in a story it is as it was: protection is its own dial, and a threat can be asked about", async () => {
    table();
    setSettings({ mode: "story", offstage_protection: "fair" });
    await send("/api/chats/ch/offstage/goal", "POST", { who: "Cersei Lannister", goal: "be rid of Yvenna" });
    answers = ["CHOOSE | it | desperate\nACT | sends a man to push Yvenna Hightower from the walls | uncertain | grave\nFACT | Yvenna is dead"];
    await send("/api/chats/ch/offstage/run", "POST");
    const state = await (await ask("/api/chats/ch/chronicle")).json();
    expect(state.proposals.some((p: any) => p.kind === "threat")).toBe(true);
  });
});
