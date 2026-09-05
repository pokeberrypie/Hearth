/**
 * Tabletop mode: character sheets, and the rules for making one.
 *
 * Hearth's own light system rather than anyone else's. Six abilities and a
 * handful of classes are the common furniture of the whole genre, but rules
 * text belongs to whoever wrote it, so everything here — the classes, the
 * kit, the wording — is written for this app and owes nothing to a particular
 * book. It is deliberately thin: enough structure for a narrator to hang
 * consequences on, not a simulation.
 *
 * The point of a sheet is that it is *shared*. The numbers go into the prompt,
 * so the narrator knows the character is clumsy before deciding what a fall
 * costs, and a roll against an ability uses the modifier the sheet says rather
 * than one the model felt like. Everything here is pure and seeded, so the
 * rules are testable without a die.
 */

import { rollDice, type Rng } from "./dice";

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = (typeof ABILITIES)[number];

export const ABILITY_NAMES: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

export type Klass = {
  id: string;
  name: string;
  /** What the class is for, in one line, for the chooser. */
  blurb: string;
  /** Rolled once per level for health. */
  hitDie: number;
  /** The two abilities this class leans on; they get the best rolls. */
  primary: [Ability, Ability];
  skills: string[];
  kit: string[];
};

export const CLASSES: Klass[] = [
  {
    id: "fighter",
    name: "Fighter",
    blurb: "Solves it by being harder to stop than the problem is to start.",
    hitDie: 10,
    primary: ["str", "con"],
    skills: ["Athletics", "Intimidation", "Survival"],
    kit: ["A sword you have had a while", "Battered mail", "A shield", "Rations for a week"],
  },
  {
    id: "scout",
    name: "Scout",
    blurb: "Gets there first, quietly, and knows the way back.",
    hitDie: 8,
    primary: ["dex", "wis"],
    skills: ["Stealth", "Perception", "Acrobatics"],
    kit: ["A short bow", "Twenty arrows", "Dark clothes", "Rope, forty feet"],
  },
  {
    id: "scholar",
    name: "Scholar",
    blurb: "Has read about this exact situation, unfortunately.",
    hitDie: 6,
    primary: ["int", "wis"],
    skills: ["Lore", "Investigation", "Medicine"],
    kit: ["A book you are partway through", "Ink and paper", "A lens", "A letter of introduction"],
  },
  {
    id: "adept",
    name: "Adept",
    blurb: "Borrows something older than they are, and pays for it later.",
    hitDie: 6,
    primary: ["int", "cha"],
    skills: ["Arcana", "Insight", "Persuasion"],
    kit: ["A focus of some kind", "A very old notebook", "Chalk", "Something you should have returned"],
  },
  {
    id: "rogue",
    name: "Rogue",
    blurb: "Was not there, and can prove it.",
    hitDie: 8,
    primary: ["dex", "cha"],
    skills: ["Sleight of Hand", "Deception", "Stealth"],
    kit: ["Tools that open things", "A knife", "A second knife", "Somebody else's coin purse"],
  },
  {
    id: "healer",
    name: "Healer",
    blurb: "Keeps everyone else upright, which is harder than it sounds.",
    hitDie: 8,
    primary: ["wis", "cha"],
    skills: ["Medicine", "Insight", "Religion"],
    kit: ["A kit of bandages and worse", "A holy or herbal symbol", "Clean water", "A stern manner"],
  },
];

export const classById = (id: string) => CLASSES.find((c) => c.id === id) ?? null;

export type Sheet = {
  klass: string;
  level: number;
  abilities: Record<Ability, number>;
  maxHp: number;
  hp: number;
  skills: string[];
  inventory: string[];
  notes: string;
};

/** The bonus a score gives. 10-11 is average and worth nothing either way. */
export const modifier = (score: number) => Math.floor((score - 10) / 2);

/** "+2", "-1", "+0" — always signed, because a sheet reads better that way. */
export const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);

