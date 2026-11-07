/** Settings are typed by people: whatever is in a number box, the story still goes, and nothing breaks. */
import { afterAll, expect, test } from "bun:test";
import { db, setSettings, wipe } from "./test-support";
const { app, offstageTurn, stewardTurn } = await import("./index");
const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const call = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body?: unknown) =>
  call(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });

const ODD = ["", "0", "-5", "abc", "1e9", "NaN", "3.7", " 12 "];
test("odd numbers in every setting Story World reads: no crash, and the request still fits what it can", async () => {
  const problems: string[] = [];
  for (const v of ODD) {
    wipe();
    setSettings({ mode: "story", provider: "openrouter", key_openrouter: "sk", model: "m", story_world: "1", steward_on: "1",
      context_tokens: v, max_tokens: v === "abc" ? "99999" : v, steward_every: v, offstage_per_day: v, news_reach: v, gossip_decay: v,
      offstage_level: "dynamic", gossip_level: v === "abc" ? "nonsense" : "chaotic" });
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('j', 'Jaime Lannister', 1)").run();
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'j', 'Odd', 1, 1)").run();
    db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('m1', 'ch', 'assistant', 'Jaime Lannister', 'Three days later, the rain stopped.', 2)").run();
    globalThis.fetch = (async (_u: any, init: any) => {
      const b = JSON.parse(init.body);
      if (b.stream) {
        const enc = new TextEncoder();
        return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "He waited." } }] })}\n\ndata: [DONE]\n\n`)); c.close(); } }), { headers: { "content-type": "text/event-stream" } });
      }
      if (!(b.sampling?.maxTokens ?? b.max_tokens ?? 1) || (b.max_tokens !== undefined && !(b.max_tokens > 0))) problems.push(`${JSON.stringify(v)}: a background asking with no room to answer (${b.max_tokens})`);
      return Response.json({ choices: [{ message: { content: "NONE" } }] });
    }) as any;
    try {
      const ins = await send("/api/chats/ch/inspect", "POST", {});
      if (ins.status !== 200) problems.push(`${JSON.stringify(v)}: inspect ${ins.status}`);
      const body = await ins.json();
      if (!body.sections?.some((x: any) => x.label === "Conversation")) problems.push(`${JSON.stringify(v)}: no conversation sent`);
      const g = await (await send("/api/chats/ch/generate", "POST", { mode: "reply", content: "We go on." })).text();
      if (g.includes('"error"')) problems.push(`${JSON.stringify(v)}: reply failed ${g.slice(-120)}`);
      await stewardTurn("ch");
      await offstageTurn("ch");
      const run = await send("/api/chats/ch/offstage/run", "POST");
      if (run.status >= 500) problems.push(`${JSON.stringify(v)}: run a day ${run.status}`);
      const page = await call("/api/chats/ch/chronicle");
      if (page.status !== 200) problems.push(`${JSON.stringify(v)}: Story World page ${page.status}`);
    } catch (e: any) { problems.push(`${JSON.stringify(v)}: threw ${e?.message}`); }
  }
  expect(problems).toEqual([]);
});
