/**
 * Dice, for both sides of the table.
 *
 * You roll from the composer and the result becomes part of the conversation,
 * so the model reads it like anything else that was said. The model rolls by
 * writing the notation in double brackets — `[[2d6+3]]` — and Hearth resolves
 * it before the reply is saved, so what the chat keeps is the answer and not a
 * promise of one. That matters: a model asked to "roll" will otherwise invent
 * a number that suits it, which is the one thing dice exist to prevent.
 *
 * Randomness is injected rather than reached for, so every rule here is
 * testable without a seed or a mock global.
 */

export type Roll = {
  /** What was asked for, tidied: "2d6+3". */
  notation: string;
  count: number;
  sides: number;
  modifier: number;
  /** Each die, in the order thrown. */
  rolls: number[];
  total: number;
};

/**
 * Limits, so a roll stays a roll.
 *
 * Not a security boundary — this is a local program and the dice are yours —
 * but `999999d999999` in a reply should fail to parse rather than build an
 * array that stops the phone, and a model that has learnt the notation will
 * eventually write something silly.
 */
export const MAX_DICE = 100;
export const MAX_SIDES = 1000;

const DICE = /^\s*(\d*)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i;

/** Reads "d20", "2d6", "4d6+2", "1d8 - 1". Returns null for anything else. */
export function parseDice(input: string): Omit<Roll, "rolls" | "total"> | null {
  const m = DICE.exec(String(input ?? ""));
  if (!m) return null;

  // "d20" means one d20; the count is allowed to be left off.
  const count = m[1] === "" ? 1 : Number(m[1]);
  const sides = Number(m[2]);
  const modifier = m[3] ? (m[3] === "-" ? -Number(m[4]) : Number(m[4])) : 0;

  if (!Number.isInteger(count) || count < 1 || count > MAX_DICE) return null;
  if (!Number.isInteger(sides) || sides < 2 || sides > MAX_SIDES) return null;

  const sign = modifier < 0 ? "-" : "+";
  return {
    notation: `${count}d${sides}${modifier ? `${sign}${Math.abs(modifier)}` : ""}`,
    count,
    sides,
    modifier,
  };
}

/** A number in [0, 1). Swap it out in tests; the default is the real thing. */
export type Rng = () => number;

export function rollDice(input: string, rng: Rng = Math.random): Roll | null {
  const spec = parseDice(input);
  if (!spec) return null;
  const rolls: number[] = [];
  for (let i = 0; i < spec.count; i++) {
    rolls.push(Math.floor(rng() * spec.sides) + 1);
  }
  return { ...spec, rolls, total: rolls.reduce((a, b) => a + b, 0) + spec.modifier };
}

/** "2d6+3: 4, 5 +3 = 12" — short enough to read mid-scene. */
export function describeRoll(roll: Roll): string {
  const parts = roll.rolls.join(", ");
  const mod = roll.modifier
    ? ` ${roll.modifier < 0 ? "-" : "+"} ${Math.abs(roll.modifier)}`
    : "";
  // One die and no modifier needs no arithmetic shown.
  if (roll.rolls.length === 1 && !roll.modifier) return `${roll.notation}: ${roll.total}`;
  return `${roll.notation}: ${parts}${mod} = ${roll.total}`;
}

/** Everything a model wrote in double brackets, in the order it wrote them. */
const TOKEN = /\[\[([^\]\n]{1,32})\]\]/g;

export type ResolvedText = { text: string; rolls: Roll[] };

/**
 * Rolls whatever the model asked for, in place.
 *
 * `[[2d6]]` becomes `[[2d6: 4, 5 = 9]]`, keeping the brackets so the frontend
 * can still find it and draw it as dice rather than as prose. Anything in
 * brackets that is not dice notation is left exactly as it was — models put
 * all sorts of things in brackets, and eating them would be worse than
 * ignoring them.
 */
export function resolveRolls(text: string, rng: Rng = Math.random): ResolvedText {
  const rolls: Roll[] = [];
  const out = String(text ?? "").replace(TOKEN, (whole, inner) => {
    const roll = rollDice(inner, rng);
    if (!roll) return whole;
    rolls.push(roll);
    return `[[${describeRoll(roll)}]]`;
  });
  return { text: out, rolls };
}

/**
 * What the model is told, once, so it knows the notation exists.
 *
 * Deliberately short. A long explanation of a dice system is a long thing
 * competing with the character card for the model's attention, and the only
 * fact it actually needs is the shape of the token.
 */
export const DICE_BRIEF =
  "When something is uncertain, roll for it: write the dice in double square " +
  "brackets, like [[2d6]] or [[1d20+3]], and the real result will be filled in " +
  "where you wrote it. Never write the outcome of a roll yourself.";
