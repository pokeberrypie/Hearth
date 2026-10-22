#!/usr/bin/env python3
"""Generate the Hearth adaptive-icon VectorDrawables.

The design is a stone tavern fireplace: laid rubble courses with mortar
between them, soot climbing the breast, a timber lintel strapped in iron, a
pot on a crane over the fire, embers under two logs, and a candle and a
tankard on the mantel.

Two outputs from one source of truth:

  --refs     the repository form, @color/icon_* against values/colors.xml
  --literal  the same art with the hex values inlined, for compiling a
             drop-in replacement into an already-built APK (whose
             resources.arsc still holds the OLD icon_* values, so a
             reference there would resolve to the old grey stone)

VectorDrawable has no <rect>, <ellipse> or per-path transform, so every
shape is emitted as path data and rotations go through a <group>.
"""

import argparse

# --- palette -----------------------------------------------------------
# name -> hex. Emitted into values/colors.xml and referenced as
# @color/<name>, or inlined, depending on the mode.
PALETTE = {
    "icon_background":     "#FF1C100B",
    "icon_wall_warm":      "#FF3C2418",
    "icon_wall_deep":      "#FF150D09",
    "icon_wall_lit":       "#FF5E3217",

    "icon_mortar":         "#FF3F3124",
    "icon_stone":          "#FF8A6E52",
    "icon_stone_light":    "#FFA88B69",
    "icon_stone_dark":     "#FF7E6448",
    "icon_stone_warm":     "#FF9A7E60",
    "icon_stone_cool":     "#FF937A5C",
    "icon_stone_top":      "#FFAD8E6A",
    "icon_soot":           "#FF120A06",

    "icon_beam":           "#FF5A3A24",
    "icon_beam_light":     "#FF8A5F3C",
    "icon_beam_grain":     "#FF3A2214",
    "icon_iron":           "#FF241D18",
    "icon_iron_light":     "#FF5E544B",

    "icon_hollow":         "#FF190C07",
    "icon_backwall":       "#FF7A2F10",
    "icon_rim":            "#FFD6A96F",

    "icon_log":            "#FF5B3B26",
    "icon_log_dark":       "#FF47301F",
    "icon_log_end":        "#FF8A6442",
    "icon_log_end_dark":   "#FF79573A",

    "icon_ember":          "#FFFF7A2E",
    "icon_ember_light":    "#FFFFC46A",
    "icon_flame_deep":     "#FFC9471A",
    "icon_flame_mid":      "#FFF0862B",
    "icon_flame":          "#FFFFC14C",
    "icon_flame_hot":      "#FFFFF0BE",
    "icon_flame_core":     "#FFFFFBEE",
    "icon_glow":           "#FFFFA23A",
    "icon_firelight":      "#FFFFB861",
    "icon_spark":          "#FFFFCB7A",

    "icon_pot":            "#FF2A2420",
    "icon_pot_rim":        "#FF3A332D",
    "icon_pot_light":      "#FF6E6159",

    "icon_candle":         "#FFF0E2C2",
    "icon_candle_dim":     "#FFD8C8A4",
    "icon_candle_flame":   "#FFFFD276",
    "icon_candle_core":    "#FFFFF6DC",

    "icon_pewter":         "#FF8C8475",
    "icon_pewter_light":   "#FFB9B2A2",
    "icon_foam":           "#FFEFE7D4",
}

LITERAL = False


def col(name):
    return PALETTE[name] if LITERAL else "@color/" + name


def n(v):
    """Trim floats so the path data stays readable."""
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


# --- shape helpers -----------------------------------------------------

