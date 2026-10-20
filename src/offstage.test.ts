/**
 * The Living World: people decide offstage from inside their own heads, and
 * the narrator learns only what became true and what could be noticed —
 * never who did it, never why, never a plan.
 *
 *   bun test src/offstage.test.ts
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { identityOf, names, pressureOf, readDecision, resolve, rule } from "./offstage";
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

  test("pointing at them without a name is caught too: title, house, the factions they are in", () => {
    const id = identityOf("Cersei Lannister", "Queen. Proud, jealous, careful of her own neck.", ["The Lannister Crown", "The Kingsguard"]);
    const leak = (line: string) => rule(readDecision(`CHOOSE | it | x\nACT | has the contract taken | uncertain | none\nFACT | ${line}`), { ...base, identity: id }).fact;
    expect(leak("The queen's personal handmaiden was seen leaving with the contract")).toBe("");
    expect(leak("A Lannister cloak-pin was found by the chest")).toBe("");
    expect(leak("A man in a Kingsguard cloak was seen near the study")).toBe("");
    expect(leak("The marriage contract is missing")).toBe("The marriage contract is missing");
  });

  test("the one deliberate clue: only from something that could fail, and kept only if it did", () => {
    const d = readDecision("CHOOSE | it | x\nACT | bribes the steward for the contract | uncertain | none\nFACT | the contract is missing\nCLUE | a Lannister cloak-pin by the chest");
    expect(rule(d, base).clue).toBe("a Lannister cloak-pin by the chest");
    const easy = readDecision("CHOOSE | it | x\nACT | writes to her uncle | easy | none\nCLUE | a letter with her seal");
    expect(rule(easy, base).clue).toBe("");
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

  test("a failed attempt leaves its clue; a successful one changes the world and leaves none", async () => {
    seed();
    await goal("Cersei Lannister", "get the marriage contract");
    const plan = "CHOOSE | it | x\nACT | bribes the maester's boy for the marriage contract | uncertain | none\nSEEN | the maester's boy has new boots\nFACT | the marriage contract is missing\nCLUE | a Lannister cloak-pin under the maester's table";
    const roll = Math.random;
    try {
      Math.random = () => 0; // a 1: it fails
      answers = [plan];
      await send("/api/chats/ch/offstage/run", "POST");
      let told = await narrator();
      expect(told).toContain("a Lannister cloak-pin under the maester's table");
      expect(told).not.toContain("the marriage contract is missing");
      expect(told).toContain("the maester's boy has new boots");
      seed();
      await goal("Cersei Lannister", "get the marriage contract");
      Math.random = () => 0.99; // a 20: it works
      answers = [plan];
      await send("/api/chats/ch/offstage/run", "POST");
      told = await narrator();
      expect(told).toContain("the marriage contract is missing");
      expect(told).not.toContain("cloak-pin");
    } finally { Math.random = roll; }
  });

  describe("the reply that started a day, taken back: everything that day made goes with it", () => {
    // Two people act on one turned day: a secret action, a new goal of her own, what could be noticed,
    // what became true — and, from the other, a threat waiting to be let in.
    const DAY = [
      CERSEI_PLOTS + "\nGOAL | turn the High Septon against the match | the Faith outranks a father's word",
      "CHOOSE | it | she must not reach the wedding\nACT | hires a sellsword to waylay Yvenna Hightower on the kingsroad | uncertain | physical",
    ];
    async function dayTurnsOnAReply() {
      seed();
      setSettings({ offstage_level: "dynamic" });
      db.query("INSERT INTO characters (id, name, created_at) VALUES ('t', 'Tywin Lannister', 1)").run();
      await goal("Cersei Lannister", "stop Jaime's marriage to Yvenna");
      await goal("Tywin Lannister", "a better match for Jaime");
      await offstageTurn("ch"); // the first look only notes the day
      await send("/api/chats/ch/chronicle", "POST", { kind: "time", text: "1 day" });
      answers = [...DAY];
      story = "Morning came grey over the city.";
      await (await send("/api/chats/ch/generate", "POST", { mode: "reply", content: "We wait." })).text();
      await settle(() => ledger().then((l) => l.actions.length === 2));
      const reply = db.query("SELECT id FROM messages WHERE chat_id = 'ch' AND role = 'assistant' ORDER BY created_at DESC LIMIT 1").get() as any;
      // All of it is there, tied to that reply.
      const l = await ledger();
      expect(l.goals.map((g: any) => g.goal)).toContain("turn the High Septon against the match");
      expect((await (await ask("/api/chats/ch/chronicle")).json()).proposals.some((p: any) => p.kind === "threat")).toBe(true);
      expect(await narrator()).toContain("High Septon has heard a rumour");
      return reply.id as string;
    }
    async function settle(done: () => Promise<boolean>) {
      for (let i = 0; i < 50 && !(await done()); i++) await new Promise((r) => setTimeout(r, 20));
    }
    async function allGone() {
      const l = await ledger();
      expect(l.actions.filter((a: any) => a.outcome !== "routine")).toEqual([]);
      expect(l.goals.map((g: any) => g.goal).sort()).toEqual(["a better match for Jaime", "stop Jaime's marriage to Yvenna"]);
      expect(l.told).toEqual({ facts: [], hooks: [] });
      expect((await (await ask("/api/chats/ch/chronicle")).json()).proposals).toEqual([]);
      const told = await narrator();
      for (const gone of ["High Septon", "septa seems nervous", "sellsword"]) expect(told).not.toContain(gone);
      // Cersei's own memory of it is gone too: what she did is not among what she knows next time.
      answers = ["CHOOSE | NOTHING | x\nACT | rests | easy | none", "CHOOSE | NOTHING | x\nACT | rests | easy | none"];
      await send("/api/chats/ch/offstage/run", "POST");
      expect(JSON.stringify(sent)).not.toContain("How their own recent attempts went:\\n- Cersei pays");
    }

    test("swiped: gone, and the day gets its turn again from the new reply", async () => {
      await dayTurnsOnAReply();
      answers = []; // the new take's day: quiet
      story = "A different morning.";
      await (await send("/api/chats/ch/generate", "POST", { mode: "swipe" })).text();
      await settle(() => ledger().then((l) => l.actions.length >= 2 && l.actions.every((a: any) => a.outcome === "routine")));
      const l = await ledger();
      expect(l.actions.length).toBe(2);
      expect(l.actions.every((a: any) => a.outcome === "routine")).toBe(true);
      await allGone();
    });

    test("edited: gone", async () => {
      const id = await dayTurnsOnAReply();
      await send(`/api/messages/${id}`, "PUT", { content: "Morning came, and nothing else." });
      await allGone();
    });

    test("deleted: gone", async () => {
      const id = await dayTurnsOnAReply();
      await send(`/api/messages/${id}`, "DELETE");
      await allGone();
    });
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

describe("Story World switched off: plain story, nothing kept, nothing told", () => {
  test("no world block reaches the narrator, the Offstage never runs, the Steward never reads", async () => {
    seed();
    await goal("Cersei Lannister", "stop Jaime's marriage to Yvenna");
    answers = [CERSEI_PLOTS];
    await send("/api/chats/ch/offstage/run", "POST");
    expect(await narrator()).toContain("High Septon");
    setSettings({ story_world: "0", steward_on: "1" });
    expect(await narrator()).not.toContain("High Septon");
    await offstageTurn("ch");
    sent = [];
    story = "Night fell.";
    await (await send("/api/chats/ch/generate", "POST", { mode: "reply", content: "We sleep." })).text();
    await new Promise((r) => setTimeout(r, 100));
    // Only the story itself was asked for: no Steward reading, no Offstage day.
    expect(sent.length).toBe(1);
    expect(sent[0].stream).toBe(true);
    // Switched back on, everything kept from before is still there.
    setSettings({ story_world: "1" });
    expect(await narrator()).toContain("High Septon");
  });
});
