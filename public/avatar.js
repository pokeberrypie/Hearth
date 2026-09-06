/* ---- drawn avatars -----------------------------------------------------------
 *
 * A face-maker built out of drawn art, and the machinery that turns what it
 * makes into an ordinary picture.
 *
 * ## What comes out is a PNG, on purpose
 *
 * Every avatar in Hearth is a URL under uploads/ that something sets as a
 * background image — the medallion, the chat header, the card export, the
 * persona export. A made face has to be the same kind of thing as an uploaded
 * one, or half the app needs teaching about a second kind. The character card
 * export in particular sniffs for PNG magic bytes and quietly falls back to
 * JSON for anything else, so an SVG avatar would silently stop characters
 * exporting as real cards.
 *
 * So: SVG is how the picture is composed, a raster is what is kept, and it goes
 * up through the same upload endpoint as a photograph. The whole feature needs
 * no new save path.
 *
 * ## The recipe lives inside the picture
 *
 * A PNG cannot be edited back into the choices that made it, and "change the
 * hair" is the second thing anybody wants. So the recipe is written into the
 * file as a tEXt chunk — the same mechanism character cards already use — right
 * here in the browser, before upload. One file, self-describing: export it,
 * send it to somebody, import it elsewhere, and it is still editable. It even
 * survives a character card export, because the card writer rebuilds the PNG
 * without touching chunks it does not own.
 *
 * ## The art is content, not code
 *
 * The first version of this drew faces from bezier curves written by hand. They
 * were bad, and no amount of further code would have fixed them, because an eye
 * is a drawing and not an equation. So parts are art files now, and packs are
 * how art arrives: a manifest and a folder of transparent PNGs, all drawn to the
 * same landmarks. Nothing here knows the name of a single hairstyle.
 *
 * What ships built in is the gear — backgrounds, cloaks, pauldrons, horns —
 * because hard-edged geometry is the one thing flat vector genuinely does well,
 * and a plain silhouette head so nothing ever renders headless. Faces come from
 * packs.
 *
 * ## Tinting drawn art
 *
 * A tinted part is drawn in greyscale and multiplied by the chosen colour, so
 * one hairstyle covers every hair colour instead of needing forty drawings. The
 * shading the artist painted survives the multiply, which is the whole reason
 * this works and a flat recolour would not.
 */