def rr(x, y, w, h, r=0.0):
    """Rounded rectangle as path data."""
    if r <= 0:
        return (f"M{n(x)},{n(y)} L{n(x+w)},{n(y)} L{n(x+w)},{n(y+h)} "
                f"L{n(x)},{n(y+h)} Z")
    r = min(r, w / 2, h / 2)
    return (
        f"M{n(x+r)},{n(y)} L{n(x+w-r)},{n(y)} "
        f"A{n(r)},{n(r)} 0 0 1 {n(x+w)},{n(y+r)} "
        f"L{n(x+w)},{n(y+h-r)} "
        f"A{n(r)},{n(r)} 0 0 1 {n(x+w-r)},{n(y+h)} "
        f"L{n(x+r)},{n(y+h)} "
        f"A{n(r)},{n(r)} 0 0 1 {n(x)},{n(y+h-r)} "
        f"L{n(x)},{n(y+r)} "
        f"A{n(r)},{n(r)} 0 0 1 {n(x+r)},{n(y)} Z"
    )


def ell(cx, cy, rx, ry):
    """Ellipse as two half-arcs."""
    return (f"M{n(cx-rx)},{n(cy)} "
            f"A{n(rx)},{n(ry)} 0 1 0 {n(cx+rx)},{n(cy)} "
            f"A{n(rx)},{n(ry)} 0 1 0 {n(cx-rx)},{n(cy)} Z")


def circ(cx, cy, r):
    return ell(cx, cy, r, r)


# --- emitters ----------------------------------------------------------

def path(d, fill=None, alpha=None, stroke=None, width=None,
         cap=None, indent=4, comment=None):
    pad = " " * indent
    out = []
    if comment:
        out.append(f"{pad}<!-- {comment} -->")
    out.append(f"{pad}<path")
    if fill:
        out.append(f'{pad}    android:fillColor="{fill}"')
    if alpha is not None:
        out.append(f'{pad}    android:fillAlpha="{alpha}"')
    if stroke:
        out.append(f'{pad}    android:strokeColor="{stroke}"')
    if width is not None:
        out.append(f'{pad}    android:strokeWidth="{width}"')
    if cap:
        out.append(f'{pad}    android:strokeLineCap="{cap}"')
    out.append(f'{pad}    android:pathData="{d}" />')
    return "\n".join(out)


def group(children, rotation=None, pivot=None, clip=None, indent=4,
          comment=None):
    pad = " " * indent
    out = []
    if comment:
        out.append(f"{pad}<!-- {comment} -->")
    attrs = ""
    if rotation is not None:
        attrs = (f' android:rotation="{n(rotation)}"'
                 f' android:pivotX="{n(pivot[0])}"'
                 f' android:pivotY="{n(pivot[1])}"')
    out.append(f"{pad}<group{attrs}>")
    if clip:
        out.append(f'{pad}    <clip-path android:pathData="{clip}" />')
    out.extend(children)
    out.append(f"{pad}</group>")
    return "\n".join(out)


# --- the artwork -------------------------------------------------------

# The chimney breast: a narrow flue at the top flaring out to the firebox.
# Every point is inside the r=36 safe circle about (54,54), so a circular
# launcher mask keeps the candle and the tankard.
BREAST = ("M40,22 L68,22 L72,32 L80,42 L80,74 L77,80 "
          "L31,80 L28,74 L28,42 L36,32 Z")

OPENING = "M40,80 L40,58 Q40,50 54,50 Q68,50 68,58 L68,80 Z"

STONE_TONES = ["icon_stone_warm", "icon_stone", "icon_stone_light",
               "icon_stone_dark", "icon_stone_cool"]

# Staggered courses. Odd rows start 6 left of even rows so the joints break
# between courses instead of lining up into a grid. The clip-path cuts the
# overhanging blocks mid-stone, which is what gives the edge its rubble look.
STONE_ROWS = [
    (23, [25, 37, 49, 61, 73]),
    (30, [19, 31, 43, 55, 67, 79]),
    (37, [25, 37, 49, 61, 73]),
    (44, [19, 31, 43, 55, 67, 79]),
    (51, [25, 37, 49, 61, 73]),
    # Below the lintel the firebox eats the middle, so only the piers are laid.
    (58, [19, 31, 67, 79]),
    (65, [25, 73]),
    (72, [19, 31, 67, 79]),
]


