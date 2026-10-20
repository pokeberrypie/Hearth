/**
 * The Steward: the one who keeps the records while the story is being told.
 *
 * A second, quieter model call that runs after replies, reads what has just
 * happened, and reports it — so that Story World knows what day it is and what
 * has happened without the story model having to remember four hundred
 * messages of it. It can be a different, cheaper model from the one telling
 * the story, and most of the time it will be: GLM, DeepSeek, Kimi, Gemma.
 * Everything in this file assumes that model is having a bad day.
 *
 * So the Steward is never trusted, only checked:
 *
 * - **It answers in lines, not JSON.** `TIME | three days | "quote"`. A small
 *   model gets a line right far more often than a nested object, and one bad
 *   line costs that line, not the whole answer.
 * - **Every line quotes the story.** The quote has to actually be there — in
 *   the text the Steward was shown, outside any tracker block — or the line
 *   is dropped. That one rule throws out most invented events, and it also
 *   says which message a fact came from.
 * - **It never does arithmetic.** It says how long, and src/calendar.ts
 *   decides whether that can be read at all.
 * - **It never names anybody new by typing.** It is given a numbered list of
 *   who is in the story and answers with numbers, so "Jamie" and "Ser Jaime"
 *   cannot become two more Jaimes.
 * - **Anything big waits for a person.** A jump past the chosen limit is
 *   proposed, not applied.
 *
 * And it never writes into a message. What it finds goes into the chronicle
 * and nowhere else; the story on screen is exactly what the story model wrote.
 *
 * Pure: calling the model and storing what survives is index.ts's business.
 */

import { readSpan, type Calendar, type Moment } from "./calendar";

/** Someone the Steward may refer to, by number. */
export type Person = { name: string; note?: string };

/** One message as the Steward is shown it. */
export type Passage = { id: string; who: string; text: string };

export type Claim =
  | { kind: "time"; span: number; said: string; evidence: string; message_id: string; proposed: boolean }
  | { kind: "event"; title: string; people: string[]; evidence: string; message_id: string };

export type Dropped = { line: string; why: string };

/** How far time may move on its own before a person is asked; -1 for never ask. */
export type Limits = { askAboveMinutes: number; maxEvents: number };

export const DEFAULT_LIMITS: Limits = { askAboveMinutes: 7 * 1440, maxEvents: 5 };

/**
 * Blocks a preset has the story model write its working-out into. They are
 * folded away on screen, and they are cut out of what the Steward reads:
 * a tracker's "Location: the stables" is the story model's guess about the
 * story, not the story, and a quote taken from one proves nothing.
 */
