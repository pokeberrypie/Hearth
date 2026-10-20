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
import { BOND_STEP, STATUS_FIELDS, type StatusField } from "./chronicle";

/** Someone the Steward may refer to, by number. */
export type Person = {
  name: string;
  note?: string;
  /** In the scene now. Only they have their status tracked. */
  present?: boolean;
  /** What the tracker already says about them, so only changes are reported. */
  known?: Partial<Record<StatusField, string>>;
};

/** One message as the Steward is shown it. */
export type Passage = { id: string; who: string; text: string };

export type Claim =
  | { kind: "time"; span: number; said: string; evidence: string; message_id: string; proposed: boolean }
  | { kind: "event"; title: string; people: string[]; evidence: string; message_id: string }
  | { kind: "status"; subject: string; field: StatusField; value: string; evidence: string; message_id: string }
  | { kind: "bond"; from: string; to: string; amount: number; label: string; evidence: string; message_id: string }
  | { kind: "faction"; name: string; description: string; symbol: string; evidence: string; message_id: string }
  | { kind: "thread"; name: string; open: boolean; evidence: string; message_id: string }
  | { kind: "scene"; evidence: string; message_id: string; to?: string };

export type Dropped = { line: string; why: string };

/** How far time may move on its own before a person is asked; -1 for never ask. */
export type Limits = { askAboveMinutes: number; maxEvents: number; maxStatus: number; maxBonds: number; maxFactions: number; maxThreads?: number };

export const DEFAULT_LIMITS: Limits = { askAboveMinutes: 7 * 1440, maxEvents: 5, maxStatus: 12, maxBonds: 6, maxFactions: 3, maxThreads: 3 };

/**
 * Whether the Steward keeps the tracker, or a preset does and it should stay
 * out of it; and the factions already known, so it does not propose them again.
 */
export type Options = {
  tracking: boolean;
  factions?: string[];
  threads?: string[];
  /** Matters moving out of sight that the story may have brought out. A thread opened under one of these names is that one. */
  surfacing?: string[];
  /**
   * The planned scene a followed apocryphon is in, so the Steward can say when
   * it has ended — and the scenes planned after it, numbered, so it can say the
   * story has already moved on into one of them.
   */
  scene?: { title: string; ending: string; ahead?: { id: string; title: string; setting?: string }[] };
};

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

/** The instructions, with the tracker's part only when the Steward is the one keeping it. */
export function stewardSystem(o: Options = { tracking: true }): string {
  return [
    "You keep the records for a story. You read the latest part of it and report what it establishes, as short lines in a fixed format. You never continue the story, never explain yourself, and never answer in JSON.",
    "",
    "Write each finding on its own line, exactly like this:",
    'TIME | how much time passed | "the exact words from the story that show it"',
    'EVENT | a short title for something that happened | "the exact words from the story that show it"',
    ...(o.tracking ? ['STATUS | person number | what | how they are now | "the exact words from the story that show it"'] : []),
    'BOND | person number | person number | + or - | what they are to each other now | "the exact words from the story that show it"',
    'FACTION | its name | what it is, in a few words | one word for its emblem, if the story gives one | "the exact words from the story that show it"',
    'THREAD | open or settled | a short name for it | "the exact words from the story that show it"',
    ...(o.scene ? ['SCENE | done | "the exact words from the story that show the planned scene has reached its end"'] : []),
    ...(o.scene?.ahead?.length ? ['SCENE | number of a scene planned later | "the exact words from the story that show the story is now in that scene"'] : []),
    "",
    "Rules:",
    "- The quote must be copied exactly from the story: four to twenty-five words, in the story's own language.",
    "- TIME only when the story says time passed: \"three days later\", \"they rode until dawn\". Say how long in plain words (\"3 days\", \"until dawn\").",
    "- EVENT only for something that actually happened in this part. Not plans, threats, guesses, dreams, or memories of the past.",
    ...(o.tracking ? [
      "- STATUS only for people marked (here), using their number from the list, and only when the story changes something about them or shows it for the first time.",
      "- For STATUS, \"what\" is one of: physical (injuries, health, tiredness), mental (mood, state of mind), clothes (what they wear), location (where they are), inventory (what they carry). Say how they are now in a few words.",
    ] : []),
    "- BOND when how the first person feels about the second changes: + warmer, - colder. It goes one way: write it twice if both change.",
    "- FACTION only for a group the story names — a house, guild, order, company — that is not already listed. Leave the emblem empty if the story gives none.",
    "- THREAD open for something the story leaves hanging that should come back: a promise, a secret, a debt, a question, a letter not yet answered. THREAD settled when one of the open threads listed is resolved here — use its name exactly as listed.",
    ...(o.scene ? ["- SCENE done only when this part of the story actually reaches the end of the planned scene given below. Not when it is merely heading there. If reaching it also settles one of the open threads, write that THREAD settled line too, with its own quote."] : []),
    ...(o.scene?.ahead?.length ? ["- SCENE with a number only when the story has clearly already moved into one of the scenes planned later — its people, its place and what it is about are happening now."] : []),
    "- At most one TIME line and five EVENT lines.",
    "- If nothing worth recording happened, write only: NONE",
  ].join("\n");
}

