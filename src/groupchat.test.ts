/**
 * Group chats.
 *
 * The bugs these exist for: a fresh group's very first reply always went to
 * whoever was added first, because their scripted greeting was the oldest
 * message and "oldest" read as "quietest". And continue/swipe recalculated
 * who should speak instead of keeping whoever already wrote the line, so a
 * swipe could silently reroll one character's take in another character's
 * voice while the screen kept showing the original name.
 *
 *   bun test
 */

import { afterAll, describe, expect, test } from "bun:test";

import { db, setSettings, wipe } from "./test-support";

const { membersOf, nextSpeaker, assemble, app } = await import("./index");
const server = { fetch: app.fetch };

const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });

// ---- fixtures ---------------------------------------------------------

const CHAT = "g1";

/** Three characters, in a group, each with a greeting — no user turn yet. */
function seedGroup() {
  wipe();
  const t = 1000;
  db.query("INSERT INTO characters (id, name, description, first_message, created_at) VALUES (?,?,?,?,?)")
    .run("A", "Alpha", "First to arrive.", "Hello from Alpha.", t);
  db.query("INSERT INTO characters (id, name, description, first_message, created_at) VALUES (?,?,?,?,?)")
    .run("B", "Beta", "Second to arrive.", "Hello from Beta.", t);
  db.query("INSERT INTO characters (id, name, description, first_message, created_at) VALUES (?,?,?,?,?)")
    .run("C", "Gamma", "Third to arrive.", "Hello from Gamma.", t);
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at, is_group) VALUES (?,?,?,?,?,1)")
    .run(CHAT, "A", "Group", t, t);
  db.query("INSERT INTO chat_members (id, chat_id, character_id, position) VALUES (?,?,?,0)").run("m1", CHAT, "A");
  db.query("INSERT INTO chat_members (id, chat_id, character_id, position) VALUES (?,?,?,1)").run("m2", CHAT, "B");
  db.query("INSERT INTO chat_members (id, chat_id, character_id, position) VALUES (?,?,?,2)").run("m3", CHAT, "C");
  // Scripted opening greetings, in cast order — exactly what /chats/group writes.
  const greet = db.query(
    "INSERT INTO messages (id, chat_id, role, name, content, created_at, swipes, swipe_index, character_id) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  greet.run("gA", CHAT, "assistant", "Alpha", "Hello from Alpha.", t, "[]", 0, "A");
  greet.run("gB", CHAT, "assistant", "Beta", "Hello from Beta.", t + 1, "[]", 0, "B");
  greet.run("gC", CHAT, "assistant", "Gamma", "Hello from Gamma.", t + 2, "[]", 0, "C");
  return db.query("SELECT * FROM chats WHERE id = ?").get(CHAT) as any;
}

const say = (role: string, name: string, id: string, t: number, characterId: string | null) =>
  db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at, character_id) VALUES (?,?,?,?,?,?,?)")
    .run(id, CHAT, role, name, "x", t, characterId);

// ---- turn order ---------------------------------------------------------

describe("nextSpeaker", () => {
  test("a fresh scene's greetings do not decide the first real turn", () => {
    const chat = seedGroup();
    // No user message yet: every candidate should tie fully and the random
    // tiebreak decides, not list position.
    const rolls = { A: 0.9, B: 0.1, C: 0.5 };
    const roll = (() => {
      const order = ["A", "B", "C"];
      let i = 0;
      return () => rolls[order[i++ % 3] as "A"];
    })();
    expect(nextSpeaker(chat, undefined, roll)?.id).toBe("B");
  });

  test("fewest total turns speaks, even over a longer scene", () => {
    const chat = seedGroup();
    const t = 2000;
    say("user", "", "u1", t, null);
    // Beta has answered three real turns; Alpha and Gamma have answered one.
    say("assistant", "Beta", "r1", t + 1, "B");
    say("assistant", "Beta", "r2", t + 2, "B");
    say("assistant", "Alpha", "r3", t + 3, "A");
    say("assistant", "Beta", "r4", t + 4, "B");
    say("assistant", "Gamma", "r5", t + 5, "C");
    const picked = nextSpeaker(chat)?.id;
    expect(picked).not.toBe("B");
    expect(["A", "C"]).toContain(picked);
  });

  test("an explicit choice always wins, quietest or not", () => {
    const chat = seedGroup();
    expect(nextSpeaker(chat, "A")?.id).toBe("A");
  });

  test("a muted member is never picked automatically", () => {
    const chat = seedGroup();
    db.query("UPDATE chat_members SET muted = 1 WHERE chat_id = ? AND character_id = ?").run(CHAT, "A");
    for (let i = 0; i < 8; i++) expect(nextSpeaker(chat)?.id).not.toBe("A");
  });

  test("a solo chat has nothing to decide", () => {
    wipe();
    db.query("INSERT INTO characters (id, name, created_at) VALUES (?,?,?)").run("A", "Alpha", 1);
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
      .run(CHAT, "A", "Solo", 1, 1);
    expect(nextSpeaker(db.query("SELECT * FROM chats WHERE id = ?").get(CHAT))?.id).toBe("A");
  });
});

