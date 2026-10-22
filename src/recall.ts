/**
 * Remembering: what from earlier in the story matters to the scene being
 * written now.
 *
 * The chronicle keeps what happened, each with the story's own words and the
 * message they came from; the bonds keep why people feel as they do. Neither
 * reached the narrator — only the last stretch of conversation did, so a
 * promise made a hundred chapters ago was written down and never read again.
 * This chooses the few that matter now, in code: no model call, the same
 * answer for the same story every time.
 *
 * What makes something come back is not that it is old or that someone in it
 * is here — Jaime is always here — but that what is happening now touches it:
 * the same words, or the same matter in other words (a promise about honesty
 * is tested by a letter hidden in a doublet, which never says "lie"). A
 * promise, vow or debt counts for more, because those are the ones a story is
 * supposed to come back to.
 *
 * Nothing private is ever a candidate: the Offstage's ledger never reaches
 * here. And each memory says who was there, because the narrator remembering
 * a confession is not everyone in the story knowing it.
 */

import type { Bond, Entry } from "./chronicle";

const STOP = new Set(["the", "and", "that", "with", "this", "from", "have", "has", "had", "was", "were", "they", "them", "their",
  "there", "then", "than", "what", "when", "where", "which", "while", "would", "could", "should", "will", "into", "onto", "upon",
  "about", "after", "before", "again", "just", "only", "very", "said", "says", "say", "like", "some", "more", "most", "other",
  "been", "being", "your", "yours", "his", "her", "hers", "him", "she", "he", "its", "our", "out", "over", "under", "back", "down",
  "here", "now", "not", "but", "for", "are", "all", "any", "one", "two", "who", "whom", "why", "how", "too", "can", "did", "does",
  "done", "make", "made", "know", "knew", "known", "come", "came", "goes", "went", "gone", "look", "looked", "still", "even",
  "each", "every", "much", "many", "such", "own", "same", "also", "well", "away", "time", "thing", "things", "way", "day", "night"]);

/**
 * Matters a story comes back to, each with the words it is said in. Small and
 * plain, on purpose: enough to see that hiding a letter is about honesty, not
 * a thesaurus. Phrases are matched as phrases.
 */
export const CONCEPTS: Record<string, string[]> = {
  honesty: ["honest", "honesty", "truth", "truthful", "lie", "lies", "lied", "lying", "liar", "deceive", "deceived", "deceit",
    "deception", "conceal", "concealed", "conceals", "concealing", "hide", "hides", "hid", "hidden", "hiding", "secret", "secrets",
    "secretly", "withhold", "withheld", "mislead", "misled", "confess", "confessed", "confession", "say nothing", "said nothing",
    "saying nothing", "told no one", "tell no one", "keep it from", "kept it from", "keep from", "never told", "did not tell",
    "didn't tell", "not tell", "won't tell", "never tell", "pocketed", "tucked away", "slipped it into"],
  trust: ["trust", "trusted", "trusts", "distrust", "betray", "betrayal", "betrayed", "betrays", "traitor", "treachery", "treason",
    "loyal", "loyalty", "disloyal", "faithless", "turncloak", "backstab", "stab in the back"],
  fidelity: ["faithful", "unfaithful", "affair", "lover", "adultery", "cheat", "cheated", "cheating", "mistress", "paramour", "another man", "another woman"],
  marriage: ["marriage", "marry", "married", "marrying", "wedding", "wed", "wedded", "betrothal", "betrothed", "bride", "groom",
    "husband", "wife", "engagement", "engaged", "match", "vows"],
  children: ["child", "children", "pregnant", "pregnancy", "with child", "heir", "baby", "babe", "son", "daughter", "bastard", "birth"],
  harm: ["kill", "killed", "murder", "murdered", "poison", "poisoned", "attack", "attacked", "wound", "wounded", "hurt", "harm",
    "blood", "assassin", "dagger", "knife"],
  safety: ["protect", "protected", "protection", "safe", "safety", "keep you safe", "guard", "guarded", "shield", "defend"],
  debt: ["debt", "debts", "owe", "owed", "owes", "repay", "repaid", "payment", "bribe", "bribed", "favour", "favor", "in your debt"],
  leaving: ["leave", "leaving", "abandon", "abandoned", "desert", "deserted", "run away", "ran away", "flee", "fled", "go away",
    "come back", "return", "returned", "never see"],
  power: ["throne", "crown", "succession", "rule", "ruler", "council", "regent", "usurp", "usurper", "claim", "power"],
  forgiveness: ["sorry", "apologise", "apologize", "apology", "forgive", "forgave", "forgiven", "forgiveness", "regret", "amends"],
  jealousy: ["jealous", "jealousy", "envy", "envious", "resent", "resentment"],
};

/** What makes a memory a commitment — something the story is meant to come back to. */
const COMMITMENT = ["promise", "promised", "promises", "swore", "swear", "sworn", "vow", "vowed", "oath", "pledge", "pledged",
  "gave his word", "gave her word", "gave my word", "my word", "never again", "will never", "would never", "won't ever",
  "owe", "owes", "owed", "debt"];

