/**
 * The relay: a computer holding a tunnel open for a phone on its network.
 *
 * What matters here is what it refuses. A button that tunnels to any address
 * it is given would publish a router's admin page, or a Hearth whose library
 * is open, to anybody holding the link.
 *
 *   bun test src/relay.test.ts
 */

import { afterAll, describe, expect, test } from "bun:test";

import { isNearby, looksLikeGuestDoor, openRelay, parseRelayTarget, closeRelay } from "./door";

describe("the address", () => {
  test("is read as it is shown on the phone, with or without http://", () => {
    expect(parseRelayTarget("192.168.1.23:7871")).toEqual({ host: "192.168.1.23", port: 7871 });
    expect(parseRelayTarget(" http://10.0.0.5:7871/ ")).toEqual({ host: "10.0.0.5", port: 7871 });
    expect(parseRelayTarget("192.168.1.23")).toBeNull();
    expect(parseRelayTarget("192.168.1.23:99999")).toBeNull();
    expect(parseRelayTarget("a b:1")).toBeNull();
  });

  test("must be on this network or a VPN", () => {
    for (const h of ["192.168.1.23", "10.1.2.3", "172.16.0.9", "172.31.255.1", "100.101.102.103", "169.254.1.1",
                     "pixel.local", "phone.tail1234.ts.net"]) {
      expect(isNearby(h)).toBe(true);
    }
    for (const h of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "example.com", "192.168.1.256", "127.0.0.1", "localhost"]) {
      expect(isNearby(h)).toBe(false);
    }
  });
});

describe("what is at the address", () => {
  const page = `<!doctype html><html><head><title>Hearth</title></head></html>`;
  const guest = Bun.serve({ port: 0, fetch: (r) =>
    new URL(r.url).pathname.startsWith("/api/") ? Response.json({ error: "no" }, { status: 403 })
      : new Response(page, { headers: { "content-type": "text/html" } }) });
  const open = Bun.serve({ port: 0, fetch: (r) =>
    new URL(r.url).pathname.startsWith("/api/") ? Response.json({ provider: "x" })
      : new Response(page, { headers: { "content-type": "text/html" } }) });
  const other = Bun.serve({ port: 0, fetch: () => new Response("<title>Router admin</title>") });
  afterAll(() => { guest.stop(true); open.stop(true); other.stop(true); closeRelay(); });

  test("a Hearth guest entrance passes", async () => {
    expect(await looksLikeGuestDoor("127.0.0.1", guest.port!)).toBeNull();
  });
  test("a Hearth with its library open does not", async () => {
    expect(await looksLikeGuestDoor("127.0.0.1", open.port!)).toContain("library open");
  });
  test("something that is not Hearth does not", async () => {
    expect(await looksLikeGuestDoor("127.0.0.1", other.port!)).toContain("not a Hearth");
  });
  test("nothing there says so", async () => {
    const dead = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = dead.port!;
    dead.stop(true);
    expect(await looksLikeGuestDoor("127.0.0.1", port)).toContain("Nothing answered");
  });
});

describe("opening it", () => {
  test("an address on the internet is refused before anything is started", async () => {
    const s = await openRelay("8.8.8.8:7871");
    expect(s.running).toBe(false);
    expect(s.trouble).toContain("on this network");
  });
  test("so is a malformed one", async () => {
    expect((await openRelay("my phone")).trouble).toContain("like 192.168.1.23:7871");
  });
});
