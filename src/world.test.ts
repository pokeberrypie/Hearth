/**
 * What the narrator's verbs actually change: the people and the place.
 *
 * src/verbs.test.ts covers the reading; this covers the keeping — which is
 * where the surprises are, because a narrator says a name far more often than
 * it invents one.
 *
 *   bun test src/world.test.ts
 */

import { describe, expect, test, beforeEach } from "bun:test";

import { db, getSettings, setSettings, wipe } from "./test-support";
import { allBlocks, applyVerbs, editsLocked, swipeAllowance, withPreset, MAX_TABLE_SWIPES } from "./index";
import { tablePresetOn } from "./tablepreset";

const CHAT = "chat-world";

function scene() {
  wipe();
  db.query("INSERT INTO characters (id, name, first_message, created_at) VALUES (?,?,?,?)")
    .run("char-1", "The Gamekeeper", "hello", 1);
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run(CHAT, "char-1", "A game", 1, 1);
}

const cast = () =>
  db.query("SELECT name, brief FROM npcs WHERE chat_id = ? AND deleted_at IS NULL ORDER BY created_at")
    .all(CHAT) as { name: string; brief: string }[];

const where = () =>
  (db.query("SELECT location FROM chats WHERE id = ?").get(CHAT) as any).location;

beforeEach(scene);

describe("someone the narrator introduced", () => {
  test("becomes a person, with what was said about them", () => {
    applyVerbs(CHAT, "The barkeep looks up. [[npc: Melda — barkeep, tired, lying]]");
    expect(cast()).toEqual([{ name: "Melda", brief: "barkeep, tired, lying" }]);
  });

  test("naming her again does not make a second Melda", () => {
    // The narrator will write her name every time she speaks. If each one made
    // a row, a talkative innkeeper would fill the panel with herself.
    applyVerbs(CHAT, "[[npc: Melda — barkeep]]");
    applyVerbs(CHAT, "[[npc: Melda]]");
    applyVerbs(CHAT, "[[npc: melda — barkeep]]");
    expect(cast()).toHaveLength(1);
  });

  test("but learning more about her does update her", () => {
    applyVerbs(CHAT, "[[npc: Melda]]");
    applyVerbs(CHAT, "[[npc: Melda — barkeep, lost her sister at the mill]]");
    expect(cast()[0].brief).toBe("barkeep, lost her sister at the mill");
  });

  test("and a thinner description later does not undo the fuller one", () => {
    applyVerbs(CHAT, "[[npc: Melda — barkeep, lost her sister at the mill]]");
    applyVerbs(CHAT, "[[npc: Melda — a woman]]");
    expect(cast()[0].brief).toBe("barkeep, lost her sister at the mill");
  });

  test("the reply keeps her name and shows nothing else", () => {
    const out = applyVerbs(CHAT, "She sets the glass down. [[npc: Melda — barkeep, tired]]");
    expect(out).toBe("She sets the glass down. [[npc: Melda]]");
  });

  test("she belongs to her own game and not to the next one", () => {
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
      .run("other", "char-1", "Another game", 1, 1);
    applyVerbs(CHAT, "[[npc: Melda — barkeep]]");
    applyVerbs("other", "[[npc: Harwin — miller]]");
    expect(cast().map((n) => n.name)).toEqual(["Melda"]);
  });
});

describe("where everyone is", () => {
  test("is remembered, so the story cannot wander back", () => {
    applyVerbs(CHAT, "[[scene: the taproom of the Blackthorn]]");
    expect(where()).toBe("the taproom of the Blackthorn");
  });

  test("moving again replaces it rather than collecting places", () => {
    applyVerbs(CHAT, "[[scene: the taproom]]");
    applyVerbs(CHAT, "[[scene: the old mill, at night]]");
    expect(where()).toBe("the old mill, at night");
  });
});