/**
 * Four dice, drop the lowest — the traditional way, and the reason a rolled
 * character feels luckier than an assigned one.
 */
export function rollAbilityScore(rng: Rng = Math.random): number {
  const four = rollDice("4d6", rng)!.rolls;
  const worst = Math.min(...four);
  return four.reduce((a, b) => a + b, 0) - worst;
}

/**
 * A whole set of six, best two put where the class wants them.
 *
 * Rolling and then assigning by hand is a lovely twenty minutes at a table and
 * a chore in a chat window, so the sheet arrives playable: the two highest
 * rolls land on the class's own abilities and the rest fall where they fall.
 * Nothing is re-rolled — a bad set is a character, not a mistake.
 */
export function rollAbilities(klass: Klass, rng: Rng = Math.random): Record<Ability, number> {
  const scores = ABILITIES.map(() => rollAbilityScore(rng)).sort((a, b) => b - a);
  const out = {} as Record<Ability, number>;
  const [first, second] = klass.primary;
  out[first] = scores[0];
  out[second] = scores[1];
  let i = 2;
  for (const ability of ABILITIES) {
    if (ability === first || ability === second) continue;
    out[ability] = scores[i++];
  }
  return out;
}

/** The even-handed alternative, for anyone who would rather not gamble. */
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

export function assignArray(klass: Klass, array = STANDARD_ARRAY): Record<Ability, number> {
  const out = {} as Record<Ability, number>;
  const [first, second] = klass.primary;
  out[first] = array[0];
  out[second] = array[1];
  let i = 2;
  for (const ability of ABILITIES) {
    if (ability === first || ability === second) continue;
    out[ability] = array[i++];
  }
  return out;
}

/** Full at first level, and never less than one. */
export function startingHp(klass: Klass, abilities: Record<Ability, number>): number {
  return Math.max(1, klass.hitDie + modifier(abilities.con));
}

export function makeSheet(
  klassId: string,
  how: "roll" | "array" = "roll",
  rng: Rng = Math.random,
): Sheet | null {
  const klass = classById(klassId);
  if (!klass) return null;
  const abilities = how === "roll" ? rollAbilities(klass, rng) : assignArray(klass);
  const maxHp = startingHp(klass, abilities);
  return {
    klass: klass.id,
    level: 1,
    abilities,
    maxHp,
    hp: maxHp,
    skills: [...klass.skills],
    inventory: [...klass.kit],
    notes: "",
  };
}

/** Accepts a stored row, an edited sheet, or something half-filled. */
export function normaliseSheet(raw: any): Sheet | null {
  if (!raw || typeof raw !== "object") return null;
  const klass = classById(String(raw.klass ?? "")) ?? CLASSES[0];
  const abilities = {} as Record<Ability, number>;
  for (const a of ABILITIES) {
    const n = Number(raw.abilities?.[a]);
    abilities[a] = Number.isFinite(n) ? Math.max(1, Math.min(30, Math.round(n))) : 10;
  }
  const maxHp = Math.max(1, Math.round(Number(raw.maxHp) || startingHp(klass, abilities)));
  const arr = (v: unknown) =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : [];
  return {
    klass: klass.id,
    level: Math.max(1, Math.min(20, Math.round(Number(raw.level) || 1))),
    abilities,
    maxHp,
    // Damage is allowed to be stored; a character at 0 is down, not deleted.
    hp: Math.max(0, Math.min(maxHp, Math.round(Number(raw.hp ?? maxHp)))),
    skills: arr(raw.skills),
    inventory: arr(raw.inventory),
    notes: String(raw.notes ?? ""),
  };
}

/**
 * The sheet as the narrator reads it.
 *
 * Compact on purpose: this goes into every prompt in a tabletop chat, and a
 * beautifully laid-out sheet is a beautifully laid-out thousand tokens. The
 * modifier is given rather than the score alone, because the modifier is the
 * number that decides anything.
 */
