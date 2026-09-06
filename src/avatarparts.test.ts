/**
 * The built-in avatar gear, checked for the one mistake it is prone to.
 *
 * Path data is written as concatenated string literals, because a bezier that
 * fits in eighty columns is a bezier nobody can read. The failure that invites
 * is joining `"...11-62"` to `"0-20..."` and getting `11-620`, which is a
 * perfectly valid number and a completely different shape. It happened four
 * times in one afternoon, and it is invisible: the browser logs a warning to a
 * console nobody has open and draws the path up to the error, so what you get
 * is a face with a slightly wrong jaw rather than an obvious break.
 *
 * A fused number changes how many arguments a command has, and every path
 * command takes a fixed multiple. So counting is a complete detector for
 * exactly this bug, which is why this test counts rather than rendering.
 *
 * The parts file is a browser script rather than a module, so it is run here
 * against a stub window — which also checks that it still hands out exactly the
 * one global it is supposed to.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Part = {
  layer: string;
  id: string;
  name: string;
  art?: string;
  pair?: string;
  tint?: string | null;
};

/** Runs public/avatar-parts.js the way a page would, and takes what it exports. */
function loadParts(): Part[] {
  const src = readFileSync(join(import.meta.dir, "..", "public", "avatar-parts.js"), "utf8");
  const win: Record<string, unknown> = {};
  new Function("window", src)(win);
  return win.HEARTH_PARTS as Part[];
}

/** How many numbers each path command takes, per repetition. */
const ARGS: Record<string, number> = {
  m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0,
};

/** The complaint about a path's argument counts, or null if it adds up. */
function faultIn(d: string): string | null {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const faults: string[] = [];
  let i = 0;
  let cmd: string | null = null;

  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) { cmd = tokens[i]; i++; }
    else if (!cmd) return "starts with a number";

    const need = ARGS[cmd!.toLowerCase()];
    if (need === undefined) return `unknown command ${cmd}`;
    if (need === 0) continue;

    let n = 0;
    while (i < tokens.length && !/[a-z]/i.test(tokens[i])) { n++; i++; }
    if (n === 0 || n % need !== 0) {
      faults.push(`${cmd} takes a multiple of ${need}, got ${n}`);
    }
    // After a moveto, repeated coordinate pairs are implicit linetos.
    if (cmd!.toLowerCase() === "m") cmd = cmd === "M" ? "L" : "l";
  }
  return faults.length ? faults.join("; ") : null;
}

/** Every `d` attribute a part would put on the page, tokens resolved. */
function pathsOf(part: Part): string[] {
  const markup = `${part.art ?? ""}${part.pair ?? ""}`
    .replace(/%C|%D|%L/g, "#000000")
    .replace(/%K/g, "1");
  return [...markup.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
}

const PARTS = loadParts();

describe("the parts file", () => {
  test("hands out exactly one global", () => {
    const src = readFileSync(join(import.meta.dir, "..", "public", "avatar-parts.js"), "utf8");
    const win: Record<string, unknown> = {};
    new Function("window", src)(win);
    expect(Object.keys(win)).toEqual(["HEARTH_PARTS"]);
  });

  test("has parts in it", () => {
    expect(PARTS.length).toBeGreaterThan(0);
  });
});

describe("every drawn path", () => {
  test("has the right number of arguments for each command", () => {
    const broken = PARTS.flatMap((p) =>
      pathsOf(p).map((d) => ({ part: `${p.layer}/${p.id}`, fault: faultIn(d) }))
        .filter((x) => x.fault));
    expect(broken).toEqual([]);
  });

  test("the detector actually catches a fused number", () => {
    // The exact shape of the bug: "…11-62" joined to "0-20…".
    expect(faultIn("M100 38c21 0 38 17 38 42 0 17-3 32-8 44 11-620-20-8-35-23-46z"))
      .toContain("multiple of 6");
    // And the same path, spaced correctly, is fine.
    expect(faultIn("M100 38c21 0 38 17 38 42 0 17-3 32-8 44-4 10-10 18-18 22 " +
                   "7-16 11-38 11-62 0-20-8-35-23-46z")).toBeNull();
  });
});

describe("every part", () => {
  test("declares a layer, an id and something to draw", () => {
    for (const p of PARTS) {
      expect(typeof p.layer).toBe("string");
      expect(p.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(`${p.art ?? ""}${p.pair ?? ""}`.length).toBeGreaterThan(0);
    }
  });

  test("is unique within its layer", () => {
    const seen = new Set<string>();
    for (const p of PARTS) {
      const key = `${p.layer}/${p.id}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test("leaves no tint token unresolved when it declares no tint", () => {
    // A part with no tint that still writes %C would paint itself black.
    for (const p of PARTS) {
      if (p.tint) continue;
      expect(`${p.art ?? ""}${p.pair ?? ""}`).not.toContain("%C");
    }
  });
});
