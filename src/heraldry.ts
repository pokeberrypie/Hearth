/**
 * Arms for factions: described, never drawn by a model.
 *
 * A coat of arms here is a handful of choices — the colours of the field and
 * how it is divided, perhaps a band across it, and one picture from the
 * charge set in public/charges — and Hearth draws the shield from those. A
 * model asked for arms can only name things from these lists; a name it gets
 * wrong is matched to the nearest real one or left out, and a faction with no
 * arms at all gets some derived from its name, so the same faction is always
 * the same shield.
 *
 * Heraldry's oldest rule, the rule of tincture — metal on colour, colour on
 * metal, never gold on silver or red on blue — is the same thing as a
 * contrast rule, so following it is what keeps a small shield legible on a
 * dark screen. Whether it is enforced is a setting; when it is, a blazon that
 * breaks it is corrected rather than refused.
 *
 * Pure: reading the charge files is index.ts's business.
 */

/** The seven traditional tinctures, in shades chosen to sit on Hearth's dark ground. */
export const TINCTURES = {
  or: { hex: "#d6a84a", metal: true, name: "gold" },
  argent: { hex: "#e8e2d4", metal: true, name: "silver" },
  gules: { hex: "#a8342a", metal: false, name: "red" },
  azure: { hex: "#2f5d9a", metal: false, name: "blue" },
  vert: { hex: "#3f6e3a", metal: false, name: "green" },
  sable: { hex: "#1c1714", metal: false, name: "black" },
  purpure: { hex: "#6b3b78", metal: false, name: "purple" },
} as const;
export type Tincture = keyof typeof TINCTURES;

export const SPLITS = ["none", "per_pale", "per_fess", "per_bend", "quarterly"] as const;
export type Split = (typeof SPLITS)[number];

export const BANDS = ["chief", "fess", "pale", "bend", "chevron", "cross", "saltire", "bordure"] as const;
export type Band = (typeof BANDS)[number];

export type Blazon = {
  field: { split: Split; colours: [Tincture] | [Tincture, Tincture] };
  band: { type: Band; colour: Tincture } | null;
  charge: { type: string; colour: Tincture; count: 1 | 2 | 3 } | null;
};

const TINCTURE_WORDS: Record<string, Tincture> = {
  or: "or", gold: "or", golden: "or", yellow: "or",
  argent: "argent", silver: "argent", white: "argent",
  gules: "gules", red: "gules", crimson: "gules", scarlet: "gules",
  azure: "azure", blue: "azure",
  vert: "vert", green: "vert",
  sable: "sable", black: "sable",
  purpure: "purpure", purple: "purpure", violet: "purpure",
};

export function tinctureOf(word: unknown): Tincture | null {
  return TINCTURE_WORDS[String(word ?? "").toLowerCase().replace(/[^a-z]/g, "")] ?? null;
}

const isMetal = (t: Tincture) => TINCTURES[t].metal;

/** Words people and models use for things in the charge set. */
const CHARGE_WORDS: Record<string, string> = {
  lion: "lion_rampant", lioness: "lion_rampant", leopard: "lion_passant",
  deer: "stag", hart: "stag", buck: "stag", dog: "hound", hounds: "hound",
  snake: "serpent", viper: "serpent", adder: "serpent", wyrm: "dragon",
  squid: "kraken", octopus: "kraken", bird: "falcon", hawk: "falcon", crow: "raven",
  eagle: "eagle_displayed", fishes: "fish", salmon: "fish", shell: "scallop_shell", scallop: "scallop_shell",
  tree: "oak_tree", oak: "oak_tree", leaf: "oak_leaf", flower: "rose", lily: "fleur_de_lis", fleur: "fleur_de_lis",
  wheat: "wheat_sheaf", grain: "wheat_sheaf", vine: "thorned_vine", thorns: "thorned_vine",
  sun: "sun_in_splendour", moon: "crescent_moon", crescent: "crescent_moon", star: "six_pointed_star",
  castle: "castle_gate", gate: "castle_gate", keep: "tower", boat: "ship", galley: "ship",
  swords: "crossed_swords", blade: "sword", cup: "chalice", grail: "chalice", goblet: "chalice",
  hammer: "hammer", scales: "scales", justice: "scales", death: "skull",
  spider: "giant_spider", cerberus: "three_headed_dog", mermaid: "merfolk", merman: "merfolk",
  seahorse: "hippocamp", thestral: "skeletal_winged_horse",
};

