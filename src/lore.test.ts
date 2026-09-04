/**
 * Lorebook activation.
 *
 * These were written ad hoc while the engine was being built and are now a real
 * suite, because `lore.ts` is the piece most likely to regress without anyone
 * noticing: a book that silently stops firing looks exactly like a book that
 * had nothing to say.
 *
 *   bun test
 */

import { describe, expect, test } from "bun:test";
import { activate, normaliseBook, normaliseEntry, place, type LoreEntry } from "./lore";

/** A complete entry with sane defaults, so each test only states what it means. */
const mk = (raw: Record<string, unknown>): LoreEntry =>
  normaliseEntry({ content: "…", ...raw });

const said = (...lines: string[]) =>
  lines.map((content, i) => ({ role: i % 2 ? "assistant" : "user", content }));

// ---- reading SillyTavern books --------------------------------------------

describe("import", () => {
  test("takes SillyTavern's key and keysecondary arrays", () => {
    const e = normaliseEntry({ key: ["Ash", " Vale "], keysecondary: ["north"] });
    expect(e.keys).toEqual(["Ash", "Vale"]);
    expect(e.secondary).toEqual(["north"]);
  });

  test("splits a comma-separated key string", () => {
    expect(normaliseEntry({ key: "ash, vale ,north" }).keys).toEqual(["ash", "vale", "north"]);
  });

  test("maps all four selectiveLogic values", () => {
    const logic = (n: number) => normaliseEntry({ selectiveLogic: n }).logic;
    expect(logic(0)).toBe("and_any");
    expect(logic(1)).toBe("not_all");
    expect(logic(2)).toBe("not_any");
    expect(logic(3)).toBe("and_all");
  });

  test("maps the position enum, folding author's-note slots into at_depth", () => {
    const pos = (n: number) => normaliseEntry({ position: n }).position;
    expect(pos(0)).toBe("before_char");
    expect(pos(1)).toBe("after_char");
    expect(pos(2)).toBe("at_depth");
    expect(pos(3)).toBe("at_depth");
    expect(pos(4)).toBe("at_depth");
  });

  test("reads `disable` as the opposite of enabled", () => {
    expect(normaliseEntry({ disable: true }).enabled).toBe(false);
    expect(normaliseEntry({ disable: false }).enabled).toBe(true);
    expect(normaliseEntry({}).enabled).toBe(true);
  });

  test("fills in the defaults a hand-written book leaves out", () => {
    const e = normaliseEntry({});
    expect(e.order).toBe(100);
    expect(e.depth).toBe(4);
    expect(e.probability).toBe(100);
    expect(e.wholeWords).toBe(true);
    expect(e.position).toBe("after_char");
    expect(e.constant).toBe(false);
  });

  test("useProbability: false means the roll is ignored", () => {
    expect(normaliseEntry({ probability: 25, useProbability: false }).probability).toBe(100);
    expect(normaliseEntry({ probability: 25 }).probability).toBe(25);
  });

  test("a missing scanDepth stays null so the global setting wins", () => {
    expect(normaliseEntry({}).scanDepth).toBeNull();
    expect(normaliseEntry({ scanDepth: null }).scanDepth).toBeNull();
    expect(normaliseEntry({ scanDepth: 9 }).scanDepth).toBe(9);
  });

  test("carries the recursion flags across", () => {
    const e = normaliseEntry({ excludeRecursion: true, preventRecursion: true });
    expect(e.excludeRecursion).toBe(true);
    expect(e.preventRecursion).toBe(true);
  });

  test("accepts a book as an array, as { entries: [] }, or as ST's keyed object", () => {
    expect(normaliseBook([{ key: "a" }, { key: "b" }])).toHaveLength(2);
    expect(normaliseBook({ entries: [{ key: "a" }] })).toHaveLength(1);
    expect(normaliseBook({ entries: { "0": { key: "a" }, "1": { key: "b" } } })).toHaveLength(2);
    expect(normaliseBook(null)).toHaveLength(0);
  });
});

// ---- what fires ------------------------------------------------------------

