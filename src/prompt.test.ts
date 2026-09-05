/**
 * Prompt assembly.
 *
 * `assemble()` is the only place a prompt gets built. Both POST
 * /chats/:id/generate and POST /chats/:id/inspect call it, so these tests are
 * what keeps the inspector honest: if the shape of a sent prompt changes, it
 * changes here, in one place, and these tests say so.
 *
 *   bun test
 */

import { beforeEach, describe, expect, test } from "bun:test";

import { stripSpeakerLabel, buildMessages, buildPostHistory, buildSystem, macros, type Character } from "./prompt";
import { db, wipe } from "./test-support";

// ---- the parts that need no database ---------------------------------------

describe("macros", () => {
  test("replaces the names and their SillyTavern aliases", () => {
    expect(macros("{{char}} and {{user}}", "Akira", "Wren")).toBe("Akira and Wren");
    expect(macros("<BOT> and <USER>", "Akira", "Wren")).toBe("Akira and Wren");
  });

  test("is case-insensitive on the braced form", () => {
    expect(macros("{{CHAR}} {{User}}", "Akira", "Wren")).toBe("Akira Wren");
  });

  test("leaves everything else alone", () => {
    expect(macros("a {{unknown}} b", "Akira", "Wren")).toBe("a {{unknown}} b");
  });
});

const char: Character = {
  name: "Akira",
  description: "A letter carrier who reads the letters.",
  personality: "Curious",
  scenario: "A wet evening.",
  first_message: "You're late.",
};

describe("buildSystem", () => {
  test("uses the default framing and every filled section", () => {
    const s = buildSystem(char, "Wren", "Tired, twenty-nine.");
    expect(s).toContain("You are Akira in an ongoing collaborative roleplay with Wren.");
    expect(s).toContain("# Akira\nA letter carrier");
    expect(s).toContain("# Personality\nCurious");
    expect(s).toContain("# Scene\nA wet evening.");
    expect(s).toContain("# Wren\nTired, twenty-nine.");
  });

  test("a card's own system prompt replaces the default framing", () => {
    const s = buildSystem({ ...char, system_prompt: "Write like a ghost story." }, "Wren", "");
    expect(s.startsWith("Write like a ghost story.")).toBe(true);
    expect(s).not.toContain("ongoing collaborative roleplay");
  });

  test("example dialogue is labelled as style, not as events", () => {
    const s = buildSystem({ ...char, mes_example: "<START>\nhi" }, "Wren", "");
    expect(s).toContain("must not be referred to as events");
  });

  test("empty sections are left out entirely", () => {
    const s = buildSystem({ ...char, personality: "", scenario: "" }, "Wren", "");
    expect(s).not.toContain("# Personality");
    expect(s).not.toContain("# Scene");
  });
});

describe("buildPostHistory", () => {
  test("applies macros and trims", () => {
    expect(buildPostHistory({ ...char, post_history: "  Never speak for {{user}}. " }, "Wren"))
      .toBe("Never speak for Wren.");
  });

  test("is empty when the card says nothing", () => {
    expect(buildPostHistory(char, "Wren")).toBe("");
  });
});

