/**
 * A campaign out of a memory book.
 *
 * You have already written the world down — the towns, the families, the thing
 * everyone is careful not to mention. A lorebook is that, in pieces, keyed to
 * whatever brings each piece back. Starting a game in it should not mean
 * describing it all over again in a text box.
 *
 * So the book becomes the idea, and the ghostwriter that already turns an idea
 * into a campaign turns this one. Same writer, same shape out; only the way in
 * is new.
 *
 * The interesting part is choosing what to send. A lorebook can be a hundred
 * entries and two hundred thousand characters, which is both unaffordable and
 * unhelpful — a brief written from everything is a brief about nothing. What
 * goes is a sample: the entries most likely to be load-bearing, trimmed, in
 * the book's own order.
 */

export type BookEntry = {
  comment?: string;
  keys?: string[];
  content?: string;
  constant?: boolean;
  disable?: boolean;
  order?: number;
};

/** Room for the sample. Well under a cheap call, and plenty for a premise. */
export const SEED_BUDGET = 4000;

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Which entries speak for a book.
 *
 * Constant entries first, because an author marking an entry "always in
 * context" has already said it is what the world is about. Then the rest in
 * their own order — a lorebook is usually written most-important-first, and
 * guessing at importance by length rewards whoever wrote the longest paragraph
 * rather than the truest one.
 *
 * Disabled entries are left out. They are switched off in play; taking them as
 * the description of the world would be reading somebody's crossings-out.
 */
export function sampleBook(entries: BookEntry[], budget = SEED_BUDGET): BookEntry[] {
  const live = (entries ?? []).filter((e) => e && !e.disable && clean(e.content));
  const ordered = [
    ...live.filter((e) => e.constant),
    ...live.filter((e) => !e.constant),
  ];

  const out: BookEntry[] = [];
  let used = 0;
  for (const e of ordered) {
    const cost = clean(e.content).length + clean(e.comment).length + 40;
    if (used + cost > budget && out.length) break;
    used += cost;
    out.push(e);
  }
  return out;
}

/**
 * The book, as something to write from.
 *
 * Named entries keep their names, because the name is often the only place the
 * thing is actually called what people call it. Long entries are cut rather
 * than dropped: half of an entry still says what kind of world this is, and a
 * missing entry says nothing at all.
 */
export function seedFromBook(name: string, entries: BookEntry[], budget = SEED_BUDGET): string {
  const picked = sampleBook(entries, budget);
  const lines = picked.map((e) => {
    const label = clean(e.comment) || clean((e.keys ?? [])[0]) || "";
    const body = clean(e.content).slice(0, 600);
    return label ? `${label}: ${body}` : body;
  });

  const title = clean(name) || "an untitled book";
  if (!lines.length) {
    return `A setting called "${title}". The book is empty, so invent the world it implies.`;
  }
  return [
    `Build this game inside an existing setting called "${title}".`,
    "",
    "What is already written down about it:",
    ...lines.map((l) => `- ${l}`),
    "",
    "Use these as the world. Do not contradict them, do not restate them back to",
    "me, and do not treat this list as the plot — it is the place the plot happens",
    "in. Find a situation inside it that is worth a game.",
  ].join("\n");
}

/** Whether a book has enough in it to be worth writing from. */
export function bookIsUsable(entries: BookEntry[]): boolean {
  return sampleBook(entries).length > 0;
}