(function () {

/** Draw order, back to front. Mirrors LAYERS in src/avatar.ts. */
const LAYERS = [
  "bg", "wings", "hairBack", "body", "clothes", "armor",
  "head", "ears", "brows", "eyes", "nose", "mouth", "hair", "crown", "mark",
];

/** What each layer is called where somebody has to read it. */
const LAYER_NAMES = {
  bg: "Background", wings: "Wings", hairBack: "Hair behind", body: "Build",
  clothes: "Clothes", armor: "Armour", head: "Face", ears: "Ears",
  brows: "Brows", eyes: "Eyes", nose: "Nose", mouth: "Mouth", hair: "Hair",
  crown: "Head-wear", mark: "Markings",
};

/** Which tint each layer's parts follow, for the colour row under the choices. */
const LAYER_TINT = {
  bg: "bg", wings: "wings", hairBack: "hair", body: "skin", clothes: "clothes",
  armor: "armor", head: "skin", ears: "skin", brows: "hair", eyes: "eye",
  nose: null, mouth: "lip", hair: "hair", crown: "crown", mark: null,
};

/** Layers you cannot simply not have. A face with no head is not a choice. */
const REQUIRED = new Set(["head", "body"]);

/** The layers a pack has to supply before the maker can draw a person. */
const FACE_LAYERS = ["eyes", "hair", "mouth"];

/*
 * The line colour used by the built-in vector gear.
 *
 * Not a tint. The gear holds together because its outlines agree with each
 * other; letting this vary per layer is how a drawing stops looking like one
 * drawing. Drawn packs bring their own lines and never see this.
 */
const LINE = "#241a14";

const TINTS = ["bg", "skin", "hair", "eye", "clothes", "armor", "crown", "wings", "lip"];

const DEFAULT_TINTS = {
  bg: "#2b2119", skin: "#c68e63", hair: "#2f2620", eye: "#3b6b52",
  clothes: "#6b4f3a", armor: "#8a8f98", crown: "#c9a227", wings: "#5d3346",
  lip: "#a2604f",
};

/*
 * Palettes.
 *
 * Skin runs well past what a photograph would, because half the people at this
 * table are not going to be human and a Tiefling with a beige swatch is a worse
 * tool than one with a red one. The picker underneath takes any colour at all;
 * these are the ones that are one click away.
 */
const PALETTE = {
  skin: ["#f6ddc7", "#eec6a4", "#d9a273", "#c68e63", "#a9713f", "#82502c",
         "#5c3a20", "#3d2718", "#b8524a", "#8d3f4f", "#6f7fae", "#5f9ea0",
         "#8aa77f", "#9b8bb4", "#cfd3d8", "#7d8a94"],
  hair: ["#f2e2b8", "#e0c07a", "#c99a4e", "#a3662c", "#7a3f1d", "#4a2c1c",
         "#2f2620", "#171313", "#8d8d8d", "#d8d8d8", "#b5495b", "#6b4a8f",
         "#3f6f8f", "#4f8f6a"],
  eye: ["#3b6b52", "#5f8f4f", "#8a7b3a", "#8a5a2b", "#5a3a24", "#2f2a26",
        "#3f6f9f", "#5f9fbf", "#7f5f9f", "#a03f4f", "#c9a227", "#9aa4ad"],
  clothes: ["#6b4f3a", "#8a6a44", "#4a5a3f", "#3f4f6b", "#5d3346", "#7a2f2f",
            "#2f3436", "#d8cdb8", "#a9a08c", "#1f2429"],
  armor: ["#8a8f98", "#b6bcc4", "#6e7480", "#4a4f57", "#c9a227", "#8a6a2f",
          "#7a4a3a", "#2f3436"],
  crown: ["#c9a227", "#e0c46a", "#b6bcc4", "#8a8f98", "#7a3f1d", "#4a2c1c",
          "#2f3436", "#8d3f4f", "#3f6f8f", "#d8cdb8"],
  wings: ["#5d3346", "#3d2718", "#2f3436", "#7a2f2f", "#4a5a3f", "#d8cdb8",
          "#8a8f98", "#171313"],
  lip: ["#a2604f", "#8d4a44", "#c07a6a", "#6f3a3a", "#b5495b", "#7a4a5a"],
  bg: ["#2b2119", "#1f2429", "#3f4f4a", "#4a3f5a", "#6b4f3a", "#8a8f98",
       "#d8cdb8", "#1a1614"],
};

/* ---- colour ---------------------------------------------------------------- */

function hexToRgb(hex) {
  let h = String(hex || "").trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return [0, 0, 0];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));
const toHex = (rgb) => "#" + rgb.map((n) => clamp255(n).toString(16).padStart(2, "0")).join("");

/** The shadow half of a cel-shaded shape. One ratio, so shading reads evenly. */
const darken = (hex, by = 0.72) => toHex(hexToRgb(hex).map((n) => n * by));

/** Whether text or a tick on this colour wants to be light or dark. */
function isDark(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

const isHex = (c) => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(c || "").trim());

/* ---- the parts registry -----------------------------------------------------
 *
 * Three sources, one list: the built-in gear, whatever packs are installed, and
 * whatever extensions registered. Kept apart so that reloading extensions drops
 * theirs without disturbing the rest, and so nothing can quietly replace a part
 * by claiming its id — first registration of a layer+id wins and the loser says
 * so in the console. */

const PACK_PARTS = [];
const ADDED = [];

const allParts = () => [...(window.HEARTH_PARTS || []), ...PACK_PARTS, ...ADDED];
const partsFor = (layer) => allParts().filter((p) => p.layer === layer);
const findPart = (layer, id) =>
  allParts().find((p) => p.layer === layer && p.id === id) || null;

/** Whether enough has been installed to make a face rather than a mannequin. */
const canMakeFaces = () => FACE_LAYERS.some((l) => partsFor(l).length > 0);

function register(into, raw, from) {
  const p = raw || {};
  const layer = String(p.layer || "");
  const id = String(p.id || "").trim().toLowerCase();
  const say = (why) => { console.error(`[avatar] ${from}: ${why}`); return false; };

  if (!LAYERS.includes(layer)) return say(`unknown layer "${layer}"`);
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(id)) return say(`bad part id "${id}"`);
  if (findPart(layer, id)) return say(`${layer}/${id} is already taken`);

  const art = typeof p.art === "string" ? p.art : "";
  const pair = typeof p.pair === "string" ? p.pair : "";
  const image = typeof p.image === "string" ? p.image : "";
  if (!art && !pair && !image) return say(`${layer}/${id} has nothing to draw`);

  into.push({
    layer, id, art, pair, image,
    name: String(p.name || id).slice(0, 40),
    tint: TINTS.includes(p.tint) ? p.tint : null,
  });
  return true;
}

