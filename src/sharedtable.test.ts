/**
 * A table with two people at it, and the three ways it was not one.
 *
 * All three were reported together, because from the outside they are one
 * complaint — "his turns aren't registering and he has to refresh every round".
 * They are not one bug, and the middle one is the sort that only ever shows up
 * on somebody else's phone.
 *
 *   bun test src/sharedtable.test.ts
 */

import { describe, expect, test } from "bun:test";

import { db, setSettings, wipe } from "./test-support";

const { app } = await import("./index");

const APP = await Bun.file(new URL("../public/app.js", import.meta.url)).text();
const SRC = await Bun.file(new URL("./index.ts", import.meta.url)).text();

const AWAY = { incoming: { socket: { remoteAddress: "203.0.113.9" } } };
const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };

const ask = (path: string, init: RequestInit = {}, env: any = AWAY) =>
  app.fetch(new Request(`http://table.example${path}`, init), env);

function seed(mode: "story" | "tabletop") {
  wipe();
  const t = Date.now();
  db.query("INSERT INTO characters (id, name, description, created_at) VALUES (?,?,?,?)")
    .run("c1", "The Gamekeeper", "Runs the scene.", t);
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run("chat1", "c1", "Greywater", t, t);
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES (?,?,?,?,?,?)")
    .run("m1", "chat1", "assistant", "The Gamekeeper", "The fire is low.", t);
  setSettings({ mode, persona_name: "Bing Us" });
}

/** Open the chat up and sit somebody down in it. */
async function tableWith(name: string) {
  const share = (await (await ask("/api/shares", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: "chat1" }),
  }, HOME)).json()) as any;
  const res = await ask(share.join, {}, AWAY);
  const token = /hearth_player=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
  const cookie = `hearth_player=${token}`;
  await ask("/api/table/me", {
    method: "PUT", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name }),
  }, AWAY);
  return { cookie, share };
}

const inspect = async (body: unknown) =>
  (await (await ask("/api/chats/chat1/inspect", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, HOME)).json()) as any;

const sectionNamed = (d: any, label: string) =>
  (d.sections ?? []).find((s: any) => s.label === label)?.content ?? "";

describe("answering a guest's turn", () => {
  /*
   * The one that made the whole thing look broken.
   *
   * The host's copy answers for the table, and it used to do that with mode
   * `silent` — sound reasoning, since the guest's turn is already written down
   * and there is nothing to send. But `silent` does not mean "no message
   * attached", it means "the person whose persona this is has chosen not to
   * speak", and it says so in the system prompt by name. So every guest turn
   * told the narrator the *host* had gone quiet, and it wrote the scene
   * accordingly: "Bing Us has said nothing. The Gamekeeper fills the silence."
   * — while the guest's actual message sat in the history, unanswered.
   */
  test("does not tell the narrator the host went quiet", async () => {
    seed("tabletop");
    const dan = await tableWith("No");
    await ask("/api/table/say", {
      method: "POST", headers: { "content-type": "application/json", cookie: dan.cookie },
      body: JSON.stringify({ content: "Poke him" }),
    }, AWAY);

    const d = await inspect({ mode: "reply", content: "" });
    expect(d.system).not.toContain("has said nothing");
    expect(d.system).not.toContain("stays quiet this turn");
  });

  /* And the guest's turn is in there, signed, so it can be answered. */
  test("hands the narrator the turn that was actually taken", async () => {
    seed("tabletop");
    const dan = await tableWith("No");
    await ask("/api/table/say", {
      method: "POST", headers: { "content-type": "application/json", cookie: dan.cookie },
      body: JSON.stringify({ content: "Poke him" }),
    }, AWAY);
    const conv = sectionNamed(await inspect({ mode: "reply", content: "" }), "Conversation");
    expect(conv).toContain("Poke him");
    expect(conv).toContain("No:");
  });

  /*
   * And the real silent turn still works. It is a feature — send an empty
   * message and the scene moves on without you — and the fix above must not
   * have quietly removed it.
   */
  test("a genuine silent turn still says so", async () => {
    seed("story");
    const d = await inspect({ mode: "silent" });
    expect(d.system).toContain("has said nothing");
  });

  test("and the browser answers guests with reply, not silent", () => {
    const fn = APP.slice(APP.indexOf("async function tgAnswer("), APP.indexOf("$(\"#tgOpen\").onclick"));
    expect(fn).toContain('await run("reply")');
    expect(fn.includes('run("silent")')).toBe(false);
  });
});

