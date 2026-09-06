/**
 * Turning a memory book into something worth writing a game from.
 *
 * The failure this guards against is quiet: send the whole book and you get a
 * brief about nothing, written at the cost of a very large call. So what is
 * checked here is that the sample stays inside its budget, that it picks the
 * entries an author has already told us matter, and that somebody's
 * crossings-out never end up describing their world.
 */

import { describe, expect, test } from "bun:test";

import { SEED_BUDGET, bookIsUsable, sampleBook, seedFromBook } from "./frombook";

const entry = (over: Record<string, unknown> = {}) => ({
  comment: "A place", keys: ["greywater"], content: "A town on a river.", ...over,
});

describe("choosing what speaks for a book", () => {
  test("an author's always-on entries come first", () => {
    // "Constant" is the author saying this is what the world is about; that is
    // better evidence than anything we could infer.
    const picked = sampleBook([
      entry({ comment: "Ordinary" }),
      entry({ comment: "Always", constant: true }),
    ]);
    expect(picked[0].comment).toBe("Always");
  });

  test("the rest keep the order they were written in", () => {
    const picked = sampleBook([
      entry({ comment: "First" }), entry({ comment: "Second" }), entry({ comment: "Third" }),
    ]);
    expect(picked.map((e) => e.comment)).toEqual(["First", "Second", "Third"]);
  });

  test("switched-off entries are not the world", () => {
    const picked = sampleBook([entry({ comment: "Off", disable: true }), entry({ comment: "On" })]);
    expect(picked.map((e) => e.comment)).toEqual(["On"]);
  });

  test("empty entries are not entries", () => {
    expect(sampleBook([entry({ content: "   " }), entry({ content: "" })])).toHaveLength(0);
  });

  test("a huge book is cut to the budget rather than sent whole", () => {
    const big = Array.from({ length: 200 }, (_, i) =>
      entry({ comment: `E${i}`, content: "x".repeat(500) }));
    const picked = sampleBook(big);
    const cost = picked.reduce((n, e) => n + (e.content?.length ?? 0), 0);
    expect(picked.length).toBeLessThan(200);
    expect(cost).toBeLessThanOrEqual(SEED_BUDGET);
  });

  test("but one entry over budget still goes, or the book says nothing", () => {
    const picked = sampleBook([entry({ content: "y".repeat(SEED_BUDGET * 3) })]);
    expect(picked).toHaveLength(1);
  });
});

describe("the idea it writes", () => {
  test("names the setting and quotes what is written down", () => {
    const seed = seedFromBook("Greywater", [entry({ comment: "The mill", content: "It still turns." })]);
    expect(seed).toContain("Greywater");
    expect(seed).toContain("The mill: It still turns.");
  });

  test("tells the writer this is the place, not the plot", () => {
    const seed = seedFromBook("Greywater", [entry()]);
    expect(seed).toContain("not");
    expect(seed.toLowerCase()).toContain("plot");
  });

  test("an empty book asks for the world it implies rather than failing", () => {
    const seed = seedFromBook("Greywater", []);
    expect(seed).toContain("Greywater");
    expect(seed.toLowerCase()).toContain("empty");
  });

  test("an unnamed book is still describable", () => {
    expect(seedFromBook("", [entry()])).toContain("untitled");
  });
});

describe("whether it is worth asking at all", () => {
  test("a book with nothing live in it is not", () => {
    expect(bookIsUsable([])).toBe(false);
    expect(bookIsUsable([entry({ disable: true })])).toBe(false);
    expect(bookIsUsable([entry({ content: "" })])).toBe(false);
  });

  test("one real entry is enough", () => {
    expect(bookIsUsable([entry()])).toBe(true);
  });
});
