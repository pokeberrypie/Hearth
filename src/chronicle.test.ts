/**
 * The chronicle: a chat's own record of its story, only ever added to, and
 * cut along with the chat when it branches.
 *
 *   bun test src/chronicle.test.ts
 */

import { describe, expect, test } from "bun:test";

import { db, wipe, setSettings } from "./test-support";
import { MOONS, UNDATED } from "./calendar";
import { clockOf, forBranch, forCarryOn, live, normaliseEntry, statusOf, view, type Entry } from "./chronicle";

const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body?: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const DAY = 1440;
let clock = 1000;
const entry = (over: Partial<Entry>): Entry =>
  normaliseEntry({ id: `e${clock}`, kind: "event", title: "x", created_at: clock++, ...over });

describe("reading the clock", () => {
  test("starts at day 0, moves with time, jumps with a set, and ignores events", () => {
    const es = [
      entry({ kind: "time", span: 3 * DAY }),
      entry({ kind: "event", title: "The feast", day: 99 }),
      entry({ kind: "time", span: 90 }),
    ];
    expect(clockOf(MOONS, [])).toEqual({ day: 0, minute: 0 });
    expect(clockOf(MOONS, es)).toEqual({ day: 3, minute: 90 });
    expect(clockOf(MOONS, [entry({ kind: "set", day: 500, minute: 600 }), ...es.map((e) => ({ ...e, created_at: e.created_at + 10 }))]))
      .toEqual({ day: 503, minute: 690 });
  });

  test("a taken-back entry counts for nothing, but is kept", () => {
    const es = [entry({ kind: "time", span: 2 * DAY }), entry({ kind: "time", span: 40 * DAY, undone_at: 5 })];
    expect(clockOf(UNDATED, es)).toEqual({ day: 2, minute: 0 });
    expect(live(es)).toHaveLength(1);
    expect(es).toHaveLength(2);
  });

  test("the clock as it stood just after a given entry", () => {
    const a = entry({ kind: "time", span: DAY });
    const b = entry({ kind: "time", span: DAY });
    expect(clockOf(UNDATED, [a, b], a.id)).toEqual({ day: 1, minute: 0 });
  });
});

describe("how everyone is", () => {
  test("the latest word on each field counts; taking it back shows the one before", () => {
    const a = entry({ kind: "status", subject: "Loras", field: "location", title: "the stables" });
    const b = entry({ kind: "status", subject: "Loras", field: "location", title: "the solar" });
    const c = entry({ kind: "status", subject: "Loras", field: "mental", title: "shaken" });
    expect(statusOf([a, b, c]).Loras).toMatchObject({ location: { title: "the solar" }, mental: { title: "shaken" } });
    expect(statusOf([a, { ...b, undone_at: 9 }, c]).Loras?.location?.title).toBe("the stables");
  });

  test("a status with no field the tracker keeps counts for nothing", () => {
    expect(statusOf([entry({ kind: "status", subject: "Loras", field: "ambition" as any, title: "the crown" })])).toEqual({});
  });
});

describe("whatever comes in is made safe", () => {
  test("unknown kinds, visibilities and sources fall back; text is cut to length", () => {
    const e = normaliseEntry({ kind: "explode", visibility: "everyone", source: "hacker", title: "t".repeat(999), span: "1e99" });
    expect(e.kind).toBe("event");
    expect(e.visibility).toBe("table");
    expect(e.source).toBe("user");
    expect(e.title.length).toBe(200);
    expect(e.span).toBe(1e12);
  });
});

describe("branching and carrying on", () => {
  test("a branch takes what happened up to the fork, re-tied to its own copies", () => {
    const es = [
      entry({ message_id: "m1", title: "before" }),
      entry({ message_id: "m3", title: "after" }),
      entry({ message_id: null, title: "untied, early", created_at: 10 }),
      entry({ message_id: null, title: "untied, late", created_at: 99999 }),
    ];
    const got = forBranch(es, new Map([["m1", "b1"], ["m2", "b2"]]), 5000);
    expect(got.map((e) => [e.title, e.message_id])).toEqual([["before", "b1"], ["untied, early", null]]);
  });

  test("carrying on takes everything, untied", () => {
    const got = forCarryOn([entry({ message_id: "m1" }), entry({ message_id: "m2", undone_at: 3 })]);
    expect(got.map((e) => e.message_id)).toEqual([null, null]);
    expect(got[1].undone_at).toBe(3);
  });
});