// ---- assembling for a named speaker --------------------------------------

describe("assemble — a chosen speaker", () => {
  test("the ensemble note names everyone but the speaker", () => {
    const chat = seedGroup();
    const beta = membersOf(chat).find((m) => m.id === "B");
    const a = assemble(chat, "reply", "", "", beta);
    expect(a.system).toContain("You are Beta in an ongoing collaborative roleplay");
    expect(a.system).toContain("**Alpha**");
    expect(a.system).toContain("**Gamma**");
    expect(a.system).not.toContain("**Beta**");
  });

  test("a group scenario replaces each speaker's own scene line", () => {
    const chat = seedGroup();
    db.query("UPDATE characters SET scenario = ? WHERE id = ?").run("Alpha's own quiet study.", "A");
    db.query("UPDATE chats SET scenario = ? WHERE id = ?").run("A storm has trapped everyone in the hall.", CHAT);
    const alpha = membersOf(chat).find((m) => m.id === "A");
    const a = assemble(db.query("SELECT * FROM chats WHERE id = ?").get(CHAT), "reply", "", "", alpha);
    expect(a.system).toContain("# Scene\nA storm has trapped everyone in the hall.");
    expect(a.system).not.toContain("Alpha's own quiet study.");
    // The rest of the character is untouched — only the scene line is swapped.
    expect(a.system).toContain("# Alpha\nFirst to arrive.");
  });
});

// ---- continue and swipe keep their author --------------------------------

const WORDS = ["Re", "considered", " reply."];
function stubProvider() {
  globalThis.fetch = (() => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const w of WORDS) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`));
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as any;
}

const post = (path: string, body?: unknown) =>
  server.fetch(new Request(`http://hearth.test${path}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));

async function drain(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const events: any[] = [];
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (line.startsWith("data:")) events.push(JSON.parse(line.slice(5)));
    }
  }
  return events;
}

