/**
 * SillyTavern regex scripts.
 *
 * A script is a find/replace over message text, with two independent switches
 * deciding where it applies: to what the model is *sent* (`promptOnly`) and to
 * what you *see* (`markdownOnly`). A preset like DEUS EX MACHINA leans on both
 * — display scripts fold its `<status>` block into a card, prompt scripts strip
 * the same blocks out of older turns so they stop being resent forever. Without
 * the prompt half, a long scene quietly pays for every status block it has ever
 * produced.
 *
 * Depth is counted from the end of the transcript: the newest message is depth
 * 0. `minDepth: 6` therefore means "only messages at least six turns back",
 * which is how "remove older X from context" is expressed.
 *
 * Nothing here touches stored messages. SillyTavern's third mode — a script
 * with neither switch set rewrites the saved message — is treated as "both",
 * because a find/replace that silently edits your transcript is not a thing to
 * do on someone's behalf.
 */

/** SillyTavern's placement enum. Only the first two are worth honouring here. */
export const PLACEMENT = { userInput: 1, aiOutput: 2, slashCommand: 3, worldInfo: 5, reasoning: 6 } as const;

/**
 * Placements Hearth actually runs. The others are kept — on the script and on
 * export — so a script round-trips to SillyTavern intact, but nothing in
 * Hearth is a slash command, a world-info entry or a reasoning block for them
 * to run on, and the editor says so rather than offering a switch that does
 * nothing.
 */
export const RUNS_HERE = new Set<number>([PLACEMENT.userInput, PLACEMENT.aiOutput]);

/** How `{{char}}` and friends are treated inside the find pattern. SillyTavern's enum. */
export const SUBSTITUTE = { none: 0, raw: 1, escaped: 2 } as const;

/** Every field SillyTavern's regex export writes, so anything else can be kept aside. */
const ST_KEYS = new Set([
  "id", "scriptName", "findRegex", "replaceString", "trimStrings", "placement",
  "disabled", "markdownOnly", "promptOnly", "runOnEdit", "substituteRegex",
  "minDepth", "maxDepth",
]);
/** Ours, for a script that is round-tripping through Hearth's own storage. */
const OUR_KEYS = new Set([
  "name", "find", "replace", "trim", "enabled", "display", "prompt", "source",
  "substitute", "runOnEdit", "rewrite", "extra",
  // What the API adds about where a script lives; stored in columns, not here.
  "presetId", "presetName", "active", "position",
]);

export type RegexScript = {
  id: string;
  name: string;
  /** The raw `/pattern/flags` string, kept as written so it can be edited back. */
  find: string;
  replace: string;
  /** Strings deleted from each match before the replacement is built. */
  trim: string[];
  placement: number[];
  enabled: boolean;
  /** Applies to what is drawn on screen. */
  display: boolean;
  /** Applies to what is sent to the model. */
  prompt: boolean;
  minDepth: number | null;
  maxDepth: number | null;
  /** Where it came from — a preset's name, or a file. Shown in the list. */
  source: string;
  /** SillyTavern's substituteRegex: whether {{char}}/{{user}} are filled into `find`. */
  substitute: number;
  /** Kept for export. Hearth never edits a stored message, so there is nothing to re-run on. */
  runOnEdit: boolean;
  /**
   * The script came in with neither display nor prompt set, which in
   * SillyTavern means "rewrite the saved message". Hearth runs it on both
   * instead (see the top of this file) and remembers, so an export says what
   * the original said.
   */
  rewrite: boolean;
  /** Any field this version does not know, carried through untouched. */
  extra: Record<string, unknown>;
};

const bool = (v: unknown, fallback = false) => (v === undefined || v === null ? fallback : !!v);
const depth = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || !Number.isFinite(+(v as any)) ? null : Math.max(0, Math.trunc(+(v as any)));

