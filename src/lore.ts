/**
 * World info / lorebook activation.
 *
 * Entries carry keywords. Before a generation we scan the recent transcript,
 * work out which entries the conversation has touched, and splice their content
 * into the prompt. SillyTavern's field names and numeric enums are preserved on
 * import so books move across unchanged.
 */

export type Logic = "and_any" | "not_all" | "not_any" | "and_all";
export type Position = "before_char" | "after_char" | "at_depth";

export type LoreEntry = {
  id: string;
  keys: string[];
  secondary: string[];
  logic: Logic;
  content: string;
  comment: string;
  constant: boolean;      // always on, no keyword needed
  enabled: boolean;
  order: number;          // lower inserts earlier
  position: Position;
  depth: number;          // for at_depth: how many messages up from the end
  probability: number;    // 0–100
  caseSensitive: boolean;
  wholeWords: boolean;
  scanDepth: number | null;
  excludeRecursion: boolean;  // never triggered by another entry's content
  preventRecursion: boolean;  // its own content never triggers others
};

const ST_LOGIC: Record<number, Logic> = {
  0: "and_any", 1: "not_all", 2: "not_any", 3: "and_all",
};
// ST positions: 0 before char, 1 after char, 2/3 author's note, 4 at depth.
const ST_POSITION: Record<number, Position> = {
  0: "before_char", 1: "after_char", 2: "at_depth", 3: "at_depth", 4: "at_depth",
};

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
  : typeof v === "string" && v.trim() ? v.split(",").map((x) => x.trim()).filter(Boolean)
  : [];

let seq = 0;
const nextId = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Accepts a SillyTavern entry or one of ours. */
export function normaliseEntry(raw: any): LoreEntry {
  const num = (v: unknown, d: number) => (Number.isFinite(+v!) ? +v! : d);
  return {
    id: String(raw.id ?? raw.uid ?? nextId()),
    keys: arr(raw.keys ?? raw.key),
    secondary: arr(raw.secondary ?? raw.keysecondary),
    logic: typeof raw.logic === "string" ? raw.logic : ST_LOGIC[num(raw.selectiveLogic, 0)] ?? "and_any",
    content: String(raw.content ?? ""),
    comment: String(raw.comment ?? raw.title ?? ""),
    constant: !!(raw.constant ?? false),
    enabled: raw.enabled !== undefined ? !!raw.enabled : !(raw.disable ?? false),
    order: num(raw.order ?? raw.insertion_order, 100),
    position: typeof raw.position === "string" ? raw.position
      : ST_POSITION[num(raw.position, 1)] ?? "after_char",
    depth: num(raw.depth, 4),
    probability: raw.useProbability === false ? 100 : num(raw.probability, 100),
    caseSensitive: !!(raw.caseSensitive ?? false),
    wholeWords: raw.wholeWords !== undefined ? !!raw.wholeWords
      : raw.matchWholeWords !== undefined ? !!raw.matchWholeWords : true,
    scanDepth: raw.scanDepth === null || raw.scanDepth === undefined ? null : num(raw.scanDepth, 4),
    excludeRecursion: !!(raw.excludeRecursion ?? false),
    preventRecursion: !!(raw.preventRecursion ?? false),
  };
}

export function normaliseBook(raw: any): LoreEntry[] {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries
    : raw?.entries && typeof raw.entries === "object" ? Object.values(raw.entries) : [];
  return list.map(normaliseEntry);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function hit(haystack: string, key: string, caseSensitive: boolean, wholeWords: boolean) {
  const flags = caseSensitive ? "" : "i";
  // Whole-word matching only makes sense for keys that start and end on a word
  // character; "don't" or ":3" would never match with \b bolted on.
  const wordish = /^\w/.test(key) && /\w$/.test(key);
  const pattern = wholeWords && wordish ? `\\b${escapeRe(key)}\\b` : escapeRe(key);
  return new RegExp(pattern, flags).test(haystack);
}

function matches(entry: LoreEntry, text: string): boolean {
  const primary = entry.keys.some((k) => hit(text, k, entry.caseSensitive, entry.wholeWords));
  if (!primary) return false;
  if (!entry.secondary.length) return true;

  const found = entry.secondary.map((k) => hit(text, k, entry.caseSensitive, entry.wholeWords));
  switch (entry.logic) {
    case "and_any": return found.some(Boolean);
    case "and_all": return found.every(Boolean);
    case "not_any": return !found.some(Boolean);
    case "not_all": return !found.every(Boolean);
  }
}

export type Activated = { entry: LoreEntry; via: "constant" | "keyword" | "recursion" };

export type ScanOptions = {
  scanDepth?: number;       // messages of history to search
  maxChars?: number;        // rough budget for injected text
  maxRecursion?: number;
  roll?: () => number;      // injectable for tests
};

/**
 * Works out which entries fire for a given transcript.
 * Runs repeatedly so an activated entry's own text can trigger others.
 */
export function activate(
  entries: LoreEntry[],
  history: { role: string; content: string }[],
  opts: ScanOptions = {},
): Activated[] {
  const scanDepth = opts.scanDepth ?? 4;
  const maxChars = opts.maxChars ?? 8000;
  const maxRecursion = opts.maxRecursion ?? 3;
  const roll = opts.roll ?? (() => Math.random() * 100);

  const live = entries.filter((e) => e.enabled && e.content.trim());
  const chosen = new Map<string, Activated>();
  let budget = maxChars;

  const take = (entry: LoreEntry, via: Activated["via"]) => {
    if (chosen.has(entry.id)) return false;
    if (entry.probability < 100 && roll() >= entry.probability) return false;
    if (entry.content.length > budget) return false;
    budget -= entry.content.length;
    chosen.set(entry.id, { entry, via });
    return true;
  };

  for (const e of live) if (e.constant) take(e, "constant");

  const recent = (depth: number) =>
    history.slice(-Math.max(1, depth)).map((m) => m.content).join("\n");

  for (const e of live) {
    if (e.constant || chosen.has(e.id)) continue;
    if (matches(e, recent(e.scanDepth ?? scanDepth))) take(e, "keyword");
  }

  for (let pass = 0; pass < maxRecursion; pass++) {
    const seed = [...chosen.values()]
      .filter((a) => !a.entry.preventRecursion)
      .map((a) => a.entry.content)
      .join("\n");
    if (!seed) break;

    let added = false;
    for (const e of live) {
      if (chosen.has(e.id) || e.constant || e.excludeRecursion) continue;
      if (matches(e, seed) && take(e, "recursion")) added = true;
    }
    if (!added) break;
  }

  return [...chosen.values()].sort((a, b) => a.entry.order - b.entry.order);
}

/** Groups activated entries by where they want to sit in the prompt. */
export function place(active: Activated[]) {
  const text = (list: Activated[]) => list.map((a) => a.entry.content.trim()).join("\n\n");
  return {
    beforeChar: text(active.filter((a) => a.entry.position === "before_char")),
    afterChar: text(active.filter((a) => a.entry.position === "after_char")),
    atDepth: active
      .filter((a) => a.entry.position === "at_depth")
      .map((a) => ({ depth: a.entry.depth, content: a.entry.content.trim() })),
  };
}
