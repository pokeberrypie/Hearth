/**
 * Notes the story keeps on itself.
 *
 * Every so often the recent conversation is handed back to the model with one
 * job: say what changed. What comes back is filed in a lorebook as an ordinary
 * entry — keywords and all — so it is picked up again later by exactly the same
 * machinery that reads a hand-written one. Nothing here is a special case
 * downstream; see src/lore.ts.
 *
 * Two ways to choose what a note covers, because they fail differently. A
 * window of the last N messages is predictable and never grows, but anything
 * that happened while you were not looking falls through the gap between
 * notes. "Since the last note" cannot lose anything, but after a long silence
 * it can hand the model an enormous span. Neither is right for everyone, so
 * both are offered.
 */

import { normaliseEntry, type LoreEntry } from "./lore";

export type Scope = "since" | "window";

export type NoteSource = {
  role: string;
  name: string;
  content: string;
  created_at: number;
};

/** What the model is asked to produce. */
export type Note = {
  comment: string;
  keys: string[];
  content: string;
};

/**
 * Whether enough has happened to be worth writing down.
 *
 * `every` of zero or less is the off switch, so a disabled cadence can be
 * expressed as a number and does not need a second flag to contradict.
 */
export function isDue(fresh: number, every: number): boolean {
  return every > 0 && fresh >= every;
}

/** How many messages have arrived since the last note was taken. */
export function freshCount(all: NoteSource[], sinceAt: number): number {
  return all.filter((m) => m.created_at > sinceAt).length;
}

/**
 * The messages a note should be written from.
 *
 * The "since" scope falls back to a window when there is no previous note,
 * which is the first note in any chat — otherwise the first one would be asked
 * to summarise the entire history, which is both expensive and the least
 * useful note it will ever write.
 */
export function messagesForNote(
  all: NoteSource[],
  scope: Scope,
  every: number,
  sinceAt: number,
): NoteSource[] {
  const window = Math.max(1, every);
  if (scope === "window" || !sinceAt) return all.slice(-window);
  const fresh = all.filter((m) => m.created_at > sinceAt);
  return fresh.length ? fresh : all.slice(-window);
}

export const NOTE_SYSTEM =
  "You keep the notes for a roleplay. You are given the most recent part of a " +
  "scene and you write down what a reader would need to know later that they " +
  "could not guess from the character sheets.\n\n" +
  "Record only what changed or was established here: decisions, injuries, " +
  "promises, revelations, changes of place, changes between people. Do not " +
  "recap the plot beat by beat, do not describe what people are like in " +
  "general, and do not invent anything that is not on the page.\n\n" +
  "Answer with JSON and nothing else, in this shape:\n" +
  '{"comment": "a short title, under 60 characters",\n' +
  ' "keys": ["the names, places and things this note is about"],\n' +
  ' "content": "what happened, in two or three sentences of plain prose"}\n\n' +
  "The keys are what will later bring this note back into the story, so they " +
  "must be words that would actually appear in conversation about it — proper " +
  "names above all. If nothing worth recording happened, answer exactly: null";

/** The scene, as the note-taker sees it. */
export function notePrompt(messages: NoteSource[], speakerFallback: string): string {
  const lines = messages
    .map((m) => {
      const who = m.role === "user" ? "User" : (m.name?.trim() || speakerFallback);
      return `${who}: ${m.content.trim()}`;
    })
    .filter((l) => l.trim());
  return lines.join("\n\n");
}

/**
 * Pulls the note out of whatever the model actually said.
 *
 * Models decorate JSON — a fence, a sentence of preamble, a cheerful "here you
 * go". Rather than insisting they behave, take the first balanced object in
 * the reply and read that. Returns null when there is nothing usable, which is
 * also how the model is told to say "nothing happened", so the two cases need
 * no distinguishing: both mean no note.
 */
export function parseNote(raw: string): Note | null {
  const text = String(raw ?? "").trim();
  if (!text || /^null$/i.test(text)) return null;

  const start = text.indexOf("{");
  if (start === -1) return null;

  // Walk to the matching brace rather than regexing: content is prose and may
  // well contain braces, and a greedy match would swallow the wrong one.
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { end = i + 1; break; }
  }
  if (end === -1) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(text.slice(start, end));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const content = String(parsed.content ?? "").trim();
  if (!content) return null;

  const keys = (Array.isArray(parsed.keys) ? parsed.keys : [])
    .filter((k: unknown) => typeof k === "string" && k.trim())
    .map((k: string) => k.trim())
    .slice(0, 12);

  // A note nothing can trigger is a note nobody will ever read again.
  if (!keys.length) return null;

  return {
    comment: String(parsed.comment ?? "").trim().slice(0, 80) || "Note",
    keys,
    content,
  };
}

/**
 * A note, as a lorebook entry.
 *
 * Ordinary in every respect except its order, which is set high so the story's
 * own notes sit after the hand-written setting material they are commentary
 * on.
 */
export function entryFromNote(note: Note): LoreEntry {
  return normaliseEntry({
    keys: note.keys,
    content: note.content,
    comment: note.comment,
    order: 200,
    position: "after_char",
  });
}