describe("who reads what", () => {
  const es = [entry({ title: "public" }), entry({ title: "Cersei wrote to the Faith", visibility: "hidden" })];

  test("alone, the author reads everything", () => {
    expect(view(es, { shared: false, host: true }).map((e: any) => e.title)).toEqual(["public", "Cersei wrote to the Faith"]);
  });

  test("at a table the host sees a sealed entry, not its contents, and a guest sees nothing", () => {
    const host = view(es, { shared: true, host: true });
    expect(host).toHaveLength(2);
    expect(host[1]).toMatchObject({ sealed: true });
    expect(JSON.stringify(host)).not.toContain("Faith");
    expect(view(es, { shared: true, host: false }).map((e: any) => e.title)).toEqual(["public"]);
  });
});

describe("in a chat", () => {
  function seed() {
    wipe();
    setSettings({ mode: "story" });
    const t = Date.now() - 100000;
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('loras', 'Loras', ?)").run(t);
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'loras', 'The Hand', ?, ?)").run(t, t);
    for (const [i, id] of ["m1", "m2", "m3"].entries()) {
      db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, 'ch', 'assistant', 'x', ?)").run(id, t + i * 1000);
    }
    return t;
  }
  const state = async (chat = "ch") => (await ask(`/api/chats/${chat}/chronicle`)).json();

  test("time passes in words, and words it cannot read move nothing", async () => {
    seed();
    let s = await (await send("/api/chats/ch/chronicle", "POST", { kind: "time", text: "three days" })).json();
    expect(s.now).toMatchObject({ day: 3, minute: 0, text: "Day 4" });
    const bad = await send("/api/chats/ch/chronicle", "POST", { kind: "time", text: "a while" });
    expect(bad.status).toBe(400);
    s = await state();
    expect(s.now.day).toBe(3);
  });

  test("an event is stamped with the moment it happened, and tied to the latest message", async () => {
    seed();
    await send("/api/chats/ch/chronicle", "POST", { kind: "time", text: "2 days" });
    const s = await (await send("/api/chats/ch/chronicle", "POST", { kind: "event", title: "The royal feast" })).json();
    const feast = s.entries.find((e: any) => e.title === "The royal feast");
    expect(feast).toMatchObject({ day: 2, message_id: "m3", source: "user" });
    expect((await send("/api/chats/ch/chronicle", "POST", { kind: "event" })).status).toBe(400);
  });

  test("undo takes an entry back without deleting it, and restore brings it back", async () => {
    seed();
    const s = await (await send("/api/chats/ch/chronicle", "POST", { kind: "time", text: "a fortnight" })).json();
    const id = s.entries[0].id;
    expect((await (await send(`/api/chronicle/${id}/undo`, "POST")).json()).now.day).toBe(0);
    expect(db.query("SELECT COUNT(*) AS n FROM chronicle").get()).toEqual({ n: 1 });
    expect((await (await send(`/api/chronicle/${id}/restore`, "POST")).json()).now.day).toBe(14);
  });

  test("a chat counts in its own calendar, kept as a copy", async () => {
    seed();
    let s = await (await send("/api/chats/ch/calendar", "PUT", { id: "moons" })).json();
    expect(s.calendar.name).toBe("The Reckoning of Moons");
    s = await (await send("/api/chats/ch/chronicle", "POST", { kind: "set", date: { year: 298, month: 7, day: 14 }, minute: 19 * 60 })).json();
    expect(s.now.text).toBe("14th Day of the Eighth Moon, 298 AC");
    expect(JSON.parse((db.query("SELECT calendar FROM chats WHERE id = 'ch'").get() as any).calendar).months).toHaveLength(12);
    expect((await send("/api/chats/ch/chronicle", "POST", { kind: "set", date: { year: 298, month: 7, day: 31 } })).status).toBe(400);
    expect((await send("/api/chats/ch/calendar", "PUT", { calendar: { months: [] } })).status).toBe(400);
    s = await (await send("/api/chats/ch/calendar", "PUT", { id: "undated" })).json();
    expect((db.query("SELECT calendar FROM chats WHERE id = 'ch'").get() as any).calendar).toBe("");
  });

  test("deleting a message unties its entries instead of losing them", async () => {
    const t = seed();
    db.query("INSERT INTO chronicle (id, chat_id, message_id, kind, title, created_at) VALUES ('e1', 'ch', 'm2', 'event', 'The duel', ?)").run(t);
    db.query("DELETE FROM messages WHERE id = 'm2'").run();
    expect(db.query("SELECT message_id, title FROM chronicle WHERE id = 'e1'").get()).toEqual({ message_id: null, title: "The duel" });
  });

  test("a secret is sealed for the host once the chat is shared, until revealed", async () => {
    const t = seed();
    db.query("INSERT INTO chronicle (id, chat_id, kind, title, visibility, created_at) VALUES ('s1', 'ch', 'event', 'Cersei wrote to the Faith', 'hidden', ?)").run(t);
    expect((await state()).entries[0].title).toBe("Cersei wrote to the Faith");
    db.query("INSERT INTO shares (id, chat_id, token, created_at) VALUES ('sh', 'ch', 'tok', ?)").run(t);
    let s = await state();
    expect(s.entries[0]).toMatchObject({ id: "s1", sealed: true });
    expect(JSON.stringify(s)).not.toContain("Faith");
    s = await (await send("/api/chronicle/s1/reveal", "POST")).json();
    expect(s.entries[0].title).toBe("Cersei wrote to the Faith");
  });

  test("a branch takes the story as far as the fork, in its own calendar, tied to its own messages", async () => {
    const t = seed();
    await send("/api/chats/ch/calendar", "PUT", { id: "moons" });
    const add = db.query("INSERT INTO chronicle (id, chat_id, message_id, kind, span, title, created_at) VALUES (?, 'ch', ?, ?, ?, ?, ?)");
    add.run("c1", "m1", "time", 5 * DAY, "", t + 10);
    add.run("c2", "m2", "event", 0, "The duel", t + 1010);
    add.run("c3", "m3", "time", 30 * DAY, "", t + 2010);

    const branch = await (await ask("/api/messages/m2/branch", { method: "POST" })).json();
    const s = await state(branch.id);
    expect(s.calendar.name).toBe("The Reckoning of Moons");
    expect(s.entries.map((e: any) => e.kind)).toEqual(["time", "event"]);
    expect(s.now.day).toBe(5);
    const own = new Set((db.query("SELECT id FROM messages WHERE chat_id = ?").all(branch.id) as any[]).map((r) => r.id));
    for (const e of s.entries) expect(own.has(e.message_id)).toBe(true);
    // The parent is untouched.
    expect((await state()).now.day).toBe(35);
  });

  test("a new branch writes its notes into a BRANCH copy; the parent's book is left alone", async () => {
    const t = seed();
    db.query("INSERT INTO lorebooks (id, name, entries, created_at) VALUES ('notes', 'Notes: The Hand', ?, ?)")
      .run(JSON.stringify([{ id: "n1", keys: ["Loras"], content: "He arrived." }]), t);
    db.query("INSERT INTO lorebook_links (id, book_id, scope, target_id) VALUES ('l1', 'notes', 'chat', 'ch')").run();
    db.query("UPDATE chats SET auto_lore_book_id = 'notes', auto_lore_asked = 1 WHERE id = 'ch'").run();

    const branch = await (await ask("/api/messages/m2/branch", { method: "POST" })).json();
    const mine = db.query("SELECT auto_lore_book_id AS b FROM chats WHERE id = ?").get(branch.id) as any;
    expect(mine.b).not.toBe("notes");
    const copy = db.query("SELECT name, entries FROM lorebooks WHERE id = ?").get(mine.b) as any;
    expect(copy.name).toBe("Notes: The Hand — BRANCH");
    expect(JSON.parse(copy.entries)[0].content).toBe("He arrived.");
    const links = (id: string) => (db.query("SELECT book_id FROM lorebook_links WHERE scope = 'chat' AND target_id = ?").all(id) as any[]).map((r) => r.book_id);
    expect(links(branch.id)).toEqual([mine.b]);
    expect(links("ch")).toEqual(["notes"]);
    expect((db.query("SELECT auto_lore_book_id AS b FROM chats WHERE id = 'ch'").get() as any).b).toBe("notes");

    // A branch of the branch is still "— BRANCH", told apart by freeBookName.
    const msg = (db.query("SELECT id FROM messages WHERE chat_id = ? ORDER BY created_at LIMIT 1").get(branch.id) as any).id;
    const again = await (await ask(`/api/messages/${msg}/branch`, { method: "POST" })).json();
    const name = (db.query("SELECT l.name FROM lorebooks l JOIN chats c ON c.auto_lore_book_id = l.id WHERE c.id = ?").get(again.id) as any).name;
    expect(name.startsWith("Notes: The Hand — BRANCH")).toBe(true);
    expect(name).not.toContain("BRANCH — BRANCH");
  });

  test("a branch that already shared its parent's book is split only when asked", async () => {
    const t = seed();
    db.query("INSERT INTO lorebooks (id, name, entries, created_at) VALUES ('notes', 'Notes', '[]', ?)").run(t);
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at, parent_chat_id, auto_lore_book_id) VALUES ('old', 'loras', 'Old branch', ?, ?, 'ch', 'notes')").run(t, t);
    db.query("UPDATE chats SET auto_lore_book_id = 'notes' WHERE id = 'ch'").run();
    const r = await (await send("/api/chats/old/own-notes", "POST")).json();
    expect(r.book).toBeTruthy();
    expect((db.query("SELECT auto_lore_book_id AS b FROM chats WHERE id = 'old'").get() as any).b).toBe(r.book);
    expect((db.query("SELECT auto_lore_book_id AS b FROM chats WHERE id = 'ch'").get() as any).b).toBe("notes");
  });
});
