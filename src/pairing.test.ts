/**
 * Desk mode: your computer, let into your own Hearth with a six-digit code
 * instead of a thirty-character key.
 *
 * Every request here arrives the way the computer's would: through the
 * public listener (markPublic), where an address on the socket proves
 * nothing and only the host cookie makes a caller the owner.
 */

import { describe, expect, test } from "bun:test";

import "./test-support";

const { app, markPublic } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const fromPhone = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`http://home.test${path}`, init), HOME);
const fromComputer = (path: string, init: RequestInit = {}) => {
  const req = new Request(`http://phone.lan${path}`, init);
  markPublic(req);
  return app.fetch(req, { incoming: { socket: { remoteAddress: "192.168.1.40" } } });
};
const enter = (code: string) => fromComputer("/pair", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }),
});
const newCode = async () => (await (await fromPhone("/api/pair/start", { method: "POST" })).json()).code as string;
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

describe("pairing a computer", () => {
  test("without a code the computer is a stranger", async () => {
    expect((await fromComputer("/api/settings")).status).toBe(403);
  });

  test("only the phone can make a code", async () => {
    expect((await fromComputer("/api/pair/start", { method: "POST" })).status).toBe(403);
  });

  test("the right code makes the computer the owner, from then on", async () => {
    const code = await newCode();
    expect(code).toMatch(/^\d{6}$/);
    const res = await enter(`${code.slice(0, 3)} ${code.slice(3)}`);   // as typed, with the space
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);
    expect(cookie).toContain("hearth_host=");
    expect((await fromComputer("/api/settings", { headers: { cookie } })).status).toBe(200);
  });

  test("a code works once", async () => {
    const code = await newCode();
    expect((await enter(code)).status).toBe(200);
    expect((await enter(code)).status).toBe(403);
  });

  test("five wrong guesses and the code is gone, even the right one", async () => {
    const code = await newCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await enter(wrong)).status).toBe(403);
    expect((await enter(code)).status).toBe(403);
  });

  test("closing the door cancels a waiting code", async () => {
    const code = await newCode();
    await fromPhone("/api/hosting", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: false }),
    });
    expect((await enter(code)).status).toBe(403);
  });
});
