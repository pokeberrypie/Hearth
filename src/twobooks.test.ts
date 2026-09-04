/**
 * Two lorebooks attached at once.
 *
 * The bug this exists for: SillyTavern numbers entry ids from zero in every
 * book it exports, so two books attached to the same chat both claim "0", "1",
 * "2"… `activate()` keys its chosen set by entry id, so every entry in the
 * second book looked like one already taken from the first and silently never
 * fired. Running two books worked for exactly one of them, with no error.
 *
 *   bun test
 */

import { afterAll, expect, test } from "bun:test";

import { db, wipe } from "./test-support";

const { assemble } = await import("./index");
const { planBackup } = await import("./backup");

const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });

const CHAT = "tb1";

/** Both books number their entries from zero, exactly as ST exports them. */
function seedTwoBooks() {
  wipe();
  const t = 2000;
  db.query("INSERT INTO characters (id, name, description, created_at) VALUES (?,?,?,?)")
    .run("C1", "Sable", "A courier.", t);
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run(CHAT, "C1", "Chat", t, t);
  db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?,?,?,?,?)")
    .run("m1", CHAT, "user", "Tell me about the harbour and the bell.", t);

  const entry = (id: string, key: string, content: string) => ({
    id, keys: [key], secondary: [], logic: "and_any", content, comment: key,
    constant: false, enabled: true, order: 0, position: "before_char", depth: 0,
    probability: 100, caseSensitive: false, wholeWords: false, scanDepth: null,
    excludeRecursion: false, preventRecursion: false,
  });

  db.query("INSERT INTO lorebooks (id, name, entries, created_at) VALUES (?,?,?,?)")
    .run("bookA", "Harbour", JSON.stringify([entry("0", "harbour", "The harbour smells of tar.")]), t);
  db.query("INSERT INTO lorebooks (id, name, entries, created_at) VALUES (?,?,?,?)")
    .run("bookB", "Bells", JSON.stringify([entry("0", "bell", "The bell is cracked.")]), t);

  for (const book of ["bookA", "bookB"]) {
    db.query("INSERT INTO lorebook_links (id, book_id, scope, target_id) VALUES (?,?,?,?)")
      .run("l" + book, book, "global", null);
  }
}

test("both books fire when their entry ids collide", () => {
  seedTwoBooks();
  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(CHAT) as any;
  const a = assemble(chat, "reply", "");

  const fired = a.lore.map((l) => l.comment).sort();
  expect(fired).toEqual(["bell", "harbour"]);
  expect(a.system).toContain("The harbour smells of tar.");
  expect(a.system).toContain("The bell is cracked.");
});

test("an entry is still taken only once within its own book", () => {
  seedTwoBooks();
  // Same key twice in one book, same id: still one entry, not two.
  db.query("UPDATE lorebooks SET entries = ? WHERE id = ?").run(
    JSON.stringify([
      { id: "0", keys: ["harbour"], secondary: [], logic: "and_any", content: "First.",
        comment: "first", constant: false, enabled: true, order: 0, position: "before_char",
        depth: 0, probability: 100, caseSensitive: false, wholeWords: false, scanDepth: null,
        excludeRecursion: false, preventRecursion: false },
      { id: "0", keys: ["harbour"], secondary: [], logic: "and_any", content: "Second.",
        comment: "second", constant: false, enabled: true, order: 0, position: "before_char",
        depth: 0, probability: 100, caseSensitive: false, wholeWords: false, scanDepth: null,
        excludeRecursion: false, preventRecursion: false },
    ]),
    "bookA",
  );
  db.query("DELETE FROM lorebook_links WHERE book_id = ?").run("bookB");

  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(CHAT) as any;
  const a = assemble(chat, "reply", "");
  expect(a.lore).toHaveLength(1);
});

// ---- regex scripts, through a real assembly -------------------------------

/**
 * The half of the feature that pays for itself: a preset's "remove older
 * <status> from context" script means a long scene stops resending every state
 * block it has ever produced. It must reach the prompt, and it must not reach
 * the stored rows.
 */
