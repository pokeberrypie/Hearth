/**
 * Pulling a description apart into fields, and putting it back.
 *
 * The guided editor is optional scaffolding over the same box people already
 * type into, and the box is still what gets saved. That makes exactly one
 * property load-bearing: nothing may be lost by opening the guided view and
 * closing it again. A description that quietly drops a paragraph is far worse
 * than no scaffolding at all — it would eat work somebody did months ago, on a
 * character they only opened to fix a typo.
 *
 * So this tests the round trip, and tests it against the shapes that actually
 * turn up: a card imported as one block of prose with no headings at all, a
 * hand-written sheet that uses every heading, and the mixture of the two that
 * happens when somebody adds a heading to a card they downloaded.
 *
 * The parser lives in a browser script, so it is lifted out and run here.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Section = { key: string; hint: string };

const SRC = readFileSync(join(import.meta.dir, "..", "public", "guided.js"), "utf8");

const G = (() => {
  const win: Record<string, any> = {};
  /*
   * A document that is still loading, so the file registers its wiring against
   * DOMContentLoaded and stops there. What is under test is the parsing, and
   * standing up a whole DOM to reach it would be testing the wrong thing.
   */
  const doc = { readyState: "loading", addEventListener: () => {} };
  const nofetch = () => Promise.reject(new Error("no network in a unit test"));
  new Function("window", "document", "localStorage", "fetch", SRC)(win, doc, undefined, nofetch);
  return win.HearthGuided as {
    parse: (t: string, s: Section[]) => { lead: string; fields: Record<string, string> };
    compose: (lead: string, f: Record<string, string>, s: Section[]) => string;
    unknownHeadings: (t: string, s: Section[]) => string[];
    PERSONA: Section[];
    CHARACTER: Section[];
  };
})();

const round = (text: string, sections: Section[]) => {
  const { lead, fields } = G.parse(text, sections);
  return G.compose(lead, fields, sections);
};

describe("a description with no headings at all", () => {
  const card = "A letter carrier who reads the letters. She has been doing it for\n" +
    "eleven years and has never once been caught.";

  test("is kept exactly, because that is somebody's imported card", () => {
    const { lead, fields } = G.parse(card, G.CHARACTER);
    expect(lead).toBe(card);
    expect(Object.keys(fields)).toEqual([]);
  });

  test("and survives the round trip unchanged", () => {
    expect(round(card, G.CHARACTER)).toBe(card);
  });
});

describe("a description written in headings", () => {
  const sheet = [
    "Gender: female",
    "",
    "Appearance:",
    "5'7\", dark hair to the waist, aquamarine eyes.",
    "Pale, and dressed better than the room.",
    "",
    "Speech: fast, arch, and mocking",
    "",
    "Quirks and mannerisms:",
    "Rests a hand on the doorframe before speaking.",
  ].join("\n");

  test("comes apart into the fields it was written in", () => {
    const { lead, fields } = G.parse(sheet, G.CHARACTER);
    expect(lead).toBe("");
    expect(fields.Gender).toBe("female");
    expect(fields.Appearance).toContain("aquamarine eyes");
    expect(fields.Appearance).toContain("dressed better than the room");
    // "Speech:" is recognised and filed under the heading this form uses.
    expect(fields["Speech pattern"]).toBe("fast, arch, and mocking");
    expect(fields["Quirks and mannerisms"]).toBe("Rests a hand on the doorframe before speaking.");
  });

  test("and goes back together with everything still in it", () => {
    const out = round(sheet, G.CHARACTER);
    for (const bit of ["female", "aquamarine eyes", "dressed better than the room",
                       "fast, arch, and mocking", "doorframe"]) {
      expect(out).toContain(bit);
    }
  });

  test("a one-line answer stays on its heading; a longer one goes underneath", () => {
    const out = round(sheet, G.CHARACTER);
    expect(out).toContain("Gender: female");
    expect(out).toContain("Appearance:\n5'7\"");
  });

  test("opening and closing it repeatedly changes nothing further", () => {
    const once = round(sheet, G.CHARACTER);
    expect(round(once, G.CHARACTER)).toBe(once);
    expect(round(round(once, G.CHARACTER), G.CHARACTER)).toBe(once);
  });
});