/** Registration from an extension. Same path as everything else, no privileges. */
const addPart = (raw) => register(ADDED, raw, "extension");

/** Dropped when extensions reload, so a removed pack's parts actually go. */
const clearAddedParts = () => { ADDED.length = 0; };

/* ---- drawn art --------------------------------------------------------------
 *
 * An SVG rasterised through an Image is loaded in "SVG as image" mode, which
 * forbids external references entirely — a `<image href="/uploads/...">` inside
 * it silently draws nothing. So every drawn part has to be inlined as a data
 * URI before it can be composed. Fetched once and kept; a pack is a few hundred
 * kilobytes and the alternative is refetching on every keystroke of the colour
 * picker. */

const INLINED = new Map();

async function inline(url) {
  if (INLINED.has(url)) return INLINED.get(url);
  try {
    const blob = await fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject()));
    const data = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
    INLINED.set(url, data);
    return data;
  } catch {
    // Remembered as missing, so a broken pack does not refetch forever.
    INLINED.set(url, null);
    return null;
  }
}

/** Everything the given recipe needs, inlined and ready to draw. */
async function ensureArt(recipe) {
  const r = norm(recipe);
  const urls = LAYERS
    .map((l) => (r.parts[l] ? findPart(l, r.parts[l]) : null))
    .filter((p) => p && p.image)
    .map((p) => p.image);
  await Promise.all([...new Set(urls)].map(inline));
}

/** Everything on one layer, for painting a row of choices. */
const ensureLayerArt = (layer) =>
  Promise.all(partsFor(layer).filter((p) => p.image).map((p) => inline(p.image)));

/* ---- rendering -------------------------------------------------------------- */

function norm(recipe) {
  const r = recipe && typeof recipe === "object" ? recipe : {};
  const parts = {};
  for (const layer of LAYERS) {
    const id = String(r.parts?.[layer] ?? "").trim().toLowerCase();
    if (id && id !== "none") parts[layer] = id;
  }
  const tints = { ...DEFAULT_TINTS };
  for (const t of TINTS) if (isHex(r.tints?.[t])) tints[t] = String(r.tints[t]).toLowerCase();
  return { v: 1, parts, tints };
}

/*
 * Ids inside the SVG have to be unique across the whole document, not just this
 * drawing — two avatars on one screen sharing a clipPath id means one of them
 * wears the other's clipping. A counter is enough.
 */
let keySeq = 0;

/** One vector fragment, with its tokens filled in. */
function paint(fragment, tint) {
  const c = tint || "#000000";
  return String(fragment)
    .replace(/%C/g, c)
    .replace(/%D/g, darken(c))
    .replace(/%L/g, LINE)
    .replace(/%K/g, () => String(++keySeq));
}

/**
 * A drawn part, tinted by multiplying it with the chosen colour.
 *
 * Multiply rather than a flat recolour because the artist's shading is in the
 * greyscale, and multiplying keeps it: a mid-grey strand under a brown becomes
 * a darker brown, which is a shadow. Flat-filling by alpha would throw away
 * every hour spent shading and hand back a silhouette.
 *
 * The composite clips the flood back to the drawing's own alpha, or the colour
 * would fill the whole square.
 */
