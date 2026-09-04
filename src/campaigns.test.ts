/**
 * What the game is going to be about.
 *
 *   bun test src/campaigns.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  CAMPAIGNS,
  LENGTHS,
  LENGTH_BRIEF,
  campaignById,
  campaignForPrompt,
  dreamCampaign,
  emptyCampaign,
  normaliseCampaign,
  openingBrief,
} from "./campaigns";

describe("the three on offer", () => {
  test("each is complete enough to actually run", () => {
    for (const c of CAMPAIGNS) {
      expect(c.title).toBeTruthy();
      expect(c.premise.length).toBeGreaterThan(80);
      expect(c.theme).toBeTruthy();
      expect(c.opening).toBeTruthy();
      expect(LENGTHS).toContain(c.length);
    }
  });

  test("they differ in shape, not just in scenery", () => {
    // Three fantasy villages with different names is one choice pretending to
    // be three. Different lengths is the cheapest proof they are not that.
    expect(new Set(CAMPAIGNS.map((c) => c.length)).size).toBe(CAMPAIGNS.length);
  });

  test("ids are unique and findable", () => {
    expect(new Set(CAMPAIGNS.map((c) => c.id)).size).toBe(CAMPAIGNS.length);
    for (const c of CAMPAIGNS) expect(campaignById(c.id)).toBe(c);
    expect(campaignById("nope")).toBeNull();
  });
});

describe("reading one back", () => {
  test("a prefab survives a round trip", () => {
    const c = CAMPAIGNS[0];
    expect(normaliseCampaign(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });

  test("a half-filled storybook is still a campaign", () => {
    const c = normaliseCampaign({ title: "Something with a sword in it" })!;
    expect(c.title).toBe("Something with a sword in it");
    expect(c.length).toBe("short");
    expect(c.bestiary).toEqual([]);
  });

  test("an empty one is nothing, which is how declining is stored", () => {
    expect(normaliseCampaign(emptyCampaign())).toBeNull();
    expect(normaliseCampaign(null)).toBeNull();
    expect(normaliseCampaign("a campaign")).toBeNull();
  });

  test("a nonsense length falls back rather than reaching the prompt", () => {
    expect(normaliseCampaign({ title: "x", length: "forever" })!.length).toBe("short");
  });

  test("the lists are bounded and the blanks dropped", () => {
    const c = normaliseCampaign({
      title: "x",
      bestiary: ["Wolf", "  ", "", "Bear", ...Array(30).fill("Goblin")],
    })!;
    expect(c.bestiary.length).toBeLessThanOrEqual(12);
    expect(c.bestiary.slice(0, 2)).toEqual(["Wolf", "Bear"]);
  });

  test("a very long premise is cut rather than sent", () => {
    const c = normaliseCampaign({ title: "x", premise: "a".repeat(5000) })!;
    expect(c.premise.length).toBeLessThanOrEqual(1200);
  });
});

describe("what the narrator is told", () => {
  test("the situation, the tone and the pacing", () => {
    const text = campaignForPrompt(CAMPAIGNS[1]);
    expect(text).toContain(CAMPAIGNS[1].title);
    expect(text).toContain("Tone:");
    expect(text).toContain(LENGTH_BRIEF[CAMPAIGNS[1].length]);
  });

  test("the bestiary arrives as permission, not as a schedule", () => {
    const text = campaignForPrompt(CAMPAIGNS[0]);
    expect(text).toContain(CAMPAIGNS[0].bestiary[0]);
    expect(text).toMatch(/not a schedule/i);
  });

  test("nothing is invented for a campaign that said little", () => {
    const text = campaignForPrompt(normaliseCampaign({ title: "Just vibes" })!);
    expect(text).toContain("Just vibes");
    expect(text).not.toContain("Tone:");
    expect(text).not.toContain("may be out there");
  });

  test("the opening is kept out of it, being a first-turn instruction", () => {
    // In the prompt every turn, it would be telling the narrator to introduce
    // a town it introduced twenty minutes ago.
    expect(campaignForPrompt(CAMPAIGNS[0])).not.toContain(CAMPAIGNS[0].opening);
    expect(openingBrief(CAMPAIGNS[0])).toContain(CAMPAIGNS[0].opening);
  });

  test("and a campaign with no opening still gets one", () => {
    expect(openingBrief(normaliseCampaign({ title: "x" })!)).toMatch(/somewhere specific/i);
  });

  test("stays a reasonable size — it goes into every prompt of the game", () => {
    for (const c of CAMPAIGNS) expect(campaignForPrompt(c).length).toBeLessThan(1400);
  });
});

describe("dreaming one up", () => {
  test("comes back complete — the point is not having to write it", () => {
    for (let i = 0; i < 60; i++) {
      const c = dreamCampaign();
      expect(c.title).toBeTruthy();
      expect(c.premise.length).toBeGreaterThan(100);
      expect(c.theme).toBeTruthy();
      expect(c.opening).toBeTruthy();
      expect(c.bestiary.length).toBe(2);
      expect(LENGTHS).toContain(c.length);
      // And it is a campaign by the same rules as any other.
      expect(normaliseCampaign(c)).toEqual(c);
    }
  });

  test("it is bespoke, not one of the three wearing a hat", () => {
    const titles = new Set(CAMPAIGNS.map((c) => c.title));
    for (let i = 0; i < 40; i++) {
      const c = dreamCampaign();
      expect(c.id).toBe("");
      expect(titles.has(c.title)).toBe(false);
    }
  });

  test("pressing it again gives you another one", () => {
    // Not a guarantee of uniqueness — it is random — but twenty presses
    // producing one premise would mean the pieces are not being combined.
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(JSON.stringify(dreamCampaign()));
    expect(seen.size).toBeGreaterThan(10);
  });

  test("seeded, so a fixed die gives a fixed campaign", () => {
    const fixed = () => 0.42;
    expect(dreamCampaign(fixed)).toEqual(dreamCampaign(fixed));
  });

  test("the extremes of the die are still a campaign", () => {
    for (const rng of [() => 0, () => 0.999999]) {
      const c = dreamCampaign(rng);
      expect(c.title).toBeTruthy();
      expect(c.bestiary.length).toBe(2);
    }
  });

  test("what it writes fits the prompt like anything else", () => {
    for (let i = 0; i < 20; i++) {
      expect(campaignForPrompt(dreamCampaign()).length).toBeLessThan(1400);
    }
  });
});
