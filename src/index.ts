import { Hono } from "hono";
import { writeFile } from "./fsx";
import { db, uid, now, getSettings, setSettings, KEY_FIELDS } from "./db";
import { generate, PROVIDERS } from "./providers";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildParts, buildMessages, buildPostHistory, macros, stripSpeakerLabel, type Character } from "./prompt";
import { entryFromNote, freshCount, isDue, messagesForNote, notePrompt, parseNote, NOTE_SYSTEM, type Scope } from "./autolore";
import { normaliseExtension, runServerHook, type Extension } from "./extensions";
import { archiveUrls, buildFromRepo, parseRepo, type RepoFile } from "./extinstall";
import { DICE_BRIEF, describeRoll, resolveRolls, rollDice } from "./dice";
import { ABILITY_NAMES, CHECK_BRIEF, CLASSES, abilityAsked, abilityCheck, describeCheck, makeSheet, modifier,
         normaliseSheet, resolveChecks, sheetForPrompt, type Ability, type Sheet } from "./tabletop";
import { FIGHT_BRIEF, describeInitiative, fightForPrompt, foesDown, hurt, normaliseFight, takeTurn,
         startFight, stateOf, type Fight } from "./fight";
import { VERB_BRIEF, resolveVerbs, type Intent } from "./verbs";
import { STARTER, libraryIsEmpty, narratorMissing } from "./starter";
import { unzipSync } from "fflate";
import { readCard, writeCardPng, toCard } from "./cards";
import { listModels } from "./models";
import { readZip, planBackup, eachZipEntry, type Entry } from "./backup";
import { listDir, inspect, collect, places, isWanted } from "./localfs";
import { normaliseBook, normaliseEntry, activate, place, type LoreEntry } from "./lore";
import { PRESET_FIELDS, DEFAULT_BLOCKS, fromSillyTavern, normaliseBlocks, type PromptBlock } from "./presets";
import { TABLE_PRESET, tablePresetOn } from "./tablepreset";
import { WRITE_SYSTEM, looksWritten, parseWritten, writePrompt } from "./campaignwrite";
import { CAMPAIGNS, campaignById, campaignForPrompt, dreamCampaign, normaliseCampaign, openingBrief,
         type Campaign } from "./campaigns";
import { PLACEMENT, applyScripts, normaliseScript, type RegexScript } from "./regex";

const DATA = process.env.DATA_DIR ?? "./data";
const UPLOADS = join(DATA, "uploads");
const WALLS = join(DATA, "uploads", "wallpapers");
mkdirSync(UPLOADS, { recursive: true });
mkdirSync(WALLS, { recursive: true });

const app = new Hono();
const api = new Hono();

// ---- settings -------------------------------------------------------------

api.get("/settings", (c) => {
  const s = { ...getSettings() };
  for (const f of KEY_FIELDS) s[f] = s[f] ? "__saved__" : "";
  /**
   * What sampling will actually use, and where it came from. An active preset
   * overrides these fields, so a Sampling panel showing only the stored
   * settings was describing values the model never saw.
   */
  const activePreset = db
    .query("SELECT id, name FROM presets WHERE is_active = 1 AND deleted_at IS NULL LIMIT 1")
    .get() as { id: string; name: string } | undefined;
  const eff = withPreset(getSettings());
  return c.json({
    ...s,
    preset: activePreset
      ? {
          id: activePreset.id,
          name: activePreset.name,
          sampling: Object.fromEntries(PRESET_FIELDS.map((f) => [f, eff[f] ?? ""])),
        }
      : null,
    providers: Object.fromEntries(
      Object.entries(PROVIDERS).map(([k, v]) => [k, { label: v.label, keyUrl: v.keyUrl }]),
    ),
  });
});

api.put("/settings", async (c) => {
  const body = await c.req.json();
  // The placeholder means "leave the stored key alone".
  for (const f of KEY_FIELDS) {
    if (body[f] === "__saved__" || body[f] === undefined) delete body[f];
    else body[f] = String(body[f]).trim();
  }
  delete body.providers;
  setSettings(body);
  return c.json({ ok: true });
});

/** Fires one tiny generation so key and model problems surface before a roleplay does. */
api.post("/test", async (c) => {
  const s = getSettings();
  try {
    let got = "";
    for await (const d of generate({
      provider: s.provider,
      apiKey: s[`key_${s.provider}`] ?? "",
      model: s.model,
      system: "Reply with the single word: ready",
      messages: [{ role: "user", content: "ping" }],
      // A connection test wants the shortest possible round trip, so it never
      // streams and never asks a reasoning model to think first.
      sampling: { temperature: 0, maxTokens: 16, topP: 1, minP: 0,
                  repetitionPenalty: 1, frequencyPenalty: 0, presencePenalty: 0,
                  stream: false, reasoningEffort: "off" },
    })) {
      if (d.kind !== "text") continue;
      got += d.text;
      if (got.length > 40) break;
    }
    return c.json({ ok: true, message: `${s.model} answered: ${got.trim() || "(empty)"}` });
  } catch (e: any) {
    return c.json({ ok: false, message: e?.message ?? "Test failed." });
  }
});

// ---- characters -----------------------------------------------------------

/* ---- the two libraries ------------------------------------------------------
   Tabletop is meant to be a different room, not the same room with dice in it.
   Somebody with seven hundred hand-made characters who walks through the door
   and finds all seven hundred standing there has not gone anywhere.

   So a character lives in a world — 'story', 'tabletop', or 'both' — and every
   list is filtered by whichever side of the door you are on. Nothing is copied
   and nothing is moved without being asked: bringing a character to the table
   makes them 'both', so the chats you already have with them go on working
   exactly as they did. */

/** Which world's characters the current mode should see. */
export const currentWorld = () => (getSettings().mode === "tabletop" ? "tabletop" : "story");

/**
 * The SQL for it, as a fragment, since five different queries need the same
 * rule and a rule written out five times is a rule that will disagree with
 * itself by the end of the year.
 */
const worldWhere = (table = "characters") =>
  `(${table}.world = '${currentWorld()}' OR ${table}.world = 'both')`;

api.get("/characters", (c) =>
  c.json(db.query(
    `SELECT * FROM characters WHERE deleted_at IS NULL AND ${worldWhere()}
     ORDER BY name COLLATE NOCASE`,
  ).all()),
);

/**
 * Bringing somebody to the table, or sending them home.
 *
 * Coming over is additive: a character you play with in a story is still
 * there tomorrow, in that story, with every chat intact. Going back is not
 * additive, because there is nowhere else for them to be — a character has to
 * live somewhere, so leaving the table means going into the library.
 */
api.put("/characters/:id/world", async (c) => {
  const id = c.req.param("id");
  const row = db.query("SELECT world FROM characters WHERE id = ?").get(id) as any;
  if (!row) return c.json({ error: "No such character." }, 404);
  const { at } = await c.req.json().catch(() => ({}));
  const here = currentWorld();

  let world: string;
  if (at) world = row.world === "both" || row.world === here ? row.world : "both";
  else world = here === "tabletop" ? "story" : "tabletop";

  db.query("UPDATE characters SET world = ? WHERE id = ?").run(world, id);
  return c.json({ world });
});

/**
 * Everyone who is not in this room, for the picker that brings them into it.
 */
api.get("/cast/elsewhere", (c) =>
  c.json(db.query(
    `SELECT id, name, avatar, description FROM characters
     WHERE deleted_at IS NULL AND NOT ${worldWhere()}
     ORDER BY name COLLATE NOCASE`,
  ).all()),
);

api.post("/characters", async (c) => {
  const b = await c.req.json();
  if (!b.name?.trim()) return c.json({ error: "A character needs a name." }, 400);
  const id = uid();
  db.query(
    `INSERT INTO characters (id, name, description, personality, scenario, first_message, avatar, created_at, world)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    b.name.trim(),
    b.description ?? "",
    b.personality ?? "",
    b.scenario ?? "",
    b.first_message ?? "",
    b.avatar ?? null,
    now(),
    // Written wherever you are standing: a character made at the table is the
    // table's, and does not turn up in a library of seven hundred others.
    currentWorld(),
  );
  return c.json(db.query("SELECT * FROM characters WHERE id = ?").get(id));
});

api.put("/characters/:id", async (c) => {
  const b = await c.req.json();
  db.query(
    `UPDATE characters SET name=?, description=?, personality=?, scenario=?, first_message=? WHERE id=?`,
  ).run(
    b.name,
    b.description ?? "",
    b.personality ?? "",
    b.scenario ?? "",
    b.first_message ?? "",
    c.req.param("id"),
  );
  return c.json({ ok: true });
});

api.delete("/characters/:id", (c) => softDelete("characters", [c.req.param("id")]));

api.post("/characters/:id/default-persona", async (c) => {
  const { persona_id } = await c.req.json();
  db.query("UPDATE characters SET default_persona_id = ? WHERE id = ?")
    .run(persona_id || null, c.req.param("id"));
  return c.json({ ok: true });
});

// ---- chats ----------------------------------------------------------------

api.get("/chats", (c) =>
  c.json(
    db
      .query(
        `SELECT chats.*, characters.name AS character_name, characters.avatar,
                (SELECT COUNT(*) FROM messages WHERE messages.chat_id = chats.id) AS turns,
                (SELECT content FROM messages WHERE messages.chat_id = chats.id
                  ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_message,
                (SELECT role FROM messages WHERE messages.chat_id = chats.id
                  ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_role
         FROM chats JOIN characters ON characters.id = chats.character_id
         WHERE chats.deleted_at IS NULL AND characters.deleted_at IS NULL
           AND ${worldWhere()}
         ORDER BY chats.updated_at DESC`,
      )
      .all(),
  ),
);

api.post("/chats", async (c) => {
  const { character_id } = await c.req.json();
  const char = db.query("SELECT * FROM characters WHERE id = ?").get(character_id) as
    | Character
    | undefined;
  if (!char) return c.json({ error: "That character no longer exists." }, 404);

  const id = uid();
  const t = now();
  const owner = db.query("SELECT default_persona_id FROM characters WHERE id = ?").get(character_id) as any;
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at, persona_id) VALUES (?,?,?,?,?,?)")
    .run(id, character_id, char.name, t, t, owner?.default_persona_id ?? null);

  if (char.first_message.trim()) {
    const persona = whoAmI(owner?.default_persona_id).name;
    // Alternate greetings ride along as swipes, so they are reachable.
    let alts: string[] = [];
    try { alts = JSON.parse((char as any).alternate_greetings ?? "[]"); } catch {}
    const all = [char.first_message, ...alts.filter((a) => typeof a === "string" && a.trim())]
      .map((g) => macros(g, char.name, persona));

    db.query(
      "INSERT INTO messages (id, chat_id, role, name, content, created_at, swipes, swipe_index) VALUES (?,?,?,?,?,?,?,?)",
    ).run(uid(), id, "assistant", char.name, all[0], t, JSON.stringify(all), 0);
  }
  return c.json({ id });
});

api.get("/chats/:id", (c) => {
  const chat = db
    .query(
      `SELECT chats.*, characters.name AS character_name, characters.avatar,
              (SELECT title FROM chats AS p WHERE p.id = chats.parent_chat_id) AS parent_title
       FROM chats JOIN characters ON characters.id = chats.character_id WHERE chats.id = ?`,
    )
    .get(c.req.param("id"));
  if (!chat) return c.json({ error: "Chat not found." }, 404);
  const messages = db
    .query("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at, rowid")
    .all(c.req.param("id"));
  // Sent alongside the chat so the client can paint every message with its
  // own speaker's face on the first render, before any second request lands.
  const members = membersOf(chat as any).map((m) => ({
    id: m.id, name: m.name, avatar: m.avatar, muted: !!m.muted, position: m.position,
  }));
  return c.json({ chat, messages, members });
});

api.delete("/chats/:id", (c) => softDelete("chats", [c.req.param("id")]));

api.put("/chats/:id", async (c) => {
  const b = await c.req.json();
  const cur = db.query("SELECT * FROM chats WHERE id = ?").get(c.req.param("id")) as any;
  if (!cur) return c.json({ error: "Chat not found." }, 404);
  db.query(
    "UPDATE chats SET title = ?, author_note = ?, note_depth = ?, wallpaper = ?, persona_id = ?, scenario = ? WHERE id = ?",
  ).run(
    (b.title ?? cur.title).trim() || cur.title,
    b.author_note ?? cur.author_note,
    Number.isFinite(+b.note_depth) ? Math.max(0, Math.min(20, +b.note_depth)) : cur.note_depth,
    b.wallpaper !== undefined ? String(b.wallpaper) : cur.wallpaper,
    b.persona_id !== undefined ? (b.persona_id || null) : cur.persona_id,
    b.scenario !== undefined ? String(b.scenario) : cur.scenario,
    cur.id,
  );
  return c.json({ ok: true });
});

api.get("/chats/:id/export", (c) => {
  const chat = db
    .query(`SELECT chats.*, characters.name AS character_name FROM chats
            JOIN characters ON characters.id = chats.character_id WHERE chats.id = ?`)
    .get(c.req.param("id")) as any;
  if (!chat) return c.json({ error: "Chat not found." }, 404);
  const messages = db
    .query("SELECT role, name, content, created_at, swipes, swipe_index, reasoning FROM messages WHERE chat_id = ? ORDER BY created_at, rowid")
    .all(chat.id);

  const safe = (chat.title || chat.character_name).replace(/[^\w.-]+/g, "_");

  /*
   * Two formats, for two different purposes.
   *
   * JSON is the one that comes back: every swipe, the reasoning, the
   * timestamps — everything import needs to rebuild the chat exactly. Text is
   * the one you can read, send to somebody, or paste anywhere: just who said
   * what, in order. Neither is a worse version of the other, so both are
   * offered rather than one being converted into the other later.
   */
  if (c.req.query("format") === "txt") {
    const when = new Date(chat.created_at).toISOString().slice(0, 10);
    const lines = [
      chat.title || chat.character_name,
      `${(messages as any[]).length} messages, begun ${when}`,
      "",
      "",
    ];
    for (const m of messages as any[]) {
      const who = m.role === "user" ? "You" : (m.name?.trim() || chat.character_name);
      lines.push(`${who}:`, String(m.content ?? "").trim(), "");
    }
    return new Response(lines.join("\n"), {
      headers: {
        // charset, because a roleplay is full of em dashes and smart quotes and
        // Notepad will otherwise render them as mojibake.
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${safe}.txt"`,
      },
    });
  }

  return new Response(JSON.stringify({ hearth: 1, chat, messages }, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${safe}.json"`,
    },
  });
});

/** Accepts a Hearth export or a SillyTavern .jsonl. */
api.post("/chats/import", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  const characterId = String(form.get("character_id") ?? "");
  if (!(file instanceof File)) return c.json({ error: "No file received." }, 400);

  const char = db.query("SELECT * FROM characters WHERE id = ?").get(characterId) as any;
  if (!char) return c.json({ error: "Pick a character to import into." }, 400);

  const text = await file.text();
  let title = file.name.replace(/\.(json|jsonl)$/i, "");
  let rows: any[] = [];

  try {
    if (/\.jsonl$/i.test(file.name)) {
      rows = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
    } else {
      const j = JSON.parse(text);
      rows = j.messages ?? [];
      title = j.chat?.title ?? title;
    }
  } catch {
    return c.json({ error: "That file could not be read." }, 400);
  }

  const chatId = uid();
  const t = now();
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run(chatId, characterId, title, t, t);

  const ins = db.query(
    "INSERT INTO messages (id, chat_id, role, name, content, created_at, swipes, swipe_index) VALUES (?,?,?,?,?,?,?,?)",
  );
  let n = 0;
  db.transaction(() => {
    for (const r of rows) {
      const content = r.content ?? r.mes;
      if (content === undefined) continue;                    // ST metadata line
      const isUser = r.role ? r.role === "user" : r.is_user === true;
      ins.run(uid(), chatId, isUser ? "user" : "assistant", r.name ?? "", String(content), t + n,
        typeof r.swipes === "string" ? r.swipes
          : JSON.stringify(Array.isArray(r.swipes) ? r.swipes : [String(content)]),
        Number(r.swipe_index ?? r.swipe_id ?? 0));
      n++;
    }
  })();

  if (!n) {
    db.query("DELETE FROM chats WHERE id = ?").run(chatId);
    return c.json({ error: "No messages found in that file." }, 400);
  }
  return c.json({ id: chatId, imported: n, title });
});

/**
 * Whether the past is allowed to be changed.
 *
 * Off at the table by default. Rewriting a line after seeing how it went is
 * the plainest cheat there is, and the reason to close it is not suspicion —
 * it is that a game where the bad outcome can be quietly deleted stops being
 * a game you can lose, which is the only thing that made winning worth
 * anything. Nobody sets out to cheat; they reach for the pencil at two in the
 * morning after a wolf ate their rogue.
 *
 * Deleting is closed with editing rather than separately, because they are the
 * same hole: a line you can remove is a line you can rewrite in two steps.
 *
 * Not a security boundary and not meant as one — it is your database and a
 * text editor will always win. It removes the temptation, not the ability.
 */
export function editsLocked(): boolean {
  const s = getSettings();
  return s.mode === "tabletop" && s.tabletop_edits !== "1";
}

const LOCKED = { error: "This table does not rewrite what happened." } as const;

/** Messages have no bin — they are cheap and numerous, so removal is direct. */
api.post("/messages/delete", async (c) => {
  if (editsLocked()) return c.json(LOCKED, 403);
  const { ids } = await c.req.json();
  if (!Array.isArray(ids) || !ids.length) return c.json({ error: "Nothing selected." }, 400);
  const stmt = db.query("DELETE FROM messages WHERE id = ?");
  db.transaction((list: string[]) => { for (const id of list) stmt.run(id); })(ids);
  return c.json({ deleted: ids.length });
});

