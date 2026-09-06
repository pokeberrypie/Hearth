/**
 * Drawing a resolved roll.
 *
 * The server settles dice before a message is saved and writes the answer back
 * into the text; the browser turns that into a die you can read. Two shapes come
 * out of `describeRoll`, and they differ by exactly one character:
 *
 *     2d6+3: 4, 5 + 3 = 12     arithmetic worth showing
 *     1d20: 18                 a lone die, nothing to add up
 *
 * With the equals sign treated as optional, the first pattern also matched the
 * second — lazily taking "1" as the working and "8" as the total. Every d20 of
 * ten or more drew as its last digit. Nothing threw, nothing logged, and the
 * number on screen was simply wrong, which in a game that turns on rolls is
 * about the worst way for a bug to behave.
 *
 * The renderer lives in public/app.js, which is a browser script rather than a
 * module, so it is lifted out and run here. Worth the small amount of
 * awkwardness: the alternative is that this is only ever checked by somebody
 * noticing a wrong number mid-scene.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Pulls one top-level `function name(...) { ... }` out of a browser script. */
function lift(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name}() is not in app.js any more`);
  // Top-level functions in this file close on a brace in the first column.
  const end = source.indexOf("\n}\n", start);
  if (end === -1) throw new Error(`could not find the end of ${name}()`);
  return source.slice(start, end + 3);
}

const APP = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");

const dice = new Function(
  // The real one escapes for HTML; the shape of that is not what is under test.
  `const esc = (s) => String(s);
   ${lift(APP, "dice")}
   return dice;`,
)() as (html: string) => string;

/** The number the reader actually sees. */
const shown = (html: string): string | null =>
  html.match(/<span class="die">([^<]*)<\/span>/)?.[1] ?? null;

/** What the tooltip says the working was. */
const title = (html: string): string | null =>
  html.match(/<span class="roll" title="([^"]*)"/)?.[1] ?? null;

describe("a lone die", () => {
  test("shows the whole number, not its last digit", () => {
    for (let n = 1; n <= 20; n++) {
      expect(shown(dice(`[[1d20: ${n}]]`))).toBe(String(n));
    }
  });

  test("the two-digit case that was broken", () => {
    const out = dice("[[1d20: 18]]");
    expect(shown(out)).toBe("18");
    expect(title(out)).toBe("1d20");
  });

  test("works for any die, and for three digits", () => {
    expect(shown(dice("[[1d6: 6]]"))).toBe("6");
    expect(shown(dice("[[1d100: 100]]"))).toBe("100");
    expect(shown(dice("[[1d100: 7]]"))).toBe("7");
  });
});

describe("a roll with arithmetic", () => {
  test("shows the total and keeps the working in the tooltip", () => {
    const out = dice("[[2d6+3: 4, 5 + 3 = 12]]");
    expect(shown(out)).toBe("12");
    expect(title(out)).toBe("2d6+3 — 4, 5 + 3");
  });

  test("handles a negative modifier", () => {
    const out = dice("[[2d8-1: 3, 6 - 1 = 8]]");
    expect(shown(out)).toBe("8");
    expect(title(out)).toContain("2d8-1");
  });

  test("takes the total after the equals, never a digit from the working", () => {
    // The working ends in 5 and the total is 15: picking the wrong one here is
    // the same family of mistake as the original bug.
    expect(shown(dice("[[3d6: 5, 5, 5 = 15]]"))).toBe("15");
  });
});

describe("several in one message", () => {
  test("each is drawn, and the mixed forms do not eat each other", () => {
    const out = dice("a [[1d20: 18]] b [[2d6+3: 4, 5 + 3 = 12]] c [[1d4: 3]]");
    const all = [...out.matchAll(/<span class="die">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(all).toEqual(["18", "12", "3"]);
  });
});

describe("what it leaves alone", () => {
  test("anything that is not a resolved roll", () => {
    for (const text of [
      "[[scene: the bridge at dusk]]",
      "[[Dexterity check: 14 + 2 = 16]]",
      "[[remember: she salts the sills]]",
      "no brackets at all",
      "[[1d20]]",
    ]) {
      expect(dice(text)).toBe(text);
    }
  });
});
