/**
 * Finding the other room.
 *
 * Hearth is two apps sharing a shelf, and which one you are in is the largest
 * thing on the screen — the sign over the door reads HEARTH or HEARTH:
 * TABLETOP. But the only way to change it was a card most of the way down the
 * menu, so people played in story mode for a week without learning there was a
 * table, or found the table once and could not find the way back out.
 *
 * So the sign is the door now. Which is a change with a sharp edge on it: the
 * same element holds the name of whoever you are sitting with once a chat is
 * open, and a tap there that walked you out of the room to change worlds would
 * be a far worse bug than a switch that was hard to find.
 *
 * That is the property this file guards. It reads public/app.js, because the
 * thing that can go wrong is a wiring mistake in a browser script, and a
 * server-side test would pass either way — which is exactly how the inspector
 * shipped describing the wrong character.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "..", "public", "style.css"), "utf8");

/** The body of one top-level function, for asking what it does. */
function body(name: string): string {
  const start = APP.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name}() is not in app.js any more`);
  const end = APP.indexOf("\n}\n", start);
  return APP.slice(start, end + 3);
}

describe("the sign, on the shelf", () => {
  test("is armed when the shelf is shown", () => {
    expect(body("showSplash")).toContain("paintModeSwitch(true)");
  });

  test("and pressing it changes rooms", () => {
    expect(APP).toContain(`$("#barTitle").addEventListener("click", barSwitch)`);
    expect(APP).toMatch(/const barSwitch = [\s\S]{0,240}setMode\(/);
  });

  test("it can be reached from a keyboard, being a control", () => {
    // An h1 wearing a button's clothes gets none of this for free.
    const wiring = APP.slice(APP.indexOf("const barSwitch"));
    expect(wiring).toContain(`"keydown"`);
    expect(wiring).toMatch(/e\.key !== "Enter" && e\.key !== " "/);
  });
});

describe("the name, in a chat", () => {
  test("is disarmed the moment a chat opens", () => {
    // openChat sets the bar to the character's name. If this call is lost, the
    // switch stays live over somebody's name and a mistap leaves the chat.
    const open = APP.slice(APP.indexOf("setBarTitle(chat.character_name"));
    expect(open.slice(0, 400)).toContain("paintModeSwitch(false)");
  });

  test("and the handler refuses to fire without the class", () => {
    // Belt and braces: even if some path forgets to disarm it, the press
    // itself checks. Two independent reasons for the dangerous case not to
    // happen, because the cost of it happening is somebody's open scene.
    expect(APP).toMatch(
      /const barSwitch = \(\) => \{\s*if \(!\$\("#barTitle"\)\.classList\.contains\("switch"\)\) return;/,
    );
  });
});

describe("a guest never gets it", () => {
  test("because the mode is not theirs to change", () => {
    // A guest has no drawer, no menu and no say in the mode. The title is the
    // one thing left on their screen that could be pressed, so it must stay a
    // title.
    expect(body("paintModeSwitch")).toContain("!GUEST.on");
  });
});

describe("what it looks like", () => {
  test("the affordance costs no width", () => {
    /*
     * fitBarTitle sizes the name by measuring how far it overflows the bar,
     * shrinking the type and then dropping the flourishes to make it fit. On
     * a 320px phone a long name is already at the floor — so a chevron or a
     * caret beside the title would be taken straight out of the name.
     */
    const rule = CSS.slice(CSS.indexOf("#barTitle.switch"), CSS.indexOf("#barTitle.switch") + 400);
    expect(rule).toContain("box-shadow");
    expect(rule).not.toContain("content:");
  });

  test("and it is drawn with something the gradient cannot clip away", () => {
    /*
     * The title is gradient-filled text: background-clip: text over a
     * transparent colour. A browser clips text decoration to the glyphs along
     * with the rest of that layer, so the first attempt at this — a dotted
     * text-decoration, correctly computed, correctly reported by
     * getComputedStyle — drew absolutely nothing on screen.
     *
     * A box shadow is painted on the box and survives the clip. If somebody
     * "tidies" this back into an underline, it disappears again silently.
     */
    const rule = CSS.slice(CSS.indexOf("#barTitle.switch"), CSS.indexOf("#barTitle.switch") + 400);
    expect(rule).not.toContain("text-decoration");
  });
});
