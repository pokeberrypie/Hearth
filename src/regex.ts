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
};

const bool = (v: unknown, fallback = false) => (v === undefined || v === null ? fallback : !!v);
const depth = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || !Number.isFinite(+(v as any)) ? null : Math.max(0, Math.trunc(+(v as any)));

/** Accepts a SillyTavern script, or one of ours round-tripping. */
export function normaliseScript(raw: any, source = ""): RegexScript {
  const md = bool(raw?.markdownOnly ?? raw?.display);
  const po = bool(raw?.promptOnly ?? raw?.prompt);
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
  };
}

/**
 * Turns `/pattern/flags` into a RegExp. Returns null for anything unparseable
 * rather than throwing: one bad script in an imported pack of sixty must not
 * take the other fifty-nine down with it.
 */
export function compile(find: string): RegExp | null {
  const raw = String(find ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^\/([\s\S]*)\/([gimsuy]*)$/);
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
export function runScript(text: string, s: RegexScript): string {
  const re = compile(s.find);
  if (!re) return text;
  const clean = (v: string) => s.trim.reduce((acc, t) => acc.split(t).join(""), v);
  try {
    return text.replace(re, (...args) => {
      const groups = args.slice(0, -2).map((g) => (typeof g === "string" ? clean(g) : ""));
      const whole = groups[0] ?? "";
      return s.replace
        .replace(/\{\{match\}\}/gi, whole)
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
): string {
  let out = String(text ?? "");
  for (const s of scripts) {
    if (applies(s, where, placement, depthFromEnd)) out = runScript(out, s);
  }
  return out;
}
