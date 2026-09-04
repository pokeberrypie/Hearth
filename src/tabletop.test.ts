/**
 * Tabletop mode: sheets and the rules for making one.
 *
 *   bun test src/tabletop.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  ABILITIES,
  CLASSES,
  abilityCheck,
  assignArray,
  classById,
  describeCheck,
  makeSheet,
  modifier,
  normaliseSheet,
  rollAbilities,
  rollAbilityScore,
  sheetForPrompt,
  signed,
  startingHp,
  STANDARD_ARRAY,
  abilityAsked,
  resolveChecks,
  CHECK_BRIEF,
} from "./tabletop";
import type { Rng } from "./dice";

const max: Rng = () => 0.999999;
const min: Rng = () => 0;
const dealer = (...v: number[]): Rng => { let i = 0; return () => v[i++ % v.length]; };

describe("the numbers", () => {
  test("a modifier is the usual curve", () => {
    expect(modifier(10)).toBe(0);
    expect(modifier(11)).toBe(0);
    expect(modifier(12)).toBe(1);
    expect(modifier(8)).toBe(-1);
    expect(modifier(18)).toBe(4);
    expect(modifier(3)).toBe(-4);
  });

  test("modifiers are always written with their sign", () => {
    expect(signed(2)).toBe("+2");
    expect(signed(0)).toBe("+0");
    expect(signed(-1)).toBe("-1");
  });
});

describe("rolling a score", () => {
  test("four dice, drop the lowest, so the floor is 3 and the ceiling 18", () => {
    expect(rollAbilityScore(min)).toBe(3);
    expect(rollAbilityScore(max)).toBe(18);
  });

  test("the lowest of the four is the one dropped", () => {
    // 1, 2, 3, 4 -> drop the 1 -> 9
    expect(rollAbilityScore(dealer(0, 1 / 6, 2 / 6, 3 / 6))).toBe(9);
  });

  test("every score it can produce is in range, over many tries", () => {
    for (let i = 0; i < 400; i++) {
      const n = rollAbilityScore();
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(18);
    }
  });
});

describe("making a sheet", () => {
  const fighter = classById("fighter")!;

  test("the two best rolls land where the class wants them", () => {
    const abilities = rollAbilities(fighter, max);
    // Everything is 18 here, so instead check the assignment is total.
    for (const a of ABILITIES) expect(abilities[a]).toBe(18);
  });

  test("the class's own abilities get the best of an uneven set", () => {
    const scores = assignArray(fighter);
    expect(scores.str).toBe(STANDARD_ARRAY[0]);
    expect(scores.con).toBe(STANDARD_ARRAY[1]);
    // And nothing is left undealt.
    const dealt = ABILITIES.map((a) => scores[a]).sort((a, b) => b - a);
    expect(dealt).toEqual([...STANDARD_ARRAY].sort((a, b) => b - a));
  });

  test("every class assigns all six and repeats none", () => {
    for (const klass of CLASSES) {
      const scores = assignArray(klass);
      const dealt = ABILITIES.map((a) => scores[a]).sort((a, b) => b - a);
      expect(dealt).toEqual([...STANDARD_ARRAY].sort((a, b) => b - a));
      expect(scores[klass.primary[0]]).toBe(STANDARD_ARRAY[0]);
      expect(scores[klass.primary[1]]).toBe(STANDARD_ARRAY[1]);
    }
  });

  test("health comes from the class and the constitution", () => {
    expect(startingHp(fighter, { ...assignArray(fighter), con: 14 })).toBe(12);
    // A terrible constitution never takes anyone below one.
    expect(startingHp(classById("scholar")!, { ...assignArray(fighter), con: 1 })).toBe(1);
  });

  test("a made sheet starts whole and equipped", () => {
    const sheet = makeSheet("scout", "array")!;
    expect(sheet.level).toBe(1);
    expect(sheet.hp).toBe(sheet.maxHp);
    expect(sheet.skills.length).toBeGreaterThan(0);
    expect(sheet.inventory.length).toBeGreaterThan(0);
  });

  test("a bad set is a character, not a mistake — nothing is re-rolled", () => {
    const sheet = makeSheet("fighter", "roll", min)!;
    for (const a of ABILITIES) expect(sheet.abilities[a]).toBe(3);
    // A fighter's d10 less the -4 a constitution of 3 costs. Grim, playable.
    expect(sheet.maxHp).toBe(6);
  });

  test("an unknown class makes nothing", () => {
    expect(makeSheet("bard-of-the-nine-realms")).toBeNull();
  });
});

describe("reading a stored sheet back", () => {
  test("fills in what is missing rather than refusing", () => {
    const s = normaliseSheet({ klass: "rogue" })!;
    expect(s.level).toBe(1);
    for (const a of ABILITIES) expect(s.abilities[a]).toBe(10);
    expect(s.hp).toBe(s.maxHp);
  });

  test("keeps damage, because a character at 0 is down and not gone", () => {
    const s = normaliseSheet({ klass: "fighter", maxHp: 12, hp: 0 })!;
    expect(s.hp).toBe(0);
    expect(s.maxHp).toBe(12);
  });

  test("refuses impossible numbers instead of storing them", () => {
    const s = normaliseSheet({ klass: "fighter", level: 999, maxHp: 10, hp: 9999, abilities: { str: 9999 } })!;
    expect(s.level).toBe(20);
    expect(s.hp).toBe(10);
    expect(s.abilities.str).toBe(30);
  });

  test("nonsense is not a sheet", () => {
    expect(normaliseSheet(null)).toBeNull();
    expect(normaliseSheet("fighter")).toBeNull();
  });
});

describe("what the narrator is told", () => {
  test("names the class, the health and every modifier", () => {
    const sheet = makeSheet("fighter", "array")!;
    const text = sheetForPrompt("Bragi", sheet);
    expect(text).toContain("Bragi");
    expect(text).toContain("Fighter");
    expect(text).toMatch(/\d+\/\d+ hp/);
    for (const a of ABILITIES) expect(text).toContain(a.toUpperCase());
    expect(text).toContain("Carrying:");
  });

  test("stays compact — it goes into every prompt of the game", () => {
    const sheet = makeSheet("scholar", "array")!;
    expect(sheetForPrompt("Wren", sheet).length).toBeLessThan(400);
  });
});

describe("checks", () => {
  test("a d20 plus what the sheet says, not what the model remembers", () => {
    const sheet = makeSheet("fighter", "array")!;   // str 15 -> +2
    const check = abilityCheck(sheet, "str", max);
    expect(check.die).toBe(20);
    expect(check.modifier).toBe(2);
    expect(check.total).toBe(22);
  });

  test("a bad ability subtracts", () => {
    const sheet = normaliseSheet({ klass: "fighter", abilities: { str: 6 } })!;
    const check = abilityCheck(sheet, "str", min);
    expect(check.die).toBe(1);
    expect(check.modifier).toBe(-2);
    expect(check.total).toBe(-1);
  });

  test("reads as a sentence", () => {
    const sheet = makeSheet("scout", "array")!;
    expect(describeCheck(abilityCheck(sheet, "dex", max))).toMatch(/^Dexterity check: 20 \+\d+ = \d+$/);
  });
});

describe("a narrator asking for a check", () => {
  const sheet = normaliseSheet({ klass: "scout", abilities: { dex: 18, str: 6 } })!;

  test("both ways a model writes it", () => {
    expect(resolveChecks("[[check: dex]]", sheet, max).text).toBe("[[Dexterity check: 20 +4 = 24]]");
    expect(resolveChecks("[[dex check]]", sheet, max).text).toBe("[[Dexterity check: 20 +4 = 24]]");
  });

  test("long names and near-synonyms", () => {
    expect(resolveChecks("[[check: strength]]", sheet, min).text).toContain("Strength check: 1 -2");
    expect(resolveChecks("[[check: agility]]", sheet, max).text).toContain("Dexterity");
  });

  test("the modifier comes from the sheet, not the story", () => {
    // dex 18 is +4, str 6 is -2. A narrator guessing would not produce this.
    expect(resolveChecks("[[check: dex]]", sheet, min).checks[0].modifier).toBe(4);
    expect(resolveChecks("[[check: str]]", sheet, min).checks[0].modifier).toBe(-2);
  });

  test("something that is not an ability is left alone", () => {
    const text = "[[check: vibes]]";
    expect(resolveChecks(text, sheet, max).text).toBe(text);
  });

  test("with no sheet, nothing is rolled and nothing is mangled", () => {
    const text = "[[check: dex]]";
    const out = resolveChecks(text, null, max);
    expect(out.text).toBe(text);
    expect(out.checks).toHaveLength(0);
  });

  test("a resolved check is not rolled again", () => {
    const once = resolveChecks("[[check: dex]]", sheet, max).text;
    expect(resolveChecks(once, sheet, min).text).toBe(once);
  });

  test("the brief names the notation and points at the sheet", () => {
    expect(CHECK_BRIEF).toContain("[[check: dex]]");
    expect(CHECK_BRIEF).toMatch(/sheet/i);
  });
});

describe("what the narrator just asked you to roll", () => {
  test("by name", () => {
    expect(abilityAsked("Make a dexterity check.")).toBe("dex");
    expect(abilityAsked("Give me a CHA check, my lady.")).toBe("cha");
  });

  test("by asking for the thing rather than the stat", () => {
    // "See if you can get past them quietly" is a dexterity check that never
    // says the word, which is how a narrator actually writes.
    expect(abilityAsked("Roll stealth.")).toBe("dex");
    expect(abilityAsked("This will take some persuasion.")).toBe("cha");
    expect(abilityAsked("An athletics roll, then.")).toBe("str");
    expect(abilityAsked("Try sleight of hand, if you want it unnoticed.")).toBe("dex");
  });

  test("a bare skill with no ask around it is missed, and that is the trade", () => {
    // "Sleight of hand, if you want it unnoticed." is plainly an ask to a
    // human and is not caught, because the rule loose enough to catch it is
    // the rule that turns a preset's Knowledge heading into an Intelligence
    // check. A missed ask falls back to a plain d20; a wrong one rolls the
    // wrong ability and says so with total confidence.
    expect(abilityAsked("Sleight of hand, if you want it unnoticed.")).toBeNull();
  });

  test("the last thing asked for is the thing asked for", () => {
    const text = "You are strong enough to force it, but the lock is delicate. Roll sleight of hand.";
    expect(abilityAsked(text)).toBe("dex");
  });

  test("a word inside another word is not an ask", () => {
    // "int" living inside "into" would make every doorway a puzzle.
    expect(abilityAsked("You walk into the room and consider the strongbox.")).toBeNull();
  });

  test("nothing asked for is a real answer", () => {
    expect(abilityAsked("The fire pops. Marla says nothing.")).toBeNull();
    expect(abilityAsked("")).toBeNull();
    expect(abilityAsked(null as any)).toBeNull();
  });
});

describe("an ability that is merely mentioned is not an ask", () => {
  test("prose that happens to name one", () => {
    expect(abilityAsked("You are strong. The strongbox is not.")).toBeNull();
    expect(abilityAsked("Her perception of you has changed.")).toBeNull();
  });

  test("a preset's own filing does not become a roll", () => {
    // This is the real one: DEUS EX MACHINA files its planning under headings
    // like these, and the first live roll came back as an Intelligence check
    // because of it.
    const plan = [
      "- Knowledge: Village inn setting, barkeep NPC needed",
      "- @Anti-Character Omniscience: reacts only to what they see",
      "- Investigation: the mill as mystery hook",
    ].join("\n");
    expect(abilityAsked(plan)).toBeNull();
  });

  test("but a real ask inside a noisy reply still lands", () => {
    const reply = [
      "- Knowledge: Village inn setting, barkeep NPC needed",
      "<prose>She watches your hands. Give me a sleight of hand check.</prose>",
    ].join("\n");
    expect(abilityAsked(reply)).toBe("dex");
  });
});
