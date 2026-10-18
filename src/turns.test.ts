/**
 * Taking it in turns.
 *
 * A rotation is a rule about who may speak, and a rule that only exists in the
 * browser is not a rule — it is a suggestion sitting on the machine belonging
 * to the person it is meant to constrain. So the interesting tests here are
 * not "does the composer grey out"; they are "what happens when somebody who
 * is not supposed to be speaking sends the request anyway".
 *
 * The other half is stalling. Every table that has ever tried an enforced
 * order has discovered the same failure: one person goes to make tea and the
 * evening stops. Two of these tests are about that, because a rotation that
 * can stall is a feature people switch on once.
 *
 *   bun test src/turns.test.ts
 */

import { describe, expect, test } from "bun:test";

import { db, wipe } from "./test-support";

const { app } = await import("./index");

const AWAY = { incoming: { socket: { remoteAddress: "203.0.113.9" } } };
const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };

const ask = (path: string, init: RequestInit = {}, env: any = AWAY) =>
  app.fetch(new Request(`http://table.example${path}`, init), env);

function seed() {
  wipe();
  const t = Date.now();
  db.query("INSERT INTO characters (id, name, created_at) VALUES (?,?,?)").run("c1", "The Gamekeeper", t);
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run("chat1", "c1", "Greywater", t, t);
}

async function openTable() {
  const res = await ask("/api/shares", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: "chat1", name: "Greywater" }),
  }, HOME);
  return (await res.json()) as { id: string; join: string };
}

/** Sit somebody down and give them a name, so refusals can say who is who. */
async function seat(joinPath: string, name: string) {
  const res = await ask(joinPath, {}, AWAY);
  const token = /hearth_player=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
  const cookie = `hearth_player=${token}`;
  await ask("/api/table/me", {
    method: "PUT", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name }),
  }, AWAY);
  const me = (await (await ask("/api/table/me", { headers: { cookie } }, AWAY)).json()) as any;
  return { cookie, id: me.id as string, name: me.name as string };
}

const say = (cookie: string, content: string) =>
  ask("/api/table/say", {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ content }),
  }, AWAY);

const turns = (id: string, patch: unknown) =>
  ask(`/api/shares/${id}/turns`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  }, HOME);

const stateFor = async (cookie: string) =>
  (await (await ask("/api/table/state", { headers: { cookie } }, AWAY)).json()) as any;

/** Switched on, with the turn handed to somebody in particular. The host sits first. */
const onAt = async (id: string, player: string) => { await turns(id, { on: true }); await turns(id, { player }); };

/** The whole opening move: a table, two players, the rotation switched on. */
async function tableOfTwo() {
  seed();
  const share = await openTable();
  const ana = await seat(share.join, "Ana");
  const bo = await seat(share.join, "Bo");
  return { share, ana, bo };
}

describe("switching it on", () => {
  test("a table is not taking turns until somebody asks it to", async () => {
    const { ana, bo } = await tableOfTwo();
    const s = await stateFor(ana.cookie);
    expect(s.turn).toEqual({ on: false, player: null });
    // And with it off, order is nobody's business: Bo may speak first.
    expect((await say(bo.cookie, "I go first.")).status).toBe(200);
  });

  test("switching it on starts the round at the first seat, which is the host's", async () => {
    const { share } = await tableOfTwo();
    const r = (await (await turns(share.id, { on: true })).json()) as any;
    expect(r.turn).toEqual({ on: true, player: "host" });
  });

  test("switching it on again starts a fresh round rather than resuming the old one", async () => {
    const { share, ana, bo } = await tableOfTwo();
    await onAt(share.id, ana.id);
    await say(ana.cookie, "Mine.");
    expect((await stateFor(bo.cookie)).turn.player).toBe(bo.id);
    await turns(share.id, { on: false });
    const r = (await (await turns(share.id, { on: true })).json()) as any;
    expect(r.turn.player).toBe("host");
  });
});