describe("activation", () => {
  test("a constant entry fires with no keyword anywhere", () => {
    const got = activate([mk({ constant: true, key: ["never-said"] })], said("hello"));
    expect(got).toHaveLength(1);
    expect(got[0].via).toBe("constant");
  });

  test("a keyword in the transcript fires its entry", () => {
    const got = activate([mk({ key: ["ashvale"] })], said("we rode for Ashvale at dawn"));
    expect(got).toHaveLength(1);
    expect(got[0].via).toBe("keyword");
  });

  test("no keyword, no entry", () => {
    expect(activate([mk({ key: ["ashvale"] })], said("we rode north"))).toHaveLength(0);
  });

  test("a disabled entry never fires, constant or not", () => {
    expect(activate([mk({ key: ["ash"], disable: true })], said("ash"))).toHaveLength(0);
    expect(activate([mk({ constant: true, disable: true })], said("x"))).toHaveLength(0);
  });

  test("an entry with nothing to say never fires", () => {
    expect(activate([mk({ constant: true, content: "   " })], said("x"))).toHaveLength(0);
  });

  test("caseSensitive means what it says", () => {
    const e = mk({ key: ["Ash"], caseSensitive: true });
    expect(activate([e], said("ash"))).toHaveLength(0);
    expect(activate([e], said("Ash"))).toHaveLength(1);
  });

  test("whole-word matching does not fire inside a longer word", () => {
    const e = mk({ key: ["cat"] });
    expect(activate([e], said("a concatenated mess"))).toHaveLength(0);
    expect(activate([e], said("the cat sat"))).toHaveLength(1);
  });

  test("wholeWords off matches a fragment", () => {
    expect(activate([mk({ key: ["cat"], wholeWords: false })], said("concatenated"))).toHaveLength(1);
  });

  // Deliberate: \b would never match a key that does not begin and end on a
  // word character, so keys like ":3" fall back to a plain substring search.
  test("non-word keys skip whole-word matching rather than never matching", () => {
    expect(activate([mk({ key: [":3"] })], said("she grinned :3"))).toHaveLength(1);
    expect(activate([mk({ key: ["don't"] })], said("I don't think so"))).toHaveLength(1);
  });

  test("a key with regex punctuation is matched literally", () => {
    expect(activate([mk({ key: ["c++"] })], said("written in c++"))).toHaveLength(1);
    expect(activate([mk({ key: ["a.c"] })], said("abc"))).toHaveLength(0);
  });
});

// ---- secondary keys --------------------------------------------------------

describe("secondary key logic", () => {
  const with_ = (logic: string) =>
    mk({ key: ["duke"], keysecondary: ["cruel", "kind"], logic });

  test("and_any needs one of the secondaries", () => {
    expect(activate([with_("and_any")], said("the duke was cruel"))).toHaveLength(1);
    expect(activate([with_("and_any")], said("the duke was tall"))).toHaveLength(0);
  });

  test("and_all needs every secondary", () => {
    expect(activate([with_("and_all")], said("the duke was cruel and kind"))).toHaveLength(1);
    expect(activate([with_("and_all")], said("the duke was cruel"))).toHaveLength(0);
  });

  test("not_any needs none of the secondaries", () => {
    expect(activate([with_("not_any")], said("the duke was tall"))).toHaveLength(1);
    expect(activate([with_("not_any")], said("the duke was cruel"))).toHaveLength(0);
  });

  test("not_all fires unless every secondary is present", () => {
    expect(activate([with_("not_all")], said("the duke was cruel"))).toHaveLength(1);
    expect(activate([with_("not_all")], said("the duke was cruel and kind"))).toHaveLength(0);
  });

  test("the primary key still has to hit", () => {
    expect(activate([with_("and_any")], said("she was cruel"))).toHaveLength(0);
  });
});

// ---- probability, depth, budget -------------------------------------------

describe("probability", () => {
  test("the roll decides, and 100 never rolls", () => {
    const at = (probability: number) =>
      activate([mk({ constant: true, probability })], said("x"), { roll: () => 50 });
    expect(at(100)).toHaveLength(1);
    expect(at(60)).toHaveLength(1);   // 50 < 60
    expect(at(40)).toHaveLength(0);   // 50 >= 40
    expect(at(0)).toHaveLength(0);
  });
});

describe("scan depth", () => {
  const history = said("ashvale", "b", "c", "d", "e");

  test("only the last N messages are searched", () => {
    expect(activate([mk({ key: ["ashvale"] })], history, { scanDepth: 2 })).toHaveLength(0);
    expect(activate([mk({ key: ["ashvale"] })], history, { scanDepth: 5 })).toHaveLength(1);
  });

  test("an entry's own scanDepth overrides the global one", () => {
    const e = mk({ key: ["ashvale"], scanDepth: 5 });
    expect(activate([e], history, { scanDepth: 1 })).toHaveLength(1);
  });
});