describe("who the narrator is told is here", () => {
  test("everybody, the host included", async () => {
    seed("tabletop");
    await tableWith("No");
    const table = sectionNamed(await inspect({ mode: "reply", content: "" }), "The table");
    expect(table).toContain("# Who is playing");
    // The guest, and the person whose chat it is — who has a persona rather
    // than a seat, and was being left out of their own table.
    expect(table).toContain("No");
    expect(table).toContain("Bing Us");
  });

  /*
   * This block only ever existed in tabletop mode, so a shared *story* chat
   * had nothing at all: the guest was invisible to the narrator, which
   * answered the host for every turn anybody took.
   */
  test("in a story too, not only at a table", async () => {
    seed("story");
    await tableWith("No");
    const d = await inspect({ mode: "reply", content: "" });
    const roster = sectionNamed(d, "Who is playing");
    expect(roster).toContain("# Who is playing");
    expect(roster).toContain("No");
    expect(roster).toContain("Bing Us");
  });

  /* Playing alone must not be told it is a crowd. */
  test("and nothing at all when nobody else is here", async () => {
    seed("story");
    const d = await inspect({ mode: "reply", content: "" });
    expect(sectionNamed(d, "Who is playing")).toBe("");
    expect(d.system).not.toContain("Who is playing");
  });

  test("nor when the table has been closed again", async () => {
    seed("tabletop");
    const dan = await tableWith("No");
    await ask(`/api/shares/${dan.share.id}`, { method: "DELETE" }, HOME);
    const table = sectionNamed(await inspect({ mode: "reply", content: "" }), "The table");
    expect(table.includes("# Who is playing")).toBe(false);
  });
});

describe("a guest's screen keeping up", () => {
  /*
   * The heartbeat used to be an SSE comment, which the EventSource parser eats
   * without telling the page. So there was no way to tell a quiet table from a
   * dead socket — and on iOS that is the whole problem, because Safari reaps
   * these connections and leaves a readyState that still says OPEN.
   */
  test("the table's pulse is something the page can see", () => {
    // This one route only. The generation stream and the host's own feed keep
    // their comment keep-alives: nothing is timing those from a phone.
    const at = SRC.indexOf('api.get("/table/live"');
    const body = SRC.slice(at, SRC.indexOf("\napi.", at + 10));
    expect(body).toContain('emit("ping"');
    // The code, not the comment above it — which quotes the old string in
    // order to explain why it is gone.
    expect(body.includes('push(": keep-alive')).toBe(false);
  });

  test("silence past the pulse counts as a dead line", () => {
    expect(APP).toContain("const guestStale = ()");
    expect(APP).toContain("HEARD_STALE");
    // Every message, ping included, is proof the line is alive.
    expect(APP).toContain("GUEST.heard = Date.now();");
  });

  /*
   * Coming back to the tab used to reconnect only when the browser admitted
   * the socket was CLOSED. iOS hands back one that claims to be open and never
   * delivers again — so you saw what you had missed, once, and were stranded
   * by the very next reply.
   */
  test("a socket that lies about being open is replaced anyway", () => {
    const fn = APP.slice(APP.indexOf("function guestWake() {"));
    expect(fn.slice(0, 900)).toContain("|| guestStale()");
  });

  test("and a tab nobody is looking at is left alone", () => {
    const w = APP.slice(APP.indexOf("setInterval(() => {\n  // A hidden tab"));
    expect(w.slice(0, 400)).toContain("document.hidden");
  });
});
