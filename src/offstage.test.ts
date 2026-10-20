/**
 * The Living World: people decide offstage from inside their own heads, and
 * the narrator learns only what became true and what could be noticed —
 * never who did it, never why, never a plan.
 *
 *   bun test src/offstage.test.ts
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { names, pressureOf, readDecision, resolve, rule } from "./offstage";
import { db, setSettings, wipe } from "./test-support";

const { app, offstageTurn } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body?: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });

let sent: any[] = [];
let answers: string[] = [];
let story = "The court is quiet.";
beforeEach(() => {
  sent = [];
  answers = [];
  globalThis.fetch = (async (_u: any, init: any) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    // A story reply streams; the Offstage and the Steward ask without streaming.
    if (body.stream) {
      const enc = new TextEncoder();
      return new Response(new ReadableStream({ start(c) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: story } }] })}\n\n`));
        c.enqueue(enc.encode("data: [DONE]\n\n")); c.close();
      } }), { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ choices: [{ message: { content: answers.shift() ?? "CHOOSE | NOTHING | a quiet day\nACT | reads in the garden | easy | none" } }] });
  }) as any;
});
afterEach(() => { globalThis.fetch = realFetch; });

const CERSEI_PLOTS = [
  "WANT | to stop the Hightower wedding | losing Jaime to that girl",
  "CONSIDER | poison her | if traced, Jaime's fury and my head",
  "CONSIDER | have the septa spread word of her Targaryen blood | it could be traced to me, but slowly",
  "CHOOSE | the septa | quiet, deniable, and slow enough to stop",
  "ACT | Cersei pays Yvenna's septa to whisper to the High Septon about Targaryen blood | easy | social",
  "SEEN | Yvenna's septa seems nervous and avoids her eyes",
  "FACT | the High Septon has heard a rumour about Hightower blood",
].join("\n");

function seed() {
  wipe();
  setSettings({ mode: "story", provider: "openrouter", key_openrouter: "sk", model: "story/model", steward_on: "0",
    offstage_level: "balanced", offstage_protection: "fair", offstage_per_day: "2" });
  db.query("INSERT INTO characters (id, name, description, created_at) VALUES ('c', 'Cersei Lannister', 'Queen. Proud, jealous, careful of her own neck.', 1)").run();
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('j', 'Jaime Lannister', 1)").run();
  db.query("INSERT INTO personas (id, name, created_at) VALUES ('y', 'Yvenna Hightower', 1)").run();
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at, persona_id) VALUES ('ch', 'j', 'The Hand', 1, 1, 'y')").run();
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('m1', 'ch', 'assistant', 'Jaime Lannister', 'The court gathered.', 2)").run();
}
const ledger = async () => (await ask("/api/chats/ch/offstage")).json();
const narrator = async () => {
  const r = await (await send("/api/chats/ch/inspect", "POST", {})).json();
  return JSON.stringify(r.sections);
};
const goal = (who: string, g: string, why = "") => send("/api/chats/ch/offstage/goal", "POST", { who, goal: g, why });

describe("the rules, in code", () => {
  const base = { who: "Cersei Lannister", player: "Yvenna Hightower", protection: "fair" as const, goals: [{ id: "g", who: "Cersei Lannister", goal: "stop the wedding", why: "" }] };

  test("what could be seen, or what became true, never names who did it", () => {
    const r = rule(readDecision("CHOOSE | it | x\nACT | sends a letter | easy | none\nSEEN | Cersei's maid hurries out\nFACT | a letter left the Red Keep"), base);
    expect(r.seen).toBe("");
    expect(r.fact).toBe("a letter left the Red Keep");
    expect(names("the Queen's maid", "Cersei Lannister")).toBe(false);
    expect(names("Lannister guards", "Cersei Lannister")).toBe(true);
  });

  test("harm to the player's body: fair makes it a scene, sheltered forbids it, grim allows all but the grave", () => {
    const d = readDecision("CHOOSE | it | x\nACT | has Yvenna Hightower pushed down the stairs | uncertain | physical\nFACT | Yvenna is hurt");
    expect(rule(d, base)).toMatchObject({ kind: "act", threat: true, fact: "" });
    expect(rule(d, { ...base, protection: "sheltered" }).kind).toBe("dropped");
    expect(rule(d, { ...base, protection: "grim" }).threat).toBe(false);
    const grave = readDecision("CHOOSE | it | x\nACT | poisons Yvenna Hightower's wine | hard | grave");
    expect(rule(grave, { ...base, protection: "grim" }).threat).toBe(true);
  });

  test("never acts for the player's character", () => {
    expect(rule(readDecision("CHOOSE | it | x\nACT | Yvenna confesses everything to Jaime | easy | social"), base).kind).toBe("dropped");
  });

  test("doing nothing is a day, with nothing to see; giving up names the goal", () => {
    const quiet = rule(readDecision("CHOOSE | NOTHING | tired\nACT | sleeps late | easy | none\nSEEN | the queen's door stays shut"), base);
    expect(quiet).toMatchObject({ kind: "nothing", seen: "", fact: "" });
    const quit = rule(readDecision("CHOOSE | ABANDON | the wedding is not worth losing Jaime over\nGOAL | win Jaime back | he is all she has"), base);
    expect(quit).toMatchObject({ kind: "abandon", abandons: "g", goal: { goal: "win Jaime back" } });
  });

  test("only the uncertain is rolled", () => {
    expect(resolve("easy", () => 0)).toEqual({ succeeded: true, roll: null, dc: 0 });
    expect(resolve("uncertain", () => 0)).toMatchObject({ succeeded: false, roll: 1, dc: 11 });
    expect(resolve("hard", () => 0.99)).toMatchObject({ succeeded: true, roll: 20, dc: 16 });
  });

  test("pressure, in words, from failure and time", () => {
    expect(pressureOf([{ succeeded: false }, { succeeded: false }], 3)).toContain("failed");
    expect(pressureOf([{ succeeded: true }], 20)).toContain("20 days");
    expect(pressureOf([{ succeeded: true }], 2)).toBe("");
  });
});

describe("a day offstage", () => {
  test("Cersei schemes; the narrator is handed what became true and what could be noticed — and nothing else", async () => {
    seed();
    await goal("Cersei Lannister", "stop Jaime's marriage to Yvenna", "jealousy, and fear of losing him");
    answers = [CERSEI_PLOTS];
    const r = await (await send("/api/chats/ch/offstage/run", "POST")).json();
    expect(r).toMatchObject({ acted: 1, threats: 0 });

    // She decided from her own head: her card and goal were there; the player's private notes were not.
    const asked = JSON.stringify(sent.at(-1));
    expect(asked).toContain("You are deciding for: Cersei Lannister");
    expect(asked).toContain("Proud, jealous, careful of her own neck");
    expect(asked).toContain("stop Jaime's marriage to Yvenna");

    const told = await narrator();
    expect(told).toContain("the High Septon has heard a rumour about Hightower blood");
    expect(told).toContain("Yvenna's septa seems nervous and avoids her eyes");
    expect(told).toContain("Never decide that they noticed");
    for (const secret of ["pays Yvenna's septa", "stop Jaime's marriage", "jealousy", "losing Jaime", "Cersei Lannister pays"]) {
      expect(told).not.toContain(secret);
    }
    // Not in Story World's ordinary pages, not at a guest's table: only the sealed ledger has it.
    const world = JSON.stringify(await (await ask("/api/chats/ch/chronicle")).json());
    expect(world).not.toContain("pays Yvenna's septa");
    expect(world).not.toContain("High Septon");
    const l = await ledger();
    expect(l.actions[0]).toMatchObject({ who: "Cersei Lannister", outcome: "succeeded", roll: null });
    expect(l.goals[0]).toMatchObject({ who: "Cersei Lannister", status: "active" });
  });

  test("a threat to the player's character is a question, then a scene for one reply, never an outcome", async () => {
    seed();
    await goal("Cersei Lannister", "be rid of Yvenna");
    answers = ["CHOOSE | it | desperate\nACT | sends a man to push Yvenna Hightower from the walls | uncertain | grave\nFACT | Yvenna is dead"];
    expect((await (await send("/api/chats/ch/offstage/run", "POST")).json()).threats).toBe(1);
    let state = await (await ask("/api/chats/ch/chronicle")).json();
    const q = state.proposals.find((p: any) => p.kind === "threat");
    expect(q.title).toBe("");
    expect(JSON.stringify(state)).not.toContain("push Yvenna");
    expect(await narrator()).not.toContain("push Yvenna");
    expect(await narrator()).not.toContain("Yvenna is dead");

    await send(`/api/chronicle/${q.id}/accept`, "POST");
    expect(await narrator()).toContain("do not decide whether it succeeds");
    expect(await narrator()).toContain("push Yvenna Hightower from the walls");
    // One reply later it has had its scene.
    await (await send("/api/chats/ch/generate", "POST", { mode: "reply", content: "I walk the walls." })).text();
    expect(await narrator()).not.toContain("push Yvenna");
  });

  test("once a story day, after a reply — not per message, and not the first time it is switched on", async () => {
    seed();
    await goal("Cersei Lannister", "stop the wedding");
    await offstageTurn("ch");
    expect((await ledger()).actions).toEqual([]);
    await send("/api/chats/ch/chronicle", "POST", { kind: "time", text: "1 day" });
    answers = [CERSEI_PLOTS];
    await offstageTurn("ch");
    await offstageTurn("ch");
    expect((await ledger()).actions).toHaveLength(1);
  });

  test("off is off, and giving up a goal ends it", async () => {
    seed();
    setSettings({ offstage_level: "off" });
    await goal("Cersei Lannister", "stop the wedding");
    await send("/api/chats/ch/chronicle", "POST", { kind: "time", text: "1 day" });
    await offstageTurn("ch");
    await send("/api/chats/ch/chronicle", "POST", { kind: "time", text: "1 day" });
    await offstageTurn("ch");
    expect((await ledger()).actions).toEqual([]);

    answers = ["CHOOSE | ABANDON | the wedding is not worth losing Jaime\nACT | lets the matter rest | easy | none"];
    await send("/api/chats/ch/offstage/run", "POST");
    expect((await ledger()).goals[0].status).toBe("abandoned");
    expect((await (await send("/api/chats/ch/offstage/run", "POST")).json()).note).toBe("Nobody has a goal yet.");
  });

  test("swiping the reply that started a run takes the run back with it", async () => {
    seed();
    await goal("Cersei Lannister", "stop the wedding");
    answers = [CERSEI_PLOTS];
    await send("/api/chats/ch/offstage/run", "POST");
    expect(await narrator()).toContain("High Septon");
    story = "Another take.";
    await (await send("/api/chats/ch/generate", "POST", { mode: "swipe" })).text();
    expect((await ledger()).actions).toEqual([]);
    expect(await narrator()).not.toContain("High Septon");
  });
});
