/**
 * The faction charges: every one listed is there, and every one is drawn so
 * the app can colour it — one shape, on the 100 x 100 canvas, in currentColor,
 * with nothing in it that could run or fetch. Holds any replacement to the
 * same rules as the set it joins.
 *
 *   bun test src/charges.test.ts
 */

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "public", "charges");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

test("every charge in the manifest has its file, and ids are unique and plain", () => {
  const ids = manifest.assets.map((a: any) => a.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const a of manifest.assets) {
    expect(a.id).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(existsSync(join(ROOT, a.svg))).toBe(true);
  }
});

test("every charge is one recolourable shape on the shared canvas, and nothing else", () => {
  for (const a of manifest.assets) {
    const svg = readFileSync(join(ROOT, a.svg), "utf8");
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg.match(/<path\b/g)?.length).toBe(1);
    expect(svg).toContain('fill="currentColor"');
    expect(svg).not.toMatch(/<(script|image|foreignObject|style|use)\b|on\w+=|href=/i);
    // Drawn inside the canvas, with the margin the set was cleaned to.
    const nums = [...svg.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].flatMap((m) => [Number(m[1]), Number(m[2])]);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(9.5);
    expect(Math.max(...nums)).toBeLessThanOrEqual(90.5);
  }
});
