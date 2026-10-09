/**
 * Apocrypha: a plan the model follows one scene at a time, and never mistakes
 * for what has already happened.
 */

import { describe, expect, test } from "bun:test";

import { db, wipe, setSettings } from "./test-support";
import { advance, briefFor, jumpTo, normaliseChapters, startBookmark, statusOf, type Apocryphon } from "./apocrypha";

const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const BOOK: Apocryphon = {
  id: "lion",
  name: "The Champion of the Hand",
  premise: "Jaime agrees to a marriage his father arranged, on terms of his own.",
  chapters: normaliseChapters([
    { id: "c3", title: "The Lion's Bargain", scenes: [
      { id: "s7", title: "The Contract", setting: "Tywin's solar", cast: "Jaime, Yvenna, Tywin",
        purpose: "The contract is presented.", beats: "Jaime insists on the fidelity clause.",
        ending: "Jaime signs, or walks out." },
      { id: "s8", title: "A Lion Cornered", setting: "The Red Keep", cast: "Jaime, Cersei",
        purpose: "Cersei confronts Jaime over the marriage.", beats: "SECRET-CERSEI-BEAT" },
      { id: "s9", title: "The Wedding", setting: "Great Sept of Baelor", beats: "SECRET-WEDDING-BEAT" },
    ] },
  ]),
};

describe("the bookmark", () => {
  test("starts at the first scene and moves on one at a time", () => {
    let m = startBookmark(BOOK);
    expect(m.scene).toBe("s7");
    m = advance(BOOK, m, "done");
    expect(m.scene).toBe("s8");
    expect(statusOf(m, "s7")).toBe("done");
    m = advance(BOOK, m, "skipped");
    expect(m.scene).toBe("s9");
    expect(statusOf(m, "s8")).toBe("skipped");
    m = advance(BOOK, m, "done");
    expect(m.scene).toBe("");   // the book has run out
  });

  test("jumping back reopens that scene and leaves later ones closed", () => {
    let m = advance(BOOK, advance(BOOK, startBookmark(BOOK), "done"), "done");
    m = jumpTo(BOOK, m, "s7");
    expect(m.scene).toBe("s7");
    expect(statusOf(m, "s8")).toBe("done");
    // Finishing it again goes past the scenes already played, not back through them.
    expect(advance(BOOK, m, "done").scene).toBe("s9");
  });
});

describe("what the model is told", () => {
  test("the current scene in full, the next by name only, and nothing further", () => {
    const brief = briefFor(BOOK, startBookmark(BOOK))!;
    expect(brief).toContain("The Contract");
    expect(brief).toContain("Tywin's solar");
    expect(brief).toContain("fidelity clause");
    expect(brief).toContain("not a script");
    // The next scene, by title — never its contents.
    expect(brief).toContain("A Lion Cornered");
    expect(brief).not.toContain("SECRET-CERSEI-BEAT");
    expect(brief).not.toContain("The Wedding");
    expect(brief).not.toContain("SECRET-WEDDING-BEAT");
  });

  test("nothing at all once the book has run out", () => {
    let m = startBookmark(BOOK);
    for (let i = 0; i < 3; i++) m = advance(BOOK, m, "done");
    expect(briefFor(BOOK, m)).toBeNull();
  });
});

describe("in a chat", () => {
  async function seed() {
    wipe();
    db.query("DELETE FROM apocrypha").run();
    setSettings({ mode: "story" });
    const t = Date.now();
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('jaime', 'Jaime', ?)").run(t);
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'jaime', 'Lions', ?, ?)").run(t, t);
    db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES ('m1', 'ch', 'user', 'Father.', ?)").run(t);
    const { id } = await (await send("/api/apocrypha", "POST", { name: BOOK.name, premise: BOOK.premise })).json();
    await send(`/api/apocrypha/${id}`, "PUT", { name: BOOK.name, premise: BOOK.premise, chapters: BOOK.chapters });
    return id as string;
  }
  const inspect = async () =>
    (await (await send("/api/chats/ch/inspect", "POST", {})).json()).sections as { label: string; content: string }[];
  const headed = async () => (await inspect()).find((s) => s.label === "Where the story is headed");

  test("a chat that follows nothing is told nothing", async () => {
    await seed();
    expect(await headed()).toBeUndefined();
  });

  test("following a book puts the current scene in the prompt, and advancing moves it", async () => {
    const id = await seed();
    await send("/api/chats/ch/apocrypha", "PUT", { book: id });
    let h = await headed();
    expect(h?.content).toContain("The Contract");
    expect(h?.content).not.toContain("SECRET-CERSEI-BEAT");
    // It travels with the conversation, after the transcript, where it is read.
    const convo = (await inspect()).find((s) => s.label === "Conversation")!.content;
    expect(convo).toContain("The Contract");

    await send("/api/chats/ch/apocrypha/advance", "POST", { how: "done" });
    h = await headed();
    expect(h?.content).toContain("A Lion Cornered");
    expect(h?.content).toContain("SECRET-CERSEI-BEAT");
    expect(h?.content).not.toContain("SECRET-WEDDING-BEAT");
  });

  test("progress belongs to the chat: a branch takes a copy and goes its own way", async () => {
    const id = await seed();
    await send("/api/chats/ch/apocrypha", "PUT", { book: id });
    const branch = await (await ask("/api/messages/m1/branch", { method: "POST" })).json();
    const branchId = branch.id ?? branch.chat?.id;
    expect(branchId).toBeTruthy();

    await send(`/api/chats/${branchId}/apocrypha/advance`, "POST", { how: "done" });
    const there = await (await ask(`/api/chats/${branchId}/apocrypha`)).json();
    const here = await (await ask("/api/chats/ch/apocrypha")).json();
    expect(there.mark.scene).toBe("s8");
    expect(here.mark.scene).toBe("s7");
  });

  test("editing the book out from under a chat moves it on rather than stranding it", async () => {
    const id = await seed();
    await send("/api/chats/ch/apocrypha", "PUT", { book: id });
    const trimmed = BOOK.chapters.map((c) => ({ ...c, scenes: c.scenes.filter((s) => s.id !== "s7") }));
    await send(`/api/apocrypha/${id}`, "PUT", { name: BOOK.name, premise: BOOK.premise, chapters: trimmed });
    const now = await (await ask("/api/chats/ch/apocrypha")).json();
    expect(now.mark.scene).toBe("s8");
  });

  test("deleting the book lets go of every chat that followed it", async () => {
    const id = await seed();
    await send("/api/chats/ch/apocrypha", "PUT", { book: id });
    await ask(`/api/apocrypha/${id}`, { method: "DELETE" });
    const now = await (await ask("/api/chats/ch/apocrypha")).json();
    expect(now.book).toBeNull();
    expect(await headed()).toBeUndefined();
  });
});
