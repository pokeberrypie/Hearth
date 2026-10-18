/**
 * The table's swipe allowance, held at the server.
 *
 *   bun test src/swipecap.test.ts
 */
import { describe, expect, test } from "bun:test";
import { db, setSettings, wipe } from "./test-support";

const { app } = await import("./index");
const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const swipe = (body: object = {}) =>
  app.fetch(new Request("http://home.test/api/chats/ch/generate", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "swipe", ...body }),
  }), HOME);

function seed(swipes: string[], allowance: string) {
  wipe();
  setSettings({ mode: "tabletop", tabletop_swipes: allowance });
  const t = Date.now();
  db.query("INSERT INTO characters (id, name, created_at, world) VALUES ('c', 'The Gamekeeper', ?, 'both')").run(t);
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'c', 'T', ?, ?)").run(t, t);
  db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES ('u', 'ch', 'user', 'Go.', ?)").run(t);
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at, swipes, swipe_index) VALUES ('a', 'ch', 'assistant', 'The Gamekeeper', ?, ?, ?, ?)")
    .run(swipes[swipes.length - 1] ?? "x", t + 1, JSON.stringify(swipes), Math.max(0, swipes.length - 1));
}

describe("the swipe allowance", () => {
  test("refuses past the allowance", async () => {
    seed(["first", "second"], "1");
    const r = await swipe();
    expect(r.status).toBe(400);
  });
  test("a guided swipe is a swipe too", async () => {
    seed(["first", "second"], "1");
    expect((await swipe({ guide: "Do not speak for the players." })).status).toBe(400);
  });
  test("none at all when the table says none", async () => {
    seed(["first"], "0");
    expect((await swipe()).status).toBe(400);
  });
  test("a reply saved with no swipe list still counts as one version", async () => {
    seed([], "0");
    expect((await swipe()).status).toBe(400);
  });
});
