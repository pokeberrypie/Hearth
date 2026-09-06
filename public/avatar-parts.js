/* ---- the gear ----------------------------------------------------------------
 *
 * The parts that ship with Hearth, drawn in code.
 *
 * ## Why this file is only gear
 *
 * The first version of this tried to draw faces from bezier curves written by
 * hand — eyes, noses, hairstyles. They were bad, and the failure was not one
 * more revision away: a face is a drawing, and writing coordinates in a text
 * editor is not drawing. Hair especially, which needs volume and strands and a
 * silhouette that means something.
 *
 * Hard-edged geometry is the opposite case. Plate armour IS planes and rivets,
 * a cloak IS a swept shape, horns ARE curves. Those come out fine as vector and
 * would gain very little from being drawn, so they ship here and save every
 * pack author from redrawing a pauldron.
 *
 * Faces, hair and expressions come from packs. See src/avatar.ts.
 *
 * ## One skull
 *
 * Everything is drawn to the same head on a 200x200 square, and packs are drawn
 * to the same landmarks. That is what lets any hair sit on any face and any
 * pauldron sit on any shoulder without the combinations being drawn by hand.
 *
 *     skull        top y=38, widest y=80, x 62..138   (76 across)
 *     chin         y=148
 *     eye line     cy=100 — eyes span x 75..92 and x 108..125
 *     brows        y=86
 *     nose         y=108..118, centred
 *     mouth        y=128
 *     ears         y=94..116, meeting the head at x=62 / x=138
 *     neck         x=89..111, y=148..164
 *     shoulders    y=164 out to the frame
 *
 * The template the maker hands out draws these as guides.
 *
 * ## Symmetry
 *
 * A part with a left and a right is drawn ONCE, as `pair`, and mirrored about
 * x=100 by the engine. Hand-matching two sets of bezier coordinates is how you
 * get gear that is subtly wrong in a way nobody can point at.
 *
 * ## Tokens
 *
 *     %C   this layer's tint
 *     %D   the same tint, darkened — the shadow half of the cel shading
 *     %L   the line colour, shared so everything looks like one drawing
 */

/*
 * Wrapped, and handing out exactly one name.
 *
 * app.js is a classic script and already has a `fill` of its own; the shorthands
 * below are worth having and are nobody else's business.
 */
