/**
 * A name in the prose, and the person behind it.
 *
 * The narrator writes [[npc: Andres Vega — thirty, works for someone, has the
 * folder]] mid-sentence. At the table the server settles that: Andres gets a
 * card holding the description, and the message keeps [[npc: Andres Vega]] —
 * a name, set apart from the prose, and nothing else.
 *
 * Which left the pill a dead end. It looked like a control, could not be
 * pressed, and stood for a description filed somewhere the reader had no
 * reason to know about. "Is this supposed to expand, or is it intentionally
 * mysterious like this" is how a tester put it.
 *
 * And it drew three different ways depending on where you were. Verbs are
 * resolved in tabletop mode only, so a story-mode chat still has the whole
 * bracket inline — where the old pattern capped the payload at sixty
 * characters, so a short description was drawn *inside* the pill and a long
 * one was not drawn as a pill at all. Andres fitted. Theo did not.
 *
 * Now the split happens in the renderer, so all three roads end at the same
 * place: the name in the pill, the rest of them behind it.
 *
 * The renderer lives in public/app.js, a browser script rather than a module,
 * so it is lifted out and run here — the same trick dicerender.test.ts uses,
 * and worth the awkwardness for the same reason.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveVerbs } from "./verbs";

const APP = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");
const VERBS = readFileSync(join(import.meta.dir, "verbs.ts"), "utf8");

/** Pulls one top-level `function name(...) { ... }` out of a browser script. */
function lift(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name}() is not in app.js any more`);
  const end = source.indexOf("\n}\n", start);
  if (end === -1) throw new Error(`could not find the end of ${name}()`);
  return source.slice(start, end + 3);
}

/** And one top-level `const NAME = ...;` — lifted rather than retyped, so the
    test cannot quietly disagree with the thing it is testing. */
function liftConst(source: string, name: string): string {
  const m = source.match(new RegExp(`^const ${name} = .*;$`, "m"));
  if (!m) throw new Error(`${name} is not in app.js any more`);
  return m[0];
}

const render = new Function(
  `${liftConst(APP, "NPC_SPLIT")}
   ${liftConst(APP, "quot")}
   ${lift(APP, "verbs")}
   return verbs;`,
)() as (html: string) => string;

/** What the pill ended up saying about somebody. */
function pill(html: string) {
  const m = html.match(/<span class="metnpc"[^>]*>([^<]*)<\/span>/);
  if (!m) return null;
  const attr = (name: string) =>
    m[0].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
  return { text: m[1], name: attr("data-name"), brief: attr("data-brief") };
}

describe("the settled form, which is what the table writes", () => {
  test("a bare name becomes a pill", () => {
    expect(pill(render("[[npc: Andres Vega]]"))).toEqual({
      text: "Andres Vega",
      name: "Andres Vega",
      brief: null,
    });
  });

  test("and the pill is something you can press", () => {
    const html = render("[[npc: Andres Vega]]");
    expect(html).toContain(`role="button"`);
    expect(html).toContain(`tabindex="0"`);
  });
});

describe("the unsettled form, which is every story-mode chat", () => {
  const ANDRES = "[[npc: Andres Vega — thirty, works for someone, has the folder]]";
  const THEO =
    "[[npc: Theo Marsh — tall, nice jaw, the jacket — he's the one who spotted her first]]";

  test("the name is the pill and the description is behind it", () => {
    expect(pill(render(ANDRES))).toEqual({
      text: "Andres Vega",
      name: "Andres Vega",
      brief: "thirty, works for someone, has the folder",
    });
  });

  test("a long one is a pill too", () => {
    // Eighty-odd characters of payload. Under the old sixty-character cap this
    // matched nothing and was left to strayMarks, so the same narrator writing
    // the same kind of sentence about two people got two different results in
    // one message — which is what got photographed and sent in.
    expect(THEO?.length).toBeGreaterThan(60);
    expect(pill(render(THEO))?.name).toBe("Theo Marsh");
  });

  test("the description never leaks into the prose", () => {
    // The whole point of the pill: the message reads as a sentence, not as a
    // stage direction with a dossier stapled to it.
    const html = render(`He looks up. ${ANDRES}`);
    expect(html).not.toContain("works for someone</span>");
    expect(html.replace(/<[^>]*>/g, "")).toBe("He looks up. Andres Vega");
  });
});

describe("both roads reach the same pill", () => {
  test("settling first changes nothing about how it draws", () => {
    const raw = "[[npc: Theo Marsh — tall, nice jaw, the jacket]]";
    const { text: settled } = resolveVerbs(raw);
    expect(settled).toBe("[[npc: Theo Marsh]]");
    // Same name, same pill, whichever mode the message was written in. Only
    // the description differs, and only because the table moved it to a card.
    expect(pill(render(settled))?.name).toBe(pill(render(raw))?.name);
  });
});

describe("what is not a name is left alone", () => {
  const NOT_A_NAME = "[[npc: a group of bandits comes out of the treeline]]";

  test("the server refuses it", () => {
    expect(resolveVerbs(NOT_A_NAME).intents).toHaveLength(0);
  });

  test("and so does the pill, or the two disagree about who exists", () => {
    expect(pill(render(NOT_A_NAME))).toBeNull();
    expect(render(NOT_A_NAME)).toContain(NOT_A_NAME);
  });
});

describe("the description goes into an attribute, so it has to survive one", () => {
  test("a quote does not break out of it", () => {
    // verbs() runs over already-escaped text, and esc() escapes & < > and
    // leaves the quote alone — correct between tags, wrong inside one.
    const html = render(`[[npc: Marla — she said "no"]]`);
    expect(html).toContain(`data-brief="she said &quot;no&quot;"`);
    expect(pill(html)?.name).toBe("Marla");
  });
});

describe("the two halves agree on where a name ends", () => {
  test("the browser splits names the way the server does", () => {
    // If these drift, the card says "Andres Vega" and the pill says something
    // else, and pressing the pill finds nobody.
    const client = liftConst(APP, "NPC_SPLIT").match(/= (\/.*\/)[a-z]*;/)?.[1];
    const server = VERBS.match(/^const SPLIT = (\/.*\/)[a-z]*;$/m)?.[1];
    expect(client).toBeTruthy();
    expect(server).toBeTruthy();
    expect(client).toBe(server);
  });

  test("and on how long a name is allowed to be", () => {
    const pillSource = APP.slice(APP.indexOf("\\[\\[npc:"), APP.indexOf("\\[\\[npc:") + 900);
    expect(pillSource).toContain("48");
    expect(pillSource).toContain("5");
    expect(VERBS).toContain("const MAX_NAME_WORDS = 5");
    expect(VERBS).toContain("const MAX_NAME = 48");
  });
});
