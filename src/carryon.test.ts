/**
 * Summing up, and carrying on.
 *
 * Two halves worth testing for different reasons. The shaping in carryon.ts is
 * arithmetic and prompt text, and is tested here directly because it decides
 * how much of somebody's evening gets read and how much they are billed for
 * reading it. The route is tested for what it carries: the whole point is that
 * nothing is lost, and everything it forgets to bring across is a thing
 * somebody only notices three messages into the new chat.
 *
 *   bun test src/carryon.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  CARRY_SYSTEM, carriedTitle, carryEntry, carryPrompt, cleanSummary,
  endWhole, recentFor, shouldSuggest, tailBudget, transcriptTokens,
} from "./carryon";
import { db, wipe } from "./test-support";

const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`http://home.example${path}`, init), HOME);

const said = (role: string, content: string, name = "") => ({ role, name, content });

describe("when to offer", () => {
  const long = Array.from({ length: 40 }, (_, i) => said("user", "x".repeat(1000) + i));

  test("not until the chat is actually long", () => {
    expect(shouldSuggest(long, { on: true, at: 100_000 })).toBe(false);
    expect(shouldSuggest(long, { on: true, at: 5_000 })).toBe(true);
  });

  test("never when it has been switched off", () => {
    expect(shouldSuggest(long, { on: false, at: 5_000 })).toBe(false);
  });

  /*
   * The far end of the slider is an off switch. Somebody who drags it to
   * nothing means "stop offering", and a threshold of zero read literally
   * would mean "offer always", which is the opposite.
   */
  test("never at a threshold of zero", () => {
    expect(shouldSuggest(long, { on: true, at: 0 })).toBe(false);
  });

  /*
   * One pasted novel is not a long evening. Without this, somebody who opens
   * a chat by dropping in a chapter is met with "this is getting long" on
   * their second message.
   */
  test("not in a chat of two enormous messages", () => {
    const pasted = [said("user", "y".repeat(200_000)), said("assistant", "Right.")];
    expect(transcriptTokens(pasted)).toBeGreaterThan(20_000);
    expect(shouldSuggest(pasted, { on: true, at: 20_000 })).toBe(false);
  });
});

describe("what gets read", () => {
  test("the most recent messages, whole ones only", () => {
    const msgs = [
      said("user", "a".repeat(100)),
      said("assistant", "b".repeat(100)),
      said("user", "c".repeat(100)),
    ];
    const got = recentFor(msgs, 250);
    expect(got.map((m) => m.content[0])).toEqual(["b", "c"]);
  });

  /*
   * Half a message reads to a model as a turn that trailed off, and the recap
   * then reports it as one — "she began to say something about the key" when
   * she said the whole thing.
   */
  test("never half of one", () => {
    const msgs = [said("user", "a".repeat(300)), said("assistant", "b".repeat(300))];
    for (const m of recentFor(msgs, 400)) expect(m.content.length).toBe(300);
  });

  test("a single enormous last message is still summarised", () => {
    const msgs = [said("assistant", "z".repeat(90_000))];
    expect(recentFor(msgs, 8_000)).toHaveLength(1);
  });

  test("the budget grows with the recap being asked for, within reason", () => {
    expect(tailBudget(300)).toBeLessThan(tailBudget(1000));
    expect(tailBudget(1)).toBeGreaterThanOrEqual(8_000);
    expect(tailBudget(999_999)).toBeLessThanOrEqual(40_000);
  });
});

describe("what gets asked", () => {
  const msgs = [said("user", "I open the door.", "Tay"), said("assistant", "It gives.", "The Gamekeeper")];

  test("names the speakers rather than saying 'user' and 'assistant'", () => {
    const p = carryPrompt(msgs, "The Gamekeeper", 300);
    expect(p).toContain("Tay: I open the door.");
    expect(p).toContain("The Gamekeeper: It gives.");
  });

  test("falls back to the character for an unnamed reply", () => {
    const p = carryPrompt([said("assistant", "Quiet here.")], "The Gamekeeper", 300);
    expect(p).toContain("The Gamekeeper: Quiet here.");
  });

  /*
   * Asked in words as well as tokens. A model told "300 tokens" will happily
   * write nine hundred — it has no reliable sense of its own tokeniser, and it
   * does have a sense of how long a paragraph is.
   */
  test("says the length in words as well", () => {
    const p = carryPrompt(msgs, "X", 400);
    expect(p).toContain("300 words");
    expect(p).toContain("400 tokens");
  });

  test("is told to report rather than to carry on writing", () => {
    expect(CARRY_SYSTEM).toContain("do not continue the story");
  });
});

