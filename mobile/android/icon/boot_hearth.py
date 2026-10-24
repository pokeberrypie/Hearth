#!/usr/bin/env python3
"""The loading screen's hearth, from the icon's own drawing.

Reads the launcher foreground that gen_icon.py writes (its literal-colour
form) and turns it into SVG for public/hearthfire.js, leaving out what the
loading screen draws for itself: the little static flame, its glow and
sparks, and the pot on its crane, which would hang in the middle of the fire.

  python3 mobile/android/icon/gen_icon.py --literal --out /tmp/lit
  python3 mobile/android/icon/boot_hearth.py /tmp/lit/ic_launcher_foreground.xml > /tmp/hearth.svg
  python3 mobile/android/icon/boot_hearth.py /tmp/lit/ic_launcher_foreground.xml front > /tmp/grate.svg

hearthfire.template.js beside this file is public/hearthfire.js with the drawings
taken out (__HEARTH__ and __GRATE__); put the outputs in their places to write the fire again, and
copy the result to mobile/android/app/src/main/assets/hearthfire.js as well.
"""

import sys
import xml.etree.ElementTree as ET

A = "{http://schemas.android.com/apk/res/android}"

# What the loading screen leaves out, by the colours the icon paints it in.
FLAME = {"#FFC9471A", "#FFF0862B", "#FFFFC14C", "#FFFFF0BE", "#FFFFFBEE", "#FFFFCB7A", "#FFFFA23A"}
POT = {"#FF2A2420", "#FF3A332D"}
# The inside of the firebox: left open, so the fire — drawn behind the hearth — shows through the opening,
# behind the logs, and the stone in front of it hides where it starts.
HOLLOW = {"#FF190C07", "#FF7A2F10"}
# The logs and the embers under them: drawn on their own, in front of the fire, so the fire burns in the
# grate rather than over it. `front` writes only these; the hearth leaves them out.
GRATE = {"#FF5B3B26", "#FF47301F", "#FF8A6442", "#FF79573A", "#FFFF7A2E", "#FFFFC46A"}
FRONT = len(sys.argv) > 2 and sys.argv[2] == "front"
CRANE_STROKES = {"#FF241D18", "#FF6E6159"}


def colour(argb):
    a = argb.upper()
    return "#" + a[3:] if len(a) == 9 else a


def keep(el):
    fill = (el.get(A + "fillColor") or "").upper()
    stroke = (el.get(A + "strokeColor") or "").upper()
    grate = fill in GRATE or stroke in GRATE
    if FRONT != grate:
        return False
    if fill in FLAME or fill in POT or fill in HOLLOW:
        return False
    if stroke and stroke in CRANE_STROKES:
        return False
    return True


# The chimney breast, and the opening in it: the breast's mortar and everything laid over it are cut
# through there, so what burns behind the hearth is seen in the firebox.
BREAST = "M40,22 L68,22 L72,32 L80,42 L80,74 L77,80 L31,80 L28,74 L28,42 L36,32 Z"
OPENING = "M40,80 L40,58 Q40,50 54,50 Q68,50 68,58 L68,80 Z"

clips = []


def convert(el, out, depth=0):
    for child in el:
        tag = child.tag
        if tag == "path":
            if not keep(child):
                continue
            d = child.get(A + "pathData")
            cut = d.strip() == BREAST
            attrs = [f'd="{d + " " + OPENING if cut else d}"'] + (['fill-rule="evenodd"'] if cut else [])
            fill = child.get(A + "fillColor")
            stroke = child.get(A + "strokeColor")
            attrs.append(f'fill="{colour(fill)}"' if fill else 'fill="none"')
            if child.get(A + "fillAlpha"):
                attrs.append(f'fill-opacity="{child.get(A + "fillAlpha")}"')
            if stroke:
                attrs.append(f'stroke="{colour(stroke)}" stroke-width="{child.get(A + "strokeWidth")}"')
                if child.get(A + "strokeLineCap"):
                    attrs.append(f'stroke-linecap="{child.get(A + "strokeLineCap")}"')
            out.append("<path " + " ".join(attrs) + "/>")
        elif tag == "group":
            g = []
            rot = child.get(A + "rotation")
            if rot:
                g.append(f'transform="rotate({rot} {child.get(A + "pivotX")} {child.get(A + "pivotY")})"')
            clip = child.find("clip-path")
            if clip is not None:
                cid = f"bh{len(clips)}"
                cd = clip.get(A + "pathData")
                if cd.strip() == BREAST:
                    clips.append(f'<clipPath id="{cid}"><path clip-rule="evenodd" d="{cd} {OPENING}"/></clipPath>')
                else:
                    clips.append(f'<clipPath id="{cid}"><path d="{cd}"/></clipPath>')
                g.append(f'clip-path="url(#{cid})"')
            inner = []
            convert(child, inner, depth + 1)
            if inner:
                out.append("<g " + " ".join(g) + ">" + "".join(inner) + "</g>")


root = ET.parse(sys.argv[1]).getroot()
body = []
convert(root, body)
print(("<defs>" + "".join(clips) + "</defs>" if clips else "") + "".join(body))
