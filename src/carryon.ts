/**
 * Carrying a long evening into a fresh chat.
 *
 * Every turn resends the whole conversation, so a chat that has run all night
 * costs more per message than the same chat did at the start, for a transcript
 * whose early half nobody is thinking about any more. The usual advice is
 * "start a new chat sometimes", which nobody does, because doing it by hand
 * means losing the thread.
 *
 * So: a recap of what has recently happened, written into the memory book as
 * something always in the prompt, and a new chat that opens on the last thing
 * that was actually said. The cast comes across, the books come across, the
 * notes come across, and the new chat is filed as a child of the old one so
 * the story reads as one story.
 *
 * The deciding and the shaping live here, away from the routes, so they can be
 * tested without a provider and without a database.
 */

export type Said = { role: string; name?: string | null; content: string };

/** The app's one convention for "how big is this": four characters a token. */
export const tokensIn = (text: string): number => Math.round((text ?? "").length / 4);

/** How much of a conversation is being resent on every turn. */
export function transcriptTokens(messages: Said[]): number {
  return tokensIn(messages.map((m) => m.content ?? "").join(""));
}

/**
 * Whether to offer the suggestion at all.
 *
 * Its own function because it is the whole of the feature's manners: too eager
 * and it is a nag bar over somebody's story, too shy and it never fires and
 * the tokens go on being spent. A threshold of zero means never, so the
 * slider has an off position at the end of it rather than needing a second
 * control.
 */
export function shouldSuggest(
  messages: Said[],
  { on, at }: { on: boolean; at: number },
): boolean {
  if (!on) return false;
  if (!(at > 0)) return false;
  // Two turns is not a long evening however big they were — a single pasted
  // novel should not be met with "this is getting long".
  if (messages.length < 6) return false;
  return transcriptTokens(messages) >= at;
}

/**
 * How much of the tail to hand the summariser.
 *
 * Proportional to the recap being asked for, because "the most recent events"
 * in three hundred tokens and in a thousand are different amounts of story.
 * Bounded at both ends: too little and the recap is about one exchange, too
 * much and this is an expensive request of its own, which would rather defeat
 * the point.
 */
export function tailBudget(targetTokens: number): number {
  const want = Math.max(60, Math.min(2000, Math.round(targetTokens || 300))) * 40;
  return Math.max(8000, Math.min(40000, want));
}

/**
 * The most recent stretch of conversation, whole messages only.
 *
 * Taken from the end backwards and never cut mid-message: half a turn reads to
 * a model as a turn that trailed off, and the recap then reports it as one.
 */
export function recentFor(messages: Said[], budgetChars: number): Said[] {
  const out: Said[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const size = (m.content ?? "").length;
    // Always take at least one, or a single enormous last message summarises
    // to nothing at all.
    if (out.length && used + size > budgetChars) break;
    out.unshift(m);
    used += size;
  }
  return out;
}

export const CARRY_SYSTEM =
  "You write the 'previously on' for an ongoing roleplay, so it can continue in a " +
  "fresh conversation without the whole transcript. Report what happened; do not " +
  "continue the story, do not write new dialogue, and do not comment on the writing. " +
  "Prose, past tense, no headings and no bullet points. Prefer the recent and the " +
  "unresolved over the old and the settled: what has just happened, where everyone " +
  "is, what was decided, what is still hanging. Name people and places rather than " +
  "saying 'the character' or 'the location'.";

/**
 * The request itself.
 *
 * The length is asked for in words as well as tokens, because a model told
 * "300 tokens" will cheerfully write nine hundred: it has no reliable sense of
 * its own tokeniser, and it does have a sense of how long a paragraph is.
 */
export function carryPrompt(picked: Said[], character: string, targetTokens: number): string {
  const tokens = Math.max(60, Math.min(2000, Math.round(targetTokens || 300)));
  // The usual English ratio, near enough for an instruction.
  const words = Math.round(tokens * 0.75);
  const lines = picked
    .map((m) => `${m.role === "user" ? (m.name?.trim() || "The player") : (m.name?.trim() || character)}: ${m.content}`)
    .join("\n\n");
  return (
    `Here is the most recent part of a roleplay with ${character}.\n\n` +
    `${lines}\n\n` +
    `Write the recap. About ${words} words — roughly ${tokens} tokens. ` +
    `Only the recap, with nothing before or after it.`
  );
}

/** Strips the things models put around an answer they were asked for plainly. */
export function cleanSummary(said: string): string {
  let t = String(said ?? "").trim();
  // A fenced block, when it decided this was a document.
  t = t.replace(/^```[a-z]*\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  // "Here is the recap:", "Recap:", "Previously:" — a preamble we asked for the
  // absence of, and get anyway often enough to be worth removing.
  t = t.replace(
    /^(?:sure[,!.]?\s*)?(?:here(?:'s| is)[^\n:]{0,40}:|recap:|summary:|previously(?:\s*,?\s*on\b[^\n:]{0,40})?\s*:)\s*/i,
    "",
  );
  return endWhole(t.trim());
}

/**
 * Drops a sentence the model was cut off in the middle of.
 *
 * There is a ceiling on the recap — the length is a slider and a slider that
 * can be ignored is not a setting — so a model that overshoots gets stopped
 * wherever it happens to be, which is usually mid-clause. That fragment is not
 * a one-off cosmetic problem: this text goes into the memory book as an entry
 * that is in *every* prompt of the new chat, so a dangling "and the missing"
 * is read by the model on every turn from then on, and models are obliging
 * about finishing a thought that was left hanging.
 *
 * A recap with no sentence boundary in it at all — one very long sentence,
 * stopped — is kept as it is, since the alternative there is nothing.
 */
export function endWhole(text: string): string {
  const t = String(text ?? "").trimEnd();
  if (!t) return t;
  if (/[.!?"'\u2019\u201d)\]]$/.test(t)) return t;
  const cut = Math.max(t.lastIndexOf(". "), t.lastIndexOf("! "), t.lastIndexOf("? "),
                       t.lastIndexOf(".\n"), t.lastIndexOf("!\n"), t.lastIndexOf("?\n"));
  if (cut < 0) return t;
  return t.slice(0, cut + 1).trimEnd();
}

/**
 * The recap as it goes into the book.
 *
 * Headed, because a memory book is a shelf of entries and an unlabelled slab
 * of prose in the middle of one is a thing you cannot later work out the
 * origin of.
 */
export function carryEntry(summary: string, title: string) {
  return {
    keys: [],
    // Always in the prompt: this is not a fact that comes up when somebody
    // mentions a keyword, it is where the story currently is.
    constant: true,
    content: `What has happened so far in ${title}:\n\n${summary}`,
    comment: `Carried on from ${title}`,
    // After the character, before the transcript — the same place a note about
    // the world goes, because that is what this now is.
    position: "after_char",
    order: 100,
  };
}

/**
 * What the new chat is called.
 *
 * Numbered rather than "— continued — continued", because carrying on twice is
 * the ordinary case for the sort of chat this exists for.
 */
export function carriedTitle(title: string): string {
  const base = String(title ?? "").trim() || "Untitled";
  const m = /^(.*?)\s*\((\d+)\)$/.exec(base);
  if (m) return `${m[1]} (${Number(m[2]) + 1})`;
  return `${base} (2)`;
}
