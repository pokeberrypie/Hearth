/**
 * Whispers & Rumours: who knows what, and how it gets around.
 *
 * Nothing here is ever the thing itself. What happened is in the ledger and
 * stays as it was; what someone knows is a separate record pointing back at
 * it — their version, who they had it from, how garbled it has got, and
 * whether they will pass it on. A rumour can be wrong, can blame the wrong
 * person, can fade; the truth under it is never touched.
 *
 * Three things are kept apart, because a mystery needs all three:
 *   - a trace lying somewhere (a pin under a table — a hook, in the ledger);
 *   - someone finding it, or having seen something (a record of their own);
 *   - someone being told (another record, one step further from the truth).
 * A trace can lie unfound for days.
 *
 * All of it is decided in code with the dice it is handed, once per story
 * day, and written as records tied to the message that turned the day — so a
 * swipe takes back the gossip with everything else.
 */

export const GOSSIP = ["off", "natural", "court", "chaotic"] as const;
export type Gossip = (typeof GOSSIP)[number];
export const gossipOf = (v: unknown): Gossip => (GOSSIP.includes(v as Gossip) ? (v as Gossip) : "natural");

/**
 * Per story day. Natural: gossip exists, but it is not what the story is
 * about. Court: information is currency. Chaotic: everyone talks, and much of
 * it is wrong.
 */
export const GOSSIP_RATES: Record<Exclude<Gossip, "off">, { find: number; spread: number; refuse: number; misinfo: number; perDay: number }> = {
  natural: { find: 0.2, spread: 0.25, refuse: 0.3, misinfo: 0.1, perDay: 2 },
  court: { find: 0.3, spread: 0.5, refuse: 0.15, misinfo: 0.15, perDay: 4 },
  chaotic: { find: 0.4, spread: 0.7, refuse: 0.05, misinfo: 0.3, perDay: 6 },
};

/** The people nobody names who still find things and talk: a household's eyes and ears. */
export const ROLES = ["a servant", "a maid", "a guard", "a page", "a stable boy", "a washerwoman"];

export type Knowing = {
  /** Who holds it: someone in the story, or a role. */
  holder: string;
  /** Their version of it, in words. */
  version: string;
  /** What it is ultimately about: the trace or the deed, in the ledger. Every retelling keeps this. */
  of: string;
  /** How they came by it. */
  source: "saw" | "found" | "told";
  /** Who told them, when they were told. */
  from: string;
  /** How far from the truth it has drifted, 0 to 100. */
  distortion: number;
  /** Misinformation: whom they wrongly think was behind it. */
  blames: string;
  /** Whether they will pass it on. Decided once, when they come by it; those who did it never tell. */
  spreads: boolean;
  /** The day they came by it. */
  day: number;
  /** Who did the thing it is about: they are never blamed by mistake, and never tell it on. */
  by: string[];
};

export type Trace = { id: string; text: string; by: string[]; day: number };

export type GossipInput = {
  level: Gossip;
  /** Added to a rumour's distortion with each telling, give or take: 0 to 50. */
  distortion: number;
  misinformation: boolean;
  /** After this many days a rumour stops spreading, though those who hold it still remember it. */
  decayDays: number;
  day: number;
  knowings: Knowing[];
  /** Traces left lying, not yet found by anyone. */
  traces: Trace[];
  /** Everyone in the story who could hear something — never the player's character. */
  people: string[];
  player: string;
  rng: () => number;
  /** How one person feels about another, 0 to 100, one way round; 50 when nothing is known. From the story's bonds. */
  closeness?: (from: string, to: string) => number;
  /** Whether two people are counted in the same faction. */
  together?: (a: string, b: string) => boolean;
};

const pick = <T>(list: T[], rng: () => number): T | undefined => (list.length ? list[Math.min(list.length - 1, Math.floor(rng() * list.length))] : undefined);

/** A pick where some are likelier than others: each in proportion to its weight. */
function weighted<T>(list: { item: T; weight: number }[], rng: () => number): T | undefined {
  const live = list.filter((x) => x.weight > 0);
  const total = live.reduce((n, x) => n + x.weight, 0);
  if (!total) return undefined;
  let r = rng() * total;
  for (const x of live) { r -= x.weight; if (r < 0) return x.item; }
  return live[live.length - 1].item;
}

const isRole = (who: string) => ROLES.includes(who);

/**
 * Whom someone tells: gossip runs along the story's own ties. A friend
 * before a stranger, a sworn brother before a rival, a servant to the other
 * servants; and nobody confides in someone they loathe.
 */
export function listenerWeight(holder: string, to: string, o: Pick<GossipInput, "closeness" | "together">): number {
  if (isRole(holder) && isRole(to)) return 4; // below stairs, everyone talks to everyone
  if (isRole(holder) || isRole(to)) return 1.5;
  const near = o.closeness?.(holder, to) ?? 50;
  if (near < 30) return 0.2;
  return 1 + Math.max(0, near - 50) / 10 + (o.together?.(holder, to) ? 2 : 0);
}

