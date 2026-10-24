/**
 * A reply whose connection breaks partway is kept as far as it got.
 *
 * On a phone a dropped connection is the commonest way a reply ends early.
 * It used to be treated as a failure: everything already streamed and read
 * on screen was thrown away, and nothing was saved. Now it is kept, like a
 * stop, and the player is told so Continue can finish it. A failure before
 * anything worth keeping arrived is still a failure.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { db, setSettings, wipe } from "./test-support";

const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test${path}`, init), HOME);

const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });

/** A stream that sends this text, then breaks. */
function breaking(text: string) {
  globalThis.fetch = (async () => {
    const enc = new TextEncoder();
    return new Response(new ReadableStream({ start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      setTimeout(() => c.error(new Error("connection reset")), 5);
    } }), { headers: { "content-type": "text/event-stream" } });
  }) as any;
}

beforeEach(() => {
  wipe();
  setSettings({ mode: "story", provider: "openrouter", key_openrouter: "sk", model: "story/model", steward_on: "0", story_world: "0" });
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('j', 'Jaime Lannister', 1)").run();
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'j', 'The Hand', 1, 1)").run();
});

const generate = async () => (await ask("/api/chats/ch/generate", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ content: "Go on.", mode: "send" }) })).text();
const replies = () => db.query("SELECT content FROM messages WHERE chat_id = 'ch' AND role = 'assistant'").all() as any[];

describe("a reply cut off partway", () => {
  test("is kept as far as it got, and the player is told", async () => {
    const long = "The boar came out of the thicket at a dead run, and the king was too drunk to sidestep it. Steel flashed.";
    breaking(long);
    const said = await generate();
    expect(said).toContain('"warning"');
    expect(said).not.toContain('"error"');
    expect(replies().map((r) => r.content)).toEqual([long]);
  });

  test("before anything worth keeping, it is still a failure, and nothing is saved", async () => {
    breaking("The");
    const said = await generate();
    expect(said).toContain('"error"');
    expect(replies()).toEqual([]);
  });
});
