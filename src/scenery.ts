/**
 * Matching a scene to the sound of it, and to a picture you already own.
 *
 * The narrator writes `[[scene: the bridge at dusk, rain coming on]]` as the
 * story moves. That sentence is a good description of what the room should
 * sound and look like, and until now nothing read it for that — the wallpaper
 * and the ambience were set by hand and stayed wherever they were left, which
 * meant a game that walked from a tavern into a storm sounded exactly the same
 * in both.
 *
 * Two firm limits, and both come from things that were said out loud:
 *
 *   - **Never a picture you do not have.** This only ever picks from
 *     wallpapers already in your own folder, by name. It does not fetch, it
 *     does not generate, and it will not invent one. Nobody's wallpapers get
 *     messed with.
 *   - **Never without being asked.** Off unless switched on. A story that
 *     silently redecorates is worse than one that does not, because you cannot
 *     tell whether you did it.
 *
 * And a third that comes from how matching actually goes wrong: a weak match
 * is worse than none. "The sea" firing on the word "seat" would be a room
 * changing sound for no reason anybody could name, and the first time that
 * happens the feature is something to switch off rather than something to
 * trust. So a word has to be a whole word, and no match means no change.
 */

/** What each ambience actually sounds like, in the words a scene would use. */
const SOUNDS: Record<string, string[]> = {
  rain: ["rain", "raining", "rains", "rainfall", "downpour", "drizzle", "storm",
         "stormy", "wet", "puddles", "thunder", "shower"],
  wind: ["wind", "windy", "gale", "moor", "moors", "heath", "plain", "plains",
         "ridge", "cliff", "cliffs", "open country", "field", "fields", "snow"],
  fire: ["fire", "fireside", "hearth", "campfire", "brazier", "forge", "candle",
         "candles", "lantern", "torchlight", "embers", "tavern", "inn"],
  sea: ["sea", "ocean", "harbour", "harbor", "shore", "shoreline", "beach",
        "coast", "coastal", "waves", "tide", "docks", "quay", "port", "ship"],
  room: ["market", "crowd", "crowded", "tavern", "inn", "hall", "feast", "court",
         "square", "gathering", "throng", "marketplace", "common room"],
};

/**
 * Whole words only, and the longer phrases first.
 *
 * "open country" has to win over "country" appearing inside it, and "seat"
 * must never be "sea". Punctuation counts as a boundary, which is why this is
 * a regexp per phrase rather than a split on spaces.
 */
function says(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(text);
}

/**
 * The sound this scene wants, or nothing.
 *
 * Scored rather than first-past-the-post: a tavern in a storm says both fire
 * and rain, and the one mentioned more often is the one the scene is actually
 * about. A tie is not a decision, so it is left alone.
 */
export function soundFor(scene: unknown): string | null {
  const text = String(scene ?? "").toLowerCase();
  if (!text.trim()) return null;

  const scores = new Map<string, number>();
  for (const [id, words] of Object.entries(SOUNDS)) {
    let n = 0;
    for (const w of words) if (says(text, w)) n++;
    if (n) scores.set(id, n);
  }
  if (!scores.size) return null;

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}

/**
 * The wallpaper that best fits, out of the ones you already have.
 *
 * Matched on the filename, because that is the only thing about a picture this
 * program knows — somebody who names a file "greywater-bridge-dusk.png" has
 * told us what it is, and somebody whose files are IMG_2043.png has told us
 * nothing and will get nothing, which is the correct outcome rather than a
 * wrong picture.
 *
 * Two words have to match, not one. One shared word between a scene and a
 * filename is a coincidence often enough that acting on it would change the
 * room for no reason anybody could name.
 */
export function wallpaperFor(scene: unknown, files: string[]): string | null {
  const text = String(scene ?? "").toLowerCase();
  if (!text.trim() || !files?.length) return null;

  const wanted = new Set(
    text.split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w)),
  );
  if (!wanted.size) return null;

  let best: { file: string; score: number } | null = null;
  for (const file of files) {
    const words = String(file).toLowerCase()
      .replace(/\.[a-z0-9]+$/, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3 && !STOP.has(w));
    const score = words.filter((w) => wanted.has(w)).length;
    if (score >= 2 && (!best || score > best.score)) best = { file, score };
  }
  return best?.file ?? null;
}

/** Words that say nothing about a place, and would match everything. */
const STOP = new Set([
  "the", "and", "with", "into", "from", "over", "under", "then", "that", "this",
  "there", "here", "where", "when", "what", "some", "very", "just", "onto",
  "your", "their", "have", "been", "were", "will", "would", "about", "after",
  "before", "again", "still", "png", "jpg", "jpeg", "webp", "image", "wallpaper",
]);
