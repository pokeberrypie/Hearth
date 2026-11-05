/**
 * A death read from a reply, and everything that follows from it — the dead's goals ended, the living stirred to
 * want something because of it — goes with that reply when it is swiped away. Before, only the death went.
 */
import { afterAll, beforeEach, expect, test } from "bun:test";
import { db, setSettings, wipe } from "./test-support";
const { app, stewardTurn } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body?: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });

let stirred!: Promise<void>;
beforeEach(() => {
  wipe();
  setSettings({ mode: "story", provider: "openrouter", key_openrouter: "sk", model: "m", steward_on: "1", steward_every: "1",
    story_world: "1", offstage_level: "balanced" });
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('j', 'Jaime Lannister', 1)").run();
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('c', 'Cersei Lannister', 1)").run();
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('n', 'Eddard Stark', 1)").run();
  db.query("INSERT INTO personas (id, name, created_at) VALUES ('y', 'Yvenna Hightower', 1)").run();
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at, persona_id) VALUES ('ch', 'j', 'The Hand', 1, 1, 'y')").run();
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('m1', 'ch', 'assistant', 'Jaime Lannister', 'Eddard Stark fell on the steps of Baelor, and did not rise. Eddard Stark was dead.', 2)").run();
  let done!: () => void;
  stirred = new Promise<void>((ok) => (done = ok));
  globalThis.fetch = (async (_u: any, init: any) => {
    const all = JSON.stringify(JSON.parse(init.body).messages);
    if (all.includes("You keep the records")) return Response.json({ choices: [{ message: { content: 'DEATH | Eddard Stark | "Eddard Stark was dead"' } }] });
    if (all.includes("what each of them now wants")) { setTimeout(done, 0); return Response.json({ choices: [{ message: { content: "GOAL | Cersei Lannister | see the Stark girls kept close | they are hostages now" } }] }); }
    return Response.json({ choices: [{ message: { content: "NONE" } }] });
  }) as any;
});
const live = (sql: string) => db.query(`SELECT kind, subject, title, data FROM chronicle WHERE chat_id = 'ch' AND undone_at IS NULL AND ${sql}`).all() as any[];

test("swiped away, the death goes, and so do the goals it ended and the wants it stirred", async () => {
  await send("/api/chats/ch/offstage/goal", "POST", { who: "Eddard Stark", goal: "find out who killed Jon Arryn", why: "" });
  await stewardTurn("ch");
  await stirred;
  await new Promise((ok) => setTimeout(ok, 20));
  expect(live("kind = 'status' AND title = 'dead'")).toHaveLength(1);
  expect(live("kind = 'agenda' AND subject = 'Cersei Lannister'")).toHaveLength(1);
  expect(live("kind = 'agenda' AND title = '' AND data LIKE '%died%'")).toHaveLength(1);
  // The take where he died, swiped for one where he did not.
  await send("/api/messages/m1", "PUT", { content: "Eddard Stark stood on the steps of Baelor and confessed." });
  expect(live("kind = 'status' AND title = 'dead'")).toEqual([]);
  expect(live("kind = 'agenda' AND subject = 'Cersei Lannister'")).toEqual([]);
  expect(live("kind = 'agenda' AND title = '' AND data LIKE '%died%'")).toEqual([]);
  // And his own goal is his again.
  const goals = (await (await ask("/api/chats/ch/offstage")).json()).goals as any[];
  expect(goals.find((g) => g.who === "Eddard Stark").status).toBe("active");
});