describe("headings under the names people actually use", () => {
  /*
   * Both of these are lifted from the shape of real sheets. Recognising only
   * this form's exact wording would leave them unsplit in the block at the
   * top — which is the very failure the fields exist to prevent.
   */
  test("a character sheet written with someone else's labels", () => {
    const sheet = [
      "Physical Appearance: 6'2\", golden hair",
      "Speech Pattern: fast, arch, mocking",
      "Quirks & Mannerisms: rests a hand on the sword hilt",
      "Key Relationships: his sister, and nobody else",
      "Additional Info: made a knight at fifteen",
    ].join("\n");
    const { lead, fields } = G.parse(sheet, G.CHARACTER);
    expect(lead).toBe("");
    expect(fields.Appearance).toContain("golden hair");
    expect(fields["Speech pattern"]).toContain("mocking");
    expect(fields["Quirks and mannerisms"]).toContain("sword hilt");
    expect(fields["Important relationships"]).toContain("his sister");
    expect(fields["Anything else"]).toContain("fifteen");
  });

  test("and a persona written the same way", () => {
    const sheet = "Physical Appearance: 5'7\", dark hair\nInterests/Style: philosophy, singing";
    const { lead, fields } = G.parse(sheet, G.PERSONA);
    expect(lead).toBe("");
    expect(fields.Appearance).toContain("dark hair");
    expect(fields.Interests).toContain("philosophy");
  });

  test("an alias is written back under the heading this form uses", () => {
    const out = round("Speech: clipped", G.CHARACTER);
    expect(out).toBe("Speech pattern: clipped");
  });
});

describe("headings it has no box for", () => {
  test("are offered, so a sheet can teach the form its own words", () => {
    const found = G.unknownHeadings("Ego: total\nHouse affiliations: Lannister", G.CHARACTER);
    expect(found).toContain("House affiliations");
    expect(found).not.toContain("Ego");        // that one has a box already
  });

  /*
   * The one that was actually broken. An unknown heading after a known one is
   * not left over — it is swallowed into whichever field it followed, and was
   * therefore never offered. A real sheet lost its last two headings that way,
   * silently, into the field above them.
   */
  test("including ones that come after a heading it does know", () => {
    const text = "Scent: lilac\nFavourite weather: fog";
    expect(G.unknownHeadings(text, G.PERSONA)).toContain("Favourite weather");
  });

  test("an alias is not offered as though it were new", () => {
    expect(G.unknownHeadings("Physical appearance: tall", G.CHARACTER)).toEqual([]);
  });

  test("and the same one twice is offered once", () => {
    const found = G.unknownHeadings("Mood: bleak\nMood: worse", G.PERSONA);
    expect(found.filter((f) => f.toLowerCase() === "mood")).toHaveLength(1);
  });
});

describe("headings wearing markdown, which is how cards are actually traded", () => {
  /*
   * Found on a real card, on the phone: every heading was bolded, so none of
   * them matched and the whole sheet landed in the block at the top. Cards are
   * traded as markdown far more often than as plain text, so this is the
   * common case rather than an edge one.
   */
  test("bold headings with the value outside the emphasis", () => {
    const card = [
      "**Name: Abel Williamson**",
      "**Age:** 27",
      "**Appearance:** 6'3\", lean build with callused hands",
      "**Likes:** carpentry, quiet mornings",
    ].join("\n");
    const { fields } = G.parse(card, G.CHARACTER);
    expect(fields.Name).toBe("Abel Williamson");
    expect(fields.Appearance).toContain("callused hands");
    expect(fields.Likes).toBe("carpentry, quiet mornings");
  });

  test("single stars, underscores, bullets and markdown headings", () => {
    const card = [
      "*Gender:* male",
      "__Background:__ a carpenter",
      "- **Dislikes:** crowds",
      "### Ego",
      "quietly certain",
    ].join("\n");
    const { fields } = G.parse(card, G.CHARACTER);
    expect(fields.Gender).toBe("male");
    expect(fields.Background).toBe("a carpenter");
    expect(fields.Dislikes).toBe("crowds");
    expect(fields.Ego).toBe("quietly certain");
  });

  test("a bolded heading it has no box for is still offered", () => {
    expect(G.unknownHeadings("**House affiliations:** Lannister", G.CHARACTER))
      .toContain("House affiliations");
  });

  test("the markers are dropped, not carried into the field", () => {
    const { fields } = G.parse("**Appearance:** tall", G.CHARACTER);
    expect(fields.Appearance).not.toContain("*");
  });

  test("bold body text is not mistaken for a heading", () => {
    // "**She said:**" would be a heading by shape; it is not a known one, so
    // it stays put rather than swallowing the paragraph after it.
    const text = "He is **very** tired.\nShe said: nothing at all.";
    const { lead, fields } = G.parse(text, G.CHARACTER);
    expect(lead).toBe(text);
    expect(Object.keys(fields)).toEqual([]);
  });
});