/**
 * The charge a word means, from the ids that exist. An exact id, then a known
 * word, then any id containing the word whole — the plain one before its
 * alternates. Null rather than a guess: arms with no charge are still arms.
 */
export function chargeFor(word: unknown, ids: string[]): string | null {
  const w = String(word ?? "").toLowerCase().replace(/[^a-z ]+/g, " ").trim().replace(/\s+/g, "_");
  if (!w) return null;
  const have = new Set(ids);
  if (have.has(w)) return w;
  for (const part of [w, ...w.split("_").reverse()]) {
    const mapped = CHARGE_WORDS[part] ?? CHARGE_WORDS[part.replace(/s$/, "")];
    if (mapped && have.has(mapped)) return mapped;
  }
  for (const part of w.split("_").filter((p) => p.length > 2)) {
    const hits = ids.filter((id) => id.split("_").includes(part) || id.split("_").includes(part.replace(/s$/, "")));
    if (hits.length) return hits.find((id) => !/_alt/.test(id)) ?? hits[0];
  }
  return null;
}

/** A blazon from whatever came in, or null if not even the field can be read. */
export function normaliseBlazon(raw: any, ids: string[]): Blazon | null {
  if (!raw || typeof raw !== "object") return null;
  const colours = (Array.isArray(raw.field?.colours) ? raw.field.colours : [raw.field?.colour ?? raw.field])
    .map(tinctureOf).filter((t: Tincture | null): t is Tincture => !!t).slice(0, 2) as Tincture[];
  if (!colours.length) return null;
  let split: Split = SPLITS.includes(raw.field?.split) ? raw.field.split : "none";
  if (colours.length < 2 || colours[0] === colours[1]) split = "none";
  const field = { split, colours: (split === "none" ? [colours[0]] : [colours[0], colours[1]]) as Blazon["field"]["colours"] };
  const bandType = BANDS.includes(raw.band?.type) ? raw.band.type as Band : null;
  const bandColour = tinctureOf(raw.band?.colour);
  const chargeType = raw.charge ? chargeFor(raw.charge.type, ids) : null;
  const chargeColour = tinctureOf(raw.charge?.colour);
  const count = [1, 2, 3].includes(Number(raw.charge?.count)) ? Number(raw.charge.count) as 1 | 2 | 3 : 1;
  return {
    field,
    band: bandType && bandColour ? { type: bandType, colour: bandColour } : null,
    charge: chargeType && chargeColour ? { type: chargeType, colour: chargeColour, count } : null,
  };
}

