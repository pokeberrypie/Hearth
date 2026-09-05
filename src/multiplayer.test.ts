/**
 * The gate, tested as an attacker would test it.
 *
 * Hearth's whole design assumes one person at one machine: no accounts, no
 * login, the API keys sitting in the same database as the chats. Multiplayer
 * puts that program on the open internet so somebody in another country can
 * play, and the only thing between a stranger who finds the address and
 * everything the owner has is the gate in index.ts.
 *
 * So these are not "does the feature work" tests. Most of them are "what
 * happens when it is used wrong", because the failure mode is silent: a route
 * that forgets to check hands over a key and nobody sees a stack trace.
 *
 *   bun test src/multiplayer.test.ts
 */

import { describe, expect, test } from "bun:test";

import { db, setSettings, wipe } from "./test-support";

const { app } = await import("./index");

/** A request that looks like it came from somewhere else on the internet. */
const AWAY = { incoming: { socket: { remoteAddress: "203.0.113.9" } } };
/** ...and one from the machine Hearth is running on. */
const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };

const ask = (path: string, init: RequestInit = {}, env: any = AWAY) =>
  app.fetch(new Request(`http://table.example${path}`, init), env);

function seed() {
  wipe();
  const t = Date.now();
  db.query("INSERT INTO characters (id, name, created_at) VALUES (?,?,?)").run("c1", "The Gamekeeper", t);
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run("chat1", "c1", "Greywater", t, t);
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run("chat2", "c1", "Somewhere private", t, t);
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES (?,?,?,?,?,?)")
    .run("m1", "chat1", "assistant", "The Gamekeeper", "The fire has been going a while.", t);
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES (?,?,?,?,?,?)")
    .run("m2", "chat2", "assistant", "The Gamekeeper", "Something not for sharing.", t);
  setSettings({ key_openrouter: "sk-or-THE-SECRET-KEY" });
}

/** Open chat1 to the world, the way the host would, and take the link. */
async function openTable() {
  const res = await ask("/api/shares", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: "chat1", name: "Greywater" }),
  }, HOME);
  return (await res.json()) as { id: string; join: string };
}

/** Walk through the door and come back with a seat. */
async function join(joinPath: string) {
  const res = await ask(joinPath, {}, AWAY);
  const cookie = res.headers.get("set-cookie") ?? "";
  const token = /hearth_player=([^;]+)/.exec(cookie)?.[1] ?? "";
  return { status: res.status, cookie: `hearth_player=${token}`, token };
}

describe("the door", () => {
  test("a good link seats you and hands back a token that is not the invitation", async () => {
    seed();
    const share = await openTable();
    const seat = await join(share.join);
    expect(seat.status).toBe(302);
    expect(seat.token).toMatch(/^[0-9a-f]{32}$/);
    // The seat's token is its own. If it were the share's, revoking one person
    // would mean revoking the table.
    expect(share.join).not.toContain(seat.token);
  });

  test("a made-up link seats nobody", async () => {
    seed();
    await openTable();
    const res = await ask("/join/" + "0".repeat(32), {}, AWAY);
    expect(res.status).toBe(410);
    expect(db.query("SELECT COUNT(*) n FROM players").get()).toMatchObject({ n: 0 });
  });

  test("following the same link twice keeps the seat you had", async () => {
    seed();
    const share = await openTable();
    const first = await join(share.join);
    const again = await ask(share.join, { headers: { cookie: first.cookie } }, AWAY);
    const token2 = /hearth_player=([^;]+)/.exec(again.headers.get("set-cookie") ?? "")?.[1];
    expect(token2).toBe(first.token);
    expect(db.query("SELECT COUNT(*) n FROM players").get()).toMatchObject({ n: 1 });
  });
});

