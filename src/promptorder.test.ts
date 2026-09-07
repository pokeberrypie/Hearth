/**
 * Where the character sits in the prompt.
 *
 * The opening of a prompt is the most attended-to place in it, and it used to
 * hold `main` — four lines of framing that read identically for every card in
 * the library — with the character third, behind lore. Reported as the model
 * "fighting" the card: a generic agreeable assistant wearing the name.
 *
 * So the description leads and the framing follows it. `worldInfoBefore` came
 * up with it rather than being left stranded, because "before the character"
 * is a position and lore that sets up a world the card assumes has to arrive
 * before the card does.
 *
 * The awkward part is that this one decision is written in four places — the
 * server's default assembly, the default block list, the blocks editor in the
 * browser, and the table's own preset. They are reachable by different routes
 * (no preset, a new preset, a saved preset, tabletop) and a reader comparing
 * two of them would have no way to tell which was authoritative. So this file
 * asserts they say the same thing.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_PARTS } from "./prompt";
import { DEFAULT_BLOCKS } from "./presets";
import { TABLE_PRESET } from "./tablepreset";

const APP = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");

/** The marker keys of MARKER_LABEL, in the order they are written. */
function browserOrder(): string[] {
  const start = APP.indexOf("const MARKER_LABEL = {");
  if (start === -1) throw new Error("MARKER_LABEL is not in app.js any more");
  const body = APP.slice(start, APP.indexOf("};", start));
  return [...body.matchAll(/^\s{2}([A-Za-z]+):/gm)].map((m) => m[1]);
}

describe("the character leads", () => {
  test("in a chat with no preset at all", () => {
    expect(DEFAULT_PARTS.indexOf("charDescription"))
      .toBeLessThan(DEFAULT_PARTS.indexOf("main"));
  });

  test("in the list a new preset is built from", () => {
    const order = DEFAULT_BLOCKS.map((b) => b.marker);
    expect(order.indexOf("charDescription")).toBeLessThan(order.indexOf("main"));
  });

  test("in the blocks editor", () => {
    const order = browserOrder();
    expect(order.indexOf("charDescription")).toBeLessThan(order.indexOf("main"));
  });

  test("and at the table, above its own brief", () => {
    // The table's framing is a block rather than a marker — it is the mode's
    // own instructions, not the card's — so it is found by id.
    const order = TABLE_PRESET.blocks!.map((b) => b.marker ?? b.id);
    expect(order.indexOf("charDescription")).toBeLessThan(order.indexOf("table-main"));
  });
});

describe("lore that sets the character up still arrives first", () => {
  test("before_char is before the character, or its name is a lie", () => {
    for (const order of [DEFAULT_PARTS as string[], DEFAULT_BLOCKS.map((b) => b.marker!), browserOrder()]) {
      expect(order.indexOf("worldInfoBefore")).toBeLessThan(order.indexOf("charDescription"));
    }
    const table = TABLE_PRESET.blocks!.map((b) => b.marker ?? b.id);
    expect(table.indexOf("worldInfoBefore")).toBeLessThan(table.indexOf("charDescription"));
  });

  test("and after_char is still after it", () => {
    expect(DEFAULT_PARTS.indexOf("charDescription"))
      .toBeLessThan(DEFAULT_PARTS.indexOf("worldInfoAfter"));
  });
});

describe("the four lists agree", () => {
  test("on the order of everything they share", () => {
    /*
     * They are not the same list — the server's assembly has no chatHistory or
     * jailbreak in it, and the table swaps its own framing in for `main`. What
     * has to match is the relative order of the parts they do share, because
     * that is what somebody moving one of them would break without noticing.
     */
    const parts = DEFAULT_PARTS as string[];
    const blocks = DEFAULT_BLOCKS.map((b) => b.marker!);
    const browser = browserOrder();

    expect(blocks.filter((m) => parts.includes(m))).toEqual(parts);
    expect(browser.filter((m) => parts.includes(m))).toEqual(parts);
  });

  test("and the browser knows about every block the server ships", () => {
    // A marker the editor has no label for draws as its raw identifier, which
    // is how "charDescription" ends up on screen in a list of English words.
    for (const b of DEFAULT_BLOCKS) expect(browserOrder()).toContain(b.marker!);
  });
});