/** How light a tincture is, 0 to 1 — what actually decides whether it shows. */
function lightness(t: Tincture): number {
  const [r, g, bl] = [1, 3, 5].map((i) => parseInt(TINCTURES[t].hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

/** How well one tincture stands out against another, as a WCAG contrast ratio. */
function contrast(a: Tincture, b: Tincture): number {
  const [x, y] = [lightness(a), lightness(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * The tincture that stands out best against every colour it sits across. A
 * charge on a divided field crosses both halves, and the rule of tincture
 * says nothing about that case — gold on a field half silver, half purple
 * keeps the rule on one side and vanishes on the other.
 */
function standsOut(grounds: Tincture[], keep?: Tincture): Tincture {
  const score = (t: Tincture) => Math.min(...grounds.map((g) => contrast(t, g)));
  if (keep && !grounds.includes(keep) && score(keep) >= 3) return keep;
  return (Object.keys(TINCTURES) as Tincture[]).filter((t) => !grounds.includes(t))
    .sort((p, q) => score(q) - score(p))[0];
}

/** Where a blazon breaks the rule of tincture, in words a person can act on. */
export function contrastProblems(b: Blazon): string[] {
  const out: string[] = [];
  const ground = b.field.colours;
  const clash = (t: Tincture) => ground.length === 1 && isMetal(t) === isMetal(ground[0]);
  if (b.band && clash(b.band.colour)) out.push(`${TINCTURES[b.band.colour].name} band on ${TINCTURES[ground[0]].name}`);
  const under = b.band && ["fess", "pale", "cross", "saltire"].includes(b.band.type) && b.charge?.count === 1 ? b.band.colour : null;
  if (b.charge && (under ? isMetal(b.charge.colour) === isMetal(under) : clash(b.charge.colour))) {
    out.push(`${TINCTURES[b.charge.colour].name} charge on ${TINCTURES[under ?? ground[0]].name}`);
  }
  // Only when a better colour exists: some pairs of halves (purple and silver)
  // have no tincture that stands out well against both, and the best of a bad
  // lot is not a problem anybody can fix.
  if (b.charge && !under && ground.length === 2 && standsOut(ground, b.charge.colour) !== b.charge.colour) {
    out.push(`${TINCTURES[b.charge.colour].name} charge is lost against the ${ground.map((g) => TINCTURES[g].name).join(" and ")} field`);
  }
  return out;
}

/** The nearest blazon that keeps the rule: a clashing band or charge takes the other class's tincture. */
export function withContrast(b: Blazon): Blazon {
  // Same class as what it sits on: a colour on metal, gold on colour.
  const flip = (t: Tincture, ground: Tincture): Tincture =>
    isMetal(t) !== isMetal(ground) ? t : isMetal(ground) ? (ground === "or" ? "sable" : "gules") : "or";
  const ground = b.field.colours[0];
  const single = b.field.colours.length === 1;
  const band = b.band && single ? { ...b.band, colour: flip(b.band.colour, ground) } : b.band;
  const under = band && ["fess", "pale", "cross", "saltire"].includes(band.type) && b.charge?.count === 1 ? band.colour : null;
  const charge = !b.charge ? null
    : under || single ? { ...b.charge, colour: flip(b.charge.colour, under ?? ground) }
    : { ...b.charge, colour: standsOut(b.field.colours, b.charge.colour) };
  return { ...b, band, charge };
}

/** FNV-1a: small, stable, and the same on every machine. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (const ch of s.toLowerCase().trim()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Arms for a faction nobody has given any, from its name alone. The same name
 * always gives the same shield, on every machine, so a faction does not
 * change its colours between one look and the next. Always keeps the rule of
 * tincture, whatever the setting, since nobody chose to break it.
 */
export function armsFromName(name: string, ids: string[]): Blazon {
  const h = hash(name);
  const metals: Tincture[] = ["or", "argent"];
  const colours: Tincture[] = ["gules", "azure", "vert", "sable", "purpure"];
  const metal = metals[h % 2];
  const colour = colours[(h >>> 1) % colours.length];
  const metalField = ((h >>> 4) & 3) === 0;
  const ground = metalField ? metal : colour;
  const other = metalField ? colour : metal;
  const splitRoll = (h >>> 6) % 6;
  const split: Split = splitRoll === 0 ? "per_pale" : splitRoll === 1 ? "per_fess" : "none";
  const usable = ids.filter((id) => !/_alt/.test(id)).sort();
  const charge = usable.length ? usable[(h >>> 9) % usable.length] : null;
  return withContrast({
    field: split === "none" ? { split, colours: [ground] } : { split, colours: [ground, other] },
    band: null,
    charge: charge ? { type: charge, colour: split === "none" ? other : standsOut([ground, other]), count: 1 } : null,
  });
}

// ---- drawing ---------------------------------------------------------------

const SHIELD = "M6 6H94V58C94 86 74 104 50 114C26 104 6 86 6 58Z";
const BADGE = "M50 14A46 46 0 1 1 49.99 14Z";

function bandShape(type: Band): string {
  switch (type) {
    case "chief": return `<rect x="0" y="0" width="100" height="32"/>`;
    case "fess": return `<rect x="0" y="46" width="100" height="24"/>`;
    case "pale": return `<rect x="38" y="0" width="24" height="120"/>`;
    case "bend": return `<polygon points="0,0 18,0 100,96 100,120 82,120 0,24"/>`;
    case "chevron": return `<polygon points="0,96 50,40 100,96 100,118 50,62 0,118"/>`;
    case "cross": return `<rect x="40" y="0" width="20" height="120"/><rect x="0" y="48" width="100" height="20"/>`;
    case "saltire": return `<polygon points="0,0 14,0 100,106 100,120 86,120 0,14"/><polygon points="100,0 86,0 0,106 0,120 14,120 100,14"/>`;
    case "bordure": return "";
  }
}

/** Where the charges go, as boxes on the 100 x 120 shield: one, two side by side, or two over one. */
function chargeBoxes(count: 1 | 2 | 3, chief: boolean): [number, number, number][] {
  const top = chief ? 36 : 20;
  if (count === 1) return chief ? [[27, 38, 46]] : [[22, 26, 56]];
  if (count === 2) return [[12, top + 16, 36], [52, top + 16, 36]];
  return [[16, top + 4, 30], [54, top + 4, 30], [35, top + 40, 30]];
}

/**
 * The arms as an SVG, from a blazon and the charge set's path data. `id`
 * keeps one drawing's clipping from catching another's on the same page.
 * A shield for most stories; a round badge for modern ones.
 */
export function drawArms(b: Blazon, paths: Record<string, string>, o: { style?: "shield" | "badge"; id?: string; label?: string } = {}): string {
  const id = (o.id ?? "arms").replace(/[^a-zA-Z0-9_-]/g, "");
  const outline = o.style === "badge" ? BADGE : SHIELD;
  const hex = (t: Tincture) => TINCTURES[t].hex;
  const [a, c] = b.field.colours;
  const second = c ? hex(c) : hex(a);
  const division =
    b.field.split === "per_pale" ? `<rect x="50" y="0" width="50" height="120" fill="${second}"/>` :
    b.field.split === "per_fess" ? `<rect x="0" y="60" width="100" height="60" fill="${second}"/>` :
    b.field.split === "per_bend" ? `<polygon points="0,0 100,120 0,120" fill="${second}"/>` :
    b.field.split === "quarterly" ? `<rect x="50" y="0" width="50" height="60" fill="${second}"/><rect x="0" y="60" width="50" height="60" fill="${second}"/>` : "";
  const band = b.band
    ? b.band.type === "bordure"
      ? `<path d="${outline}" fill="none" stroke="${hex(b.band.colour)}" stroke-width="14"/>`
      : `<g fill="${hex(b.band.colour)}">${bandShape(b.band.type)}</g>`
    : "";
  const d = b.charge ? paths[b.charge.type] : "";
  const charges = b.charge && d
    ? chargeBoxes(b.charge.count, b.band?.type === "chief")
        // A transform, not a nested <svg>: a page's own "svg { width: ... }" would
        // catch a nested one and blow the charge up across the shield.
        .map(([x, y, s]) => `<path transform="translate(${x} ${y}) scale(${s / 100})" fill="${hex(b.charge!.colour)}" fill-rule="evenodd" d="${d}"/>`)
        .join("")
    : "";
  const label = String(o.label ?? "Arms").replace(/[<>&"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" role="img" aria-label="${label}">` +
    `<defs><clipPath id="${id}-clip"><path d="${outline}"/></clipPath></defs>` +
    `<g clip-path="url(#${id}-clip)"><rect width="100" height="120" fill="${hex(a)}"/>${division}${band}${charges}</g>` +
    `<path d="${outline}" fill="none" stroke="#c8994f" stroke-opacity="0.7" stroke-width="2"/></svg>`;
}
