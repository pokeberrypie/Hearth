/**
 * A model on the phone, answering one request at a time: Hearth keeps out of its own way.
 *
 * The conversation's window holds still, so the server reads only what is new; a story reply goes before the
 * Steward and the Offstage; a reply still running when a new one begins is stopped and dropped, not left to run
 * unseen ahead of it; and a reply that was all thinking is said so, not saved as a blank.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { db, setSettings, wipe } from "./test-support";
import { windowOf } from "./prompt";
import { generate as ask, YieldedToReply } from "./providers";

const { app, stewardTurn } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const call = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test${path}`, init), HOME);
const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });

const LOCAL = { provider: "custom", custom_base: "http://127.0.0.1:8080/v1", custom_format: "openai", model: "qwen3-4b" };
beforeEach(() => {
  globalThis.fetch = realFetch;
  wipe();
  setSettings({ mode: "story", ...LOCAL, steward_on: "0", story_world: "0" });
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('j', 'Jaime Lannister', 1)").run();
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'j', 'The Road', 1, 1)").run();
});
const send = (content = "Go on.") => call("/api/chats/ch/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) });
const replies = () => (db.query("SELECT content FROM messages WHERE chat_id = 'ch' AND role = 'assistant'").all() as any[]).map((r) => r.content);
const stream = (delta: Record<string, string>) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) {
    c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`));
    c.enqueue(enc.encode("data: [DONE]\n\n")); c.close();
  } }), { headers: { "content-type": "text/event-stream" } });
};

describe("the conversation's window holds still", () => {
  const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, content: "x".repeat(396) })); // 100 tokens each, with the envelope 104

  test("all of it while it fits; past the budget, a long way down — then the same start, turn after turn", () => {
    expect(windowOf(msgs(9), 1000).kept).toHaveLength(9);
    const first = windowOf(msgs(11), 1000);
    expect(first.kept.length).toBeLessThanOrEqual(7);
    // The chat grows by a turn, and by another: the start does not move, so the server reads only the new.
    const next = windowOf(msgs(12), 1000, first.from);
    expect(next.from).toBe(first.from);
    expect(windowOf(msgs(13), 1000, next.from).from).toBe(first.from);
    // Until it is full again, and then it moves a long way once more.
    const moved = windowOf(msgs(16), 1000, first.from);
    expect(moved.from).not.toBe(first.from);
  });

  test("the plain way, for a server that does not keep what it read: the newest that fits", () => {
    expect(windowOf(msgs(20), 1000, null, 1).kept).toHaveLength(9);
  });
});

describe("a story reply goes first", () => {
  test("a background asking to the same local server is set aside for it, as yielded, not failed", async () => {
    globalThis.fetch = (async (_u: any, init: any) => {
      const b = JSON.parse(init.body);
      if (b.stream) return stream({ content: "Jaime rode on." });
      // The Steward's asking: held until it is set aside.
      return new Promise((_, no) => init.signal.addEventListener("abort", () => no(init.signal.reason)));
    }) as any;
    const sampling = { temperature: 0, maxTokens: 4000, topP: 1, minP: 0, repetitionPenalty: 1, frequencyPenalty: 0, presencePenalty: 0, reasoningEffort: "off" };
    const conn = { provider: "custom", baseUrl: "http://127.0.0.1:8080/v1", format: "openai", apiKey: "", model: "m", system: "", messages: [{ role: "user", content: "x" }] } as any;
    const bg = (async () => { for await (const _ of ask({ ...conn, sampling: { ...sampling, stream: false } })) {} })();
    await new Promise((r) => setTimeout(r, 10));
    let story = "";
    for await (const c of ask({ ...conn, sampling: { ...sampling, stream: true } })) if (c.kind === "text") story += c.text;
    expect(story).toBe("Jaime rode on.");
    await expect(bg).rejects.toBeInstanceOf(YieldedToReply);
  });

  test("set aside, the Steward keeps its place and records no failure: it reads those messages next time", async () => {
    setSettings({ steward_on: "1", steward_every: "1", story_world: "1" });
    for (let i = 0; i < 3; i++) db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES (?, 'ch', 'user', '', 'On.', ?)").run(`s${i}`, 10 + i);
    globalThis.fetch = (async () => { throw new YieldedToReply(); }) as any;
    await stewardTurn("ch");
    expect((db.query("SELECT steward_at FROM chats WHERE id = 'ch'").get() as any).steward_at).toBe(0);
    expect((db.query("SELECT COUNT(*) n FROM steward_runs WHERE chat_id = 'ch' AND problem != ''").get() as any).n).toBe(0);
  });
});

describe("one reply per chat at a time", () => {
  test("a reply still running when a new one begins is stopped and dropped; only the new one is kept", async () => {
    let n = 0;
    globalThis.fetch = (async (_u: any, init: any) => {
      n++;
      if (n === 1) {
        // The first: a few words, then nothing more until it is stopped.
        const enc = new TextEncoder();
        return new Response(new ReadableStream({ start(c) {
          c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "The first reply, which nobody is watching any more, went on and on" } }] })}\n\n`));
          init.signal.addEventListener("abort", () => c.error(init.signal.reason ?? new Error("aborted")));
        } }), { headers: { "content-type": "text/event-stream" } });
      }
      return stream({ content: "The second reply." });
    }) as any;
    const first = Promise.resolve(send("First.")).then((r: Response) => r.text());
    await new Promise((r) => setTimeout(r, 30));
    await (await send("Second.")).text();
    await first;
    expect(replies()).toEqual(["The second reply."]);
  });
});

describe("a reply that was all thinking", () => {
  test("is said so, not saved as an empty message", async () => {
    globalThis.fetch = (async () => stream({ reasoning_content: "Let me think about Jaime and the road and what he would say..." })) as any;
    const said = await (await send()).text();
    expect(said).toContain("spent the whole reply thinking");
    expect(said).toContain('No thinking');
    expect(replies()).toEqual([]);
  });
});