describe("whose go it is", () => {
  test("the wrong person is refused, and told who they are waiting for", async () => {
    const { share, ana, bo } = await tableOfTwo();
    await onAt(share.id, ana.id);
    const res = await say(bo.cookie, "Butting in.");
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toBe("It is Ana's turn.");
  });

  /*
   * The one that matters. A disabled composer is a picture of a rule; this is
   * the rule. Anybody can open a console, and at a table of friends somebody
   * eventually will.
   */
  test("a refused turn is not written down", async () => {
    const { share, ana, bo } = await tableOfTwo();
    await onAt(share.id, ana.id);
    await say(bo.cookie, "Butting in.");
    const n = db.query("SELECT COUNT(*) n FROM messages WHERE chat_id = 'chat1'").get() as any;
    expect(n.n).toBe(0);
  });

  test("speaking hands the turn to the next seat", async () => {
    const { share, ana, bo } = await tableOfTwo();
    await onAt(share.id, ana.id);
    expect((await say(ana.cookie, "The door is open.")).status).toBe(200);
    expect((await stateFor(ana.cookie)).turn.player).toBe(bo.id);
    // And now the refusal points the other way.
    const res = await say(ana.cookie, "Also—");
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toBe("It is Bo's turn.");
  });

  test("the last seat hands back to the first, the host", async () => {
    const { share, ana, bo } = await tableOfTwo();
    await onAt(share.id, ana.id);
    await say(ana.cookie, "One.");
    await say(bo.cookie, "Two.");
    expect((await stateFor(ana.cookie)).turn.player).toBe("host");
  });

  /*
   * The turn moves when the words are written down, not when the narrator has
   * finished answering. Otherwise the whole table waits out a generation with
   * nothing to do — and if the host's copy is closed, waits forever.
   */
  test("the turn moves on the message, not on the reply", async () => {
    const { share, ana, bo } = await tableOfTwo();
    await onAt(share.id, ana.id);
    await say(ana.cookie, "One.");
    // Nothing has answered — no assistant message exists — and it is already Bo's.
    const msgs = db.query("SELECT role FROM messages WHERE chat_id = 'chat1'").all() as any[];
    expect(msgs.every((m) => m.role === "user")).toBe(true);
    expect((await stateFor(bo.cookie)).turn.player).toBe(bo.id);
  });
});

describe("a table that cannot stall", () => {
  test("anyone may pass, not only whoever is holding the turn", async () => {
    const { share, ana, bo } = await tableOfTwo();
    await onAt(share.id, ana.id);
    // Ana has gone to make tea. Bo moves it along for her.
    const r = (await (await ask("/api/table/pass", { method: "POST", headers: { cookie: bo.cookie } }, AWAY)).json()) as any;
    expect(r.turn.player).toBe(bo.id);
    expect((await say(bo.cookie, "Carrying on then.")).status).toBe(200);
    expect(ana.id).not.toBe(bo.id);
  });

  test("passing does nothing at a table that is not taking turns", async () => {
    const { ana } = await tableOfTwo();
    const res = await ask("/api/table/pass", { method: "POST", headers: { cookie: ana.cookie } }, AWAY);
    expect(res.status).toBe(400);
  });

  /*
   * The stall nobody thinks of: the turn-holder closes the tab. Their row is
   * gone, the stored id names nobody, and every other player is refused
   * forever by a person who is not there.
   */
  test("the turn does not sit with somebody who has left", async () => {
    const { share, ana, bo } = await tableOfTwo();
    await onAt(share.id, ana.id);
    expect((await stateFor(bo.cookie)).turn.player).toBe(ana.id);
    await ask("/api/table/leave", { method: "POST", headers: { cookie: ana.cookie } }, AWAY);
    // To the first seat still filled — the host's, who is always there.
    const s = await stateFor(bo.cookie);
    expect(s.turn.player).toBe("host");
    await turns(share.id, { player: bo.id });
    expect((await say(bo.cookie, "Just me now.")).status).toBe(200);
  });

  test("a table every guest has left gives the turn back to the host rather than crashing", async () => {
    const { share, ana, bo } = await tableOfTwo();
    await turns(share.id, { on: true });
    await ask("/api/table/leave", { method: "POST", headers: { cookie: ana.cookie } }, AWAY);
    await ask("/api/table/leave", { method: "POST", headers: { cookie: bo.cookie } }, AWAY);
    const r = (await (await turns(share.id, { on: true })).json()) as any;
    expect(r.turn).toEqual({ on: true, player: "host" });
  });
});

