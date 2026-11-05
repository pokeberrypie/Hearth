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
