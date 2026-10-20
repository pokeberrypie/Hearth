/**
 * The Living World: people decide offstage from inside their own heads, and
 * the narrator learns only what became true and what could be noticed —
 * never who did it, never why, never a plan.
 *
 *   bun test src/offstage.test.ts
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { identityOf, names, pressureOf, readDecision, resolve, rule, traceOf } from "./offstage";
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

  test("whether it left a trace is its own roll: success can be seen, failure can go unnoticed, easy leaves nothing", () => {
    const at = (n: number) => () => (n - 1) / 20;
    expect(traceOf("uncertain", true, at(5))).toEqual({ left: true, roll: 5, dc: 6 });
    expect(traceOf("uncertain", true, at(6)).left).toBe(false);
    expect(traceOf("uncertain", false, at(12)).left).toBe(true);
    expect(traceOf("uncertain", false, at(13)).left).toBe(false);
    expect(traceOf("hard", true, at(8)).left).toBe(true);
    expect(traceOf("hard", false, at(15)).left).toBe(true);
    expect(traceOf("easy", false, at(1))).toEqual({ left: false, roll: null, dc: 0 });
  });

  test("the one deliberate clue: only from something that could go wrong", () => {
    const d = readDecision("CHOOSE | it | x\nACT | bribes the steward for the contract | uncertain | none\nFACT | the contract is missing\nCLUE | a Lannister cloak-pin by the chest");
    expect(rule(d, base).clue).toBe("a Lannister cloak-pin by the chest");
    const easy = readDecision("CHOOSE | it | x\nACT | writes to her uncle | easy | none\nCLUE | a letter with her seal");
    expect(rule(easy, base).clue).toBe("");
  });

  test("a thread's name is public the day it comes out: one that points to them is refused", () => {
    const id = identityOf("Cersei Lannister", "Queen.", []);
    const d = readDecision(["CHOOSE | it | x", "ACT | has the septa whisper | uncertain | social",
      "THREAD | open | Cersei's Plot Against Yvenna | the septa is paid", "THREAD | open | The Queen's Scheme | x",
      "THREAD | complicate | The Hightower Wedding | the septa's tale reaches the Faith", "THREAD | open | Whispers at Court | a rumour of Targaryen blood"].join("\n"));
    expect(d.threads.length).toBe(4);
    const r = rule(d, { ...base, identity: id });
    // Two at most, and never the ones that name her.
    expect(r.threads).toEqual([{ move: "complicate", name: "The Hightower Wedding", note: "the septa's tale reaches the Faith" },
      { move: "open", name: "Whispers at Court", note: "a rumour of Targaryen blood" }]);
    expect(rule(readDecision("CHOOSE | it | x\nACT | rests | easy | none\nTHREAD | open | Whispers at Court | x"), base).threads.length).toBe(1);
    expect(rule(readDecision("CHOOSE | NOTHING | x\nACT | rests | easy | none\nTHREAD | open | Whispers at Court | x"), base).threads).toEqual([]);
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

  test("whether it worked and whether it was seen are rolled apart", async () => {
    const plan = "CHOOSE | it | x\nACT | bribes the maester's boy for the marriage contract | uncertain | none\nSEEN | the maester's boy has new boots\nFACT | the marriage contract is missing\nCLUE | a Lannister cloak-pin under the maester's table";
    const roll = Math.random;
    try {
      const rolls = (...r: number[]) => { const q = [...r]; Math.random = () => q.shift() ?? 0.5; };
      const day = async (...r: number[]) => {
        seed();
        await goal("Cersei Lannister", "get the marriage contract");
        rolls(...r);
        answers = [plan];
        await send("/api/chats/ch/offstage/run", "POST");
        return narrator();
      };
      // Botched and caught: the boy took the gold to the steward, and her pin is under the table.
      let told = await day(0, 0);
      expect(told).toContain("cloak-pin");
      expect(told).not.toContain("the marriage contract is missing");
      expect(told).toContain("the maester's boy has new boots");
      // Clean: the contract is gone and nothing points anywhere.
      told = await day(0.99, 0.99);
      expect(told).toContain("the marriage contract is missing");
      expect(told).not.toContain("cloak-pin");
      // It worked — and someone saw. The theft stands; the secret may not.
      told = await day(0.99, 0);
      expect(told).toContain("the marriage contract is missing");
      expect(told).toContain("cloak-pin");
      const act = (await ledger()).actions[0];
      expect(act).toMatchObject({ outcome: "succeeded", traced: true, trace_roll: 1, trace_dc: 6 });
      // Botched, but nobody noticed: nothing done, nothing found.
      told = await day(0, 0.99);
      expect(told).not.toContain("the marriage contract is missing");
      expect(told).not.toContain("cloak-pin");
    } finally { Math.random = roll; }
  });

  describe("the reply that started a day, taken back: everything that day made goes with it", () => {
    // Two people act on one turned day: a secret action, a new goal of her own, what could be noticed,
    // what became true — and, from the other, a threat waiting to be let in.
    const DAY = [
      CERSEI_PLOTS + "\nGOAL | turn the High Septon against the match | the Faith outranks a father's word\nTHREAD | open | Whispers at Court | the septa's tale has begun",
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
      expect(l.threads.map((t: any) => t.title)).toEqual(["Whispers at Court"]);
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
      expect(l.threads).toEqual([]);
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

describe("Threads, moved by the world: hidden until the story shows them", () => {
  const threadsOnPage = async () => (await (await ask("/api/chats/ch/chronicle")).json()).threads;
  const offstageAsked = () => sent.filter((b) => !b.stream).map((b) => JSON.stringify(b.messages)).join("\n");
  const act = (lines: string) => `CHOOSE | it | x\nACT | ${lines}`;

  test("a matter she starts in secret is hers and the ledger's — not the story's, not the Threads page — until it comes out", async () => {
    seed();
    await goal("Cersei Lannister", "stop the Hightower wedding");
    answers = [act("pays Yvenna's septa to whisper to the High Septon | easy | social\nTHREAD | open | Whispers at Court | the septa has been paid")];
    await send("/api/chats/ch/offstage/run", "POST");
    expect(await threadsOnPage()).toEqual([]);
    expect(await narrator()).not.toContain("Whispers at Court");
    const l = await ledger();
    expect(l.threads).toMatchObject([{ title: "Whispers at Court", open: true, hidden: true, notes: [{ by: "Cersei Lannister", move: "open", text: "the septa has been paid" }] }]);
    // It weighs on her the next day — and on nobody else.
    sent = [];
    setSettings({ offstage_level: "dynamic" });
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('o', 'Olenna Tyrell', 1)").run();
    await goal("Olenna Tyrell", "keep the Hightowers in her debt");
    await send("/api/chats/ch/chronicle", "POST", { kind: "time", text: "1 day" });
    answers = [];
    await send("/api/chats/ch/offstage/run", "POST");
    const asked = sent.filter((b) => !b.stream).map((b) => JSON.stringify(b.messages));
    expect(asked.find((m) => m.includes("deciding for: Cersei"))).toContain("Whispers at Court (nobody else knows of it yet) — last: the septa has been paid");
    expect(asked.find((m) => m.includes("deciding for: Olenna"))).not.toContain("Whispers at Court");
    // The story shows it — here, the author naming it on the page, as the Steward does from the story's words: same thread, now in the open.
    await send("/api/chats/ch/chronicle", "POST", { kind: "thread", name: "Whispers at Court" });
    const page = await threadsOnPage();
    expect(page).toMatchObject([{ title: "Whispers at Court", open: true, hidden: false }]);
    // Only its public side: what she did to it stays in the ledger.
    expect(JSON.stringify(page)).not.toContain("septa");
    expect(await narrator()).toContain("Whispers at Court");
    expect(await narrator()).not.toContain("septa has been paid");
  });

  test("a thread the story already has weighs on whoever it touches, and what they do to it stays private", async () => {
    seed();
    await send("/api/chats/ch/chronicle", "POST", { kind: "thread", name: "The Hightower Wedding" });
    await goal("Cersei Lannister", "stop the Hightower wedding");
    answers = [act("delays the wedding silks from Myr | easy | none\nTHREAD | complicate | The Hightower Wedding | the silks will be late")];
    await send("/api/chats/ch/offstage/run", "POST");
    expect(offstageAsked()).toContain("Unresolved matters they are caught up in");
    expect(offstageAsked()).toContain("- The Hightower Wedding");
    const page = await threadsOnPage();
    expect(page).toMatchObject([{ title: "The Hightower Wedding", open: true, notes: [] }]);
    expect((await ledger()).threads).toMatchObject([{ title: "The Hightower Wedding", hidden: false, notes: [{ move: "complicate", text: "the silks will be late" }] }]);
    expect(await narrator()).not.toContain("silks");
  });

  test("checked against the threads there are: the same matter twice is one, a thread that isn't there is not moved", async () => {
    seed();
    await send("/api/chats/ch/chronicle", "POST", { kind: "thread", name: "The Hightower Wedding" });
    await goal("Cersei Lannister", "stop the Hightower wedding");
    answers = [act("writes to Oldtown | easy | none\nTHREAD | open | Hightower Wedding | she wrote to Oldtown\nTHREAD | advance | The Dornish Question | x")];
    await send("/api/chats/ch/offstage/run", "POST");
    const l = await ledger();
    expect(l.threads.map((t: any) => t.title)).toEqual(["The Hightower Wedding"]);
    expect(l.threads[0].notes).toMatchObject([{ move: "advance", text: "she wrote to Oldtown" }]);
    expect(l.actions[0].notes).toContain("moved a thread there is none of: The Dornish Question");
  });

  test("settled offstage: only if it worked, and in the open only in the words of what became true", async () => {
    seed();
    await send("/api/chats/ch/chronicle", "POST", { kind: "thread", name: "The Missing Contract" });
    await goal("Cersei Lannister", "be rid of the contract question");
    const plan = act("has the contract left where the steward will find it | uncertain | none\nFACT | the marriage contract is found in the archive, no one knows how\nTHREAD | settle | The Missing Contract | she put it back");
    const roll = Math.random;
    try {
      Math.random = () => 0; // it fails: nothing settles
      answers = [plan];
      await send("/api/chats/ch/offstage/run", "POST");
      expect((await threadsOnPage())[0].open).toBe(true);
      expect((await ledger()).actions[0].notes).toContain("it failed, so The Missing Contract is not settled");
      seed();
      await send("/api/chats/ch/chronicle", "POST", { kind: "thread", name: "The Missing Contract" });
      await goal("Cersei Lannister", "be rid of the contract question");
      Math.random = () => 0.99; // it works
      answers = [plan];
      await send("/api/chats/ch/offstage/run", "POST");
      const page = await threadsOnPage();
      expect(page).toMatchObject([{ title: "The Missing Contract", open: false }]);
      expect(page[0].notes.map((n: any) => n.text)).toEqual(["the marriage contract is found in the archive, no one knows how"]);
      expect(JSON.stringify(page)).not.toContain("she put it back");
    } finally { Math.random = roll; }
  });
});

describe("Living World, joined up: participants, discretion, the author's plan, and who knows what", () => {
  const act = (lines: string) => `CHOOSE | it | x\nACT | ${lines}`;
  const rows = (kind: string) => db.query("SELECT * FROM chronicle WHERE chat_id = 'ch' AND kind = ? AND undone_at IS NULL").all(kind) as any[];
  const asked = () => sent.filter((b) => !b.stream).map((b) => JSON.stringify(b.messages)).join("\n");

  test("a thread says who it involves, so she sees it whatever it is called — and threads moved together stay tied", async () => {
    seed();
    setSettings({ gossip_level: "off" });
    await send("/api/chats/ch/chronicle", "POST", { kind: "thread", name: "The Northern Alliance", people: ["Cersei Lannister"] });
    await goal("Cersei Lannister", "keep her father's favour");
    answers = [act("writes to the Starks | easy | none\nTHREAD | complicate | The Northern Alliance | a letter to Winterfell\nTHREAD | open | Whispers at Court | the septa is paid")];
    await send("/api/chats/ch/offstage/run", "POST");
    expect(asked()).toContain("- The Northern Alliance");
    const opened = rows("thread").find((e) => e.title === "Whispers at Court");
    expect(JSON.parse(opened.data)).toMatchObject({ people: ["Cersei Lannister"], related: ["northern alliance"] });
    // A thread named in the story records who it names.
    await send("/api/chats/ch/chronicle", "POST", { kind: "thread", name: "Jaime's promise to Yvenna" });
    expect(JSON.parse(rows("thread").find((e) => e.title === "Jaime's promise to Yvenna").data).people.sort()).toEqual(["Jaime Lannister", "Yvenna Hightower"]);
  });

  test("how careful someone is: the author's to set, told to the Offstage, and it moves the odds of a trace", async () => {
    seed();
    setSettings({ gossip_level: "off" });
    await goal("Cersei Lannister", "get the contract");
    const r = await (await send("/api/chats/ch/offstage/trait", "POST", { who: "Cersei Lannister", discretion: "masterful" })).json();
    expect(r.discretion).toEqual({ "Cersei Lannister": "masterful" });
    expect((await ledger()).discretion).toEqual({ "Cersei Lannister": "masterful" });
    const roll = Math.random;
    try {
      // Fails (1), then a trace roll of 3: an ordinary person under 13 leaves one; a masterful one only under 7 — still left.
      // A trace roll of 8 is the difference.
      Math.random = (() => { const q = [0, 7 / 20]; return () => q.shift() ?? 0.5; })();
      answers = [act("bribes the archivist | uncertain | none\nCLUE | a Lannister pin by the shelves")];
      await send("/api/chats/ch/offstage/run", "POST");
    } finally { Math.random = roll; }
    expect(asked()).toContain("By nature they are masterful");
    expect((await ledger()).actions[0]).toMatchObject({ outcome: "failed", trace_roll: 8, trace_dc: 7, traced: false });
  });

  describe("the author's plan", () => {
    const BOOK = "# The Hand\nA betrothal.\n## The Court\n### The Affirmation\nCast: Jaime, Yvenna\nPurpose: Jaime makes the wedding public\n### Tyrion Finds the Letter\nCast: Tyrion\nPurpose: Tyrion learns of the plot\n### The Feast\nSetting: the gardens";
    async function follow() {
      const imp = await (await send("/api/apocrypha/import", "POST", { text: BOOK })).json();
      await send("/api/chats/ch/apocrypha", "PUT", { book: imp.books[0].id });
    }
    const proposals = async () => (await (await ask("/api/chats/ch/chronicle")).json()).proposals;

    test("the Offstage is told it — as the referee, not as her — and a conflict is flagged, never rewritten", async () => {
      seed();
      setSettings({ gossip_level: "off" });
      await follow();
      await goal("Cersei Lannister", "stop the Hightower wedding");
      answers = [act("burns every letter in the Hand's solar | easy | none\nFACT | the Hand's letters are ash\nPLAN | 2 | conflicts | the letter Tyrion was to find is gone\nPLAN | 1 | complicates | the court is uneasy")];
      await send("/api/chats/ch/offstage/run", "POST");
      expect(asked()).toContain("the author's plan for scenes ahead, which Cersei Lannister knows nothing of");
      expect(asked()).toContain("2. Tyrion Finds the Letter — with Tyrion; Tyrion learns of the plot");
      const p = await proposals();
      expect(p).toMatchObject([{ kind: "conflict", title: "Tyrion Finds the Letter" }]);
      // Which scene, never who or how.
      expect(JSON.stringify(p)).not.toContain("ash");
      expect(JSON.stringify(p)).not.toContain("Cersei");
      expect((await ledger()).actions[0].plan).toMatchObject([
        { relation: "conflicts", title: "Tyrion Finds the Letter", how: "the letter Tyrion was to find is gone" },
        { relation: "complicates", title: "The Affirmation" }]);
      // The plan itself is untouched.
      const tale = await (await ask("/api/chats/ch/apocrypha")).json();
      expect(tale.book.chapters[0].scenes.map((s: any) => s.title)).toEqual(["The Affirmation", "Tyrion Finds the Letter", "The Feast"]);
      // Asked once per scene.
      answers = [act("burns more letters | easy | none\nPLAN | 2 | conflicts | more ash")];
      await send("/api/chats/ch/chronicle", "POST", { kind: "time", text: "1 day" });
      await send("/api/chats/ch/offstage/run", "POST");
      expect((await proposals()).filter((x: any) => x.kind === "conflict")).toHaveLength(1);
    });

    test("played blind, a scene not reached is not named; and help that failed helped nothing", async () => {
      seed();
      setSettings({ gossip_level: "off", apocrypha_blind: "1" });
      await follow();
      await goal("Cersei Lannister", "stop the Hightower wedding");
      const roll = Math.random;
      try {
        Math.random = () => 0;
        answers = [act("tries to steal the letter | uncertain | none\nPLAN | 2 | conflicts | the letter may vanish\nPLAN | 1 | supports | it brings the court together")];
        await send("/api/chats/ch/offstage/run", "POST");
      } finally { Math.random = roll; }
      expect(await proposals()).toMatchObject([{ kind: "conflict", title: "" }]);
      expect((await ledger()).actions[0].plan.map((p: any) => p.relation)).toEqual(["conflicts"]);
    });
  });

  describe("who knows what", () => {
    test("a witness to a theft that worked: the theft stands, the witness knows what they saw, and it reaches the story only through them", async () => {
      seed();
      setSettings({ gossip_level: "court" });
      db.query("INSERT INTO npcs (id, chat_id, name, created_at) VALUES ('n1', 'ch', 'Pod', 1)").run();
      await goal("Cersei Lannister", "get the contract");
      const roll = Math.random;
      try {
        // Works (20), trace left (1), the witness will talk (0.9 ≥ refuse), then a quiet day of gossip.
        Math.random = (() => { const q = [0.99, 0, 0.9]; return () => q.shift() ?? 0.99; })();
        answers = [act("takes the contract from the study | hard | none\nFACT | the marriage contract is missing\nCLUE | a Lannister pin by the desk\nWITNESS | Pod | a woman in a hooded cloak leaving the study late")];
        await send("/api/chats/ch/offstage/run", "POST");
      } finally { Math.random = roll; }
      const l = await ledger();
      expect(l.whispers).toMatchObject([{ holder: "Pod", source: "saw", version: "a woman in a hooded cloak leaving the study late", spreads: true, by: ["Cersei Lannister"] }]);
      const told = await narrator();
      expect(told).toContain("the marriage contract is missing");
      expect(told).toContain("Pod saw: “a woman in a hooded cloak leaving the study late”");
      expect(told).toContain("It is not the truth");
      // The ledger's account of the deed is still the deed.
      expect(l.actions[0].what).toBe("takes the contract from the study");
    });

    test("never the player's character as a witness; never the one who did it", async () => {
      seed();
      const roll = Math.random;
      try {
        Math.random = (() => { const q = [0.99, 0]; return () => q.shift() ?? 0.99; })();
        answers = [act("takes the contract | hard | none\nCLUE | a pin\nWITNESS | Yvenna | someone in the study")];
        await goal("Cersei Lannister", "get the contract");
        await send("/api/chats/ch/offstage/run", "POST");
      } finally { Math.random = roll; }
      const l = await ledger();
      expect(l.whispers).toEqual([]);
      expect(l.actions[0].notes).toContain("the witness was the player's character");
    });

    test("gossip moves on the day it turns, and goes back with the reply that turned it", async () => {
      seed();
      setSettings({ gossip_level: "chaotic" });
      await goal("Cersei Lannister", "get the contract");
      await offstageTurn("ch");
      // Something already known, waiting to spread.
      db.query("INSERT INTO chronicle (id, chat_id, kind, subject, title, data, visibility, source, created_at, day) VALUES ('k0', 'ch', 'knows', 'a kitchen maid', 'a cloaked woman left the study', ?, 'private', 'offstage', 1, 0)")
        .run(JSON.stringify({ of: "h1", source: "saw", spreads: true, day: 0, by: ["Cersei Lannister"] }));
      await send("/api/chats/ch/chronicle", "POST", { kind: "time", text: "1 day" });
      const roll = Math.random;
      try {
        Math.random = () => 0.01;
        answers = [act("rests | easy | none")];
        story = "Morning.";
        await (await send("/api/chats/ch/generate", "POST", { mode: "reply", content: "We wait." })).text();
        for (let i = 0; i < 50 && (await ledger()).whispers.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
      } finally { Math.random = roll; }
      const l = await ledger();
      expect(l.whispers.length).toBeGreaterThanOrEqual(2);
      expect(l.whispers.some((k: any) => k.source === "told" && k.from === "a kitchen maid")).toBe(true);
      const reply = db.query("SELECT id FROM messages WHERE chat_id = 'ch' AND role = 'assistant' ORDER BY created_at DESC LIMIT 1").get() as any;
      await send(`/api/messages/${reply.id}`, "DELETE");
      expect((await ledger()).whispers.map((k: any) => k.holder)).toEqual(["a kitchen maid"]);
    });
  });
});
