/**
 * Whispers & Rumours, in code: found, told, garbled, refused, faded — and the
 * truth under it never touched.
 *
 *   bun test src/whispers.test.ts
 */

import { describe, expect, test } from "bun:test";

import { gossipDay, told, type GossipInput, type Knowing } from "./whispers";

/** Dice that come up in the order given, then stay on the last. */
const dice = (...rolls: number[]) => { let i = 0; return () => rolls[Math.min(i++, rolls.length - 1)]; };
const base: GossipInput = {
  level: "court", distortion: 15, misinformation: false, decayDays: 10, day: 5, knowings: [], traces: [],
  people: ["Cersei Lannister", "Tyrion Lannister", "Olenna Tyrell", "Yvenna Hightower"], player: "Yvenna Hightower", rng: dice(0),
};
const SEEN: Knowing = { holder: "a kitchen maid", version: "a woman in a hooded cloak left the study late", of: "h1", source: "saw", from: "",
  distortion: 0, blames: "", spreads: true, day: 4, by: ["Cersei Lannister"] };

describe("a trace, lying there", () => {
  const PIN = { id: "h1", text: "a Lannister cloak-pin under the maester's table", by: ["Cersei Lannister"], day: 4 };

  test("can lie unfound: no one comes across it today", () => {
    expect(gossipDay({ ...base, traces: [PIN], rng: dice(0.99) })).toEqual([]);
  });

  test("found by someone — never by the one who left it, never by the player's character", () => {
    for (let i = 0; i < 40; i++) {
      const r = gossipDay({ ...base, traces: [PIN], rng: dice(0, 0.6, i / 40, 0.9) });
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ source: "found", version: PIN.text, of: "h1", distortion: 0 });
      expect(["Cersei Lannister", "Yvenna Hightower"]).not.toContain(r[0].holder);
    }
  });

  test("once someone has found it, it is not found again", () => {
    expect(gossipDay({ ...base, traces: [PIN], knowings: [{ ...SEEN, spreads: false }], rng: dice(0) })).toEqual([]);
  });
});

describe("told on", () => {
  test("a step further from the truth: from whom, more garbled, the same thing underneath", () => {
    const r = gossipDay({ ...base, knowings: [SEEN], rng: dice(0, 0.5, 0.5, 0.9) });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ source: "told", from: "a kitchen maid", of: "h1", version: SEEN.version });
    expect(r[0].distortion).toBeGreaterThanOrEqual(15);
    expect(r[0].holder).not.toBe("Yvenna Hightower");
  });

  test("those who refuse keep it; those who did it never tell it on — though they can hear it", () => {
    expect(gossipDay({ ...base, knowings: [{ ...SEEN, spreads: false }], rng: dice(0) })).toEqual([]);
    expect(gossipDay({ ...base, knowings: [{ ...SEEN, holder: "Cersei Lannister" }], rng: dice(0) })).toEqual([]);
    // Cersei hearing that someone saw a cloaked woman: she learns someone is asking questions — and will not pass it on.
    const toHer = gossipDay({ ...base, people: ["Cersei Lannister"], knowings: [SEEN], rng: dice(0, 0, 0, 0) });
    expect(toHer[0]).toMatchObject({ holder: "Cersei Lannister", spreads: false });
    expect(told(toHer[0], "self")).toContain("about something they did themselves");
  });

  test("misinformation blames someone wrong — never the one who did it, never the player's character", () => {
    for (let i = 0; i < 30; i++) {
      const r = gossipDay({ ...base, misinformation: true, knowings: [SEEN], rng: dice(0, 0.1, 0.5, 0, i / 30, 0.9) });
      expect(r[0].blames).not.toBe("");
      expect(["Cersei Lannister", "Yvenna Hightower", r[0].holder]).not.toContain(r[0].blames);
    }
    expect(gossipDay({ ...base, misinformation: false, knowings: [SEEN], rng: dice(0, 0.1, 0.5, 0, 0, 0.9) })[0].blames).toBe("");
  });

  test("a rumour fades: past its days it stops going around", () => {
    expect(gossipDay({ ...base, day: 30, knowings: [SEEN], rng: dice(0) })).toEqual([]);
  });

  test("off is off; and no more in a day than the level allows", () => {
    expect(gossipDay({ ...base, level: "off", knowings: [SEEN], rng: dice(0) })).toEqual([]);
    const many = Array.from({ length: 10 }, (_, i) => ({ ...SEEN, of: `h${i}`, holder: `a guard ${i}` }));
    expect(gossipDay({ ...base, level: "natural", knowings: many, rng: dice(0) }).length).toBe(2);
  });

  test("described as someone's version, never as what happened", () => {
    expect(told({ ...SEEN, source: "told", from: "a kitchen maid", distortion: 60, blames: "Olenna Tyrell", holder: "Tyrion Lannister" }, "narrator"))
      .toBe("Tyrion Lannister heard from a kitchen maid: “a woman in a hooded cloak left the study late” — much garbled in the telling, and may be badly wrong, and believes Olenna Tyrell was behind it");
  });
});
