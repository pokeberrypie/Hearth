#!/usr/bin/env python3
"""The loading screen's hearth, from the icon's own drawing.

Reads the launcher foreground that gen_icon.py writes (its literal-colour
form) and turns it into SVG for public/hearthfire.js, leaving out what the
loading screen draws for itself: the little static flame, its glow and
sparks, and the pot on its crane, which would hang in the middle of the fire.

  python3 mobile/android/icon/gen_icon.py --literal --out /tmp/lit
  python3 mobile/android/icon/boot_hearth.py /tmp/lit/ic_launcher_foreground.xml > /tmp/hearth.svg

hearthfire.template.js beside this file is public/hearthfire.js with the drawing
taken out (__HEARTH__); put the output in its place to write the fire again, and
copy the result to mobile/android/app/src/main/assets/hearthfire.js as well.
"""

import sys
import xml.etree.ElementTree as ET

A = "{http://schemas.android.com/apk/res/android}"

# What the loading screen leaves out, by the colours the icon paints it in.
FLAME = {"#FFC9471A", "#FFF0862B", "#FFFFC14C", "#FFFFF0BE", "#FFFFFBEE", "#FFFFCB7A", "#FFFFA23A"}
POT = {"#FF2A2420", "#FF3A332D"}
CRANE_STROKES = {"#FF241D18", "#FF6E6159"}


def colour(argb):
    a = argb.upper()
    return "#" + a[3:] if len(a) == 9 else a


def keep(el):
    fill = (el.get(A + "fillColor") or "").upper()
    stroke = (el.get(A + "strokeColor") or "").upper()
    if fill in FLAME or fill in POT:
        return False
    if stroke and stroke in CRANE_STROKES:
        return False
    return True


clips = []


def convert(el, out, depth=0):
    for child in el:
        tag = child.tag
        if tag == "path":
            if not keep(child):
                continue
            attrs = [f'd="{child.get(A + "pathData")}"']
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
                clips.append(f'<clipPath id="{cid}"><path d="{clip.get(A + "pathData")}"/></clipPath>')
                g.append(f'clip-path="url(#{cid})"')
            inner = []
            convert(child, inner, depth + 1)
            if inner:
                out.append("<g " + " ".join(g) + ">" + "".join(inner) + "</g>")


root = ET.parse(sys.argv[1]).getroot()
body = []
convert(root, body)
print(("<defs>" + "".join(clips) + "</defs>" if clips else "") + "".join(body))