def stones():
    out = []
    i = 0
    for y, xs in STONE_ROWS:
        for x in xs:
            out.append(path(rr(x, y, 11, 6, 1.4),
                            fill=col(STONE_TONES[i % len(STONE_TONES)]),
                            indent=8))
            i += 1
    return out


def foreground():
    p = []
    add = p.append

    # Firelight on the wall is the background layer's radial gradient, not
    # stacked ellipses here: flat ellipses large enough to read as a glow
    # band into visible concentric rings at launcher sizes above ~96px.
    add(path(BREAST, fill=col("icon_mortar"),
             comment="The breast, in mortar colour. The stones are laid on "
                     "top of it,\n         so what shows between them is the "
                     "mortar itself."))

    add(group(
        stones() + [
            path(rr(28, 22, 52, 22), fill=col("icon_soot"), alpha="0.3",
                 indent=8,
                 comment="Daylight falls off towards the flue; firelight "
                         "catches the\n             stones nearest the "
                         "opening."),
            path(rr(28, 62, 52, 20), fill=col("icon_firelight"), alpha="0.14",
                 indent=8),
            path(ell(54, 56, 24, 19), fill=col("icon_soot"), alpha="0.22",
                 indent=8,
                 comment="Soot, fanning up the breast from the opening. A "
                         "clean\n             chimney reads as a drawing of "
                         "a fireplace. Two broad\n             passes, not "
                         "three tight ones, or the ellipse edge shows."),
            path(ell(54, 52, 17, 14), fill=col("icon_soot"), alpha="0.2",
                 indent=8),
        ],
        clip=BREAST,
        comment="45 laid stones in five tones, clipped to the breast."))

    add(path(OPENING, fill=col("icon_hollow"), comment="The firebox."))
    add(path(ell(54, 72, 14, 10), fill=col("icon_backwall"), alpha="0.6"))
    add(path("M40,80 L40,58 Q40,50 54,50 Q68,50 68,58 L68,80 L66,80 "
             "L66,58.4 Q66,52 54,52 Q42,52 42,58.4 L42,80 Z",
             fill=col("icon_rim"), alpha="0.5",
             comment="The inner face of the opening catches the fire."))

    add(path("M30,78 L78,78 L73,85 L35,85 Z", fill=col("icon_stone_dark"),
             comment="The hearthstone, tapered so a circular mask meets a "
                     "slope. Laid\n         before the fire, not after, so "
                     "the embers and the logs sit on\n         it instead of "
                     "being buried under it."))
    add(path("M30,78 L78,78 L76.6,80 L31.4,80 Z", fill=col("icon_stone_top")))
    add(path(ell(54, 82, 22, 4.2), fill=col("icon_firelight"), alpha="0.26"))

    add(path(ell(55, 70, 16, 14), fill=col("icon_glow"), alpha="0.22",
             comment="Glow off the fire itself, onto the firebox."))
    add(path(ell(55, 71, 11, 9), fill=col("icon_glow"), alpha="0.26"))

    add(path(rr(43, 75.2, 22, 4.4, 2.2), fill=col("icon_ember"),
             comment="The ember bed, and four bright coals in it."))
    for cx, cy, r in ((46, 77.4, 0.9), (51, 78.2, 0.7),
                      (57, 77.2, 0.8), (62, 78, 0.7)):
        add(path(circ(cx, cy, r), fill=col("icon_ember_light")))

    add(group([path(rr(40.5, 71, 27, 5.4, 2.7), fill=col("icon_log"), indent=8),
               path(ell(41.2, 74.4, 1.8, 2.7), fill=col("icon_log_end"),
                    indent=8)],
              rotation=-8, pivot=(54, 73.7),
              comment="Two logs across the embers, end grain showing."))
    add(group([path(rr(41.5, 73.4, 26, 5.2, 2.6), fill=col("icon_log_dark"),
                    indent=8),
               path(ell(66.4, 76, 1.7, 2.6), fill=col("icon_log_end_dark"),
                    indent=8)],
              rotation=7, pivot=(54, 76)))
    add(path("M46,74.6 C50,74.2 54,74.6 58,74.2", stroke=col("icon_ember"),
             width="0.8", cap="round", alpha=None,
             comment="A crack along the top log, lit from inside."))

    add("    <!-- The fire. Four nested shapes instead of a gradient: deep "
        "orange\n         through amber to a white core, plus a lick either "
        "side so the\n         silhouette is not symmetrical. -->")
    add(path("M55,55.5 C52,61.5 46.8,64.6 46.8,70.8 C46.8,76.4 50.4,79.6 "
             "55,79.6 C59.6,79.6 63.2,76.4 63.2,70.8 C63.2,66.8 61.2,63.8 "
             "58.8,60.8 C58.4,63.8 57,65.4 55.6,65.4 C57.2,61.8 56.8,58.2 "
             "55,55.5 Z", fill=col("icon_flame_deep")))
    add(path("M47.1,66.4 C45.7,69 44.7,70.6 44.7,72.6 C44.7,75.6 46.3,77.6 "
             "48.3,77.6 C49.9,77.6 50.9,76.4 50.9,74.4 C50.9,71.6 48.9,69.8 "
             "47.1,66.4 Z", fill=col("icon_flame_mid")))
    add(path("M62.1,64.4 C60.7,67.4 59.5,69.2 59.5,71.6 C59.5,74.8 61.1,76.8 "
             "62.9,76.8 C64.5,76.8 65.5,75.4 65.5,73.4 C65.5,70.4 63.9,68.2 "
             "62.1,64.4 Z", fill=col("icon_flame_mid")))
    add(path("M55,58.8 C52.6,63.6 48.8,66.2 48.8,71.2 C48.8,76 51.6,78.8 "
             "55,78.8 C58.4,78.8 61.2,76 61.2,71.2 C61.2,67.8 59.6,65.2 "
             "57.6,62.6 C57.3,65.2 56.2,66.6 55,66.6 C56.4,63.6 56,61 "
             "55,58.8 Z", fill=col("icon_flame")))
    add(path("M55,64.2 C53.2,67.4 51.9,69.4 51.9,71.8 C51.9,74.8 53.3,76.6 "
             "55,76.6 C56.7,76.6 58.1,74.8 58.1,71.8 C58.1,69.4 56.8,67.4 "
             "55,64.2 Z", fill=col("icon_flame_hot")))
    add(path("M55,69.4 C54.1,71.2 53.5,72.2 53.5,73.4 C53.5,74.9 54.2,75.8 "
             "55,75.8 C55.8,75.8 56.5,74.9 56.5,73.4 C56.5,72.2 55.9,71.2 "
             "55,69.4 Z", fill=col("icon_flame_core")))
    for cx, cy, r, a in ((48.2, 58.6, 0.9, "0.85"),
                         (61.4, 56.4, 0.75, "0.7"),
                         (57.6, 52.6, 0.6, "0.5")):
        add(path(circ(cx, cy, r), fill=col("icon_spark"), alpha=a))

    add("    <!-- An iron crane with a pot on it, silhouetted against the "
        "flames\n         rather than drawn in front of them. -->")
    add(path("M41.6,78 L41.6,55.4 L50,55.4", stroke=col("icon_iron"),
             width="1.7", cap="round"))
    add(path("M50,55.4 L50,58.2", stroke=col("icon_iron"), width="1.2",
             cap="round"))
    add(path("M44.4,59.6 A6,5.2 0 0 1 55.6,59.6", stroke=col("icon_iron"),
             width="1.1"))
    add(path(rr(43.3, 58.8, 13.4, 2.2, 1.1), fill=col("icon_pot_rim")))
    add(path("M44,61 L56,61 A6,6.6 0 0 1 44,61 Z", fill=col("icon_pot")))
    add(path("M46.2,64.6 A4.4,4.2 0 0 0 48.8,67.4", stroke=col("icon_pot_light"),
             width="1", cap="round", alpha=None))

    add("    <!-- A timber lintel, not a stone slab: the tavern cue. Grain, "
        "two iron\n         straps and four bolts. -->")
    add(path("M24,36 L84,36 L84,43.6 L81.6,46 L26.4,46 L24,43.6 Z",
             fill=col("icon_beam")))
    add(path("M24,36 L84,36 L84,38.2 L24,38.2 Z", fill=col("icon_beam_light")))
    for d in ("M28,41 L46,41", "M50,43.2 L72,43.2", "M58,40.2 L80,40.2"):
        add(path(d, stroke=col("icon_beam_grain"), width="0.6", cap="round"))
    add(path(rr(32.6, 36, 3, 10, 0.6), fill=col("icon_iron")))
    add(path(rr(72.4, 36, 3, 10, 0.6), fill=col("icon_iron")))
    for cx, cy in ((34.1, 38.6), (34.1, 43.4), (73.9, 38.6), (73.9, 43.4)):
        add(path(circ(cx, cy, 0.8), fill=col("icon_iron_light")))

    add("    <!-- A lit candle on the mantel: the icon's second light "
        "source. -->")
    add(path(ell(34, 35.2, 4.2, 1.5), fill=col("icon_pot_light")))
    add(path("M31.8,35.2 A2.2,1.8 0 0 1 36.2,35.2 Z", fill=col("icon_iron_light")))
    add(path(rr(32.7, 27.6, 2.6, 8, 1), fill=col("icon_candle")))
    add(path("M32.7,31 C33.5,32.4 32.9,33.6 32.7,34.6 L31.6,34.6 "
             "C31.6,33.2 31.9,32 32.7,31 Z", fill=col("icon_candle_dim")))
    add(path("M34,23.6 C35.5,25.6 35.9,26.4 35.9,27.4 C35.9,28.8 35.1,29.7 "
             "34,29.7 C32.9,29.7 32.1,28.8 32.1,27.4 C32.1,26.4 32.5,25.6 "
             "34,23.6 Z", fill=col("icon_candle_flame")))
    add(path("M34,26.4 C34.7,27.4 34.9,27.9 34.9,28.4 C34.9,29.1 34.5,29.5 "
             "34,29.5 C33.5,29.5 33.1,29.1 33.1,28.4 C33.1,27.9 33.3,27.4 "
             "34,26.4 Z", fill=col("icon_candle_core")))

    add("    <!-- And a tankard beside it. -->")
    add(path("M78.4,30.2 A2.5,2.5 0 0 1 78.4,34.6", stroke=col("icon_pewter"),
             width="1.7"))
    add(path(rr(69.8, 28.2, 8.8, 7.8, 1.3), fill=col("icon_pewter")))
    add(path(rr(69.8, 30.4, 8.8, 1.1), fill=col("icon_pewter_light"),
             alpha="0.7"))
    add(path(rr(69.8, 33.6, 8.8, 1.1), fill=col("icon_pewter_light"),
             alpha="0.55"))
    add(path(ell(74.2, 28.2, 4.6, 1.8), fill=col("icon_foam")))

    return "\n".join(p)


