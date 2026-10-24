/**
 * Dialogue is styled apart from narration — whichever quotes the model used.
 *
 * The styling runs over text that has already been escaped. When esc() began
 * escaping quotes (so a name with a quote in it could not break out of an
 * attribute), straight-quoted dialogue stopped matching — it arrived as
 * &quot; — and went the colour of the narration. Pinned here to the real esc()
 * and the real styling, lifted out of app.js, so the two cannot drift apart
 * again unnoticed.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");
const escLine = APP.slice(APP.indexOf("const esc = "), APP.indexOf("\n\n", APP.indexOf("const esc = ")));
const start = APP.indexOf("function styleInline(");
const styleSrc = APP.slice(start, APP.indexOf("\n}\n", start) + 3);
const { esc, styleInline } = new Function(`${escLine}\n${styleSrc}\nreturn { esc, styleInline };`)();
const styled = (text: string) => styleInline(esc(text));

describe("dialogue", () => {
  test("in straight quotes, as most models write it", () => {
    expect(styled('"Seven hells," he said.')).toBe("<span class=say>&ldquo;Seven hells,&rdquo;</span> he said.");
  });

  test("in curly quotes", () => {
    expect(styled("“Seven hells,” he said.")).toBe("<span class=say>&ldquo;Seven hells,&rdquo;</span> he said.");
  });

  test("two lines in one paragraph are two, and the narration between them is not dialogue", () => {
    const out = styled('"Go," she said. "Now."');
    expect(out).toBe("<span class=say>&ldquo;Go,&rdquo;</span> she said. <span class=say>&ldquo;Now.&rdquo;</span>");
  });

  test("its own markup is never mistaken for dialogue", () => {
    const out = styled('"One." Then “two.”');
    expect(out).not.toContain("&lt;span");
    expect(out.match(/<span class=say>/g)?.length).toBe(2);
  });

  test("apostrophes, ampersands and angle brackets stay text", () => {
    const out = styled("\"Margaery's right & you know it <truly>.\"");
    expect(out).toBe("<span class=say>&ldquo;Margaery&#39;s right &amp; you know it &lt;truly&gt;.&rdquo;</span>");
  });

  test("a quote inside a regex script's markup attribute is left alone", () => {
    expect(styleInline('<div class="box">plain</div>')).toBe('<div class="box">plain</div>');
  });
});
