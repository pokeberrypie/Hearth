/**
 * Apocrypha: the stories you mean to tell, kept apart from the ones that are
 * true.
 *
 * The shelf beside the lorebooks. A lorebook is the Archives — what is so in
 * the world, which the model may lean on as fact. An apocryphon is the other
 * kind of book: a plan, in chapters and scenes, for where a story is meant to
 * go. It is not canon and must never be read as canon. A planned wedding is
 * not a wedding that happened, and a narrator that is shown the confrontation
 * three scenes ahead will bring it on now, because it is the most interesting
 * thing in its instructions.
 *
 * So the model is only ever shown the scene the story is in, what that scene
 * is for, and the name of the one after it — never the outline. And the plan
 * moves on when the person says so, not when the model decides a scene is
 * over, which is a judgement models make badly and a story suffers for.
 *
 * A book with a premise and no chapters yet is an omen: an idea on the shelf,
 * waiting. It becomes a prophecy the moment it has a scene.
 *
 * Progress is the chat's, not the book's. One book can be played in several
 * chats, and in every branch of each, and finishing a scene in one must not
 * finish it in the others — so the book holds the plan and each chat holds
 * its own bookmark into it.
 *
 * Pure: storing all of this is index.ts's business.
 */

export const STATUSES = ["planned", "active", "done", "skipped"] as const;

export type Scene = {
  id: string;
  title: string;
  /** Where, and when. */
  setting: string;
  /** Who is meant to be there. Free text: these are people in a story, not rows. */
  cast: string;
  /** What the scene is for — the change it exists to bring about. */
  purpose: string;
  /** Things that might happen. Possibilities, not obligations. */
  beats: string;
  /** Roughly where the scene ends. */
  ending: string;
};

export type Chapter = { id: string; title: string; summary: string; scenes: Scene[] };

/**
 * How hard the plan pulls. Gentle leans toward it and never pushes; Guided
 * treats the scene's purpose as what the scene should achieve; Firm drives
 * toward its ending. Moving on to the next scene is always the person's.
 */
export const STEERING = ["gentle", "guided", "firm"] as const;
export type Steering = (typeof STEERING)[number];
export const steeringOf = (v: unknown): Steering => (STEERING.includes(v as Steering) ? (v as Steering) : "gentle");

export type Apocryphon = {
  id: string;
  name: string;
  steering?: Steering;
  /** The story in a paragraph: where it starts and where it is meant to go. */
  premise: string;
  chapters: Chapter[];
};

/** A chat's place in a book. */
export type Bookmark = {
  book: string;
  /** The scene being played now, or "" once the book has run out. */
  scene: string;
  done: string[];
  skipped: string[];
};

const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const newId = () => crypto.randomUUID();

/** Whatever came over the wire, made into a book that cannot surprise anyone. */
export function normaliseChapters(raw: unknown): Chapter[] {
  const chapters = Array.isArray(raw) ? raw.slice(0, 200) : [];
  return chapters.map((ch: any) => ({
    id: str(ch?.id, 80) || newId(),
    title: str(ch?.title, 200),
    summary: str(ch?.summary, 20000),
    scenes: (Array.isArray(ch?.scenes) ? ch.scenes.slice(0, 300) : []).map((sc: any) => ({
      id: str(sc?.id, 80) || newId(),
      title: str(sc?.title, 200),
      setting: str(sc?.setting, 2000),
      cast: str(sc?.cast, 2000),
      purpose: str(sc?.purpose, 20000),
      beats: str(sc?.beats, 20000),
      ending: str(sc?.ending, 20000),
    })),
  }));
}

/** Every scene in reading order, with the chapter it sits in. */
export function scenesOf(book: Pick<Apocryphon, "chapters">): { scene: Scene; chapter: Chapter }[] {
  return book.chapters.flatMap((chapter) => chapter.scenes.map((scene) => ({ scene, chapter })));
}

/** An idea with no scenes yet. */
export const isOmen = (book: Pick<Apocryphon, "chapters">) => scenesOf(book).length === 0;

export function readBookmark(raw: unknown): Bookmark | null {
  if (!raw) return null;
  try {
    const j = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!j || typeof j.book !== "string" || !j.book) return null;
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
    return { book: j.book, scene: typeof j.scene === "string" ? j.scene : "", done: ids(j.done), skipped: ids(j.skipped) };
  } catch {
    return null;
  }
}