describe("the host", () => {
  /*
   * The host plays too. Left out, a table of one guest had a rotation of one,
   * which never moved and never made anybody wait.
   */
  test("sits first in the rotation, under their persona's name", async () => {
    const { share, ana } = await tableOfTwo();
    await turns(share.id, { on: true });
    const s = await stateFor(ana.cookie);
    expect(s.players[0]).toMatchObject({ id: "host", host: true });
    // And the host's own way of speaking still never goes past the guest gate.
    expect((await ask("/api/chats/chat1/messages", { headers: { cookie: ana.cookie } }, AWAY)).status).toBe(403);
  });

  test("waits their turn: their own words are refused while it is somebody else's", async () => {
    const { share, ana } = await tableOfTwo();
    await onAt(share.id, ana.id);
    const res = await ask("/api/chats/chat1/generate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Me first." }),
    }, HOME);
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toContain("Ana's turn");
    const n = db.query("SELECT COUNT(*) n FROM messages WHERE chat_id = 'chat1' AND role = 'user'").get() as any;
    expect(n.n).toBe(0);
  });

  test("but the narrator answering is never refused — that is not a turn", async () => {
    const { share, ana } = await tableOfTwo();
    await onAt(share.id, ana.id);
    const res = await ask("/api/chats/chat1/generate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
    }, HOME);
    expect(res.status).not.toBe(409);
  });

  test("their words pass the turn on, like anyone's", async () => {
    const { share, ana } = await tableOfTwo();
    await turns(share.id, { on: true });
    const res = await ask("/api/chats/chat1/generate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Bingle." }),
    }, HOME);
    await res.text().catch(() => "");
    expect((await stateFor(ana.cookie)).turn.player).toBe(ana.id);
  });

  test("can hand the turn to somebody in particular", async () => {
    const { share, bo } = await tableOfTwo();
    await turns(share.id, { on: true });
    const r = (await (await turns(share.id, { player: bo.id })).json()) as any;
    expect(r.turn.player).toBe(bo.id);
    expect((await say(bo.cookie, "Ready.")).status).toBe(200);
  });

  test("cannot hand the turn to a seat that is not there", async () => {
    const { share } = await tableOfTwo();
    await turns(share.id, { on: true });
    expect((await turns(share.id, { player: "nobody" })).status).toBe(400);
  });

  test("a guest cannot switch the rotation on or off", async () => {
    const { share, ana, bo } = await tableOfTwo();
    await onAt(share.id, ana.id);
    const res = await ask(`/api/shares/${share.id}/turns`, {
      method: "PUT", headers: { "content-type": "application/json", cookie: bo.cookie },
      body: JSON.stringify({ on: false }),
    }, AWAY);
    expect(res.status).toBe(403);
    // Still on, still Ana's.
    expect((await stateFor(bo.cookie)).turn.on).toBe(true);
  });
});

const APP = await Bun.file(new URL("../public/app.js", import.meta.url)).text();
const CSS = await Bun.file(new URL("../public/style.css", import.meta.url)).text();

/*
 * The migration that was not applied.
 *
 * These columns are added by ALTER_TABLES, and that loop used to run before
 * the CREATE that makes `shares`. Every earlier migration touched a table from
 * the first batch, so the ordering had never mattered and nothing said it had
 * to hold. On an upgrade the table already existed and everything worked; on a
 * fresh install the ALTER threw, the throw was swallowed — which is how
 * "already applied" is detected — and the columns were quietly missing for
 * everybody arriving for the first time.
 *
 * This test runs against a database built from nothing on every run, which is
 * the only place that bug was ever visible.
 */
describe("a database made from scratch", () => {
  test("has the columns the migrations add to tables created late", () => {
    const cols = (db.query("PRAGMA table_info(shares)").all() as any[]).map((c) => c.name);
    expect(cols).toContain("taking_turns");
    expect(cols).toContain("turn_player_id");
  });
});

/*
 * A guest whose seat has gone.
 *
 * The seat is a cookie, and cookies go: a private tab closed on iOS, history
 * cleared, ninety days, a new phone. Until this, that person got the host's
 * own app — every route behind it refused, the library empty — which reads as
 * a broken program rather than as "ask for the link again".
 */
describe("coming back without a seat", () => {
  test("a refusal at the guest door says it was the guest door", async () => {
    seed();
    await openTable();
    const res = await ask("/api/table/state", { headers: { "x-forwarded-for": "203.0.113.9" } }, AWAY);
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).door).toBe(true);
  });

  /*
   * And the host's own refusal does not, or the owner's copy would greet them
   * with "your seat is not here any more" on their own machine.
   */
  test("the host's own refusal is not mistaken for one", async () => {
    seed();
    await openTable();
    const res = await ask("/api/table/state", {}, HOME);
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).door).toBeUndefined();
  });

  test("a seat that is still good is not told anything of the sort", async () => {
    const { ana } = await tableOfTwo();
    const res = await ask("/api/table/state", { headers: { cookie: ana.cookie } }, AWAY);
    expect(res.status).toBe(200);
  });
});

