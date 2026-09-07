/**
 * Where "delete messages" lives.
 *
 * It was a row at the bottom of the chat menu, two taps and a scroll from the
 * thread it acts on — which is the wrong distance for a thing you reach for
 * mid-conversation, and the wrong neighbourhood: everything else in that menu
 * is a setting or a document, and this is an action on what is in front of
 * you. It belongs with continue and impersonate, behind the plus.
 *
 * The tests are about the move being a move: gone from one place, working in
 * the other, and still connected to the same handler rather than to a second
 * copy of it.
 *
 *   bun test src/composertray.test.ts
 */

import { describe, expect, test } from "bun:test";

const HTML = await Bun.file(new URL("../public/index.html", import.meta.url)).text();
const APP = await Bun.file(new URL("../public/app.js", import.meta.url)).text();
const CSS = await Bun.file(new URL("../public/style.css", import.meta.url)).text();

/** The chat menu's markup, on its own. */
const SHEET = (() => {
  const at = HTML.indexOf('id="chatSheetTitle"');
  return HTML.slice(at, HTML.indexOf("</div>", HTML.indexOf('data-act="close"', at)));
})();

/** The tray the plus opens. */
const TRAY = (() => {
  const at = HTML.indexOf('class="hc-guided-actions"');
  return HTML.slice(at, HTML.indexOf("</div>", HTML.indexOf('id="guidePick"', at)));
})();

describe("delete messages", () => {
  test("is in the tray, beside continue and impersonate", () => {
    expect(TRAY).toContain('id="guidePick"');
    expect(TRAY).toContain('data-act="select"');
    // The neighbours it was asked to sit with.
    expect(TRAY).toContain('id="guideImper"');
    expect(TRAY).toContain('id="guideCont"');
  });

  test("is gone from the chat menu rather than in both places", () => {
    expect(SHEET).toContain('data-act="close"');
    expect(SHEET.includes('data-act="select"')).toBe(false);
    // And only one control in the whole app claims the action.
    expect([...HTML.matchAll(/data-act="select"/g)]).toHaveLength(1);
  });

  /*
   * The same handler, not a second copy. The click listener already accepted
   * `data-act` from inside `.hc-guided` — which is why this move is markup and
   * one line of state, and why it cannot drift from the menu version: there
   * is no menu version left.
   */
  test("runs the handler that was already there", () => {
    expect(APP).toContain('case "select": setMsgSelect(true); break;');
    expect(APP).toContain('!row.closest(".hc-guided")');
  });

  test("is off in a chat with nothing in it", () => {
    const fn = APP.slice(APP.indexOf("function syncGuideActions("));
    expect(fn.slice(0, 900)).toContain("pick.disabled = all.length === 0");
  });

  /*
   * Set apart from the buttons before it. Everything to its left is pressed
   * constantly and this one throws messages away; the row is `flex: none` and
   * sized to its contents, so `margin-left: auto` would have had no free space
   * to eat and would have drawn no gap at all.
   */
  test("is not one slip of the thumb from continue", () => {
    expect(TRAY).toContain("hc-round--apart");
    const rule = CSS.slice(CSS.indexOf(".hc-round--apart"));
    expect(rule.slice(0, 60)).toMatch(/margin-left:\s*\d+px/);
  });
});
