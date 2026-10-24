/**
 * Tracker sheets in what is sent: only on the latest few messages.
 *
 *   bun test src/sheets.test.ts
 */

import { expect, test } from "bun:test";

import { db, setSettings, wipe } from "./test-support";
const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const inspect = async () => (await app.fetch(new Request("http://home.test/api/chats/ch/inspect", {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), HOME)).json() as any;

function seed() {
  wipe();
  setSettings({ mode: "story", provider: "openrouter", key_openrouter: "sk", model: "m", steward_on: "0" });
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('j', 'Jaime Lannister', 1)").run();
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'j', 'x', 1, 1)").run();
  const msg = db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES (?, 'ch', ?, 'x', ?, ?)");
  for (let i = 1; i <= 6; i++) {
    msg.run(`u${i}`, "user", `Turn ${i}.`, i * 10);
    msg.run(`a${i}`, "assistant", `Scene ${i}.\n\n@Status\n- Jaime: mood ${i}\n- Time: hour ${i}`, i * 10 + 1);
  }
}

test("old sheets leave what is sent; the latest stay; the chat itself keeps them all", async () => {
  seed();
  setSettings({ tracker_keep: "3" }); // the last three messages: a6, u6, a5
  const sent = (await inspect()).sections.find((s: any) => s.label === "Conversation").content;
  for (let i = 1; i <= 6; i++) expect(sent).toContain(`Scene ${i}.`);
  expect(sent).toContain("mood 6");
  expect(sent).toContain("mood 5");
  expect(sent).not.toContain("mood 4");
  expect(sent).not.toContain("mood 1");
  expect((db.query("SELECT content FROM messages WHERE id = 'a1'").get() as any).content).toContain("mood 1");
});

test("keeping them all keeps them all", async () => {
  seed();
  setSettings({ tracker_keep: "31" });
  const sent = (await inspect()).sections.find((s: any) => s.label === "Conversation").content;
  for (let i = 1; i <= 6; i++) expect(sent).toContain(`mood ${i}`);
});