describe("budget", () => {
  test("an entry that does not fit is skipped, and smaller ones still get in", () => {
    const big = mk({ id: "big", constant: true, order: 1, content: "x".repeat(50) });
    const small = mk({ id: "small", constant: true, order: 2, content: "y".repeat(5) });
    const got = activate([big, small], said("x"), { maxChars: 10 });
    expect(got.map((a) => a.entry.id)).toEqual(["small"]);
  });

  test("the budget is spent, not reset per entry", () => {
    const a = mk({ id: "a", constant: true, order: 1, content: "x".repeat(8) });
    const b = mk({ id: "b", constant: true, order: 2, content: "y".repeat(8) });
    expect(activate([a, b], said("x"), { maxChars: 10 }).map((e) => e.entry.id)).toEqual(["a"]);
  });
});

// ---- recursion -------------------------------------------------------------

describe("recursion", () => {
  const seed = mk({ id: "seed", constant: true, content: "The Duke rules Ashvale." });
  const duke = mk({ id: "duke", key: ["Duke"], content: "He is cruel." });

  test("an activated entry's content can trigger another", () => {
    const got = activate([seed, duke], said("nothing relevant here"));
    expect(got.map((a) => a.entry.id).sort()).toEqual(["duke", "seed"]);
    expect(got.find((a) => a.entry.id === "duke")!.via).toBe("recursion");
  });

  test("preventRecursion stops an entry's content seeding others", () => {
    const quiet = mk({ id: "seed", constant: true, preventRecursion: true, content: "The Duke rules." });
    expect(activate([quiet, duke], said("nothing relevant")).map((a) => a.entry.id)).toEqual(["seed"]);
  });

  test("excludeRecursion stops an entry being triggered by another", () => {
    const deaf = mk({ id: "duke", key: ["Duke"], excludeRecursion: true, content: "He is cruel." });
    expect(activate([seed, deaf], said("nothing relevant")).map((a) => a.entry.id)).toEqual(["seed"]);
  });

  test("excludeRecursion still allows a plain keyword hit from the transcript", () => {
    const deaf = mk({ id: "duke", key: ["Duke"], excludeRecursion: true, content: "He is cruel." });
    expect(activate([deaf], said("the Duke sent word")).map((a) => a.via)).toEqual(["keyword"]);
  });

  test("a chain settles instead of looping forever", () => {
    const one = mk({ id: "1", constant: true, content: "mentions two" });
    const two = mk({ id: "2", key: ["two"], content: "mentions three" });
    const three = mk({ id: "3", key: ["three"], content: "mentions one" });
    const got = activate([one, two, three], said("-"));
    expect(got).toHaveLength(3);
  });
});

// ---- ordering and placement ------------------------------------------------

describe("placement", () => {
  test("entries come back in insertion order, lowest first", () => {
    const got = activate(
      [
        mk({ id: "late", constant: true, order: 200 }),
        mk({ id: "early", constant: true, order: 50 }),
        mk({ id: "middle", constant: true, order: 100 }),
      ],
      said("x"),
    );
    expect(got.map((a) => a.entry.id)).toEqual(["early", "middle", "late"]);
  });

  test("place() groups by where each entry wants to sit", () => {
    const got = place(
      activate(
        [
          mk({ id: "b", constant: true, position: 0, content: "before" }),
          mk({ id: "a", constant: true, position: 1, content: "after" }),
          mk({ id: "d", constant: true, position: 4, depth: 3, content: "deep" }),
        ],
        said("x"),
      ),
    );
    expect(got.beforeChar).toBe("before");
    expect(got.afterChar).toBe("after");
    expect(got.atDepth).toEqual([{ depth: 3, content: "deep" }]);
  });

  test("several entries in one slot are joined, not overwritten", () => {
    const got = place(
      activate(
        [
          mk({ id: "1", constant: true, order: 1, position: 1, content: "first" }),
          mk({ id: "2", constant: true, order: 2, position: 1, content: "second" }),
        ],
        said("x"),
      ),
    );
    expect(got.afterChar).toBe("first\n\nsecond");
  });
});
