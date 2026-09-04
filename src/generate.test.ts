/**
 * The generation route, against a stubbed provider.
 *
 * The bug these exist for: stopping a generation used to abort the browser's
 * fetch and nothing else. The server kept reading from the provider — so the
 * whole completion was paid for — and then saved the finished reply you thought
 * you had cancelled. A stop has to reach the provider call.
 *
 *   bun test
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { db, setSettings, wipe } from "./test-support";

const { app } = await import("./index");
const server = { fetch: app.fetch };

const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });

// ---- a provider that streams slowly and notices being cancelled ------------

const WORDS = ["Hello", " there", " friend", " of", " mine"];
const GAP = 120;

/** True once the provider call was actually aborted, not just abandoned. */
let providerAborted = false;
/** How many chunks the provider managed to send before it stopped. */
let sentChunks = 0;

function stubProvider() {
  providerAborted = false;
  sentChunks = 0;
  globalThis.fetch = ((_url: any, init: any) => {
    const signal: AbortSignal | undefined = init?.signal;
    const enc = new TextEncoder();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let i = 0;

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const fail = () => {
          providerAborted = true;
          clearTimeout(timer);
          try { controller.error(new DOMException("The operation was aborted.", "AbortError")); } catch {}
        };
        if (signal?.aborted) return fail();
        signal?.addEventListener("abort", fail, { once: true });

        const push = () => {
          if (signal?.aborted) return;
          if (i >= WORDS.length) {
            try {
              controller.enqueue(enc.encode("data: [DONE]\n\n"));
              controller.close();
            } catch {}
            return;
          }
          const frame = { choices: [{ delta: { content: WORDS[i++] } }] };
          sentChunks++;
          try { controller.enqueue(enc.encode(`data: ${JSON.stringify(frame)}\n\n`)); } catch { return; }
          timer = setTimeout(push, GAP);
        };
        push();
      },
    });

    return Promise.resolve(
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
  }) as any;
}

// ---- fixtures --------------------------------------------------------------

const CHAT = "t1";

function seed() {
  wipe();
  db.query("INSERT INTO characters (id, name, first_message, created_at) VALUES (?,?,?,?)")
    .run("c1", "Akira", "You're late.", 1);
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run(CHAT, "c1", "A chat", 1, 1);
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES (?,?,?,?,?,?)")
    .run("m0", CHAT, "user", "", "Say something.", 10);
  setSettings({ provider: "openrouter", key_openrouter: "sk-test", model: "test/model" });
}

