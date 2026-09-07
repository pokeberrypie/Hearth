/**
 * The scaffolding a preset asks a model to build before it writes the scene.
 *
 * The big roleplay presets all work the same way: the model plans in named
 * blocks and writes the story in one of its own. In SillyTavern a pile of
 * regex scripts hides the planning; anyone who brings the preset here without
 * those scripts was getting the whole apparatus in every reply — the reader
 * looking at the scaffolding instead of the building.
 *
 * These are source-shape tests rather than DOM ones, for the same reason the
 * other browser-half tests in this suite are: there is no DOM here, and the
 * thing worth pinning down is which tags are known and what each becomes.
 *
 *   bun test src/planblocks.test.ts
 */

import { describe, expect, test } from "bun:test";

const APP = await Bun.file(new URL("../public/app.js", import.meta.url)).text();
const CSS = await Bun.file(new URL("../public/style.css", import.meta.url)).text();

/** The list of tags that fold, as the browser has it. */
const FOLDED = (() => {
  const m = APP.match(/const FOLDED = "([^"]+)"/);
  return (m?.[1] ?? "").split("|");
})();

describe("which blocks fold", () => {
  test("the ones the big presets actually emit", () => {
    for (const tag of ["scene_plan", "tracker", "status", "momentum", "analysis", "plan"]) {
      expect(FOLDED).toContain(tag);
    }
  });

  /*
   * `prose` is the odd one out and the important one. It is not scaffolding,
   * it is the scene — so it is unwrapped and read, never folded. Folding it
   * would hide the reply behind a disclosure triangle, which is the failure
   * this whole change exists to avoid, inverted.
   */
  test("but not the one that holds the story", () => {
    expect(FOLDED).not.toContain("prose");
    expect(APP).toContain('tag === "prose" ? prose(m[3])');
  });

  test("and the tag list is what the matcher is built from", () => {
    expect(APP).toContain("${FOLDED}");
    expect(APP).toContain("prose|true_thoughts|thoughts|threads|thinking");
  });
});

describe("what a fold looks like", () => {
  /*
   * Folded, not deleted. It is genuinely useful to open the plan when a scene
   * goes somewhere strange, and quietly dropping a third of what the model
   * said is a thing an app should never do on a guess.
   */
  test("the working out is kept, shut", () => {
    const fn = APP.slice(APP.indexOf("function foldEl("), APP.indexOf("function prose("));
    expect(fn).toContain("<details");
    expect(fn).toContain("planbody");
    expect(fn.includes("hidden")).toBe(false);
  });

  /*
   * Presets are not consistent about `<summary>`: some write a sentence and
   * some write the whole table. A closed label forty lines long is worse than
   * no label at all.
   */
  test("a summary that is really a body does not become the label", () => {
    const fn = APP.slice(APP.indexOf("function foldEl("), APP.indexOf("function prose("));
    expect(fn).toContain("one.length <= 80");
    expect(fn).toContain('!/\\n/.test(found[1].trim())');
  });

  test("and a label that is used is not also printed underneath", () => {
    const fn = APP.slice(APP.indexOf("function foldEl("), APP.indexOf("function prose("));
    expect(fn).toContain('inner.replace(found[0], "")');
  });

  test("the fold is styled as reference rather than as prose", () => {
    expect(CSS).toContain(".threads.plan");
    expect(CSS).toContain(".planbody");
  });
});

describe("nesting", () => {
  /*
   * A <prose> block contains <true_thoughts> and coloured spans, so rendering
   * it means running the same pass again over what was inside. A single shared
   * regex object cannot do that: `lastIndex` is state on the regex, and the
   * inner pass would move it out from under the outer one — which skips
   * everything after the first <prose> block in the reply.
   */
  test("recursing into prose does not lose the rest of the reply", () => {
    const fn = APP.slice(APP.indexOf("function prose(text) {"));
    const body = fn.slice(0, 900);
    expect(body).toContain("new RegExp(TAGGED.source");
    expect(body).toContain("re.exec(src)");
    // The old shared-state version is gone.
    expect(body.includes("TAGGED.exec(src)")).toBe(false);
  });
});

describe("what still wins", () => {
  /*
   * Somebody who has imported the preset's own regex scripts gets those
   * instead: renderBody hands the text to the display scripts first and only
   * falls through to this when they changed nothing.
   */
  test("a display script the reader imported themselves", () => {
    const fn = APP.slice(APP.indexOf("function renderBody("), APP.indexOf("function renderBody(") + 400);
    expect(fn).toContain("if (!regexScripts.length) return prose(raw)");
    expect(fn).toContain("scripted === raw ? prose(raw) : sanitise(scripted)");
  });
});
