/**
 * Fights: who is in one, in what order, and how much of them is left.
 *
 *   bun test src/fight.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  FIGHT_BRIEF,
  MAX_FOES,
  describeInitiative,
  fightForPrompt,
  findCombatant,
  foesDown,
  hurt,
  normaliseFight,
  parseFoe,
  startFight,
  takeTurn,
  type Fight,
} from "./fight";
import type { Rng } from "./dice";

const max: Rng = () => 0.999999;
const min: Rng = () => 0;

const player = { name: "Iva Grant", hp: 8, maxHp: 8, initiativeBonus: 3 };

describe("reading what the party is up against", () => {
  test("a plain one", () => {
    expect(parseFoe("a wolf")).toEqual({ name: "Wolf", count: 1, hp: null });
  });

  test("a number, in digits or in words", () => {
    expect(parseFoe("3 bandits")).toMatchObject({ name: "Bandit", count: 3 });
    expect(parseFoe("two wolves")).toMatchObject({ name: "Wolf", count: 2 });
    expect(parseFoe("wolf x4")).toMatchObject({ name: "Wolf", count: 4 });
  });

  test("only the last word loses its plural", () => {
    expect(parseFoe("four bandit captains")).toMatchObject({ name: "Bandit Captain", count: 4 });
  });

  test("the plurals a narrator actually writes", () => {
    expect(parseFoe("two harpies")?.name).toBe("Harpy");
    expect(parseFoe("three torches")?.name).toBe("Torch");
    expect(parseFoe("two wolves")?.name).toBe("Wolf");
  });

  test("hit points, when the narrator has an opinion", () => {
    expect(parseFoe("Bandit Captain 16hp")).toEqual({ name: "Bandit Captain", count: 1, hp: 16 });
    expect(parseFoe("ogre with 30 health")).toEqual({ name: "Ogre", count: 1, hp: 30 });
  });

  test("nothing is not a foe", () => {
    expect(parseFoe("")).toBeNull();
    expect(parseFoe("   ")).toBeNull();
    expect(parseFoe("three")).toBeNull();
  });
});

describe("starting one", () => {
  test("everyone is in it, numbered only when there are several", () => {
    const fight = startFight("two wolves, a bandit captain", player, max)!;
    expect(fight.order.map((c) => c.name).sort()).toEqual(
      ["Bandit Captain", "Iva Grant", "Wolf 1", "Wolf 2"],
    );
  });

  test("the order is by initiative, highest first", () => {
    const fight = startFight("three bandits", player)!;
    const rolls = fight.order.map((c) => c.initiative);
    expect([...rolls].sort((a, b) => b - a)).toEqual(rolls);
  });

  test("the player rolls with the dexterity their sheet says", () => {
    // A 20 plus a +3 from the sheet. A narrator guessing would not produce 23.
    const fight = startFight("a wolf", player, max)!;
    expect(fight.order.find((c) => c.player)!.initiative).toBe(23);
  });

  test("the player arrives with the damage they already had", () => {
    const fight = startFight("a wolf", { ...player, hp: 3 }, max)!;
    expect(fight.order.find((c) => c.player)).toMatchObject({ hp: 3, maxHp: 8 });
  });

  test("with no sheet it is still a fight, just without you in it", () => {
    const fight = startFight("two wolves", null, max)!;
    expect(fight.order).toHaveLength(2);
    expect(fight.order.some((c) => c.player)).toBe(false);
  });

  test("hit points are rolled, so two wolves are not the same wolf", () => {
    expect(startFight("a wolf", null, min)!.order[0].maxHp).toBe(4);    // 2d6+2, floored
    expect(startFight("a wolf", null, max)!.order[0].maxHp).toBe(14);   // and ceilinged
  });

  test("a stated number of hit points is used instead of a rolled one", () => {
    expect(startFight("Ogre 30hp", null, max)!.order[0].maxHp).toBe(30);
  });

  test("an army is capped rather than refused", () => {
    expect(startFight("40 goblins", null, max)!.order.length).toBeLessThanOrEqual(MAX_FOES);
  });

  test("a fight against nothing is not a fight", () => {
    expect(startFight("", player)).toBeNull();
    expect(startFight("   ", player)).toBeNull();
  });

  test("and is written down as an order anyone can read", () => {
    const fight = startFight("a wolf", player, max)!;
    expect(describeInitiative(fight)).toMatch(/^Iva Grant 23, Wolf \d+$/);
  });
});

describe("finding who the narrator meant", () => {
  const fight = startFight("two wolves", player, max)!;

  test("by their exact name", () => {
    expect(findCombatant(fight, "Wolf 2")?.name).toBe("Wolf 2");
  });

  test("by what it will actually write", () => {
    // It numbers them carefully on the way in and says "the wolf" ever after.
    expect(findCombatant(fight, "the wolf")?.name).toBe("Wolf 1");
    expect(findCombatant(fight, "wolf")?.name).toBe("Wolf 1");
  });

  test("case is not a distinction", () => {
    expect(findCombatant(fight, "iva grant")?.player).toBe(true);
  });

  test("somebody who is not in the fight is nobody", () => {
    expect(findCombatant(fight, "Melda")).toBeNull();
    expect(findCombatant(fight, "")).toBeNull();
  });
});

describe("damage", () => {
  const scratch = () => startFight("two wolves 10hp", player, max)!;

  test("comes off, and healing goes back on", () => {
    const fight = scratch();
    expect(hurt(fight, "Wolf 1", 4)!.hp).toBe(6);
    expect(hurt(fight, "Wolf 1", -2)!.hp).toBe(8);
  });

  test("never past nothing, and never past full", () => {
    const fight = scratch();
    expect(hurt(fight, "Wolf 1", 999)!.hp).toBe(0);
    expect(hurt(fight, "Wolf 1", -999)!.hp).toBe(10);
  });

  test("a bare name goes to the first one still standing", () => {
    const fight = scratch();
    hurt(fight, "wolf", 999);                       // Wolf 1 goes down
    expect(hurt(fight, "wolf", 3)!.name).toBe("Wolf 2");
  });

  test("nobody by that name is not silently somebody else", () => {
    expect(hurt(scratch(), "Dragon", 5)).toBeNull();
  });
});

describe("whose turn it is", () => {
  test("starts with whoever rolled highest, and needs no telling", () => {
    const fight = startFight("two wolves", player, max)!;
    expect(fight.turn).toBe(0);
    expect(fight.order[0].initiative).toBe(Math.max(...fight.order.map((c) => c.initiative)));
  });

  test("moves to whoever the narrator names", () => {
    const fight = startFight("two wolves", player, max)!;
    expect(takeTurn(fight, "Wolf 2")!.name).toBe("Wolf 2");
    expect(fight.order[fight.turn].name).toBe("Wolf 2");
  });

  test("by the name it will actually write", () => {
    const fight = startFight("two wolves", player, max)!;
    expect(takeTurn(fight, "the wolf")!.name).toBe("Wolf 1");
  });

  test("a name nobody has leaves the marker where it was", () => {
    const fight = startFight("two wolves", player, max)!;
    const was = fight.turn;
    expect(takeTurn(fight, "Gandalf")).toBeNull();
    expect(fight.turn).toBe(was);
  });

  test("the narrator is told whose it is, since prose loses that first", () => {
    const fight = startFight("two wolves", player, max)!;
    takeTurn(fight, "Wolf 2");
    const text = fightForPrompt(fight);
    expect(text).toMatch(/Wolf 2 — .*<- up now/);
    expect(text.match(/up now/g)).toHaveLength(1);
  });

  test("a stored turn survives, and a silly one is clamped", () => {
    const fight = startFight("two wolves", player, max)!;
    fight.turn = 2;
    expect(normaliseFight(JSON.parse(JSON.stringify(fight)))!.turn).toBe(2);
    expect(normaliseFight({ ...fight, turn: 99 })!.turn).toBe(fight.order.length - 1);
    expect(normaliseFight({ ...fight, turn: -3 })!.turn).toBe(0);
  });

  test("the brief teaches the marker as well as the damage", () => {
    expect(FIGHT_BRIEF).toContain("[[turn:");
  });
});

describe("when it is over", () => {
  test("not while anything is still up", () => {
    const fight = startFight("two wolves 10hp", player, max)!;
    hurt(fight, "Wolf 1", 999);
    expect(foesDown(fight)).toBe(false);
  });

  test("and yes once nothing is", () => {
    const fight = startFight("two wolves 10hp", player, max)!;
    hurt(fight, "Wolf 1", 999);
    hurt(fight, "Wolf 2", 999);
    expect(foesDown(fight)).toBe(true);
  });

  test("the player going down does not end it — that is the story's problem", () => {
    const fight = startFight("a wolf 10hp", player, max)!;
    hurt(fight, "Iva Grant", 999);
    expect(foesDown(fight)).toBe(false);
  });
});

describe("what the narrator reads while it happens", () => {
  test("everyone, in order, with what is left of them", () => {
    const fight = startFight("two wolves 10hp", player, max)!;
    hurt(fight, "Wolf 1", 999);
    const text = fightForPrompt(fight);
    expect(text).toContain("Iva Grant — 8/8");
    expect(text).toContain("Wolf 1 — down");
    expect(text).toContain("Wolf 2 — 10/10");
  });

  test("stays compact — it goes into every prompt of the fight", () => {
    expect(fightForPrompt(startFight("10 goblins", player, max)!).length).toBeLessThan(600);
  });

  test("the brief names the notation and forbids the thing models do", () => {
    expect(FIGHT_BRIEF).toContain("[[hit:");
    expect(FIGHT_BRIEF).toContain("[[fight: over]]");
    expect(FIGHT_BRIEF).toMatch(/dead/i);
  });
});

describe("reading a stored fight back", () => {
  test("survives a round trip", () => {
    const fight = startFight("two wolves", player, max)!;
    expect(normaliseFight(JSON.parse(JSON.stringify(fight)))).toEqual(fight);
  });

  test("clamps damage somebody edited into nonsense", () => {
    const raw = { order: [{ name: "Wolf", initiative: 5, hp: 9999, maxHp: 10 }] };
    expect(normaliseFight(raw)!.order[0].hp).toBe(10);
  });

  test("nonsense is not a fight", () => {
    expect(normaliseFight(null)).toBeNull();
    expect(normaliseFight({ order: [] })).toBeNull();
    expect(normaliseFight("wolves")).toBeNull();
  });
});