describe("what a guest can reach", () => {
  test("their own table", async () => {
    seed();
    const share = await openTable();
    const seat = await join(share.join);
    const res = await ask("/api/table/state", { headers: { cookie: seat.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.messages.map((m: any) => m.content)).toContain("The fire has been going a while.");
  });

  test("and can take a turn in it", async () => {
    seed();
    const share = await openTable();
    const seat = await join(share.join);
    const res = await ask("/api/table/say", {
      method: "POST",
      headers: { cookie: seat.cookie, "content-type": "application/json" },
      body: JSON.stringify({ content: "I sit down by the fire." }),
    });
    expect(res.status).toBe(200);
    const saved = db.query("SELECT * FROM messages WHERE chat_id = 'chat1' ORDER BY created_at DESC").get() as any;
    expect(saved.content).toBe("I sit down by the fire.");
    expect(saved.role).toBe("user");
  });
});

describe("what a guest cannot reach", () => {
  test("the keys, by any of the routes that hold them", async () => {
    seed();
    const share = await openTable();
    const seat = await join(share.join);
    for (const path of ["/api/settings", "/api/backup"]) {
      const res = await ask(path, { headers: { cookie: seat.cookie } });
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("THE-SECRET-KEY");
    }
  });

  test("the rest of the library", async () => {
    seed();
    const share = await openTable();
    const seat = await join(share.join);
    for (const path of [
      "/api/chats", "/api/characters", "/api/personas", "/api/lorebooks",
      "/api/presets", "/api/extensions", "/api/search?q=a",
      // Most pointedly: the other chat, which was never shared with anyone.
      "/api/chats/chat2/messages",
    ]) {
      const res = await ask(path, { headers: { cookie: seat.cookie } });
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("Something not for sharing.");
    }
  });

  test("anything that writes", async () => {
    seed();
    const share = await openTable();
    const seat = await join(share.join);
    const res = await ask("/api/settings", {
      method: "PUT",
      headers: { cookie: seat.cookie, "content-type": "application/json" },
      body: JSON.stringify({ key_openrouter: "replaced" }),
    });
    expect(res.status).toBe(403);
    expect((db.query("SELECT value FROM settings WHERE key = 'key_openrouter'").get() as any).value)
      .toBe("sk-or-THE-SECRET-KEY");
  });

  test("generation — a guest cannot spend the host's money directly", async () => {
    seed();
    const share = await openTable();
    const seat = await join(share.join);
    const res = await ask("/api/chats/chat1/generate", {
      method: "POST",
      headers: { cookie: seat.cookie, "content-type": "application/json" },
      body: JSON.stringify({ content: "hi", mode: "reply" }),
    });
    expect(res.status).toBe(403);
  });

  test("another table's seat is not this table's seat", async () => {
    seed();
    const share = await openTable();
    const seat = await join(share.join);
    // Hand-make a player row for a different share, as a stolen-token stand-in.
    db.query("INSERT INTO shares (id, chat_id, token, name, open, created_at) VALUES (?,?,?,?,1,?)")
      .run("s2", "chat2", "f".repeat(32), "", Date.now());
    const other = await join("/join/" + "f".repeat(32));
    const res = await ask("/api/table/state", { headers: { cookie: other.cookie } });
    const body = (await res.json()) as any;
    // They see chat2, which is their table — and never chat1, which is not.
    expect(body.messages.map((m: any) => m.content)).toContain("Something not for sharing.");
    expect(body.messages.map((m: any) => m.content)).not.toContain("The fire has been going a while.");
    expect(seat.token).not.toBe(other.token);
  });
});

describe("with no seat at all", () => {
  test("a stranger who finds the address gets nothing", async () => {
    seed();
    await openTable();
    for (const path of ["/api/settings", "/api/chats", "/api/table/state", "/api/characters"]) {
      const res = await ask(path, {}, AWAY);
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("THE-SECRET-KEY");
    }
  });

  test("a made-up token is not a seat", async () => {
    seed();
    await openTable();
    const res = await ask("/api/table/state", { headers: { cookie: "hearth_player=" + "a".repeat(32) } });
    expect(res.status).toBe(403);
  });

  test("but the owner at their own machine is unaffected", async () => {
    seed();
    const res = await ask("/api/settings", {}, HOME);
    expect(res.status).toBe(200);
    // Keys are masked for everyone, including the host — that is older than
    // this feature and must stay true.
    expect(await res.text()).not.toContain("THE-SECRET-KEY");
  });
});

describe("a proxy in front", () => {
  test("a forwarded request is never the owner, whatever the socket says", async () => {
    /*
     * The hole this closes, found by opening a real tunnel and asking it for
     * the settings. cloudflared connects to localhost, so everything it
     * forwards arrives *from loopback* — and loopback was the whole basis for
     * "this is the owner sitting at their own machine". The entire library was
     * being handed to anyone with the address, over the internet, and every
     * test in this file passed while it was.
     *
     * The real fix is a separate listener for the tunnel (see serve.ts), since
     * which socket the bytes arrived on is a fact rather than a claim. This is
     * the backstop for somebody pointing their own proxy at the ordinary port.
     */
    seed();
    for (const header of ["x-forwarded-for", "cf-connecting-ip"]) {
      const res = await ask("/api/settings", { headers: { [header]: "203.0.113.9" } }, HOME);
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("THE-SECRET-KEY");
    }
  });

  test("and an ordinary local request still is", async () => {
    seed();
    expect((await ask("/api/settings", {}, HOME)).status).toBe(200);
  });
});

describe("closing the table", () => {
  test("turns off the link and every seat at it", async () => {
    seed();
    const share = await openTable();
    const seat = await join(share.join);
    expect((await ask("/api/table/state", { headers: { cookie: seat.cookie } })).status).toBe(200);

    await ask(`/api/shares/${share.id}`, { method: "DELETE" }, HOME);

    // The seat is dead...
    expect((await ask("/api/table/state", { headers: { cookie: seat.cookie } })).status).toBe(403);
    // ...and so is the invitation, so it cannot simply be followed again.
    expect((await ask(share.join, {}, AWAY)).status).toBe(410);
  });
});

describe("the uploads folder", () => {
  test("is not a way around the gate", async () => {
    seed();
    await openTable();
    const res = await ask("/uploads/anything.png", {}, AWAY);
    expect(res.status).toBe(403);
  });
});
