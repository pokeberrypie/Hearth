/**
 * Story World at a shared table: guests see what the table may see, never the
 * host's secrets, never anything waiting on the host — and can change none of it.
 *
 *   bun test src/tableworld.test.ts
 */

import { beforeEach, describe, expect, test } from "bun:test";

import { db, setSettings, wipe } from "./test-support";

const { app } = await import("./index");

const AWAY = { incoming: { socket: { remoteAddress: "203.0.113.9" } } };
const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}, env: any = AWAY) =>
  app.fetch(new Request(`http://table.example${path}`, init), env);
const host = (path: string, method = "GET", body?: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, HOME);

let seat = "";
beforeEach(async () => {
  wipe();
  setSettings({ mode: "story", steward_on: "0" });
  const t = Date.now();
  db.query("INSERT INTO characters (id, name, created_at) VALUES ('gk', 'The Gamekeeper', ?)").run(t);
  db.query("INSERT INTO personas (id, name, created_at) VALUES ('yv', 'Yvenna Hightower', ?)").run(t);
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at, persona_id) VALUES ('ch', 'gk', 'The Hand', ?, ?, 'yv')").run(t, t);
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES ('m1', 'ch', 'assistant', 'The Gamekeeper', 'It begins.', ?)").run(t);

  await host("/api/chats/ch/calendar", "PUT", { id: "moons" });
  await host("/api/chats/ch/chronicle", "POST", { kind: "set", date: { year: 298, month: 7, day: 14 } });
  await host("/api/chats/ch/chronicle", "POST", { kind: "event", title: "The royal feast" });
  await host("/api/chats/ch/chronicle", "POST", { kind: "event", title: "Cersei writes to the Faith", visibility: "hidden" });
  await host("/api/chats/ch/chronicle", "POST", { kind: "time", text: "3 days", visibility: "hidden" });
  await host("/api/chats/ch/chronicle", "POST", { kind: "status", subject: "Cersei Lannister", field: "mental", value: "plotting", visibility: "hidden" });
  await host("/api/chats/ch/chronicle", "POST", { kind: "status", subject: "Jaime Lannister", field: "location", value: "the Great Hall" });
  await host("/api/chats/ch/chronicle", "POST", { kind: "bond", from: "Jaime Lannister", to: "Yvenna Hightower", score: 80, label: "betrothed" });
  await host("/api/chats/ch/chronicle", "POST", { kind: "bond", from: "Cersei Lannister", to: "Yvenna Hightower", score: 0, label: "SECRET-ENMITY", visibility: "hidden" });
  await host("/api/chats/ch/chronicle", "POST", { kind: "bond", from: "Loras Tyrell", to: "Jaime Lannister", score: 40 });
  await host("/api/chats/ch/chronicle", "POST", { kind: "faction", name: "House Hightower", members: ["Yvenna Hightower"] });
  db.query("INSERT INTO chronicle (id, chat_id, kind, subject, title, proposed, created_at) VALUES ('p1', 'ch', 'faction', 'k-p', 'PENDING-GUILD', 1, ?)").run(Date.now());

  const share = await (await host("/api/shares", "POST", { chat_id: "ch", name: "The Hand" })).json();
  const res = await ask(share.join, {}, AWAY);
  seat = `hearth_player=${/hearth_player=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? ""}`;
});

const guest = (path: string, init: RequestInit = {}) => ask(path, { ...init, headers: { ...(init.headers ?? {}), cookie: seat } });

