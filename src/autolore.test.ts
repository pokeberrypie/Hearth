/**
 * The notes the story keeps on itself.
 *
 *   bun test src/autolore.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  entryFromNote,
  freshCount,
  isDue,
  messagesForNote,
  notePrompt,
  parseNote,
  type NoteSource,
} from "./autolore";

const msg = (content: string, created_at: number, role = "assistant", name = "Joffrey"): NoteSource =>
  ({ role, name, content, created_at });

const scene: NoteSource[] = [
  msg("one", 10), msg("two", 20), msg("three", 30),
  msg("four", 40), msg("five", 50),
];

describe("when a note is due", () => {
  test("counts only what arrived after the last one", () => {
    expect(freshCount(scene, 0)).toBe(5);
    expect(freshCount(scene, 30)).toBe(2);
    expect(freshCount(scene, 50)).toBe(0);
  });

  test("a cadence of zero is the off switch", () => {
    expect(isDue(999, 0)).toBe(false);
    expect(isDue(999, -1)).toBe(false);
  });

  test("fires on reaching the cadence, not only past it", () => {
    expect(isDue(3, 4)).toBe(false);
    expect(isDue(4, 4)).toBe(true);
    expect(isDue(5, 4)).toBe(true);
  });
});

describe("what a note covers", () => {
  test("a window takes the last N however long the chat is", () => {
    expect(messagesForNote(scene, "window", 2, 0).map((m) => m.content)).toEqual(["four", "five"]);
    expect(messagesForNote(scene, "window", 2, 30).map((m) => m.content)).toEqual(["four", "five"]);
  });

  test("since-last takes everything newer than the last note", () => {
    expect(messagesForNote(scene, "since", 2, 20).map((m) => m.content))
      .toEqual(["three", "four", "five"]);
  });

  test("the first note in a chat is a window, not the whole history", () => {
    // Otherwise the very first note summarises everything ever said, which is
    // the most expensive and least useful note the chat will ever take.
    expect(messagesForNote(scene, "since", 2, 0).map((m) => m.content)).toEqual(["four", "five"]);
  });

  test("falls back to a window rather than summarising nothing", () => {
    expect(messagesForNote(scene, "since", 2, 999).map((m) => m.content)).toEqual(["four", "five"]);
  });

  test("a window bigger than the chat is just the chat", () => {
    expect(messagesForNote(scene, "window", 50, 0)).toHaveLength(5);
  });
});

describe("the prompt", () => {
  test("labels who is speaking, falling back for an unnamed reply", () => {
    const out = notePrompt(
      [msg("Hello.", 1, "user", ""), msg("Get out.", 2, "assistant", "")],
      "Joffrey",
    );
    expect(out).toBe("User: Hello.\n\nJoffrey: Get out.");
  });
});

describe("reading the model's answer", () => {
  const good = '{"comment":"The wine","keys":["Joffrey","wine"],"content":"He poured it out."}';

  test("plain JSON", () => {
    expect(parseNote(good)).toEqual({
      comment: "The wine", keys: ["Joffrey", "wine"], content: "He poured it out.",
    });
  });

  test("JSON in a fence, with chatter around it", () => {
    expect(parseNote("Sure! Here you go:\n```json\n" + good + "\n```\nHope that helps.")?.content)
      .toBe("He poured it out.");
  });

  test("content containing braces does not cut the object short", () => {
    const tricky = '{"comment":"A","keys":["k"],"content":"He said {this} and left."}';
    expect(parseNote(tricky)?.content).toBe("He said {this} and left.");
  });

  test("escaped quotes inside content survive", () => {
    const quoted = '{"comment":"A","keys":["k"],"content":"He said \\"no\\" twice."}';
    expect(parseNote(quoted)?.content).toBe('He said "no" twice.');
  });

  test("nothing worth writing down", () => {
    expect(parseNote("null")).toBeNull();
    expect(parseNote("")).toBeNull();
    expect(parseNote("I could not find anything of note.")).toBeNull();
  });

  test("refuses a note with no keys, which nothing could ever trigger", () => {
    expect(parseNote('{"comment":"A","keys":[],"content":"Something happened."}')).toBeNull();
  });

  test("refuses an empty note", () => {
    expect(parseNote('{"comment":"A","keys":["k"],"content":"  "}')).toBeNull();
  });

  test("survives malformed JSON", () => {
    expect(parseNote('{"comment": "A", "keys": [broken}')).toBeNull();
  });

  test("drops non-string keys and caps how many are kept", () => {
    const many = JSON.stringify({
      comment: "A",
      keys: [...Array(20)].map((_, i) => `k${i}`).concat([1 as any, null as any]),
      content: "x",
    });
    const note = parseNote(many)!;
    expect(note.keys).toHaveLength(12);
    expect(note.keys.every((k) => typeof k === "string")).toBe(true);
  });
});

describe("the entry it becomes", () => {
  test("is an ordinary lorebook entry, ordered after the setting", () => {
    const e = entryFromNote({ comment: "The wine", keys: ["Joffrey"], content: "He poured it out." });
    expect(e.keys).toEqual(["Joffrey"]);
    expect(e.content).toBe("He poured it out.");
    expect(e.enabled).toBe(true);
    expect(e.order).toBe(200);
    expect(e.id).toBeTruthy();
  });
});