export const STEWARD_SYSTEM = stewardSystem();

/** The part of the request that changes: who is here, when it is, and what was said. */
export function stewardPrompt(people: Person[], nowText: string, passages: Passage[], o: Options = { tracking: true }): string {
  const roster = people.length
    ? people.map((p, i) => {
        const notes = [p.note, o.tracking && p.present ? "here" : ""].filter(Boolean).join(", ");
        return `${i + 1}. ${p.name}${notes ? ` (${notes})` : ""}`;
      }).join("\n")
    : "(nobody named yet)";
  const known = o.tracking
    ? people.map((p, i) => {
        const facts = STATUS_FIELDS.filter((f) => p.present && p.known?.[f]).map((f) => `${f}: ${p.known![f]}`);
        return facts.length ? `${i + 1}. ${p.name} — ${facts.join("; ")}` : "";
      }).filter(Boolean)
    : [];
  const story = passages
    .map((p) => `${p.who}: ${storyOnly(p.text)}`)
    .filter((l) => l.trim())
    .join("\n\n");
  const already = known.length ? `\n\nAlready known about them (report only what changes):\n${known.join("\n")}` : "";
  const groups = o.factions?.length ? `\n\nFactions already known: ${o.factions.join(", ")}` : "";
  const threads = (o.threads?.length ? `\n\nOpen threads: ${o.threads.join("; ")}` : "")
    + (o.surfacing?.length ? `\n\nMatters that may have come into the open — open one, by this exact name, only if this passage plainly shows it: ${o.surfacing.join("; ")}` : "");
  const ahead = o.scene?.ahead?.length
    ? `\nScenes planned after it:\n${o.scene.ahead.map((a, i) => `${i + 1}. ${a.title || "untitled"}${a.setting ? ` (${a.setting})` : ""}`).join("\n")}`
    : "";
  const scene = o.scene ? `\n\nThe planned scene now: ${o.scene.title || "untitled"} — it ends when: ${o.scene.ending}${ahead}` : "";
  return `People in this story:\n${roster}${already}${groups}${threads}${scene}\n\nIt is now: ${nowText}\n\nThe story so far, latest part:\n\n${story}\n\nWrite your lines now.`;
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

export function stewardRequest(model: string, people: Person[], nowText: string, passages: Passage[], o: Options = { tracking: true }) {
  const user = stewardPrompt(people, nowText, passages, o);
  const system = stewardSystem(o);
  return needsFoldedSystem(model)
    ? { system: "", messages: [{ role: "user" as const, content: `${system}\n\n---\n\n${user}` }] }
    : { system, messages: [{ role: "user" as const, content: user }] };
}

// ---- reading the answer ---------------------------------------------------

const KIND_WORDS: Record<string, "time" | "event" | "status" | "bond" | "faction" | "thread" | "scene" | "none"> = {
  SCENE: "scene", SCENEDONE: "scene",
  THREAD: "thread", THREADS: "thread", PLOTTHREAD: "thread", HOOK: "thread", LOOSEEND: "thread",
  BOND: "bond", RELATIONSHIP: "bond", RELATION: "bond", FEELING: "bond",
  FACTION: "faction", GROUP: "faction", HOUSE: "faction", ORGANISATION: "faction", ORGANIZATION: "faction",
  TIME: "time", TIMEPASSED: "time", TIMESKIP: "time", ELAPSED: "time", DURATION: "time",
  EVENT: "event", EVENTS: "event", HAPPENED: "event",
  STATUS: "status", STATE: "status", CONDITION: "status", TRACKER: "status",
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
  status: { who: string; field: string; value: string; evidence: string }[];
  bonds: { from: string; to: string; way: string; label: string; evidence: string }[];
  factions: { name: string; description: string; symbol: string; evidence: string }[];
  threads: { state: string; name: string; evidence: string }[];
  scene: { state: string; evidence: string }[];
  none: boolean;
  dropped: Dropped[];
  /** Lines that were not findings at all — chatter, headings — counted, not judged. */
  noise: number;
};

/** The answer as lines, before anything is checked against the story. */
export function parseAnswer(raw: string): Parsed {
  const out: Parsed = { time: [], events: [], status: [], bonds: [], factions: [], threads: [], scene: [], none: false, dropped: [], noise: 0 };
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
    if (kind === "bond") {
      if (parts.length < 5) { out.dropped.push({ line: original.trim(), why: "a BOND line needs two people, which way, and a quote" }); continue; }
      out.bonds.push({ from: first, to: unquote(parts[2]), way: unquote(parts[3]), label: parts.length > 5 ? unquote(parts.slice(4, -1).join(" ")) : "", evidence });
    } else if (kind === "scene") {
      out.scene.push({ state: first, evidence });
    } else if (kind === "thread") {
      if (parts.length < 4) { out.dropped.push({ line: original.trim(), why: "a THREAD line needs open or settled, a name, and a quote" }); continue; }
      out.threads.push({ state: first, name: unquote(parts.slice(2, -1).join(" ")), evidence });
    } else if (kind === "faction") {
      if (parts.length < 4) { out.dropped.push({ line: original.trim(), why: "a FACTION line needs a name, what it is, and a quote" }); continue; }
      out.factions.push({ name: first, description: unquote(parts[2]), symbol: parts.length > 4 ? unquote(parts[3]) : "", evidence });
    } else if (kind === "status") {
      if (parts.length < 5) { out.dropped.push({ line: original.trim(), why: "a STATUS line needs who, what, how and a quote" }); continue; }
      out.status.push({ who: first, field: unquote(parts[2]), value: unquote(parts.slice(3, -1).join(" | ")), evidence });
    } else if (kind === "time") out.time.push({ said: first, evidence });
    else out.events.push({ title: first, people: parts.length > 3 ? parts.slice(2, -1).join(",") : "", evidence });
  }
  return out;
}

