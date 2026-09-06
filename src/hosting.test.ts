/**
 * Hosting from a device, and — much more importantly — not hosting from one.
 *
 * A phone that starts answering the coffee shop's Wi-Fi because hosting was
 * switched on once last week is the failure worth testing for. So most of
 * this is about off: that it starts off, that turning it off closes the
 * socket, and that a listener which will not start leaves the state honest
 * rather than claiming to be on.
 */

import { beforeEach, describe, expect, test } from "bun:test";

import { addresses, hostingState, provideListener, setHosting, stopHosting } from "./hosting";

/** A listener that records rather than binds. */
function fake() {
  const log: string[] = [];
  let open = 0;
  provideListener((port, host) => {
    log.push(`listen ${host}:${port}`);
    open++;
    return { close() { open--; log.push("close"); }, port };
  });
  return { log, get open() { return open; } };
}

beforeEach(() => { stopHosting(); });

describe("off, until asked", () => {
  test("starts off", () => {
    expect(hostingState().on).toBe(false);
  });

  test("and turning it off when it is already off is not an error", () => {
    fake();
    expect(setHosting(false, 7871).on).toBe(false);
  });
});

describe("turning it on", () => {
  test("opens one listener, on every interface", () => {
    const f = fake();
    const s = setHosting(true, 7871);
    expect(s.on).toBe(true);
    expect(s.port).toBe(7871);
    // Every interface, not a chosen one: a phone moves between Wi-Fi, a
    // hotspot and a VPN, and whichever was picked at boot is the wrong one by
    // the evening.
    expect(f.log).toEqual(["listen 0.0.0.0:7871"]);
  });

  test("reports the port that was actually bound, not the one asked for", () => {
    // The desktop shifts by one to stay clear of the tunnel's socket. Saying
    // the number that was requested meant the state read 7871 while the
    // listener answered on 7872, so a join link built from it went nowhere.
    provideListener((port) => ({ close() {}, port: port + 1 }));
    expect(setHosting(true, 7871).port).toBe(7872);
  });

  test("twice is still once", () => {
    const f = fake();
    setHosting(true, 7871);
    setHosting(true, 7871);
    expect(f.open).toBe(1);
  });

  test("and off again actually closes it", () => {
    const f = fake();
    setHosting(true, 7871);
    setHosting(false, 7871);
    expect(f.open).toBe(0);
    expect(hostingState().on).toBe(false);
  });
});

describe("when it cannot", () => {
  test("a listener that throws leaves it off and says why", () => {
    provideListener(() => { throw new Error("EADDRINUSE"); });
    const s = setHosting(true, 7871);
    // The failure that matters: reporting "on" while nothing is listening
    // means somebody sends out a link to a door that does not exist.
    expect(s.on).toBe(false);
    expect(s.trouble).toContain("EADDRINUSE");
  });

  test("a platform with no listener at all says so rather than pretending", () => {
    provideListener(null as any);
    expect(setHosting(true, 7871).on).toBe(false);
  });
});

describe("where somebody else could reach this", () => {
  test("never offers an address that only works here", () => {
    for (const a of addresses()) {
      expect(a).not.toBe("127.0.0.1");
      expect(a.startsWith("127.")).toBe(false);
      // An address the machine gave itself when DHCP failed is not an
      // invitation anybody can accept.
      expect(a.startsWith("169.254.")).toBe(false);
    }
  });

  test("offers each one once", () => {
    const list = addresses();
    expect(new Set(list).size).toBe(list.length);
  });
});