/** Accepts a SillyTavern script, or one of ours round-tripping. */
export function normaliseScript(raw: any, source = ""): RegexScript {
  const ours = raw && typeof raw === "object" && ("display" in raw || "prompt" in raw);
  const md = bool(raw?.markdownOnly ?? raw?.display);
  const po = bool(raw?.promptOnly ?? raw?.prompt);
  const extra: Record<string, unknown> = { ...(ours && raw?.extra && typeof raw.extra === "object" ? raw.extra : {}) };
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      if (!ST_KEYS.has(k) && !OUR_KEYS.has(k)) extra[k] = v;
    }
  }
  const sub = Number(raw?.substituteRegex ?? raw?.substitute);
  return {
    id: String(raw?.id ?? raw?.scriptName ?? Math.random().toString(36).slice(2)),
    name: String(raw?.scriptName ?? raw?.name ?? "Untitled script").trim() || "Untitled script",
    find: String(raw?.findRegex ?? raw?.find ?? ""),
    replace: String(raw?.replaceString ?? raw?.replace ?? ""),
    trim: Array.isArray(raw?.trimStrings ?? raw?.trim)
      ? (raw.trimStrings ?? raw.trim).filter((x: unknown) => typeof x === "string" && x !== "")
      : [],
    placement: Array.isArray(raw?.placement) && raw.placement.length
      ? raw.placement.map((n: unknown) => Number(n)).filter(Number.isFinite)
      : [PLACEMENT.aiOutput],
    // ST stores the negative; ours stores the positive, because every list of
    // things with a switch reads better when the switch means "on".
    enabled: raw?.enabled !== undefined ? !!raw.enabled : !bool(raw?.disabled),
    // Neither flag set means ST would rewrite the stored message. We do both
    // instead, which is the same visible result without editing the transcript.
    display: md || (!md && !po),
    prompt: po || (!md && !po),
    minDepth: depth(raw?.minDepth),
    maxDepth: depth(raw?.maxDepth),
    source: String(raw?.source ?? source ?? ""),
    substitute: sub === SUBSTITUTE.raw || sub === SUBSTITUTE.escaped ? sub : SUBSTITUTE.none,
    runOnEdit: bool(raw?.runOnEdit),
    rewrite: ours ? bool(raw?.rewrite) : !md && !po,
    extra,
  };
}

/**
 * Back into SillyTavern's shape, for export. Unknown fields first so the
 * known ones win; flags rebuilt from what the script does now, except that a
 * script which arrived as a rewrite and still runs both ways goes back out as
 * one — that was SillyTavern's meaning, and Hearth only ever stood in for it.
 */
export function toSillyTavern(s: RegexScript): Record<string, unknown> {
  const both = s.display && s.prompt;
  return {
    ...s.extra,
    id: s.id,
    scriptName: s.name,
    findRegex: s.find,
    replaceString: s.replace,
    trimStrings: s.trim,
    placement: s.placement,
    disabled: !s.enabled,
    markdownOnly: both ? !s.rewrite : s.display,
    promptOnly: both ? !s.rewrite : s.prompt,
    runOnEdit: s.runOnEdit,
    substituteRegex: s.substitute,
    minDepth: s.minDepth,
    maxDepth: s.maxDepth,
  };
}

/** What `{{char}}` and `{{user}}` stand for, wherever a script runs. */
export type Names = { char?: string; user?: string };

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** The find pattern with names filled in, as SillyTavern's substituteRegex asks. */
export function findWith(s: Pick<RegexScript, "find" | "substitute">, names: Names = {}): string {
  if (!s.substitute) return s.find;
  const fill = (v: string | undefined) => (s.substitute === SUBSTITUTE.escaped ? escapeRe(v ?? "") : v ?? "");
  return s.find
    .replace(/\{\{char\}\}/gi, fill(names.char))
    .replace(/\{\{user\}\}/gi, fill(names.user));
}

