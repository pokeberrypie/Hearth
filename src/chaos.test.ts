/**
 * Chaos: random stories, played by a stand-in model that answers every question Hearth asks with something
 * valid and random — and after every step, the things that must always be true of the Story World, however it
 * got there. Each failure prints the seed and the steps, so it can be played again exactly.
 *
 * CHAOS_RUNS=500 bun test src/chaos.test.ts for a long night of it; the suite runs a few.
 */
import { afterAll, expect, test } from "bun:test";
import { db, setSettings, wipe } from "./test-support";
const { app, forgetPresence, offstageTurn } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const call = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body?: unknown) =>
  call(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });

/** A small seeded random, so a failing story can be told again exactly. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
}

const CAST = ["Jaime Lannister", "Cersei Lannister", "Petyr Baelish", "Brienne of Tarth"];
const LINES = [
  "Three days later, they reached the inn at the crossroads.",
  "The next morning, Jaime saddled the horses.",
  "Cersei Lannister smiled over her wine and said nothing.",
  "A rider came: the river houses owe the Crown new levies.",
  "Brienne of Tarth drew her sword and stood at the door.",
  "Petyr Baelish was found dead in the godswood.",
  "Rain fell on the road and nobody spoke.",
  "Someone had sent a knife in the night, and Jaime caught it.",
];

function standIn(r: () => number) {
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  return (async (_u: any, init: any) => {
    const b = JSON.parse(init.body);
    const all = JSON.stringify(b.messages) + String(b.system ?? "");
    const json = (content: string) => Response.json({ choices: [{ message: { content } }] });
    if (b.stream) {
      const text = [pick(LINES), pick(LINES), pick(LINES)].join(" ");
      const enc = new TextEncoder();
      return new Response(new ReadableStream({ start(c) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
        c.enqueue(enc.encode("data: [DONE]\n\n")); c.close();
      } }), { headers: { "content-type": "text/event-stream" } });
    }
    if (all.includes("You keep the records")) {
      const said = LINES.filter((l) => all.includes(l.slice(0, 30)));
      if (!said.length || r() < 0.2) return json("NONE");
      const out: string[] = [];
      const death = said.find((l) => /dead/.test(l));
      if (death && r() < 0.6) out.push(`DEATH | Petyr Baelish | "${death.replace(/[.:]$/, "")}"`);
      for (let i = 0; i < 1 + Math.floor(r() * 3); i++) {
        const q = pick(said).replace(/[.:]$/, "");
        const k = r();
        if (k < 0.4) out.push(`EVENT | ${q.slice(0, 40)} | 1 | "${q}"`);
        else if (k < 0.6) out.push(`STATUS | ${pick(CAST)} | location | the crossroads inn | "${q}"`);
        else if (k < 0.75 && /dead/.test(q)) out.push(`DEATH | Petyr Baelish | "${q}"`);
        else if (k < 0.9) out.push(`TIME | a day | "${q}"`);
        else out.push(`THREAD | open | The levies | "${q}"`);
      }
      return json(out.join("\n"));
    }
    if (all.includes("For each person in the list")) return json(CAST.map((c) => `${r() < 0.5 ? "HERE" : "AWAY"} | ${c}${r() < 0.5 ? "" : " | Oldtown"}`).join("\n"));
    if (all.includes("You are deciding for:")) {
      const k = r();
      if (k < 0.3) return json("CHOOSE | NOTHING | a quiet day\nACT | keeps to the usual round | easy | none");
      if (k < 0.5) return json("CHOOSE | it | spite\nACT | sends a man after Yvenna Hightower | hard | grave");
      if (k < 0.8) return json("CHOOSE | it | gain\nACT | writes to the river lords about the levies | uncertain | social\nSEEN | ravens leave the rookery at night\nFACT | the river lords have letters\nREACHES | a rider | the river houses owe the Crown new levies | 1\nCLUE | a seal pressed in green wax\nWITNESS | a maid | a cloaked figure at the rookery\nGOAL | win the river lords | they hold the fords");
      return json("CHOOSE | it | done\nACT | settles the matter | easy | none\nDONE | stop the wedding | it is over\nTHREAD | advance | The levies | letters sent");
    }
    if (all.includes("You trace what people did out of sight")) return json(r() < 0.5 ? "NONE" : "LANDS | 1 | a man at the inn asks after Yvenna | 1");
    if (all.includes("say what each of its people wants") || all.includes("what each of them now wants")) {
      const who = pick(CAST);
      return json(r() < 0.3 ? `DONE | ${who} | whatever they wanted | it came about` : `GOAL | ${who} | ${pick(["hold the fords", "find the knife's sender", "stop the wedding"])} | because`);
    }
    return json("NONE");
  }) as any;
}

function setUp() {
  wipe();
  forgetPresence();
  setSettings({ mode: "story", provider: "openrouter", key_openrouter: "sk", model: "m", story_world: "1", steward_on: "1", steward_every: "1",
    offstage_level: "dynamic", offstage_protection: "fair", offstage_per_day: "3", gossip_level: "chaotic", news_reach: "100", context_tokens: "16000", max_tokens: "800" });
  CAST.forEach((n, i) => db.query("INSERT INTO characters (id, name, description, created_at) VALUES (?, ?, ?, 1)").run(`c${i}`, n, `${n}, known as the ${["Kingslayer", "Queen", "Littlefinger", "Maid"][i]}.`));
  db.query("INSERT INTO personas (id, name, created_at) VALUES ('y', 'Yvenna Hightower', 1)").run();
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at, persona_id) VALUES ('ch', 'c0', 'Chaos', 1, 1, 'y')").run();
  CAST.forEach((_, i) => db.query("INSERT INTO chat_members (id, chat_id, character_id, position, muted) VALUES (?, 'ch', ?, ?, ?)").run(`x${i}`, `c${i}`, i, i > 1 ? 1 : 0));
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('m0', 'ch', 'assistant', 'Jaime Lannister', 'The court gathered.', 2)").run();
}

const parse = (s: string) => { try { return JSON.parse(s || "{}"); } catch { return null; } };

/** What must hold of every chat in the library, after any step. */
function broken(): string[] {
  const out: string[] = [];
  const chats = db.query("SELECT id, offstage_day FROM chats").all() as any[];
  for (const ch of chats) {
    const rows = db.query("SELECT * FROM chronicle WHERE chat_id = ?").all(ch.id) as any[];
    const ids = new Set(rows.map((e) => e.id));
    const msgs = new Set((db.query("SELECT id FROM messages WHERE chat_id = ?").all(ch.id) as any[]).map((m) => m.id));
    for (const e of rows) {
      const d = parse(e.data);
      if (d === null) { out.push(`${ch.id}: ${e.kind} ${e.id} has data that does not read`); continue; }
      if (e.undone_at) {
        if (e.kind === "threat" && d.played_by && !msgs.has(d.played_by)) out.push(`${ch.id}: threat played by a message that is gone, never given back`);
        continue;
      }
      if (e.message_id && !msgs.has(e.message_id)) out.push(`${ch.id}: live ${e.kind} "${e.title}" (${e.source}) on a message that is gone`);
      if (d.of && !ids.has(d.of) && e.kind !== "news") out.push(`${ch.id}: live ${e.kind} points at ${d.of}, not in this chat`);
      if (e.kind === "news" && d.state === "arrived" && d.by && !msgs.has(d.by)) out.push(`${ch.id}: news arrived by a message that is gone`);
      if (e.kind === "news" && !Number.isFinite(Number(d.due))) out.push(`${ch.id}: news with no due day`);
    }
  }
  return out;
}