describe("what comes back", () => {
  test("a fence around it is not part of the recap", () => {
    expect(cleanSummary("```\nThey reached the mill.\n```")).toBe("They reached the mill.");
  });

  test("neither is the preamble we asked it not to write", () => {
    expect(cleanSummary("Here is the recap: They reached the mill.")).toBe("They reached the mill.");
    expect(cleanSummary("Summary: They reached the mill.")).toBe("They reached the mill.");
    expect(cleanSummary("Previously, on the story: They reached the mill.")).toBe("They reached the mill.");
  });

  /*
   * There is a ceiling on the recap, so a model that overshoots is stopped
   * mid-clause. That fragment would then sit in every prompt of the new chat,
   * and a model handed a hanging "and the missing" will oblige by finishing
   * it — so the half-sentence goes rather than being lived with.
   */
  test("a sentence it was cut off in the middle of is dropped", () => {
    const cut = "They reached the mill. Nobody was in. The lamp, the barge and the missing";
    expect(endWhole(cut)).toBe("They reached the mill. Nobody was in.");
  });

  test("a recap that ends properly is not touched", () => {
    const whole = "They reached the mill. Nobody was in.";
    expect(endWhole(whole)).toBe(whole);
    expect(endWhole('She said "no."')).toBe('She said "no."');
  });

  /*
   * With no sentence boundary to fall back on there is nothing to trim to, and
   * a short recap beats none: one long sentence that got stopped is kept.
   */
  test("keeps a recap that has no whole sentence in it at all", () => {
    const mostly = "They walked a long way along the canal in the dark and then";
    expect(endWhole(mostly)).toBe(mostly);
  });

  test("an ordinary answer is left exactly alone", () => {
    const plain = "They reached the mill. Here is where it gets difficult: nobody was in.";
    expect(cleanSummary(plain)).toBe(plain);
  });
});

describe("the entry it becomes", () => {
  test("is always in the prompt rather than waiting for a keyword", () => {
    const e = carryEntry("They reached the mill.", "Greywater");
    expect(e.constant).toBe(true);
    expect(e.keys).toEqual([]);
  });

  test("says where it came from, so it can be found later", () => {
    const e = carryEntry("They reached the mill.", "Greywater");
    expect(e.content).toContain("Greywater");
    expect(e.content).toContain("They reached the mill.");
    expect(e.comment).toContain("Greywater");
  });
});

describe("naming the new chat", () => {
  test("counts rather than repeating itself", () => {
    expect(carriedTitle("Greywater")).toBe("Greywater (2)");
    expect(carriedTitle("Greywater (2)")).toBe("Greywater (3)");
    expect(carriedTitle("Greywater (9)")).toBe("Greywater (10)");
  });

  test("copes with a chat that was never named", () => {
    expect(carriedTitle("")).toBe("Untitled (2)");
  });
});

/* ---- the route ------------------------------------------------------------
 * These do not reach a provider — there is no key in the test database, so
 * the generation fails and the route refuses. Which is the thing worth
 * pinning down: a carry-on that cannot write its recap must leave the library
 * exactly as it found it, because the alternative is a new chat that looks
 * finished and has nothing in it.
 */

function seed() {
  wipe();
  const t = Date.now();
  db.query("INSERT INTO characters (id, name, created_at) VALUES (?,?,?)").run("c1", "The Gamekeeper", t);
  db.query("INSERT INTO characters (id, name, created_at) VALUES (?,?,?)").run("c2", "Andres", t);
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run("chat1", "c1", "Greywater", t, t);
  for (let i = 0; i < 8; i++) {
    db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES (?,?,?,?,?,?)")
      .run(`m${i}`, "chat1", i % 2 ? "assistant" : "user", "", `Line ${i}.`, t + i);
  }
}

const chats = () => (db.query("SELECT COUNT(*) n FROM chats").get() as any).n;