export function sheetForPrompt(name: string, sheet: Sheet): string {
  const klass = classById(sheet.klass);
  const stats = ABILITIES
    .map((a) => `${a.toUpperCase()} ${sheet.abilities[a]} (${signed(modifier(sheet.abilities[a]))})`)
    .join(", ");
  const lines = [
    `${name} — level ${sheet.level} ${klass?.name ?? "adventurer"}, ${sheet.hp}/${sheet.maxHp} hp`,
    stats,
  ];
  if (sheet.skills.length) lines.push(`Trained in: ${sheet.skills.join(", ")}`);
  if (sheet.inventory.length) lines.push(`Carrying: ${sheet.inventory.join(", ")}`);
  if (sheet.notes.trim()) lines.push(sheet.notes.trim());
  return lines.join("\n");
}

/**
 * A check against an ability: a d20 plus what the sheet says.
 *
 * The narrator asks for it by name, so the modifier comes from the sheet
 * rather than from the model's memory of what it wrote earlier — which is the
 * whole reason for keeping a sheet rather than describing a character as
 * "quite strong" and hoping.
 */
export type Check = {
  ability: Ability;
  die: number;
  modifier: number;
  total: number;
};

export function abilityCheck(sheet: Sheet, ability: Ability, rng: Rng = Math.random): Check {
  const die = rollDice("1d20", rng)!.rolls[0];
  const mod = modifier(sheet.abilities[ability]);
  return { ability, die, modifier: mod, total: die + mod };
}

export function describeCheck(check: Check): string {
  return `${ABILITY_NAMES[check.ability]} check: ${check.die} ${signed(check.modifier)} = ${check.total}`;
}

/**
 * What the narrator writes to ask for a check, and how it is answered.
 *
 * `[[check: dex]]` — or `[[dex check]]`, because a model will write both — is
 * replaced with the roll made against the sheet. The modifier comes from the
 * character's own abilities, which is the entire point: a narrator asked to
 * "roll dexterity" without a sheet picks a number that suits the story it has
 * already decided on.
 *
 * Anything it asks for that is not an ability is left alone, exactly like the
 * dice notation: a bracket is not a promise that Hearth understands it.
 */
const CHECK = /\[\[\s*(?:check\s*:\s*([a-z]+)|([a-z]+)\s+check)\s*\]\]/gi;

const ABILITY_WORDS: Record<string, Ability> = {
  str: "str", strength: "str",
  dex: "dex", dexterity: "dex", agility: "dex",
  con: "con", constitution: "con", endurance: "con",
  int: "int", intelligence: "int",
  wis: "wis", wisdom: "wis", perception: "wis",
  cha: "cha", charisma: "cha", persuasion: "cha",
};

export function resolveChecks(
  text: string,
  sheet: Sheet | null,
  rng: Rng = Math.random,
): { text: string; checks: Check[] } {
  const checks: Check[] = [];
  if (!sheet) return { text: String(text ?? ""), checks };

  const out = String(text ?? "").replace(CHECK, (whole, a, b) => {
    const ability = ABILITY_WORDS[String(a ?? b).toLowerCase()];
    if (!ability) return whole;
    const check = abilityCheck(sheet, ability, rng);
    checks.push(check);
    return `[[${describeCheck(check)}]]`;
  });
  return { text: out, checks };
}

/**
 * The skills each class trains, and the ability each one leans on.
 *
 * Kept beside the classes rather than inside them because it is a different
 * question: a class says what you are trained in, and this says what a
 * trained thing is *rolled with*. A narrator that asks you to sneak has asked
 * for dexterity without using the word.
 */
export const SKILL_ABILITY: Record<string, Ability> = {
  athletics: "str",
  acrobatics: "dex", stealth: "dex", "sleight of hand": "dex",
  survival: "wis", perception: "wis", insight: "wis", medicine: "wis", religion: "wis",
  lore: "int", investigation: "int", arcana: "int",
  intimidation: "cha", persuasion: "cha", deception: "cha",
};