async function settle() {
  // The stand-in answers at once; what a reply sets going in the background finishes within a few turns of the loop.
  for (let i = 0; i < 8; i++) await new Promise((ok) => setTimeout(ok, 2));
}

async function story(seed: number, steps: number) {
  setUp();
  const r = rng(seed);
  globalThis.fetch = standIn(r);
  const log: string[] = [];
  let chat = "ch";
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const messages = () => db.query("SELECT id, role, swipes FROM messages WHERE chat_id = ? ORDER BY created_at, rowid").all(chat) as any[];
  for (let i = 0; i < steps; i++) {
    const k = r();
    const ms = messages();
    const last = ms.at(-1);
    let what = "";
    if (k < 0.3) { what = "reply"; await (await send(`/api/chats/${chat}/generate`, "POST", { mode: "reply", content: pick(LINES) })).text(); }
    else if (k < 0.42 && last?.role === "assistant") { what = "swipe"; await (await send(`/api/chats/${chat}/generate`, "POST", { mode: "swipe" })).text(); }
    else if (k < 0.48 && last?.role === "assistant") { what = "continue"; await (await send(`/api/chats/${chat}/generate`, "POST", { mode: "continue" })).text(); }
    else if (k < 0.52) { what = "impersonate"; await (await send(`/api/chats/${chat}/generate`, "POST", { mode: "impersonate" })).text(); }
    else if (k < 0.58 && last?.swipes && JSON.parse(last.swipes).length > 1) { what = "choose swipe"; await send(`/api/messages/${last.id}/swipe`, "POST", { index: Math.floor(r() * JSON.parse(last.swipes).length) }); }
    else if (k < 0.65 && ms.length > 1) { const m = pick(ms); what = `edit ${m.id}`; await send(`/api/messages/${m.id}`, "PUT", { content: pick(LINES) }); }
    else if (k < 0.7 && ms.length > 2) { what = "delete last"; await send(`/api/messages/${last.id}`, "DELETE"); }
    else if (k < 0.8) { what = "run a day"; await send(`/api/chats/${chat}/offstage/run`, "POST"); }
    else if (k < 0.86) { what = "time"; await send(`/api/chats/${chat}/chronicle`, "POST", { kind: "time", text: pick(["1 day", "3 days", "until dawn"]) }); }
    else if (k < 0.9) {
      const live = db.query("SELECT id FROM chronicle WHERE chat_id = ? AND undone_at IS NULL").all(chat) as any[];
      if (live.length) { const e = pick(live); what = `undo ${e.id.slice(0, 6)}`; await send(`/api/chronicle/${e.id}/undo`, "POST"); }
    } else if (k < 0.94 && ms.length > 1) {
      const m = pick(ms); what = `branch at ${m.id.slice(0, 6)}`;
      const b = await (await send(`/api/messages/${m.id}/branch`, "POST", {})).json();
      if (b.id) chat = b.id;
    } else { what = "turn"; await offstageTurn(chat); }
    await settle();
    log.push(what);
    const bad = broken();
    // What the narrator is sent: inside the Context size with the reply's room, and never a secret act.
    const ins = await (await send(`/api/chats/${chat}/inspect`, "POST", {})).json();
    if (ins.estTokens + 800 > 16000) bad.push(`${chat}: the narrator is sent ${ins.estTokens} tokens with 800 for the reply, over 16,000`);
    const told = JSON.stringify(ins.sections ?? []) + String(ins.system ?? "");
    if (told.includes("writes to the river lords")) bad.push(`${chat}: a secret act reached the narrator`);
    if (what === "turn") {
      const od = (db.query("SELECT offstage_day FROM chats WHERE id = ?").get(chat) as any)?.offstage_day;
      const day = (await (await call(`/api/chats/${chat}/chronicle`)).json()).now?.day;
      if (od > day) bad.push(`${chat}: the world's day ${od} is ahead of the story's ${day}`);
    }
    if (bad.length) return { seed, step: i, log, bad };
  }
  return null;
}

