/**
 * Turning a few words into a campaign.
 *
 *   bun test src/campaignwrite.test.ts
 */

import { describe, expect, test } from "bun:test";

import { WRITE_SYSTEM, looksWritten, parseWritten, writePrompt } from "./campaignwrite";
import { normaliseCampaign } from "./campaigns";

const REPLY = `TITLE: The Light That Stayed On
PREMISE: The lighthouse at Fen Head has been dark for nine years and burned every night last week. The keeper's daughter is the only one who will say so out loud, and the harbour has decided she is unwell.
TONE: Slow and salt-damp. Almost no violence — the danger is being disbelieved. Long nights, few people, and the sea doing most of the talking.
OPENING: The player arrives on the last boat of the day and is told, kindly, not to go out to the point.
THINGS: The keeper's daughter, Something keeping the lamp lit, A harbour that has agreed on a story`;

describe("reading what came back", () => {
  test("all five fields", () => {
    const c = parseWritten(REPLY, "short");
    expect(c.title).toBe("The Light That Stayed On");
    expect(c.premise).toContain("Fen Head");
    expect(c.theme).toContain("salt-damp");
    expect(c.opening).toContain("last boat");
    expect(c.bestiary).toEqual([
      "The keeper's daughter",
      "Something keeping the lamp lit",
      "A harbour that has agreed on a story",
    ]);
    expect(c.length).toBe("short");
  });

  test("what it produces is a campaign by the same rules as any other", () => {
    expect(normaliseCampaign(parseWritten(REPLY))).not.toBeNull();
  });

  test("models bold their own labels, and quote their own titles", () => {
    const c = parseWritten(`**TITLE:** "The Long Way Round"\n**PREMISE:** ${"x".repeat(60)}`);
    expect(c.title).toBe("The Long Way Round");
  });

  test("a chatty preamble does not stop it finding the fields", () => {
    const c = parseWritten(`Of course! Here is your brief:\n\n${REPLY}\n\nHope that helps!`);
    expect(c.title).toBe("The Light That Stayed On");
    expect(c.bestiary).toHaveLength(3);
  });

  test("a missing field is empty rather than fatal", () => {
    const c = parseWritten(`TITLE: A Thing\nPREMISE: ${"y".repeat(60)}`);
    expect(c.theme).toBe("");
    expect(c.opening).toBe("");
    expect(c.bestiary).toEqual([]);
    // Four fields out of five is a page you can finish yourself.
    expect(looksWritten(c)).toBe(true);
  });

  test("a list written with 'and', or as bullets, is still a list", () => {
    expect(parseWritten("THINGS: wolves, a bad priest and the weather").bestiary)
      .toEqual(["wolves", "a bad priest", "the weather"]);
    expect(parseWritten("THINGS: - wolves, - a bad priest").bestiary)
      .toEqual(["wolves", "a bad priest"]);
  });

  test("a very long premise is cut here rather than at the database", () => {
    expect(parseWritten(`PREMISE: ${"z".repeat(4000)}`).premise!.length).toBeLessThanOrEqual(1200);
  });

  test("a refusal is not a campaign", () => {
    expect(looksWritten(parseWritten("I'm sorry, I can't help with that."))).toBe(false);
    expect(looksWritten(parseWritten("TITLE: Something"))).toBe(false);
    expect(looksWritten(parseWritten(""))).toBe(false);
  });

  test("a nonsense length falls back rather than reaching the prompt", () => {
    expect(parseWritten(REPLY, "forever" as any).length).toBe("short");
  });
});

describe("what the model is asked", () => {
  test("the brief names every label the parser looks for", () => {
    for (const label of ["TITLE", "PREMISE", "TONE", "OPENING", "THINGS"]) {
      expect(WRITE_SYSTEM).toContain(`${label}:`);
    }
  });

  test("and tells it to build on the idea rather than replace it", () => {
    expect(WRITE_SYSTEM).toMatch(/build on it/i);
    expect(WRITE_SYSTEM).toMatch(/proper noun/i);
  });

  test("the idea and the length both reach it", () => {
    const p = writePrompt("  haunted lighthouse, nobody believes me  ", "one-shot");
    expect(p).toContain("haunted lighthouse");
    expect(p).toContain("one-shot");
  });
});
