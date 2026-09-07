/**
 * The three switches on the Behaviour page, and the two that were not wired.
 *
 * "Let every character roll dice" was saved but never loaded. So every page
 * load left the box unticked whatever was stored — and loadSettings triggered
 * a save of its own on the way past, through setWallpaper, which wrote that
 * unticked box back over the setting. Opening Hearth turned dice off. Turning
 * them on again lasted until the next reload, which is the sort of thing that
 * gets reported as "the dice are broken again" rather than as a settings bug.
 *
 * "Let the room follow the story" was neither saved nor loaded. The server has
 * read `scene_follows` since it was written, and there was no way to switch it
 * on: a whole feature behind a checkbox wired to nothing.
 *
 * Only "Ask before deleting" worked, because it had been wired by hand, one
 * control at a time — which is how the other two came to be missed. They are
 * loaded from the list now, so adding a switch to PREFS is all it takes.
 *
 * These read public/app.js. The wiring is browser-side and a server test would
 * pass either way, which is what let this ship.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULTS } from "./schema";

const APP = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");
const HTML = readFileSync(join(import.meta.dir, "..", "public", "index.html"), "utf8");

/** The names in `const PREFS = [...]`. */
const PREFS = (() => {
  const m = APP.match(/const PREFS = \[([^\]]*)\]/);
  if (!m) throw new Error("PREFS is not in app.js any more");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
})();

describe("every switch on the page is in the list", () => {
  test("dice, the room, and confirmations", () => {
    expect(PREFS).toContain("dice_enabled");
    expect(PREFS).toContain("scene_follows");
    expect(PREFS).toContain("confirm_deletes");
  });

  test("and the server has a default for each of them", () => {
    // A key the server has never heard of comes back undefined and the box
    // reads it as off, which looks exactly like a switch that will not stay on.
    for (const p of PREFS) expect(DEFAULTS[p]).toBeDefined();
  });

  test("each one is a real checkbox in the markup", () => {
    for (const p of PREFS) expect(HTML).toContain(`id="${p}"`);
  });
});

describe("they are loaded as well as saved", () => {
  test("loadSettings walks the same list it saves", () => {
    // The bug in one line: PREFS appeared once, in the save. Twice or it is
    // write-only, and a write-only setting overwrites itself with a default.
    const uses = APP.match(/PREFS\.forEach/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });

  test("and the loader sets checked from the stored value", () => {
    const loop = APP.slice(APP.indexOf("PREFS.forEach((t) => {\n    const el"));
    expect(loop.slice(0, 400)).toContain("el.checked =");
    expect(loop.slice(0, 400)).toContain("PREF_DEFAULT_ON");
  });

  test("confirmations still default to on, the others to off", () => {
    const set = APP.match(/const PREF_DEFAULT_ON = new Set\(\[([^\]]*)\]\)/);
    expect(set).toBeTruthy();
    expect(set![1]).toContain("confirm_deletes");
    expect(set![1]).not.toContain("dice_enabled");
    expect(set![1]).not.toContain("scene_follows");
  });
});

describe("opening the app does not save over what it just read", () => {
  test("loadSettings restores the wallpaper without writing the look back", () => {
    /*
     * setWallpaper saves, because choosing one should. loadSettings calls it
     * to put the stored one back, which is not choosing one — and that write
     * carried every other field with it, including the ones not yet loaded.
     * That is the mechanism that ate the dice setting; a missing loader alone
     * would only have shown a wrong checkbox.
     */
    expect(APP).toContain(`setWallpaper(s.wallpaper || "", { save: false })`);
    expect(APP).toMatch(/function setWallpaper\(url, \{ save = true \} = \{\}\)/);
    expect(APP).toContain("if (save) saveLook();");
  });
});