test("random stories keep every rule of the Story World, whatever is done to them", async () => {
  const runs = Number(process.env.CHAOS_RUNS) || 12;
  const failures: any[] = [];
  const seeds = process.env.CHAOS_SEED ? [Number(process.env.CHAOS_SEED)] : Array.from({ length: runs }, (_, i) => (i + 1) * 7919);
  for (const seed of seeds) {
    const f = await story(seed, 30);
    if (f) failures.push(f);
  }
  if (process.env.CHAOS_SEED && failures[0]) {
    console.log("STEPS", failures[0].log.join(" → "));
    for (const e of db.query("SELECT kind, title, message_id, undone_at, data, source FROM chronicle WHERE kind = 'threat'").all() as any[]) console.log("THREAT", JSON.stringify(e));
    console.log("MESSAGES", JSON.stringify(db.query("SELECT id, role, chat_id FROM messages").all()));
  }
  if (failures.length) console.log(JSON.stringify(failures.slice(0, 3), null, 1));
  // That the rules had something to hold against: secrets were made, threats sent, news on its way, branches cut.
  console.log("EXERCISED", JSON.stringify(db.query(`SELECT
    (SELECT COUNT(*) FROM chronicle WHERE kind = 'offstage' AND title LIKE 'writes to the river lords%') secret_acts,
    (SELECT COUNT(*) FROM chronicle WHERE kind = 'threat') threats,
    (SELECT COUNT(*) FROM chronicle WHERE kind = 'news') news,
    (SELECT COUNT(*) FROM chronicle WHERE kind = 'status' AND title = 'dead') deaths,
    (SELECT COUNT(*) FROM chats) chats`).get()));
  expect(failures.map((f) => `seed ${f.seed} step ${f.step}: ${f.bad[0]}`)).toEqual([]);
}, 600_000);