const SCAFFOLD = /<(status|tracker|thinking|think|thoughts|true_thoughts|analysis|reasoning|scene_plan|scene-plan|sceneplan|plan|notes|momentum|threads|summary|details)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** A message as the Steward should read it: the story, without the scaffolding. */
export function storyOnly(text: string): string {
  return String(text ?? "")
    .replace(SCAFFOLD, " ")
    .replace(/<\/?[a-z][\w-]*[^>]*>/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const STEWARD_SYSTEM = [
  "You keep the records for a story. You read the latest part of it and report what it establishes, as short lines in a fixed format. You never continue the story, never explain yourself, and never answer in JSON.",
  "",
  "Write each finding on its own line, exactly like this:",
  'TIME | how much time passed | "the exact words from the story that show it"',
  'EVENT | a short title for something that happened | "the exact words from the story that show it"',
  "",
  "Rules:",
  "- The quote must be copied exactly from the story: four to twenty-five words, in the story's own language.",
  "- TIME only when the story says time passed: \"three days later\", \"they rode until dawn\". Say how long in plain words (\"3 days\", \"until dawn\").",
  "- EVENT only for something that actually happened in this part. Not plans, threats, guesses, dreams, or memories of the past.",
  "- At most one TIME line and five EVENT lines.",
  "- If nothing worth recording happened, write only: NONE",
].join("\n");

/** The part of the request that changes: who is here, when it is, and what was said. */
export function stewardPrompt(people: Person[], nowText: string, passages: Passage[]): string {
  const roster = people.length
    ? people.map((p, i) => `${i + 1}. ${p.name}${p.note ? ` (${p.note})` : ""}`).join("\n")
    : "(nobody named yet)";
  const story = passages
    .map((p) => `${p.who}: ${storyOnly(p.text)}`)
    .filter((l) => l.trim())
    .join("\n\n");
  return `People in this story:\n${roster}\n\nIt is now: ${nowText}\n\nThe story so far, latest part:\n\n${story}\n\nWrite your lines now.`;
}

/**
 * Some models will not take a system prompt at all — Gemma on Google's own
 * API refuses one outright — so for them the instructions go in front of the
 * request instead. It costs nothing for the models that would have accepted
 * it the other way, but it is only done where it is known to be needed.
 */
export function needsFoldedSystem(model: string): boolean {
  return /gemma/i.test(String(model ?? ""));
}

export function stewardRequest(model: string, people: Person[], nowText: string, passages: Passage[]) {
  const user = stewardPrompt(people, nowText, passages);
  return needsFoldedSystem(model)
    ? { system: "", messages: [{ role: "user" as const, content: `${STEWARD_SYSTEM}\n\n---\n\n${user}` }] }
    : { system: STEWARD_SYSTEM, messages: [{ role: "user" as const, content: user }] };
}

// ---- reading the answer ---------------------------------------------------

const KIND_WORDS: Record<string, "time" | "event" | "none"> = {
  TIME: "time", TIMEPASSED: "time", TIMESKIP: "time", ELAPSED: "time", DURATION: "time",
  EVENT: "event", EVENTS: "event", HAPPENED: "event",
  NONE: "none", NOTHING: "none", NULL: "none",
};

/**
 * The answer with the model's thinking taken out. Reasoning models are told
 * not to think here, and some of them do anyway, inline: a `<think>` block
 * with no end means everything after it is thinking too, and none of it is
 * an answer.
 */
export function withoutThinking(raw: string): string {
  let t = String(raw ?? "");
  t = t.replace(/<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "\n");
  t = t.replace(/<(think|thinking|reasoning)\b[^>]*>[\s\S]*$/i, "\n");
  // A closing tag with no opening one: the provider stripped the opening.
  const close = t.search(/<\/(think|thinking|reasoning)\s*>/i);
  if (close >= 0) t = t.slice(t.indexOf(">", close) + 1);
  return t;
}

/** One line, made comparable: bullets, numbering, bold and odd separators gone. */
function tidyLine(line: string): string {
  return line
    .trim()
    .replace(/^(?:[-*•·>]+|\d{1,3}[.)、]|[(（]\d{1,3}[)）])\s*/, "")
    .replace(/[｜¦│┃]/g, "|")
    .replace(/\*\*|__|`/g, "")
    .trim();
}

const QUOTES = /^["'“”„«»「」『』‘’*_\s]+|["'“”„«»「」『』‘’*_\s.,;:!?。！？，]+$/g;

const unquote = (s: string) => s.replace(QUOTES, "").trim();

export type Parsed = {
  time: { said: string; evidence: string }[];
  events: { title: string; people: string; evidence: string }[];
  none: boolean;
  dropped: Dropped[];
  /** Lines that were not findings at all — chatter, headings — counted, not judged. */
  noise: number;
};

/** The answer as lines, before anything is checked against the story. */
export function parseAnswer(raw: string): Parsed {
  const out: Parsed = { time: [], events: [], none: false, dropped: [], noise: 0 };
  const text = withoutThinking(raw).replace(/```[a-z]*\n?/gi, "");
  for (const original of text.split(/\r?\n/)) {
    const line = tidyLine(original);
    if (!line) continue;
    const parts = line.split("|").map((p) => p.trim());
    const kind = KIND_WORDS[parts[0].toUpperCase().replace(/[^A-Z]/g, "")];
    if (!kind) {
      if (/^none\b/i.test(line)) out.none = true;
      else out.noise++;
      continue;
    }
    if (kind === "none") { out.none = true; continue; }
    if (parts.length < 3) { out.dropped.push({ line: original.trim(), why: "no quote from the story" }); continue; }
    const evidence = unquote(parts[parts.length - 1]);
    const first = unquote(parts[1]);
    if (!evidence) { out.dropped.push({ line: original.trim(), why: "no quote from the story" }); continue; }
    if (!first) { out.dropped.push({ line: original.trim(), why: "nothing between the bars" }); continue; }
    if (kind === "time") out.time.push({ said: first, evidence });
    else out.events.push({ title: first, people: parts.length > 3 ? parts.slice(2, -1).join(",") : "", evidence });
  }
  return out;
}

// ---- checking it against the story ---------------------------------------

/** Text reduced to its words: case, accents of punctuation, quotes and dashes no longer matter. */
function words(text: string): string[] {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .replace(/'/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

/** Languages written without spaces are compared by characters instead of words. */
const unspaced = (s: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(s);

function lcs(a: string[], b: string[]): number {
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Which message a quote came from, or null if it did not come from any.
 *
 * Exact, once case and punctuation are set aside — or as near as a model
 * copying by hand gets: every word but one or two, in order, inside a single
 * message. A quote too short to mean anything ("he left") proves nothing and
 * is refused. When a quote appears in more than one message, the latest is
 * the one it is about.
 */
export function findEvidence(quote: string, passages: Passage[]): string | null {
  const q = words(quote);
  const tokens = unspaced(quote) ? [...q.join("")] : q;
  if (unspaced(quote) ? tokens.length < 6 : tokens.length < 3) return null;
  if (tokens.length > 60) return null;
  for (let i = passages.length - 1; i >= 0; i--) {
    const body = words(storyOnly(passages[i].text));
    const hay = unspaced(quote) ? [...body.join("")] : body;
    const joinedQ = tokens.join(" ");
    if (` ${hay.join(" ")} `.includes(` ${joinedQ} `)) return passages[i].id;
  }
  // Near misses: a dropped article, "the" for "a". Only within a stretch of
  // the message about as long as the quote — the same words scattered across
  // a long reply are not a quotation of anything.
  const allowed = tokens.length >= 8 ? 2 : 1;
  const want = new Set(tokens);
  for (let i = passages.length - 1; i >= 0; i--) {
    const body = words(storyOnly(passages[i].text));
    const hay = unspaced(quote) ? [...body.join("")] : body;
    for (let s = 0; s < hay.length; s++) {
      if (!want.has(hay[s])) continue;
      const kept = lcs(tokens, hay.slice(s, s + tokens.length + allowed));
      if (tokens.length - kept <= allowed && kept / tokens.length >= 0.85) return passages[i].id;
    }
  }
  return null;
}

/** Which of the listed people a reference means: a number from the list, or a name that matches one. */
export function whoIs(ref: string, people: Person[]): Person | null {
  const r = String(ref ?? "").trim().replace(/^#/, "");
  if (/^\d+$/.test(r)) return people[Number(r) - 1] ?? null;
  const want = r.toLowerCase();
  if (!want) return null;
  return people.find((p) => p.name.toLowerCase() === want)
    ?? people.find((p) => p.name.toLowerCase().split(/\s+/)[0] === want)
    ?? null;
}

/**
 * The answer, checked: what survives, what was thrown out and why.
 *
 * Time is read by the calendar, not the model — words it cannot read move
 * nothing — and a jump bigger than the limit comes back as a proposal. Only
 * the first readable time line is kept: two in one answer means the model is
 * describing one passage of time twice, or two it has confused.
 */
export function checkAnswer(
  raw: string,
  passages: Passage[],
  people: Person[],
  cal: Calendar,
  now: Moment,
  limits: Limits = DEFAULT_LIMITS,
): { claims: Claim[]; dropped: Dropped[]; none: boolean; noise: number } {
  const p = parseAnswer(raw);
  const claims: Claim[] = [];
  const dropped = [...p.dropped];

  for (const t of p.time) {
    const line = `TIME | ${t.said} | "${t.evidence}"`;
    if (claims.some((c) => c.kind === "time")) { dropped.push({ line, why: "more than one TIME line" }); continue; }
    const span = readSpan(cal, t.said, now);
    if (!span) { dropped.push({ line, why: "how long could not be read" }); continue; }
    const at = findEvidence(t.evidence, passages);
    if (!at) { dropped.push({ line, why: "the quote is not in the story" }); continue; }
    const proposed = limits.askAboveMinutes >= 0 && span > limits.askAboveMinutes;
    claims.push({ kind: "time", span, said: t.said, evidence: t.evidence, message_id: at, proposed });
  }

  const seen = new Set<string>();
  for (const e of p.events) {
    const line = `EVENT | ${e.title} | "${e.evidence}"`;
    const title = e.title.replace(/\s+/g, " ").slice(0, 120);
    const key = words(title).join(" ");
    if (!key) { dropped.push({ line, why: "no title" }); continue; }
    if (seen.has(key)) { dropped.push({ line, why: "the same event twice" }); continue; }
    if (seen.size >= limits.maxEvents) { dropped.push({ line, why: "more events than allowed in one go" }); continue; }
    const at = findEvidence(e.evidence, passages);
    if (!at) { dropped.push({ line, why: "the quote is not in the story" }); continue; }
    seen.add(key);
    const named = e.people.split(/[,;]+/).map((r) => whoIs(r, people)?.name).filter((n): n is string => !!n);
    claims.push({ kind: "event", title, people: [...new Set(named)], evidence: e.evidence, message_id: at });
  }

  return { claims, dropped, none: p.none && !claims.length, noise: p.noise };
}
