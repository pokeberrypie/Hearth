/**
 * A day offstage takes as long as the model takes. Whatever happens to the story while it waits — the reply it
 * came from swiped away or deleted — the day must not come back afterwards and write itself onto a message that
 * is gone, where no swipe can ever take it off again.
 */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { db, setSettings, wipe } from "./test-support";
const { app, forgetPresence } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body?: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });
afterEach(() => { globalThis.fetch = realFetch; });

let release: () => void = () => {};
let asked: () => void = () => {};
beforeEach(() => {
  wipe();
  forgetPresence();
  setSettings({ mode: "story", provider: "openrouter", key_openrouter: "sk", model: "story/model", steward_on: "0",
    offstage_level: "balanced", offstage_protection: "fair", offstage_per_day: "2" });
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('c', 'Cersei Lannister', 1)").run();
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('j', 'Jaime Lannister', 1)").run();
  db.query("INSERT INTO personas (id, name, created_at) VALUES ('y', 'Yvenna Hightower', 1)").run();
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at, persona_id) VALUES ('ch', 'j', 'The Hand', 1, 1, 'y')").run();
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('m1', 'ch', 'assistant', 'Jaime Lannister', 'The court gathered.', 2)").run();
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('m2', 'ch', 'assistant', 'Jaime Lannister', 'Jaime rode out.', 3)").run();
  const gate = new Promise<void>((ok) => (release = ok));
  let reached!: () => void;
  const atGate = new Promise<void>((ok) => (reached = ok));
  asked = () => atGate as any;
  globalThis.fetch = (async (_u: any, init: any) => {
    const body = JSON.parse(init.body);
    const all = JSON.stringify(body.messages);
    if (all.includes("You are deciding for:")) {
      reached();
      await gate;
      return Response.json({ choices: [{ message: { content:
        "CHOOSE | it | spite\nACT | sends a rider with a letter to the Hightower | easy | none\nSEEN | a rider leaves the Red Keep at night\nFACT | a letter is on its way to Oldtown" } }] });
    }
    return Response.json({ choices: [{ message: { content: "NONE" } }] });
  }) as any;
});

test("deleted while the day was being decided: nothing of that day is left behind on the gone message", async () => {
  await send("/api/chats/ch/offstage/goal", "POST", { who: "Cersei Lannister", goal: "warn Oldtown", why: "" });
  const running = send("/api/chats/ch/offstage/run", "POST");
  await (asked() as any);
  await send("/api/messages/m2", "DELETE");
  release();
  const r = await (await running).json();
  expect(r).not.toHaveProperty("error");
  expect(r.note).toContain("set aside");
  const orphans = db.query("SELECT kind, title FROM chronicle WHERE chat_id = 'ch' AND message_id = 'm2' AND undone_at IS NULL").all();
  expect(orphans).toEqual([]);
});

test("(and left alone, the same day is written, on the message it came from)", async () => {
  await send("/api/chats/ch/offstage/goal", "POST", { who: "Cersei Lannister", goal: "warn Oldtown", why: "" });
  const running = send("/api/chats/ch/offstage/run", "POST");
  await (asked() as any);
  release();
  await running;
  const kept = db.query("SELECT kind FROM chronicle WHERE chat_id = 'ch' AND message_id = 'm2' AND undone_at IS NULL").all() as any[];
  expect(kept.map((k) => k.kind)).toContain("offstage");
});

test("swiped or rewritten while the day was being decided: that day goes with the take it came from", async () => {
  await send("/api/chats/ch/offstage/goal", "POST", { who: "Cersei Lannister", goal: "warn Oldtown", why: "" });
  const running = send("/api/chats/ch/offstage/run", "POST");
  await (asked() as any);
  // The same as a swipe: the message stays, what came from its old take is undone.
  await send("/api/messages/m2", "PUT", { content: "Jaime stayed in the city." });
  release();
  await running;
  const left = db.query("SELECT kind, title FROM chronicle WHERE chat_id = 'ch' AND message_id = 'm2' AND undone_at IS NULL").all();
  expect(left).toEqual([]);
});

test("a day set aside is still owed: the next reply runs it", async () => {
  await send("/api/chats/ch/offstage/goal", "POST", { who: "Cersei Lannister", goal: "warn Oldtown", why: "" });
  const { offstageTurn } = await import("./index");
  await offstageTurn("ch"); // the first look only notes the day
  const before = (db.query("SELECT offstage_day FROM chats WHERE id = 'ch'").get() as any).offstage_day;
  await send("/api/chats/ch/chronicle", "POST", { kind: "time", text: "1 day" });
  const running = offstageTurn("ch");
  await (asked() as any);
  await send("/api/messages/m2", "PUT", { content: "Jaime stayed in the city." });
  release();
  await running;
  expect((db.query("SELECT offstage_day FROM chats WHERE id = 'ch'").get() as any).offstage_day).toBe(before);
});