/** Lowercased, apostrophes kept as part of words, everything else a space: what phrases are matched against. */
export function plain(text: string): string {
  return ` ${String(text ?? "").toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

const has = (p: string, phrase: string) => p.includes(` ${phrase} `);

export function conceptsIn(text: string): Set<string> {
  const p = plain(text);
  const out = new Set<string>();
  for (const [name, said] of Object.entries(CONCEPTS)) if (said.some((w) => has(p, w))) out.add(name);
  return out;
}

export function isCommitment(text: string): boolean {
  const p = plain(text);
  return COMMITMENT.some((w) => has(p, w));
}

/** The words that say what something is about: not the small ones, not anyone's name. */
function topicWords(text: string, names: Set<string>): Set<string> {
  return new Set(plain(text).trim().split(" ").map((w) => w.replace(/'s$|'/g, ""))
    .filter((w) => w.length > 3 && !STOP.has(w) && !names.has(w)));
}

/** The people an event was with: the Steward writes them as "With A, B." */
export function peopleIn(e: Pick<Entry, "body">): string[] {
  const m = /^With (.+)\.$/.exec((e.body ?? "").trim());
  return m ? m[1].split(/,\s*/).map((s) => s.trim()).filter(Boolean) : [];
}

export type Recalled = { id: string; line: string; score: number; why: string[] };

export type RecallInput = {
  /** Live chronicle entries; only events count, and never a private one. */
  entries: Entry[];
  bonds: Bond[];
  /** Who is in the scene now, the player's character included. */
  present: string[];
  /** Everyone the story knows by name, so a name is never mistaken for a topic. */
  everyone: string[];
  /** The scene so far: the last few messages, the newest included. */
  recent: string;
  /** Messages the narrator is being sent anyway: what came from them needs no remembering. */
  inContext: Set<string>;
  /** The story's open threads, by title: an old event about one of them, while it is being talked of, matters. */
  threads: string[];
  when: (e: Entry) => string;
  /** Rough size limits, in characters. */
  eventBudget?: number;
  bondBudget?: number;
  maxEvents?: number;
  maxBonds?: number;
};

/**
 * A line from the story, shortened. Ours are the outer quotation marks, so
 * the story's own dialogue inside becomes single quotes, the way a book nests
 * them; a line that is nothing but one quotation loses its marks to ours.
 */
const quote = (s: string, n = 200) => {
  let t = s.replace(/\s+/g, " ").trim();
  const whole = /^["“]([^"“”]*)["”]$/.exec(t);
  t = whole ? whole[1] : t.replace(/["“]([^"“”]*)["”]/g, "‘$1’");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * The memories for this moment: events first, then — in their own space, so
 * a crisis at court never pushes out why two people here feel as they do —
 * the history of the bonds between the people present.
 */
export type Recall = { events: Recalled[]; bonds: Recalled[];
  /** For the prompt inspector: how many events there were to choose from, and how many were left out because the conversation already has them. */
  looked: { events: number; inConversation: number } };

export function recall(o: RecallInput): Recall {
  const nameWords = new Set(o.everyone.flatMap((n) => plain(n).trim().split(" ")).filter((w) => w.length > 2));
  const presentLower = o.present.map((p) => p.toLowerCase());
  const recentPlain = plain(o.recent);
  const nowConcepts = conceptsIn(o.recent);
  const nowWords = topicWords(o.recent, nameWords);
  const liveThreads = o.threads.filter((t) => [...topicWords(t, nameWords)].some((w) => nowWords.has(w)));
  const threadWords = new Set(liveThreads.flatMap((t) => [...topicWords(t, nameWords)]));

  const scored: (Recalled & { at: number; key: string })[] = [];
  const seenTitles = new Set<string>();
  const looked = { events: 0, inConversation: 0 };
  for (const e of o.entries) {
    if (e.kind !== "event" || e.undone_at || e.proposed || e.visibility === "private") continue;
    looked.events++;
    if (e.message_id && o.inContext.has(e.message_id)) { looked.inConversation++; continue; }
    const text = `${e.title} ${e.evidence}`;
    const key = plain(e.title).trim();
    if (!key) continue;
    const people = peopleIn(e);
    const involved = [...new Set([...people.map((p) => p.toLowerCase()), ...presentLower.filter((p) => has(plain(text), p) || has(plain(text), p.split(" ")[0]))])]
      .filter((p) => presentLower.includes(p));
    const concepts = [...conceptsIn(text)].filter((c) => nowConcepts.has(c));
    const shared = [...topicWords(text, nameWords)].filter((w) => nowWords.has(w));
    const onThread = [...topicWords(text, nameWords)].some((w) => threadWords.has(w));
    const promise = isCommitment(text);
    // It has to be about what is happening now — someone being here is never enough on its own.
    const topical = concepts.length > 0 || shared.length >= 2 || (onThread && shared.length >= 1);
    if (!topical) continue;
    let score = Math.min(involved.length, 2) * 3 + Math.min(shared.length, 4) + concepts.length * (promise ? 4 : 2) + (onThread ? 2 : 0);
    if (promise && concepts.length) score += 3;
    if (score < 5) continue;
    const why = [involved.length ? "someone here was there" : "", concepts.length ? `about ${concepts.join(", ")}` : "",
      shared.length ? `shares: ${shared.slice(0, 3).join(", ")}` : "", onThread ? "an open thread" : "", promise ? "a promise" : ""].filter(Boolean);
    const when = o.when(e);
    const who = people.length
      ? ` Only ${people.join(", ")} ${people.length === 1 ? "was" : "were"} there — no one else knows this unless the story has shown it told.`
      : "";
    const secret = e.visibility === "hidden" ? " A secret: never reveal it outright; let it shape only those who know it." : "";
    const tested = promise && concepts.length ? " What is happening now may test it." : "";
    const evidence = e.evidence && plain(e.evidence) !== plain(e.title) ? ` — “${quote(e.evidence)}”` : "";
    scored.push({ id: e.id, score, why, at: e.created_at, key,
      line: `${when ? `${when}: ` : ""}${quote(e.title, 160)}${evidence || "."}${tested}${who}${secret}` });
  }
  scored.sort((a, b) => b.score - a.score || a.at - b.at || a.id.localeCompare(b.id));
  const events: Recalled[] = [];
  let room = o.eventBudget ?? 1600;
  for (const r of scored) {
    if (events.length >= (o.maxEvents ?? 5)) break;
    if (seenTitles.has(r.key) || r.line.length > room) continue;
    seenTitles.add(r.key);
    room -= r.line.length;
    events.push({ id: r.id, line: r.line, score: r.score, why: r.why });
  }

  // Bonds between people who are both here, in their own small space: the feeling, and the moments that made it.
  const bonds: Recalled[] = [];
  let bondRoom = o.bondBudget ?? 900;
  const here = o.bonds.filter((b) => presentLower.includes(b.from.toLowerCase()) && presentLower.includes(b.to.toLowerCase()) && b.history.length)
    .map((b) => {
      const moments = b.history.filter((h) => !(h.message_id && o.inContext.has(h.message_id)) && (h.evidence || h.body))
        .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount) || x.created_at - y.created_at).slice(0, 2)
        .sort((x, y) => x.created_at - y.created_at);
      const touched = b.history.some((h) => [...conceptsIn(`${h.title} ${h.body} ${h.evidence}`)].some((c) => nowConcepts.has(c)));
      return { b, moments, weight: (touched ? 100 : 0) + Math.abs(b.score - 50) + b.history.length };
    })
    .sort((x, y) => y.weight - x.weight || x.b.from.localeCompare(y.b.from) || x.b.to.localeCompare(y.b.to));
  for (const { b, moments } of here) {
    if (bonds.length >= (o.maxBonds ?? 3)) break;
    const made = moments.map((h) => `${o.when(h) ? `${o.when(h)}: ` : ""}“${quote(h.body || h.evidence, 160)}”`).join("; ");
    const line = `${b.from} toward ${b.to}: ${b.label || "no word for it yet"} (${b.score}/100)${made ? `. What made it so: ${made}` : "."}`;
    if (line.length > bondRoom) continue;
    bondRoom -= line.length;
    bonds.push({ id: `${b.from}\u0000${b.to}`, line, score: 0, why: ["both are here"] });
  }
  return { events, bonds, looked };
}

/** As the narrator reads it. */
export function recallBrief(r: { events: Recalled[]; bonds: Recalled[] }): string[] {
  const out: string[] = [];
  if (r.events.length) {
    out.push("From earlier in the story, and relevant now — remembered, not happening again. Each says who was there; anyone else does not know it unless the story has shown them told, and must not act on it:");
    out.push(...r.events.map((e) => `- ${e.line}`));
  }
  if (r.bonds.length) {
    out.push("How the people here feel about each other, one way round, and why:");
    out.push(...r.bonds.map((b) => `- ${b.line}`));
  }
  return out;
}

/**
 * Whether two things are about the same matter: a word that says what either
 * is about, a person named in both, or the same matter in other words. Used
 * to put a planned scene beside the open threads it could pick up.
 */
export function related(a: string, b: string): boolean {
  const none = new Set<string>();
  const wa = topicWords(a, none);
  if ([...topicWords(b, none)].some((w) => wa.has(w))) return true;
  const ca = conceptsIn(a);
  return [...conceptsIn(b)].some((c) => ca.has(c));
}

/** Which of these people a text names: in full, or by the first part of their name. */
export function namedIn(text: string, people: string[]): string[] {
  const p = plain(text);
  return [...new Set(people.filter((n) => {
    const full = plain(n).trim();
    const first = full.split(" ")[0] ?? "";
    return !!full && (has(p, full) || (first.length > 2 && (has(p, first) || has(p, `${first}'s`))));
  }))];
}