const post = async (path: string, body?: unknown): Promise<Response> =>
  server.fetch(
    new Request(`http://hearth.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

/** Reads SSE frames, optionally running a hook after the first delta arrives. */
async function drain(res: Response, onFirstDelta?: () => Promise<void> | void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const events: any[] = [];
  let buf = "";
  let fired = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (!line.startsWith("data:")) continue;      // keep-alive comment frames
      const evt = JSON.parse(line.slice(5));
      events.push(evt);
      if (evt.delta && !fired && onFirstDelta) {
        fired = true;
        await onFirstDelta();
      }
    }
  }
  return events;
}

const lastReply = () =>
  db.query("SELECT * FROM messages WHERE chat_id = ? AND role = 'assistant' ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(CHAT) as any;

beforeEach(() => { seed(); stubProvider(); });
afterEach(() => { globalThis.fetch = realFetch; });

// ---- letting it finish -----------------------------------------------------

describe("a generation left alone", () => {
  test("streams, then saves the whole reply", async () => {
    const events = await drain(await post(`/api/chats/${CHAT}/generate`, { mode: "reply", content: "hi" }));
    const done = events.find((e) => e.done);
    expect(done).toBeTruthy();
    expect(providerAborted).toBe(false);
    expect(lastReply().content).toBe(WORDS.join(""));
  });

  test("the user's turn is saved and its id is announced first", async () => {
    const events = await drain(await post(`/api/chats/${CHAT}/generate`, { mode: "reply", content: "hi" }));
    expect(events[0].userMessageId).toBeTruthy();
    const saved = db.query("SELECT * FROM messages WHERE id = ?").get(events[0].userMessageId) as any;
    expect(saved.content).toBe("hi");
  });
});

// ---- stopping --------------------------------------------------------------

describe("stopping a generation", () => {
  test("cancels the provider call rather than just the browser's fetch", async () => {
    const res = await post(`/api/chats/${CHAT}/generate`, { mode: "reply", content: "hi" });
    await drain(res, async () => { await post(`/api/chats/${CHAT}/stop`); });
    expect(providerAborted).toBe(true);
    expect(sentChunks).toBeLessThan(WORDS.length);
  });

  test("keeps what arrived instead of saving a completion you cancelled", async () => {
    const res = await post(`/api/chats/${CHAT}/generate`, { mode: "reply", content: "hi" });
    const events = await drain(res, async () => { await post(`/api/chats/${CHAT}/stop`); });

    const saved = lastReply();
    const full = WORDS.join("");
    expect(saved.content.length).toBeGreaterThan(0);
    expect(saved.content).not.toBe(full);
    expect(full.startsWith(saved.content)).toBe(true);
    // The client still gets a `done` frame, so the thread and the database agree.
    expect(events.find((e) => e.done)?.id).toBe(saved.id);
  });

  test("reports whether there was anything to stop", async () => {
    const idle = await (await post(`/api/chats/${CHAT}/stop`)).json();
    expect(idle.stopped).toBe(false);

    const res = await post(`/api/chats/${CHAT}/generate`, { mode: "reply", content: "hi" });
    let live: any;
    await drain(res, async () => { live = await (await post(`/api/chats/${CHAT}/stop`)).json(); });
    expect(live.stopped).toBe(true);
  });

  test("stopping before a single token arrives leaves the chat untouched", async () => {
    const before = db.query("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?").get(CHAT) as any;
    const res = await post(`/api/chats/${CHAT}/generate`, { mode: "silent" });
    await post(`/api/chats/${CHAT}/stop`);
    const events = await drain(res);

    if (events.some((e) => e.stopped)) {
      const after = db.query("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?").get(CHAT) as any;
      expect(after.n).toBe(before.n);
      expect(lastReply()).toBeNull();
    } else {
      // The first chunk beat the stop; then it must have been kept, not dropped.
      expect(lastReply().content.length).toBeGreaterThan(0);
    }
  });

  test("stopped while the model is still thinking saves nothing", async () => {
    // Reasoning but no prose. Saving it would leave a blank plate in the thread.
    globalThis.fetch = ((_url: any, init: any) => {
      const signal: AbortSignal | undefined = init?.signal;
      const enc = new TextEncoder();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            try { controller.error(new DOMException("aborted", "AbortError")); } catch {}
          }, { once: true });

          const frame = { choices: [{ delta: { reasoning: "weighing it up… " } }] };
          const push = () => {
            if (signal?.aborted) return;
            try { controller.enqueue(enc.encode(`data: ${JSON.stringify(frame)}\n\n`)); } catch { return; }
            timer = setTimeout(push, GAP);
          };
          push();
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as any;

    const res = await post(`/api/chats/${CHAT}/generate`, { mode: "reply", content: "hi" });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let sawReasoning = false;
    let sawStopped = false;
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 2);
        if (!line.startsWith("data:")) continue;
        const evt = JSON.parse(line.slice(5));
        if (evt.stopped) sawStopped = true;
        if (evt.reasoning && !sawReasoning) {
          sawReasoning = true;
          await post(`/api/chats/${CHAT}/stop`);
        }
      }
    }
    expect(sawReasoning).toBe(true);
    expect(sawStopped).toBe(true);
    expect(lastReply()).toBeNull();
  });

  test("a stopped continue keeps the text it had plus whatever arrived", async () => {
    db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at, swipes) VALUES (?,?,?,?,?,?,?)")
      .run("m1", CHAT, "assistant", "Akira", "She began to speak.", 11, JSON.stringify(["She began to speak."]));

    const res = await post(`/api/chats/${CHAT}/generate`, { mode: "continue" });
    await drain(res, async () => { await post(`/api/chats/${CHAT}/stop`); });

    const row = db.query("SELECT * FROM messages WHERE id = ?").get("m1") as any;
    expect(row.content.startsWith("She began to speak.")).toBe(true);
    expect(row.content.length).toBeGreaterThan("She began to speak.".length);
  });
});

// ---- refusals --------------------------------------------------------------

describe("refusals", () => {
  test("continue with nothing to continue is a 400 with a reason", async () => {
    const res = await post(`/api/chats/${CHAT}/generate`, { mode: "continue" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("no reply to continue");
  });

  test("swipe with nothing to swipe is a 400 with a reason", async () => {
    const res = await post(`/api/chats/${CHAT}/generate`, { mode: "swipe" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("no reply to swipe");
  });

  test("a refused generation writes nothing down", async () => {
    const before = db.query("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?").get(CHAT) as any;
    await post(`/api/chats/${CHAT}/generate`, { mode: "swipe", content: "hi" });
    const after = db.query("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?").get(CHAT) as any;
    expect(after.n).toBe(before.n);
  });

  test("an unknown chat is a 404", async () => {
    const res = await post(`/api/chats/nope/generate`, { mode: "reply", content: "hi" });
    expect(res.status).toBe(404);
  });

  test("a provider failure is reported and nothing is saved", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response(JSON.stringify({ error: { message: "no credit" } }), { status: 402 }))) as any;

    const events = await drain(await post(`/api/chats/${CHAT}/generate`, { mode: "reply", content: "hi" }));
    expect(events.find((e) => e.error)?.error).toContain("no credit");
    expect(lastReply()).toBeNull();
  });
});

// ---- wiping ----------------------------------------------------------------

describe("delete all data", () => {
  test("refuses without the confirmation word", async () => {
    const res = await post("/api/wipe", {});
    expect(res.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS n FROM characters").get() as any).toEqual({ n: 1 });
  });

  test("clears the library and everything hanging off it", async () => {
    db.query("INSERT INTO personas (id, name, is_active, created_at) VALUES (?,?,?,?)").run("p1", "Wren", 1, 1);
    db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES (?,?,?,?,?)").run("pr1", "P", "{}", 1, 1);
    db.query("INSERT INTO lorebooks (id, name, entries, created_at) VALUES (?,?,?,?)").run("b1", "B", "[]", 1);
    db.query("INSERT INTO lorebook_links (id, book_id, scope, target_id) VALUES (?,?,?,?)").run("l1", "b1", "chat", CHAT);
    // A binned row must go too: a wipe that leaves the bin full is a lie.
    db.query("UPDATE characters SET deleted_at = 1").run();

    const r = await (await post("/api/wipe", { confirm: "delete" })).json();
    expect(r.ok).toBe(true);
    for (const t of ["characters", "chats", "messages", "personas", "presets", "lorebooks", "lorebook_links"]) {
      expect((db.query(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n).toBe(0);
    }
  });

  test("keeps your API key and settings", async () => {
    await post("/api/wipe", { confirm: "delete" });
    const s = await (await server.fetch(new Request("http://hearth.test/api/settings"))).json();
    expect(s.key_openrouter).toBe("__saved__");
    expect(s.model).toBe("test/model");
  });
});

// ---- walking away mid-reply ------------------------------------------------

/**
 * The bug: swiping out of the app on Android drops the socket, and the server
 * treated a dropped socket as a decision to stop. So a reply was lost every
 * time you glanced at something else — and since the provider had already been
 * asked, the tokens were spent regardless. Only the text was thrown away.
 *
 * A reader going away is not a stop. The Stop button is a stop.
 */
describe("a generation whose reader goes away", () => {
  test("keeps going and saves the whole reply", async () => {
    const res = await post(`/api/chats/${CHAT}/generate`, { mode: "reply", content: "hi" });
    const reader = res.body!.getReader();
    await reader.read();          // one frame, then the app is backgrounded
    await reader.cancel();

    await new Promise((r) => setTimeout(r, GAP * (WORDS.length + 4)));

    expect(providerAborted).toBe(false);
    expect(lastReply()?.content).toBe(WORDS.join(""));
  });

  test("reports itself as running until it lands", async () => {
    const isRunning = async () =>
      (await (await server.fetch(
        new Request(`http://hearth.test/api/chats/${CHAT}/running`),
      )).json()).running;

    const res = await post(`/api/chats/${CHAT}/generate`, { mode: "reply", content: "hi" });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();

    expect(await isRunning()).toBe(true);
    await new Promise((r) => setTimeout(r, GAP * (WORDS.length + 4)));
    expect(await isRunning()).toBe(false);
  });
});