describe("the browser's half", () => {
  test("the composer closes when it is not your go", () => {
    const fn = APP.slice(APP.indexOf("function guestTurn("), APP.indexOf("const GUEST_PLACEHOLDER"));
    expect(fn).toContain("input.disabled = !mine");
    expect(fn).toContain("Waiting on ");
  });

  test("the turn is heard from the feed rather than polled for", () => {
    expect(APP).toContain(`if (evt.event === "turn")`);
  });

  /*
   * The strip has its own class. The host's room strip lives in the same
   * element and the user asked, in as many words, that it be left alone — so a
   * rule that reached `.castbar` itself would be a bug in this file, not a
   * style choice.
   */
  test("the guest strip does not restyle the host's room strip", () => {
    const from = CSS.indexOf("---- the seats, at somebody else's table");
    const block = CSS.slice(from, CSS.indexOf("/* ----", from + 40));
    expect(block).toContain(".seat.turn");
    /*
     * One rule here does reach `.castbar`, and has to: the bar stops being the
     * scroller so that the pass button can stay put at a long table. It is
     * written `.castbar.seats`, which cannot match the host's strip, because
     * only a guest's carries `.seats`. So the check is not "never says
     * castbar" — it is "never says castbar on its own".
     */
    const loose = block
      .split("{")
      .map((chunk) => chunk.slice(chunk.lastIndexOf("}") + 1).trim())
      .filter((sel) => sel.includes(".castbar") && !sel.includes(".seats"));
    expect(loose).toEqual([]);
  });

  test("the glow can be turned off by somebody who cannot stand it", () => {
    expect(CSS).toContain("prefers-reduced-motion");
    const block = CSS.slice(CSS.indexOf("@keyframes seatglow"));
    expect(block.slice(0, 600)).toContain(".seat.turn.you { animation: none; }");
  });

  /*
   * A guest is somebody who tapped a link in a message. On iOS that is often a
   * private tab, and in a private tab on iOS touching localStorage throws
   * rather than returning nothing. Every write in app.js was already wrapped;
   * the reads were not, and one of them sits in the guest's boot path — so the
   * platform most likely to be reading a link somebody sent them was the one
   * platform where opening it could stop halfway.
   */
  test("storage that refuses to be read does not stop a guest sitting down", () => {
    expect(APP).toContain("function recall(key, fallback = \"\")");
    const boot = APP.slice(APP.indexOf("async function guestBoot("), APP.indexOf("function guestTitle("));
    expect(boot.includes("localStorage.getItem")).toBe(false);
    expect(boot).toContain('recall("hearth.myName")');
  });

  test("giving your name redraws the strip rather than waiting to be told", () => {
    const fn = APP.slice(APP.indexOf("async function guestName("), APP.indexOf("async function guestAskName("));
    expect(fn).toContain("guestTitle()");
  });

  test("the page says so rather than drawing an empty library", () => {
    expect(APP).toContain("if (door) { guestNoSeat(); openTheHearth(); return; }");
    const fn = APP.slice(APP.indexOf("function guestNoSeat("));
    // Below the owner's code box (desk mode), but still said in so many words.
    expect(fn.slice(0, 3200)).toContain("Here for a seat at someone's table?");
    expect(fn.slice(0, 3200)).toContain("Ask whoever invited you for the link again");
  });

  /*
   * Found on a phone at a table of nine, which is the only place it exists.
   * The strip ran off the right edge and took with it the two things that
   * cannot go: the pill saying whose go it is, and the button that moves the
   * turn along. Both fixes live in `guestSeats`.
   */
  test("a long table does not push the pass button off the edge", () => {
    const fn = APP.slice(APP.indexOf("function guestSeats("), APP.indexOf("function guestTurn("));
    // The names go in the scroller; the button goes in the bar beside it.
    expect(fn).toContain("row.append(pill)");
    expect(fn).toContain("sub.append(pass)");
    expect(fn.includes("row.append(pass)")).toBe(false);
  });

  test("the pill whose turn it is is scrolled back into view", () => {
    const fn = APP.slice(APP.indexOf("function guestSeats("), APP.indexOf("function guestTurn("));
    expect(fn).toContain("here.scrollIntoView");
  });

  test("words are handed back rather than lost when the table refuses them", () => {
    const fn = APP.slice(APP.indexOf("async function guestSay("), APP.indexOf("async function guestRoll("));
    expect(fn).toContain("input.value = text");
  });
});

