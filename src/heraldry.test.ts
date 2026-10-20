/**
 * Arms: chosen from lists, drawn by Hearth, legible on a dark screen.
 *
 *   bun test src/heraldry.test.ts
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { armsFromName, chargeFor, contrastProblems, drawArms, normaliseBlazon, tinctureOf, withContrast, type Blazon } from "./heraldry";

const ROOT = join(import.meta.dir, "..", "public", "charges");
const IDS: string[] = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")).assets.map((a: any) => a.id);

test("colours by their heraldic names or their plain ones", () => {
  expect(["Gold", "silver", "RED", "azure", "green", "black", "violet", "teal"].map(tinctureOf))
    .toEqual(["or", "argent", "gules", "azure", "vert", "sable", "purpure", null]);
});

test("a charge by its id, a word for it, or a word inside it — and nothing made up", () => {
  expect(chargeFor("lion_rampant", IDS)).toBe("lion_rampant");
  expect(chargeFor("a red lion", IDS)).toBe("lion_rampant");
  expect(chargeFor("Kraken", IDS)).toBe("kraken");
  expect(chargeFor("squid", IDS)).toBe("kraken");
  expect(chargeFor("badgers", IDS)).toBe("badger");
  expect(chargeFor("a burning tower", IDS)).toBe("tower");
  expect(chargeFor("thestral", IDS)).toBe("skeletal_winged_horse");
  expect(chargeFor("a laser cannon", IDS)).toBeNull();
});

test("a blazon from loose input; whatever cannot be read is left off rather than guessed", () => {
  const b = normaliseBlazon({ field: { split: "per_pale", colours: ["blue", "gold"] }, band: { type: "fess", colour: "neon" },
    charge: { type: "eagle", colour: "silver", count: 7 } }, IDS)!;
  expect(b).toEqual({ field: { split: "per_pale", colours: ["azure", "or"] }, band: null,
    charge: { type: "eagle_displayed", colour: "argent", count: 1 } });
  expect(normaliseBlazon({ field: { colours: ["plaid"] } }, IDS)).toBeNull();
  // A split of one colour into itself is no split.
  expect(normaliseBlazon({ field: { split: "per_fess", colours: ["red", "red"] } }, IDS)!.field).toEqual({ split: "none", colours: ["gules"] });
});

test("the rule of tincture: found, and fixed by the nearest change", () => {
  const bad: Blazon = { field: { split: "none", colours: ["or"] }, band: { type: "chief", colour: "argent" },
    charge: { type: "lion_rampant", colour: "argent", count: 1 } };
  expect(contrastProblems(bad)).toEqual(["silver band on gold", "silver charge on gold"]);
  const fixed = withContrast(bad);
  expect(contrastProblems(fixed)).toEqual([]);
  expect(fixed.field).toEqual(bad.field);
  const good: Blazon = { field: { split: "none", colours: ["azure"] }, band: null, charge: { type: "tower", colour: "argent", count: 1 } };
  expect(withContrast(good)).toEqual(good);
});

test("a charge across a divided field stands out against both halves", () => {
  const lost: Blazon = { field: { split: "per_pale", colours: ["purpure", "argent"] }, band: null, charge: { type: "bull", colour: "argent", count: 1 } };
  expect(contrastProblems(lost)).toEqual(["silver charge is lost against the purple and silver field"]);
  const fixed = withContrast(lost);
  expect(contrastProblems(fixed)).toEqual([]);
  expect(["purpure", "argent"]).not.toContain(fixed.charge!.colour);
});

test("arms from a name: the same every time, always legible, always from the real set", () => {
  const a = armsFromName("House Hightower", IDS);
  expect(armsFromName("house hightower ", IDS)).toEqual(a);
  for (const name of ["House Tyrell", "The Blackthorn Guild", "Iron Bank", "Order of the Ash", "Kingsguard", "x"]) {
    const b = armsFromName(name, IDS);
    expect(contrastProblems(b)).toEqual([]);
    expect(IDS).toContain(b.charge!.type);
  }
  expect(new Set(["A", "B", "C", "D", "E", "F", "G"].map((n) => JSON.stringify(armsFromName(`House ${n}`, IDS)))).size).toBeGreaterThan(4);
});

test("drawn as one safe SVG, as a shield or a badge", () => {
  const d = readFileSync(join(ROOT, "built", "tower.svg"), "utf8").match(/ d="([^"]+)"/)![1];
  const b: Blazon = { field: { split: "per_pale", colours: ["azure", "or"] }, band: { type: "chief", colour: "argent" },
    charge: { type: "tower", colour: "sable", count: 3 } };
  const svg = drawArms(b, { tower: d }, { id: "hightower", label: 'House "Hightower" <x>' });
  expect(svg).toContain('viewBox="0 0 100 120"');
  expect(svg.match(/<path transform=/g)).toHaveLength(3);
  // No nested <svg> for a page's CSS to catch.
  expect(svg.match(/<svg\b/g)).toHaveLength(1);
  expect(svg).toContain('clip-path="url(#hightower-clip)"');
  expect(svg).toContain('aria-label="House Hightower x"');
  expect(svg).not.toMatch(/<script|on\w+=|href=/i);
  expect(drawArms(b, { tower: d }, { style: "badge" })).toContain("A46 46");
});