(function () {

/** Silhouette and detail. The whole vocabulary of line weight. */
const S = 2.6;
const F = 1.6;

const fill = (d, w = S) =>
  `<path d="${d}" fill="%C" stroke="%L" stroke-width="${w}" stroke-linejoin="round"/>`;

const line = (d, w = F, extra = "") =>
  `<path d="${d}" fill="none" stroke="%L" stroke-width="${w}" stroke-linecap="round" ` +
  `stroke-linejoin="round" ${extra}/>`;

const shade = (d, o = 0.45) => `<path d="${d}" fill="%D" opacity="${o}"/>`;

const HEARTH_GEAR = [

  /* ---- background --------------------------------------------------------- */
  { layer: "bg", id: "plain", name: "Plain", tint: "bg",
    art: `<rect width="200" height="200" fill="%C"/>` },
  { layer: "bg", id: "halo", name: "Halo", tint: "bg",
    art: `<rect width="200" height="200" fill="%D"/>` +
         `<circle cx="100" cy="94" r="70" fill="%C"/>` },
  { layer: "bg", id: "arch", name: "Arch", tint: "bg",
    art: `<rect width="200" height="200" fill="%D"/>` +
         `<path d="M42 200V98a58 58 0 0 1 116 0v102z" fill="%C"/>` },

  /* ---- wings, behind everything ------------------------------------------- */
  { layer: "wings", id: "bat", name: "Bat wings", tint: "wings",
    pair: `<path d="M80 164C52 134 26 136 14 152c15-5 24 0 30 9-13-2-20 6-18 16 ` +
          `13-9 24-7 33-2-9 4-13 11-9 18 15-13 31-18 47-16z"` +
          ` fill="%C" stroke="%L" stroke-width="${S}" stroke-linejoin="round"/>` },
  { layer: "wings", id: "feathered", name: "Feathered", tint: "wings",
    pair: `<path d="M82 166C56 138 28 136 16 150c16 0 27 7 34 18-14-4-25 2-29 13 ` +
          `14-7 27-5 38 2-11 2-16 9-14 18 16-14 32-20 49-20z"` +
          ` fill="%C" stroke="%L" stroke-width="${S}" stroke-linejoin="round"/>` +
          `<path d="M50 154c9 2 18 7 25 14M45 174c11 0 20 4 27 9"` +
          ` fill="none" stroke="%L" stroke-width="1.4" stroke-linecap="round" opacity="0.65"/>` },

  /* ---- build --------------------------------------------------------------- */
  { layer: "body", id: "average", name: "Average", tint: "skin",
    art: fill("M89 142h22v22H89z") +
         shade("M89 142h22v9c-7 5-15 5-22 0z") +
         fill("M100 164c-29 0-54 15-60 36h120c-6-21-31-36-60-36z") },
  { layer: "body", id: "slim", name: "Slim", tint: "skin",
    art: fill("M91 142h18v22H91z") +
         shade("M91 142h18v9c-6 5-12 5-18 0z") +
         fill("M100 164c-24 0-45 15-51 36h102c-6-21-27-36-51-36z") },
  { layer: "body", id: "broad", name: "Broad", tint: "skin",
    art: fill("M87 142h26v22H87z") +
         shade("M87 142h26v9c-8 5-18 5-26 0z") +
         fill("M100 162c-35 0-63 16-69 38h138c-6-22-34-38-69-38z") },

  /* ---- a head to hang a face on -------------------------------------------
   * One shape, no features. Not a face — packs draw those — but without it a
   * maker with no pack installed renders a headless body, which reads as
   * broken rather than as empty. */
  { layer: "head", id: "silhouette", name: "Plain", tint: "skin",
    art: fill("M100 38c21 0 38 17 38 42 0 17-3 32-8 44-5 13-13 22-24 24H94" +
          "c-11-2-19-11-24-24-5-12-8-27-8-44 0-25 17-42 38-42z") +
         shade("M100 38c21 0 38 17 38 42 0 17-3 32-8 44-4 10-10 18-18 22 7-16 11-38 11-62 " +
          "0-20-8-35-23-46z", 0.4) },
  { layer: "ears", id: "round", name: "Round", tint: "skin",
    pair: `<path d="M64 95c-6-1-10 3-10 9s4 11 10 12" fill="%C" stroke="%L"` +
          ` stroke-width="${S}" stroke-linejoin="round"/>` },
  { layer: "ears", id: "pointed", name: "Pointed", tint: "skin",
    pair: `<path d="M64 96L46 68c1 21 7 35 17 44z" fill="%C" stroke="%L"` +
          ` stroke-width="${S}" stroke-linejoin="round"/>` +
          `<path d="M59 82c2 10 5 17 9 22" fill="none" stroke="%L" stroke-width="1.3"` +
          ` opacity="0.55"/>` },
  { layer: "ears", id: "long", name: "Long", tint: "skin",
    pair: `<path d="M64 96L38 58c1 28 9 46 24 56z" fill="%C" stroke="%L"` +
          ` stroke-width="${S}" stroke-linejoin="round"/>` +
          `<path d="M55 76c3 14 7 24 12 31" fill="none" stroke="%L" stroke-width="1.3"` +
          ` opacity="0.55"/>` },

  /* ---- clothes ------------------------------------------------------------ */
  { layer: "clothes", id: "tunic", name: "Tunic", tint: "clothes",
    art: fill("M82 167C56 175 38 185 32 200h136c-6-15-24-25-50-33l-18 17z") +
         line("M82 167l18 17 18-17") },
  { layer: "clothes", id: "robe", name: "Robe", tint: "clothes",
    art: fill("M80 166C52 174 34 185 28 200h144c-6-15-24-26-52-34l-20 12z") +
         shade("M100 178l-6 22h12z", 0.4) +
         line("M80 166l20 12 20-12") },
  { layer: "clothes", id: "shirt", name: "Collared shirt", tint: "clothes",
    art: fill("M82 167C56 175 38 185 32 200h136c-6-15-24-25-50-33l-18 13z") +
         fill("M82 167l18 13-11 12-11-18z", 1.6) +
         fill("M118 167l-18 13 11 12 11-18z", 1.6) },
  { layer: "clothes", id: "dress", name: "Dress", tint: "clothes",
    art: fill("M80 167C54 175 36 185 30 200h140c-6-15-24-25-50-33-7 6-13 9-20 9s-13-3-20-9z") +
         line("M80 167c7 6 13 9 20 9s13-3 20-9") },
  { layer: "clothes", id: "cloak", name: "Cloak", tint: "clothes",
    art: fill("M84 166C52 174 30 186 24 200h152c-6-14-28-26-60-34l-16 10z") +
         shade("M84 166l16 10 16-10 8 34H76z", 0.35) },

  /* ---- armour ------------------------------------------------------------- */
  { layer: "armor", id: "pauldrons", name: "Pauldrons", tint: "armor",
    pair: `<path d="M70 169C50 176 34 186 28 200h46c3-15 1-25-4-31z"` +
          ` fill="%C" stroke="%L" stroke-width="${S}" stroke-linejoin="round"/>` +
          `<path d="M62 182c7 2 12 5 15 10" fill="none" stroke="%L" stroke-width="1.4"` +
          ` opacity="0.6"/>` +
          `<circle cx="45" cy="190" r="2.4" fill="%D" stroke="%L" stroke-width="1.2"/>` },
  { layer: "armor", id: "breastplate", name: "Breastplate", tint: "armor",
    art: fill("M84 168C60 177 42 187 36 200h128c-6-13-24-23-48-32l-16 11z") +
         line("M100 179v21M84 186h32", 1.4, `opacity="0.55"`) },
  { layer: "armor", id: "gorget", name: "Gorget", tint: "armor",
    art: fill("M85 164c-5 5-7 10-7 15 7 5 14 7 22 7s15-2 22-7c0-5-2-10-7-15" +
          "-5 5-10 7-15 7s-10-2-15-7z") },
  { layer: "armor", id: "mail", name: "Chainmail", tint: "armor",
    art: fill("M82 167C56 175 38 185 32 200h136c-6-15-24-25-50-33l-18 15z") +
         line("M46 192h108M52 183h96M62 174h76", 1.4,
              `opacity="0.4" stroke-dasharray="1.5 3.5"`) },

  /* ---- horns, crowns and hats --------------------------------------------- */
  { layer: "crown", id: "horns", name: "Horns", tint: "crown",
    pair: `<path d="M74 48C60 34 54 18 62 8c5 14 13 26 22 34z" fill="%C" stroke="%L"` +
          ` stroke-width="${S}" stroke-linejoin="round"/>` },
  { layer: "crown", id: "curled", name: "Curled horns", tint: "crown",
    pair: `<path d="M72 52C52 46 42 28 52 14c2 14 12 24 25 28z" fill="%C" stroke="%L"` +
          ` stroke-width="${S}" stroke-linejoin="round"/>` },
  { layer: "crown", id: "circlet", name: "Circlet", tint: "crown",
    art: `<path d="M64 78c11-7 61-7 72 0l-2 6c-11-6-57-6-68 0z" fill="%C" stroke="%L"` +
         ` stroke-width="1.8" stroke-linejoin="round"/>` +
         `<circle cx="100" cy="78" r="5" fill="%D" stroke="%L" stroke-width="1.8"/>` },
  { layer: "crown", id: "hood", name: "Hood", tint: "crown",
    art: `<path d="M100 16c-31 0-50 25-50 58 0 10 2 17 4 23 4-29 13-44 25-50 ` +
         `7 6 28 6 42 0 12 6 21 21 25 50 2-6 4-13 4-23 0-33-19-58-50-58z" fill="%C"` +
         ` stroke="%L" stroke-width="${S}" stroke-linejoin="round"/>` },
  { layer: "crown", id: "hat", name: "Wide hat", tint: "crown",
    art: `<path d="M30 66c0-6 31-11 70-11s70 5 70 11-31 11-70 11-70-5-70-11z" fill="%C"` +
         ` stroke="%L" stroke-width="${S}" stroke-linejoin="round"/>` +
         `<path d="M72 62C72 32 85 14 100 14s28 18 28 48c-8 4-48 4-56 0z" fill="%C"` +
         ` stroke="%L" stroke-width="${S}" stroke-linejoin="round"/>` +
         `<path d="M72 58c8 4 48 4 56 0" fill="none" stroke="%L" stroke-width="1.6"` +
         ` opacity="0.7"/>` },
];

window.HEARTH_PARTS = HEARTH_GEAR;

})();
