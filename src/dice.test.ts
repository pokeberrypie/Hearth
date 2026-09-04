/**
 * Dice.
 *
 *   bun test src/dice.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  DICE_BRIEF,
  MAX_DICE,
  describeRoll,
  parseDice,
  resolveRolls,
  rollDice,
  type Rng,
} from "./dice";

/** A die that always lands on its highest face. */
const maxRoll: Rng = () => 0.999999;
/** A die that always lands on 1. */
const minRoll: Rng = () => 0;
/** Deals the given fractions in order, then repeats. */
const dealer = (...values: number[]): Rng => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("reading notation", () => {
  test("the ordinary forms", () => {
    expect(parseDice("2d6")).toMatchObject({ count: 2, sides: 6, modifier: 0 });
    expect(parseDice("d20")).toMatchObject({ count: 1, sides: 20, modifier: 0 });
    expect(parseDice("4d6+2")).toMatchObject({ count: 4, sides: 6, modifier: 2 });
    expect(parseDice("1d8-1")).toMatchObject({ count: 1, sides: 8, modifier: -1 });
  });

  test("whitespace and capitals are not a problem", () => {
    expect(parseDice("  2 D 6 + 3 ")).toMatchObject({ count: 2, sides: 6, modifier: 3 });
  });

  test("tidies what it read, so the notation shown is canonical", () => {
    expect(parseDice("d20")!.notation).toBe("1d20");
    expect(parseDice("2 d 6 - 1")!.notation).toBe("2d6-1");
  });

  test("refuses what is not dice", () => {
    for (const bad of ["", "hello", "d", "2d", "6", "2d6+", "d0", "d1", "2x6", "[[2d6]]"]) {
      expect(parseDice(bad)).toBeNull();
    }
  });

  test("refuses a roll that is not a roll any more", () => {
    expect(parseDice(`${MAX_DICE + 1}d6`)).toBeNull();
    expect(parseDice("2d100000")).toBeNull();
    expect(parseDice("0d6")).toBeNull();
    // The one that would build an array big enough to stop a phone.
    expect(parseDice("999999d999999")).toBeNull();
  });
});

describe("rolling", () => {
  test("every die lands within its faces", () => {
    const roll = rollDice("5d6", dealer(0, 0.2, 0.5, 0.8, 0.999))!;
    expect(roll.rolls).toHaveLength(5);
    expect(Math.min(...roll.rolls)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...roll.rolls)).toBeLessThanOrEqual(6);
  });

  test("the extremes are reachable and not exceeded", () => {
    expect(rollDice("3d6", minRoll)!.total).toBe(3);
    expect(rollDice("3d6", maxRoll)!.total).toBe(18);
  });

  test("the modifier is added once, not per die", () => {
    expect(rollDice("3d6+2", maxRoll)!.total).toBe(20);
    expect(rollDice("3d6-2", maxRoll)!.total).toBe(16);
  });

  test("nonsense rolls nothing", () => {
    expect(rollDice("banana")).toBeNull();
  });
});

describe("saying what happened", () => {
  test("one plain die needs no arithmetic shown", () => {
    expect(describeRoll(rollDice("d20", maxRoll)!)).toBe("1d20: 20");
  });

  test("several dice show their working", () => {
    expect(describeRoll(rollDice("2d6", maxRoll)!)).toBe("2d6: 6, 6 = 12");
  });

  test("a modifier is shown separately from the dice", () => {
    expect(describeRoll(rollDice("2d6+3", maxRoll)!)).toBe("2d6+3: 6, 6 + 3 = 15");
    expect(describeRoll(rollDice("2d6-1", maxRoll)!)).toBe("2d6-1: 6, 6 - 1 = 11");
  });
});

describe("resolving what a model wrote", () => {
  test("fills the result in where it was asked for", () => {
    const out = resolveRolls("She swings. [[1d20+2]] The blade bites.", maxRoll);
    expect(out.text).toBe("She swings. [[1d20+2: 20 + 2 = 22]] The blade bites.");
    expect(out.rolls).toHaveLength(1);
  });

  test("several rolls in one reply, each its own", () => {
    const out = resolveRolls("[[1d6]] then [[1d6]]", dealer(0, 0.999));
    expect(out.rolls.map((r) => r.total)).toEqual([1, 6]);
  });

  test("brackets that are not dice are left exactly alone", () => {
    // Models bracket all sorts of things; eating them is worse than ignoring.
    const text = "[[OOC: are you still there?]] and [[a note]]";
    expect(resolveRolls(text, maxRoll).text).toBe(text);
  });

  test("an absurd roll is left as written rather than obeyed", () => {
    const text = "[[999999d999999]]";
    expect(resolveRolls(text, maxRoll).text).toBe(text);
  });

  test("text with no dice comes back untouched", () => {
    expect(resolveRolls("Nothing to roll here.", maxRoll).text).toBe("Nothing to roll here.");
  });

  test("an already-resolved roll is not rolled again", () => {
    // It has a colon and spaces in it, so it no longer parses as notation —
    // which is what stops a re-save or an edit from re-rolling history.
    const once = resolveRolls("[[2d6]]", maxRoll).text;
    expect(resolveRolls(once, minRoll).text).toBe(once);
  });

  test("the brief tells the model the one thing it needs", () => {
    expect(DICE_BRIEF).toContain("[[2d6]]");
    expect(DICE_BRIEF).toContain("Never write the outcome");
  });
});