/**
 * What the narrator just asked you to roll, if it asked for anything.
 *
 * Read out of the last thing it said, because "make a dexterity check" and
 * "roll stealth" are the same request and only one of them names the stat.
 *
 * The word has to be *asked for*, not merely present. Mentioning an ability
 * anywhere in the message was the obvious rule and a bad one: a reply that
 * happens to describe a strongbox, or a preset that files its planning notes
 * under headings like Knowledge and Investigation, would have every roll come
 * out as Intelligence. Measured, not guessed — that is exactly what the first
 * live one did. So there has to be a verb in front of it or a check behind it.
 *
 * The last ask wins, since a paragraph that recalls how strong you are and
 * then asks you to pick a lock has asked you to pick a lock. Finding nothing
 * is a real answer: plenty of moments call for a plain die.
 */
const ASKING = "roll|make|give me|take|attempt|try|test";
const ASKED = "check|checks|roll|rolls|save|saves|test";

/**
 * The same question, answered with the word that was actually used.
 *
 * A narrator asking for perception is asking for a wisdom roll, but "Wisdom
 * check" is not what it asked for, and a table where you are told to roll
 * perception and handed a wisdom check looks like a table with no perception
 * in it. So the matched word is kept alongside the stat it rolls.
 */
export function askedFor(text: string): { ability: Ability; word: string } | null {
  const hay = String(text ?? "").toLowerCase();
  let found: { ability: Ability; word: string } | null = null;
  let at = -1;

  const consider = (word: string, ability: Ability) => {
    const w = word.replace(/ /g, "\\s+");
    for (const source of [
      `\\b(?:${ASKING})\\b[^.?!\\n]{0,24}?\\b${w}\\b`,
      `\\b${w}\\b\\s+(?:${ASKED})\\b`,
    ]) {
      const re = new RegExp(source, "g");
      for (let m = re.exec(hay); m; m = re.exec(hay)) {
        const where = m.index + m[0].length;
        if (where > at) { at = where; found = { ability, word }; }
      }
    }
  };

  for (const [word, ability] of Object.entries(ABILITY_WORDS)) consider(word, ability);
  for (const [skill, ability] of Object.entries(SKILL_ABILITY)) consider(skill, ability);
  return found;
}

export function abilityAsked(text: string): Ability | null {
  const hay = String(text ?? "").toLowerCase();
  let found: Ability | null = null;
  let at = -1;

  const consider = (word: string, ability: Ability) => {
    // Whole words only, or "int" matches "into" and every scene is a puzzle.
    const w = word.replace(/ /g, "\\s+");
    for (const source of [
      // "roll stealth", "make a dexterity check", "give me a con save"
      `\\b(?:${ASKING})\\b[^.?!\\n]{0,24}?\\b${w}\\b`,
      // "an athletics roll", "dexterity check"
      `\\b${w}\\b\\s+(?:${ASKED})\\b`,
    ]) {
      const re = new RegExp(source, "g");
      for (let m = re.exec(hay); m; m = re.exec(hay)) {
        // The position of the ability word, not of the verb, so two asks in
        // one sentence are ordered by the thing being asked for.
        const where = m.index + m[0].length;
        if (where > at) { at = where; found = ability; }
      }
    }
  };

  for (const [word, ability] of Object.entries(ABILITY_WORDS)) consider(word, ability);
  for (const [skill, ability] of Object.entries(SKILL_ABILITY)) consider(skill, ability);
  return found;
}

/** The notation, told to the narrator once, alongside the dice one. */
export const CHECK_BRIEF =
  "To test something the player's character attempts, write [[check: dex]] " +
  "(or str, con, int, wis, cha) and the real roll against their sheet will be " +
  "filled in. Their sheet is above; use it rather than guessing what they can do.";
