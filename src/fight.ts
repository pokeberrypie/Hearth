/**
 * A fight: who is in it, in what order, and how much of them is left.
 *
 * The narrator starts one by writing [[fight: two wolves]] in its own prose,
 * the same way it rolls dice and introduces people. What it gets back is an
 * initiative order with real numbers in it — including the player's, taken
 * from their sheet rather than from what the model remembers about them.
 *
 * Deliberately not a combat simulator. There are no actions to spend and no
 * grid. A model narrating a fight is already good at pacing one; what it is
 * bad at is remembering that the second wolf took five damage two paragraphs
 * ago, or that the archer has not been yet. So this tracks exactly the things
 * prose cannot hold — names, order, hit points, and whose turn it is — and
 * everything else stays the story's.
 *
 * Pure and seeded, like the dice it is built on.
 */

import { rollDice, type Rng } from "./dice";

export type Combatant = {
  name: string;
  initiative: number;
  hp: number;
  maxHp: number;
  /** The player's own row — the one whose damage goes back to their sheet. */
  player?: boolean;
  /**
   * Where they stood before anybody rolled.
   *
   * Kept only so the tracker can show the room filling up in the order the
   * narrator named everyone and *then* sort itself as the dice land. Without
   * it the arrival order is gone by the time the fight is stored, and the
   * only way to animate a roll is to invent an arrangement to shuffle out of
   * — a lie about the one thing whose whole point is that it is not one.
   */
  entered: number;
};

export type Fight = {
  order: Combatant[];
  /**
   * Whose turn it is, as an index into the order.
   *
   * Kept because it is the one thing a tracker on screen has to know and the
   * one thing prose is worst at holding: a narrator three exchanges into a
   * scrap has lost track of whether the second wolf has been yet. The narrator
   * moves it with [[turn: ...]]; nothing moves it on its own, because a reply
   * covering four combatants and a reply covering one look identical from
   * here, and a tracker that guesses wrong is worse than one that waits.
   */
  turn: number;
};

/** Enough for a real scrap, few enough that the prompt stays a prompt. */
export const MAX_FOES = 10;

/**
 * How a narrator writes a number of somebody: "two wolves", "3 bandits",
 * "wolf x2". Words as well as digits, because prose reaches for words.
 */
const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/**
 * Back to the singular, roughly.
 *
 * Roughly is the right amount of effort here. English pluralisation is a
 * career, and the cost of getting one wrong is a combatant called "Wolve" —
 * which is a bit funny and changes nothing about the fight. The four rules
 * below cover essentially everything a narrator throws at a party.
 */
function singular(word: string): string {
  if (/[^aeiou]ies$/i.test(word)) return word.slice(0, -3) + "y";   // harpies -> harpy
  if (/ves$/i.test(word)) return word.slice(0, -3) + "f";           // wolves -> wolf
  if (/(s|x|z|ch|sh)es$/i.test(word)) return word.slice(0, -2);     // torches -> torch
  if (/[^s]s$/i.test(word)) return word.slice(0, -1);               // bandits -> bandit
  return word;
}

const titleCase = (s: string) => s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1));

export type Foe = { name: string; count: number; hp: number | null };

/**
 * Reads one entry of a fight: "two wolves", "Bandit Captain 16hp", "Wolf x3".
 *
 * The hit points are optional and usually absent — a narrator that has an
 * opinion about how tough something is should be able to say so, and one that
 * has not should not be made to.
 */