// ---- extensions in the loop ------------------------------------------------

/**
 * The unit tests in extensions.test.ts prove the hook runner. This proves it
 * is actually plugged in: an extension installed in the database changes what
 * the chat ends up keeping, not merely what some function returns.
 */
describe("an extension with a server half", () => {
  const install = (server: string, enabled = 1) =>
    db.query(
      `INSERT INTO extensions (id, name, version, description, enabled, client, server, position, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run("x1", "Shouty", "1.0.0", "", enabled, "", server, 0, 1);

  test("rewrites the reply before it is saved", async () => {
    install(`hearth.on("reply:after", t => t.toUpperCase());`);
    await drain(await post(`/api/chats/${CHAT}/generate`, { mode: "reply", content: "hi" }));
    expect(lastReply().content).toBe(WORDS.join("").toUpperCase());
  });

  test("a disabled one leaves the reply alone", async () => {
    install(`hearth.on("reply:after", t => t.toUpperCase());`, 0);
    await drain(await post(`/api/chats/${CHAT}/generate`, { mode: "reply", content: "hi" }));
    expect(lastReply().content).toBe(WORDS.join(""));
  });

  test("one that throws does not stop the reply landing", async () => {
    install(`hearth.on("reply:after", () => { throw new Error("bad day"); });`);
    await drain(await post(`/api/chats/${CHAT}/generate`, { mode: "reply", content: "hi" }));
    expect(lastReply().content).toBe(WORDS.join(""));
  });

  test("can add to the prompt without breaking the turn", async () => {
    install(`hearth.on("prompt:before", p => ({ ...p, system: p.system + " Be brief." }));`);
    const events = await drain(await post(`/api/chats/${CHAT}/generate`, { mode: "reply", content: "hi" }));
    expect(events.find((e) => e.done)).toBeTruthy();
    expect(lastReply().content).toBe(WORDS.join(""));
  });
});
