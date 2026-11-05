/**
 * A branch's ledger is a copy, under new ids — and the entries that point at others by id point at the copies.
 * Before, every branch kept the end of each goal but not which goal it ended, so everything achieved or given up
 * was wanted again in the branch. Branches made that way are mended when Hearth starts.
 */
import { afterAll, beforeEach, expect, test } from "bun:test";
import { db, setSettings, wipe } from "./test-support";
const { app, repairBranchLinks } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body?: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });

beforeEach(() => {
  wipe();
  setSettings({ mode: "story", steward_on: "0", offstage_level: "balanced" });
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('c', 'Cersei Lannister', 1)").run();
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('j', 'Jaime Lannister', 1)").run();
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'j', 'The Hand', 1, 1)").run();
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('m1', 'ch', 'assistant', 'Jaime Lannister', 'The court gathered.', 2)").run();
  // Branched from here: after the goal and its end, so both are part of what the branch keeps.
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('m9', 'ch', 'assistant', 'Jaime Lannister', 'Later.', 9e12)").run();
});
const goals = async (chat: string) => (await (await ask(`/api/chats/${chat}/offstage`)).json()).goals as any[];

async function endedGoal() {
  await send("/api/chats/ch/offstage/goal", "POST", { who: "Cersei Lannister", goal: "warn the river lords", why: "" });
  const g = (await goals("ch")).find((x) => x.goal === "warn the river lords");
  await send(`/api/chats/ch/offstage/goal/${g.id}`, "POST", { status: "achieved", how: "ravens by night" });
  expect((await goals("ch")).find((x) => x.goal === "warn the river lords").status).toBe("achieved");
}

test("a goal achieved before the branch is still achieved in it, not wanted all over again", async () => {
  await endedGoal();
  const branch = (await (await send("/api/messages/m9/branch", "POST", {})).json()).id;
  expect((await goals(branch)).find((x) => x.goal === "warn the river lords").status).toBe("achieved");
});

test("a branch made the old way — its links left pointing at the chat it came from — is mended at start", async () => {
  await endedGoal();
  const branch = (await (await send("/api/messages/m9/branch", "POST", {})).json()).id;
  // Break it as the old copy did: the end points at the goal in 'ch', which the branch does not have.
  const original = db.query("SELECT id FROM chronicle WHERE chat_id = 'ch' AND kind = 'agenda' AND title != ''").get() as any;
  const end = db.query("SELECT id, data FROM chronicle WHERE chat_id = ? AND kind = 'agenda' AND title = ''").get(branch) as any;
  db.query("UPDATE chronicle SET data = ? WHERE id = ?").run(JSON.stringify({ ...JSON.parse(end.data), of: original.id }), end.id);
  expect((await goals(branch)).find((x) => x.goal === "warn the river lords").status).toBe("active");
  repairBranchLinks();
  expect((await goals(branch)).find((x) => x.goal === "warn the river lords").status).toBe("achieved");
  // And the chat it came from is left exactly as it was.
  expect((await goals("ch")).find((x) => x.goal === "warn the river lords").status).toBe("achieved");
});

test("a branch's notes are the notes as they stood at the fork, not the parent's later days", async () => {
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('m5', 'ch', 'assistant', 'Jaime Lannister', 'And later still.', 9.5e12)").run();
  db.query(`INSERT INTO lorebooks (id, name, entries, created_at) VALUES ('nb', 'The Hand — notes', ?, 1)`).run(JSON.stringify([
    { id: "a", keys: ["Cersei"], comment: "before", content: "Cersei hated the match.", added_at: 5 },
    { id: "b", keys: ["Cersei"], comment: "after", content: "Cersei crowned Joffrey.", added_at: 9.6e12 },
  ]));
  db.query("UPDATE chats SET auto_lore_book_id = 'nb' WHERE id = 'ch'").run();
  const branch = (await (await send("/api/messages/m9/branch", "POST", {})).json()).id;
  const book = db.query("SELECT entries FROM lorebooks WHERE id = (SELECT auto_lore_book_id FROM chats WHERE id = ?)").get(branch) as any;
  expect(JSON.parse(book.entries).map((e: any) => e.comment)).toEqual(["before"]);
});
