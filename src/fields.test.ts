/**
 * Answers in the shapes models actually write when asked for `KEY | this | that`: each read as the line it is,
 * by every reader, rather than dropped as nothing.
 */
import { describe, expect, test } from "bun:test";
import { wipe } from "./test-support";
import { fieldLine } from "./fields";
import { readDecision } from "./offstage";
import { parseAnswer } from "./steward";
wipe();
const { stirGoals } = await import("./index");

const SHAPES = {
  pipes: "ACT | sends a man after Yvenna | hard | grave",
  colon: "ACT: sends a man after Yvenna | hard | grave",
  bold: "**ACT:** sends a man after Yvenna | hard | grave",
  title: "Act: sends a man after Yvenna | hard | grave",
  table: "| ACT | sends a man after Yvenna | hard | grave |",
  dashes: "- ACT — sends a man after Yvenna — hard — grave",
  numbered: "2. ACT: sends a man after Yvenna | hard | grave",
};

describe("the line format, however it was written", () => {
  for (const [shape, line] of Object.entries(SHAPES)) {
    test(`a decision written with ${shape}`, () => {
      const d = readDecision(`CHOOSE | the knife | desperate\n${line}`);
      expect(d.act).toBe("sends a man after Yvenna");
      expect(d.difficulty).toBe("hard");
      expect(d.harm).toBe("grave");
    });
  }

  test("a goal given as GOAL: is a goal", () => {
    const got = stirGoals("GOAL: Locke | take Brienne back to Harrenhal | the bounty\n**GOAL:** Jaime Lannister | keep Brienne alive | he owes her",
      { player: "Yvenna Hightower", dead: new Set(), active: [] });
    expect(got.map((g) => g.who)).toEqual(["Locke", "Jaime Lannister"]);
  });

  test("the Steward reads EVENT: as an event", () => {
    const p = parseAnswer('EVENT: The riot at the gate | Jaime, Yvenna | "the crowd broke through"');
    expect(p.events).toHaveLength(1);
    expect(p.events[0].title).toBe("The riot at the gate");
  });

  test("what was already right is left as it was, and prose is not made into fields", () => {
    expect(fieldLine("ACT | sends a man | hard | grave")).toBe("ACT | sends a man | hard | grave");
    expect(fieldLine("The queen was furious: she wanted blood.")).toBe("The queen was furious: she wanted blood.");
    expect(fieldLine("|---|---|---|")).toBe("");
  });
});