export function parseFoe(input: string): Foe | null {
  let text = String(input ?? "").replace(/[*_`"“”()]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  // "16hp", "16 hp", "with 12 health" — taken out wherever it sits.
  let hp: number | null = null;
  text = text.replace(/(?:with\s+)?(\d{1,3})\s*(?:hp|health)\b/i, (_whole, n) => {
    hp = Math.max(1, Math.min(999, Number(n)));
    return " ";
  });

  // A trailing multiplier: "wolf x3".
  let count = 0;
  text = text.replace(/\s*[x×]\s*(\d{1,2})\s*$/i, (_whole, n) => { count = Number(n); return ""; });

  const words = text.trim().split(" ").filter(Boolean);
  if (!words.length) return null;

  // A leading count, as a digit or as a word.
  if (!count) {
    const lead = words[0].toLowerCase();
    const asNumber = /^\d{1,2}$/.test(lead) ? Number(lead) : WORD_NUMBERS[lead];
    if (asNumber) {
      count = asNumber;
      words.shift();
    }
  }
  if (!words.length) return null;
  count = Math.max(1, Math.min(MAX_FOES, count || 1));

  // Only the last word carries the plural: "bandit captains" -> "Bandit Captain".
  if (count > 1) words[words.length - 1] = singular(words[words.length - 1]);

  const name = titleCase(words.join(" ")).slice(0, 40);
  if (!name) return null;
  return { name, count, hp };
}

/**
 * What something has, when nobody said.
 *
 * Rolled rather than fixed, so two wolves are not interchangeable and the one
 * that goes down first is a small fact about this fight rather than about the
 * order they happened to be listed in.
 */
export function rollFoeHp(rng: Rng = Math.random): number {
  return rollDice("2d6+2", rng)!.total;
}

export type Player = { name: string; hp: number; maxHp: number; initiativeBonus: number };

/**
 * Everyone in, in the order they act.
 *
 * The player rolls with the dexterity their sheet says; anything else rolls
 * flat plus one. Ties are left where they fall — the sort is stable, so a foe
 * matching the player's roll acts after them, which is the friendlier way
 * round and not worth a rule of its own.
 */
export function startFight(
  payload: string,
  player: Player | null,
  rng: Rng = Math.random,
): Fight | null {
  const entries = String(payload ?? "").split(/\s*(?:,|;|\band\b)\s*/i).filter(Boolean);
  const order: Combatant[] = [];

  for (const entry of entries) {
    const foe = parseFoe(entry);
    if (!foe) continue;
    for (let i = 0; i < foe.count; i++) {
      if (order.length >= MAX_FOES) break;
      const maxHp = foe.hp ?? rollFoeHp(rng);
      order.push({
        // Numbered only when there is more than one to tell apart, so a lone
        // captain is "Bandit Captain" and not "Bandit Captain 1".
        name: foe.count > 1 ? `${foe.name} ${i + 1}` : foe.name,
        initiative: rollDice("1d20+1", rng)!.total,
        hp: maxHp,
        maxHp,
        entered: order.length,
      });
    }
  }
  if (!order.length) return null;

  if (player) {
    order.push({
      name: player.name,
      initiative: rollDice("1d20", rng)!.total + player.initiativeBonus,
      hp: player.hp,
      maxHp: player.maxHp,
      player: true,
      entered: order.length,
    });
  }

  order.sort((a, b) => b.initiative - a.initiative);
  // Whoever rolled highest is up. That much needs no telling.
  return { order, turn: 0 };
}

/**
 * Who the narrator meant.
 *
 * Exact name first, then a prefix — because a model that carefully numbered
 * "Wolf 1" and "Wolf 2" on the way in will write "the wolf" on the way out,
 * every time. A bare "wolf" finds the first one still standing, which is what
 * anyone at a table would have meant by it.
 */
export function findCombatant(fight: Fight, name: string): Combatant | null {
  const want = String(name ?? "").replace(/^(the|a|an)\s+/i, "").trim().toLowerCase();
  if (!want) return null;
  const order = fight.order;
  return (
    order.find((c) => c.name.toLowerCase() === want) ??
    order.find((c) => c.hp > 0 && c.name.toLowerCase().startsWith(want)) ??
    order.find((c) => c.name.toLowerCase().startsWith(want)) ??
    null
  );
}

/** Damage, or healing when the amount is negative. Never past 0 or the maximum. */
export function hurt(fight: Fight, name: string, amount: number): Combatant | null {
  const who = findCombatant(fight, name);
  if (!who) return null;
  const n = Math.round(Number(amount));
  if (!Number.isFinite(n)) return null;
  who.hp = Math.max(0, Math.min(who.maxHp, who.hp - n));
  return who;
}

/**
 * Hands the turn to somebody, by whatever name the narrator called them.
 *
 * Returns null when that is nobody in this fight, so an unrecognised name
 * leaves the brackets where they were rather than quietly moving the marker
 * onto the wrong combatant.
 */
export function takeTurn(fight: Fight, name: string): Combatant | null {
  const who = findCombatant(fight, name);
  if (!who) return null;
  fight.turn = fight.order.indexOf(who);
  return who;
}

/** True once nothing the party is fighting is still standing. */
export function foesDown(fight: Fight): boolean {
  const foes = fight.order.filter((c) => !c.player);
  return foes.length > 0 && foes.every((c) => c.hp <= 0);
}

/** Somebody at zero is down. Whether they are worse than that is the story's. */
export const stateOf = (c: Combatant) => (c.hp <= 0 ? "down" : `${c.hp}/${c.maxHp}`);

/** "Iva Grant 18, Wolf 1 14, Wolf 2 11" — the order, as it is written down. */
export function describeInitiative(fight: Fight): string {
  return fight.order.map((c) => `${c.name} ${c.initiative}`).join(", ");
}

/**
 * The fight as the narrator reads it, in every prompt while it lasts.
 *
 * This is the whole point of keeping one. A model narrating its third round
 * has the first round out of sight and will put a wolf it killed back on its
 * feet; a model handed three lines of hit points will not.
 */
export function fightForPrompt(fight: Fight): string {
  const lines = ["A fight is happening. Initiative order, and what is left of everyone:"];
  fight.order.forEach((c, i) =>
    lines.push(`${i + 1}. ${c.name} — ${stateOf(c)}${i === fight.turn ? "  <- up now" : ""}`));
  return lines.join("\n");
}

/** Read back from storage, defensively — it is JSON somebody could have edited. */
export function normaliseFight(raw: any): Fight | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.order)) return null;
  const order: Combatant[] = [];
  for (const c of raw.order.slice(0, MAX_FOES + 1)) {
    const name = String(c?.name ?? "").trim().slice(0, 40);
    if (!name) continue;
    const maxHp = Math.max(1, Math.min(999, Math.round(Number(c?.maxHp) || 1)));
    order.push({
      name,
      initiative: Math.round(Number(c?.initiative) || 0),
      maxHp,
      hp: Math.max(0, Math.min(maxHp, Math.round(Number(c?.hp ?? maxHp)))),
      ...(c?.player ? { player: true } : {}),
      // A fight stored before this field existed has no arrival order; the
      // list it is already in is the best answer available, and a good one.
      entered: Number.isFinite(Number(c?.entered)) ? Number(c.entered) : order.length,
    });
  }
  if (!order.length) return null;
  const turn = Math.round(Number(raw.turn) || 0);
  return { order, turn: Math.max(0, Math.min(order.length - 1, turn)) };
}

export const FIGHT_BRIEF = [
  "Write [[hit: Wolf 1, 5]] whenever anyone takes damage — the hit points",
  "above are the real ones and are what this fight is scored on — and",
  "[[fight: over]] the moment it stops. Do not decide someone is dead whose",
  "hit points say otherwise.",
  "Write [[turn: Wolf 1]] as each combatant comes up, so the order on the",
  "player's screen keeps pace with what you are describing. Work down the",
  "list and back to the top.",
].join(" ");
