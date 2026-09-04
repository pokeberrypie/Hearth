/**
 * Regex scripts.
 *
 * The cases that matter are the ones a real preset relies on: the display half
 * that folds a `<status>` block into something readable, and the prompt half
 * that strips those same blocks out of older turns so a long scene stops
 * resending every one it has ever produced.
 *
 *   bun test
 */

import { describe, expect, test } from "bun:test";

import { applies, applyScripts, compile, normaliseScript, PLACEMENT, runScript } from "./regex";

/** Shaped exactly as SillyTavern exports one. */
const ST = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  scriptName: "Test",
  findRegex: "/foo/g",
  replaceString: "bar",
  trimStrings: [],
  placement: [2],
  disabled: false,
  markdownOnly: false,
  promptOnly: false,
  runOnEdit: true,
  substituteRegex: 0,
  minDepth: null,
  maxDepth: null,
  ...over,
});

describe("compile", () => {
  test("parses /pattern/flags", () => {
    const re = compile("/a(b)c/gi");
    expect(re?.source).toBe("a(b)c");
    expect(re?.flags).toBe("gi");
  });

  test("accepts a bare pattern", () => {
    expect(compile("abc")?.source).toBe("abc");
  });

  test("a pattern containing slashes survives", () => {
    expect(compile("/<\\/status>/g")?.source).toBe("<\\/status>");
  });

  test("returns null rather than throwing on nonsense", () => {
    expect(compile("/(unclosed/g")).toBeNull();
    expect(compile("")).toBeNull();
  });
});

describe("normaliseScript", () => {
  test("reads SillyTavern's field names and inverts `disabled`", () => {
    const s = normaliseScript(ST({ scriptName: "Strip", disabled: true }));
    expect(s.name).toBe("Strip");
    expect(s.enabled).toBe(false);
  });

  test("markdownOnly means display, promptOnly means prompt", () => {
    const md = normaliseScript(ST({ markdownOnly: true, promptOnly: false }));
    expect([md.display, md.prompt]).toEqual([true, false]);
    const po = normaliseScript(ST({ markdownOnly: false, promptOnly: true }));
    expect([po.display, po.prompt]).toEqual([false, true]);
    const both = normaliseScript(ST({ markdownOnly: true, promptOnly: true }));
    expect([both.display, both.prompt]).toEqual([true, true]);
  });

  test("neither flag is treated as both, never as a rewrite of the transcript", () => {
    const s = normaliseScript(ST({ markdownOnly: false, promptOnly: false }));
    expect([s.display, s.prompt]).toEqual([true, true]);
  });

  test("depths come across, including a missing one", () => {
    const s = normaliseScript(ST({ minDepth: 6, maxDepth: null }));
    expect(s.minDepth).toBe(6);
    expect(s.maxDepth).toBeNull();
  });

  test("a script with no placement defaults to the model's replies", () => {
    const s = normaliseScript(ST({ placement: [] }));
    expect(s.placement).toEqual([PLACEMENT.aiOutput]);
  });

  test("one of ours round-trips", () => {
    const once = normaliseScript(ST({ minDepth: 2, markdownOnly: true }));
    const twice = normaliseScript(once);
    expect(twice).toEqual(once);
  });
});

describe("applies", () => {
  const s = normaliseScript(ST({ minDepth: 6, promptOnly: true }));

  test("respects the depth floor", () => {
    expect(applies(s, "prompt", 2, 5)).toBe(false);
    expect(applies(s, "prompt", 2, 6)).toBe(true);
    expect(applies(s, "prompt", 2, 40)).toBe(true);
  });

  test("respects the depth ceiling", () => {
    const capped = normaliseScript(ST({ maxDepth: 2, promptOnly: true }));
    expect(applies(capped, "prompt", 2, 2)).toBe(true);
    expect(applies(capped, "prompt", 2, 3)).toBe(false);
  });

  test("a prompt-only script never touches the display", () => {
    expect(applies(s, "display", 2, 10)).toBe(false);
  });

  test("placement is honoured", () => {
    expect(applies(s, "prompt", PLACEMENT.userInput, 10)).toBe(false);
  });

  test("a disabled script does nothing anywhere", () => {
    const off = normaliseScript(ST({ disabled: true, promptOnly: true }));
    expect(applies(off, "prompt", 2, 10)).toBe(false);
  });
});

describe("runScript", () => {
  test("substitutes capture groups", () => {
    const s = normaliseScript(ST({ findRegex: "/(\\w+) (\\w+)/", replaceString: "$2 $1" }));
    expect(runScript("hello world", s)).toBe("world hello");
  });

  test("{{match}} is the whole match", () => {
    const s = normaliseScript(ST({ findRegex: "/\\d+/g", replaceString: "[{{match}}]" }));
    expect(runScript("a 12 b 3", s)).toBe("a [12] b [3]");
  });

  test("trimStrings come out of the match first", () => {
    const s = normaliseScript(ST({
      findRegex: "/<t>([\\s\\S]*?)<\\/t>/g", replaceString: "$1", trimStrings: ["**"],
    }));
    expect(runScript("<t>**bold**</t>", s)).toBe("bold");
  });

  test("a broken pattern leaves the text alone", () => {
    const s = normaliseScript(ST({ findRegex: "/(unclosed/g" }));
    expect(runScript("untouched", s)).toBe("untouched");
  });

  test("strips a block, the way a context cleanup does", () => {
    const s = normaliseScript(ST({
      findRegex: "/<status\\b[^>]*>[\\s\\S]*?<\\/status>\\s*/gi", replaceString: "",
    }));
    expect(runScript("before <status>a lot of state</status> after", s)).toBe("before after");
  });
});

describe("applyScripts", () => {
  const scripts = [
    normaliseScript(ST({ id: "a", findRegex: "/<status\\b[^>]*>[\\s\\S]*?<\\/status>\\s*/gi",
                        replaceString: "", promptOnly: true, minDepth: 6 })),
    normaliseScript(ST({ id: "b", findRegex: "/---/g", replaceString: "",
                        markdownOnly: true, promptOnly: true })),
  ];

  test("an old turn is stripped for the prompt", () => {
    const out = applyScripts("keep <status>bulk</status> this", scripts, "prompt", 2, 9);
    expect(out).toBe("keep this");
  });

  test("a recent turn keeps its block", () => {
    const out = applyScripts("keep <status>bulk</status> this", scripts, "prompt", 2, 1);
    expect(out).toContain("<status>");
  });

  test("the display never loses a block a prompt-only script strips", () => {
    const out = applyScripts("keep <status>bulk</status> this", scripts, "display", 2, 9);
    expect(out).toContain("<status>");
  });

  test("scripts run in order, both halves applying", () => {
    expect(applyScripts("a --- b", scripts, "display", 2, 0)).toBe("a  b");
    expect(applyScripts("a --- b", scripts, "prompt", 2, 0)).toBe("a  b");
  });

  test("an empty script list is a no-op", () => {
    expect(applyScripts("unchanged", [], "prompt", 2, 0)).toBe("unchanged");
  });
});