api.delete("/messages/:id", (c) => {
  if (editsLocked()) return c.json(LOCKED, 403);
  db.query("DELETE FROM messages WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

// ---- group chats ----------------------------------------------------------

/** Everyone in a chat, in speaking order. Solo chats answer with one row. */
export function membersOf(chat: any): any[] {
  const rows = db
    .query(`SELECT chat_members.id AS member_id, chat_members.position, chat_members.muted,
                   characters.*
              FROM chat_members JOIN characters ON characters.id = chat_members.character_id
             WHERE chat_members.chat_id = ? AND characters.deleted_at IS NULL
             ORDER BY chat_members.position, characters.name COLLATE NOCASE`)
    .all(chat.id) as any[];
  if (rows.length) return rows;
  const solo = db.query("SELECT * FROM characters WHERE id = ?").get(chat.character_id) as any;
  return solo ? [{ ...solo, member_id: null, position: 0, muted: 0 }] : [];
}

/**
 * Whose turn it is. An explicit choice wins. Otherwise: fewest total replies
 * speaks, so nobody dominates a long scene; ties go to whoever has gone
 * longest without speaking; a full tie — a brand new group, where everyone's
 * only turn so far is their opening greeting at the same instant — is broken
 * at random rather than by list position, so a fresh scene does not always
 * open with the same character. Muted members are skipped entirely.
 */
export function nextSpeaker(chat: any, wanted?: string, roll: () => number = Math.random): any | undefined {
  const cast = membersOf(chat).filter((m) => !m.muted);
  if (!cast.length) return undefined;
  if (wanted) return cast.find((m) => m.id === wanted) ?? cast[0];
  if (cast.length === 1) return cast[0];

  // Opening greetings are scripted, not a turn anyone took — counting them
  // would make whoever greeted first always look "quietest" for the very
  // first real reply. Only conversation from the first user message onward
  // counts; before that, everyone ties and the random tiebreak decides.
  const firstUser = db
    .query("SELECT MIN(created_at) AS t FROM messages WHERE chat_id = ? AND role = 'user'")
    .get(chat.id) as { t: number | null };
  const since = firstUser?.t ?? Infinity;

  const recent = db
    .query("SELECT character_id FROM messages WHERE chat_id = ? AND role = 'assistant' AND created_at >= ? ORDER BY created_at DESC, rowid DESC LIMIT 200")
    .all(chat.id, since) as { character_id: string | null }[];
  const counts = new Map<string, number>();
  const lastSpoke = new Map<string, number>();
  recent.forEach((r, i) => {
    if (!r.character_id) return;
    counts.set(r.character_id, (counts.get(r.character_id) ?? 0) + 1);
    if (!lastSpoke.has(r.character_id)) lastSpoke.set(r.character_id, i);
  });

  const scored = cast.map((m) => ({
    m,
    turns: counts.get(m.id) ?? 0,
    since: lastSpoke.get(m.id) ?? Infinity,
    r: roll(),
  }));
  scored.sort((a, b) => a.turns - b.turns || b.since - a.since || a.r - b.r);
  return scored[0].m;
}

api.post("/chats/group", async (c) => {
  const { character_ids, title, scenario } = await c.req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(character_ids) ? character_ids.filter(Boolean) : [];
  if (ids.length < 2) return c.json({ error: "A group needs at least two characters." }, 400);

  const cast = ids
    .map((id) => db.query("SELECT * FROM characters WHERE id = ? AND deleted_at IS NULL").get(id))
    .filter(Boolean) as any[];
  if (cast.length < 2) return c.json({ error: "Those characters no longer exist." }, 400);

  const id = uid();
  const t = now();
  const owner = db.query("SELECT default_persona_id FROM characters WHERE id = ?").get(cast[0].id) as any;
  db.query(
    `INSERT INTO chats (id, character_id, title, created_at, updated_at, persona_id, is_group, scenario)
     VALUES (?,?,?,?,?,?,1,?)`,
  ).run(id, cast[0].id, (title ?? "").trim() || cast.map((x) => x.name).join(", "), t, t,
        owner?.default_persona_id ?? null, String(scenario ?? "").trim());

  const ins = db.query("INSERT INTO chat_members (id, chat_id, character_id, position) VALUES (?,?,?,?)");
  db.transaction(() => { cast.forEach((x, i) => ins.run(uid(), id, x.id, i)); })();

  // Everyone's greeting, in order, so the scene opens with the room already full.
  const persona = whoAmI(owner?.default_persona_id ?? null).name;
  const greet = db.query(
    "INSERT INTO messages (id, chat_id, role, name, content, created_at, swipes, swipe_index, character_id) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  let n = 0;
  db.transaction(() => {
    for (const x of cast) {
      if (!x.first_message?.trim()) continue;
      const body = macros(x.first_message, x.name, persona);
      greet.run(uid(), id, "assistant", x.name, body, t + n++, JSON.stringify([body]), 0, x.id);
    }
  })();
  return c.json({ id });
});

api.get("/chats/:id/members", (c) => {
  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(c.req.param("id")) as any;
  if (!chat) return c.json({ error: "Chat not found." }, 404);
  return c.json(membersOf(chat).map((m) => ({
    id: m.id, name: m.name, avatar: m.avatar, muted: !!m.muted, position: m.position,
  })));
});

/** Add, remove, mute or reorder. One route, because they are one edit. */
api.post("/chats/:id/members", async (c) => {
  const chatId = c.req.param("id");
  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(chatId) as any;
  if (!chat) return c.json({ error: "Chat not found." }, 404);
  const { add, remove, mute, order } = await c.req.json().catch(() => ({}));

  // A solo chat becomes a group the moment a second character is written down,
  // so seed the row for whoever it started with.
  const seeded = (db.query("SELECT COUNT(*) AS n FROM chat_members WHERE chat_id = ?").get(chatId) as any).n > 0;
  if (!seeded) {
    db.query("INSERT INTO chat_members (id, chat_id, character_id, position) VALUES (?,?,?,0)")
      .run(uid(), chatId, chat.character_id);
  }

  if (add) {
    const exists = db.query("SELECT id FROM chat_members WHERE chat_id = ? AND character_id = ?").get(chatId, add);
    if (!exists) {
      const next = (db.query("SELECT ifnull(MAX(position), -1) AS p FROM chat_members WHERE chat_id = ?").get(chatId) as any).p + 1;
      db.query("INSERT INTO chat_members (id, chat_id, character_id, position) VALUES (?,?,?,?)")
        .run(uid(), chatId, add, next);
    }
  }
  if (remove) db.query("DELETE FROM chat_members WHERE chat_id = ? AND character_id = ?").run(chatId, remove);
  if (mute) {
    db.query("UPDATE chat_members SET muted = ? WHERE chat_id = ? AND character_id = ?")
      .run(mute.on ? 1 : 0, chatId, mute.id);
  }
  if (Array.isArray(order)) {
    const up = db.query("UPDATE chat_members SET position = ? WHERE chat_id = ? AND character_id = ?");
    db.transaction(() => { order.forEach((cid: string, i: number) => up.run(i, chatId, cid)); })();
  }

  const left = membersOf(chat);
  // A group emptied back down to one is a solo chat again.
  db.query("UPDATE chats SET is_group = ?, character_id = ? WHERE id = ?")
    .run(left.length > 1 ? 1 : 0, left[0]?.id ?? chat.character_id, chatId);
  return c.json({ members: left.length });
});

api.post("/chats/:id/auto", async (c) => {
  const { on } = await c.req.json().catch(() => ({}));
  db.query("UPDATE chats SET auto_reply = ? WHERE id = ?").run(on ? 1 : 0, c.req.param("id"));
  return c.json({ ok: true });
});

// ---- generation -----------------------------------------------------------

const EFFORTS = ["off", "minimal", "low", "medium", "high"] as const;

function sampling(s: Record<string, string>) {
  const effort = String(s.reasoning_effort ?? "");
  return {
    temperature: Number(s.temperature),
    maxTokens: Number(s.max_tokens),
    topP: Number(s.top_p),
    minP: Number(s.min_p),
    repetitionPenalty: Number(s.repetition_penalty),
    frequencyPenalty: Number(s.frequency_penalty),
    presencePenalty: Number(s.presence_penalty),
    // Anything unrecognised means "say nothing and let the model decide".
    stream: s.stream !== "0",
    reasoningEffort: ((EFFORTS as readonly string[]).includes(effort)
      ? effort
      : "") as "" | (typeof EFFORTS)[number],
  };
}

/**
 * Generations in flight, keyed by chat. Stopping one has to reach the provider
 * call, not just the browser's fetch, or the completion is paid for in full and
 * saved after you thought you had cancelled it.
 */
const running = new Map<string, AbortController>();

api.post("/chats/:id/stop", (c) => {
  const ac = running.get(c.req.param("id"));
  ac?.abort();
  return c.json({ stopped: !!ac });
});

/**
 * Whether a reply is still being written for this chat.
 *
 * A phone that has been swiped away from comes back with no idea whether the
 * turn it left mid-flight has landed yet. This lets it wait rather than
 * guess.
 */
api.get("/chats/:id/running", (c) =>
  c.json({ running: running.has(c.req.param("id")) }));

/**
 * mode "reply"       — the character answers
 * mode "silent"      — you say nothing and the scene carries on without you
 * mode "continue"    — extend the last character message in place
 * mode "swipe"       — another take on the last reply
 * mode "impersonate" — write the user's next turn for them
 *
 * Everything the model sees comes from assemble(), the same call the inspector
 * uses. Do not rebuild any of it here: an inspector that can disagree with the
 * real prompt is worse than no inspector at all.
 */
api.post("/chats/:id/generate", async (c) => {
  const chatId = c.req.param("id");
  const { content = "", mode = "reply", guide = "", speaker: speakerId = "" } =
    await c.req.json().catch(() => ({}));

  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(chatId) as any;
  if (!chat) return c.json({ error: "Chat not found." }, 404);
  if (!membersOf(chat).length) return c.json({ error: "That character no longer exists." }, 404);

  // Continue and swipe both work on the last reply. Check it is there before
  // anything gets written down.
  const last = db
    .query("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(chatId) as any;
  if ((mode === "continue" || mode === "swipe") && last?.role !== "assistant") {
    return c.json({ error: `There is no reply to ${mode}.` }, 400);
  }
  const swipeTarget = mode === "swipe" ? last : null;
  const continuingId: string | null = mode === "continue" ? last.id : null;

  /*
   * At a table, you do not get to roll the world back.
   *
   * Swiping is the right of a story chat: a reply you did not like is a draft,
   * and there is no cost to asking for another. A game is not that. Half of
   * what makes a fight matter is that the bad outcome stands, and unlimited
   * rerolls quietly turn every roll into "keep going until it goes well" —
   * which is the same thing as not rolling.
   *
   * A few are still allowed, and zero is a choice rather than the default,
   * because the honest reason to swipe at a table is a provider that returned
   * garbage, and being unable to fix that would be its own kind of cruelty.
   */
  if (mode === "swipe" && getSettings().mode === "tabletop") {
    const allowance = swipeAllowance();
    const taken = Math.max(1, JSON.parse(swipeTarget?.swipes || "[]").length || 1) - 1;
    if (taken >= allowance) {
      return c.json({
        error: allowance === 0
          ? "This table does not take swipes. What happened, happened."
          : `That is all ${allowance} swipe${allowance === 1 ? "" : "s"} this table allows.`,
      }, 400);
    }
  }

  const t = now();
  let userMessageId: string | null = null;
  if (mode === "reply" && content.trim()) {
    userMessageId = uid();
    db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at, tokens) VALUES (?,?,?,?,?,?,?)")
      .run(userMessageId, chatId, "user", "", content.trim(), t, Math.round(content.trim().length / 4));
  }
  db.query("UPDATE chats SET updated_at = ? WHERE id = ?").run(t, chatId);

  /**
   * Whose turn it is. Continue and swipe extend a line that already has an
   * author — recalculating would risk finishing one character's sentence, or
   * rerolling it, in a different character's voice. Reply and silent ask the
   * room: the client may name someone, otherwise the quietest speaks.
   */
  const cast = membersOf(chat);
  let speaker: any;
  if (mode === "continue" || mode === "swipe") {
    speaker = cast.find((m) => m.id === last?.character_id) ?? cast.find((m) => m.name === last?.name);
  }
  if (!speaker && mode !== "impersonate") speaker = nextSpeaker(chat, speakerId);

  // The turn is already in the database, so nothing is staged here.
  const a = assemble(chat, mode, guide, "", speaker);
  const s = getSettings();

  /*
   * Extensions get the prompt before the provider does.
   *
   * Read once here rather than per hook: an extension enabled halfway through
   * a reply should not start applying to the tail of it, and a chat should
   * behave the same for its whole turn.
   */
  const extensions = liveExtensions();
  const shaped = runServerHook(
    extensions,
    "prompt:before",
    { system: a.system, messages: a.messages },
    (where, err) => console.error(`[extension] ${where}`, err ?? ""),
  );

  const ac = new AbortController();
  running.set(chatId, ac);
  /*
   * A dropped connection deliberately does NOT stop the reply.
   *
   * It used to: the reasoning was that a browser which has gone away should
   * not be billed for a completion nobody will read. On a phone that reasoning
   * is wrong. Swiping out of the app is not going away — it is what using a
   * phone looks like — and Android drops the socket the moment the app stops
   * being foreground, so a reply was lost every time you glanced at something
   * else. Worse, the tokens were spent anyway; only the text was thrown away.
   *
   * So the generation runs to the end and is saved, and the page picks it up
   * when it comes back. Stopping is the Stop button's job, which is explicit,
   * reaches /stop, and still works.
   */

  const who = speaker ?? cast[0];

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let open = true;
      const push = (frame: string) => {
        if (!open) return;
        try { controller.enqueue(enc.encode(frame)); } catch { open = false; }
      };
      const send = (o: unknown) => push(`data: ${JSON.stringify(o)}\n\n`);
      // Bun drops an idle socket after idleTimeout seconds. A reasoning model
      // can go quiet for longer than that mid-reply, so a comment frame keeps
      // the connection warm. The client ignores anything that is not `data:`.
      const beat = setInterval(() => push(": keep-alive\n\n"), 15_000);

      if (userMessageId) send({ userMessageId });
      // The browser draws the reply's bubble before it knows whose it is, and
      // fell back to the chat's founder — so in a group the wrong face and name
      // sat above the text for the whole stream. Say who this is up front.
      if (who) send({ speaker: { id: who.id, name: who.name, avatar: who.avatar ?? null } });

      let full = "";
      let think = "";
      let tokens = 0;
      let failed = false;
      const t0 = Date.now();

      try {
        try {
          for await (const chunk of generate({
            provider: a.provider,
            apiKey: s[`key_${a.provider}`] ?? "",
            model: a.model,
            system: shaped.system,
            messages: shaped.messages,
            sampling: a.sampling,
            prefill: a.prefill,
            signal: ac.signal,
          })) {
            if (chunk.kind === "usage") { tokens = chunk.tokens; continue; }
            if (chunk.kind === "reasoning") {
              think += chunk.text;
              send({ reasoning: chunk.text });
              continue;
            }
            full += chunk.text;
            send({ delta: chunk.text });
          }
        } catch (err: any) {
          // A stop is not a failure. Whatever arrived before it is kept, so the
          // screen and the database still agree afterwards.
          if (ac.signal.aborted) failed = false;
          else {
            failed = true;
            send({ error: err?.message ?? "Generation failed." });
          }
        }

        if (failed) return;
        // Stopped before any prose arrived — during the thinking phase, say.
        // Saving an empty message would put a blank plate in the thread.
        if (ac.signal.aborted && !full) { send({ stopped: true }); return; }

        // A model that has been reading "Name: …" all through the history tends
        // to write one itself. Saving that would prefix it again next turn.
        if (mode !== "continue" && who?.name) full = stripSpeakerLabel(full, who.name);

        /*
         * Dice the model asked for, rolled for real.
         *
         * Before the extensions, so an extension reading the reply sees the
         * numbers rather than the request — and before saving, because a model
         * left to write its own outcome writes the one that suits it, which is
         * the single thing dice exist to prevent.
         */
        full = resolveRolls(full).text;
        // And checks, against the sheet of whoever is playing this chat — the
        // reason a sheet is kept at all rather than described in prose.
        full = resolveChecks(full, sheetFor(a.playerId)).text;

        /*
         * And anyone the narrator introduced, and anywhere it moved everyone.
         *
         * Here rather than on the way to the screen because the point is that
         * they persist: a reply that was streamed, read and never saved should
         * still not leave a Marla behind, and a reply that *was* saved must
         * have her, or the next prompt describes a taproom with nobody in it.
         */
        if (getSettings().mode === "tabletop") full = applyVerbs(chatId, full, a.playerId);

        // And extensions get the reply before it is saved, so what an
        // extension changes is what the chat keeps rather than a display trick
        // that disappears on reload.
        full = runServerHook(extensions, "reply:after", full,
          (where, err) => console.error(`[extension] ${where}`, err ?? ""));

        const ms = Date.now() - t0;
        // Not every provider reports usage; a rough estimate beats a blank.
        if (!tokens) tokens = Math.round((full.length + think.length) / 4);
        const stats = { tokens, ms };

        if (mode === "impersonate") {
          send({ done: true, impersonated: full, ...stats });
        } else if (mode === "continue" && continuingId) {
          const joined = (a.prefill ?? "") + full;
          db.query("UPDATE messages SET content = ?, ms = ?, tokens = ? WHERE id = ?")
            .run(joined, ms, tokens, continuingId);
          send({ done: true, id: continuingId, text: joined, ...stats });
        } else if (mode === "swipe" && swipeTarget) {
          const list = JSON.parse(swipeTarget.swipes || "[]");
          if (!list.length) list.push(swipeTarget.content);
          list.push(full);
          db.query(
            "UPDATE messages SET content = ?, swipes = ?, swipe_index = ?, reasoning = ?, tokens = ?, ms = ? WHERE id = ?",
          ).run(full, JSON.stringify(list), list.length - 1, think, tokens, ms, swipeTarget.id);
          send({ done: true, id: swipeTarget.id, text: full, swipes: list.length, index: list.length - 1, ...stats });
        } else {
          const id = uid();
          db.query(
            `INSERT INTO messages (id, chat_id, role, name, content, created_at, swipes, swipe_index, reasoning, tokens, ms, character_id)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).run(id, chatId, "assistant", who.name, full, now(), JSON.stringify([full]), 0,
                think, tokens, ms, who.id ?? null);
          send({ done: true, id, text: full, swipes: 1, index: 0, name: who.name, avatar: who.avatar ?? "", ...stats });
        }
      } finally {
        clearInterval(beat);
        if (running.get(chatId) === ac) running.delete(chatId);
        if (open) {
          open = false;
          try { controller.close(); } catch {}
        }
        // The chat may now have enough new material to be worth a note. Not
        // awaited and never allowed to throw: a failed note is a missing note,
        // not a broken reply.
        if (!failed && !ac.signal.aborted) takeNote(chatId).catch(() => {});
      }
    },
    // Same reasoning as the dropped connection above: the reader going away
    // is not a decision to stop, so the reply is finished and saved.
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
});

api.post("/messages/:id/swipe", async (c) => {
  const { index } = await c.req.json();
  const m = db.query("SELECT * FROM messages WHERE id = ?").get(c.req.param("id")) as any;
  if (!m) return c.json({ error: "Message not found." }, 404);
  const list = JSON.parse(m.swipes || "[]");
  if (!list[index]) return c.json({ error: "No such alternate." }, 400);
  db.query("UPDATE messages SET content = ?, swipe_index = ? WHERE id = ?")
    .run(list[index], index, m.id);
  return c.json({ ok: true, content: list[index] });
});

/**
 * A standalone SillyTavern settings.json. Personas live under power_user in
 * recent versions and at the top level in older ones; descriptions are either
 * plain strings or { description, position } objects. Avatars are separate
 * files in ST, so faces have to be attached afterwards.
 */
api.post("/import/settings", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "No file received." }, 400);

  let json: any;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return c.json({ error: "That is not readable JSON." }, 400);
  }

  const pu = json.power_user ?? {};
  const names: Record<string, string> = pu.personas ?? json.personas ?? {};
  const descs: Record<string, any> = pu.persona_descriptions ?? json.persona_descriptions ?? {};
  const activeAvatar: string = json.user_avatar ?? "";

  // Only live personas count as duplicates. A soft-deleted row is in the bin,
  // not in the app: matching against it silently skipped every persona on a
  // re-import after a delete, and reported them as "already here".
  const existing = new Set(
    (db.query("SELECT name FROM personas WHERE deleted_at IS NULL").all() as any[])
      .map((r) => r.name.toLowerCase()),
  );

  const personas: string[] = [];
  const skipped: string[] = [];
  let activeId: string | null = null;

  for (const [avatarKey, rawName] of Object.entries(names)) {
    if (typeof rawName !== "string" || !rawName.trim()) continue;
    const name = rawName.trim();
    const d = descs[avatarKey];
    const description = typeof d === "string" ? d : d?.description ?? "";

    // ST allows several avatars to share a name; keep the described one.
    const key = name.toLowerCase();
    if (existing.has(key)) {
      if (description) {
        db.query("UPDATE personas SET description = ? WHERE lower(name) = ? AND description = '' AND deleted_at IS NULL")
          .run(description, key);
      }
      skipped.push(name);
      if (avatarKey === activeAvatar) {
        const row = db.query("SELECT id FROM personas WHERE lower(name) = ? AND deleted_at IS NULL LIMIT 1").get(key) as any;
        if (row) activeId = row.id;
      }
      continue;
    }

    const id = uid();
    db.query("INSERT INTO personas (id, name, description, avatar, is_active, created_at) VALUES (?,?,?,?,?,?)")
      .run(id, name, description, null, 0, now());
    existing.add(key);
    personas.push(name);
    if (avatarKey === activeAvatar) activeId = id;
  }

  if (activeId) {
    db.query("UPDATE personas SET is_active = 0").run();
    db.query("UPDATE personas SET is_active = 1 WHERE id = ?").run(activeId);
  } else if (!(db.query("SELECT id FROM personas WHERE is_active = 1 AND deleted_at IS NULL LIMIT 1").get() as any)) {
    const first = db.query("SELECT id FROM personas WHERE deleted_at IS NULL LIMIT 1").get() as any;
    if (first) db.query("UPDATE personas SET is_active = 1 WHERE id = ?").run(first.id);
  }

  // The live sampler values double as a preset.
  let preset: string | null = null;
  const oai = json.oai_settings;
  if (oai && typeof oai === "object") {
    const { name, data } = fromSillyTavern(oai);
    const label = oai.preset_settings_openai || name;
    if (Object.keys(data).length) {
      db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES (?,?,?,?,?)")
        .run(uid(), label, JSON.stringify(data), 0, now());
      importScriptsFrom(oai, label);
      preset = label;
    }
  }

  return c.json({
    personas,
    skipped,
    preset,
    active: activeId ? json.username ?? null : null,
    note: "Persona pictures are separate files in SillyTavern. Set faces from the You tab.",
  });
});

api.put("/messages/:id", async (c) => {
  if (editsLocked()) return c.json(LOCKED, 403);
  const { content } = await c.req.json();
  db.query("UPDATE messages SET content = ? WHERE id = ?").run(content, c.req.param("id"));
  return c.json({ ok: true });
});

// ---- wallpapers -----------------------------------------------------------

api.post("/wallpaper", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "No image received." }, 400);
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().slice(0, 5);
  const name = `${uid()}.${ext}`;
  await writeFile(join(WALLS, name), await file.arrayBuffer());
  return c.json({ url: `/uploads/wallpapers/${name}` });
});

api.delete("/wallpaper", async (c) => {
  const { url } = await c.req.json();
  const name = String(url ?? "").split("/").pop() ?? "";
  if (!name || name.includes("..")) return c.json({ error: "Bad path." }, 400);
  const { rmSync } = await import("node:fs");
  try { rmSync(join(WALLS, name)); } catch {}
  if (getSettings().wallpaper === url) setSettings({ wallpaper: "" });
  return c.json({ ok: true });
});

/**
 * Several at once. Wallpapers arrive in bulk from a SillyTavern import, and
 * clearing them one confirm at a time is the same chore the other lists had.
 */
api.post("/wallpapers/delete", async (c) => {
  const { urls } = await c.req.json().catch(() => ({ urls: [] }));
  const list: string[] = Array.isArray(urls) ? urls.filter((u) => typeof u === "string") : [];
  if (!list.length) return c.json({ error: "Nothing to delete." }, 400);
  const { rmSync } = await import("node:fs");
  const active = getSettings().wallpaper;
  let deleted = 0;
  for (const url of list) {
    const name = String(url).split("/").pop() ?? "";
    // A name that could climb out of the wallpapers folder is not a wallpaper.
    if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) continue;
    try { rmSync(join(WALLS, name)); deleted++; } catch {}
    if (active === url) setSettings({ wallpaper: "" });
  }
  return c.json({ deleted });
});

api.get("/wallpapers", async () => {
  const { readdirSync } = await import("node:fs");
  let files: string[] = [];
  try {
    files = readdirSync(WALLS).filter((f) => /\.(png|jpe?g|webp|gif|avif)$/i.test(f));
  } catch {}
  return Response.json(files.map((f) => `/uploads/wallpapers/${f}`));
});


// ---- imports --------------------------------------------------------------

/** Character cards: PNG (V1/V2/V3) or JSON. The PNG itself becomes the avatar. */
api.post("/import/characters", async (c) => {
  const form = await c.req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return c.json({ error: "No files received." }, 400);

  const imported: string[] = [];
  const failed: { name: string; reason: string }[] = [];

  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const card = readCard(bytes, file.name);

      let avatar: string | null = null;
      if (!/\.json$/i.test(file.name)) {
        const name = `${uid()}.png`;
        await writeFile(join(UPLOADS, name), bytes);
        avatar = `/uploads/${name}`;
      }

      const id = uid();
      db.query(
        `INSERT INTO characters
         (id, name, description, personality, scenario, first_message, avatar, created_at,
          mes_example, system_prompt, post_history, alternate_greetings, tags, creator, raw_card,
          world)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id, card.name, card.description, card.personality, card.scenario,
        card.first_message, avatar, now(),
        card.mes_example, card.system_prompt, card.post_history,
        JSON.stringify(card.alternate_greetings), JSON.stringify(card.tags),
        card.creator, JSON.stringify(card.raw),
        // A card brought in at the table belongs to the table.
        currentWorld(),
      );
      imported.push(card.name);
    } catch (e: any) {
      failed.push({ name: file.name, reason: e?.message ?? "Could not read that file." });
    }
  }
  return c.json({ imported, failed });
});

/** Recent characters for the splash page, each with their latest chat. */
/**
 * Search across every message you have ever written or been sent.
 *
 * There is a lot in a library like this and no way at all to get back to a
 * scene you half remember. SQLite does the whole thing with a LIKE and an
 * index it already has on chat_id, and at this size that is instant — a
 * full-text index would be faster and is not worth the migration until
 * somebody notices.
 *
 * Filtered by world like every other list, since a search that returns a
 * story chat while you are sitting at the table is the same intrusion the
 * separate libraries exist to prevent.
 */
api.get("/search", (c) => {
  const q = String(c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json([]);
  // LIKE's own wildcards are not the user's to type by accident.
  const needle = `%${q.replace(/[\\%_]/g, (ch) => "\\" + ch)}%`;
  const rows = db.query(
    `SELECT messages.id, messages.chat_id, messages.role, messages.content, messages.created_at,
            chats.title, characters.name AS character_name, characters.avatar
       FROM messages
       JOIN chats ON chats.id = messages.chat_id
       JOIN characters ON characters.id = chats.character_id
      WHERE messages.content LIKE ? ESCAPE '\\'
        AND chats.deleted_at IS NULL AND characters.deleted_at IS NULL
        AND ${worldWhere()}
      ORDER BY messages.created_at DESC
      LIMIT 40`,
  ).all(needle) as any[];

  /*
   * A snippet centred on the hit, so the result says why it matched.
   *
   * Flattened first. A reply is prose with paragraphs, XML blocks and markdown
   * in it, and a hundred and sixty raw characters of that is three ragged
   * lines in a list built for one.
   */
  const at = (text: string) => {
    const flat = String(text ?? "")
      .replace(/<[^>]{1,80}>/g, " ")
      .replace(/[*_`#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const i = flat.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return flat.slice(0, 120);
    const from = Math.max(0, i - 40);
    return (from ? "…" : "") + flat.slice(from, from + 130).trim() + "…";
  };
  return c.json(rows.map((r) => ({
    id: r.id, chat_id: r.chat_id, role: r.role, created_at: r.created_at,
    title: r.title, character_name: r.character_name, avatar: r.avatar,
    snippet: at(String(r.content ?? "")),
  })));
});

api.get("/recent", (c) =>
  c.json(
    db
      .query(
        `SELECT characters.id, characters.name, characters.avatar, characters.description,
                (SELECT id FROM chats WHERE chats.character_id = characters.id AND deleted_at IS NULL
                  ORDER BY updated_at DESC LIMIT 1) AS last_chat,
                (SELECT MAX(updated_at) FROM chats WHERE chats.character_id = characters.id) AS last_seen
         FROM characters WHERE deleted_at IS NULL AND ${worldWhere()}
         ORDER BY last_seen IS NULL, last_seen DESC, characters.created_at DESC
         LIMIT 24`,
      )
      .all(),
  ),
);


api.get("/models", async (c) => {
  const s = getSettings();
  const provider = c.req.query("provider") ?? s.provider;
  try {
    return c.json({ models: await listModels(provider, s[`key_${provider}`] ?? "") });
  } catch (e: any) {
    return c.json({ error: e?.message ?? "Could not list models." }, 400);
  }
});


api.post("/characters/delete", async (c) => {
  const { ids } = await c.req.json();
  if (!Array.isArray(ids) || !ids.length) return c.json({ error: "Nothing selected." }, 400);
  const res = softDelete("characters", ids);
  return res;
});

api.post("/personas/delete", async (c) => {
  const { ids } = await c.req.json();
  if (!Array.isArray(ids) || !ids.length) return c.json({ error: "Nothing selected." }, 400);
  const res = softDelete("personas", ids);
  ensureActivePersona();
  return res;
});

api.post("/chats/delete", async (c) => {
  const { ids } = await c.req.json();
  if (!Array.isArray(ids) || !ids.length) return c.json({ error: "Nothing selected." }, 400);
  const res = softDelete("chats", ids);
  return res;
});

/** Chats grouped under the character they belong to. */
api.get("/cast", (c) => {
  const cast = db.query(
    `SELECT id, name, avatar, description, world FROM characters
     WHERE deleted_at IS NULL AND ${worldWhere()} ORDER BY name COLLATE NOCASE`,
  ).all() as any[];
  const chats = db
    .query(`SELECT id, character_id, title, updated_at,
                   (SELECT COUNT(*) FROM messages WHERE messages.chat_id = chats.id) AS turns,
                   (SELECT substr(content, 1, 140) FROM messages
                     WHERE messages.chat_id = chats.id
                     ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_message,
                   (SELECT role FROM messages WHERE messages.chat_id = chats.id
                     ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_role,
                   parent_chat_id
            FROM chats WHERE deleted_at IS NULL ORDER BY updated_at DESC`)
    .all() as any[];
  return c.json(
    cast.map((ch) => ({ ...ch, chats: chats.filter((x) => x.character_id === ch.id) })),
  );
});

/** Copies a chat up to and including a message, leaving the original intact. */
api.post("/messages/:id/branch", (c) => {
  const m = db.query("SELECT * FROM messages WHERE id = ?").get(c.req.param("id")) as any;
  if (!m) return c.json({ error: "Message not found." }, 404);
  const src = db.query("SELECT * FROM chats WHERE id = ?").get(m.chat_id) as any;

  const newId = uid();
  const t = now();
  db.query(
    `INSERT INTO chats (id, character_id, title, created_at, updated_at, parent_chat_id, branch_note,
                        author_note, note_depth, auto_lore_book_id, auto_lore_asked, auto_lore_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(newId, src.character_id, `${src.title} — branch`, t, t, src.id,
        (m.content ?? "").slice(0, 80), src.author_note ?? "", src.note_depth ?? 2,
        // A branch is the same story told again from a fork, so it keeps its
        // parent's record-keeping. Without this, every branch asks where to
        // file its notes all over again — and branching is exactly the moment
        // you least want to be interrupted with a question you have answered.
        src.auto_lore_book_id ?? null, src.auto_lore_asked ?? 0, src.auto_lore_at ?? 0);

  /*
   * Lorebooks pinned to the chat come along too.
   *
   * They are linked by chat id, so without this a branch starts with none of
   * them — the same scene, silently missing the material that made it work.
   * The book a chat files its own notes into is one of these, so it would also
   * have been inherited in name and unreadable in practice.
   */
  const pinned = db
    .query("SELECT book_id FROM lorebook_links WHERE scope = 'chat' AND target_id = ?")
    .all(m.chat_id) as any[];
  for (const link of pinned) {
    db.query("INSERT INTO lorebook_links (id, book_id, scope, target_id) VALUES (?,?,?,?)")
      .run(uid(), link.book_id, "chat", newId);
  }

  const rows = db
    .query("SELECT * FROM messages WHERE chat_id = ? AND (created_at < ? OR (created_at = ? AND rowid <= (SELECT rowid FROM messages WHERE id = ?))) ORDER BY created_at, rowid")
    .all(m.chat_id, m.created_at, m.created_at, m.id) as any[];

  const ins = db.query(
    `INSERT INTO messages (id, chat_id, role, name, content, created_at, swipes, swipe_index, reasoning, tokens, ms)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  db.transaction(() => {
    for (const r of rows)
      ins.run(uid(), newId, r.role, r.name, r.content, r.created_at, r.swipes, r.swipe_index,
              r.reasoning ?? "", r.tokens ?? 0, r.ms ?? 0);
  })();

  return c.json({ id: newId, copied: rows.length });
});


// ---- the bin --------------------------------------------------------------

const BIN_TABLES = ["characters", "chats", "personas", "presets"] as const;
type BinTable = (typeof BIN_TABLES)[number];

/** Hides rows and hands back a ticket the caller can undo with. */
function softDelete(table: BinTable, ids: string[]) {
  const at = now();
  const stmt = db.query(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`);
  db.transaction((list: string[]) => { for (const id of list) stmt.run(at, id); })(ids);
  return Response.json({ deleted: ids.length, undo: { table, ids } });
}

/**
 * Puts the starter character in an empty library, once.
 *
 * Called by each entry point once its database is actually usable — NOT at
 * import time. On the desktop bun:sqlite is ready the moment it is
 * constructed, but the phone's database is sql.js and has a WASM module to
 * compile first: serve.mobile.ts awaits `dbReady` inside main(), long after
 * `import { app } from "../../src/index"` has run. Seeding from this module's
 * body therefore worked everywhere except the one place it ran first, and took
 * the whole app down on launch.
 *
 * See src/starter.ts for why it is a narrator and why a deleted one stays
 * deleted.
 */
export function ensureStarterCharacter() {
  if (!libraryIsEmpty(db)) return;
  db.query(
    `INSERT INTO characters
     (id, name, description, personality, scenario, first_message, avatar, created_at,
      mes_example, system_prompt, post_history, alternate_greetings, tags, creator, raw_card,
      world)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(uid(), STARTER.name, STARTER.description, STARTER.personality, STARTER.scenario,
        STARTER.first_message, "", now(), "", STARTER.system_prompt, "",
        JSON.stringify(STARTER.alternate_greetings), JSON.stringify(STARTER.tags),
        STARTER.creator, "",
        // The one character at home in both rooms: it is the narrator, and
        // the first thing an empty copy of Hearth has to offer either way.
        "both");
}


function ensureActivePersona() {
  // The table's is a setting and is cleared rather than reassigned when its
  // persona goes: being handed somebody else to play without asking is worse
  // than being nobody in particular for a moment.
  const mine = getSettings().tabletop_persona;
  if (mine && !db.query("SELECT id FROM personas WHERE id = ? AND deleted_at IS NULL").get(mine)) {
    setSettings({ tabletop_persona: "" });
  }

  const live = db.query(
    `SELECT id FROM personas WHERE is_active = 1 AND deleted_at IS NULL
     AND (world = 'story' OR world = 'both') LIMIT 1`,
  ).get();
  if (live) return;
  const first = db.query(
    `SELECT id FROM personas WHERE deleted_at IS NULL
     AND (world = 'story' OR world = 'both') LIMIT 1`,
  ).get() as any;
  if (first) {
    db.query("UPDATE personas SET is_active = 0").run();
    db.query("UPDATE personas SET is_active = 1 WHERE id = ?").run(first.id);
  }
}

api.post("/undo", async (c) => {
  const { table, ids } = await c.req.json();
  if (!BIN_TABLES.includes(table)) return c.json({ error: "Unknown table." }, 400);
  if (!Array.isArray(ids) || !ids.length) return c.json({ error: "Nothing to restore." }, 400);
  const stmt = db.query(`UPDATE ${table} SET deleted_at = NULL WHERE id = ?`);
  db.transaction((list: string[]) => { for (const id of list) stmt.run(id); })(ids);
  ensureActivePersona();
  return c.json({ restored: ids.length });
});

api.get("/bin", (c) => {
  const out: any[] = [];
  for (const t of BIN_TABLES) {
    const label = t === "chats" ? "title" : "name";
    const rows = db
      .query(`SELECT id, ${label} AS label, deleted_at FROM ${t} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)
      .all() as any[];
    for (const r of rows) out.push({ ...r, table: t });
  }
  out.sort((a, b) => b.deleted_at - a.deleted_at);
  return c.json(out);
});

/** Actually destroys the row. Cascades apply here, so chats and messages go. */
api.post("/bin/purge", async (c) => {
  const { all, table, ids } = await c.req.json();
  const { rmSync } = await import("node:fs");
  let n = 0;

  /** Uploaded pictures are only referenced by their row, so remove both. */
  const dropFiles = (rows: any[]) => {
    for (const r of rows) {
      const url: string = r?.avatar ?? "";
      if (!url.startsWith("/uploads/")) continue;
      const rel = url.replace("/uploads/", "");
      if (rel.includes("..")) continue;
      try { rmSync(join(UPLOADS, rel)); } catch {}
    }
  };
  for (const t of ["characters", "personas"] as const) {
    if (all || table === t) {
      const where = all ? "" : ` AND id IN (${(ids ?? []).map(() => "?").join(",") || "NULL"})`;
      dropFiles(db.query(`SELECT avatar FROM ${t} WHERE deleted_at IS NOT NULL${where}`)
        .all(...(all ? [] : ids ?? [])) as any[]);
    }
  }

  if (all) {
    for (const t of BIN_TABLES) {
      const r = db.query(`DELETE FROM ${t} WHERE deleted_at IS NOT NULL`).run();
      n += r.changes;
    }
  } else {
    if (!BIN_TABLES.includes(table)) return c.json({ error: "Unknown table." }, 400);
    const stmt = db.query(`DELETE FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`);
    db.transaction((list: string[]) => { for (const id of list) n += stmt.run(id).changes; })(ids ?? []);
  }
  return c.json({ purged: n });
});

/**
 * Everything except your settings. Characters, chats, messages, personas,
 * presets, lorebooks and every uploaded picture go for good — the bin included,
 * since a wipe that left a bin full of what you just wiped would be a lie.
 *
 * API keys and appearance live in `settings` and are deliberately kept, so the
 * app is usable the moment it comes back up. Requires { confirm: "delete" } so
 * a stray POST cannot do this.
 */
api.post("/wipe", async (c) => {
  const { confirm } = await c.req.json().catch(() => ({}));
  if (confirm !== "delete") return c.json({ error: "Not confirmed." }, 400);

  const counts: Record<string, number> = {};
  // messages and lorebook_links cascade, but naming them keeps the count honest.
  for (const t of ["messages", "chats", "lorebook_links", "lorebooks",
                   "characters", "personas", "presets"]) {
    counts[t] = db.query(`DELETE FROM ${t}`).run().changes;
  }

  const { rmSync, readdirSync } = await import("node:fs");
  let files = 0;
  const sweep = (dir: string) => {
    let entries: string[] = [];
    try { entries = readdirSync(dir, { withFileTypes: true }).map((e) => e.name); } catch { return; }
    for (const e of entries) {
      if (e === "wallpapers" && dir === UPLOADS) continue;   // handled on its own
      try { rmSync(join(dir, e), { recursive: true, force: true }); files++; } catch {}
    }
  };
  sweep(WALLS);
  sweep(UPLOADS);
  // Nothing points at a wallpaper any more.
  setSettings({ wallpaper: "" });

  try { db.exec("VACUUM"); } catch {}
  return c.json({ ok: true, counts, files });
});

// ---- export ---------------------------------------------------------------

/** The database plus every uploaded image, as one downloadable archive. */
api.get("/backup/export", async (c) => {
  const { zipSync } = await import("fflate");
  const { readdirSync, readFileSync, statSync } = await import("node:fs");

  // Fold the write-ahead log back in so the copied file is complete.
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}

  const files: Record<string, Uint8Array> = {};
  const add = (name: string, path: string) => {
    try { files[name] = new Uint8Array(readFileSync(path)); } catch {}
  };

  add("hearth.db", join(DATA, "hearth.db"));
  for (const extra of [".env", "lumiverse.identity"]) add(extra, join(DATA, extra));

  const walk = (dir: string, prefix: string) => {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e);
      try {
        if (statSync(full).isDirectory()) walk(full, `${prefix}${e}/`);
        else add(`${prefix}${e}`, full);
      } catch {}
    }
  };
  walk(UPLOADS, "uploads/");

  const zipped = zipSync(files, { level: 6 });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new Response(zipped, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="hearth-backup-${stamp}.zip"`,
    },
  });
});


// ---- prompt assembly ------------------------------------------------------

/** What the inspector calls each assembled piece. */
const PART_LABEL: Record<string, string> = {
  main: "Framing",
  worldInfoBefore: "Lore, before the character",
  charDescription: "Character",
  charPersonality: "Personality",
  scenario: "Scene",
  personaDescription: "Your persona",
  dialogueExamples: "Example dialogue",
  worldInfoAfter: "Lore, after the character",
};

export type Assembled = {
  system: string;
  /** Whose sheet this chat plays with, in tabletop mode. Null without one. */
  playerId: string | null;
  messages: { role: "user" | "assistant"; content: string }[];
  /** Seeds the reply for Continue. Providers append it, so it is not in messages. */
  prefill?: string;
  sections: { label: string; content: string; chars: number }[];
  lore: { id: string; comment: string; keys: string[]; via: string; position: string; chars: number }[];
  sampling: ReturnType<typeof sampling>;
  model: string;
  provider: string;
};

/**
 * Builds exactly what will be sent, and records where each piece came from so
 * the same call can drive both a generation and the inspector.
 *
 * This is the only prompt assembly in Hearth. POST /chats/:id/generate and
 * POST /chats/:id/inspect both come through here; there is no second copy to
 * fall out of step with. Anything added below shows up in both at once.
 *
 * `stagedUser` is a turn the caller has not written to the database yet. The
 * inspector passes the text sitting in the composer so lore fires against it
 * exactly as it will on send; generate saves the turn first and stages nothing.
 */
export function assemble(
  chat: any,
  mode: string,
  guide: string,
  stagedUser = "",
  speaker?: any,
): Assembled {
  const staged = String(stagedUser ?? "").trim();
  const s = withPreset(getSettings());
  const cast = membersOf(chat);
  // Whose reply this is. Everyone else in the room is described, not written.
  const char = (speaker ??
    cast.find((m) => m.id === chat.character_id) ??
    cast[0] ??
    db.query("SELECT * FROM characters WHERE id = ?").get(chat.character_id)) as Character & { id?: string };
  const others = cast.filter((m) => m.id !== (char as any).id);
  const me = whoAmI(chat.persona_id);
  const sections: Assembled["sections"] = [];
  const note = (label: string, content: string) => {
    if (content?.trim()) sections.push({ label, content, chars: content.length });
  };

  let history = db
    .query("SELECT id, role, content, name FROM messages WHERE chat_id = ? ORDER BY created_at, rowid")
    .all(chat.id) as { id: string; role: string; content: string; name: string }[];
  if (staged) history = [...history, { id: "", role: "user", content: staged, name: "" }];

  // Continue resumes the last reply and swipe replaces it. Either way that
  // message leaves the history, or the model is asked to write it twice.
  let prefill: string | undefined;
  if ((mode === "continue" || mode === "swipe") && history[history.length - 1]?.role === "assistant") {
    if (mode === "continue") prefill = history[history.length - 1].content;
    history = history.slice(0, -1);
  }

  const parts = buildParts(char, me.name, me.description);
  // A group's shared premise belongs to the room, not to whichever character
  // is currently answering — it replaces each speaker's own scenario line.
  if (chat.is_group && chat.scenario?.trim()) {
    parts.scenario = `# Scene\n${macros(chat.scenario, char.name, me.name).trim()}`;
  }
  // In a group the model still writes one character. The rest are scenery it is
  // allowed to move — without this it either ignores them or speaks for them.
  if (others.length) {
    const room = others
      .map((o) => `**${o.name}** — ${(o.description || "no description").split("\n")[0].slice(0, 240)}`)
      .join("\n");
    parts.charDescription = [
      parts.charDescription,
      `# Also in the scene\n${room}\n\n` +
        `You are writing ${char.name} only. The others may be referred to, reacted to and ` +
        `spoken about, but never spoken *for* — do not write their dialogue or their actions.`,
    ].filter(Boolean).join("\n\n");
  }

  const active = activate(loreFor(chat), history, {
    scanDepth: Number(s.lore_scan_depth),
    maxChars: Number(s.lore_budget),
  });
  const lore = place(active);
  parts.worldInfoBefore = lore.beforeChar;
  parts.worldInfoAfter = lore.afterChar ? `# What is known\n${lore.afterChar}` : "";

  // Author's notes. `note_depth` 0 keeps them in the standing brief; anything
  // higher splices them into the transcript that many turns from the end.
  const notes: string[] = [];
  if (s.use_default_note !== "0" && s.default_author_note?.trim()) notes.push(s.default_author_note.trim());
  if (chat.author_note?.trim()) notes.push(chat.author_note.trim());
  const noteText = notes.length ? macros(notes.join("\n\n"), char.name, me.name).trim() : "";
  const noteDepth = Number.isFinite(+chat.note_depth)
    ? Math.max(0, Math.min(20, Math.trunc(+chat.note_depth)))
    : 0;

  /**
   * The active preset's block list decides the order of the whole prompt, not
   * just of any extra text — that is what makes it a preset rather than a pile
   * of paragraphs. A marker stands in for a piece Hearth assembles; a plain
   * block is text you typed. Anything the list leaves out is left out, and
   * `chatHistory` is the seam: blocks before it build the system prompt, blocks
   * after it become turns appended to the conversation.
   */
  const declared = allBlocks();
  /**
   * Card markers the preset never mentions at all are put back.
   *
   * Not mentioning one is different from switching it off: SillyTavern
   * expresses "no character description" as a block that is present and
   * disabled, so a marker that is simply absent from the list was never a
   * choice. It is what every preset imported before the marker fix looks
   * like — ST writes `marker: true` with the name in `identifier`, that was
   * read as the string "true", and those blocks were dropped for having no
   * content of their own. (`main` and `jailbreak` survived, because ST writes
   * no marker field on them at all, which is why such a preset does not look
   * marker-less and has to be checked one marker at a time.)
   *
   * The stored lists cannot be repaired — the markers were never written
   * down — so the missing pieces are laid back in front of whatever text the
   * preset does have. Re-importing still gives a better result, because only
   * the original file knows which blocks belonged *after* the transcript.
   *
   * `chatHistory` and `jailbreak` are deliberately not restored: a list with
   * no transcript marker falls through to the role seam below, which is how a
   * hand-written list is meant to work, and adding one would quietly move
   * every user and assistant block to the wrong side of the conversation.
   */
  const CARD_MARKERS = [
    "main", "worldInfoBefore", "charDescription", "charPersonality",
    "scenario", "personaDescription", "dialogueExamples", "worldInfoAfter",
  ];
  const mentioned = new Set(declared.map((b) => b.marker).filter(Boolean));
  /**
   * The signature of the damage, and it has to be a signature rather than any
   * single absence: leaving one piece out on purpose is a real feature (see
   * the tests), so only a combination no working preset would ever choose
   * counts. A preset that positions neither the character nor the transcript
   * is not making a choice about either — it lost them.
   */
  const damaged = declared.length &&
    !mentioned.has("charDescription") && !mentioned.has("chatHistory");
  const missing = damaged
    ? DEFAULT_BLOCKS.filter((b) => CARD_MARKERS.includes(b.marker!) && !mentioned.has(b.marker))
    : [];
  const salvaged = missing.length ? [...missing, ...declared] : declared;
  const listed = salvaged.length ? salvaged : DEFAULT_BLOCKS;
  /**
   * Who the model is playing and who it is talking to are not a preset's
   * business. A preset orders the prompt; it does not get to leave out the
   * character card, the personality or the persona, whether by never listing
   * them or by switching them off. Everything else here is still the preset's
   * to arrange or drop — scenario, example dialogue, the framing text, the
   * post-history instructions — but a reply written by something that does not
   * know who it is has no value to anybody, and there is no version of "I
   * chose this preset" that means "and now forget the character".
   *
   * This is also what makes the app robust against its own history: every
   * preset imported before the marker fix lost these blocks at import time and
   * cannot be repaired, because the markers were never written down. With this
   * rule it does not matter when a preset was imported.
   *
   * A preset that *does* position one of these keeps its position; only the
   * missing ones are put back, and in the default order.
   */
  const ALWAYS_SENT = [
    "worldInfoBefore", "charDescription", "charPersonality",
    "personaDescription", "worldInfoAfter",
  ];
  const enabledMarkers = new Set(listed.filter((b) => b.enabled).map((b) => b.marker));
  const forced = DEFAULT_BLOCKS.filter(
    (b) => ALWAYS_SENT.includes(b.marker!) && !enabledMarkers.has(b.marker),
  );
  const on = [...forced, ...listed.filter((b) => b.enabled)];
  // A hand-made list need not mention the transcript at all; there the role is
  // the seam instead, which is the simpler thing to reason about.
  const seam = on.findIndex((b) => b.marker === "chatHistory");
  const head = seam === -1 ? on.filter((b) => b.role === "system") : on.slice(0, seam);
  const after = seam === -1 ? on.filter((b) => b.role !== "system") : on.slice(seam + 1);

  const pieces: string[] = [];
  let notePlaced = false;
  for (const b of head) {
    if (b.marker === "chatHistory") continue;
    if (b.marker === "jailbreak") continue;            // handled after the history
    if (b.marker === "authorsNote") {
      if (noteText && noteDepth === 0) {
        pieces.push(`# Standing notes\n${noteText}`);
        note("Author's notes", noteText);
      }
      notePlaced = true;
      continue;
    }
    if (b.marker) {
      const t = (parts as Record<string, string>)[b.marker] ?? "";
      if (t) { pieces.push(t); note(PART_LABEL[b.marker] ?? b.marker, t); }
      continue;
    }
    const t = macros(b.content, char.name, me.name).trim();
    if (t) { pieces.push(`# ${b.name}\n${t}`); note(`Preset block — ${b.name}`, t); }
  }
  let system = pieces.join("\n\n");

  if (mode === "silent") {
    const silent = `${me.name} stays quiet this turn. Let the scene move on without them — ` +
      `time passes, ${char.name} acts, thinks, or speaks into the silence. ` +
      `You may let ${char.name} notice the silence and react to it. ` +
      `Never put words or actions in ${me.name}'s mouth.`;
    system += `\n\n# ${me.name} has said nothing\n${silent}`;
    note("Silent turn", silent);
  }
  if (mode === "impersonate") {
    const imp = `You are writing for ${me.name} in a roleplay with ${char.name}. ` +
      `Write only ${me.name}'s next turn — their dialogue, actions and thoughts. Never write for ${char.name}.`;
    system = `${imp}\n\n${system}`;
    note("Writing your turn", imp);
  }

  // A preset with no authorsNote marker still gets its note, at the end.
  if (noteText && noteDepth === 0 && !notePlaced) {
    system += `\n\n# Standing notes\n${noteText}`;
    note("Author's notes", noteText);
  }

  if (guide?.trim()) {
    const subject = mode === "impersonate" ? me.name : char.name;
    const g = `${guide.trim()}\nFollow this direction when writing ${subject}. Do not mention it or acknowledge it in the text.`;
    system += `\n\n# Direction for this response only\n${g}`;
    note("Guidance for this reply", g);
  }

  /**
   * Prompt-side regex scripts, applied per message with its depth from the end
   * of the transcript — the newest is 0. This is the half of the feature that
   * pays for itself: a preset's "remove older <status> from context" scripts
   * stop every state block the scene has ever produced from being resent on
   * every turn. Display-side scripts are the browser's business; the model
   * never sees them, and this never touches the stored rows.
   */
  const scripts = liveScripts();
  if (scripts.some((r) => r.enabled && r.prompt)) {
    const last = history.length - 1;
    history = history.map((h, i) => ({
      ...h,
      content: applyScripts(
        h.content,
        scripts,
        "prompt",
        h.role === "user" ? PLACEMENT.userInput : PLACEMENT.aiOutput,
        last - i,
      ),
    }));
  }

  const messages = buildMessages(history, char, me.name, Number(s.context_tokens), others.length > 0);
  if (mode === "silent" && messages[messages.length - 1]?.role === "assistant") {
    messages.push({ role: "user", content: `(${me.name} says nothing.)` });
  }
  // Depth-positioned lore is spliced into the transcript itself, so it reads as
  // recent context rather than as a standing brief.
  for (const item of lore.atDepth) {
    const at = Math.max(0, messages.length - Math.max(1, item.depth));
    messages.splice(at, 0, { role: "user", content: `[${item.content}]` });
    note(`Lore in the conversation, ${item.depth} back`, item.content);
  }
  if (noteText && noteDepth > 0) {
    const at = Math.max(0, messages.length - noteDepth);
    messages.splice(at, 0, { role: "user", content: `[${noteText}]` });
    note(`Author's notes, ${noteDepth} back`, noteText);
  }

  // Blocks the preset put after the transcript become turns of their own.
  // There is no system role mid-conversation, so those arrive as user turns.
  for (const b of after) {
    if (b.marker && b.marker !== "jailbreak") continue;
    if (b.marker === "jailbreak") continue;
    const t = macros(b.content, char.name, me.name).trim();
    if (!t) continue;
    messages.push({ role: b.role === "assistant" ? "assistant" : "user", content: t });
    note(`Preset block — ${b.name}, as ${b.role}`, t);
  }

  // Post-history instructions land last, where they hold most sway. A preset
  // that lists `jailbreak` and turns it off is asking for them to be dropped.
  const suppressTail =
    declared.some((b) => b.marker === "jailbreak") && !on.some((b) => b.marker === "jailbreak");
  const tail = suppressTail ? "" : buildPostHistory(char, me.name);
  if (tail) {
    const last = messages[messages.length - 1];
    if (last?.role === "user") last.content += `\n\n[${tail}]`;
    else messages.push({ role: "user", content: `[${tail}]` });
    note("Card instructions after the history", tail);
  }

  /*
   * The dice notation, told to the model once, if this copy wants dice.
   *
   * Off by default in story mode. It is one sentence, but it is one sentence in
   * every system prompt in every chat, and a model that has just been taught to
   * roll will find reasons to — a delight in a dungeon and an intrusion in a
   * conversation.
   *
   * In tabletop mode it is simply on. That mode is a table, and a table has
   * dice on it; having to find a setting before anyone could roll would make
   * the door lead nowhere.
   */
  if (s.dice_enabled === "1" && s.mode !== "tabletop") {
    system = system ? `${system}

${DICE_BRIEF}` : DICE_BRIEF;
    note("Dice", DICE_BRIEF);
  }

  /*
   * Everything the table itself needs, put after the transcript.
   *
   * The sheet, the notations, where everyone is, who they have met. This
   * started life in the system prompt, which is the tidier place for it and
   * the wrong one: a preset like DEUS EX MACHINA is fifty thousand characters
   * of formatting law, and a paragraph appended underneath it is a paragraph
   * the model reads once and then spends the rest of its attention obeying
   * something else. Measured rather than guessed — it wrote no verbs at all
   * from there, and the same words after the history work.
   *
   * So this goes where the card's own post-history instructions go, for the
   * same reason they do: last is where an instruction holds.
   *
   * The order inside it is deliberate. Who the character is, then how to test
   * them, then where they are and who is with them, then how to change either
   * — facts before the notation that uses them, so a sheet that does not exist
   * takes its instruction with it instead of teaching a roll against nothing.
   */
  if (s.mode === "tabletop") {
    const table: string[] = [];

    /*
     * What the game is, first of everything.
     *
     * Before the dice and before the sheet, because it is the only part that
     * says what this evening is for; a narrator that reads the notations first
     * has learnt how to roll before it has learnt what it is running.
     *
     * The opening line comes with it exactly once. It describes the first
     * scene, so from the second exchange onwards it would be an instruction to
     * introduce a town that was introduced twenty minutes ago.
     */
    const game = campaignIn(chat.id);
    if (game) {
      /*
       * "Not started" means the player has not spoken, not that the chat is
       * empty. A new chat already holds the card's greeting — which for the
       * narrator is "what are you in the mood for?", asked before the campaign
       * was chosen — so counting the narrator's own turns hid this exactly
       * when it was needed. Measured: it never appeared once.
       */
      const started = (db.query(
        "SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND role = 'user'",
      ).get(chat.id) as any)?.n ?? 0;
      table.push(started ? campaignForPrompt(game) : `${campaignForPrompt(game)}\n\n${openingBrief(game)}`);
    }

    table.push(DICE_BRIEF);

    const mySheet = sheetFor(me.id);
    if (mySheet) table.push(`${sheetForPrompt(me.name, mySheet)}\n\n${CHECK_BRIEF}`);

    /*
     * Where everyone is, and who is standing there.
     *
     * This is the whole reason the verbs write anything down. A narrator that
     * moved the party to the mill forty messages ago has long since lost the
     * mill out of its context window, and will cheerfully put them back in the
     * taproom; a narrator handed one line saying where they are cannot. Same
     * for the people: Marla stays Marla, with the same job and the same lie,
     * instead of becoming whoever the model needs behind a bar today.
     *
     * Bounded, because it goes in every prompt. The most recent dozen, which
     * in practice is everyone still in the scene plus a few who wandered off.
     */
    const here = db.query("SELECT location FROM chats WHERE id = ?").get(chat.id) as any;
    const cast = npcsIn(chat.id).slice(-12);
    const world: string[] = [];
    if (here?.location) world.push(`Where everyone is: ${here.location}`);
    if (cast.length) {
      world.push("People met so far — keep them consistent:");
      for (const n of cast) world.push(`- ${n.name}${n.brief ? ` — ${n.brief}` : ""}`);
    }
    if (world.length) table.push(world.join("\n"));
    table.push(VERB_BRIEF);

    /*
     * And the fight, if there is one, last of all.
     *
     * Last because while a fight is happening it is the only thing that
     * matters, and because the hit points have to sit next to the instruction
     * that says they are the real ones — a narrator handed the numbers and
     * then three paragraphs of other business will narrate around them.
     */
    const fight = fightIn(chat.id);
    if (fight) table.push(`${fightForPrompt(fight)}\n\n${FIGHT_BRIEF}`);

    const block = table.join("\n\n");
    const last = messages[messages.length - 1];
    if (last?.role === "user") last.content += `\n\n[${block}]`;
    else messages.push({ role: "user", content: `[${block}]` });
    note("The table", block);
  }

  if (staged) note("Your message", staged);
  note("Conversation", messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"));
  if (prefill) note("Continuing this reply", prefill);

  return {
    system, messages, prefill, sections,
    /** Whose sheet this chat plays with; see resolveChecks in generate. */
    playerId: me.id,
    lore: active.map((a) => ({
      id: a.entry.id, comment: a.entry.comment, keys: a.entry.keys,
      via: a.via, position: a.entry.position, chars: a.entry.content.length,
    })),
    sampling: sampling(s), model: s.model, provider: s.provider,
  };
}

api.post("/chats/:id/inspect", async (c) => {
  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(c.req.param("id")) as any;
  if (!chat) return c.json({ error: "Chat not found." }, 404);
  if (!db.query("SELECT id FROM characters WHERE id = ?").get(chat.character_id))
    return c.json({ error: "That character no longer exists." }, 404);
  const { mode = "reply", guide = "", content = "", speaker: speakerId = "" } =
    await c.req.json().catch(() => ({}));

  /**
   * Whose reply this would be. Without this the inspector always described the
   * founder of the chat, so in a group it showed "You are <first character>"
   * while a send would have written someone else entirely — the one thing an
   * inspector must never do. Resolved exactly as POST /generate resolves it.
   */
  const speaker = mode === "impersonate" ? undefined : nextSpeaker(chat, speakerId);

  // Show what a send would look like without writing anything down. The typed
  // message is threaded through assembly rather than tacked on afterwards, so
  // lore fires against it here the same way it will on send.
  const a = assemble(chat, mode, guide, mode === "reply" ? content : "", speaker);

  const chars =
    a.system.length +
    a.messages.reduce((n, m) => n + m.content.length, 0) +
    (a.prefill?.length ?? 0);
  return c.json({
    provider: a.provider, model: a.model, sampling: a.sampling,
    speaker: speaker ? { id: speaker.id, name: speaker.name } : null,
    sections: a.sections, lore: a.lore,
    turns: a.messages.length,
    chars,
    estTokens: Math.round(chars / 4),
    system: a.system,
  });
});

// ---- prompt assembly ends -------------------------------------------------

// ---- exports --------------------------------------------------------------

const download = (name: string, body: any, type = "application/json") =>
  new Response(
    body instanceof Uint8Array
      ? (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer)
      : typeof body === "string" ? body : JSON.stringify(body, null, 2),
    {
    headers: {
      "content-type": type,
      "content-disposition": `attachment; filename="${name.replace(/[^\w.-]+/g, "_")}"`,
    },
  },
);

/** A character leaves as a real V2 card when it has a picture, JSON otherwise. */
api.get("/characters/:id/export", async (c) => {
  const row = db.query("SELECT * FROM characters WHERE id = ?").get(c.req.param("id")) as any;
  if (!row) return c.json({ error: "Character not found." }, 404);
  const card = toCard(row);

  if (c.req.query("format") !== "json" && row.avatar?.startsWith("/uploads/")) {
    try {
      const { readFileSync } = await import("node:fs");
      const png = new Uint8Array(readFileSync(join(UPLOADS, row.avatar.replace("/uploads/", ""))));
      if (png[0] === 0x89 && png[1] === 0x50) {
        return download(`${row.name}.png`, writeCardPng(png, card), "image/png");
      }
    } catch {}
  }
  return download(`${row.name}.json`, card);
});

api.get("/personas/:id/export", async (c) => {
  const p = db.query("SELECT * FROM personas WHERE id = ?").get(c.req.param("id")) as any;
  if (!p) return c.json({ error: "Persona not found." }, 404);

  let avatar: string | null = null;
  if (p.avatar?.startsWith("/uploads/")) {
    try {
      const { readFileSync } = await import("node:fs");
      const bytes = readFileSync(join(UPLOADS, p.avatar.replace("/uploads/", "")));
      avatar = `data:image/png;base64,${bytes.toString("base64")}`;
    } catch {}
  }
  return download(`${p.name}.persona.json`,
    { hearth_persona: 1, name: p.name, description: p.description, avatar });
});

/**
 * Personas, from a Hearth export or from SillyTavern.
 *
 * SillyTavern keeps them in two halves that arrive separately: the names and
 * descriptions live in settings.json — or in a standalone export of the same
 * three fields, personas / persona_descriptions / default_persona — while the
 * pictures are loose files in "User Avatars", tied to them only by filename.
 * So this takes both at once: hand it the JSON and the avatar images together
 * and they are matched up by name. Either half works alone; the pictures are
 * simply missing without the other.
 */
api.post("/import/persona-files", async (c) => {
  const form = await c.req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const imported: string[] = [];

  const pictures = new Map<string, File>();
  const jsons: File[] = [];
  for (const f of files) {
    if (/\.(png|jpe?g|webp|gif)$/i.test(f.name)) pictures.set(f.name, f);
    else jsons.push(f);
  }

  /** Copies a "User Avatars" picture in, if it came along with the JSON. */
  const avatarFor = async (file: string | null | undefined) => {
    const pic = file ? pictures.get(file) : null;
    if (!pic) return null;
    const n = `${uid()}${(pic.name.match(/\.[a-z0-9]+$/i) ?? [".png"])[0]}`;
    await writeFile(join(UPLOADS, n), new Uint8Array(await pic.arrayBuffer()));
    return `/uploads/${n}`;
  };

  const add = (name: string, description: string, avatar: string | null, active: boolean) => {
    db.query("INSERT INTO personas (id, name, description, avatar, is_active, created_at) VALUES (?,?,?,?,?,?)")
      .run(uid(), name, description, avatar, active ? 1 : 0, now());
    imported.push(name);
  };

  for (const f of jsons) {
    try {
      const j = JSON.parse(await f.text());

      // A whole set: { personas: { file: name }, persona_descriptions: {...} }
      if (j?.personas && typeof j.personas === "object" && !Array.isArray(j.personas)) {
        const descs: Record<string, any> = j.persona_descriptions ?? {};
        const active: string = j.default_persona ?? j.user_avatar ?? "";
        if (active) db.query("UPDATE personas SET is_active = 0").run();
        for (const [file, pname] of Object.entries(j.personas)) {
          const name = String(pname ?? "").trim();
          if (!name) continue;
          const d = descs[file];
          add(name, typeof d === "string" ? d : String(d?.description ?? ""),
              await avatarFor(file), file === active);
        }
        continue;
      }

      // Or one persona on its own, the way Hearth exports them.
      const name = String(j.name ?? f.name.replace(/\.(persona\.)?json$/i, "")).trim();
      if (!name) continue;
      let avatar: string | null = null;
      if (typeof j.avatar === "string" && j.avatar.startsWith("data:")) {
        const b64 = j.avatar.split(",")[1] ?? "";
        const n = `${uid()}.png`;
        await writeFile(join(UPLOADS, n), Buffer.from(b64, "base64"));
        avatar = `/uploads/${n}`;
      }
      add(name, String(j.description ?? ""), avatar ?? (await avatarFor(j.avatar)), false);
    } catch {}
  }
  ensureActivePersona();
  if (!imported.length) return c.json({ error: "No readable personas in those files." }, 400);
  return c.json({ imported });
});

api.get("/presets/:id/export", (c) => {
  const p = db.query("SELECT * FROM presets WHERE id = ?").get(c.req.param("id")) as any;
  if (!p) return c.json({ error: "Preset not found." }, 404);
  let data = {};
  try { data = JSON.parse(p.data); } catch {}
  return download(`${p.name}.preset.json`, { hearth_preset: 1, name: p.name, ...data });
});

api.get("/lorebooks/:id/export", (c) => {
  const b = db.query("SELECT * FROM lorebooks WHERE id = ?").get(c.req.param("id")) as any;
  if (!b) return c.json({ error: "Lorebook not found." }, 404);
  let entries: any[] = [];
  try { entries = JSON.parse(b.entries || "[]"); } catch {}

  // Written back in SillyTavern's shape so the file is portable.
  const ST_LOGIC: Record<string, number> = { and_any: 0, not_all: 1, not_any: 2, and_all: 3 };
  const ST_POS: Record<string, number> = { before_char: 0, after_char: 1, at_depth: 4 };
  const out: Record<string, any> = {};
  entries.forEach((e, i) => {
    out[String(i)] = {
      uid: i, key: e.keys ?? [], keysecondary: e.secondary ?? [],
      comment: e.comment ?? "", content: e.content ?? "",
      constant: !!e.constant, selective: !!(e.secondary?.length),
      selectiveLogic: ST_LOGIC[e.logic] ?? 0,
      order: e.order ?? 100, position: ST_POS[e.position] ?? 1, depth: e.depth ?? 4,
      probability: e.probability ?? 100, useProbability: true,
      disable: !e.enabled, caseSensitive: !!e.caseSensitive,
      matchWholeWords: !!e.wholeWords, scanDepth: e.scanDepth,
      excludeRecursion: !!e.excludeRecursion, preventRecursion: !!e.preventRecursion,
    };
  });
  return download(`${b.name}.json`, { name: b.name, entries: out });
});

// ---- lorebooks ------------------------------------------------------------

const readEntries = (row: any): LoreEntry[] => {
  try { return normaliseBook(JSON.parse(row.entries || "[]")); } catch { return []; }
};

api.get("/lorebooks", (c) => {
  const books = db
    .query(
      `SELECT * FROM lorebooks WHERE deleted_at IS NULL AND ${worldWhere("lorebooks")}
       ORDER BY name COLLATE NOCASE`,
    )
    .all() as any[];
  const links = db.query("SELECT * FROM lorebook_links").all() as any[];
  return c.json(books.map((b) => ({
    id: b.id,
    name: b.name,
    entries: readEntries(b),
    links: links.filter((l) => l.book_id === b.id),
  })));
});

api.post("/lorebooks", async (c) => {
  const b = await c.req.json();
  const id = uid();
  db.query("INSERT INTO lorebooks (id, name, entries, created_at, world) VALUES (?,?,?,?,?)")
    .run(id, (b.name ?? "New lorebook").trim() || "New lorebook",
         JSON.stringify(normaliseBook(b.entries ?? [])), now(), currentWorld());
  return c.json({ id });
});

/** Every book that is not on this shelf, for the picker that moves them. */
api.get("/lorebooks/elsewhere", (c) =>
  c.json(db.query(
    `SELECT id, name FROM lorebooks
     WHERE deleted_at IS NULL AND NOT ${worldWhere("lorebooks")}
     ORDER BY name COLLATE NOCASE`,
  ).all()),
);

/** Bringing one to the table, or sending it home. Same rules as everything else. */
api.put("/lorebooks/:id/world", async (c) => {
  const id = c.req.param("id");
  const row = db.query("SELECT world FROM lorebooks WHERE id = ?").get(id) as any;
  if (!row) return c.json({ error: "No such lorebook." }, 404);
  const { at } = await c.req.json().catch(() => ({}));
  const here = currentWorld();
  const world = at
    ? (row.world === "both" || row.world === here ? row.world : "both")
    : (here === "tabletop" ? "story" : "tabletop");
  db.query("UPDATE lorebooks SET world = ? WHERE id = ?").run(world, id);
  return c.json({ world });
});

api.put("/lorebooks/:id", async (c) => {
  const b = await c.req.json();
  const cur = db.query("SELECT * FROM lorebooks WHERE id = ?").get(c.req.param("id")) as any;
  if (!cur) return c.json({ error: "Lorebook not found." }, 404);
  db.query("UPDATE lorebooks SET name = ?, entries = ? WHERE id = ?").run(
    (b.name ?? cur.name).trim() || cur.name,
    b.entries ? JSON.stringify(b.entries.map(normaliseEntry)) : cur.entries,
    cur.id,
  );
  return c.json({ ok: true });
});

api.delete("/lorebooks/:id", (c) => {
  db.query("UPDATE lorebooks SET deleted_at = ? WHERE id = ?").run(now(), c.req.param("id"));
  return c.json({ ok: true });
});

/**
 * Several at once. An import brings in dozens of books, and clearing them one
 * request at a time — each followed by a full reload of the list — took long
 * enough that it read as the app having hung.
 */
api.post("/lorebooks/delete", async (c) => {
  const { ids } = await c.req.json().catch(() => ({ ids: [] }));
  const list: string[] = Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
  if (!list.length) return c.json({ error: "Nothing to delete." }, 400);
  const at = now();
  const stmt = db.query("UPDATE lorebooks SET deleted_at = ? WHERE id = ?");
  db.transaction((rows: string[]) => { for (const id of rows) stmt.run(at, id); })(list);
  return c.json({ deleted: list.length });
});

/* ---- notes the story keeps on itself --------------------------------------
   Every so often the recent scene is handed back to the model with one job:
   say what changed. What comes back is filed as an ordinary lorebook entry, so
   from here on it is read by the same machinery as a hand-written one. The
   deciding and the parsing live in src/autolore.ts, where they can be tested
   without a provider. */

/**
 * Writes a note for this chat if enough has happened since the last one.
 *
 * Deliberately quiet: every failure path leaves the chat exactly as it was and
 * says nothing. A note is a nicety, and nothing about a roleplay should break
 * because the note-taker had a bad day.
 */
async function takeNote(chatId: string) {
  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(chatId) as any;
  if (!chat?.auto_lore_book_id) return;

  const book = db
    .query("SELECT * FROM lorebooks WHERE id = ? AND deleted_at IS NULL")
    .get(chat.auto_lore_book_id) as any;
  // The book was deleted out from under the chat; stop pointing at it.
  if (!book) {
    db.query("UPDATE chats SET auto_lore_book_id = NULL WHERE id = ?").run(chatId);
    return;
  }

  const s = getSettings();
  const every = Number(s.auto_lore_every) || 0;
  const scope: Scope = s.auto_lore_scope === "window" ? "window" : "since";

  const all = db
    .query("SELECT role, name, content, created_at FROM messages WHERE chat_id = ? ORDER BY created_at, rowid")
    .all(chatId) as any[];
  if (!isDue(freshCount(all, chat.auto_lore_at ?? 0), every)) return;

  const picked = messagesForNote(all, scope, every, chat.auto_lore_at ?? 0);
  if (!picked.length) return;

  const speaker = db.query("SELECT name FROM characters WHERE id = ?").get(chat.character_id) as any;

  /*
   * The clock moves before the model is asked, not after.
   *
   * If it moved only on success, a chat whose notes keep failing — no credit,
   * a model that will not answer in JSON — would try again on every single
   * message from then on, quietly making a request per turn forever. Better to
   * miss a note than to bill for one every turn.
   */
  const mark = picked[picked.length - 1].created_at;
  db.query("UPDATE chats SET auto_lore_at = ? WHERE id = ?").run(mark, chatId);

  let said = "";
  for await (const chunk of generate({
    provider: s.provider,
    apiKey: s[`key_${s.provider}`] ?? "",
    model: s.model,
    system: NOTE_SYSTEM,
    messages: [{ role: "user", content: notePrompt(picked, speaker?.name ?? "Character") }],
    // A note is a small structured answer, so: no streaming, no reasoning, and
    // a temperature low enough that it reports rather than embroiders.
    sampling: { temperature: 0.2, maxTokens: 400, topP: 1, minP: 0,
                repetitionPenalty: 1, frequencyPenalty: 0, presencePenalty: 0,
                stream: false, reasoningEffort: "off" },
  })) {
    if (chunk.kind === "text") said += chunk.text;
    if (said.length > 4000) break;
  }

  const note = parseNote(said);
  if (!note) {
    // Quiet for the reader, but not invisible to whoever has to work out why
    // a chat stopped taking notes. "It said nothing worth recording" and "it
    // would not answer in JSON" look identical from the outside otherwise.
    console.error(`[note] unusable answer (${said.length} chars): ${said.slice(0, 300)}`);
    return;
  }

  const entries = readEntries(book);
  entries.push(entryFromNote(note));
  db.query("UPDATE lorebooks SET entries = ? WHERE id = ?")
    .run(JSON.stringify(entries), book.id);
}

/**
 * Where this chat files its notes: an existing book, a new one, or nowhere.
 *
 * Answering at all marks the chat as asked, including "nowhere" — the point of
 * the question is to be asked once.
 */
/**
 * A name no other book already has.
 *
 * The book a chat keeps its own notes in is named after the character by
 * default, so a third game with the same narrator produced a third "The
 * Gamekeeper — notes" and no way to tell later which evening was in which.
 * The date first, because that is the thing you actually remember about a
 * game; a plain counter after it, for two started the same day.
 *
 * Only the automatic ones go through this. A book you sat down and named
 * yourself is yours to call whatever you like, including the same as another.
 */
export function freeBookName(wanted: string): string {
  const taken = (n: string) =>
    !!db.query("SELECT id FROM lorebooks WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL").get(n);
  if (!taken(wanted)) return wanted;

  const day = new Date(now()).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const dated = `${wanted} (${day})`;
  if (!taken(dated)) return dated;

  for (let n = 2; n < 100; n++) {
    const numbered = `${wanted} (${day}, ${n})`;
    if (!taken(numbered)) return numbered;
  }
  // A hundred books called the same thing on one day is somebody testing.
  return `${wanted} (${now()})`;
}

api.put("/chats/:id/autolore", async (c) => {
  const chatId = c.req.param("id");
  const chat = db.query("SELECT id FROM chats WHERE id = ?").get(chatId) as any;
  if (!chat) return c.json({ error: "No such chat." }, 404);

  const { book_id, name } = await c.req.json();
  let bookId: string | null = null;

  if (typeof name === "string" && name.trim()) {
    bookId = uid();
    db.query("INSERT INTO lorebooks (id, name, entries, created_at, world) VALUES (?,?,?,?,?)")
      .run(bookId, freeBookName(name.trim().slice(0, 120)), "[]", now(), currentWorld());
  } else if (typeof book_id === "string" && book_id) {
    const found = db
      .query("SELECT id FROM lorebooks WHERE id = ? AND deleted_at IS NULL")
      .get(book_id) as any;
    if (!found) return c.json({ error: "No such lorebook." }, 404);
    bookId = found.id;
  }

  if (bookId) {
    // A book nothing reads is a book nothing reads: attach it to this chat so
    // the notes it collects actually come back into the story.
    db.query("DELETE FROM lorebook_links WHERE book_id = ? AND scope = 'chat' AND ifnull(target_id,'') = ?")
      .run(bookId, chatId);
    db.query("INSERT INTO lorebook_links (id, book_id, scope, target_id) VALUES (?,?,?,?)")
      .run(uid(), bookId, "chat", chatId);
  }

  // Start the clock now, so the first note covers what happens next rather
  // than everything that came before the question was answered.
  const last = db
    .query("SELECT created_at FROM messages WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(chatId) as any;
  db.query("UPDATE chats SET auto_lore_book_id = ?, auto_lore_asked = 1, auto_lore_at = ? WHERE id = ?")
    .run(bookId, last?.created_at ?? 0, chatId);

  return c.json({ ok: true, book_id: bookId });
});

/** Attach or detach a book from everything, a character, or one chat. */
api.post("/lorebooks/:id/link", async (c) => {
  const { scope, target_id, on } = await c.req.json();
  const bookId = c.req.param("id");
  if (!["global", "character", "chat"].includes(scope)) return c.json({ error: "Bad scope." }, 400);

  db.query("DELETE FROM lorebook_links WHERE book_id = ? AND scope = ? AND ifnull(target_id,'') = ?")
    .run(bookId, scope, target_id ?? "");
  if (on) {
    db.query("INSERT INTO lorebook_links (id, book_id, scope, target_id) VALUES (?,?,?,?)")
      .run(uid(), bookId, scope, target_id ?? null);
  }
  return c.json({ ok: true });
});

/** Every entry in play for this chat, from books linked at any level. */
function loreFor(chat: any): LoreEntry[] {
  // Every member's own books fire, not just the founder's — `chat.character_id`
  // is only ever the first seat, and a group where three of four characters'
  // lorebooks never activated would fail silently, which is the worst way for
  // a lorebook to fail.
  const memberIds = membersOf(chat).map((m) => m.id as string);
  const charIds = memberIds.length ? memberIds : [chat.character_id];
  const placeholders = charIds.map(() => "?").join(",");
  const rows = db
    .query(
      `SELECT lorebooks.* FROM lorebooks
        JOIN lorebook_links ON lorebook_links.book_id = lorebooks.id
       WHERE lorebooks.deleted_at IS NULL
         AND (lorebook_links.scope = 'global'
              OR (lorebook_links.scope = 'character' AND lorebook_links.target_id IN (${placeholders}))
              OR (lorebook_links.scope = 'chat' AND lorebook_links.target_id = ?))
       GROUP BY lorebooks.id`,
    )
    .all(...charIds, chat.id) as any[];
  /**
   * Entry ids are only unique *within* a book — SillyTavern numbers them from
   * zero in every book it exports, so two books attached at once both claim
   * "0", "1", "2"… `activate()` keys its chosen set by id, so the second
   * book's entries all looked already-taken and silently never fired. Running
   * two lorebooks worked for exactly one of them. Namespacing by book id here
   * keeps the ids stable within a request without touching what is stored.
   */
  return rows.flatMap((row) =>
    readEntries(row).map((e) => ({ ...e, id: `${row.id}:${e.id}` })),
  );
}

/** Dry run so the Lore tab can show what would fire right now. */
api.get("/chats/:id/lore", (c) => {
  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(c.req.param("id")) as any;
  if (!chat) return c.json({ error: "Chat not found." }, 404);
  const s = getSettings();
  const history = db
    .query("SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at, rowid")
    .all(chat.id) as any[];
  const active = activate(loreFor(chat), history, {
    scanDepth: Number(s.lore_scan_depth),
    maxChars: Number(s.lore_budget),
  });
  return c.json(active.map((a) => ({
    id: a.entry.id, comment: a.entry.comment, keys: a.entry.keys,
    via: a.via, position: a.entry.position, chars: a.entry.content.length,
  })));
});

// ---- regex scripts --------------------------------------------------------

/**
 * Every live script, in list order. Read on each assembly rather than cached:
 * a script you have just switched off should stop applying to the next reply,
 * not to the one after a restart.
 */
function liveScripts(): RegexScript[] {
  const rows = db
    .query("SELECT * FROM regex_scripts WHERE deleted_at IS NULL ORDER BY position, created_at")
    .all() as any[];
  return rows.flatMap((r) => {
    try {
      return [{ ...normaliseScript(JSON.parse(r.script), r.source), id: r.id, enabled: !!r.enabled }];
    } catch {
      return [];
    }
  });
}

/** Stores one, keeping SillyTavern's own id so a re-import updates in place. */
function saveScript(raw: any, source: string, position: number) {
  const script = normaliseScript(raw, source);
  const existing = db.query("SELECT id FROM regex_scripts WHERE id = ?").get(script.id) as any;
  if (existing) {
    db.query("UPDATE regex_scripts SET name = ?, script = ?, source = ?, deleted_at = NULL WHERE id = ?")
      .run(script.name, JSON.stringify(script), source, script.id);
  } else {
    db.query(
      "INSERT INTO regex_scripts (id, name, script, enabled, source, position, created_at) VALUES (?,?,?,?,?,?,?)",
    ).run(script.id, script.name, JSON.stringify(script), script.enabled ? 1 : 0, source, position, now());
  }
  return script;
}

/**
 * Pulls any regex scripts a preset carries. DEUS EX MACHINA and its kind ship
 * sixty of them inside `extensions.regex_scripts`, and half the preset does
 * not work without them — importing the preset and silently dropping them is
 * how you get a preset that "does nothing".
 */
function importScriptsFrom(json: any, source: string): number {
  const list = json?.extensions?.regex_scripts ?? json?.regex_scripts;
  if (!Array.isArray(list) || !list.length) return 0;
  const base = (db.query("SELECT COUNT(*) AS n FROM regex_scripts WHERE deleted_at IS NULL").get() as any).n;
  list.forEach((r: any, i: number) => saveScript(r, source, base + i));
  return list.length;
}

/* ---- extensions -------------------------------------------------------------
   Other people's code, in two halves: `client` runs in the page, `server` runs
   around the prompt. See src/extensions.ts, which also explains why there is
   no sandbox and why that is stated rather than pretended otherwise. */

const liveExtensions = (): Extension[] =>
  (db.query("SELECT * FROM extensions WHERE deleted_at IS NULL ORDER BY position, created_at").all() as any[])
    .map((r) => normaliseExtension({ ...r, enabled: !!r.enabled }));

/**
 * Rolls dice for the composer.
 *
 * The frontend asks rather than rolling for itself, so there is one
 * implementation of what "2d6+3" means and one place the limits live. It also
 * means a roll you make and a roll a character makes are produced by the same
 * code, which is the least surprising way for a table to work.
 */
/**
 * Makes sure there is somebody to play with before the doors open.
 *
 * Called when entering tabletop mode. An empty library gets the narrator on
 * first run, but a library full of characters and no game master would open
 * onto a table with nobody sitting at it. Idempotent, and it respects a
 * deletion: see narratorMissing().
 */
api.post("/tabletop/narrator", (c) => {
  /*
   * A narrator that already exists is brought through the door rather than
   * made again.
   *
   * Every copy of Hearth from before the two libraries existed has its
   * Gamekeeper filed under 'story', and creating a second one for the table
   * would leave two identical narrators in the list with no way to tell which
   * was which. So the one that is here comes along.
   */
  const standing = db.query(
    "SELECT id, world FROM characters WHERE name = ? AND deleted_at IS NULL LIMIT 1",
  ).get(STARTER.name) as any;
  if (standing) {
    if (standing.world !== "both") {
      db.query("UPDATE characters SET world = 'both' WHERE id = ?").run(standing.id);
    }
    return c.json({ added: false, name: STARTER.name });
  }

  // Deleted on purpose stays deleted, here as everywhere.
  if (!narratorMissing(db)) return c.json({ added: false });
  db.query(
    `INSERT INTO characters
     (id, name, description, personality, scenario, first_message, avatar, created_at,
      mes_example, system_prompt, post_history, alternate_greetings, tags, creator, raw_card,
      world)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(uid(), STARTER.name, STARTER.description, STARTER.personality, STARTER.scenario,
        STARTER.first_message, "", now(), "", STARTER.system_prompt, "",
        JSON.stringify(STARTER.alternate_greetings), JSON.stringify(STARTER.tags),
        STARTER.creator, "", "both");
  return c.json({ added: true, name: STARTER.name });
});

/* ---- character sheets -------------------------------------------------------
   Tabletop mode's other half. A sheet belongs to whoever it is for — a persona
   for the player, a character for anyone the narrator makes — and goes into
   the prompt so the narrator works from the numbers rather than from what it
   remembers deciding. See src/tabletop.ts. */

function sheetFor(ownerId: string | null | undefined): Sheet | null {
  if (!ownerId) return null;
  const row = db.query("SELECT sheet FROM sheets WHERE owner_id = ?").get(ownerId) as any;
  if (!row) return null;
  try { return normaliseSheet(JSON.parse(row.sheet)); } catch { return null; }
}

function saveSheet(ownerId: string, kind: string, sheet: Sheet) {
  db.query(
    `INSERT INTO sheets (owner_id, owner_kind, sheet, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(owner_id) DO UPDATE SET sheet = excluded.sheet, updated_at = excluded.updated_at`,
  ).run(ownerId, kind, JSON.stringify(sheet), now());
}

/** The classes on offer, for the chooser. */
api.get("/tabletop/classes", (c) => c.json(CLASSES));

/* ---- what the game is about -------------------------------------------------
   Asked once, at the top of a new game, straight after the memory book — see
   src/campaigns.ts for why a table needs somebody to have done the reading. */

api.get("/campaigns", (c) => c.json(CAMPAIGNS));

/** One dreamed up on the spot, for the button on the storybook page. */
api.get("/campaigns/dream", (c) => c.json(dreamCampaign()));

/**
 * A few words, written out properly.
 *
 * The die gives you one of Hearth's; this gives you yours. One short call on
 * whatever provider is already configured — the same one the chats use, so
 * there is no second key to set up and no surprise about who is being paid.
 */
api.post("/campaigns/write", async (c) => {
  const { seed, length } = await c.req.json().catch(() => ({}));
  const idea = String(seed ?? "").trim().slice(0, 600);
  if (!idea) return c.json({ error: "Write a few words first." }, 400);

  const s = getSettings();
  let text = "";
  try {
    for await (const chunk of generate({
      provider: s.provider,
      apiKey: s[`key_${s.provider}`] ?? "",
      model: s.model,
      system: WRITE_SYSTEM,
      messages: [{ role: "user", content: writePrompt(idea, length) }],
      // Warm enough to be worth reading, short enough to be cheap, and never
      // streamed: nothing can use half of this.
      sampling: { temperature: 0.95, maxTokens: 600, topP: 1, minP: 0,
                  repetitionPenalty: 1, frequencyPenalty: 0, presencePenalty: 0,
                  stream: false, reasoningEffort: "off" },
    })) {
      if (chunk.kind === "text") text += chunk.text;
    }
  } catch (err: any) {
    return c.json({ error: err?.message ?? "The model could not be reached." }, 502);
  }

  const written = parseWritten(text, length);
  if (!looksWritten(written)) {
    return c.json({ error: "The model did not write a campaign. Try saying a little more." }, 502);
  }
  return c.json({ campaign: normaliseCampaign(written) });
});

function campaignIn(chatId: string): Campaign | null {
  const row = db.query("SELECT campaign FROM chats WHERE id = ?").get(chatId) as any;
  if (!row?.campaign) return null;
  try { return normaliseCampaign(JSON.parse(row.campaign)); } catch { return null; }
}

/**
 * Settling on one — or on none, which is a real answer and is remembered as
 * firmly as any other.
 */
api.put("/chats/:id/campaign", async (c) => {
  const chatId = c.req.param("id");
  if (!db.query("SELECT id FROM chats WHERE id = ?").get(chatId)) {
    return c.json({ error: "Chat not found." }, 404);
  }
  const body = await c.req.json().catch(() => ({}));
  // A prefab arrives by name; the storybook arrives whole. Either way what is
  // stored is the campaign, so editing a prefab afterwards is possible and
  // changing the prefab later cannot rewrite somebody's running game.
  const chosen = body.id ? campaignById(String(body.id)) : null;
  const campaign = normaliseCampaign(chosen ? { ...chosen, ...body.edits } : body.campaign);

  db.query("UPDATE chats SET campaign = ?, campaign_asked = 1 WHERE id = ?")
    .run(campaign ? JSON.stringify(campaign) : "", chatId);

  /*
   * Books the game asked for, bound to the game.
   *
   * Replaced rather than added to, so choosing again in the storybook is not a
   * way to accumulate every book you ever considered — and scoped to the chat,
   * which is the existing mechanism and means nothing here is special.
   */
  db.query("DELETE FROM lorebook_links WHERE scope = 'chat' AND target_id = ?").run(chatId);
  for (const bookId of campaign?.books ?? []) {
    if (!db.query("SELECT id FROM lorebooks WHERE id = ? AND deleted_at IS NULL").get(bookId)) continue;
    db.query("INSERT INTO lorebook_links (id, book_id, scope, target_id) VALUES (?,?,?,?)")
      .run(uid(), bookId, "chat", chatId);
  }
  return c.json({ campaign });
});

api.get("/sheets/:ownerId", (c) => {
  const sheet = sheetFor(c.req.param("ownerId"));
  return c.json({ sheet });
});

/** Makes one: pick a class, and either roll for it or take the even spread. */
api.post("/sheets/:ownerId/roll", async (c) => {
  const { klass, how, kind } = await c.req.json().catch(() => ({}));
  const sheet = makeSheet(String(klass ?? ""), how === "array" ? "array" : "roll");
  if (!sheet) return c.json({ error: "No such class." }, 400);
  saveSheet(c.req.param("ownerId"), String(kind ?? "persona"), sheet);
  return c.json({ sheet });
});

/** Editing one by hand — damage taken, something picked up, a note. */
api.put("/sheets/:ownerId", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const sheet = normaliseSheet(body.sheet ?? body);
  if (!sheet) return c.json({ error: "That is not a sheet." }, 400);
  saveSheet(c.req.param("ownerId"), String(body.kind ?? "persona"), sheet);
  return c.json({ sheet });
});

/**
 * Rolls a check the player asked for, rather than one the narrator asked for.
 *
 * Same code and same sheet as [[check: dex]] in a reply — pressing your own
 * Dexterity on the sheet and being told to roll it by the story should not be
 * two different dice.
 */
api.post("/sheets/:ownerId/check", async (c) => {
  const { ability } = await c.req.json().catch(() => ({}));
  const key = String(ability ?? "").toLowerCase() as Ability;
  if (!(key in ABILITY_NAMES)) return c.json({ error: "No such ability." }, 400);
  const sheet = sheetFor(c.req.param("ownerId"));
  if (!sheet) return c.json({ error: "No sheet to roll against." }, 400);
  const check = abilityCheck(sheet, key);
  return c.json({ check, text: describeCheck(check) });
});

api.delete("/sheets/:ownerId", (c) => {
  db.query("DELETE FROM sheets WHERE owner_id = ?").run(c.req.param("ownerId"));
  return c.json({ ok: true });
});

/* ---- the people and places a narrator invents -------------------------------
   The other half of the bracket protocol: dice and checks let a narrator ask
   Hearth to settle something, and these let it ask Hearth to *keep* something.
   Parsing lives in src/verbs.ts, where it is tested without a database; the
   database is here, because that is what a side effect is. */

/** Everyone this game has met, oldest first — the order they walked in. */
function npcsIn(chatId: string) {
  return db.query(
    "SELECT * FROM npcs WHERE chat_id = ? AND deleted_at IS NULL ORDER BY created_at",
  ).all(chatId) as any[];
}

/**
 * Does what the narrator asked for, and rewrites the reply to what happened.
 *
 * Only in tabletop mode. In a story chat a model that has learnt the notation
 * would start casting the scene — and someone talking to one character does
 * not want a sidebar filling up with everyone that character mentions.
 *
 * Naming somebody twice does not make two of them. It cannot: the narrator
 * will write [[npc: Marla]] again the moment Marla says anything, and a
 * second row would be a second Marla with the same face and half the history.
 * So a name already in this game is a reference to the person, not a new one —
 * though a later, fuller description does update her, since the narrator
 * learning more about its own character is exactly what should be kept.
 */
/**
 * How many alternates a tabletop reply may have, beyond the one it got.
 *
 * Clamped rather than trusted: the setting is a number in a text column and
 * ten is the top of it, so a hand-edited row cannot buy back the unlimited
 * swipes the mode exists to remove.
 */
export const MAX_TABLE_SWIPES = 10;

export function swipeAllowance(): number {
  const n = Number(getSettings().tabletop_swipes);
  if (!Number.isFinite(n)) return 3;
  return Math.max(0, Math.min(MAX_TABLE_SWIPES, Math.round(n)));
}

/** The fight this chat is in the middle of, if it is in the middle of one. */
function fightIn(chatId: string): Fight | null {
  const row = db.query("SELECT fight FROM chats WHERE id = ?").get(chatId) as any;
  if (!row?.fight) return null;
  try { return normaliseFight(JSON.parse(row.fight)); } catch { return null; }
}

function saveFight(chatId: string, fight: Fight | null) {
  db.query("UPDATE chats SET fight = ? WHERE id = ?")
    .run(fight ? JSON.stringify(fight) : "", chatId);
}

/**
 * The player as a combatant: their name, their sheet's health, their reflexes.
 *
 * Null when there is no sheet, and a fight with no player row is still a
 * fight — a narrator describing two wolves tearing into each other should not
 * be refused because nobody has rolled a character yet.
 */
function playerInFight(playerId: string | null | undefined) {
  const sheet = playerId ? sheetFor(playerId) : null;
  if (!sheet) return null;
  const row = db.query("SELECT name FROM personas WHERE id = ?").get(playerId!) as any;
  return {
    name: row?.name || getSettings().persona_name || "You",
    hp: sheet.hp,
    maxHp: sheet.maxHp,
    initiativeBonus: modifier(sheet.abilities.dex),
  };
}

export function applyVerbs(chatId: string, text: string, playerId?: string | null): string {
  /*
   * Fights cannot be settled by reading words alone: initiative needs the
   * player's sheet and damage needs the fight already in progress, neither of
   * which src/verbs.ts is allowed to know about. So it hands them here.
   *
   * Anything this cannot answer comes back null and the brackets stay exactly
   * where the model put them — a [[hit: …]] with no fight running is a model
   * that got ahead of itself, and swallowing it would leave a reply quietly
   * missing a sentence.
   */
  const settle = (intent: Intent): string | null => {
    // Names and places settle themselves and never reach here; saying so is
    // what tells the compiler the rest of this function is about fights.
    if (intent.kind === "npc" || intent.kind === "scene") return null;

    if (intent.kind === "fight") {
      const fight = startFight(intent.foes, playerInFight(playerId));
      if (!fight) return null;
      saveFight(chatId, fight);
      return `[[initiative: ${describeInitiative(fight)}]]`;
    }

    if (intent.kind === "endfight") {
      if (!fightIn(chatId)) return null;
      saveFight(chatId, null);
      return "[[fight over]]";
    }

    const fight = fightIn(chatId);
    if (!fight) return null;

    if (intent.kind === "turn") {
      const up = takeTurn(fight, intent.who);
      if (!up) return null;
      saveFight(chatId, fight);
      return `[[turn: ${up.name}]]`;
    }

    const who = hurt(fight, intent.who, intent.amount);
    if (!who) return null;
    saveFight(chatId, fight);

    /*
     * Damage to the player is damage to their sheet.
     *
     * This is the moment the whole tabletop apparatus pays for itself: the
     * narrator hit you for five, and the number on your sheet in the sidebar
     * went down by five, because they are the same number rather than two
     * accounts of it that drift apart over an evening.
     */
    if (who.player && playerId) {
      const sheet = sheetFor(playerId);
      if (sheet) saveSheet(playerId, "persona", { ...sheet, hp: who.hp });
    }

    const change = intent.amount < 0 ? `+${-intent.amount}` : `-${intent.amount}`;
    return `[[hp: ${who.name} ${change}, ${stateOf(who)}]]`;
  };

  const { text: out, intents } = resolveVerbs(text, settle);
  if (!intents.length) return out;

  for (const intent of intents) {
    if (intent.kind !== "npc" && intent.kind !== "scene") continue;
    if (intent.kind === "scene") {
      db.query("UPDATE chats SET location = ? WHERE id = ?").run(intent.where, chatId);
      continue;
    }
    const existing = db.query(
      "SELECT id, brief FROM npcs WHERE chat_id = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL",
    ).get(chatId, intent.name) as any;
    if (existing) {
      if (intent.brief && intent.brief.length > String(existing.brief).length) {
        db.query("UPDATE npcs SET brief = ? WHERE id = ?").run(intent.brief, existing.id);
      }
      continue;
    }
    db.query(
      "INSERT INTO npcs (id, chat_id, name, brief, avatar, created_at) VALUES (?,?,?,?,?,?)",
    ).run(uid(), chatId, intent.name, intent.brief, null, now());
  }

  /*
   * Nothing left standing ends it, whether or not the narrator says so.
   *
   * A model that has just described the last wolf dying will not always
   * remember to write [[fight: over]], and a fight left running is one that
   * keeps putting a table of corpses into every prompt afterwards. The mark
   * is appended rather than assumed, so the reply still says what happened.
   */
  const after = fightIn(chatId);
  if (after && foesDown(after)) {
    saveFight(chatId, null);
    if (!out.includes("[[fight over]]")) return `${out.trimEnd()}\n\n[[fight over]]`;
  }
  return out;
}

api.get("/chats/:id/npcs", (c) => {
  const id = c.req.param("id");
  const chat = db.query("SELECT location FROM chats WHERE id = ?").get(id) as any;
  return c.json({ npcs: npcsIn(id), location: chat?.location ?? "", fight: fightIn(id) });
});

/**
 * Calling a fight off by hand.
 *
 * The narrator ends one itself nearly always, and the auto-end catches the
 * rest — but a game that wandered off mid-scrap would otherwise carry a table
 * of half-dead wolves into every prompt forever, with no way to say enough.
 */
api.delete("/chats/:id/fight", (c) => {
  saveFight(c.req.param("id"), null);
  return c.json({ ok: true });
});

/**
 * Handing the turn to somebody yourself.
 *
 * The narrator moves the marker nearly always. This is for when it does not —
 * a reply that covered three combatants and named none of them leaves the
 * tracker a step behind, and being unable to nudge it would make the thing an
 * ornament rather than a tracker.
 */
api.put("/chats/:id/fight/turn", async (c) => {
  const chatId = c.req.param("id");
  const fight = fightIn(chatId);
  if (!fight) return c.json({ error: "No fight is happening." }, 400);
  const { name } = await c.req.json().catch(() => ({}));
  if (!takeTurn(fight, String(name ?? ""))) return c.json({ error: "Nobody by that name." }, 400);
  saveFight(chatId, fight);
  return c.json({ fight });
});

/** Editing one by hand: the narrator's first impression is not always right. */
api.put("/npcs/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const cur = db.query("SELECT * FROM npcs WHERE id = ?").get(c.req.param("id")) as any;
  if (!cur) return c.json({ error: "No such person." }, 404);
  db.query("UPDATE npcs SET name = ?, brief = ?, avatar = ? WHERE id = ?").run(
    b.name !== undefined ? String(b.name).slice(0, 60) : cur.name,
    b.brief !== undefined ? String(b.brief).slice(0, 400) : cur.brief,
    b.avatar !== undefined ? String(b.avatar) : cur.avatar,
    c.req.param("id"),
  );
  return c.json(db.query("SELECT * FROM npcs WHERE id = ?").get(c.req.param("id")));
});

// Hidden rather than destroyed, like everything else here. Someone the party
// left behind three towns ago should stop crowding the prompt without being
// unmade — they may walk back in.
api.delete("/npcs/:id", (c) => {
  db.query("UPDATE npcs SET deleted_at = ? WHERE id = ?").run(now(), c.req.param("id"));
  return c.json({ ok: true });
});

/** Where the party is, set by hand rather than by the story reaching it. */
api.put("/chats/:id/location", async (c) => {
  const { location } = await c.req.json().catch(() => ({}));
  db.query("UPDATE chats SET location = ? WHERE id = ?").run(
    String(location ?? "").slice(0, 160), c.req.param("id"));
  return c.json({ ok: true });
});

/**
 * The roll the moment calls for, decided rather than typed.
 *
 * At a table nobody says "one d twenty plus three" — the DM says roll for it
 * and you know which dice to pick up, because you were listening. Asking a
 * player to translate the last paragraph into notation is asking them to do
 * the bookkeeping the sheet exists to do for them.
 *
 * Three situations, in the order they beat each other:
 *
 *   1. A fight is happening, so this is a swing: a d20 and whichever of
 *      strength or dexterity you are actually better with.
 *   2. The narrator asked for something — by name, or by asking you to sneak,
 *      which is the same request without the word. That ability's check.
 *   3. Neither, so a plain d20 and no opinion about it.
 *
 * Story mode never reaches here; its die button still asks, because a chat
 * that is not a game has no situation to read.
 */
api.post("/chats/:id/roll", async (c) => {
  const chatId = c.req.param("id");
  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(chatId) as any;
  if (!chat) return c.json({ error: "Chat not found." }, 404);

  const me = whoAmI(chat.persona_id);
  const sheet = sheetFor(me.id);

  const last = db.query(
    "SELECT content FROM messages WHERE chat_id = ? AND role = 'assistant' ORDER BY created_at DESC, rowid DESC LIMIT 1",
  ).get(chatId) as any;

  const fight = fightIn(chatId);
  const inFight = !!fight?.order.some((x) => x.player && x.hp > 0);

  let ability: Ability | null = null;
  let label = "Roll";
  if (sheet && inFight) {
    ability = modifier(sheet.abilities.str) >= modifier(sheet.abilities.dex) ? "str" : "dex";
    label = "Attack";
  } else if (sheet) {
    ability = abilityAsked(last?.content ?? "");
    if (ability) label = `${ABILITY_NAMES[ability]} check`;
  }

  // No sheet, or nothing asked for: a die is still a die.
  if (!ability) {
    const roll = rollDice("1d20")!;
    return c.json({
      total: roll.total, die: roll.rolls[0], modifier: 0, label: "Roll",
      parts: [{ label: "d20", value: roll.rolls[0] }],
      text: `1d20: ${roll.total}`,
    });
  }

  const check = abilityCheck(sheet!, ability);
  return c.json({
    total: check.total,
    die: check.die,
    modifier: check.modifier,
    label,
    parts: [
      { label: "d20", value: check.die },
      { label: ABILITY_NAMES[ability], value: check.modifier },
    ],
    text: label === "Attack"
      ? `Attack: ${check.die} ${check.modifier < 0 ? "" : "+"}${check.modifier} = ${check.total}`
      : describeCheck(check),
  });
});

api.post("/dice", async (c) => {
  const { notation } = await c.req.json().catch(() => ({ notation: "" }));
  const roll = rollDice(String(notation ?? ""));
  if (!roll) return c.json({ error: `"${String(notation ?? "").slice(0, 40)}" is not dice.` }, 400);
  return c.json({ roll, text: describeRoll(roll) });
});

api.get("/extensions", (c) => c.json(liveExtensions()));

api.post("/extensions", async (c) => {
  const e = normaliseExtension(await c.req.json().catch(() => ({})));
  db.query(
    `INSERT INTO extensions (id, name, version, description, enabled, client, server, position, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(e.id, e.name, e.version, e.description, e.enabled ? 1 : 0, e.client, e.server,
        (db.query("SELECT COUNT(*) n FROM extensions WHERE deleted_at IS NULL").get() as any).n, now());
  return c.json(e);
});

api.put("/extensions/:id", async (c) => {
  const id = c.req.param("id");
  const cur = db.query("SELECT * FROM extensions WHERE id = ?").get(id) as any;
  if (!cur) return c.json({ error: "No such extension." }, 404);
  const e = normaliseExtension({ ...cur, enabled: !!cur.enabled, ...(await c.req.json().catch(() => ({}))), id });
  db.query(
    "UPDATE extensions SET name = ?, version = ?, description = ?, enabled = ?, client = ?, server = ? WHERE id = ?",
  ).run(e.name, e.version, e.description, e.enabled ? 1 : 0, e.client, e.server, id);
  return c.json(e);
});

// Hidden rather than destroyed, like everything else, but kept out of the
// recycle bin: the bin lists things you write — characters, chats, personas,
// presets — and an extension is a thing you install. Same treatment as regex
// scripts, which are the closest neighbour.
/**
 * Installs an extension from a GitHub repository.
 *
 * The only part of this feature that touches the network, deliberately kept in
 * one place: everything about *reading* a repository is pure and lives in
 * src/extinstall.ts, where it is tested without one.
 *
 * Three limits, none of them a security boundary — an extension runs with
 * Hearth's powers once installed, and no amount of care at download time
 * changes that. They are here so that a wrong URL fails quickly and clearly
 * instead of hanging or filling a phone: only GitHub, only so many megabytes,
 * and only files small and textual enough to be source code.
 */
api.post("/extensions/install", async (c) => {
  const { url } = await c.req.json().catch(() => ({ url: "" }));
  const ref = parseRepo(String(url ?? ""));
  if (!ref) return c.json({ error: "That is not a GitHub repository address." }, 400);

  const LIMIT = 8 * 1024 * 1024;
  let zip: Uint8Array | null = null;
  let tried = "";

  for (const address of archiveUrls(ref)) {
    tried = address;
    try {
      const res = await fetch(address, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      const size = Number(res.headers.get("content-length") ?? 0);
      if (size > LIMIT) {
        return c.json({ error: `That repository is ${(size / 1048576).toFixed(0)}MB — too big to be an extension.` }, 400);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      // Servers do not always send a length; check what actually arrived too.
      if (buf.byteLength > LIMIT) {
        return c.json({ error: "That repository is too big to be an extension." }, 400);
      }
      zip = buf;
      break;
    } catch {
      // Try the next branch name, then give up with the message below.
    }
  }

  if (!zip) {
    return c.json({ error: `Could not download ${ref.owner}/${ref.repo}. Is it public, and is the branch right?` }, 400);
  }

  let files: RepoFile[] = [];
  try {
    const dec = new TextDecoder();
    for (const [path, bytes] of Object.entries(unzipSync(zip))) {
      if (path.endsWith("/") || !bytes.byteLength) continue;
      // Source code only. Skipping the rest keeps a repository with images or
      // a vendored dependency in it from being read as megabytes of noise.
      if (!/\.(js|mjs|cjs|json|css|txt|md)$/i.test(path)) continue;
      if (bytes.byteLength > 512 * 1024) continue;
      files.push({ path, text: dec.decode(bytes) });
    }
  } catch {
    return c.json({ error: "That download was not a readable zip." }, 400);
  }

  const built = buildFromRepo(files, `github.com/${ref.owner}/${ref.repo}`);
  if (!built.ok) return c.json({ error: built.reason }, 400);

  const e = built.extension;
  db.query(
    `INSERT INTO extensions (id, name, version, description, enabled, client, server, position, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(e.id, e.name, e.version, e.description, e.enabled ? 1 : 0, e.client, e.server,
        (db.query("SELECT COUNT(*) n FROM extensions WHERE deleted_at IS NULL").get() as any).n, now());

  return c.json(e);
});

api.delete("/extensions/:id", (c) => {
  db.query("UPDATE extensions SET deleted_at = ? WHERE id = ?").run(now(), c.req.param("id"));
  return c.json({ ok: true });
});

api.post("/extensions/delete", async (c) => {
  const { ids } = await c.req.json().catch(() => ({ ids: [] }));
  const list: string[] = Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
  if (!list.length) return c.json({ error: "Nothing to delete." }, 400);
  const at = now();
  const stmt = db.query("UPDATE extensions SET deleted_at = ? WHERE id = ?");
  db.transaction((rows: string[]) => { for (const id of rows) stmt.run(at, id); })(list);
  return c.json({ deleted: list.length });
});

api.get("/regex", (c) => c.json(liveScripts()));

/** Import: one script, an array, or anything with `regex_scripts` inside it. */
api.post("/regex/import", async (c) => {
  const body = await c.req.json().catch(() => null);
  const source = String((body as any)?.source ?? "").trim();
  const raw = (body as any)?.scripts ?? body;
  const list: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.regex_scripts) ? raw.regex_scripts
    : Array.isArray(raw?.extensions?.regex_scripts) ? raw.extensions.regex_scripts
    : raw && typeof raw === "object" ? [raw] : [];
  if (!list.length) return c.json({ error: "No regex scripts in that file." }, 400);

  const base = (db.query("SELECT COUNT(*) AS n FROM regex_scripts WHERE deleted_at IS NULL").get() as any).n;
  list.forEach((r, i) => saveScript(r, source, base + i));
  return c.json({ imported: list.length });
});

api.post("/regex/:id/toggle", (c) => {
  const id = c.req.param("id");
  db.query("UPDATE regex_scripts SET enabled = 1 - enabled WHERE id = ?").run(id);
  const row = db.query("SELECT enabled FROM regex_scripts WHERE id = ?").get(id) as any;
  return c.json({ enabled: !!row?.enabled });
});

api.delete("/regex/:id", (c) => {
  db.query("UPDATE regex_scripts SET deleted_at = ? WHERE id = ?").run(now(), c.req.param("id"));
  return c.json({ ok: true });
});

api.post("/regex/delete", async (c) => {
  const { ids } = await c.req.json().catch(() => ({ ids: [] }));
  const list: string[] = Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
  if (!list.length) return c.json({ error: "Nothing to delete." }, 400);
  const at = now();
  const stmt = db.query("UPDATE regex_scripts SET deleted_at = ? WHERE id = ?");
  db.transaction((rows: string[]) => { for (const id of rows) stmt.run(at, id); })(list);
  return c.json({ deleted: list.length });
});

// ---- presets --------------------------------------------------------------

/** Preset values override the stored settings for sampling only. */
export function withPreset(s: Record<string, string>) {
  // The table runs on its own; see src/tablepreset.ts for why it is built in
  // rather than seeded into the list where it could be edited away.
  const d: any = tablePresetOn(s) ? TABLE_PRESET : readActivePreset();
  if (!d) return s;
  const out = { ...s };
  for (const f of PRESET_FIELDS) if (d[f] !== undefined && d[f] !== "") out[f] = String(d[f]);
  return out;
}

function readActivePreset(): any | null {
  const p = db.query("SELECT data FROM presets WHERE is_active = 1 AND deleted_at IS NULL LIMIT 1").get() as
    | { data: string } | undefined;
  if (!p) return null;
  try { return JSON.parse(p.data); } catch { return null; }
}

/**
 * Every block the active preset declares, enabled or not, in listed order.
 * The caller filters: whether a block is switched off is sometimes the point,
 * as with a `jailbreak` marker that exists only to be turned off.
 */
export function allBlocks(): PromptBlock[] {
  if (tablePresetOn(getSettings())) return normaliseBlocks(TABLE_PRESET.blocks);
  const d = readActivePreset();
  return d ? normaliseBlocks(d.blocks) : [];
}

api.get("/presets", (c) =>
  c.json(db.query("SELECT * FROM presets WHERE deleted_at IS NULL ORDER BY is_active DESC, name COLLATE NOCASE").all()),
);

api.post("/presets", async (c) => {
  const b = await c.req.json();
  if (!b.name?.trim()) return c.json({ error: "A preset needs a name." }, 400);
  const id = uid();
  const first = (db.query("SELECT COUNT(*) AS n FROM presets WHERE deleted_at IS NULL").get() as any).n === 0;
  db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES (?,?,?,?,?)")
    .run(id, b.name.trim(), JSON.stringify(b.data ?? {}), first ? 1 : 0, now());
  return c.json({ id });
});

api.put("/presets/:id", async (c) => {
  const b = await c.req.json();
  db.query("UPDATE presets SET name = ?, data = ? WHERE id = ?")
    .run(b.name, JSON.stringify(b.data ?? {}), c.req.param("id"));
  return c.json({ ok: true });
});

/**
 * Write sampling values back into a preset without touching its blocks.
 *
 * While a preset is active it overrides these fields, so editing the global
 * settings had no visible effect at all — the Sampling panel looked broken
 * because it was, from where the user was standing. This is what that panel
 * saves to instead when something is active.
 */
api.post("/presets/:id/sampling", async (c) => {
  const id = c.req.param("id");
  const row = db.query("SELECT data FROM presets WHERE id = ? AND deleted_at IS NULL").get(id) as
    | { data: string } | undefined;
  if (!row) return c.json({ error: "Preset not found." }, 404);
  const patch = await c.req.json().catch(() => ({}));
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(row.data) ?? {}; } catch {}
  for (const f of PRESET_FIELDS) {
    const v = (patch as Record<string, unknown>)[f];
    if (v !== undefined) data[f] = String(v);
  }
  db.query("UPDATE presets SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
  return c.json({ ok: true });
});

api.post("/presets/:id/activate", (c) => {
  db.query("UPDATE presets SET is_active = 0").run();
  db.query("UPDATE presets SET is_active = 1 WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

/** No preset at all: the stored settings and the default blocks take over. */
api.post("/presets/none", (c) => {
  db.query("UPDATE presets SET is_active = 0").run();
  return c.json({ ok: true });
});

api.delete("/presets/:id", (c) => softDelete("presets", [c.req.param("id")]));

/** Several at once, with one undo ticket covering the lot. */
api.post("/presets/delete", async (c) => {
  const { ids } = await c.req.json().catch(() => ({ ids: [] }));
  const list: string[] = Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
  if (!list.length) return c.json({ error: "Nothing to delete." }, 400);
  return softDelete("presets", list);
});

api.post("/import/presets", async (c) => {
  const form = await c.req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const imported: string[] = [];
  for (const f of files) {
    try {
      const json = JSON.parse(await f.text());
      const { name, data } = fromSillyTavern(json);
      const label = name === "Imported preset" ? f.name.replace(/\.json$/i, "") : name;
      db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES (?,?,?,?,?)")
        .run(uid(), label, JSON.stringify(data), 0, now());
      importScriptsFrom(json, label);
      imported.push(label);
    } catch {}
  }
  if (!imported.length) return c.json({ error: "No readable presets in those files." }, 400);
  return c.json({ imported });
});

// ---- full SillyTavern backup ---------------------------------------------

// ---- browsing the machine ------------------------------------------------
// Hearth already runs beside SillyTavern, so the shortest path to your library
// is to read it off the disk rather than push it through the browser.

api.get("/fs/list", (c) => c.json(listDir(c.req.query("path"))));
api.get("/fs/places", (c) => c.json(places()));

/**
 * Accepts a whole SillyTavern folder, a zip of one, or loose files — the
 * browser sends each with its relative path, and zips are expanded in place.
 * Streams progress, since a large library takes a while.
 */
api.post("/import/backup", async (c) => {
  /**
   * Restoring reads the whole body into memory and then inflates every entry
   * of the archive at once, so peak memory runs to a few times the file size.
   * Bun on a desktop copes; the embedded runtime on a phone is killed by the
   * system, and a native abort cannot be caught or turned into a message —
   * the app just disappears in the middle of a restore. The mobile build sets
   * a ceiling (see mobile/server/prelude.js); nothing sets one on the desktop.
   */
  const cap = (globalThis as { __hearthMaxUpload?: number }).__hearthMaxUpload;
  const declaredSize = Number(c.req.header("content-length") ?? 0);
  if (cap && declaredSize > cap) {
    const mb = (n: number) => `${Math.round(n / 1048576)} MB`;
    return c.json({
      error: `That backup is ${mb(declaredSize)}, and this phone can restore about ` +
             `${mb(cap)} at a time. Restore it on the desktop and the two will match, ` +
             `or bring it over in pieces — characters, then lorebooks, then presets.`,
    }, 413);
  }

  const form = await c.req.formData();

  const localPath = String(form.get("localPath") ?? "");
  const incoming: { file: File; path: string }[] = [];
  const single = form.get("file");
  if (single instanceof File) incoming.push({ file: single, path: single.name });
  for (const value of form.getAll("files")) {
    if (value instanceof File) incoming.push({ file: value, path: value.name });
  }
  const declared = form.getAll("paths").map(String);
  incoming.forEach((e, i) => { if (declared[i]) e.path = declared[i]; });

  if (!incoming.length && !localPath) return c.json({ error: "No files received." }, 400);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      /**
       * Where an archive is unpacked to, when the source is one. Declared out
       * here so the finally below can remove it however this ends.
       */
      let stage: string | null = null;
      const send = (o: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      // Give the browser a chance to paint between chunks of work.
      const breathe = () => new Promise((r) => setTimeout(r, 0));

      try {
        send({ stage: "Reading what you gave me", done: 0, total: 1 });

        // Paths and thunks, not bytes — a whole SillyTavern folder read at once
        // is a gigabyte or two of character art. See Entry in backup.ts.
        const entries: Entry[] = [];

        /**
         * A staging folder, used only when the source is an archive. Entries
         * are written out one at a time as the zip streams past, so the rest
         * of the import can read them lazily like any folder — and a four
         * gigabyte backup never exists in memory, only the entry being read.
         * Cleaned up in the finally below, whether this succeeds or not.
         */
        if (localPath && /\.zip$/i.test(localPath)) {
          send({ stage: "Opening the archive", done: 0, total: 1 });
          stage = join(DATA, "import-staging", uid());
          mkdirSync(stage, { recursive: true });
          let unpacked = 0;
          const { seen, taken } = await eachZipEntry(localPath, isWanted, (name) => {
            // A zip may name an entry anything at all, including its way out
            // of the folder it is being written to.
            const safe = name.split("/").filter((p) => p && p !== "." && p !== "..").join("/");
            if (!safe) return null;
            const dest = join(stage!, safe);
            mkdirSync(dirname(dest), { recursive: true });
            entries.push({ path: safe, read: () => new Uint8Array(readFileSync(dest)) });
            if (++unpacked % 25 === 0) send({ stage: `Unpacking — ${unpacked} files`, done: 0, total: 1 });
            return dest;
          });
          send({ stage: `Unpacked ${taken} of ${seen} files`, done: 0, total: 1 });
          if (!entries.length) throw new Error("Nothing importable was found in that archive.");
        } else if (localPath) {
          send({ stage: `Reading ${localPath}`, done: 0, total: 1 });
          const got = collect(localPath);
          entries.push(...got.entries);
          if (!entries.length) throw new Error("Nothing importable was found in that folder.");
        }

        for (const { file, path } of incoming) {
          const raw = new Uint8Array(await file.arrayBuffer());
          if (/\.zip$/i.test(path)) entries.push(...readZip(raw));
          else entries.push({ path, read: () => raw });
        }
        const plan = planBackup(entries);

        const total =
          plan.characters.length + plan.personas.length + plan.lorebooks.length +
          plan.presets.length + plan.backgrounds.length + plan.chats.length;
        let done = 0;
        const step = (stage: string) => send({ stage, done: ++done, total });

        const count = { characters: 0, personas: 0, lorebooks: 0, presets: 0, chats: 0, backgrounds: 0 };
        const charIds = new Map<string, string>();

        for (const ch of plan.characters) {
          let avatar: string | null = null;
          if (ch.png) {
            const n = `${uid()}.png`;
            await writeFile(join(UPLOADS, n), ch.png());
            avatar = `/uploads/${n}`;
          }
          const id = uid();
          const k = ch.card;
          db.query(
            `INSERT INTO characters
             (id, name, description, personality, scenario, first_message, avatar, created_at,
              mes_example, system_prompt, post_history, alternate_greetings, tags, creator, raw_card)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).run(id, k.name, k.description, k.personality, k.scenario, k.first_message, avatar, now(),
            k.mes_example, k.system_prompt, k.post_history,
            JSON.stringify(k.alternate_greetings), JSON.stringify(k.tags), k.creator,
            JSON.stringify(k.raw));
          charIds.set(k.name, id);
          charIds.set(ch.file.replace(/\.png$/i, ""), id);

          // A card can carry its own book. Bring it in bound to this character.
          const book = (k.character_book ?? null) as any;
          const bookEntries = book ? normaliseBook(book) : [];
          if (bookEntries.length) {
            const bookId = uid();
            db.query("INSERT INTO lorebooks (id, name, entries, created_at) VALUES (?,?,?,?)")
              .run(bookId, book?.name?.trim() || `${k.name}'s lore`, JSON.stringify(bookEntries), now());
            db.query("INSERT INTO lorebook_links (id, book_id, scope, target_id) VALUES (?,?,?,?)")
              .run(uid(), bookId, "character", id);
            count.lorebooks++;
          }
          count.characters++;
          step(`Characters — ${k.name}`);
          if (count.characters % 10 === 0) await breathe();
        }

        const havePersona = (db.query("SELECT COUNT(*) AS n FROM personas WHERE deleted_at IS NULL").get() as any).n > 0;
        let firstPersona = !havePersona;
        for (const p of plan.personas) {
          let avatar: string | null = null;
          const b = p.avatarFile ? plan.avatars.get(p.avatarFile) : null;
          if (b) {
            const n = `${uid()}.png`;
            await writeFile(join(UPLOADS, n), b());
            avatar = `/uploads/${n}`;
          }
          const pid = uid();
          db.query("INSERT INTO personas (id, name, description, avatar, is_active, created_at) VALUES (?,?,?,?,?,?)")
            .run(pid, p.name, p.description, avatar, 0, now());
          if (p.active || firstPersona) {
            db.query("UPDATE personas SET is_active = 0").run();
            db.query("UPDATE personas SET is_active = 1 WHERE id = ?").run(pid);
          }
          firstPersona = false;
          count.personas++;
          step(`Personas — ${p.name}`);
        }

        for (const lb of plan.lorebooks) {
          db.query("INSERT INTO lorebooks (id, name, entries, created_at) VALUES (?,?,?,?)")
            .run(uid(), lb.name, JSON.stringify(normaliseBook(lb.entries)), now());
          count.lorebooks++;
          step(`Lorebooks — ${lb.name}`);
        }

        for (const pr of plan.presets) {
          const { name, data } = fromSillyTavern(pr.json);
          const label = name === "Imported preset" ? pr.name : name;
          db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES (?,?,?,?,?)")
            .run(uid(), label, JSON.stringify(data), 0, now());
          importScriptsFrom(pr.json, label);
          count.presets++;
          step(`Presets — ${pr.name}`);
        }

        for (const bg of plan.backgrounds) {
          await writeFile(join(WALLS, `${uid()}-${bg.name.replace(/[^\w.-]/g, "_")}`), bg.read());
          count.backgrounds++;
          step(`Backgrounds — ${bg.name}`);
          if (count.backgrounds % 10 === 0) await breathe();
        }

        for (const chat of plan.chats) {
          const charId = charIds.get(chat.character);
          if (!charId) { step("Chats — skipped, no matching character"); continue; }
          const chatId = uid();
          const t = now();
          db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
            .run(chatId, charId, chat.file.replace(/\.jsonl$/i, ""), t, t);

          const ins = db.query(
            "INSERT INTO messages (id, chat_id, role, name, content, created_at, swipes, swipe_index) VALUES (?,?,?,?,?,?,?,?)",
          );
          let n = 0;
          db.transaction(() => {
            for (const line of chat.lines) {
              if (line.mes === undefined) continue;
              ins.run(uid(), chatId, line.is_user === true ? "user" : "assistant",
                line.name ?? "", String(line.mes), t + n,
                JSON.stringify(Array.isArray(line.swipes) ? line.swipes : [String(line.mes)]),
                typeof line.swipe_id === "number" ? line.swipe_id : 0);
              n++;
            }
          })();
          if (n === 0) db.query("DELETE FROM chats WHERE id = ?").run(chatId);
          else count.chats++;
          step(`Chats — ${chat.character}`);
          await breathe();
        }

        send({ finished: true, count, notes: plan.notes.slice(0, 12) });
      } catch (e: any) {
        send({ error: `Could not read that archive. ${e?.message ?? ""}` });
      } finally {
        // Whatever happened, the unpacked copy has served its purpose. Leaving
        // it would quietly cost as much disk as the parts of the backup worth
        // importing, every time one is imported.
        if (stage) {
          try {
            const { rmSync } = await import("node:fs");
            rmSync(stage, { recursive: true, force: true });
          } catch {}
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
});

// ---- personas -------------------------------------------------------------

/**
 * Who you are, in whichever room you are standing in.
 *
 * Story mode uses the `is_active` flag, as it always has. The table keeps its
 * own answer in settings instead of a second flag on the row, because the two
 * have to be able to disagree: picking a character to play at a table must not
 * quietly change who your stories have been talking to for a year.
 *
 * A table persona that has since been deleted, or sent back to the library,
 * counts as no answer — you are nobody in particular until you say otherwise,
 * which is the same state a fresh copy of Hearth starts in.
 */
const activePersona = () => {
  if (currentWorld() === "tabletop") {
    const id = getSettings().tabletop_persona;
    return (id
      ? db.query(
          `SELECT * FROM personas WHERE id = ? AND deleted_at IS NULL
           AND (world = 'tabletop' OR world = 'both')`,
        ).get(id)
      : undefined) as any;
  }
  return db.query(
    `SELECT * FROM personas WHERE is_active = 1 AND deleted_at IS NULL
     AND (world = 'story' OR world = 'both') LIMIT 1`,
  ).get() as { name: string; description: string; avatar: string | null } | undefined;
};

/** Falls back to the plain settings fields when no persona has been made yet. */
export function whoAmI(chatPersonaId?: string | null) {
  const p = chatPersonaId
    ? (db.query("SELECT * FROM personas WHERE id = ? AND deleted_at IS NULL").get(chatPersonaId) as any)
      ?? activePersona()
    : activePersona();
  const s = getSettings();
  return {
    // The id comes back too, so tabletop mode can find whose sheet this is.
    id: p?.id ?? null,
    name: p?.name || s.persona_name || "You",
    description: p?.description || s.persona_description || "",
    avatar: p?.avatar || null,
  };
}

/**
 * Yours, in this room. The active one is marked so the list can show it,
 * since at the table "active" lives in settings rather than on the row.
 */
api.get("/personas", (c) => {
  const mine = getSettings().tabletop_persona;
  const rows = db.query(
    `SELECT * FROM personas WHERE deleted_at IS NULL AND ${worldWhere("personas")}
     ORDER BY is_active DESC, name COLLATE NOCASE`,
  ).all() as any[];
  if (currentWorld() !== "tabletop") return c.json(rows);
  return c.json(rows.map((p) => ({ ...p, is_active: p.id === mine ? 1 : 0 })));
});

/** Everyone of yours who is not in this room, for the picker. */
api.get("/personas/elsewhere", (c) =>
  c.json(db.query(
    `SELECT id, name, avatar, description FROM personas
     WHERE deleted_at IS NULL AND NOT ${worldWhere("personas")}
     ORDER BY name COLLATE NOCASE`,
  ).all()),
);

/** Bringing one to the table, or sending them home. Same rules as a character. */
api.put("/personas/:id/world", async (c) => {
  const id = c.req.param("id");
  const row = db.query("SELECT world FROM personas WHERE id = ?").get(id) as any;
  if (!row) return c.json({ error: "No such persona." }, 404);
  const { at } = await c.req.json().catch(() => ({}));
  const here = currentWorld();
  const world = at
    ? (row.world === "both" || row.world === here ? row.world : "both")
    : (here === "tabletop" ? "story" : "tabletop");
  db.query("UPDATE personas SET world = ? WHERE id = ?").run(world, id);
  // Somebody sent home cannot go on being who you are at the table.
  if (!at && here === "tabletop" && getSettings().tabletop_persona === id) {
    setSettings({ tabletop_persona: "" });
  }
  return c.json({ world });
});

api.post("/personas", async (c) => {
  const b = await c.req.json();
  if (!b.name?.trim()) return c.json({ error: "A persona needs a name." }, 400);
  const id = uid();
  const here = currentWorld();
  // The first persona in this room is the one you are, since there is nothing
  // else it could mean. Counted per room, so making one at the table does not
  // depend on whether your library already has thirty.
  const first = (db.query(
    `SELECT COUNT(*) AS n FROM personas WHERE deleted_at IS NULL AND ${worldWhere("personas")}`,
  ).get() as any).n === 0;
  db.query(
    "INSERT INTO personas (id, name, description, avatar, is_active, created_at, world) VALUES (?,?,?,?,?,?,?)",
  ).run(id, b.name.trim(), b.description ?? "", b.avatar ?? null,
        first && here !== "tabletop" ? 1 : 0, now(), here);
  if (first && here === "tabletop") setSettings({ tabletop_persona: id });
  return c.json({ id });
});

api.put("/personas/:id", async (c) => {
  const b = await c.req.json();
  db.query("UPDATE personas SET name = ?, description = ? WHERE id = ?")
    .run(b.name, b.description ?? "", c.req.param("id"));
  return c.json({ ok: true });
});

api.post("/personas/:id/activate", (c) => {
  // At the table this is a setting, so that choosing who to play tonight
  // leaves whoever your stories have been using exactly where they were.
  if (currentWorld() === "tabletop") {
    setSettings({ tabletop_persona: c.req.param("id") });
    return c.json({ ok: true });
  }
  db.query("UPDATE personas SET is_active = 0").run();
  db.query("UPDATE personas SET is_active = 1 WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

api.delete("/personas/:id", (c) => {
  const res = softDelete("personas", [c.req.param("id")]);
  ensureActivePersona();
  return res;
});

api.post("/characters/:id/avatar", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "No image received." }, 400);
  const name = `${uid()}.${(file.name.split(".").pop() ?? "png").toLowerCase().slice(0, 5)}`;
  await writeFile(join(UPLOADS, name), await file.arrayBuffer());
  db.query("UPDATE characters SET avatar = ? WHERE id = ?").run(`/uploads/${name}`, c.req.param("id"));
  return c.json({ url: `/uploads/${name}` });
});

api.post("/personas/:id/avatar", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "No image received." }, 400);
  const name = `${uid()}.${(file.name.split(".").pop() ?? "png").toLowerCase().slice(0, 5)}`;
  await writeFile(join(UPLOADS, name), await file.arrayBuffer());
  db.query("UPDATE personas SET avatar = ? WHERE id = ?").run(`/uploads/${name}`, c.req.param("id"));
  return c.json({ url: `/uploads/${name}` });
});

app.route("/api", api);

/**
 * Everything below this line used to live here too: mounting `/uploads/*`
 * and `/*` as static file servers, and the Bun-serve bootstrap at the very
 * bottom. Both are genuinely platform-specific — Bun and Node serve static
 * files through different APIs, and only Bun understands the `export default
 * { port, fetch, idleTimeout }` shape. `app` is the entire, complete Hono
 * application; how a given OS listens for a request is not this file's
 * problem. `src/serve.ts` (desktop, Bun) and `mobile/server/serve.mobile.ts`
 * (Android, Node) each add their own static mounts to this same `app` and
 * start their own listener. The test suite calls `app.fetch(request)`
 * directly and needs neither file.
 */
export { app };