// ---- checking it against the story ---------------------------------------

/*
 * No \p{...} in here, and nothing else that needs ICU. The phone's Node is
 * built without it, and there a Unicode property escape is not a slow regex
 * but a syntax error in the whole bundle: Node stops before the first line
 * runs and the app dies with nothing recorded. Plain ranges do the same job.
 * PUNCTUATION is ASCII and Latin-1 symbols, the general and supplemental
 * punctuation blocks, CJK punctuation and the full-width forms; the apostrophe
 * is left out of it on purpose.
 */
const PUNCTUATION = /[\u0000-\u0026\u0028-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u00BF\u00D7\u00F7\u2000-\u206F\u2E00-\u2E7F\u3000-\u303F\uFF00-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]+/g;

/** NFKC where the runtime can do it; the text as it is where it cannot. */
function folded(text: string): string {
  try { return text.normalize("NFKC"); } catch { return text; }
}

/** Text reduced to its words: case, accents of punctuation, quotes and dashes no longer matter. */
function words(text: string): string[] {
  return folded(String(text ?? ""))
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(PUNCTUATION, " ")
    .replace(/'/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

/** Languages written without spaces are compared by characters instead of words. */
const unspaced = (s: string) => /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\uFF66-\uFF9F\u0E00-\u0E7F]/.test(s);

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
  o: Options = { tracking: true },
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

  const tracked = new Set<string>();
  for (const s of p.status) {
    const line = `STATUS | ${s.who} | ${s.field} | ${s.value} | "${s.evidence}"`;
    if (!o.tracking) { dropped.push({ line, why: "a preset keeps the tracker in this chat" }); continue; }
    const person = whoIs(s.who, people);
    if (!person) { dropped.push({ line, why: "not someone on the list" }); continue; }
    if (!person.present) { dropped.push({ line, why: `${person.name} is not in the scene` }); continue; }
    const field = fieldOf(s.field);
    if (!field) { dropped.push({ line, why: "not one of the things the tracker keeps" }); continue; }
    const value = s.value.replace(/\s+/g, " ").slice(0, 160);
    if (!words(value).length) { dropped.push({ line, why: "no description of how they are" }); continue; }
    const key = `${person.name}\u0000${field}`;
    if (tracked.has(key)) { dropped.push({ line, why: "the same thing about the same person twice" }); continue; }
    if (tracked.size >= limits.maxStatus) { dropped.push({ line, why: "more changes than allowed in one go" }); continue; }
    // Already so: not a change, and not a mistake either. Nothing to record.
    if (words(person.known?.[field] ?? "").join(" ") === words(value).join(" ")) { tracked.add(key); continue; }
    const at = findEvidence(s.evidence, passages);
    if (!at) { dropped.push({ line, why: "the quote is not in the story" }); continue; }
    tracked.add(key);
    claims.push({ kind: "status", subject: person.name, field, value, evidence: s.evidence, message_id: at });
  }

  const paired = new Set<string>();
  for (const b of p.bonds) {
    const line = `BOND | ${b.from} | ${b.to} | ${b.way} | ${b.label} | "${b.evidence}"`;
    const from = whoIs(b.from, people);
    const to = whoIs(b.to, people);
    if (!from || !to) { dropped.push({ line, why: "not someone on the list" }); continue; }
    if (from.name === to.name) { dropped.push({ line, why: "a bond is between two people" }); continue; }
    const step = wayOf(b.way);
    if (step === null) { dropped.push({ line, why: "not + or -" }); continue; }
    const key = `${from.name}\u0000${to.name}`;
    if (paired.has(key)) { dropped.push({ line, why: "the same bond twice" }); continue; }
    if (paired.size >= limits.maxBonds) { dropped.push({ line, why: "more bonds than allowed in one go" }); continue; }
    const at = findEvidence(b.evidence, passages);
    if (!at) { dropped.push({ line, why: "the quote is not in the story" }); continue; }
    paired.add(key);
    // One step, whatever was asked: "++", "much warmer", "+50" all move it by one.
    claims.push({ kind: "bond", from: from.name, to: to.name, amount: step * BOND_STEP, label: b.label.replace(/\s+/g, " ").slice(0, 60),
      evidence: b.evidence, message_id: at });
  }

  const known = new Set((o.factions ?? []).map(groupKey));
  const named = new Set<string>();
  for (const f of p.factions) {
    const line = `FACTION | ${f.name} | ${f.description} | "${f.evidence}"`;
    const name = f.name.replace(/\s+/g, " ").slice(0, 80);
    const key = groupKey(name);
    if (!key) { dropped.push({ line, why: "no name" }); continue; }
    if (known.has(key)) { dropped.push({ line, why: "already known" }); continue; }
    if (named.has(key)) { dropped.push({ line, why: "the same faction twice" }); continue; }
    if (named.size >= limits.maxFactions) { dropped.push({ line, why: "more factions than allowed in one go" }); continue; }
    const at = findEvidence(f.evidence, passages);
    if (!at) { dropped.push({ line, why: "the quote is not in the story" }); continue; }
    named.add(key);
    claims.push({ kind: "faction", name, description: f.description.replace(/\s+/g, " ").slice(0, 200),
      symbol: f.symbol.slice(0, 40), evidence: f.evidence, message_id: at });
  }

  // Threads: a new one opened, or one already open settled — by its listed name.
  const open = new Map((o.threads ?? []).map((t) => [groupKey(t), t]));
  const surfacing = new Map((o.surfacing ?? []).map((t) => [groupKey(t), t]));
  const touched = new Set<string>();
  for (const t of p.threads) {
    const line = `THREAD | ${t.state} | ${t.name} | "${t.evidence}"`;
    const state = /^(open|opens|opened|new|start|starts|started|begin|begins|raised|added)\b/i.test(t.state) ? "open"
      : /^(settled?|settles|resolved?|resolves|closed?|closes|done|ended?|ends|answered|finished|paid)\b/i.test(t.state) ? "settled" : null;
    if (!state) { dropped.push({ line, why: "not open or settled" }); continue; }
    const name = t.name.replace(/\s+/g, " ").trim().slice(0, 120);
    const key = groupKey(name);
    if (!key) { dropped.push({ line, why: "no name" }); continue; }
    if (touched.has(key)) { dropped.push({ line, why: "the same thread twice" }); continue; }
    if (state === "open" && open.has(key)) { dropped.push({ line, why: "already open" }); continue; }
    if (state === "settled" && !open.has(key)) { dropped.push({ line, why: "not one of the open threads" }); continue; }
    if (touched.size >= (limits.maxThreads ?? 3)) { dropped.push({ line, why: "more threads than allowed in one go" }); continue; }
    const at = findEvidence(t.evidence, passages);
    if (!at) { dropped.push({ line, why: "the quote is not in the story" }); continue; }
    touched.add(key);
    claims.push({ kind: "thread", name: state === "settled" ? open.get(key)! : surfacing.get(key) ?? name, open: state === "open", evidence: t.evidence, message_id: at });
  }

  // The planned scene, over: only if there is one, only "done", once, and quoted.
  for (const sc of p.scene) {
    const line = `SCENE | ${sc.state} | "${sc.evidence}"`;
    if (!o.scene) { dropped.push({ line, why: "no planned scene to end" }); continue; }
    const n = Number(String(sc.state).replace(/[^\d]/g, ""));
    const done = /^(done|over|ended?|ends|finished|complete[sd]?|reached)\b/i.test(sc.state);
    const to = !done && Number.isInteger(n) && n >= 1 ? o.scene.ahead?.[n - 1] : undefined;
    if (!done && !to) { dropped.push({ line, why: "not done, and not one of the scenes listed" }); continue; }
    if (claims.some((c) => c.kind === "scene")) { dropped.push({ line, why: "the scene ended twice" }); continue; }
    const at = findEvidence(sc.evidence, passages);
    if (!at) { dropped.push({ line, why: "the quote is not in the story" }); continue; }
    claims.push(to ? { kind: "scene", evidence: sc.evidence, message_id: at, to: to.id } : { kind: "scene", evidence: sc.evidence, message_id: at });
  }

  return { claims, dropped, none: p.none && !claims.length, noise: p.noise };
}