/** The first scene this chat has not yet played or passed over. */
function firstOpen(book: Apocryphon, done: string[], skipped: string[]): string {
  const closed = new Set([...done, ...skipped]);
  return scenesOf(book).find(({ scene }) => !closed.has(scene.id))?.scene.id ?? "";
}

/** Opening a book in a chat: at its first scene. */
export function startBookmark(book: Apocryphon): Bookmark {
  return { book: book.id, scene: firstOpen(book, [], []), done: [], skipped: [] };
}

/**
 * The scene is over — played out, or passed over — and the next open one
 * begins. Scenes already closed further on stay closed, so skipping ahead and
 * coming back to an earlier scene does not reopen everything after it.
 */
export function advance(book: Apocryphon, mark: Bookmark, how: "done" | "skipped"): Bookmark {
  if (!mark.scene) return mark;
  const done = how === "done" ? [...new Set([...mark.done, mark.scene])] : mark.done.filter((x) => x !== mark.scene);
  const skipped = how === "skipped" ? [...new Set([...mark.skipped, mark.scene])] : mark.skipped.filter((x) => x !== mark.scene);
  return { ...mark, done, skipped, scene: firstOpen(book, done, skipped) };
}

/** Choosing a scene by hand: it becomes the current one, and is reopened if it was closed. */
export function jumpTo(book: Apocryphon, mark: Bookmark, sceneId: string): Bookmark {
  if (!scenesOf(book).some(({ scene }) => scene.id === sceneId)) return mark;
  return {
    ...mark,
    scene: sceneId,
    done: mark.done.filter((x) => x !== sceneId),
    skipped: mark.skipped.filter((x) => x !== sceneId),
  };
}

export function statusOf(mark: Bookmark | null, sceneId: string): (typeof STATUSES)[number] {
  if (!mark) return "planned";
  if (mark.scene === sceneId) return "active";
  if (mark.done.includes(sceneId)) return "done";
  if (mark.skipped.includes(sceneId)) return "skipped";
  return "planned";
}

/**
 * What the model is told, or null when there is nothing to tell it.
 *
 * The whole design of the feature is in what this leaves out. The scene being
 * played, in full; the premise, so the scene is understood as part of
 * something; the *title* of the next scene, so a scene can lean toward it —
 * and nothing past that. Every field is worded as a possibility, and the end
 * of a scene as roughly-where-it-ends rather than a goal to reach, because a
 * model handed a destination drives straight at it.
 */
export function briefFor(book: Apocryphon, mark: Bookmark | null): string | null {
  if (!mark || mark.book !== book.id || !mark.scene) return null;
  const all = scenesOf(book);
  const at = all.findIndex(({ scene }) => scene.id === mark.scene);
  if (at < 0) return null;
  const { scene, chapter } = all[at];
  const closed = new Set([...mark.done, ...mark.skipped]);
  const next = all.slice(at + 1).find(({ scene: s }) => !closed.has(s.id))?.scene;

  const lines = [
    "# Where this story is headed",
    "The player has sketched a plan for this story. It is a plan, not a script: " +
      "none of it has happened until it happens here, and the player's choices " +
      "outrank it whenever the two disagree.",
  ];
  if (book.premise.trim()) lines.push(`The story as a whole: ${book.premise.trim()}`);
  const where = [chapter.title.trim() && `in "${chapter.title.trim()}"`].filter(Boolean).join(" ");
  lines.push(`The scene now${where ? ` (${where})` : ""}: ${scene.title.trim() || "untitled"}`);
  if (scene.setting.trim()) lines.push(`Setting: ${scene.setting.trim()}`);
  if (scene.cast.trim()) lines.push(`Who is meant to be here: ${scene.cast.trim()}`);
  const steer = steeringOf(book.steering);
  const purpose = scene.purpose.trim();
  const beats = scene.beats.trim();
  const ending = scene.ending.trim();
  if (steer === "gentle") {
    if (purpose) lines.push(`What this scene is for: ${purpose}`);
    if (beats) lines.push(`Things that could happen — possibilities, not obligations:\n${beats}`);
    if (ending) lines.push(`Roughly where the scene ends: ${ending}`);
    lines.push(
      "Let it unfold at the player's pace. Do not hurry toward the end of the scene, " +
        "do not announce that it is over, and do not mention this plan.",
    );
  } else if (steer === "guided") {
    if (purpose) lines.push(`This scene should accomplish: ${purpose}`);
    if (beats) lines.push(`Work these in as the scene goes, where they fit what the player does:\n${beats}`);
    if (ending) lines.push(`The scene is heading for: ${ending}`);
    lines.push(
      "Keep the scene moving toward that, a step at a time, through what the characters and the world do — " +
        "never by taking the player's choices from them. Do not mention this plan.",
    );
  } else {
    if (purpose) lines.push(`This scene must accomplish: ${purpose}`);
    if (beats) lines.push(`Bring these about:\n${beats}`);
    if (ending) lines.push(`Drive the scene to its ending: ${ending}`);
    lines.push(
      "Actively push toward that ending in every reply — through events, other characters and the world — " +
        "and reach it within the next few replies. The player still decides what their own character does; " +
        "everything else should be moving the scene toward its end. Do not mention this plan.",
    );
  }
  if (next?.title.trim()) {
    lines.push(`Later, not yet — do not bring it about in this scene: ${next.title.trim()}`);
  }
  return lines.join("\n");
}