describe("the mixture, which is what actually happens", () => {
  const mixed = [
    "An old card someone downloaded, written as a paragraph.",
    "",
    "Appearance: tall, greying, tired",
  ].join("\n");

  test("keeps the loose prose first and the heading as a field", () => {
    const { lead, fields } = G.parse(mixed, G.CHARACTER);
    expect(lead).toBe("An old card someone downloaded, written as a paragraph.");
    expect(fields.Appearance).toBe("tall, greying, tired");
    expect(round(mixed, G.CHARACTER)).toContain("downloaded");
  });
});

describe("what it refuses to treat as a heading", () => {
  test("a line of dialogue with a colon in it", () => {
    // The failure this prevents: "Marla:" becoming a section and swallowing
    // the entire rest of the description into a field nobody can see.
    const text = 'She said: "you are late again."\nAnd she was right.';
    const { lead, fields } = G.parse(text, G.CHARACTER);
    expect(lead).toBe(text);
    expect(Object.keys(fields)).toEqual([]);
  });

  test("a heading this form does not have", () => {
    const text = "Ego:\nTotal, unexamined, and entirely earned.";
    const { lead } = G.parse(text, G.PERSONA);
    expect(lead).toBe(text);
  });

  test("but it does not care about case or stray spacing", () => {
    const { fields } = G.parse("  appearance :  tall  ", G.CHARACTER);
    expect(fields.Appearance).toBe("tall");
  });
});

describe("edges", () => {
  test("empty in, empty out", () => {
    expect(round("", G.PERSONA)).toBe("");
    expect(round("   \n  ", G.PERSONA)).toBe("");
  });

  test("an empty field is left out rather than written as a bare heading", () => {
    const out = G.compose("", { Gender: "", Appearance: "tall" }, G.CHARACTER);
    expect(out).toBe("Appearance: tall");
    expect(out).not.toContain("Gender");
  });

  test("the same heading twice keeps both halves", () => {
    const { fields } = G.parse("Likes: wine\nDislikes: mornings\nLikes: winning", G.CHARACTER);
    expect(fields.Likes).toContain("wine");
    expect(fields.Likes).toContain("winning");
  });
});

describe("the two field sets", () => {
  test("a persona is asked less than a character, on purpose", () => {
    expect(G.PERSONA.length).toBeLessThan(G.CHARACTER.length);
  });

  test("the scene is not asked for twice", () => {
    // The opening scene has a box of its own and only one sensible home.
    // Name and Personality do appear here, aimed slightly to the side of their
    // own boxes — titles rather than the plain name — and their hints say so,
    // because a sheet written elsewhere carries both under these headings.
    const keys = G.CHARACTER.map((s) => s.key.toLowerCase());
    expect(keys).not.toContain("scenario");
    expect(keys).not.toContain("scene");
    expect(keys).not.toContain("opening message");
  });

  test("the two that shadow a box of their own say so in the hint", () => {
    for (const key of ["Name", "Personality"]) {
      const s = G.CHARACTER.find((x) => x.key === key)!;
      expect(s.hint.toLowerCase()).toContain("box");
    }
  });

  test("every field says what goes in it", () => {
    for (const s of [...G.PERSONA, ...G.CHARACTER]) {
      expect(s.hint.length).toBeGreaterThan(20);
    }
  });
});