/** +1, -1 or null: which way a bond moved, however a model wrote it. Never more than one step. */
export function wayOf(word: string): 1 | -1 | null {
  const w = String(word ?? "").trim().toLowerCase();
  if (/^\++\d*$|^(up|warmer|better|closer|improves?|improved|positive|increase[sd]?)\b/.test(w)) return 1;
  if (/^[-−–]+\d*$|^(down|colder|worse|cooler|further|worsens?|worsened|negative|decrease[sd]?)\b/.test(w)) return -1;
  return null;
}

/** A faction's name as compared: case, a leading "the", and punctuation set aside. */
export function groupKey(name: string): string {
  return words(name).filter((w, i) => !(i === 0 && w === "the")).join(" ");
}

const FIELD_WORDS: Record<string, StatusField> = {
  physical: "physical", body: "physical", health: "physical", injury: "physical", injuries: "physical", wounds: "physical", condition: "physical",
  mental: "mental", mood: "mental", mind: "mental", emotion: "mental", emotions: "mental", feeling: "mental", feelings: "mental",
  clothes: "clothes", clothing: "clothes", outfit: "clothes", wearing: "clothes", dress: "clothes", attire: "clothes",
  location: "location", place: "location", where: "location", position: "location",
  inventory: "inventory", items: "inventory", carrying: "inventory", holding: "inventory", belongings: "inventory", gear: "inventory",
};

/** Which of the tracker's fields a word means, if any. */
export function fieldOf(word: string): StatusField | null {
  return FIELD_WORDS[String(word ?? "").toLowerCase().replace(/[^a-z]/g, "")] ?? null;
}