function drawn(dataUri, tint) {
  const img = (extra = "") =>
    `<image href="${dataUri}" x="0" y="0" width="200" height="200"` +
    ` preserveAspectRatio="xMidYMid meet" ${extra}/>`;
  if (!tint) return img();
  const id = `t${++keySeq}`;
  return `<filter id="${id}" color-interpolation-filters="sRGB">` +
    `<feFlood flood-color="${tint}" result="c"/>` +
    `<feBlend in="c" in2="SourceGraphic" mode="multiply"/>` +
    `<feComposite operator="in" in2="SourceGraphic"/>` +
    `</filter>${img(`filter="url(#${id})"`)}`;
}

/**
 * A recipe as SVG markup.
 *
 * `size` is only the element's width and height; the drawing is always on the
 * same 200x200 square, which is the entire reason parts fit each other.
 *
 * Anything not yet inlined is skipped rather than drawn as a broken image, so a
 * preview painted before its art arrives is merely incomplete for a moment.
 */
function renderSvg(recipe, size = 200) {
  const r = norm(recipe);
  const body = [];
  for (const layer of LAYERS) {
    const id = r.parts[layer];
    if (!id) continue;
    const part = findPart(layer, id);
    if (!part) continue;
    const tint = part.tint ? r.tints[part.tint] : "";

    if (part.image) {
      const data = INLINED.get(part.image);
      if (data) body.push(drawn(data, tint));
      continue;
    }
    if (part.pair) {
      // Drawn once and mirrored about the centre line, so the two halves are
      // exactly each other rather than nearly.
      body.push(paint(part.pair, tint));
      body.push(`<g transform="translate(200,0) scale(-1,1)">${paint(part.pair, tint)}</g>`);
    }
    if (part.art) body.push(paint(part.art, tint));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 200 200" width="${size}" height="${size}">${body.join("")}</svg>`;
}

/**
 * The composed face as PNG bytes.
 *
 * Through an Image and a canvas, which needs no library and does not taint the
 * canvas, because the markup references nothing outside itself once the drawn
 * parts are inlined. That constraint is why `ensureArt` has to have finished
 * before this is called.
 */
function toPngBlob(recipe, size = 512) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(
      new Blob([renderSvg(recipe, size)], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        canvas.getContext("2d").drawImage(img, 0, 0, size, size);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no blob"))), "image/png");
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("could not draw that")); };
    img.src = url;
  });
}

/* ---- the recipe, inside the PNG ---------------------------------------------
 *
 * Written here rather than on the server so a made avatar goes up through the
 * ordinary avatar upload and nothing downstream needs to know it was made. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** The tEXt key the recipe travels under. Ours, and not one any card format uses. */
const RECIPE_KEY = "hearth-avatar";

const latin1 = (bytes) => {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
};

/** Walks a PNG's chunks. Yields [type, keyword, payload] for text chunks only. */
function* textChunks(png) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8;
  while (p + 8 <= png.length) {
    const len = view.getUint32(p);
    const type = latin1(png.subarray(p + 4, p + 8));
    if (type === "IEND") return;
    if (type === "tEXt") {
      const body = png.subarray(p + 8, p + 8 + len);
      const nul = body.indexOf(0);
      if (nul > 0) yield [p, len, latin1(body.subarray(0, nul)), body.subarray(nul + 1)];
    }
    p += 12 + len;
  }
}

