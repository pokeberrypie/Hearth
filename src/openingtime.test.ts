/**
 * A reply that opens on time passing moves the story's date the moment it is
 * saved — not whenever the Steward next reads — and is counted once.
 *
 *   bun test src/openingtime.test.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { db, setSettings, wipe } from "./test-support";

const { app, openingClause } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body?: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("the opening clause", () => {
  test("the words before the first break, unless the reply opens on speech", () => {
    expect(openingClause("Three days later, the court gathered.")).toBe("Three days later");
    expect(openingClause("*The next morning* — rain.")).toBe("The next morning");
    expect(openingClause("“Three days,” she said.")).toBe("");
    expect(openingClause("Loras came through the door at speed and stopped dead two steps inside the great hall")).toBe("");
  });
});

describe("through a real reply", () => {
  const realFetch = globalThis.fetch;
  let replyText = "";
  beforeEach(() => {
    const enc = new TextEncoder();
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: replyText } }] })}\n\n`));
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      },
    }), { headers: { "content-type": "text/event-stream" } })) as any;
    wipe();
    setSettings({ mode: "story", provider: "openrouter", key_openrouter: "sk-test", model: "test/model", steward_on: "0" });
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('j', 'Jaime', 1)").run();
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('c', 'j', 'The Hand', 1, 1)").run();
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const day = async () => (await (await ask("/api/chats/c/chronicle")).json()).now.day;
  const reply = async (text: string, mode = "reply") => {
    replyText = text;
    await (await send("/api/chats/c/generate", "POST", { mode, content: mode === "reply" ? "Go on." : undefined })).text();
  };

  test("\"Three days later\" moves the date three days, tied to the reply", async () => {
    const before = await day();
    await reply("Three days later, the court gathered in the Great Hall.");
    expect(await day()).toBe(before + 3);
    const m = db.query("SELECT id FROM messages WHERE chat_id = 'c' AND role = 'assistant'").get() as any;
    const rows = db.query("SELECT kind, source, message_id FROM chronicle WHERE chat_id = 'c' AND undone_at IS NULL").all();
    expect(rows).toEqual([{ kind: "time", source: "narrator", message_id: m.id }]);
  });

  test("a reply that does not open on time moves nothing", async () => {
    const before = await day();
    await reply("Some time later, nobody could say how long.");
    await reply("“Three days,” she said, “is too long.”");
    expect(await day()).toBe(before);
  });

  test("a swipe takes the old reply's time with it and reads the new one", async () => {
    const before = await day();
    await reply("Three days later, rain.");
    await reply("The next morning, rain.", "swipe");
    const live = db.query("SELECT title FROM chronicle WHERE chat_id = 'c' AND kind = 'time' AND undone_at IS NULL").all();
    expect(live).toEqual([{ title: "The next morning" }]);
    // Midnight to the coming morning: the same day, not three on.
    expect(await day()).toBeLessThan(before + 3);
  });
});