/** Whom someone would shield: a person they are devoted to, among those who did it. */
export function loyalTo(holder: string, by: string[], o: Pick<GossipInput, "closeness">): string | undefined {
  return by.find((a) => (o.closeness?.(holder, a) ?? 50) >= 70);
}

/**
 * Whether they will pass it on. Those who did it never do. Someone devoted
 * to whoever did it holds their tongue — except to warn them. Someone who
 * cannot stand them is glad to.
 */
function willTell(who: string, by: string[], base: number, o: GossipInput): boolean {
  if (by.includes(who)) return false;
  if (loyalTo(who, by, o)) return true; // they will — but only to warn (see below)
  const spite = by.some((a) => (o.closeness?.(who, a) ?? 50) <= 30);
  return o.rng() >= Math.max(0, base - (spite ? 0.25 : 0));
}

/** Whether someone who has just seen or found something will pass it on, by the same rules as everyone else. */
export function willSpread(who: string, by: string[], level: Gossip, o: Pick<GossipInput, "closeness" | "rng">): boolean {
  if (level === "off") return false;
  return willTell(who, by, GOSSIP_RATES[level].refuse, o as GossipInput);
}

/** Whether a rumour is still going around, or has faded to something people only remember. */
export const active = (k: Pick<Knowing, "day">, day: number, decayDays: number) => day - k.day <= decayDays;

/**
 * One day's whispering: traces found, and things told on. Returns only what
 * is new; nothing already known is changed.
 */
export function gossipDay(o: GossipInput): Knowing[] {
  if (o.level === "off") return [];
  const rate = GOSSIP_RATES[o.level];
  const player = o.player.toLowerCase();
  const people = o.people.filter((p) => p && p.toLowerCase() !== player);
  const out: Knowing[] = [];
  const knowsAlready = (who: string, of: string) => [...o.knowings, ...out].some((k) => k.of === of && k.holder === who);
  const refuses = (who: string, by: string[]) => !willTell(who, by, rate.refuse, o);

  // Found: a trace lying unnoticed, come upon by someone — a person in the story, or one of the household.
  for (const t of o.traces) {
    if (out.length >= rate.perDay) break;
    if ([...o.knowings, ...out].some((k) => k.of === t.id)) continue;
    if (o.rng() >= rate.find) continue;
    const named = people.filter((p) => !t.by.includes(p));
    const finder = o.rng() < 0.5 || !named.length ? pick(ROLES, o.rng)! : pick(named, o.rng)!;
    out.push({ holder: finder, version: t.text, of: t.id, source: "found", from: "", distortion: 0, blames: "",
      spreads: !refuses(finder, t.by), day: o.day, by: t.by });
  }

  // Told: each rumour still going around may be passed on, once a day, by someone willing to — a step further from the truth.
  for (const k of o.knowings) {
    if (out.length >= rate.perDay) break;
    if (!k.spreads || !active(k, o.day, o.decayDays) || k.by.includes(k.holder)) continue;
    if (o.rng() >= rate.spread) continue;
    // Someone devoted to whoever did it tells no one but them: a warning, not gossip.
    const shield = loyalTo(k.holder, k.by, o);
    const candidates = [...people, ...ROLES].filter((p) => p !== k.holder && !knowsAlready(p, k.of) && (!shield || p === shield));
    const to = weighted(candidates.map((p) => ({ item: p, weight: listenerWeight(k.holder, p, o) })), o.rng);
    if (!to) continue;
    const drift = Math.max(0, Math.min(50, o.distortion));
    const distortion = Math.min(100, k.distortion + drift + Math.floor(o.rng() * (drift + 1)));
    let blames = k.blames;
    if (o.misinformation && o.rng() < rate.misinfo) {
      blames = pick(people.filter((p) => !k.by.includes(p) && p !== to && p !== k.holder), o.rng) ?? blames;
    }
    out.push({ holder: to, version: k.version, of: k.of, source: "told", from: k.holder, distortion, blames,
      spreads: !refuses(to, k.by), day: o.day, by: k.by });
  }
  return out;
}

/** One knowing, as someone holding it would be described to a model. */
export function told(k: Knowing, viewer: "narrator" | "self"): string {
  const how = k.source === "saw" ? "saw" : k.source === "found" ? "found" : `heard${k.from ? ` from ${k.from}` : ""}`;
  const garbled = k.distortion >= 50 ? " — much garbled in the telling, and may be badly wrong" : k.distortion >= 20 ? " — somewhat garbled in the telling" : "";
  const blame = k.blames ? `, and ${viewer === "self" ? "they believe" : "believes"} ${k.blames} was behind it` : "";
  return viewer === "self"
    ? `${how[0].toUpperCase()}${how.slice(1)}: “${k.version}”${garbled}${blame}${k.by.includes(k.holder) ? " (this is about something they did themselves)" : ""}`
    : `${k.holder} ${how}: “${k.version}”${garbled}${blame}`;
}