FOREGROUND_HEAD = '''<?xml version="1.0" encoding="utf-8"?>
<!--
  A stone tavern hearth.

  Generated art — see mobile/android/icon/gen_icon.py. The shape is built for 48px as
  much as for 192: a dark arch, one bright flame in the middle of it and a
  heavy horizontal beam across the top carry the silhouette, and the stone
  courses, soot and grain average into warm texture rather than disappearing.

  Everything is inside a circle of radius 36 about the centre — the adaptive
  icon safe zone — so a circle, squircle or rounded-square mask all keep the
  candle and the tankard. That is why the hearthstone tapers at the bottom
  and the flue narrows at the top.

  Depth here is layered flat fills and fillAlpha rather than gradients, for
  two reasons. One is that stacked flat ellipses stood in for a glow and
  banded into visible concentric rings above about 96px, so the firelight on
  the wall is left to the background layer's radial and the foreground only
  lights what it touches. The other is that the same art has to compile into
  an already-built APK, which cannot gain the extra resource entries a
  <aapt:attr> gradient needs — see --literal below. A from-source build has
  no such limit, so refinements here may use gradients freely.
-->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">

'''

BACKGROUND = '''<?xml version="1.0" encoding="utf-8"?>
<!--
  The lit wall behind the hearth. The foreground draws the fire's own glow;
  this is the room it is burning in — warm where the opening is, falling away
  to near black at the corners so the flame stays the brightest point under
  any mask.
-->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:pathData="M0,0 L108,0 L108,108 L0,108 Z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:type="radial"
                android:centerX="54" android:centerY="64"
                android:gradientRadius="58"
                android:startColor="{lit}"
                android:centerColor="{warm}"
                android:endColor="{deep}" />
        </aapt:attr>
    </path>
</vector>
'''