describe("a fight", () => {
  const PLAYER = "persona-1";

  function withSheet(hp = 8) {
    db.query("INSERT INTO personas (id, name, created_at) VALUES (?,?,?)")
      .run(PLAYER, "Iva Grant", 1);
    db.query("INSERT INTO sheets (owner_id, owner_kind, sheet, updated_at) VALUES (?,?,?,?)")
      .run(PLAYER, "persona", JSON.stringify({
        klass: "rogue", level: 1, maxHp: 8, hp,
        abilities: { str: 12, dex: 16, con: 11, int: 10, wis: 10, cha: 13 },
        skills: [], inventory: [], notes: "",
      }), 1);
  }

  const fight = () => {
    const raw = (db.query("SELECT fight FROM chats WHERE id = ?").get(CHAT) as any).fight;
    return raw ? JSON.parse(raw) : null;
  };
  const sheetHp = () =>
    JSON.parse((db.query("SELECT sheet FROM sheets WHERE owner_id = ?").get(PLAYER) as any).sheet).hp;

  test("starts, with the player in it and an order written into the reply", () => {
    withSheet();
    const out = applyVerbs(CHAT, "Steel comes out. [[fight: two wolves]]", PLAYER);
    expect(out).toMatch(/\[\[initiative: .*\]\]/);
    expect(fight().order).toHaveLength(3);
    expect(fight().order.some((c: any) => c.player)).toBe(true);
  });

  test("damage lands on the fight and is written into the reply", () => {
    withSheet();
    applyVerbs(CHAT, "[[fight: two wolves 10hp]]", PLAYER);
    const out = applyVerbs(CHAT, "Your knife finds its throat. [[hit: Wolf 1, 4]]", PLAYER);
    expect(out).toContain("[[hp: Wolf 1 -4, 6/10]]");
  });

  test("damage to you comes off your sheet, because it is the same number", () => {
    withSheet();
    applyVerbs(CHAT, "[[fight: a wolf 10hp]]", PLAYER);
    applyVerbs(CHAT, "It gets past your guard. [[hit: Iva Grant, 3]]", PLAYER);
    expect(sheetHp()).toBe(5);
  });

  test("and healing puts it back", () => {
    withSheet(4);
    applyVerbs(CHAT, "[[fight: a wolf 10hp]]", PLAYER);
    applyVerbs(CHAT, "[[heal: Iva Grant, 2]]", PLAYER);
    expect(sheetHp()).toBe(6);
  });

  test("you arrive at the fight already carrying what you had lost", () => {
    withSheet(3);
    applyVerbs(CHAT, "[[fight: a wolf]]", PLAYER);
    expect(fight().order.find((c: any) => c.player).hp).toBe(3);
  });

  test("the narrator can call it, and then there is no fight", () => {
    withSheet();
    applyVerbs(CHAT, "[[fight: a wolf]]", PLAYER);
    expect(applyVerbs(CHAT, "It bolts for the trees. [[fight: over]]", PLAYER))
      .toContain("[[fight over]]");
    expect(fight()).toBeNull();
  });

  test("and if it forgets, the last one going down calls it", () => {
    withSheet();
    applyVerbs(CHAT, "[[fight: a wolf 10hp]]", PLAYER);
    const out = applyVerbs(CHAT, "You bury the knife to the hilt. [[hit: wolf, 99]]", PLAYER);
    expect(out).toContain("[[fight over]]");
    expect(fight()).toBeNull();
  });

  test("a hit with no fight running is left where the model wrote it", () => {
    withSheet();
    const text = "[[hit: Wolf 1, 4]]";
    expect(applyVerbs(CHAT, text, PLAYER)).toBe(text);
  });

  test("so is calling off a fight that was never happening", () => {
    const text = "[[fight: over]]";
    expect(applyVerbs(CHAT, text, PLAYER)).toBe(text);
  });

  test("and so is hitting somebody who is not in it", () => {
    withSheet();
    applyVerbs(CHAT, "[[fight: a wolf]]", PLAYER);
    const text = "[[hit: Melda, 4]]";
    expect(applyVerbs(CHAT, text, PLAYER)).toBe(text);
  });

  test("a fight without a sheet is still a fight", () => {
    const out = applyVerbs(CHAT, "[[fight: two wolves]]", null);
    expect(out).toMatch(/\[\[initiative:/);
    expect(fight().order).toHaveLength(2);
  });
});

describe("a reply with nothing in it for us", () => {
  test("comes back untouched and changes nothing", () => {
    const text = "She wipes the bar and says nothing. [[1d20+2]] [[check: dex]]";
    expect(applyVerbs(CHAT, text)).toBe(text);
    expect(cast()).toHaveLength(0);
    expect(where()).toBe("");
  });
});

describe("swipes at the table", () => {
  test("three by default, because that is the setting's default", () => {
    wipe();
    expect(swipeAllowance()).toBe(3);
  });

  test("what the chooser offers is what it stores", () => {
    for (const n of [0, 3, 5, 10]) {
      setSettings({ tabletop_swipes: String(n) });
      expect(swipeAllowance()).toBe(n);
    }
  });

  test("ten is the ceiling, and a hand-edited row cannot buy past it", () => {
    setSettings({ tabletop_swipes: "9999" });
    expect(swipeAllowance()).toBe(MAX_TABLE_SWIPES);
    setSettings({ tabletop_swipes: "-4" });
    expect(swipeAllowance()).toBe(0);
  });

  test("nonsense falls back rather than opening the gate", () => {
    setSettings({ tabletop_swipes: "as many as I like" });
    expect(swipeAllowance()).toBe(3);
  });
});

describe("the pencil", () => {
  test("is out in a story, always", () => {
    setSettings({ mode: "story", tabletop_edits: "0" });
    expect(editsLocked()).toBe(false);
  });

  test("is away at the table unless asked for", () => {
    setSettings({ mode: "tabletop", tabletop_edits: "0" });
    expect(editsLocked()).toBe(true);
    setSettings({ tabletop_edits: "1" });
    expect(editsLocked()).toBe(false);
  });

  test("anything but a plain yes leaves it away", () => {
    // The setting is a string column; "true" and "yes" are not the stored
    // form, and guessing at them is how a lock quietly stops locking.
    setSettings({ mode: "tabletop", tabletop_edits: "true" });
    expect(editsLocked()).toBe(true);
  });
});

describe("the table's own preset", () => {
  test("is off in a story, whatever the switch says", () => {
    setSettings({ mode: "story", tabletop_preset: "1" });
    expect(tablePresetOn(getSettings())).toBe(false);
  });

  test("is on at the table by default, and can be turned off", () => {
    setSettings({ mode: "tabletop" });
    expect(tablePresetOn(getSettings())).toBe(true);
    setSettings({ tabletop_preset: "0" });
    expect(tablePresetOn(getSettings())).toBe(false);
  });

  test("replaces the active preset's blocks rather than joining them", () => {
    wipe();
    db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES (?,?,?,?,?)")
      .run("p1", "Mine", JSON.stringify({
        temperature: "1.4",
        blocks: [{ id: "x", name: "Purple prose", role: "system", content: "Write lavishly." }],
      }), 1, 1);

    setSettings({ mode: "story" });
    expect(allBlocks().some((b) => b.content === "Write lavishly.")).toBe(true);
    expect(withPreset(getSettings()).temperature).toBe("1.4");

    setSettings({ mode: "tabletop" });
    const table = allBlocks();
    expect(table.some((b) => b.content === "Write lavishly.")).toBe(false);
    expect(table.some((b) => /running a game/i.test(b.content))).toBe(true);
    // And it positions the pieces a prompt cannot do without.
    for (const m of ["charDescription", "chatHistory", "personaDescription"]) {
      expect(table.some((b) => b.marker === m)).toBe(true);
    }
  });

  test("leaves alone the settings that are the owner's to choose", () => {
    wipe();
    setSettings({ mode: "tabletop", context_tokens: "4000", reasoning_effort: "high" });
    const s = withPreset(getSettings());
    // The one that costs money, and the one that is about the model rather
    // than about the game.
    expect(s.context_tokens).toBe("4000");
    expect(s.reasoning_effort).toBe("high");
    // But it does have an opinion about how long a turn is.
    expect(s.max_tokens).toBe("700");
  });

  test("its own text does not repeat the notations assemble adds later", () => {
    // Two copies of the dice rules in one prompt is one copy and some noise.
    for (const b of allBlocks()) expect(b.content).not.toContain("[[");
  });
});