/** Why a pattern will not compile, or null. For the editor, which must say why. */
export function compileError(find: string): string | null {
  const raw = String(find ?? "").trim();
  if (!raw) return "The find pattern is empty.";
  const m = raw.match(/^\/([\s\S]*)\/([a-z]*)$/);
  if (m && /[^dgimsuy]/.test(m[2])) return `Unknown flag in "${m[2]}". JavaScript allows d, g, i, m, s, u and y.`;
  try {
    m ? new RegExp(m[1], m[2]) : new RegExp(raw);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * Turns `/pattern/flags` into a RegExp. Returns null for anything unparseable
 * rather than throwing: one bad script in an imported pack of sixty must not
 * take the other fifty-nine down with it.
 */
export function compile(find: string): RegExp | null {
  const raw = String(find ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^\/([\s\S]*)\/([dgimsuy]*)$/);
  try {
    return m ? new RegExp(m[1], m[2]) : new RegExp(raw);
  } catch {
    return null;
  }
}

/** Whether a script wants this message, given where it sits and how old it is. */
export function applies(
  s: RegexScript,
  where: "prompt" | "display",
  placement: number,
  depthFromEnd: number,
): boolean {
  if (!s.enabled) return false;
  if (where === "prompt" ? !s.prompt : !s.display) return false;
  if (!s.placement.includes(placement)) return false;
  if (s.minDepth !== null && depthFromEnd < s.minDepth) return false;
  if (s.maxDepth !== null && depthFromEnd > s.maxDepth) return false;
  return true;
}

/**
 * Runs one script over a string.
 *
 * `{{match}}` in the replacement is SillyTavern's name for the whole match;
 * `$1`-style group references are the platform's own and are left to it.
 * `trim` strings come out of the match before either is worked out.
 */
export function runScript(text: string, s: RegexScript, names: Names = {}): string {
  const re = compile(findWith(s, names));
  if (!re) return text;
  const clean = (v: string) => s.trim.reduce((acc, t) => acc.split(t).join(""), v);
  try {
    return text.replace(re, (...args) => {
      const groups = args.slice(0, -2).map((g) => (typeof g === "string" ? clean(g) : ""));
      const whole = groups[0] ?? "";
      return s.replace
        .replace(/\{\{match\}\}/gi, whole)
        // SillyTavern fills names into the replacement whatever substituteRegex says.
        .replace(/\{\{char\}\}/gi, () => names.char ?? "{{char}}")
        .replace(/\{\{user\}\}/gi, () => names.user ?? "{{user}}")
        // $1..$9 are resolved here rather than handed back to String.replace,
        // because the group text has had `trim` applied and the platform would
        // otherwise substitute the untrimmed original.
        .replace(/\$(\d)/g, (_, d) => groups[Number(d)] ?? "");
    });
  } catch {
    // A pathological pattern is a bug in the script, not a reason to lose the
    // message it was pointed at.
    return text;
  }
}

/** Every script that applies, in order, over one message. */
export function applyScripts(
  text: string,
  scripts: RegexScript[],
  where: "prompt" | "display",
  placement: number,
  depthFromEnd: number,
  names: Names = {},
): string {
  let out = String(text ?? "");
  for (const s of scripts) {
    if (applies(s, where, placement, depthFromEnd)) out = runScript(out, s, names);
  }
  return out;
}

/**
 * Where a single script matches in a piece of text, for the test chamber to
 * highlight. Capped, because a pattern that matches every character would
 * otherwise hand the page a list as long as the text.
 */
export function matchesOf(text: string, s: RegexScript, names: Names = {}, cap = 500): [number, number][] {
  const re = compile(findWith(s, names));
  if (!re) return [];
  const all = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const out: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = all.exec(text)) && out.length < cap) {
    out.push([m.index, m.index + m[0].length]);
    if (m[0].length === 0) all.lastIndex++;
    // Without the global flag a script replaces only its first match, so
    // only its first match is a match that counts.
    if (!re.flags.includes("g")) break;
  }
  return out;
}
