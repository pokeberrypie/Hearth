/**
 * The audit: does each of these actually fire, end to end?
 *
 * Presets, lorebooks, auto-lore, fights and dice all have their own unit tests
 * and all of them passed while, at various points in this project, the feature
 * did nothing in practice. The gap is never the logic — it is the wiring
 * between the logic and the prompt that is actually sent, and that is what
 * this file walks: one chat, seeded like a real one, asked what it would send.
 *
 * assemble() is the single place a prompt is built, and both generate and the
 * inspector go through it, so testing it here is testing what is really sent.
 *
 *   bun test src/audit.test.ts
 */

import { beforeEach, describe, expect, test } from "bun:test";

import { db, setSettings, wipe } from "./test-support";

const { assemble, applyVerbs } = await import("./index");
const { resolveChecks, abilityAsked } = await import("./tabletop");
const { resolveRolls } = await import("./dice");
const { startFight, hurt, fightForPrompt } = await import("./fight");

const CHAR = "c1", CHAT = "t1", PERSONA = "p1";

function seed() {
  wipe();
  db.query(`INSERT INTO characters (id, name, description, first_message, created_at)
            VALUES (?,?,?,?,?)`).run(CHAR, "The Gamekeeper", "Runs the table.", "Sit down.", 1);
  db.query("INSERT INTO personas (id, name, description, is_active, created_at) VALUES (?,?,?,?,?)")
    .run(PERSONA, "Taylor", "Tired.", 1, 1);
  db.query(`INSERT INTO chats (id, character_id, title, created_at, updated_at, persona_id)
            VALUES (?,?,?,?,?,?)`).run(CHAT, CHAR, "A game", 1, 1, PERSONA);
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES (?,?,?,?,?,?)")
    .run("m1", CHAT, "assistant", "The Gamekeeper", "The bridge into Greywater is stone.", 10);
  return db.query("SELECT * FROM chats WHERE id = ?").get(CHAT) as any;
}

const everything = (a: any) =>
  [a.system, ...a.messages.map((m: any) => m.content)].join("\n---\n");

let chat: any;
beforeEach(() => { chat = seed(); });

describe("presets", () => {
  test("an active preset's blocks reach the prompt", () => {
    db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES (?,?,?,?,?)")
      .run("pr1", "Mine", JSON.stringify({
        blocks: [{ id: "b1", name: "House style", role: "system",
                   content: "Write in short paragraphs.", enabled: true }],
        temperature: "0.4",
      }), 1, 1);
    const a = assemble(chat, "reply", "");
    expect(everything(a)).toContain("Write in short paragraphs.");
  });

  test("and its sampling is what would actually be sent", () => {
    db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES (?,?,?,?,?)")
      .run("pr1", "Mine", JSON.stringify({ blocks: [], temperature: "0.4" }), 1, 1);
    setSettings({ temperature: "1.9" });
    // The bug this guards: a Sampling panel showing stored settings while the
    // preset quietly overrode them, so the number on screen was never sent.
    expect(Number(assemble(chat, "reply", "").sampling.temperature)).toBeCloseTo(0.4, 5);
  });

  test("a disabled block is not sent", () => {
    db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES (?,?,?,?,?)")
      .run("pr1", "Mine", JSON.stringify({
        blocks: [{ id: "b1", name: "Off", role: "system", content: "SHOULD-NOT-APPEAR", enabled: false }],
      }), 1, 1);
    expect(everything(assemble(chat, "reply", ""))).not.toContain("SHOULD-NOT-APPEAR");
  });
});