describe("a seat that has gone", () => {
  test("stops holding the turn, so the people still here can play", async () => {
    const { share, ana, bo } = await tableOfTwo();
    await onAt(share.id, ana.id);
    expect((await stateFor(bo.cookie)).turn.player).toBe(ana.id);
    // Ana's page has not been heard from for two minutes: closed, or she came
    // back through a new tunnel address as somebody new.
    db.query("UPDATE players SET seen_at = ? WHERE id = ?").run(Date.now() - 120_000, ana.id);
    // The turn leaves the empty seat rather than waiting on it.
    expect((await stateFor(bo.cookie)).turn.player).not.toBe(ana.id);
    expect((await (await turns(share.id, { player: ana.id })).json()).error).toBeDefined();
  });

  test("comes back into the rotation when they do", async () => {
    const { share, ana, bo } = await tableOfTwo();
    await turns(share.id, { on: true });
    db.query("UPDATE players SET seen_at = ? WHERE id = ?").run(Date.now() - 120_000, ana.id);
    await stateFor(bo.cookie);
    await stateFor(ana.cookie);   // Ana's page is back
    const seats = (await stateFor(bo.cookie)).players.map((p: any) => p.name);
    expect(seats).toContain("Ana");
  });
});

describe("whose turns are whose, from a guest's seat", () => {
  test("the table says who the host is, so their turns are not drawn as the guest's", async () => {
    seed();
    const t = Date.now();
    db.query("INSERT INTO personas (id, name, description, is_active, created_at) VALUES (?,?,?,?,?)")
      .run("p1", "Bingus", "", 1, t);
    db.query("UPDATE chats SET persona_id = 'p1' WHERE id = 'chat1'").run();
    const share = await openTable();
    const bo = await seat(share.join, "Bo");
    const s = await stateFor(bo.cookie);
    expect(s.host.name).toBe("Bingus");
    expect(s.you.name).toBe("Bo");
  });

  test("and the page uses it for an unsigned turn", async () => {
    const app = await Bun.file(new URL("../public/app.js", import.meta.url)).text();
    const body = app.slice(app.indexOf("function speakerOf"), app.indexOf("function stripLabel"));
    expect(body).toContain("GUEST.state?.host");
  });
});

const { applyVerbs } = await import("./index");

describe("a fight at a shared table", () => {
  const sheetOf = (id: string) =>
    JSON.parse((db.query("SELECT sheet FROM sheets WHERE owner_id = ?").get(id) as any).sheet);
  const giveSheet = (id: string, kind: string, maxHp: number, hp = maxHp) =>
    db.query("INSERT OR REPLACE INTO sheets (owner_id, owner_kind, sheet, updated_at) VALUES (?,?,?,?)")
      .run(id, kind, JSON.stringify({ klass: "fighter", abilities: { dex: 14 }, maxHp, hp }), Date.now());

  async function party() {
    seed();
    db.query("INSERT INTO personas (id, name, description, is_active, created_at) VALUES ('host', 'Bingus', '', 1, ?)")
      .run(Date.now());
    const share = await openTable();
    const dan = await seat(share.join, "Dan");
    giveSheet("host", "persona", 9, 4);
    giveSheet(dan.id, "player", 12);
    return { dan };
  }

  test("everybody at the table is in the initiative, not only the host", async () => {
    const { dan } = await party();
    applyVerbs("chat1", "[[fight: two wolves]]", "host");
    const fight = JSON.parse((db.query("SELECT fight FROM chats WHERE id = 'chat1'").get() as any).fight);
    const names = fight.order.map((c: any) => c.name);
    expect(names).toContain("Bingus");
    expect(names).toContain("Dan");
    expect(fight.order.find((c: any) => c.name === "Dan")).toMatchObject({ player: true, hp: 12, maxHp: 12 });
    expect(dan.name).toBe("Dan");
  });

  test("damage to a guest goes on the guest's own sheet", async () => {
    const { dan } = await party();
    applyVerbs("chat1", "[[fight: a wolf]]", "host");
    applyVerbs("chat1", "[[hit: Dan, 5]]", "host");
    expect(sheetOf(dan.id).hp).toBe(7);
    expect(sheetOf("host").hp).toBe(4);
  });

  test("when the fight ends, everyone who fought is back to full", async () => {
    const { dan } = await party();
    applyVerbs("chat1", "[[fight: a wolf]]", "host");
    applyVerbs("chat1", "[[hit: Dan, 5]]", "host");
    applyVerbs("chat1", "[[fight: over]]", "host");
    expect(sheetOf(dan.id).hp).toBe(12);
    expect(sheetOf("host").hp).toBe(9);
  });

  test("and the same when the last foe falls without anyone saying so", async () => {
    const { dan } = await party();
    applyVerbs("chat1", "[[fight: a wolf 3hp]]", "host");
    applyVerbs("chat1", "[[hit: Dan, 2]]", "host");
    applyVerbs("chat1", "[[hit: Wolf, 10]]", "host");
    expect(sheetOf(dan.id).hp).toBe(12);
  });
});