describe("what a guest sees", () => {
  test("the story as the table may see it", async () => {
    const res = await guest("/api/table/world");
    expect(res.status).toBe(200);
    const w = await res.json();
    expect(w.now.text).toBe("14th Day of the Eighth Moon, 298 AC");
    expect(w.events.map((e: any) => e.title)).toEqual(["The royal feast"]);
    expect(w.status).toEqual({ "Jaime Lannister": { location: "the Great Hall" } });
    expect(w.factions.map((f: any) => f.name)).toEqual(["House Hightower"]);
  });

  test("no secret, and nothing worked out from one: not the event, not the days it moved, not the bond, not the mood", async () => {
    const text = await (await guest("/api/table/world")).text();
    for (const secret of ["Faith", "plotting", "SECRET-ENMITY", "Cersei", "17th Day", "PENDING-GUILD"]) expect(text).not.toContain(secret);
    const state = await (await guest("/api/table/state")).text();
    for (const secret of ["Faith", "17th Day", "PENDING-GUILD"]) expect(state).not.toContain(secret);
  });

  test("bonds seen from the guest's own character, theirs first", async () => {
    db.query("UPDATE players SET name = 'Loras Tyrell' WHERE name != ''").run();
    const w = await (await guest("/api/table/world")).json();
    expect(w.seenFrom).toBe("Loras Tyrell");
    expect(w.bonds.map((b: any) => `${b.from}>${b.to}`)).toEqual(["Loras Tyrell>Jaime Lannister", "Jaime Lannister>Yvenna Hightower"]);
  });

  test("Story World in a line, with the table's own state", async () => {
    const s = await (await guest("/api/table/state")).json();
    expect(s.world).toEqual({ today: "14th Day of the Eighth Moon, 298 AC", latest: "The royal feast" });
  });

  test("a revealed secret reaches the table", async () => {
    const all = await (await host("/api/chats/ch/chronicle")).json();
    const sealed = all.entries.find((e: any) => e.sealed && e.kind === "event");
    // The host sees that it is there, not what it says.
    expect(JSON.stringify(all.entries)).not.toContain("Faith");
    await host(`/api/chronicle/${sealed.id}/reveal`, "POST");
    expect((await (await guest("/api/table/world")).json()).events.map((e: any) => e.title))
      .toEqual(["The royal feast", "Cersei writes to the Faith"]);
  });
});

describe("what a guest cannot do", () => {
  test("anything at all to the chronicle", async () => {
    const id = (db.query("SELECT id FROM chronicle WHERE title = 'The royal feast'").get() as any).id;
    for (const [path, method] of [
      ["/api/chats/ch/chronicle", "GET"], ["/api/chats/ch/chronicle", "POST"], [`/api/chronicle/${id}/undo`, "POST"],
      [`/api/chronicle/${id}/reveal`, "POST"], [`/api/chronicle/${id}/hide`, "POST"], ["/api/chats/ch/calendar", "PUT"],
      ["/api/chats/ch/steward/history", "POST"], ["/api/chats/ch/steward", "GET"],
    ] as const) {
      const res = await guest(path, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
      expect(res.status).toBe(403);
    }
  });
});

describe("the host", () => {
  test("can check what the players see before revealing anything", async () => {
    const w = await (await host("/api/chats/ch/chronicle?as=players")).json();
    expect(w.events.map((e: any) => e.title)).toEqual(["The royal feast"]);
    expect(w.seenFrom).toBe("Yvenna Hightower");
    expect(JSON.stringify(w)).not.toContain("Faith");
  });

  test("can hide something the table should not see yet", async () => {
    const id = (db.query("SELECT id FROM chronicle WHERE title = 'The royal feast'").get() as any).id;
    await host(`/api/chronicle/${id}/hide`, "POST");
    expect((await (await guest("/api/table/world")).json()).events).toEqual([]);
  });
});

test("the table hears the world move on, live, as a summary and nothing more", async () => {
  const res = await guest("/api/table/live");
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  await host("/api/chats/ch/chronicle", "POST", { kind: "event", title: "The bridge falls" });
  await host("/api/chats/ch/chronicle", "POST", { kind: "event", title: "SECRET-AMBUSH", visibility: "hidden" });
  let seen = "";
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && (seen.match(/"event":"world"/g) ?? []).length < 2) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), 500)),
    ]);
    if (value) seen += dec.decode(value);
    if (done && !value) break;
  }
  reader.cancel().catch(() => {});
  expect(seen.match(/"event":"world"/g)).toHaveLength(2);
  expect(seen).toContain("The bridge falls");
  expect(seen).not.toContain("SECRET-AMBUSH");
});
