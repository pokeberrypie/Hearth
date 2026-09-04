/**
 * The verbs a narrator uses to change the world.
 *
 *   bun test src/verbs.test.ts
 */

import { describe, expect, test } from "bun:test";

import { VERB_BRIEF, resolveVerbs } from "./verbs";

const one = (text: string) => resolveVerbs(text).intents[0] as any;

describe("introducing someone", () => {
  test("a name and who they are", () => {
    const npc = one("[[npc: Marla — innkeeper, tired, lying about the mill]]");
    expect(npc.kind).toBe("npc");
    expect(npc.name).toBe("Marla");
    expect(npc.brief).toBe("innkeeper, tired, lying about the mill");
  });

  test("every separator a model reaches for", () => {
    for (const text of [
      "[[npc: Marla — the innkeeper]]",
      "[[npc: Marla – the innkeeper]]",
      "[[npc: Marla - the innkeeper]]",
      "[[npc: Marla, the innkeeper]]",
      "[[npc: Marla: the innkeeper]]",
      "[[npc: Marla (the innkeeper)]]",
    ]) {
      const npc = one(text);
      expect(npc.name).toBe("Marla");
      expect(npc.brief).toContain("innkeeper");
    }
  });

  test("every word a model uses instead of npc", () => {
    for (const word of ["npc", "NPC", "character", "introduce", "enter"]) {
      expect(one(`[[${word}: Marla — innkeeper]]`).name).toBe("Marla");
    }
  });

  test("a name on its own is still a person", () => {
    const npc = one("[[npc: Marla]]");
    expect(npc.name).toBe("Marla");
    expect(npc.brief).toBe("");
  });

  test("decoration is not part of the name", () => {
    expect(one('[[npc: **Marla** — innkeeper]]').name).toBe("Marla");
    expect(one('[[npc: "Marla" the innkeeper]]').name).toBe("Marla the innkeeper");
  });

  test("a long name is allowed; a sentence is not a name", () => {
    expect(one("[[npc: Sir Gawain of Ashfell — a knight]]").name).toBe("Sir Gawain of Ashfell");
    // No separator and no name in sight: the model described a moment.
    const text = "[[npc: a group of bandits comes out of the treeline at dusk]]";
    expect(resolveVerbs(text).intents).toHaveLength(0);
    expect(resolveVerbs(text).text).toBe(text);
  });

  test("the settled form keeps the name and sheds the rest", () => {
    expect(resolveVerbs("[[npc: Marla — innkeeper, tired]]").text).toBe("[[npc: Marla]]");
  });

  test("naming her again does not change what is written", () => {
    const once = resolveVerbs("[[npc: Marla — innkeeper]]").text;
    expect(resolveVerbs(once).text).toBe(once);
  });
});

describe("moving the scene", () => {
  test("a place, kept whole", () => {
    const scene = one("[[scene: the mill, at night, in the rain]]");
    expect(scene.kind).toBe("scene");
    expect(scene.where).toBe("the mill, at night, in the rain");
  });

  test("every word a model uses instead of scene", () => {
    for (const word of ["scene", "location", "place", "setting"]) {
      expect(one(`[[${word}: the old mill]]`).where).toBe("the old mill");
    }
  });

  test("a trailing full stop is punctuation, not a place", () => {
    expect(one("[[scene: the old mill.]]").where).toBe("the old mill");
  });

  test("nothing is not somewhere", () => {
    expect(resolveVerbs("[[scene:   ]]").intents).toHaveLength(0);
  });
});

describe("in among the prose, which is where they actually arrive", () => {
  test("several verbs in one reply, in the order written", () => {
    const out = resolveVerbs(
      "You push the door open. [[scene: the taproom of the Blackthorn]]\n\n" +
      "A woman is drying glasses. [[npc: Marla — innkeeper, tired]] " +
      "She does not look up.",
    );
    expect(out.intents.map((i) => i.kind)).toEqual(["scene", "npc"]);
    expect(out.text).toContain("You push the door open.");
    expect(out.text).toContain("[[npc: Marla]]");
    expect(out.text).toContain("She does not look up.");
  });

  test("dice in the same reply are not touched", () => {
    const text = "[[npc: Marla — innkeeper]] She throws a punch. [[1d20+2]]";
    expect(resolveVerbs(text).text).toContain("[[1d20+2]]");
  });

  test("a bracket that is not a verb is left exactly alone", () => {
    for (const text of ["[[check: dex]]", "[[2d6]]", "[[thinking]]", "[[note: remember this]]"]) {
      expect(resolveVerbs(text).text).toBe(text);
      expect(resolveVerbs(text).intents).toHaveLength(0);
    }
  });

  test("a bracket spanning paragraphs is a model that has lost the thread", () => {
    const text = "[[npc: Marla\n\nshe is the innkeeper]]";
    expect(resolveVerbs(text).intents).toHaveLength(0);
  });

  test("nothing at all is not an error", () => {
    expect(resolveVerbs("").text).toBe("");
    expect(resolveVerbs(null as any).intents).toHaveLength(0);
  });
});

describe("the brief", () => {
  test("names both verbs and says the player never types them", () => {
    expect(VERB_BRIEF).toContain("[[npc:");
    expect(VERB_BRIEF).toContain("[[scene:");
    expect(VERB_BRIEF).toMatch(/never types/i);
  });

  test("its own examples are ones this file would actually read", () => {
    // A brief that teaches a shape the parser rejects is worse than no brief.
    const shown = VERB_BRIEF.match(/\[\[[^\]]+\]\]/g) ?? [];
    expect(shown.length).toBeGreaterThan(2);
    for (const example of shown) {
      expect(resolveVerbs(example, () => "settled").intents).toHaveLength(1);
    }
  });
});