describe("buildMessages", () => {
  const turns = (...roles: string[]) =>
    roles.map((role, i) => ({ role, content: `${role}-${i}` }));

  test("keeps the newest turns that fit the token budget", () => {
    const out = buildMessages(turns("user", "assistant", "user", "assistant"), char, "Wren", 20);
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe("user-2");
  });

  // Both APIs want the turn order to start with the user.
  test("drops leading assistant turns after trimming", () => {
    const out = buildMessages(turns("user", "assistant", "assistant"), char, "Wren", 20);
    expect(out.every((m) => m.role)).toBe(true);
    expect(out[0].role).toBe("user");
  });

  test("an empty history still opens the scene", () => {
    expect(buildMessages([], char, "Wren", 8000)).toEqual([
      { role: "user", content: "(begin the scene)" },
    ]);
  });

  test("macros are expanded inside the transcript", () => {
    const out = buildMessages([{ role: "user", content: "hi {{char}}" }], char, "Wren", 8000);
    expect(out[0].content).toBe("hi Akira");
  });

  // The budget is what actually costs money and actually overflows; forty
  // short turns and forty turns of a preset's status blocks are not the same
  // request, which is what counting messages could not tell you.
  test("a long turn costs more of the budget than a short one", () => {
    const long = [
      { role: "user", content: "x".repeat(4000) },
      { role: "assistant", content: "y".repeat(4000) },
      { role: "user", content: "the only one that fits" },
    ];
    const out = buildMessages(long, char, "Wren", 200);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("the only one that fits");
  });

  test("one turn is always sent, even when it alone busts the budget", () => {
    const out = buildMessages([{ role: "user", content: "z".repeat(9000) }], char, "Wren", 50);
    expect(out).toHaveLength(1);
  });
});

// ---- assemble(), against a throwaway database ------------------------------

const { assemble } = await import("./index");

const CHAR_ID = "c1";
const CHAT_ID = "t1";
const PERSONA_ID = "p1";

