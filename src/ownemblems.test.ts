/**
 * Emblems of your own: an uploaded picture is checked before it is kept, can
 * be worn by a faction, is drawn through a mask in the faction's colour, and
 * is never chosen for a faction by anything but a person.
 *
 *   bun test src/ownemblems.test.ts
 */

import { beforeEach, describe, expect, test } from "bun:test";

import { drawArms, uploadProblem, type Blazon } from "./heraldry";
import { db, setSettings, wipe } from "./test-support";

const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://hearth.local${path}`, init), HOME);
const json = (path: string, method: string, body: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Just enough of a PNG to be read: the signature, an IHDR, and whatever chunks are asked for. */
function png(w: number, h: number, colourType: number, chunks: string[] = []): Uint8Array<ArrayBuffer> {
  const out: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const u32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (name: string, data: number[]) => out.push(...u32(data.length), ...[...name].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0);
  chunk("IHDR", [...u32(w), ...u32(h), 8, colourType, 0, 0, 0]);
  for (const name of chunks) chunk(name, [0]);
  chunk("IDAT", [0]);
  chunk("IEND", []);
  return new Uint8Array(out);
}

describe("what an uploaded emblem must be", () => {
  test("a square PNG with a clear background will do", () => {
    expect(uploadProblem(png(512, 512, 6))).toBeNull();
    expect(uploadProblem(png(256, 240, 4))).toBeNull();
    expect(uploadProblem(png(512, 512, 3, ["tRNS"]))).toBeNull();
  });

  test("anything else says what is wrong with it", () => {
    expect(uploadProblem(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>".padEnd(64)))).toContain("not a PNG");
    expect(uploadProblem(png(64, 64, 6))).toContain("at least 128");
    expect(uploadProblem(png(4096, 4096, 6))).toContain("the most");
    expect(uploadProblem(png(512, 200, 6))).toContain("square");
    expect(uploadProblem(png(512, 512, 2))).toContain("no transparent background");
    expect(uploadProblem(png(512, 512, 3))).toContain("no transparent background");
  });
});

describe("drawing one", () => {
  const arms: Blazon = { field: { split: "none", colours: ["azure"] }, band: null, charge: { type: "own_abc", colour: "or", count: 2 } };

  test("the picture is a mask and the tincture is poured through it, once per charge", () => {
    const svg = drawArms(arms, {}, { id: "t", images: { own_abc: "data:image/png;base64,AAAA" } });
    expect(svg).toContain('<mask id="t-charge"');
    expect(svg).toContain("mask-type:alpha");
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    expect(svg.match(/mask="url\(#t-charge\)"/g)).toHaveLength(2);
  });

  test("without the picture there is simply no emblem", () => {
    const svg = drawArms(arms, {}, { id: "t" });
    expect(svg).not.toContain("<mask");
    expect(svg).not.toContain("<rect transform");
  });
});

describe("the routes", () => {
  beforeEach(async () => {
    wipe();
    // Uploads are files, not rows, so wipe() leaves them: clear them the way a person would.
    for (const c of (await (await ask("/api/charges/own")).json()).charges) await ask(`/api/charges/own/${c.id}`, { method: "DELETE" });
    setSettings({ steward_on: "0" });
    const t = Date.now();
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('gk', 'The Gamekeeper', ?)").run(t);
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'gk', 'The Hand', ?, ?)").run(t, t);
    db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES ('m1', 'ch', 'assistant', 'It begins.', ?)").run(t);
  });

  const upload = (bytes: Uint8Array<ArrayBuffer>, name = "my-rose.png") => {
    const fd = new FormData();
    fd.append("file", new File([bytes], name, { type: "image/png" }));
    return ask("/api/charges/own", { method: "POST", body: fd });
  };

  test("an upload is kept, listed, worn and drawn; removing it leaves a plain shield", async () => {
    const up = await upload(png(512, 512, 6));
    expect(up.status).toBe(200);
    const mine = await up.json();
    expect(mine.id).toMatch(/^own_[a-z]+$/);
    expect(mine.name).toBe("my-rose");

    const list = await (await ask("/api/charges/own")).json();
    expect(list.charges.map((c: any) => c.id)).toContain(mine.id);
    expect(list.guide.text).toContain("transparent");
    expect(list.charges[0].url).toBe(`/uploads/charges/${mine.id}.png`);

    await json("/api/chats/ch/chronicle", "POST", { kind: "faction", name: "House Ashford",
      arms: { field: { colours: ["azure"] }, charge: { type: mine.id, colour: "or", count: 1 } } });
    const state = await (await ask("/api/chats/ch/chronicle")).json();
    const house = state.factions.find((f: any) => f.name === "House Ashford");
    expect(house.arms.charge.type).toBe(mine.id);
    const svg = await (await ask(`/api/chats/ch/factions/${house.key}/arms.svg`)).text();
    expect(svg).toContain("data:image/png;base64,");
    expect(svg).toContain("mask=");

    expect((await ask(`/api/charges/own/${mine.id}`, { method: "DELETE" })).status).toBe(200);
    const after = await (await ask(`/api/chats/ch/factions/${house.key}/arms.svg`)).text();
    expect(after).not.toContain("data:image/png");
    expect((await (await ask("/api/charges/own")).json()).charges).toEqual([]);
  });

  test("a picture that will not do is refused with the reason, and nothing is kept", async () => {
    const r = await upload(png(512, 512, 2));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("transparent");
    expect((await (await ask("/api/charges/own")).json()).charges).toEqual([]);
  });

  test("a faction's arms from its name never pick somebody's own emblem", async () => {
    for (let i = 0; i < 3; i++) await upload(png(512, 512, 6), `rose${"x".repeat(i)}.png`);
    for (const name of ["House Rose", "The Own Guard", "Order of the Custom", "House Ashford", "The Guild"]) {
      await json("/api/chats/ch/chronicle", "POST", { kind: "faction", name });
    }
    const state = await (await ask("/api/chats/ch/chronicle")).json();
    for (const f of state.factions) expect(String(f.arms?.charge?.type ?? "")).not.toMatch(/^own_/);
  });
});