// ---- import, export, and writing with a model -------------------------------
//
// One plain-text shape does all three jobs. A book exports as it, imports from
// it, and a model asked to write one writes in it — so whatever a person
// drafts in a notes app, or pastes from another assistant, or a cheap model
// produces, goes through the same forgiving reader:
//
//   # The Champion of the Hand
//   A marriage on her own terms, and what it costs.
//
//   ## The Tourney
//   Summary of the chapter, if any.
//
//   ### A Lion Cornered
//   Setting: The Red Keep, that evening
//   Cast: Jaime, Cersei
//   Purpose: Cersei learns of the betrothal
//   Beats:
//   - a dropped cup
//   - a threat, quietly made
//   Ending: Jaime leaves without answering
//
// Field names are matched loosely ("Where", "Who", "For", "Possible beats");
// a line that is not a field is added to whatever field came last, so prose
// wrapped over several lines is not lost.

type Draft = { name: string; premise: string; chapters: Chapter[]; steering?: Steering };

const FIELD_NAMES: [keyof Scene, RegExp][] = [
  ["setting", /^(?:setting|where(?: and when)?|location|place|when)$/],
  ["cast", /^(?:cast|who|characters|people|present|who is (?:meant to be )?there)$/],
  ["purpose", /^(?:purpose|for|goal|point|what (?:the scene|it) is for|why)$/],
  ["beats", /^(?:beats|possible beats|things that could happen|could happen|possibilities|events)$/],
  ["ending", /^(?:ending|ends|end|roughly where it ends|where it ends|exit)$/],
];

const fieldOf = (label: string): keyof Scene | null => {
  const l = label.toLowerCase().replace(/[*_]/g, "").trim();
  return FIELD_NAMES.find(([, re]) => re.test(l))?.[0] ?? null;
};