/** Rebuilds a small chat from scratch so tests cannot leak into each other. */
function seed(opts: { note?: string; depth?: number; post_history?: string } = {}) {
  wipe();
  db.query(
    `INSERT INTO characters (id, name, description, personality, scenario, first_message, post_history, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(CHAR_ID, "Akira", "A letter carrier.", "Curious", "A wet evening.", "You're late.",
        opts.post_history ?? "", 1);
  db.query("INSERT INTO personas (id, name, description, is_active, created_at) VALUES (?,?,?,?,?)")
    .run(PERSONA_ID, "Wren", "Tired, twenty-nine.", 1, 1);
  db.query(
    `INSERT INTO chats (id, character_id, title, created_at, updated_at, persona_id, author_note, note_depth)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(CHAT_ID, CHAR_ID, "A chat", 1, 1, PERSONA_ID, opts.note ?? "", opts.depth ?? 0);

  const ins = db.query(
    "INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES (?,?,?,?,?,?)",
  );
  const lines: [string, string][] = [
    ["assistant", "You're late."],
    ["user", "The road was flooded."],
    ["assistant", "She took the letter anyway."],
    ["user", "What does it say?"],
    ["assistant", "Nothing you'd like."],
  ];
  lines.forEach(([role, content], i) => ins.run(`m${i}`, CHAT_ID, role, "", content, 10 + i));

  return db.query("SELECT * FROM chats WHERE id = ?").get(CHAT_ID) as any;
}

const addLore = (entry: Record<string, unknown>) => {
  db.query("INSERT INTO lorebooks (id, name, entries, created_at) VALUES (?,?,?,?)")
    .run("b1", "Book", JSON.stringify([entry]), 1);
  db.query("INSERT INTO lorebook_links (id, book_id, scope, target_id) VALUES (?,?,?,?)")
    .run("l1", "b1", "chat", CHAT_ID);
};

const text = (a: { messages: { role: string; content: string }[] }) =>
  a.messages.map((m) => m.content);

let chat: any;
beforeEach(() => { chat = seed(); });

describe("assemble — modes", () => {
  test("a reply sends the whole transcript and no prefill", () => {
    const a = assemble(chat, "reply", "");
    expect(a.prefill).toBeUndefined();
    expect(text(a)).toEqual([
      "The road was flooded.",
      "She took the letter anyway.",
      "What does it say?",
      "Nothing you'd like.",
    ]);
    expect(a.system).toContain("You are Akira in an ongoing collaborative roleplay with Wren.");
  });

  test("continue seeds the reply and drops it from the transcript", () => {
    const a = assemble(chat, "continue", "");
    expect(a.prefill).toBe("Nothing you'd like.");
    expect(text(a)).not.toContain("Nothing you'd like.");
    expect(text(a).at(-1)).toBe("What does it say?");
  });

  test("swipe drops the last reply without seeding a new one", () => {
    const a = assemble(chat, "swipe", "");
    expect(a.prefill).toBeUndefined();
    expect(text(a)).not.toContain("Nothing you'd like.");
  });

  test("continue on a chat that ends with the user changes nothing", () => {
    db.query("DELETE FROM messages WHERE id = ?").run("m4");
    const a = assemble(seed0(), "continue", "");
    expect(a.prefill).toBeUndefined();
    expect(text(a).at(-1)).toBe("What does it say?");
  });

  // A trailing assistant message reads as "continue this text" to Anthropic,
  // which is the opposite of what a silent turn wants.
  test("a silent turn closes the conversation with a marker user turn", () => {
    const a = assemble(chat, "silent", "");
    expect(text(a).at(-1)).toBe("(Wren says nothing.)");
    expect(a.system).toContain("# Wren has said nothing");
  });

  test("impersonate puts the instruction at the very top of the system block", () => {
    const a = assemble(chat, "impersonate", "");
    expect(a.system.startsWith("You are writing for Wren in a roleplay with Akira.")).toBe(true);
  });

  const lastTurn = (a: ReturnType<typeof assemble>) =>
    a.messages[a.messages.length - 1]?.content ?? "";

  test("a guide is aimed at whoever is being written for", () => {
    expect(lastTurn(assemble(chat, "reply", "Be brief."))).toContain("when writing Akira");
    expect(lastTurn(assemble(chat, "impersonate", "Be brief."))).toContain("when writing Wren");
  });

  test("a guide lands after the transcript, not in the system prompt", () => {
    // In the system block a fifty-thousand-character preset simply drowns it;
    // it has to be the last thing said, because it is about this reply.
    const a = assemble(chat, "reply", "Be brief.");
    expect(a.system).not.toContain("Direction for this response only");
    expect(lastTurn(a)).toContain("Direction for this response only");
  });

  test("no guide adds no turn", () => {
    const withGuide = assemble(chat, "reply", "Be brief.").messages.length;
    const without = assemble(chat, "reply", "").messages.length;
    expect(without).toBeLessThanOrEqual(withGuide);
    expect(assemble(chat, "reply", "   ").messages.map((m) => m.content).join("\n"))
      .not.toContain("Direction for this response only");
  });

  test("a staged message is threaded through as the newest user turn", () => {
    const a = assemble(chat, "reply", "", "I want to read it.");
    expect(text(a).at(-1)).toBe("I want to read it.");
    expect(a.sections.some((s) => s.label === "Your message")).toBe(true);
  });
});

/** The seed helper re-inserts messages, so re-read the row after a mutation. */
function seed0() {
  return db.query("SELECT * FROM chats WHERE id = ?").get(CHAT_ID) as any;
}

describe("assemble — author's note depth", () => {
  test("depth 0 keeps the note in the standing brief", () => {
    const a = assemble(seed({ note: "Keep the pace slow.", depth: 0 }), "reply", "");
    expect(a.system).toContain("# Standing notes\nKeep the pace slow.");
    expect(text(a).join("|")).not.toContain("Keep the pace slow.");
    expect(a.sections.some((s) => s.label === "Author's notes")).toBe(true);
  });

  test("depth 2 splices the note into the transcript, two turns from the end", () => {
    const a = assemble(seed({ note: "Keep the pace slow.", depth: 2 }), "reply", "");
    expect(a.system).not.toContain("Standing notes");
    expect(text(a)).toEqual([
      "The road was flooded.",
      "She took the letter anyway.",
      "[Keep the pace slow.]",
      "What does it say?",
      "Nothing you'd like.",
    ]);
    expect(a.sections.some((s) => s.label === "Author's notes, 2 back")).toBe(true);
  });

  test("depth 1 sits immediately before the last turn", () => {
    const a = assemble(seed({ note: "Slow.", depth: 1 }), "reply", "");
    expect(text(a).at(-2)).toBe("[Slow.]");
  });

  test("a depth past the start of the conversation lands at the top", () => {
    const a = assemble(seed({ note: "Slow.", depth: 20 }), "reply", "");
    expect(text(a)[0]).toBe("[Slow.]");
  });

  test("an empty note is injected nowhere", () => {
    const a = assemble(seed({ note: "   ", depth: 2 }), "reply", "");
    expect(a.system).not.toContain("Standing notes");
    expect(text(a).join("|")).not.toContain("[]");
  });

  test("macros in the note are expanded", () => {
    const a = assemble(seed({ note: "{{char}} is hiding something from {{user}}.", depth: 1 }), "reply", "");
    expect(text(a)).toContain("[Akira is hiding something from Wren.]");
  });
});

describe("assemble — lore and card instructions", () => {
  // "Before the character" means before the character's description, which is
  // where SillyTavern's worldInfoBefore sits too — after the framing, not above it.
  test("a before_char entry lands between the framing and the description", () => {
    chat = seed();
    addLore({ constant: true, content: "Ashvale is under curfew.", position: 0 });
    const a = assemble(seed0(), "reply", "");
    expect(a.system.indexOf("collaborative roleplay"))
      .toBeLessThan(a.system.indexOf("Ashvale is under curfew."));
    expect(a.system.indexOf("Ashvale is under curfew."))
      .toBeLessThan(a.system.indexOf("# Akira\nA letter carrier."));
    expect(a.lore).toHaveLength(1);
    expect(a.lore[0].via).toBe("constant");
  });

  test("an after_char entry lands under its own heading", () => {
    chat = seed();
    addLore({ constant: true, content: "Ashvale is under curfew.", position: 1 });
    expect(assemble(seed0(), "reply", "").system).toContain("# What is known\nAshvale is under curfew.");
  });

  test("an at_depth entry is spliced into the transcript", () => {
    chat = seed();
    addLore({ constant: true, content: "It is raining.", position: 4, depth: 1 });
    expect(text(assemble(seed0(), "reply", "")).at(-2)).toBe("[It is raining.]");
  });

  test("lore fires against a staged message that is not saved yet", () => {
    chat = seed();
    addLore({ key: ["curfew"], content: "Ashvale is under curfew.", position: 1 });
    expect(assemble(seed0(), "reply", "").lore).toHaveLength(0);
    expect(assemble(seed0(), "reply", "", "is there a curfew?").lore).toHaveLength(1);
  });

  test("post-history instructions ride on the last user turn", () => {
    const a = assemble(seed({ post_history: "Never speak for {{user}}." }), "silent", "");
    expect(text(a).at(-1)).toBe("(Wren says nothing.)\n\n[Never speak for Wren.]");
  });

  test("post-history becomes its own turn when the transcript ends on a reply", () => {
    const a = assemble(seed({ post_history: "Stay in scene." }), "reply", "");
    expect(text(a).at(-1)).toBe("[Stay in scene.]");
  });
});

describe("assemble — what the inspector reports", () => {
  test("every section it lists is really in the prompt", () => {
    const a = assemble(seed({ note: "Slow.", depth: 0, post_history: "Stay in scene." }), "reply", "Be brief.");
    const whole = a.system + "\n" + a.messages.map((m) => m.content).join("\n");
    for (const s of a.sections) {
      if (s.label === "Conversation") continue;  // it is the transcript itself
      expect(whole).toContain(s.content.trim());
    }
  });

  test("sections carry their own length", () => {
    const a = assemble(chat, "reply", "");
    for (const s of a.sections) expect(s.chars).toBe(s.content.length);
  });

  test("the model and provider come back with the prompt", () => {
    const a = assemble(chat, "reply", "");
    expect(a.provider).toBe("openrouter");
    expect(typeof a.model).toBe("string");
    expect(a.sampling.temperature).toBe(1);
  });
});

describe("assemble — preset prompt blocks", () => {
  const preset = (blocks: unknown[]) => {
    db.query("DELETE FROM presets").run();
    db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES (?,?,?,?,?)")
      .run("pr1", "Blocks", JSON.stringify({ blocks }), 1, 1);
    return seed0();
  };

  test("a system block joins the brief under its own name", () => {
    const a = assemble(preset([{ name: "House style", role: "system", content: "Write short." }]), "reply", "");
    expect(a.system).toContain("# House style\nWrite short.");
    expect(a.sections.some((s) => s.label === "Preset block — House style")).toBe(true);
  });

  test("system blocks keep their list order", () => {
    const a = assemble(preset([
      { name: "One", role: "system", content: "first" },
      { name: "Two", role: "system", content: "second" },
    ]), "reply", "");
    expect(a.system.indexOf("# One")).toBeLessThan(a.system.indexOf("# Two"));
  });

  test("a disabled block contributes nothing", () => {
    const a = assemble(preset([{ name: "Off", role: "system", content: "nope", enabled: false }]), "reply", "");
    expect(a.system).not.toContain("nope");
  });

  test("user and assistant blocks are appended to the conversation", () => {
    const a = assemble(preset([{ name: "Nudge", role: "user", content: "Keep going." }]), "reply", "");
    expect(text(a).at(-1)).toBe("Keep going.");
  });

  test("macros are expanded inside a block", () => {
    const a = assemble(preset([{ name: "M", role: "system", content: "{{char}} meets {{user}}." }]), "reply", "");
    expect(a.system).toContain("Akira meets Wren.");
  });

  test("the guide still lands after the blocks", () => {
    // Not merely after them in the system prompt — past the transcript
    // entirely, which is the only place a block that long cannot bury it.
    const a = assemble(preset([{ name: "B", role: "system", content: "block text" }]), "reply", "Be brief.");
    expect(a.system).toContain("# B");
    expect(a.messages[a.messages.length - 1].content).toContain("Direction for this response only");
  });

  test("card instructions still land after a chat block", () => {
    db.query("UPDATE characters SET post_history = ? WHERE id = ?").run("Stay in scene.", CHAR_ID);
    const a = assemble(preset([{ name: "Nudge", role: "user", content: "Keep going." }]), "reply", "");
    expect(text(a).at(-1)).toBe("Keep going.\n\n[Stay in scene.]");
  });

  test("an inactive preset's blocks are ignored", () => {
    const chat2 = preset([{ name: "B", role: "system", content: "block text" }]);
    db.query("UPDATE presets SET is_active = 0").run();
    expect(assemble(chat2, "reply", "").system).not.toContain("block text");
  });
});

describe("assemble — a preset ordering the whole prompt", () => {
  const preset = (blocks: unknown[]) => {
    db.query("DELETE FROM presets").run();
    db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES (?,?,?,?,?)")
      .run("pr2", "Ordered", JSON.stringify({ blocks }), 1, 1);
    return seed0();
  };
  const mk = (marker: string, enabled = true) =>
    ({ id: marker, name: marker, role: "system", content: "", enabled, marker });

  test("markers place the card's own pieces in the listed order", () => {
    const a = assemble(preset([mk("scenario"), mk("charDescription"), mk("chatHistory")]), "reply", "");
    expect(a.system.indexOf("# Scene")).toBeLessThan(a.system.indexOf("# Akira"));
  });

  test("a piece the list leaves out is left out", () => {
    // Scenario, example dialogue and the framing text are the preset's to
    // drop. The character, the personality and the persona are not — see
    // "the card is never a preset's to leave out" below.
    const a = assemble(preset([mk("charDescription"), mk("chatHistory")]), "reply", "");
    expect(a.system).toContain("# Akira");
    expect(a.system).not.toContain("# Scene");
    expect(a.system).not.toContain("collaborative roleplay");
  });

  /**
   * The bug this exists for: every preset imported before the marker fix lost
   * its card blocks, and those lists cannot be repaired — the markers were
   * never written down. A preset that omits the character produces a reply
   * written by something that does not know who it is, which is worth nothing
   * to anybody, so it is not a choice a preset gets to make.
   */
  test("the card is never a preset's to leave out", () => {
    const a = assemble(preset([mk("chatHistory")]), "reply", "");
    expect(a.system).toContain("# Akira");          // description
    expect(a.system).toContain("# Personality");
    expect(a.system).toContain("# Wren");           // the persona
  });

  test("switching the card off does not drop it either", () => {
    const a = assemble(
      preset([mk("charDescription", false), mk("personaDescription", false), mk("chatHistory")]),
      "reply", "",
    );
    expect(a.system).toContain("# Akira");
    expect(a.system).toContain("# Wren");
  });

  test("a preset that positions the card keeps its position", () => {
    const a = assemble(
      preset([mk("scenario"), mk("charDescription"), mk("chatHistory")]),
      "reply", "",
    );
    // Its own order wins: scene before the card, and only one of each.
    expect(a.system.indexOf("# Scene")).toBeLessThan(a.system.indexOf("# Akira"));
    expect(a.system.split("# Akira").length - 1).toBe(1);
  });

  test("a disabled marker drops its piece", () => {
    const a = assemble(preset([mk("main"), mk("scenario", false), mk("chatHistory")]), "reply", "");
    expect(a.system).toContain("collaborative roleplay");
    expect(a.system).not.toContain("# Scene");
  });

  test("blocks after chatHistory become turns, before it become brief", () => {
    const a = assemble(preset([
      mk("main"),
      { id: "t1", name: "Rules", role: "system", content: "Be brief.", enabled: true },
      mk("chatHistory"),
      { id: "t2", name: "Nudge", role: "user", content: "Keep going.", enabled: true },
    ]), "reply", "");
    expect(a.system).toContain("# Rules\nBe brief.");
    expect(text(a).at(-1)).toBe("Keep going.");
  });

  test("a listed but disabled jailbreak drops the card's post-history", () => {
    db.query("UPDATE characters SET post_history = ? WHERE id = ?").run("Stay in scene.", CHAR_ID);
    const off = assemble(preset([mk("main"), mk("chatHistory"), mk("jailbreak", false)]), "reply", "");
    expect(text(off).join("|")).not.toContain("Stay in scene.");
    const on = assemble(preset([mk("main"), mk("chatHistory"), mk("jailbreak")]), "reply", "");
    expect(text(on).at(-1)).toContain("Stay in scene.");
  });

  test("the author's note goes where its marker sits", () => {
    db.query("UPDATE chats SET author_note = ?, note_depth = 0 WHERE id = ?").run("Slow down.", CHAT_ID);
    const a = assemble(preset([mk("authorsNote"), mk("main"), mk("chatHistory")]), "reply", "");
    expect(a.system.indexOf("Slow down.")).toBeLessThan(a.system.indexOf("collaborative roleplay"));
  });

  test("no preset at all still builds the default order", () => {
    db.query("DELETE FROM presets").run();
    const a = assemble(seed0(), "reply", "");
    expect(a.system.indexOf("collaborative roleplay")).toBeLessThan(a.system.indexOf("# Akira"));
    expect(a.system).toContain("# Personality");
  });
});


describe("assemble — group chats", () => {
  const CHAR_B = "c2";

  /** Adds a second character and makes the chat a group. */
  function group() {
    seed();
    db.query("INSERT INTO characters (id, name, description, created_at) VALUES (?,?,?,?)")
      .run(CHAR_B, "Bern", "A tollkeeper with a grudge.", 1);
    db.query("INSERT INTO chat_members (id, chat_id, character_id, position) VALUES (?,?,?,?)")
      .run("mem1", CHAT_ID, CHAR_ID, 0);
    db.query("INSERT INTO chat_members (id, chat_id, character_id, position) VALUES (?,?,?,?)")
      .run("mem2", CHAT_ID, CHAR_B, 1);
    db.query("UPDATE chats SET is_group = 1 WHERE id = ?").run(CHAT_ID);
    return seed0();
  }

  test("the others are described, and writing them is forbidden", () => {
    const a = assemble(group(), "reply", "");
    expect(a.system).toContain("# Also in the scene");
    expect(a.system).toContain("**Bern** — A tollkeeper with a grudge.");
    expect(a.system).toContain("never spoken *for*");
  });

  test("a named speaker is the one written for", () => {
    const g = group();
    const bern = db.query("SELECT * FROM characters WHERE id = ?").get(CHAR_B) as any;
    const a = assemble(g, "reply", "", "", bern);
    expect(a.system).toContain("You are Bern in an ongoing collaborative roleplay");
    expect(a.system).toContain("**Akira**");
    expect(a.system).not.toContain("**Bern**");
  });

  test("group transcripts label who said what", () => {
    const g = group();
    db.query("UPDATE messages SET name = 'Akira' WHERE role = 'assistant' AND chat_id = ?").run(CHAT_ID);
    const a = assemble(g, "reply", "");
    expect(a.messages.some((m) => m.content.startsWith("Akira: "))).toBe(true);
  });

  test("a solo chat is not labelled and gains no ensemble note", () => {
    const a = assemble(seed(), "reply", "");
    expect(a.system).not.toContain("Also in the scene");
    expect(a.messages.every((m) => !m.content.startsWith("Akira: "))).toBe(true);
  });
});

// ---- speaker labels -------------------------------------------------------

/**
 * The bug these exist for: a group prompt prefixes each stored reply with who
 * said it, models copy the habit into their own output, and that output was
 * saved verbatim — so the next turn prefixed it again. The label grew by one
 * every turn: "Jaime: Jaime: Jaime: …".
 */
describe("stripSpeakerLabel", () => {
  test("removes the speaker's own label", () => {
    expect(stripSpeakerLabel("Jaime: he laughed.", "Jaime")).toBe("he laughed.");
  });

  test("removes however many have stacked up", () => {
    expect(stripSpeakerLabel("Jaime: Jaime: Jaime: he laughed.", "Jaime")).toBe("he laughed.");
  });

  test("ignores case and leading decoration", () => {
    expect(stripSpeakerLabel("**jaime:** he laughed.", "Jaime")).toBe("** he laughed.");
    expect(stripSpeakerLabel("  Jaime : he laughed.", "Jaime")).toBe("he laughed.");
  });

  test("leaves somebody else's name alone", () => {
    expect(stripSpeakerLabel("Cersei: get out.", "Jaime")).toBe("Cersei: get out.");
  });

  test("leaves prose that merely starts with the name alone", () => {
    expect(stripSpeakerLabel("Jaime went to the door.", "Jaime")).toBe("Jaime went to the door.");
  });

  test("does nothing without a name", () => {
    expect(stripSpeakerLabel("Jaime: he laughed.", "")).toBe("Jaime: he laughed.");
  });

  test("a group transcript is labelled exactly once", () => {
    const out = buildMessages(
      [
        { role: "user", content: "Well?" },
        { role: "assistant", content: "Jaime: Jaime: he laughed.", name: "Jaime" },
      ],
      { name: "Jaime", description: "", personality: "", scenario: "", first_message: "" },
      "Iva",
      8000,
      true,
    );
    expect(out[out.length - 1].content).toBe("Jaime: he laughed.");
  });
});