test("the Steward too: a reading of words swiped away while it read is not kept", async () => {
  setSettings({ steward_on: "1", steward_every: "1", story_world: "1" });
  db.query("UPDATE messages SET content = 'Jaime publicly affirmed his betrothal to Yvenna before the court.' WHERE id = 'm2'").run();
  let reached!: () => void;
  const atGate = new Promise<void>((ok) => (reached = ok));
  let open!: () => void;
  const gate = new Promise<void>((ok) => (open = ok));
  globalThis.fetch = (async (_u: any, init: any) => {
    const body = JSON.parse(init.body);
    if (JSON.stringify(body.messages).includes("You keep the records")) {
      reached(); await gate;
      return Response.json({ choices: [{ message: { content: 'EVENT | Jaime affirms the betrothal | 2 | "Jaime publicly affirmed his betrothal to Yvenna"' } }] });
    }
    return Response.json({ choices: [{ message: { content: "NONE" } }] });
  }) as any;
  const { stewardTurn } = await import("./index");
  const running = stewardTurn("ch");
  await atGate;
  await send("/api/messages/m2", "PUT", { content: "Jaime said nothing, and rode out." });
  open();
  await running;
  const events = db.query("SELECT title FROM chronicle WHERE chat_id = 'ch' AND kind = 'event' AND undone_at IS NULL").all();
  expect(events).toEqual([]);
});

test("a day that finds the world still busy with the last is not lost: the next reply gives it its turn", async () => {
  await send("/api/chats/ch/offstage/goal", "POST", { who: "Cersei Lannister", goal: "warn Oldtown", why: "" });
  const { offstageTurn } = await import("./index");
  await offstageTurn("ch");
  const before = (db.query("SELECT offstage_day FROM chats WHERE id = 'ch'").get() as any).offstage_day;
  // A run by hand, slow, still going…
  const byHand = send("/api/chats/ch/offstage/run", "POST");
  await (asked() as any);
  // …when the story turns a day.
  await send("/api/chats/ch/chronicle", "POST", { kind: "time", text: "1 day" });
  await offstageTurn("ch");
  expect((db.query("SELECT offstage_day FROM chats WHERE id = 'ch'").get() as any).offstage_day).toBe(before);
  release();
  await byHand;
});

test("the clock taken back by hand takes the world's day back, and what was sent from the days that never came", async () => {
  const { offstageTurn } = await import("./index");
  await offstageTurn("ch");
  // A misread year, and a run on it that sent word due two days later.
  const year = (await (await send("/api/chats/ch/chronicle", "POST", { kind: "time", text: "365 days" })).json()).entries.find((e: any) => e.kind === "time").id;
  db.query("UPDATE chats SET offstage_day = 365 WHERE id = 'ch'").run();
  db.query(`INSERT INTO chronicle (id, chat_id, kind, day, title, source, visibility, created_at, data) VALUES ('n9', 'ch', 'news', 365, 'word from Oldtown', 'offstage', 'private', 9e12, '{"due":367,"state":"travelling","tries":0,"mode":"word"}')`).run();
  await send(`/api/chronicle/${year}/undo`, "POST");
  await offstageTurn("ch");
  expect((db.query("SELECT offstage_day FROM chats WHERE id = 'ch'").get() as any).offstage_day).toBe(0);
  expect(JSON.parse((db.query("SELECT data FROM chronicle WHERE id = 'n9'").get() as any).data).due).toBe(2);
});

test("the Steward set aside by an edit mid-read takes nothing back: what it knew of the earlier messages stays", async () => {
  setSettings({ steward_on: "1", steward_every: "1", story_world: "1" });
  // m1 was read before: the court gathered. Then the reading of m1 and m2 again (as after a swipe further back).
  db.query("INSERT INTO chronicle (id, chat_id, message_id, kind, title, source, visibility, created_at, evidence) VALUES ('ev1', 'ch', 'm1', 'event', 'The court gathers', 'steward', 'table', 5, 'The court gathered')").run();
  db.query("UPDATE chats SET steward_at = 0 WHERE id = 'ch'").run();
  let reached!: () => void; const atGate = new Promise<void>((ok) => (reached = ok));
  let open!: () => void; const gate = new Promise<void>((ok) => (open = ok));
  globalThis.fetch = (async (_u: any, init: any) => {
    if (JSON.stringify(JSON.parse(init.body).messages).includes("You keep the records")) {
      reached(); await gate;
      return Response.json({ choices: [{ message: { content: 'EVENT | The court gathers | 1 | "The court gathered"' } }] });
    }
    return Response.json({ choices: [{ message: { content: "NONE" } }] });
  }) as any;
  const { stewardTurn } = await import("./index");
  const running = stewardTurn("ch");
  await atGate;
  await send("/api/messages/m2", "PUT", { content: "Jaime stayed in the city." });
  open();
  await running;
  const live = db.query("SELECT id FROM chronicle WHERE chat_id = 'ch' AND kind = 'event' AND undone_at IS NULL").all();
  expect(live).toHaveLength(1);
  // And it reads the whole stretch again next time, from before the first of it.
  expect((db.query("SELECT steward_at FROM chats WHERE id = 'ch'").get() as any).steward_at).toBeLessThan(2);
});