function seedWithScript(script: Record<string, unknown>) {
  wipe();
  db.query("DELETE FROM regex_scripts").run();
  const t = 3000;
  db.query("INSERT INTO characters (id, name, description, created_at) VALUES (?,?,?,?)")
    .run("C1", "Sable", "A courier.", t);
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run("rx1", "C1", "Chat", t, t);
  // Ten turns, every assistant one carrying a status block.
  for (let i = 0; i < 10; i++) {
    db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?,?,?,?,?)")
      .run(`u${i}`, "rx1", "user", `turn ${i}`, t + i * 2);
    db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at, character_id) VALUES (?,?,?,?,?,?,?)")
      .run(`a${i}`, "rx1", "assistant", "Sable", `reply ${i} <status>bulk ${i}</status>`, t + i * 2 + 1, "C1");
  }
  db.query("INSERT INTO regex_scripts (id, name, script, enabled, source, position, created_at) VALUES (?,?,?,?,?,?,?)")
    .run("rx-a", "strip status", JSON.stringify(script), 1, "test", 0, t);
  return db.query("SELECT * FROM chats WHERE id = ?").get("rx1") as any;
}

const STRIP_OLD_STATUS = {
  scriptName: "strip status",
  findRegex: "/<status\\b[^>]*>[\\s\\S]*?<\\/status>\\s*/gi",
  replaceString: "",
  placement: [2],
  promptOnly: true,
  markdownOnly: false,
  minDepth: 6,
};

test("a prompt-side script strips old turns and spares recent ones", () => {
  const chat = seedWithScript(STRIP_OLD_STATUS);
  const a = assemble(chat, "reply", "");
  const convo = a.messages.map((m) => m.content).join("\n");
  // The newest few keep their block; everything past the depth floor loses it.
  expect(convo).toContain("<status>bulk 9</status>");
  expect(convo).not.toContain("<status>bulk 0</status>");
  expect(convo).not.toContain("<status>bulk 1</status>");
});

test("the stored messages are left exactly as written", () => {
  const chat = seedWithScript(STRIP_OLD_STATUS);
  assemble(chat, "reply", "");
  const row = db.query("SELECT content FROM messages WHERE id = ?").get("a0") as any;
  expect(row.content).toBe("reply 0 <status>bulk 0</status>");
});

test("a display-only script never reaches the prompt", () => {
  const chat = seedWithScript({ ...STRIP_OLD_STATUS, promptOnly: false, markdownOnly: true });
  const a = assemble(chat, "reply", "");
  expect(a.messages.map((m) => m.content).join("\n")).toContain("<status>bulk 0</status>");
});

test("a switched-off script does nothing", () => {
  const chat = seedWithScript(STRIP_OLD_STATUS);
  db.query("UPDATE regex_scripts SET enabled = 0").run();
  const a = assemble(chat, "reply", "");
  expect(a.messages.map((m) => m.content).join("\n")).toContain("<status>bulk 0</status>");
});

// ---- settings.json is not unique in a backup ------------------------------

/**
 * The bug this exists for: a SillyTavern install carries several files called
 * settings.json — .vscode's, the default content's, an extension's, and the
 * user's. Only the user's has personas, and planBackup took whichever it
 * happened to walk last, so a real backup imported no personas at all.
 */
test("the settings.json with personas in it is the one that counts", () => {
  const entry = (path: string, body: unknown) =>
    ({ path, read: () => new TextEncoder().encode(JSON.stringify(body)) });

  const plan = planBackup([
    entry(".vscode/settings.json", { "js/ts.tsdk": true }),
    entry("data/default-user/settings.json", {
      power_user: {
        personas: { "a.png": "Iva Grant", "b.png": "Wren Carrow" },
        persona_descriptions: { "a.png": { description: "A courier." } },
      },
      user_avatar: "a.png",
    }),
    // Walked last, and carries none — this is the one that used to win.
    entry("default/content/settings.json", { firstRun: true }),
  ]);

  expect(plan.personas.map((p) => p.name).sort()).toEqual(["Iva Grant", "Wren Carrow"]);
  expect(plan.personas.find((p) => p.name === "Iva Grant")?.active).toBe(true);
});