# Where a comment belongs in colors.xml: keyed on the entry it precedes.
GROUP_NOTES = {
    "icon_background": "The room the fire is burning in. The background\n"
                       "         layer interpolates between the lit and deep\n"
                       "         values across a radial gradient.",
    "icon_mortar": "Rubble stone, laid in staggered courses over the\n"
                   "         mortar ground, so what shows between the blocks is\n"
                   "         the mortar itself. Five tones, cycled, so no two\n"
                   "         neighbouring stones match.",
    "icon_beam": "A timber lintel strapped in iron, not a stone slab:\n"
                 "         the difference between a tavern and a manor house.",
    "icon_hollow": "Inside the firebox — near black, with the inner\n"
                   "         faces of the opening catching the fire.",
    "icon_log": "Two logs across the embers, end grain showing.",
    "icon_ember": "The fire, banded from deep orange through amber to\n"
                  "         a white core. Four nested shapes stand in for the\n"
                  "         gradient the foreground layer cannot afford.",
    "icon_pot": "A pot on an iron crane, silhouetted against the flames.",
    "icon_candle": "A lit candle on the mantel: the icon's second light\n"
                   "         source, and the reason the stone reads as lit\n"
                   "         rather than painted.",
    "icon_pewter": "And a tankard beside it.",
}