describe("swipe and continue keep the original speaker", () => {
  test("swipe never hands the line to whoever the algorithm would pick fresh", async () => {
    const chat = seedGroup();
    const t = 3000;
    say("user", "", "u1", t, null);
    // Stack turns on Alpha and Gamma so nextSpeaker, run fresh, would pick Beta.
    say("assistant", "Alpha", "r1", t + 1, "A");
    say("assistant", "Gamma", "r2", t + 2, "C");
    // The message under test: Alpha's line, the one being swiped.
    db.query(
      "INSERT INTO messages (id, chat_id, role, name, content, created_at, swipes, swipe_index, character_id) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("target", CHAT, "assistant", "Alpha", "Original line.", t + 3, JSON.stringify(["Original line."]), 0, "A");

    setSettings({ provider: "openrouter", key_openrouter: "sk-test", model: "test/model" });
    stubProvider();
    await drain(await post(`/api/chats/${chat.id}/generate`, { mode: "swipe" }));

    const row = db.query("SELECT * FROM messages WHERE id = ?").get("target") as any;
    expect(row.name).toBe("Alpha");
    expect(row.character_id).toBe("A");
    expect(row.content).toBe(WORDS.join(""));
  });

  test("continue keeps writing as whoever already held the floor", async () => {
    const chat = seedGroup();
    const t = 4000;
    say("user", "", "u1", t, null);
    say("assistant", "Gamma", "r1", t + 1, "C");
    say("assistant", "Beta", "r2", t + 2, "B");
    db.query(
      "INSERT INTO messages (id, chat_id, role, name, content, created_at, swipes, swipe_index, character_id) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("target2", CHAT, "assistant", "Gamma", "She began, ", t + 3, JSON.stringify(["She began, "]), 0, "C");

    setSettings({ provider: "openrouter", key_openrouter: "sk-test", model: "test/model" });
    stubProvider();
    await drain(await post(`/api/chats/${chat.id}/generate`, { mode: "continue" }));

    const row = db.query("SELECT * FROM messages WHERE id = ?").get("target2") as any;
    expect(row.content.startsWith("She began, ")).toBe(true);
    expect(row.content).not.toBe("She began, ");   // the continuation actually landed
  });
});

// ---- lorebooks in a group --------------------------------------------------

describe("lorebooks see every member, not just the founder", () => {
  const linkCharacter = (bookId: string, characterId: string) =>
    db.query("INSERT INTO lorebook_links (id, book_id, scope, target_id) VALUES (?,?,?,?)")
      .run(bookId + "-l", bookId, "character", characterId);

  test("a book linked to a non-founding member still fires", () => {
    const chat = seedGroup();   // A is the founder (chat.character_id)
    db.query("INSERT INTO lorebooks (id, name, entries, created_at) VALUES (?,?,?,?)")
      .run("book1", "Gamma's book", JSON.stringify([
        { constant: true, content: "Gamma keeps a knife in her boot.", enabled: true },
      ]), 1);
    linkCharacter("book1", "C");   // linked to Gamma, not to Alpha

    const a = assemble(chat, "reply", "");
    expect(a.lore).toHaveLength(1);
    expect(a.system).toContain("Gamma keeps a knife in her boot.");
  });

  test("a solo chat is unaffected — still just its own character's books", () => {
    wipe();
    db.query("INSERT INTO characters (id, name, created_at) VALUES (?,?,?)").run("A", "Alpha", 1);
    db.query("INSERT INTO characters (id, name, created_at) VALUES (?,?,?)").run("Z", "Unrelated", 1);
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
      .run(CHAT, "A", "Solo", 1, 1);
    db.query("INSERT INTO lorebooks (id, name, entries, created_at) VALUES (?,?,?,?)")
      .run("book2", "Unrelated's book", JSON.stringify([{ constant: true, content: "Should not fire.", enabled: true }]), 1);
    linkCharacter("book2", "Z");

    const a = assemble(db.query("SELECT * FROM chats WHERE id = ?").get(CHAT), "reply", "");
    expect(a.lore).toHaveLength(0);
  });
});

// ---- what the client is handed -------------------------------------------

describe("GET /chats/:id", () => {
  test("includes every member with their own avatar, in seat order", async () => {
    const chat = seedGroup();
    db.query("UPDATE characters SET avatar = ? WHERE id = ?").run("/uploads/beta.png", "B");
    const res = await server.fetch(new Request(`http://hearth.test/api/chats/${chat.id}`));
    const body = await res.json();
    expect(body.members.map((m: any) => m.name)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(body.members.find((m: any) => m.name === "Beta").avatar).toBe("/uploads/beta.png");
  });

  test("a solo chat still returns a one-member list", async () => {
    wipe();
    db.query("INSERT INTO characters (id, name, avatar, created_at) VALUES (?,?,?,?)")
      .run("A", "Alpha", "/uploads/a.png", 1);
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
      .run(CHAT, "A", "Solo", 1, 1);
    const res = await server.fetch(new Request(`http://hearth.test/api/chats/${CHAT}`));
    const body = await res.json();
    expect(body.members).toEqual([{ id: "A", name: "Alpha", avatar: "/uploads/a.png", muted: false, position: 0 }]);
  });
});

// ---- the inspector and the send must agree -------------------------------

/**
 * The bug these exist for: POST /inspect never worked out whose turn it was,
 * so `assemble` fell back to the chat's founder. In a group the panel showed
 * "You are <whoever was added first>" and that character's description, while
 * an actual send wrote somebody else — the one thing an inspector must never
 * do.
 */
describe("POST /chats/:id/inspect", () => {
  const inspect = async (chat: any, body: Record<string, unknown> = {}) => {
    const res = await server.fetch(new Request(`http://hearth.test/api/chats/${chat.id}/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "reply", content: "", ...body }),
    }));
    return res.json();
  };

  test("describes whoever a send would actually write", async () => {
    const chat = seedGroup();
    // Give Alpha and Gamma a turn each, leaving Beta the quietest — the same
    // reasoning nextSpeaker uses, so a send here would write Beta.
    const t = 5000;
    db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?,?,?,?,?)")
      .run("u1", chat.id, "user", "Anyone there?", t);
    db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at, character_id) VALUES (?,?,?,?,?,?,?)")
      .run("a1", chat.id, "assistant", "Alpha", "Alpha speaks.", t + 1, "A");
    db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at, character_id) VALUES (?,?,?,?,?,?,?)")
      .run("a2", chat.id, "assistant", "Gamma", "Gamma speaks.", t + 2, "C");

    const body = await inspect(chat);
    expect(body.speaker.name).toBe("Beta");
    const framing = body.sections.find((s: any) => s.label === "Framing");
    expect(framing.content).toContain("You are Beta");
  });

  test("an explicitly chosen speaker is the one described", async () => {
    const chat = seedGroup();
    const body = await inspect(chat, { speaker: "C" });
    expect(body.speaker.name).toBe("Gamma");
    const framing = body.sections.find((s: any) => s.label === "Framing");
    expect(framing.content).toContain("You are Gamma");
  });

  test("the character section is the speaker's, not the founder's", async () => {
    const chat = seedGroup();
    const body = await inspect(chat, { speaker: "B" });
    const character = body.sections.find((s: any) => s.label === "Character");
    expect(character.content).toContain("Second to arrive.");
    expect(character.content).not.toContain("# Alpha\nFirst to arrive.");
  });
});
