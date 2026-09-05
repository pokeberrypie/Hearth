import { describe, expect, test } from "bun:test";
import {
  clearRoom, guestMayTouch, isLoopback, listeners, newToken, publicPlayer,
  publish, sameToken, subscribe, tidyPlayerName, treatAsHost, type Player,
} from "./share";

describe("tokens", () => {
  test("are long, hex, and never repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const t = newToken();
      expect(t).toMatch(/^[0-9a-f]{32}$/);
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
  });

  test("compare equal only to themselves", () => {
    const t = newToken();
    expect(sameToken(t, t)).toBe(true);
    expect(sameToken(t, newToken())).toBe(false);
  });

  test("a missing or empty token is never equal to anything", () => {
    // The failure that matters: `sameToken(row?.token, given)` where both are
    // undefined must not read as a match and wave the request through.
    expect(sameToken("", "")).toBe(false);
    expect(sameToken(undefined as any, undefined as any)).toBe(false);
    expect(sameToken(null as any, "")).toBe(false);
    expect(sameToken("abc", "abcd")).toBe(false);
  });
});

describe("what a guest may touch", () => {
  test("the table, and only the table", () => {
    expect(guestMayTouch("GET", "/api/table/state")).toBe(true);
    expect(guestMayTouch("POST", "/api/table/say")).toBe(true);
    expect(guestMayTouch("GET", "/api/table/live")).toBe(true);
  });

  test("nothing that could hand over a key, the library, or the settings", () => {
    for (const [m, p] of [
      ["GET", "/api/settings"], ["PUT", "/api/settings"],
      ["GET", "/api/characters"], ["GET", "/api/chats"],
      ["GET", "/api/chats/abc/messages"], ["POST", "/api/chats"],
      ["GET", "/api/personas"], ["GET", "/api/lorebooks"],
      ["GET", "/api/presets"], ["POST", "/api/import"],
      ["GET", "/api/extensions"], ["GET", "/api/backup"],
      ["GET", "/api/search"], ["POST", "/api/dice"],
    ] as const) {
      expect(guestMayTouch(m, p)).toBe(false);
    }
  });

  test("the method is part of the permission", () => {
    // Reading who is at the table is not permission to rewrite it.
    expect(guestMayTouch("DELETE", "/api/table/state")).toBe(false);
    expect(guestMayTouch("PUT", "/api/table/state")).toBe(false);
    expect(guestMayTouch("POST", "/api/table/state")).toBe(false);
  });

  test("a query string does not smuggle a path past the list", () => {
    expect(guestMayTouch("GET", "/api/table/state?x=1")).toBe(true);
    expect(guestMayTouch("GET", "/api/settings?/api/table/state")).toBe(false);
  });

  test("prefixes and suffixes are not enough", () => {
    // Anchored patterns, so none of these ride in on a partial match.
    expect(guestMayTouch("GET", "/api/table/state/../../settings")).toBe(false);
    expect(guestMayTouch("GET", "/x/api/table/state")).toBe(false);
    expect(guestMayTouch("GET", "/api/table/stateful")).toBe(false);
  });
});

describe("loopback", () => {
  test("recognises every shape the platform hands back", () => {
    for (const a of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1", "localhost"]) {
      expect(isLoopback(a)).toBe(true);
    }
  });

  test("and nothing else", () => {
    // ::ffff:127.0.0.1 is the trap in the other direction: a check written as
    // `a === "::1"` calls a dual-stack loopback socket a public address, and a
    // check written as `a.includes("127.0.0.1")` calls this one loopback.
    for (const a of ["192.168.1.10", "10.0.0.4", "8.8.8.8", "::ffff:8.8.8.8",
                     "2001:db8::1", "", null, undefined, "127.0.0.1.nip.io"]) {
      expect(isLoopback(a as any)).toBe(false);
    }
  });
});

