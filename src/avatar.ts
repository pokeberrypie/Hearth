/**
 * Avatar packs — the drawn art the face-maker is built out of.
 *
 * ## Why the server barely appears in this feature
 *
 * A drawn avatar is an ordinary PNG in `uploads/`, uploaded through the same
 * endpoint as a photograph, because that is what every avatar in Hearth already
 * is: a URL something sets as a background image. The recipe that made it rides
 * inside that PNG in a tEXt chunk, written and read in the browser. So the
 * server never sees a recipe and does not need to — the picture is the record,
 * and it stays editable wherever it goes, including out through a character
 * card export, because the card writer preserves tEXt chunks it does not own.
 *
 * What is left for this file is the one part that genuinely needs storage: the
 * packs. Somebody draws forty hairstyles, and they have to live somewhere and
 * be served back with URLs the maker can load.
 *
 * ## Why packs exist at all
 *
 * The first version of this shipped shapes drawn in code, and they were bad in
 * a way that more code could not fix — an eye is a drawing, not an equation.
 * The quality ceiling of a face-maker is set by how much good art it has, so
 * the honest design is one that treats art as content: drawn elsewhere, dropped
 * in, no code changed, no privileged built-in set. An extension adding a hat
 * and a pack adding a hat go down the same path.
 *
 * ## One skull
 *
 * Every part in every pack is drawn on the same square, to the same landmarks.
 * That is the whole reason any hair fits any face without the pack author
 * drawing the combinations. It is a drawing convention, not something this file
 * can check — a manifest can say `layer: "hair"` about a picture of a boot —
 * so what is validated here is only the shape of the claim.
 */

/**
 * The layers, in the order they are drawn — back to front.
 *
 * Shared with public/avatar.js, which must agree with this list. Two copies is
 * a real cost, paid because the alternative is the browser importing server
 * modules; the list changes about never, and the pack validator refusing an
 * unknown layer is what catches a mismatch.
 */
export const LAYERS = [
  "bg", "wings", "hairBack", "body", "clothes", "armor",
  "head", "ears", "brows", "eyes", "nose", "mouth", "hair", "crown", "mark",
] as const;

export type Layer = (typeof LAYERS)[number];

/**
 * The colours a recipe carries, each shared by whichever layers use it.
 *
 * Shared rather than per-layer so one drawn hairstyle covers every hair colour
 * instead of needing forty drawings, and so brows follow the hair without
 * anybody having to remember to set them.
 */
export const TINTS = [
  "bg", "skin", "hair", "eye", "clothes", "armor", "crown", "wings", "lip",
] as const;

export type Tint = (typeof TINTS)[number];

export type PackPart = {
  layer: Layer;
  id: string;
  name: string;
  /** The file inside the pack, relative and already checked for escapes. */
  file: string;
  /**
   * Which colour this part follows, if any.
   *
   * A tinted part is drawn in greyscale and multiplied by the chosen colour,
   * which is how one hairstyle becomes every hair colour. A part with no tint
   * is used exactly as drawn, which is what you want for anything whose colours
   * are the point — a specific tabard, a face with makeup on it.
   */
  tint: Tint | null;
};

export type Pack = {
  id: string;
  name: string;
  author: string;
  parts: PackPart[];
};

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const clean = (v: unknown, max: number) => str(v).replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Ids are used as object keys, put in URLs and written into generated markup,
 * so they are held to one narrow shape rather than escaped in three places.
 */
const ID = /^[a-z0-9][a-z0-9-]{0,30}$/;

export function slugId(v: unknown): string {
  return clean(v, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Whether a path inside a pack is one we will read.
 *
 * A manifest is a file somebody downloaded, and `file` from it becomes a path
 * on disk. Absolute paths, drive letters, backslashes and `..` are all refused
 * rather than normalised: there is no legitimate pack that needs any of them,
 * and "reject" is a much easier thing to be sure of than "sanitise".
 */
export function safePackPath(v: unknown): string | null {
  const p = str(v).trim();
  if (!p || p.length > 120) return null;
  if (p.includes("\\") || p.includes("\0")) return null;
  if (p.startsWith("/") || /^[a-z]:/i.test(p)) return null;
  if (p.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  if (!/\.(png|webp|svg)$/i.test(p)) return null;
  return p;
}

/**
 * Reads a manifest and returns the parts worth keeping.
 *
 * One bad entry is dropped rather than failing the pack, for the same reason a
 * class import skips a broken class: an import that refuses thirty-nine good
 * hairstyles because the fortieth has a typo is an import nobody uses twice.
 * What is returned alongside is the list of what was dropped, so the person who
 * drew them can be told which ones.
 */
export function readPackManifest(raw: any, fallbackName = "Pack"): {
  pack: Pack;
  skipped: string[];
} {
  const skipped: string[] = [];
  const seen = new Set<string>();
  const parts: PackPart[] = [];

  const list = Array.isArray(raw?.parts) ? raw.parts : [];
  for (const one of list.slice(0, 500)) {
    const layer = str(one?.layer) as Layer;
    const id = slugId(one?.id ?? one?.name);
    const file = safePackPath(one?.file);
    const label = clean(one?.name ?? one?.id ?? one?.file, 40) || "unnamed";

    if (!(LAYERS as readonly string[]).includes(layer)) { skipped.push(label); continue; }
    if (!ID.test(id)) { skipped.push(label); continue; }
    if (!file) { skipped.push(label); continue; }
    // Within one pack an id has to be unique per layer, or the second one is
    // unreachable and the person who drew it never finds out why.
    const key = `${layer}/${id}`;
    if (seen.has(key)) { skipped.push(label); continue; }
    seen.add(key);

    const tint = str(one?.tint) as Tint;
    parts.push({
      layer,
      id,
      name: label,
      file,
      tint: (TINTS as readonly string[]).includes(tint) ? tint : null,
    });
  }

  return {
    pack: {
      id: slugId(raw?.id ?? raw?.name ?? fallbackName) || "pack",
      name: clean(raw?.name, 60) || fallbackName,
      author: clean(raw?.author, 60),
      parts,
    },
    skipped,
  };
}

/** Whether there is anything in this worth storing. */
export function packIsUsable(p: Pack): boolean {
  return p.parts.length > 0;
}
