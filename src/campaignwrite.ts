/**
 * Turning a few words into a campaign.
 *
 * The die on the storybook page gives you one of Hearth's; this gives you
 * yours, written out properly. You type "haunted lighthouse, nobody believes
 * me" and get back a title, a situation, a tone, an opening and a handful of
 * things that might be out there — in the same shape the page already holds,
 * in ordinary boxes you can then edit.
 *
 * Parsing only, plus the words the model is given. The call itself lives in
 * index.ts with the other providers, and everything here is testable without
 * one — which matters more than usual, because the failure mode of a parser
 * for model output is not an exception, it is a campaign that is quietly half
 * empty.
 */

import { LENGTHS, type Campaign, type Length } from "./campaigns";

/**
 * A flat labelled block rather than JSON.
 *
 * Models are markedly better at this than at emitting valid JSON with prose
 * inside it, and the failure mode is kinder: a stray line breaks one field
 * instead of the whole reply. The labels are shouted because that is what
 * survives a model deciding to be conversational around them.
 */
export const WRITE_SYSTEM = [
  "You turn a rough idea into a tabletop campaign brief. Reply with exactly",
  "these five labelled lines and nothing else — no preamble, no commentary,",
  "no markdown:",
  "",
  "TITLE: a short evocative name, three or four words, no subtitle",
  "PREMISE: two or three sentences. Where everyone is, what the trouble is,",
  "  and the thing nobody is saying out loud. Concrete and specific.",
  "TONE: one or two sentences on how it should feel to play, and what the",
  "  narrator should lean on — pace, texture, how much violence.",
  "OPENING: one sentence on what to put in front of the player first.",
  "THINGS: three, comma-separated, that might turn up. These can be people,",
  "  creatures or situations. Not a plot — just what is out there.",
  "",
  "Take the player's idea seriously and build on it rather than replacing it.",
  "Keep every proper noun they gave you. Invent freely where they said nothing.",
].join("\n");

export function writePrompt(seed: string, length: Length): string {
  return [
    `Idea: ${seed.trim()}`,
    `Intended length: ${length}.`,
    "Write the brief.",
  ].join("\n\n");
}

const FIELD = (label: string) =>
  new RegExp(`^\\s*\\**\\s*${label}\\s*\\**\\s*:\\s*(.+?)\\s*$`, "im");

/**
 * Reads it back, forgivingly.
 *
 * A field the model omitted comes back empty rather than as a failure: four
 * fields out of five is a page you can finish yourself, and refusing the lot
 * because TONE went missing would be throwing away the work that did arrive.
 * The caller decides whether what came back was worth having.
 */
export function parseWritten(text: string, length: Length = "short"): Partial<Campaign> {
  const src = String(text ?? "");
  const one = (label: string) => {
    const m = FIELD(label).exec(src);
    // Models like to bold their own labels and wrap the value in quotes.
    return (m?.[1] ?? "")
      // A model that writes `**TITLE:**` puts its closing asterisks after the
      // colon, so they arrive inside the value. Out first, then trim, and only
      // then the quotes — otherwise the leading quote is behind a space and
      // survives, which is exactly what it did.
      .replace(/\*\*/g, "")
      .trim()
      .replace(/^["'“”]+/, "")
      .replace(/["'“”]+$/, "")
      .trim();
  };

  const things = one("THINGS")
    .split(/\s*[,;]\s*|\s+and\s+/i)
    .map((s) => s.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 6);

  return {
    id: "",
    title: one("TITLE").slice(0, 80),
    premise: one("PREMISE").slice(0, 1200),
    theme: one("TONE").slice(0, 800),
    opening: one("OPENING").slice(0, 800),
    bestiary: things,
    length: LENGTHS.includes(length) ? length : "short",
  };
}

/**
 * Whether the model actually wrote something, or just talked.
 *
 * A title on its own is a refusal wearing a hat; the premise is the part the
 * page cannot be finished without, so that is the test.
 */
export function looksWritten(c: Partial<Campaign>): boolean {
  return !!c.premise && c.premise.length > 40;
}