describe("carrying on", () => {
  test("a chat that is not there is a 404, not a new chat", async () => {
    seed();
    const before = chats();
    expect((await ask("/api/chats/nope/carry-on", { method: "POST" })).status).toBe(404);
    expect(chats()).toBe(before);
  });

  /*
   * There has to be something to sum up. A chat with a greeting and nothing
   * else would produce a recap of the greeting, which is the greeting.
   */
  test("a chat with nothing in it says so", async () => {
    seed();
    db.query("DELETE FROM messages WHERE chat_id = 'chat1'").run();
    const res = await ask("/api/chats/chat1/carry-on", { method: "POST" });
    expect(res.status).toBe(400);
    expect(chats()).toBe(1);
  });

  /*
   * The one that matters. With no provider the recap cannot be written, and
   * the route must stop there rather than leaving behind a chat that looks
   * like a successful carry-on until you read it.
   */
  test("a recap that cannot be written leaves nothing behind", async () => {
    seed();
    const before = {
      chats: chats(),
      books: (db.query("SELECT COUNT(*) n FROM lorebooks").get() as any).n,
      msgs: (db.query("SELECT COUNT(*) n FROM messages").get() as any).n,
      members: (db.query("SELECT COUNT(*) n FROM chat_members").get() as any).n,
    };
    const res = await ask("/api/chats/chat1/carry-on", { method: "POST" });
    expect(res.ok).toBe(false);
    expect(chats()).toBe(before.chats);
    expect((db.query("SELECT COUNT(*) n FROM lorebooks").get() as any).n).toBe(before.books);
    expect((db.query("SELECT COUNT(*) n FROM messages").get() as any).n).toBe(before.msgs);
    expect((db.query("SELECT COUNT(*) n FROM chat_members").get() as any).n).toBe(before.members);
  });
});

const APP = await Bun.file(new URL("../public/app.js", import.meta.url)).text();
const HTML = await Bun.file(new URL("../public/index.html", import.meta.url)).text();

describe("the browser's half", () => {
  test("the offer is a line by the writing box, not a dialog", () => {
    expect(HTML).toContain('id="carryBar"');
    // Above the composer in the document, which is where it draws.
    expect(HTML.indexOf('id="carryBar"')).toBeLessThan(HTML.indexOf('id="composer"'));
    expect(HTML).not.toContain('<dialog id="carryDialog"');
  });

  test("can be waved away for this chat", () => {
    expect(APP).toContain("carryHushed.add(S.chatId)");
  });

  /*
   * And having taken the offer must not be met with the same offer again the
   * next time the old chat is opened: it has been answered.
   */
  test("stays away once it has been taken", () => {
    const fn = APP.slice(APP.indexOf('$("#carryGo").onclick'));
    expect(fn.slice(0, 1400)).toContain("carryHushed.add(from)");
  });

  test("is looked at after every turn, since a chat only gets longer", () => {
    const fn = APP.slice(APP.indexOf("function done() {"), APP.indexOf("function done() {") + 500);
    expect(fn).toContain("paintCarry()");
  });

  test("does not stand over the shelf once the chat is closed", () => {
    const fn = APP.slice(APP.indexOf("async function showSplash("));
    expect(fn.slice(0, 1600)).toContain('$("#carryBar").hidden = true');
  });

  test("is never offered to a guest, who has no library to carry into", () => {
    const fn = APP.slice(APP.indexOf("function paintCarry() {"));
    expect(fn.slice(0, 900)).toContain("!GUEST.on");
  });

  /*
   * Found by pressing the button. `openChat` set S.chatId from its argument
   * and *then* read the response, so a chat that did not come back pointed the
   * whole app at an id that is not there — and threw on the line after, which
   * was the visible half of it. Everything afterwards acted on that id.
   */
  test("a chat that will not open leaves the app where it was", () => {
    const fn = APP.slice(APP.indexOf("async function openChat("));
    const head = fn.slice(0, 1200);
    expect(head).toContain("if (!got || got.error || !got.chat)");
    // The assignment comes after the check, not before it.
    expect(head.indexOf("S.chatId = id")).toBeGreaterThan(head.indexOf("!got.chat"));
  });

  /*
   * And the sliders were hidden on every load: paintLoreSettings draws them
   * from the switch above, and it ran before the loop that puts the switch
   * into the state it was stored in.
   */
  test("the sliders are drawn once the switch has been loaded", () => {
    const fn = APP.slice(APP.indexOf("async function loadSettings("));
    const body = fn.slice(0, fn.indexOf("function setModelLabel("));
    expect(body.lastIndexOf("paintLoreSettings()")).toBeGreaterThan(body.indexOf("PREFS.forEach"));
  });

  test("the three controls are in Behaviour and are saved", () => {
    expect(HTML).toContain('id="summary_suggest"');
    expect(HTML).toContain('id="summary_at"');
    expect(HTML).toContain('id="summary_size"');
    expect(APP).toContain('"summary_at", "summary_size"');
    expect(APP).toContain('"summary_suggest"');
  });
});