/** A PNG rebuilt with the recipe in it, replacing any it already carried. */
function withRecipe(png, recipe) {
  const value = new TextEncoder().encode(JSON.stringify(norm(recipe)));
  const payload = new Uint8Array(RECIPE_KEY.length + 1 + value.length);
  for (let i = 0; i < RECIPE_KEY.length; i++) payload[i] = RECIPE_KEY.charCodeAt(i);
  payload[RECIPE_KEY.length] = 0;
  payload.set(value, RECIPE_KEY.length + 1);
  const ours = makeChunk("tEXt", payload);

  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const parts = [png.subarray(0, 8)];
  let p = 8;
  let wrote = false;

  while (p + 8 <= png.length) {
    const len = view.getUint32(p);
    const type = latin1(png.subarray(p + 4, p + 8));

    if (type === "tEXt") {
      const body = png.subarray(p + 8, p + 8 + len);
      const nul = body.indexOf(0);
      if (nul > 0 && latin1(body.subarray(0, nul)) === RECIPE_KEY) { p += 12 + len; continue; }
    }
    if (type === "IDAT" && !wrote) { parts.push(ours); wrote = true; }

    parts.push(png.subarray(p, p + 12 + len));
    p += 12 + len;
    if (type === "IEND") break;
  }

  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** The recipe inside a PNG, or null if it is an ordinary picture. */
function recipeIn(png) {
  try {
    for (const [, , key, payload] of textChunks(png)) {
      if (key !== RECIPE_KEY) continue;
      const parsed = JSON.parse(new TextDecoder("utf-8").decode(payload));
      const r = norm(parsed);
      return Object.keys(r.parts).length ? r : null;
    }
  } catch { /* an unreadable chunk means "not one of ours" */ }
  return null;
}

/**
 * The recipe inside a saved avatar, if it is one of ours.
 *
 * Null for an uploaded photograph, which is the honest answer — there is
 * nothing to edit back into choices.
 */
async function recipeOf(url) {
  if (!url || !String(url).startsWith("/uploads/")) return null;
  try {
    const buf = await fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()));
    return recipeIn(new Uint8Array(buf));
  } catch {
    return null;
  }
}

/* ---- packs ------------------------------------------------------------------ */

/**
 * Loads whatever packs are installed.
 *
 * Called on boot and after one is added or removed. Rebuilds rather than
 * appends, so removing a pack actually removes its parts.
 */
async function loadPacks() {
  PACK_PARTS.length = 0;
  let packs = [];
  try { packs = await fetch("/api/avatar/packs").then((r) => (r.ok ? r.json() : [])); }
  catch { return; }
  if (!Array.isArray(packs)) return;
  for (const pack of packs) {
    for (const part of pack.parts || []) {
      register(PACK_PARTS, { ...part, image: part.url }, `pack ${pack.name}`);
    }
  }
}

/* ---- a face to start from --------------------------------------------------- */

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * A random face.
 *
 * Weighted rather than uniform: everything optional being present half the time
 * gives you a horned, winged, war-painted stranger in a wide hat every single
 * time, which is funny twice.
 */
function randomRecipe() {
  const ids = (layer) => partsFor(layer).map((p) => p.id);
  const some = (layer) => (ids(layer).length ? pick(ids(layer)) : "");
  const maybe = (layer, chance) => (Math.random() < chance ? some(layer) : "");

  const parts = {
    bg: some("bg"), body: some("body"), head: some("head"), ears: some("ears"),
    eyes: some("eyes"), brows: some("brows"), nose: some("nose"), mouth: some("mouth"),
    clothes: some("clothes"),
    hair: maybe("hair", 0.9), hairBack: maybe("hairBack", 0.4),
    armor: maybe("armor", 0.3), crown: maybe("crown", 0.25),
    wings: maybe("wings", 0.12), mark: maybe("mark", 0.3),
  };
  for (const k of Object.keys(parts)) if (!parts[k]) delete parts[k];

  const tints = {};
  for (const t of TINTS) tints[t] = PALETTE[t] ? pick(PALETTE[t]) : DEFAULT_TINTS[t];
  return { v: 1, parts, tints };
}

/** The face the maker opens on when there is nothing to edit. */
function starterRecipe() {
  const first = (layer) => (partsFor(layer)[0] || {}).id;
  const parts = {};
  for (const layer of ["bg", "body", "head", "ears", "eyes", "brows", "nose",
                       "mouth", "hair", "clothes"]) {
    const id = first(layer);
    if (id) parts[layer] = id;
  }
  return { v: 1, parts, tints: { ...DEFAULT_TINTS } };
}

window.HearthAvatar = {
  LAYERS, LAYER_NAMES, LAYER_TINT, TINTS, PALETTE, REQUIRED,
  renderSvg, toPngBlob, withRecipe, recipeIn, recipeOf,
  ensureArt, ensureLayerArt, loadPacks, partsFor, canMakeFaces,
  addPart, clearAddedParts, randomRecipe, starterRecipe, norm,
  isDark, isHex, darken,
};

})();
