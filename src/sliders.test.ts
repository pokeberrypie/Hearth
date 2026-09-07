/**
 * Sliders you can move with a thumb, and sliders that say when they cannot.
 *
 * Reported as "the blur and solidity sliders are broken on mobile". They were
 * not broken, which is why nothing in the wiring looked wrong: they moved,
 * they saved, and they were either impossible to grab or being overruled.
 * Three separate things, all of which look identical from a phone.
 *
 *   bun test src/sliders.test.ts
 */

import { describe, expect, test } from "bun:test";

const CSS = await Bun.file(new URL("../public/style.css", import.meta.url)).text();
const APP = await Bun.file(new URL("../public/app.js", import.meta.url)).text();
const HTML = await Bun.file(new URL("../public/index.html", import.meta.url)).text();

describe("moving one with a finger", () => {
  /*
   * Every one of these lives in a panel that scrolls. A range input defaults
   * to `touch-action: auto`, so a drag starting on the thumb is a candidate
   * for scrolling the panel and the browser settles that in favour of the
   * scroll. With a mouse there is no ambiguity, which is why it has always
   * worked on a desktop and never on a phone.
   */
  test("the slider owns the gesture, not the panel behind it", () => {
    expect(CSS).toContain('input[type="range"] { touch-action: none; }');
  });

  /* 15px in a 22px box is under half of what either phone platform asks for. */
  test("the thumb is big enough to hit on a coarse pointer", () => {
    const block = CSS.slice(CSS.indexOf("@media (pointer: coarse)"));
    const body = block.slice(0, block.indexOf("\n}\n") + 3);
    expect(body).toContain("height: 34px");
    expect(body).toContain("width: 22px; height: 22px");
  });

  /* And the desktop is left exactly as it was: the base thumb is untouched. */
  test("only on a coarse pointer", () => {
    const base = CSS.slice(0, CSS.indexOf("@media (pointer: coarse)"));
    expect(base).toContain("width: 15px; height: 15px");
    expect(base.includes("touch-action: none")).toBe(true);
  });
});

describe("when the system overrules them", () => {
  /*
   * A device asking for reduced transparency gets solid messages and no blur,
   * enforced with `!important`. That is right — it is a stated preference. The
   * bug was doing it in silence: the two sliders moved, saved, and changed
   * nothing, which is indistinguishable from two dead controls.
   */
  test("the stylesheet still honours the preference", () => {
    const block = CSS.slice(CSS.indexOf("@media (prefers-reduced-transparency: reduce)"));
    expect(block.slice(0, 300)).toContain("backdrop-filter: none !important");
  });

  test("and the panel says so instead of looking broken", () => {
    expect(HTML).toContain('id="plainNote"');
    expect(APP).toContain('matchMedia("(prefers-reduced-transparency: reduce)").matches');
    const fn = APP.slice(APP.indexOf("function applyLook() {"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain('$("#plainNote")');
    expect(body).toContain('"plate_blur", "plate_opacity"');
  });

  /* The preference can change while the app is open. */
  test("and notices if that changes under it", () => {
    expect(APP).toContain('addEventListener?.(\n  "change"');
  });
});