/** The outline text, read into a book. Null when there is not even a name or a scene in it. */
export function readOutline(text: string): Draft | null {
  const draft: Draft = { name: "", premise: "", chapters: [] };
  let chapter: Chapter | null = null;
  let scene: Scene | null = null;
  let field = "premise" as string | null;
  const add = (to: { [k: string]: any }, key: string, line: string) => {
    to[key] = to[key] ? `${to[key]}\n${line}` : line;
  };
  const newChapter = (title: string) => {
    chapter = { id: crypto.randomUUID(), title, summary: "", scenes: [] };
    draft.chapters.push(chapter);
    scene = null;
    field = "summary";
  };

  for (const raw of String(text ?? "").replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const head = line.match(/^(#{1,6})\s+(.*)$/);
    if (head) {
      const level = head[1].length;
      const title = head[2].replace(/^(?:chapter|scene)\s*[\dIVXLC]*\s*[:.—–-]\s*/i, "").trim() || head[2].trim();
      if (level === 1 && !draft.name && !draft.chapters.length) { draft.name = title; field = "premise"; continue; }
      if (level <= 2) { newChapter(title); continue; }
      if (!chapter) newChapter("");
      scene = { id: crypto.randomUUID(), title, setting: "", cast: "", purpose: "", beats: "", ending: "" };
      chapter!.scenes.push(scene);
      field = null;
      continue;
    }
    // "**Setting:** …" and "__Setting:__ …", as models like to write them, read as "Setting: …".
    const plain = line.replace(/^(\s*[-*]?\s*)(\*\*|__)([^*_]+?):\2/, "$1$3:");
    const labelled = plain.match(/^\s*[-*]?\s*\**([A-Za-z][A-Za-z ]{0,40}?)\**\s*:\s*(.*)$/);
    const key = labelled && scene ? fieldOf(labelled[1]) : null;
    if (key && scene) {
      field = key;
      if (labelled![2].trim()) add(scene, key, labelled![2].replace(/^[*_]+\s*/, "").trim());
      continue;
    }
    if (!line.trim()) continue;
    if (scene && field) add(scene, field, line.trim());
    else if (scene) add(scene, "purpose", line.trim());
    else if (chapter && field === "summary") add(chapter, "summary", line.trim());
    else if (!chapter) add(draft, "premise", line.trim());
  }
  if (!draft.name && !draft.chapters.length && !draft.premise) return null;
  return { name: draft.name, premise: draft.premise, chapters: normaliseChapters(draft.chapters) };
}

/** A book as the outline text: what exports, and what readOutline reads back. */
export function toOutline(book: Pick<Apocryphon, "name" | "premise" | "chapters">): string {
  const out: string[] = [`# ${book.name || "An untold story"}`];
  if (book.premise.trim()) out.push(book.premise.trim());
  for (const ch of book.chapters) {
    out.push("", `## ${ch.title || "Untitled chapter"}`);
    if (ch.summary.trim()) out.push(ch.summary.trim());
    for (const sc of ch.scenes) {
      out.push("", `### ${sc.title || "Untitled scene"}`);
      if (sc.setting.trim()) out.push(`Setting: ${sc.setting.trim()}`);
      if (sc.cast.trim()) out.push(`Cast: ${sc.cast.trim()}`);
      if (sc.purpose.trim()) out.push(`Purpose: ${sc.purpose.trim()}`);
      if (sc.beats.trim()) out.push(`Beats:\n${sc.beats.trim()}`);
      if (sc.ending.trim()) out.push(`Ending: ${sc.ending.trim()}`);
    }
  }
  return out.join("\n") + "\n";
}

/**
 * Whatever was imported, as books: Hearth's own export (one book or several),
 * a bare book object, or the outline text. Empty when nothing in it is a book.
 */
export function readImport(text: string): Draft[] {
  const t = String(text ?? "").trim();
  if (/^[\[{]/.test(t)) {
    try {
      const parsed = JSON.parse(t);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.books) ? parsed.books : [parsed];
      return list
        .filter((b: any) => b && typeof b === "object" && (b.name || Array.isArray(b.chapters)))
        .slice(0, 100)
        .map((b: any) => ({
          name: String(b.name ?? "").trim().slice(0, 200),
          premise: String(b.premise ?? "").slice(0, 20000),
          chapters: normaliseChapters(b.chapters),
          steering: steeringOf(b.steering),
        }));
    } catch {
      return [];
    }
  }
  const one = readOutline(t);
  return one ? [one] : [];
}

export const WRITE_APOC_SYSTEM = [
  "You help a person plan a story they will later play through, scene by scene, with another AI as narrator.",
  "You write plans, never prose: short, concrete, in the exact outline format asked for, with nothing before or after it.",
  "A plan is possibilities, not a script. Beats are things that could happen; an ending is roughly where a scene stops.",
  "Keep to the names, places and tone already given. Do not resolve the whole story in the first chapter.",
].join("\n");

const FORMAT_HELP = [
  "Use exactly this format:",
  "## Chapter title",
  "One line on what the chapter is about.",
  "",
  "### Scene title",
  "Setting: where and when",
  "Cast: who is meant to be there",
  "Purpose: what changes because of this scene",
  "Beats:",
  "- something that could happen",
  "- something else that could happen",
  "Ending: roughly where it stops",
].join("\n");

/** What a model is asked, for each of the three things it can be asked to write. */
export function apocWritePrompt(
  what: "premise" | "outline" | "scene",
  book: Pick<Apocryphon, "name" | "premise" | "chapters">,
  o: { idea?: string; chapter?: number; scene?: number; chapters?: number } = {},
): string {
  const known = toOutline(book).trim();
  const idea = String(o.idea ?? "").trim().slice(0, 1500);
  if (what === "premise") {
    return [
      `The story so far:\n${known}`,
      idea && `What the person wants: ${idea}`,
      "Write the story's premise: one paragraph, three to five sentences — where it starts, what is at stake, and roughly where it is meant to go. Only the paragraph.",
    ].filter(Boolean).join("\n\n");
  }
  if (what === "outline") {
    const n = Math.min(Math.max(Number(o.chapters) || 3, 1), 8);
    return [
      `The story so far:\n${known}`,
      idea && `What the person wants: ${idea}`,
      book.chapters.length
        ? `Write the next ${n} chapter${n === 1 ? "" : "s"}, following on from the last one above, each with two to four scenes.`
        : `Write ${n} chapter${n === 1 ? "" : "s"}, each with two to four scenes.`,
      FORMAT_HELP,
      "Only the chapters, starting with the first \"##\" line.",
    ].filter(Boolean).join("\n\n");
  }
  const ch = book.chapters[o.chapter ?? -1];
  const sc = ch?.scenes[o.scene ?? -1];
  return [
    `The story so far:\n${known}`,
    `Fill in the scene "${sc?.title || "the untitled scene"}" in the chapter "${ch?.title || "untitled"}". Keep anything it already says; write what is missing.`,
    idea && `What the person wants: ${idea}`,
    "Use exactly this format, for this one scene only:\n### Scene title\nSetting: …\nCast: …\nPurpose: …\nBeats:\n- …\nEnding: …",
  ].filter(Boolean).join("\n\n");
}

/** The one field a randomize button asks for, and how its answer is kept. */
export type FieldTarget =
  | { field: "name" | "premise" }
  | { field: "chapter.title" | "chapter.summary"; chapter: number }
  | { field: `scene.${"title" | "setting" | "cast" | "purpose" | "beats" | "ending"}`; chapter: number; scene: number };

const FIELD_ASK: Record<string, [string, number, boolean]> = {
  // what to write, the most characters kept, one line or several
  name: ["a title for the whole story: a few evocative words", 80, false],
  premise: ["the story's premise: one paragraph, three to five sentences — where it starts, what is at stake, roughly where it is meant to go", 1500, true],
  "chapter.title": ["a title for this chapter: a few words", 80, false],
  "chapter.summary": ["one or two sentences on what this chapter is about", 500, true],
  "scene.title": ["a title for this scene: a few words", 80, false],
  "scene.setting": ["where and when this scene takes place, in a short phrase", 160, false],
  "scene.cast": ["who is meant to be there, as a short comma-separated list of names", 200, false],
  "scene.purpose": ["what this scene is for — the change it brings about — in one or two sentences", 500, true],
  "scene.beats": ["three or four things that could happen in this scene, as a list with one \"- \" line each; possibilities, not a script", 800, true],
  "scene.ending": ["roughly where this scene stops, in one sentence", 300, true],
};

export function fieldLimits(field: string): { max: number; multiline: boolean } | null {
  const f = FIELD_ASK[field];
  return f ? { max: f[1], multiline: f[2] } : null;
}

/** What a model is asked for one field: the plan as it stands, and only that field back. */
export function apocFieldPrompt(book: Pick<Apocryphon, "name" | "premise" | "chapters">, t: FieldTarget): string | null {
  const ask = FIELD_ASK[t.field];
  if (!ask) return null;
  // By the field's own name: a request carries chapter and scene keys either way.
  const inChapter = t.field.startsWith("chapter.") || t.field.startsWith("scene.");
  const ch = inChapter ? book.chapters[(t as any).chapter] : undefined;
  const sc = t.field.startsWith("scene.") && ch ? ch.scenes[(t as any).scene] : undefined;
  if (inChapter && !ch) return null;
  if (t.field.startsWith("scene.") && !sc) return null;
  const where = sc ? `the scene "${sc.title || "untitled"}" in the chapter "${ch!.title || "untitled"}"`
    : ch ? `the chapter "${ch.title || "untitled"}"` : "the story as a whole";
  return [
    `The plan so far:\n${toOutline(book).trim()}`,
    `For ${where}, write ${ask[0]}.`,
    "Something fresh — not what is already there. Keep to the names, places and tone of the plan.",
    "Reply with only that text: no label, no heading, no quotation marks, nothing before or after it.",
  ].join("\n\n");
}

/** A model's answer for one field, cleaned to what the field can hold. Empty when there is nothing usable. */
export function cleanField(field: string, raw: string): string {
  const lim = fieldLimits(field);
  if (!lim) return "";
  let t = String(raw ?? "").replace(/^```[a-z]*\n?|```\s*$/gim, "").trim();
  t = t.replace(/^#+\s*/gm, "");
  // A label it was asked not to write: "Setting: …", "**Title:** …".
  t = t.replace(/^\s*\**\s*(?:title|name|premise|summary|setting|where|cast|who|purpose|beats|ending|scene|chapter)\s*\**\s*:\s*\**\s*/i, "");
  if (!lim.multiline) t = t.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  t = t.trim().replace(/^["“'‘*_]+|["”'’*_]+$/g, "").trim();
  return t.slice(0, lim.max);
}
