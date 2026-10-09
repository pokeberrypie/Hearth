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

export type Apocryphon = {
  id: string;
  name: string;
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
  if (scene.purpose.trim()) lines.push(`What this scene is for: ${scene.purpose.trim()}`);
  if (scene.beats.trim()) lines.push(`Things that could happen — possibilities, not obligations:\n${scene.beats.trim()}`);
  if (scene.ending.trim()) lines.push(`Roughly where the scene ends: ${scene.ending.trim()}`);
  lines.push(
    "Let it unfold at the player's pace. Do not hurry toward the end of the scene, " +
      "do not announce that it is over, and do not mention this plan.",
  );
  if (next?.title.trim()) {
    lines.push(`Later, not yet — do not bring it about in this scene: ${next.title.trim()}`);
  }
  return lines.join("\n");
}
