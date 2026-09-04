/**
 * SillyTavern preset import: marker blocks.
 *
 * The bug these exist for: SillyTavern writes `marker: true` on a block that
 * stands in for something the app assembles, and puts the name of the thing in
 * `identifier`. Hearth read `marker` as the name, got the string "true",
 * matched nothing, and dropped every such block — so importing a real preset
 * silently threw away the character description, the persona, the lorebook and
 * the chat history, and the model was left talking to nobody in particular.
 *
 *   bun test
 */

import { describe, expect, test } from "bun:test";

import { fromSillyTavern, normaliseBlocks } from "./presets";

/** Shaped exactly as SillyTavern exports it. */
const ST_PRESET = {
  temperature: 0.75,
  openai_max_tokens: 10000,
  prompts: [
    { identifier: "main", name: "M", role: "system", content: "", marker: null },
    { identifier: "jailbreak", name: "J", role: "system", content: "Stay in character." },
    { identifier: "charDescription", name: "⟡ Char Description ⟡", role: "system", content: "", marker: true },
    { identifier: "personaDescription", name: "⟡ Persona ⟡", role: "system", content: "", marker: true },
    { identifier: "worldInfoBefore", name: "⟡ World Info ⟡", role: "system", content: "", marker: true },
    { identifier: "chatHistory", name: "⟡ Chat History ⟡", role: null, content: "", marker: true },
    { identifier: "scenario", name: "⟡ Scenario ⟡", role: "system", content: "", marker: true },
    // A divider: marker true, but its identifier names nothing Hearth builds.
    { identifier: "c9e2d1f7-4a6b", name: "PICK: PACING", role: "system", content: "", marker: true },
    { identifier: "written", name: "House rules", role: "system", content: "Be brief." },
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "charDescription", enabled: true },
        { identifier: "personaDescription", enabled: true },
        { identifier: "worldInfoBefore", enabled: true },
        { identifier: "scenario", enabled: true },
        { identifier: "written", enabled: true },
        { identifier: "chatHistory", enabled: true },
        { identifier: "c9e2d1f7-4a6b", enabled: true },
        { identifier: "jailbreak", enabled: false },
      ],
    },
  ],
};

describe("SillyTavern marker blocks", () => {
  test("a marker:true block keeps the marker its identifier names", () => {
    const blocks = normaliseBlocks([
      { identifier: "charDescription", name: "Char", role: "system", content: "", marker: true },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].marker).toBe("charDescription");
  });

  test("a marker:true block whose identifier names nothing is dropped, not kept as text", () => {
    const blocks = normaliseBlocks([
      { identifier: "c9e2d1f7-4a6b", name: "PICK: PACING", role: "system", content: "", marker: true },
    ]);
    expect(blocks).toHaveLength(0);
  });

  test("an explicit string marker still wins over the identifier", () => {
    const blocks = normaliseBlocks([
      { id: "anything", marker: "scenario", content: "" },
    ]);
    expect(blocks[0].marker).toBe("scenario");
  });

  test("importing a real preset keeps the character, persona, lore and history", () => {
    const { data } = fromSillyTavern(ST_PRESET);
    const markers = (data.blocks ?? []).map((b) => b.marker).filter(Boolean);
    for (const m of ["main", "charDescription", "personaDescription", "worldInfoBefore", "scenario", "chatHistory"]) {
      expect(markers).toContain(m);
    }
  });

  test("the transcript keeps the place the preset gave it, not the end", () => {
    const { data } = fromSillyTavern(ST_PRESET);
    const blocks = data.blocks ?? [];
    const seam = blocks.findIndex((b) => b.marker === "chatHistory");
    const written = blocks.findIndex((b) => b.name === "House rules");
    expect(seam).toBeGreaterThan(-1);
    // The preset lists House rules before the history; a chatHistory block that
    // got dropped and re-appended would put the seam last and turn every block
    // after it in the preset into part of the opening brief instead.
    expect(written).toBeLessThan(seam);
    expect(seam).toBeLessThan(blocks.length - 1);
  });

  test("a block the preset switched off keeps its marker so it can stay off", () => {
    const { data } = fromSillyTavern(ST_PRESET);
    const jb = (data.blocks ?? []).find((b) => b.marker === "jailbreak");
    expect(jb?.enabled).toBe(false);
  });

  test("sampling values come across", () => {
    const { data } = fromSillyTavern(ST_PRESET);
    expect(data.temperature).toBe("0.75");
    expect(data.max_tokens).toBe("10000");
  });
});
