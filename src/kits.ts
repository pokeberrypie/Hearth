/**
 * Classes and races people write themselves.
 *
 * Six classes shipped in the code, which is fine for a first evening and wrong
 * for a campaign — everybody's table has a thing in it that nobody else's has,
 * and a game you cannot add a Warden or a Tiefling to is a game you play
 * somebody else's version of.
 *
 * Both live here because they are the same shape of thing: a name, a line
 * saying what it is for, and a small number of mechanical facts. Keeping them
 * in one file and one table means importing, exporting, listing and validating
 * are each written once rather than twice with a subtle difference.
 *
 * ## What a race does and does not do
 *
 * A race adjusts abilities and adds a trait or two. It does not set hit dice,
 * a kit, or skills — those come from what you *do*, which is the class. That
 * split is not universal across systems, but a program that lets both halves
 * set everything produces sheets where nobody can tell which half gave them a
 * d12, so it is worth being opinionated about.
 *
 * ## The built-ins are not special
 *
 * They are the same shape as anything you write, and they are seeded into the
 * same table on first run. The only thing that marks them is a flag saying so,
 * which exists to warn before deleting one and for nothing else. A built-in
 * you have edited is yours, and stays edited.
 */

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

export type Kit = {
  id: string;
  kind: "class" | "race";
  name: string;
  blurb: string;
  builtin: boolean;
  /** Classes only: the die their hit points come from. */
  hitDie: number;
  /** Classes only: the two abilities this leans on, best scores first. */
  primary: Ability[];
  /** Classes only. */
  skills: string[];
  kit: string[];
  /** Races only: what it adds to each ability. */
  bonus: Partial<Record<Ability, number>>;
  /** Races only: the sentences that make it that race rather than a stat block. */
  traits: string[];
};

const str = (v: unknown, fallback = "") =>
  typeof v === "string" ? v : v == null ? fallback : String(v);

const clean = (v: unknown, max: number) => str(v).replace(/\s+/g, " ").trim().slice(0, max);

const list = (v: unknown, max: number, each: number): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]/) : [])
    .map((x) => clean(x, each))
    .filter(Boolean)
    .slice(0, max);

/** A name, turned into something usable as an id. */
export function slug(name: unknown): string {
  const s = clean(name, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s || "unnamed";
}

/**
 * Takes a row, an imported file, or something half-written, and returns
 * something safe to use.
 *
 * Everything is clamped rather than rejected. A file with a d200 hit die and
 * forty skills is somebody's mistake or somebody's joke, and either way the
 * useful response is a d20 and ten skills rather than an error page — the
 * sheet has to add up whatever arrives.
 */
export function normaliseKit(raw: any): Kit {
  const kind: Kit["kind"] = raw?.kind === "race" ? "race" : "class";
  const name = clean(raw?.name, 40) || (kind === "race" ? "A people" : "A calling");

  const primary = (Array.isArray(raw?.primary) ? raw.primary : [])
    .map((a: unknown) => str(a).toLowerCase())
    .filter((a: string): a is Ability => (ABILITIES as string[]).includes(a));

  const bonus: Partial<Record<Ability, number>> = {};
  for (const a of ABILITIES) {
    const n = Math.round(Number(raw?.bonus?.[a] ?? 0));
    // A race that hands out +6 is not a race, it is a different game.
    if (Number.isFinite(n) && n !== 0) bonus[a] = Math.max(-2, Math.min(3, n));
  }

  return {
    id: str(raw?.id).trim() || slug(name),
    kind,
    name,
    blurb: clean(raw?.blurb, 160),
    builtin: !!raw?.builtin,
    hitDie: [6, 8, 10, 12].includes(Number(raw?.hitDie)) ? Number(raw.hitDie) : 8,
    // Two, because the roller gives the best scores to the primaries and three
    // primaries means the third one quietly never gets them.
    primary: [...new Set(primary)].slice(0, 2) as Ability[],
    skills: list(raw?.skills, 10, 40),
    kit: list(raw?.kit, 12, 80),
    bonus,
    traits: list(raw?.traits, 6, 160),
  };
}

/** Whether this is worth saving, as opposed to an empty form somebody opened. */
export function looksWritten(k: Kit): boolean {
  if (!k.name.trim()) return false;
  return k.kind === "race"
    ? Object.keys(k.bonus).length > 0 || k.traits.length > 0 || !!k.blurb
    : k.skills.length > 0 || k.kit.length > 0 || !!k.blurb;
}

/**
 * A race's contribution to a sheet.
 *
 * Applied after the class has rolled, never before: rolling against a total
 * that already includes the bonus is how a +2 turns into a +2 and a better
 * roll, and then a Dwarf Fighter is not a Fighter who is a Dwarf, it is a
 * better Fighter.
 *
 * Clamped at 20, because a sheet where a number can exceed the die that tests
 * it stops meaning anything.
 */
export function applyRace(
  abilities: Record<Ability, number>,
  race: Kit | null,
): Record<Ability, number> {
  const out = { ...abilities };
  if (!race || race.kind !== "race") return out;
  for (const a of ABILITIES) {
    const add = race.bonus[a] ?? 0;
    if (add) out[a] = Math.max(1, Math.min(20, (out[a] ?? 10) + add));
  }
  return out;
}

/**
 * What the narrator is told about who it is running the game for.
 *
 * The traits, not the numbers — the numbers are already on the sheet and the
 * narrator rolling against them is what the sheet is for. What it cannot work
 * out from a stat block is that your people do not sleep, or are not welcome
 * in the city, which is the half that changes what a scene does.
 */
export function raceForPrompt(race: Kit | null): string {
  if (!race || race.kind !== "race" || !race.traits.length) return "";
  return `They are ${race.name}. ${race.traits.join(" ")}`;
}