describe("who counts as the owner", () => {
  test("loopback always does, bound however it likes", () => {
    for (const wide of [false, true]) {
      expect(treatAsHost("127.0.0.1", wide)).toBe(true);
      expect(treatAsHost("::1", wide)).toBe(true);
      expect(treatAsHost("::ffff:127.0.0.1", wide)).toBe(true);
    }
  });

  test("a real remote address never does", () => {
    for (const wide of [false, true]) {
      expect(treatAsHost("192.168.1.9", wide)).toBe(false);
      expect(treatAsHost("203.0.113.9", wide)).toBe(false);
      expect(treatAsHost("::ffff:8.8.8.8", wide)).toBe(false);
    }
  });

  test("an unknown address is local only while nothing else can reach us", () => {
    // This is the whole bug, written down. Bound to loopback, a request the
    // runtime could not name can only have come from this machine. Bound to
    // 0.0.0.0 it might have come from anywhere, and the first version said
    // "local" to both — so the gate stood open on the network while every
    // test passed, because a test always supplies an address.
    expect(treatAsHost("", false)).toBe(true);
    expect(treatAsHost(undefined, false)).toBe(true);
    expect(treatAsHost(null, false)).toBe(true);

    expect(treatAsHost("", true)).toBe(false);
    expect(treatAsHost(undefined, true)).toBe(false);
    expect(treatAsHost(null, true)).toBe(false);
    expect(treatAsHost("   ", true)).toBe(false);
  });
});

describe("the room", () => {
  const player = (over: Partial<Player> = {}): Player => ({
    id: "p1", share_id: "s1", token: "secret-token", name: "Dan",
    persona_id: null, host: false, seen_at: 0, created_at: 0, ...over,
  });

  test("everyone subscribed hears an event, and nobody else does", () => {
    clearRoom("s1"); clearRoom("s2");
    const heard: string[] = [];
    const off1 = subscribe("s1", (e) => heard.push(`1:${e}`));
    const off2 = subscribe("s1", (e) => heard.push(`2:${e}`));
    subscribe("s2", (e) => heard.push(`other:${e}`));

    publish("s1", "said", {});
    expect(heard).toEqual(["1:said", "2:said"]);

    off1(); off2();
    clearRoom("s2");
  });

  test("unsubscribing stops delivery and tidies the room away", () => {
    clearRoom("s1");
    const off = subscribe("s1", () => {});
    expect(listeners("s1")).toBe(1);
    off();
    expect(listeners("s1")).toBe(0);
  });

  test("one dead listener does not stop the others being reached", () => {
    // A guest whose socket has gone must not take the narrator away from
    // everybody still at the table.
    clearRoom("s1");
    const heard: string[] = [];
    subscribe("s1", () => { throw new Error("socket is gone"); });
    subscribe("s1", (e) => heard.push(e));

    publish("s1", "reply", {});
    expect(heard).toEqual(["reply"]);
    // And the broken one is gone rather than throwing again every turn.
    expect(listeners("s1")).toBe(1);

    publish("s1", "reply", {});
    expect(heard).toEqual(["reply", "reply"]);
    clearRoom("s1");
  });

  test("publishing to an empty room is not an error", () => {
    clearRoom("nobody");
    expect(() => publish("nobody", "said", {})).not.toThrow();
  });
});

describe("what leaves the server", () => {
  test("a player's token never does", () => {
    const p: Player = {
      id: "p1", share_id: "s1", token: "the-secret", name: "Dan",
      persona_id: "per1", host: false, seen_at: 5, created_at: 1,
    };
    const shown = publicPlayer(p);
    expect(JSON.stringify(shown)).not.toContain("the-secret");
    expect("token" in shown).toBe(false);
    expect(shown.name).toBe("Dan");
  });
});

describe("names", () => {
  test("are tidied, and never empty", () => {
    expect(tidyPlayerName("  Dan  ")).toBe("Dan");
    expect(tidyPlayerName("")).toBe("A player");
    expect(tidyPlayerName(null)).toBe("A player");
    expect(tidyPlayerName("a".repeat(200)).length).toBe(40);
  });

  test("two people called Dan stay tellable apart", () => {
    expect(tidyPlayerName("Dan", ["Dan"])).toBe("Dan (2)");
    expect(tidyPlayerName("Dan", ["Dan", "Dan (2)"])).toBe("Dan (3)");
  });
});