def colors_xml():
    lines = ['<?xml version="1.0" encoding="utf-8"?>',
             "<!--",
             "  The hearth icon's palette. Nothing else in the app reads these.",
             "",
             "  Generated — see mobile/android/icon/gen_icon.py, which writes",
             "  this file and both launcher drawables from one table.",
             "-->",
             "<resources>"]
    for name, value in PALETTE.items():
        note = GROUP_NOTES.get(name)
        if note:
            lines.append("")
            lines.append(f"    <!-- {note} -->")
        lines.append(f'    <color name="{name}">{value}</color>')
    lines.append("</resources>")
    return "\n".join(lines) + "\n"


def main():
    global LITERAL
    ap = argparse.ArgumentParser()
    ap.add_argument("--literal", action="store_true")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    LITERAL = args.literal

    import os
    os.makedirs(args.out, exist_ok=True)

    with open(os.path.join(args.out, "ic_launcher_foreground.xml"), "w") as f:
        f.write(FOREGROUND_HEAD + foreground() + "\n</vector>\n")

    with open(os.path.join(args.out, "ic_launcher_background.xml"), "w") as f:
        f.write(BACKGROUND.format(lit=PALETTE["icon_wall_lit"],
                                  warm=PALETTE["icon_wall_warm"],
                                  deep=PALETTE["icon_wall_deep"]))

    with open(os.path.join(args.out, "colors.xml"), "w") as f:
        f.write(colors_xml())

    print("wrote", args.out, "literal" if LITERAL else "refs")


if __name__ == "__main__":
    main()
