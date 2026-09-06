/**
 * How hard the table is.
 *
 * The reason this is tested at all: a difficulty setting that only changes an
 * adjective in the prompt is a setting that does nothing, and there is no way
 * to tell from the outside. So what is checked here is that the three levels
 * actually differ in the things that decide a game — the number a roll has to
 * beat, and what a failure costs — and that an unknown value lands somewhere
 * sensible rather than sending no rules at all.
 */

import { describe, expect, test } from "bun:test";

import { DEFAULT_DIFFICULTY, LEVELS, difficultyForPrompt, levelOf } from "./difficulty";

describe("the levels", () => {
  test("get harder in the one way that is measurable", () => {
    const dcs = LEVELS.map((l) => l.dc);
    expect(dcs).toEqual([...dcs].sort((a, b) => a - b));
    expect(new Set(dcs).size).toBe(dcs.length);
  });

  test("each says its own number out loud, so the narrator can apply it twice", () => {
    for (const l of LEVELS) expect(l.brief).toContain(String(l.dc));
  });

  test("each says what a failed roll costs", () => {
    // The half that is actually felt. A table where 12 becomes 14 and nothing
    // else changes is not a harder table, it is a slower one.
    for (const l of LEVELS) expect(l.brief.toLowerCase()).toContain("fail");
  });

  test("and none of them tells the narrator how to feel about it", () => {
    // Difficulty decides what the dice may take, not what the story is like.
    for (const l of LEVELS) {
      expect(l.brief.toLowerCase()).not.toContain("grimdark");
      expect(l.brief.toLowerCase()).not.toContain("lighthearted");
    }
  });
});

describe("choosing one", () => {
  test("a known id gives that level", () => {
    expect(levelOf("hardwinter").id).toBe("hardwinter");
  });

  test("anything else falls back rather than failing", () => {
    for (const bad of ["", null, undefined, "impossible", 7]) {
      expect(levelOf(bad as any).id).toBe(DEFAULT_DIFFICULTY);
    }
  });

  test("the prompt block always names a level and a number", () => {
    for (const l of LEVELS) {
      const text = difficultyForPrompt(l.id);
      expect(text).toContain(l.name);
      expect(text).toContain(String(l.dc));
    }
    // Including for nonsense, which must not produce an empty rulebook.
    expect(difficultyForPrompt("nonsense")).toContain(levelOf("nonsense").name);
  });
});