describe("lorebooks", () => {
  const book = (entry: Record<string, unknown>) => {
    db.query("INSERT INTO lorebooks (id, name, entries, created_at) VALUES (?,?,?,?)")
      .run("b1", "Greywater", JSON.stringify([entry]), 1);
    db.query("INSERT INTO lorebook_links (id, book_id, scope, target_id) VALUES (?,?,?,?)")
      .run("l1", "b1", "chat", CHAT);
  };

  test("an entry fires when its key is in the conversation", () => {
    book({ keys: ["greywater"], content: "The mill has not turned since the flood." });
    const a = assemble(chat, "reply", "");
    expect(everything(a)).toContain("The mill has not turned since the flood.");
  });

  test("and stays out when nothing has said its key", () => {
    book({ keys: ["saltmarsh"], content: "SHOULD-NOT-APPEAR" });
    expect(everything(assemble(chat, "reply", ""))).not.toContain("SHOULD-NOT-APPEAR");
  });

  test("a constant entry fires whether or not anyone said anything", () => {
    book({ keys: [], constant: true, content: "It is always raining here." });
    expect(everything(assemble(chat, "reply", ""))).toContain("It is always raining here.");
  });

  test("what the message being typed says can fire one too", () => {
    // Lore has to see the turn you are about to send, or a book only ever
    // reacts one message late.
    book({ keys: ["lantern"], content: "The lantern is older than the bridge." });
    const a = assemble(chat, "reply", "", "I pick up the lantern.");
    expect(everything(a)).toContain("The lantern is older than the bridge.");
  });
});

describe("dice, and checks against a sheet", () => {
  test("a roll the narrator wrote is resolved, not left as a request", () => {
    const { text, rolls } = resolveRolls("She swings. [[2d6+1]]", () => 0.5);
    expect(rolls).toHaveLength(1);
    expect(text).not.toContain("[[2d6+1]]");
    expect(text).toMatch(/2d6\+1/);
  });

  test("a check is rolled against the sheet rather than invented", () => {
    const sheet = { klass: "fighter", level: 1, abilities: { str: 18, dex: 8, con: 12, int: 10, wis: 10, cha: 10 },
                    maxHp: 12, hp: 12, skills: [], inventory: [], notes: "" };
    const { checks } = resolveChecks("Try it. [[check: str]]", sheet as any, () => 0.5);
    expect(checks).toHaveLength(1);
    // +4 from an 18, which is the whole point of keeping a sheet.
    expect(checks[0].modifier).toBe(4);
  });

  test("the narrator asking for a skill is understood as the stat it uses", () => {
    expect(abilityAsked("Give me a perception check.")).toBe("wis");
    expect(abilityAsked("Roll stealth.")).toBe("dex");
    expect(abilityAsked("The fire pops.")).toBeNull();
  });
});

describe("fights", () => {
  test("a fight in progress is put in front of the narrator with its numbers", () => {
    const fight = startFight("two wolves", null, () => 0.5);
    const text = fightForPrompt(fight!);
    expect(text.toLowerCase()).toContain("wolf");
    expect(text).toMatch(/\d+/);
  });

  test("a hit comes off the right combatant and stays off", () => {
    const fight = startFight("a wolf", null, () => 0.5)!;
    const before = fight.order.find((x) => !x.player)!.hp;
    hurt(fight, "wolf", 3);
    const after = fight.order.find((x) => !x.player)!.hp;
    expect(after).toBe(before - 3);
  });
});

describe("what the narrator writes into the world", () => {
  test("an npc it introduces is kept, and comes back in the next prompt", () => {
    setSettings({ mode: "tabletop" });
    const out = applyVerbs(CHAT, "A woman looks up. [[npc: Marla, the ferrywoman]]", PERSONA);
    // The mark is trimmed to the bare name and *kept*, on purpose: the page
    // draws her from it as a chip. What must not survive is the description,
    // which has been filed rather than left lying in the prose.
    expect(out).toContain("[[npc: Marla]]");
    expect(out).not.toContain("ferrywoman");
    const kept = db.query("SELECT name FROM npcs WHERE chat_id = ?").all(CHAT) as any[];
    expect(kept.map((n) => n.name)).toContain("Marla");
    expect(everything(assemble(seed2(), "reply", ""))).toContain("Marla");
  });

  test("a scene it sets is remembered", () => {
    setSettings({ mode: "tabletop" });
    applyVerbs(CHAT, "[[scene: the bridge at dusk]]", PERSONA);
    const row = db.query("SELECT location FROM chats WHERE id = ?").get(CHAT) as any;
    expect(row.location).toContain("bridge");
  });
});

/** The chat again, after applyVerbs has written to it. */
function seed2() {
  return db.query("SELECT * FROM chats WHERE id = ?").get(CHAT) as any;
}
