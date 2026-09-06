/**
 * Classes and races people write themselves.
 *
 * The thing worth testing is what happens to a file somebody hand-wrote, or
 * exported from something else, or half-filled and saved. A sheet has to add
 * up whatever arrives, so nothing here rejects: it clamps. These check that
 * the clamps are where a game stops working rather than where a purist would
 * put them.
 */

import { describe, expect, test } from "bun:test";

import { applyRace, looksWritten, normaliseKit, raceForPrompt, slug } from "./kits";

const abilities = { str: 12, dex: 12, con: 12, int: 12, wis: 12, cha: 12 };

describe("reading one in", () => {
  test("keeps what somebody wrote", () => {
    const k = normaliseKit({
      kind: "class", name: "Warden", blurb: "Holds the line.",
      hitDie: 12, primary: ["str", "wis"], skills: ["Survival"], kit: ["A spear"],
    });
    expect(k).toMatchObject({
      id: "warden", kind: "class", name: "Warden", hitDie: 12,
      primary: ["str", "wis"], skills: ["Survival"], kit: ["A spear"],
    });
  });

  test("an id comes from the name when there is not one", () => {
    expect(normaliseKit({ name: "The Hollow Kind" }).id).toBe("the-hollow-kind");
    expect(slug("  ")).toBe("unnamed");
  });

  test("a hit die that is not a die becomes one", () => {
    for (const bad of [200, 7, 0, -4, "big", null, undefined]) {
      expect([6, 8, 10, 12]).toContain(normaliseKit({ hitDie: bad }).hitDie);
    }
  });

  test("only real abilities survive, and only two of them", () => {
    // Three primaries means the third never gets a good score, which reads as
    // the roller being broken rather than the class being written oddly.
    const k = normaliseKit({ primary: ["str", "dex", "con", "banana", "STR"] });
    expect(k.primary).toEqual(["str", "dex"]);
  });

  test("a race handing out +6 is a different game, so it is clamped", () => {
    const k = normaliseKit({ kind: "race", bonus: { str: 6, dex: -9, con: 2, int: 0 } });
    expect(k.bonus).toEqual({ str: 3, dex: -2, con: 2 });
  });

  test("lists are accepted as lists or as something somebody typed", () => {
    expect(normaliseKit({ skills: "Stealth, Perception" }).skills)
      .toEqual(["Stealth", "Perception"]);
    expect(normaliseKit({ kit: "A rope\nA lantern" }).kit).toEqual(["A rope", "A lantern"]);
  });

  test("nothing at all still produces something openable", () => {
    for (const junk of [null, undefined, 42, "x", { name: "" }]) {
      const k = normaliseKit(junk);
      expect(k.name.length).toBeGreaterThan(0);
      expect(k.id.length).toBeGreaterThan(0);
    }
  });
});

describe("whether it is worth saving", () => {
  test("an empty form is not", () => {
    expect(looksWritten(normaliseKit({ kind: "class", name: "Warden" }))).toBe(false);
    expect(looksWritten(normaliseKit({ kind: "race", name: "Tiefling" }))).toBe(false);
  });

  test("but anything actually written is", () => {
    expect(looksWritten(normaliseKit({ kind: "class", name: "W", skills: ["Athletics"] }))).toBe(true);
    expect(looksWritten(normaliseKit({ kind: "race", name: "T", bonus: { cha: 2 } }))).toBe(true);
    expect(looksWritten(normaliseKit({ kind: "race", name: "T", traits: ["They do not sleep."] }))).toBe(true);
  });
});

describe("what a race does to a sheet", () => {
  test("adds its bonuses", () => {
    const race = normaliseKit({ kind: "race", name: "Dwarf", bonus: { con: 2, str: 1 } });
    expect(applyRace(abilities, race)).toMatchObject({ con: 14, str: 13, dex: 12 });
  });

  test("never past 20, and never below 1", () => {
    // A number that can exceed the die testing it has stopped meaning anything.
    const up = normaliseKit({ kind: "race", name: "X", bonus: { str: 3 } });
    expect(applyRace({ ...abilities, str: 19 }, up).str).toBe(20);
    const down = normaliseKit({ kind: "race", name: "Y", bonus: { cha: -2 } });
    expect(applyRace({ ...abilities, cha: 1 }, down).cha).toBe(1);
  });

  test("a class is not a race and changes nothing", () => {
    const klass = normaliseKit({ kind: "class", name: "Fighter", primary: ["str"] });
    expect(applyRace(abilities, klass)).toEqual(abilities);
    expect(applyRace(abilities, null)).toEqual(abilities);
  });

  test("and it does not mutate what it was given", () => {
    const race = normaliseKit({ kind: "race", name: "Dwarf", bonus: { con: 2 } });
    const before = { ...abilities };
    applyRace(abilities, race);
    expect(abilities).toEqual(before);
  });
});

describe("what the narrator is told", () => {
  test("the traits, which it could not get from the numbers", () => {
    const race = normaliseKit({
      kind: "race", name: "the Hollow", traits: ["They do not sleep.", "Iron burns them."],
    });
    const text = raceForPrompt(race);
    expect(text).toContain("the Hollow");
    expect(text).toContain("They do not sleep.");
    expect(text).toContain("Iron burns them.");
  });

  test("and nothing at all when there is nothing to say", () => {
    expect(raceForPrompt(null)).toBe("");
    expect(raceForPrompt(normaliseKit({ kind: "race", name: "Human" }))).toBe("");
    expect(raceForPrompt(normaliseKit({ kind: "class", name: "Fighter" }))).toBe("");
  });
});
