/**
 * The host's own key — being the owner from somewhere that is not the machine.
 *
 * Hearth trusts loopback and nothing else, which is right and which left a real
 * hole: run it on a headless box with HOST=0.0.0.0 to reach it from your own
 * phone, and every endpoint answered 403. The app loaded and did nothing. An
 * invitation was no help either — that seats you as a guest, who may see one
 * shared table and none of the library.
 *
 * The fix must not be "trust the local network". A network is not a credential,
 * and the whole point of the gate is that only proof of the machine counts. So:
 * a key, printed where reading it means having the machine, exchanged once for
 * a cookie.
 *
 * These tests are written the way the multiplayer ones are — as an attacker
 * rather than as a user — because this is the one door that opens onto
 * everything, and its failures are silent.
 *
 *   bun test src/hostkey.test.ts
 */

import { describe, expect, test } from "bun:test";

import { db, setSettings, wipe } from "./test-support";

const { app, hostKey } = await import("./index");

/** A request from somewhere else on the network — a phone, say. */
const AWAY = { incoming: { socket: { remoteAddress: "192.168.1.44" } } };
/** ...and one from the machine itself. */
const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };

const ask = (path: string, init: RequestInit = {}, env: any = AWAY) =>
  app.fetch(new Request(`http://box.local${path}`, init), env);

const withKey = (key: string, header = false): RequestInit =>
  header
    ? { headers: { "x-hearth-host": key } }
    : { headers: { cookie: `hearth_host=${encodeURIComponent(key)}` } };

function fresh() {
  wipe();
  setSettings({ host_key: "" });
  return hostKey();
}

describe("without the key", () => {
  test("a stranger on the network gets nothing", async () => {
    fresh();
    expect((await ask("/api/settings")).status).toBe(403);
    expect((await ask("/api/characters")).status).toBe(403);
    expect((await ask("/api/chats")).status).toBe(403);
  });

  test("and neither does a wrong one", async () => {
    fresh();
    const wrong = "f".repeat(32);
    expect((await ask("/api/settings", withKey(wrong))).status).toBe(403);
  });

  test("an empty key is not a key, however it is sent", async () => {
    fresh();
    const attempts: RequestInit[] = [
      { headers: { cookie: "hearth_host=" } },
      { headers: { "x-hearth-host": "" } },
      { headers: { cookie: "hearth_host=; other=1" } },
    ];
    for (const attempt of attempts) {
      expect((await ask("/api/settings", attempt)).status).toBe(403);
    }
  });

  test("a key that is a prefix of the real one does not pass", async () => {
    const key = fresh();
    expect((await ask("/api/settings", withKey(key.slice(0, -1)))).status).toBe(403);
    expect((await ask("/api/settings", withKey(key + "0"))).status).toBe(403);
  });
});

describe("with the key", () => {
  test("the owner gets in from another device", async () => {
    const key = fresh();
    const res = await ask("/api/settings", withKey(key));
    expect(res.status).toBe(200);
  });

  test("a header works as well as a cookie, for anything that is not a browser", async () => {
    const key = fresh();
    expect((await ask("/api/settings", withKey(key, true))).status).toBe(200);
  });

  test("it reaches the uploads too, or every picture would break", async () => {
    const key = fresh();
    // 404 rather than 403: past the gate, and simply not a file that exists.
    expect((await ask("/uploads/nothing.png", withKey(key))).status).not.toBe(403);
    expect((await ask("/uploads/nothing.png")).status).toBe(403);
  });

  test("the machine itself never needed one", async () => {
    fresh();
    expect((await ask("/api/settings", {}, HOME)).status).toBe(200);
  });
});

describe("the key itself", () => {
  test("is kept, so it survives a restart", () => {
    const first = fresh();
    expect(hostKey()).toBe(first);
    expect(first.length).toBeGreaterThanOrEqual(32);
  });

  test("never goes out with the settings", async () => {
    const key = fresh();
    const body = await (await ask("/api/settings", withKey(key))).json();
    expect(body.host_key).toBeUndefined();
    // And it is nowhere else in that response either.
    expect(JSON.stringify(body)).not.toContain(key);
  });
});

describe("claiming it", () => {
  test("the right key hands back a cookie and sends you to the app", async () => {
    const key = fresh();
    const res = await ask(`/host/${key}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("hearth_host=");
    // HttpOnly, so an extension or an injected script cannot read it back out.
    expect(setCookie).toContain("HttpOnly");
    expect(res.headers.get("location")).toBe("/");
  });

  test("a wrong key is refused and sets nothing", async () => {
    fresh();
    const res = await ask(`/host/${"a".repeat(32)}`, { redirect: "manual" });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("an empty key is refused", async () => {
    fresh();
    expect((await ask("/host/", { redirect: "manual" })).status).not.toBe(302);
  });
});

describe("reading the link out of the app", () => {
  test("the host can, because that is the whole point of it existing", async () => {
    const key = fresh();
    const res = await ask("/api/host-link", withKey(key));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe(key);
    expect(Array.isArray(body.links)).toBe(true);
  });

  test("a stranger on the network cannot", async () => {
    fresh();
    expect((await ask("/api/host-link")).status).toBe(403);
  });

  test("and neither can a guest holding a seat", async () => {
    fresh();
    const t = Date.now();
    db.query("INSERT INTO characters (id, name, created_at) VALUES (?,?,?)").run("c9", "GM", t);
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
      .run("chat9", "c9", "A table", t, t);
    db.query("INSERT INTO shares (id, chat_id, token, open, created_at) VALUES (?,?,?,?,?)")
      .run("s9", "chat9", "sharetoken9", 1, t);
    db.query(
      "INSERT INTO players (id, share_id, token, name, host, seen_at, created_at) VALUES (?,?,?,?,?,?,?)",
    ).run("p9", "s9", "playertoken9", "A player", 0, t, t);

    // Handing a guest the host key would turn every invitation into the keys.
    const res = await ask("/api/host-link", { headers: { cookie: "hearth_player=playertoken9" } });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(hostKey());
  });
});

describe("what a guest cannot do with it", () => {
  test("holding a seat does not make you the host", async () => {
    const key = fresh();
    const t = Date.now();
    db.query("INSERT INTO characters (id, name, created_at) VALUES (?,?,?)").run("c1", "GM", t);
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
      .run("chat1", "c1", "A table", t, t);
    db.query("INSERT INTO shares (id, chat_id, token, open, created_at) VALUES (?,?,?,?,?)")
      .run("s1", "chat1", "sharetoken", 1, t);
    db.query(
      "INSERT INTO players (id, share_id, token, name, host, seen_at, created_at) VALUES (?,?,?,?,?,?,?)",
    ).run("p1", "s1", "playertoken", "A player", 0, t, t);

    // A seat gets the table and not the library.
    const asGuest = { headers: { cookie: "hearth_player=playertoken" } };
    expect((await ask("/api/table/state", asGuest)).status).not.toBe(403);
    expect((await ask("/api/settings", asGuest)).status).toBe(403);

    // And a guest cannot promote themselves by guessing at the shape of it.
    for (const guess of ["playertoken", "sharetoken", "1", "true"]) {
      expect((await ask("/api/settings", withKey(guess))).status).toBe(403);
    }
    // The real one still works, so the test is testing what it thinks it is.
    expect((await ask("/api/settings", withKey(key))).status).toBe(200);
  });
});