describe("branches", () => {
  const branchOf = async (msgId: string) =>
    (await (await ask(`/api/messages/${msgId}/branch`, { method: "POST" }, HOME)).json()) as any;

  test("a branch keeps who is in the scene, who you are playing, and where everyone is", async () => {
    seed();
    const t = Date.now();
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('c2', 'Wolfgang', ?)").run(t);
    db.query("INSERT INTO personas (id, name, description, is_active, created_at) VALUES ('p1', 'Bingus', '', 0, ?)").run(t);
    db.query("UPDATE chats SET persona_id = 'p1', is_group = 1, location = 'The ridge', wallpaper = 'w.png' WHERE id = 'chat1'").run();
    db.query("INSERT INTO chat_members (id, chat_id, character_id, position) VALUES ('m1', 'chat1', 'c1', 0), ('m2', 'chat1', 'c2', 1)").run();
    db.query("INSERT INTO npcs (id, chat_id, name, brief, created_at) VALUES ('n1', 'chat1', 'Marla', 'innkeeper', ?)").run(t);
    db.query("UPDATE chats SET fight = '{\"order\":[]}' WHERE id = 'chat1'").run();
    db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES ('x1', 'chat1', 'user', 'Hi', ?)").run(t);
    const b = await branchOf("x1");
    const id = b.id ?? b.chat?.id;
    const row = db.query("SELECT * FROM chats WHERE id = ?").get(id) as any;
    expect(row).toMatchObject({ persona_id: "p1", is_group: 1, location: "The ridge", wallpaper: "w.png", fight: "" });
    const cast = (db.query("SELECT character_id FROM chat_members WHERE chat_id = ? ORDER BY position").all(id) as any[])
      .map((r) => r.character_id);
    expect(cast).toEqual(["c1", "c2"]);
    expect((db.query("SELECT name FROM npcs WHERE chat_id = ?").all(id) as any[]).map((r) => r.name)).toEqual(["Marla"]);
  });

  test("a table follows the host to another branch of its story, and its guests see the new one", async () => {
    seed();
    db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES ('x1', 'chat1', 'user', 'Hi', ?)").run(Date.now());
    const share = await openTable();
    const ana = await seat(share.join, "Ana");
    const b = await branchOf("x1");
    const id = b.id ?? b.chat?.id;
    const r = await ask(`/api/shares/${share.id}/chat`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: id }),
    }, HOME);
    expect(r.status).toBe(200);
    expect((await stateFor(ana.cookie)).chat.id).toBe(id);
    // And a guest's words now land in the branch the host is in.
    await say(ana.cookie, "Over here.");
    expect((db.query("SELECT COUNT(*) n FROM messages WHERE chat_id = ? AND content = 'Over here.'").get(id) as any).n).toBe(1);
  });

  test("but never to a different story", async () => {
    seed();
    const t = Date.now();
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('other', 'c1', 'Other', ?, ?)").run(t, t);
    const share = await openTable();
    const r = await ask(`/api/shares/${share.id}/chat`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: "other" }),
    }, HOME);
    expect(r.status).toBe(400);
  });

  test("and a guest cannot move it", async () => {
    seed();
    db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES ('x1', 'chat1', 'user', 'Hi', ?)").run(Date.now());
    const share = await openTable();
    const ana = await seat(share.join, "Ana");
    const b = await branchOf("x1");
    const r = await ask(`/api/shares/${share.id}/chat`, {
      method: "PUT", headers: { "content-type": "application/json", cookie: ana.cookie },
      body: JSON.stringify({ chat_id: b.id ?? b.chat?.id }),
    }, AWAY);
    expect(r.status).toBe(403);
  });
});
