import { Hono } from "hono";
import { writeFile } from "./fsx";
import { db, uid, now, getSettings, setSettings, KEY_FIELDS, mergeDatabase, settle } from "./db";
import { generate, PROVIDERS } from "./providers";

/**
 * The connection half of a generate() call, from settings.
 *
 * A helper because five call sites were each spelling out which key goes with
 * which provider, and adding a custom endpoint would have meant teaching all
 * five about a base address and a wire format. They ask for a connection now
 * and do not know there is more than one kind.
 */
function connectionFrom(s: Record<string, string>, provider = s.provider) {
  return {
    provider,
    apiKey: s[`key_${provider}`] ?? "",
    baseUrl: s.custom_base ?? "",
    format: (s.custom_format ?? "openai") as "openai" | "anthropic" | "responses",
  };
}
import { dirname, join } from "node:path";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { buildParts, buildMessages, buildPostHistory, estimateTokens, macros, stripSpeakerLabel, type Character } from "./prompt";
import { namedIn, recall, recallBrief, related } from "./recall";
import { active as stillGoing, gossipDay, gossipOf, told as knowingTold, willSpread, type Knowing } from "./whispers";
import { entryFromNote, freshCount, isDue, messagesForNote, notePrompt, parseNote, NOTE_SYSTEM, type Scope } from "./autolore";
import { CARRY_SYSTEM, carryEntry, carryPrompt, carriedTitle, cleanSummary, recentFor, tailBudget } from "./carryon";
import { normaliseExtension, runServerHook, type Extension } from "./extensions";
import { archiveUrls, buildFromRepo, parseRepo, type RepoFile } from "./extinstall";
import { DICE_BRIEF, describeRoll, resolveRolls, rollDice } from "./dice";
import { ABILITY_NAMES, CHECK_BRIEF, CLASSES, abilityAsked, abilityCheck, afterTime, askedFor, describeCheck, makeSheet, modifier, provideClasses, provideRaces,
         normaliseSheet, resolveChecks, sheetForPrompt, type Ability, type Sheet } from "./tabletop";
import { LEVELS, difficultyForPrompt } from "./difficulty";
import { bookIsUsable, seedFromBook } from "./frombook";
import { readPassport, writePassport } from "./passport";
import { soundFor, wallpaperFor } from "./scenery";
import { applyRace, looksWritten as kitWritten, normaliseKit, raceForPrompt, type Kit } from "./kits";
import { closeDoor, doorState, openDoor } from "./door";
import { hostingState, setHosting } from "./hosting";
import {
  clearRoom, guestMayTouch, isLoopback, newToken, publicPlayer, publish, sameToken, subscribe,
  treatAsHost,
  tidyPlayerName,
} from "./share";
import { FIGHT_BRIEF, describeInitiative, fightForPrompt, foesDown, hurt, normaliseFight, takeTurn,
         startFight, stateOf, type Fight } from "./fight";
import { VERB_BRIEF, resolveVerbs, type Intent } from "./verbs";
import { STARTER, libraryIsEmpty, narratorMissing } from "./starter";
import { WRITE_APOC_SYSTEM, catchUpTo, steeringOf, advance, apocFieldPrompt, apocWritePrompt, cleanField, briefFor, jumpTo, normaliseChapters, readBookmark, readImport, readOutline, scenesOf, startBookmark, toOutline, type Apocryphon, type Bookmark } from "./apocrypha";
import { BUILTINS, UNDATED, builtin, format as formatDate, fromParts, later, minutesPerDay, normaliseCalendar, partOf, readSpan, type Calendar } from "./calendar";
import { armsFromName, chargeFor, drawArms, normaliseBlazon, uploadProblem, UPLOAD_GUIDE, withContrast, type Blazon } from "./heraldry";
import { BOND_START, STATUS_FIELDS, bondsOf, clockOf, factionsOf, threadsOf, live as liveEntries, forBranch, forCarryOn, normaliseEntry as normaliseChronicleEntry, pending, statusOf, view as chronicleView, type Entry as ChronicleEntry } from "./chronicle";
import { ACTORS_PER_RUN, OFFSTAGE_SYSTEM, identityOf, levelOf, names as namesIn, offstagePrompt, pressureOf, protectionOf, readDecision,
         resolve as resolveAttempt, rule as ruleOn, traceOf, discretionOf, type Discretion, type Agenda, type View } from "./offstage";
import { DEFAULT_LIMITS, checkAnswer, fieldOf, groupKey, needsFoldedSystem, storyOnly, stewardRequest, wayOf, withoutThinking, type Claim, type Passage, type Person } from "./steward";
import { unzipSync } from "fflate";
import { readCard, writeCardPng, toCard } from "./cards";
import { packIsUsable, readPackManifest, slugId } from "./avatar";
import { listModels } from "./models";
import { readZip, planBackup, eachZipEntry, type Entry } from "./backup";
import { listDir, inspect, collect, places, isWanted } from "./localfs";
import { normaliseBook, normaliseEntry, activate, place, type LoreEntry } from "./lore";
import {
  PRESET_FIELDS, DEFAULT_BLOCKS, fromHearth, fromSillyTavern, isHearthPreset, keptOnly, normaliseBlocks,
  toSillyTavernPreset, type PresetData, type PromptBlock,
} from "./presets";
import { TABLE_PRESET, tablePresetOn } from "./tablepreset";
import { WRITE_SYSTEM, looksWritten, parseWritten, writePrompt } from "./campaignwrite";
import { CAMPAIGNS, campaignById, campaignForPrompt, dreamCampaign, normaliseCampaign, openingBrief,
         type Campaign } from "./campaigns";
import {
  PLACEMENT, RUNS_HERE, applies, applyScripts, compileError, matchesOf, normaliseScript, runScript,
  toSillyTavern as scriptToSillyTavern, type RegexScript,
} from "./regex";

const DATA = process.env.DATA_DIR ?? "./data";
const UPLOADS = join(DATA, "uploads");
const WALLS = join(DATA, "uploads", "wallpapers");
mkdirSync(UPLOADS, { recursive: true });
mkdirSync(WALLS, { recursive: true });

const app = new Hono();
const api = new Hono();

// ---- who is asking --------------------------------------------------------

/**
 * The gate.
 *
 * Everything else in Hearth was written for a program with exactly one user,
 * sitting at the machine it runs on: no accounts, no login, bound to loopback,
 * the API keys in the same database as the chats. Playing with somebody in
 * another country means putting that program on the open internet, and this is
 * the single place where that stops being reckless.
 *
 * The rule is short enough to hold in your head, which is the point:
 *
 *   - from this machine        -> the host. Everything, exactly as before.
 *   - a valid player token     -> a guest. Their table, and nothing else.
 *   - anything else            -> nothing at all.
 *
 * One gate rather than a check on each route. Forty routes each remembering to
 * ask is forty chances to forget, and the failure is silent and total: the
 * route that forgets is the route that hands a stranger `key_openrouter`.
 *
 * The scope lives on the context so routes can read it without repeating the
 * lookup, but no route is *trusted* to — a guest reaching a route that is not
 * on the allow list has already been turned away before the route runs.
 */
type Caller =
  | { kind: "host" }
  | { kind: "guest"; share: any; player: any };

const callerOf = new WeakMap<object, Caller>();
/** The caller for this request. Routes read it; the gate below sets it. */
function caller(c: any): Caller {
  return callerOf.get(c.req.raw) ?? { kind: "host" };
}
function guestOf(c: any) {
  const who = caller(c);
  return who.kind === "guest" ? who : null;
}

/**
 * Requests that arrived through the front door rather than from this machine.
 *
 * The hole this closes, found by opening a real tunnel and asking it for the
 * settings: cloudflared connects to localhost, so every request it forwards
 * *arrives from loopback* — and loopback was the whole basis for "this is the
 * owner". A tunnel in front of the server therefore handed the entire library
 * to anyone who had the address. Any reverse proxy does the same thing.
 *
 * So the tunnel gets a listener of its own, and everything through it is
 * marked before it reaches the gate. Not a header check — headers are a
 * guess about who is in front of you, and this is a fact about which socket
 * the bytes came in on.
 */
const throughTheDoor = new WeakSet<object>();
export function markPublic(req: Request): void {
  throughTheDoor.add(req);
}

/**
 * The address the request came from, however the runtime chooses to say it.
 *
 * Bun hands `Bun.serve`'s server object to `app.fetch` as the second argument,
 * which Hono then calls `c.env` — so the address comes from
 * `c.env.requestIP(request)`, and not from anything nested under `.server`.
 * Node's adapter puts the socket on `c.env.incoming`. Getting this wrong is
 * not a small bug: an unrecognised shape reads as "no address", and the whole
 * gate below is built on knowing where a request came from.
 */
function remoteAddr(c: any): string {
  const env = c.env ?? {};
  const bun = typeof env.requestIP === "function" ? env.requestIP(c.req.raw) : null;
  const info = bun?.address
    ?? env.incoming?.socket?.remoteAddress
    ?? env.server?.requestIP?.(c.req.raw)?.address
    ?? env.remoteAddr?.hostname
    ?? "";
  return String(info ?? "");
}

/**
 * Is this copy listening anywhere but this machine?
 *
 * The whole reason the question matters: bound to loopback, a request with no
 * address we recognise can only have come from here, and treating it as local
 * is both safe and necessary — otherwise an unfamiliar runtime locks the owner
 * out of their own program. Bound to 0.0.0.0, the same unknown address might
 * have come from anywhere on earth, and guessing "local" hands over the keys.
 *
 * So the default flips with the binding, and it flips towards refusing. This
 * is not hypothetical tidiness: the first version trusted an unknown address
 * everywhere, every test passed because the tests supply an address, and on
 * the one runtime this actually ships on the lookup returned nothing — so the
 * gate was wide open on the LAN while its own suite reported it shut.
 */
const BOUND_WIDE = !isLoopback(process.env.HOST ?? "127.0.0.1");

/** One cookie out of a Cookie header, undecoded names and all. */
function cookie(raw: string, want: string): string {
  for (const part of String(raw ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === want) return decodeURIComponent(v.join("="));
  }
  return "";
}

/** The player's token, from the cookie the join page set. */
function playerToken(c: any): string {
  // Falls back to a header, which is what a non-browser client would send.
  return cookie(c.req.header("cookie") ?? "", PLAYER_COOKIE)
    || c.req.header("x-hearth-player") || "";
}
const PLAYER_COOKIE = "hearth_player";

/**
 * The host's own key, for when the host is not sitting at the machine.
 *
 * Binding to 0.0.0.0 to reach your own server from your own phone is a
 * perfectly ordinary thing to want, and until this existed it did not work at
 * all: the gate trusts loopback, everything else needs an invitation, and an
 * invitation seats you as a guest who may see one table and nothing else. So
 * the app loaded and every endpoint answered 403 — a working shell around
 * nothing, which is exactly what it looked like.
 *
 * The answer is not to trust the local network. A network you do not control
 * is not a credential, and "it is only my wifi" stops being true the moment it
 * isn't. This is the same thing Jupyter does: a key, printed once where only
 * somebody with access to the machine can read it, exchanged for a cookie.
 */
const HOST_COOKIE = "hearth_host";

function hostToken(c: any): string {
  return cookie(c.req.header("cookie") ?? "", HOST_COOKIE)
    || c.req.header("x-hearth-host") || "";
}

/**
 * The key, made on first need and kept.
 *
 * Stable across restarts, because a key that changes every boot means finding
 * the console again every time — and a key nobody can find is a key everybody
 * works around.
 */
export function hostKey(): string {
  const have = (getSettings().host_key ?? "").trim();
  if (have) return have;
  const made = newToken();
  setSettings({ host_key: made });
  return made;
}

/** Whether this request carries the host's key. */
function carriesHostKey(c: any): boolean {
  const given = hostToken(c);
  return !!given && sameToken((getSettings().host_key ?? "").trim(), given);
}

app.use("/api/*", async (c, next) => {
  const addr = remoteAddr(c);
  /*
   * Through the public listener, or carrying the marks of a proxy we did not
   * put there: either way the address on the socket is not the caller's, and
   * loopback stops meaning anything. The header check is a backstop for
   * somebody pointing their own proxy at the ordinary port — it cannot be
   * relied on alone, since headers are the proxy's word, but a request that
   * says it was forwarded was forwarded.
   */
  const proxied = throughTheDoor.has(c.req.raw)
    || !!c.req.header("x-forwarded-for")
    || !!c.req.header("cf-connecting-ip");
  if ((!proxied && treatAsHost(addr, BOUND_WIDE)) || carriesHostKey(c)) {
    callerOf.set(c.req.raw, { kind: "host" });
    return next();
  }

  const token = playerToken(c);
  const player = token
    ? (db.query("SELECT * FROM players WHERE token = ?").get(token) as any)
    : null;
  const share = player
    ? (db.query("SELECT * FROM shares WHERE id = ?").get(player.share_id) as any)
    : null;

  // Compared rather than trusted: the row came back from a lookup on the token
  // it claims, and this says so out loud where the next person can see it.
  const ok = !!player && !!share && share.open === 1 && sameToken(player.token, token);
  /*
   * `door` says which side this refusal happened on, and it is for the page
   * rather than for the caller: it tells nobody anything they did not already
   * know, since they chose the address they knocked on.
   *
   * Without it a guest whose seat has gone — the cookie cleared, the tab
   * closed in private browsing, ninety days passed — loads the host's own app
   * around an empty library, because the page has no way to tell "you are the
   * owner and there is nothing here" from "you are a visitor and your seat is
   * gone". Two completely different situations that looked identical, and the
   * second one is the common one on a phone.
   */
  if (!ok) return c.json({ error: "Not a seat at this table.", door: proxied }, 403);

  if (!guestMayTouch(c.req.method, c.req.path)) {
    return c.json({ error: "Guests can see the table, and only the table." }, 403);
  }

  db.query("UPDATE players SET seen_at = ? WHERE id = ?").run(now(), player.id);
  callerOf.set(c.req.raw, { kind: "guest", share, player });
  return next();
});

/**
 * The pictures, for people who are actually at a table.
 *
 * Avatars have to load for a guest or the chat is a wall of initials, but the
 * uploads folder is the whole library's worth of them and not just this
 * chat's. A stranger with the tunnel address and no invitation gets nothing.
 */
app.use("/uploads/*", async (c, next) => {
  const addr = remoteAddr(c);
  const proxied = throughTheDoor.has(c.req.raw)
    || !!c.req.header("x-forwarded-for")
    || !!c.req.header("cf-connecting-ip");
  if ((!proxied && treatAsHost(addr, BOUND_WIDE)) || carriesHostKey(c)) return next();
  const token = playerToken(c);
  const player = token
    ? (db.query("SELECT * FROM players WHERE token = ?").get(token) as any)
    : null;
  if (!player || !sameToken(player.token, token)) {
    return c.text("Not a seat at this table.", 403);
  }
  return next();
});

// ---- settings -------------------------------------------------------------

api.get("/settings", (c) => {
  const s = { ...getSettings() };
  for (const f of KEY_FIELDS) s[f] = s[f] ? "__saved__" : "";
  // Not a setting anybody edits, and not one that should ride out in a backup
  // or sit in a response the page keeps. It is read from the console or the
  // file beside the database.
  delete s.host_key;
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
      ...connectionFrom(s),
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

/**
 * One character, whole.
 *
 * /cast is a list and deliberately carries only what a list draws — id, name,
 * avatar, description. The edit dialog was being handed a row from it, so
 * personality, the scene and the greeting arrived as undefined and showed as
 * empty boxes; saving then wrote those blanks back over the real ones. The
 * character kept working until somebody opened it to fix a typo.
 */
api.get("/characters/:id", (c) => {
  const row = db.query(
    "SELECT * FROM characters WHERE id = ? AND deleted_at IS NULL",
  ).get(c.req.param("id"));
  return row ? c.json(row) : c.json({ error: "No such character." }, 404);
});

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
    `UPDATE chats SET title = ?, author_note = ?, note_depth = ?, wallpaper = ?,
                      persona_id = ?, scenario = ?, accent = ?, ambience = ? WHERE id = ?`,
  ).run(
    (b.title ?? cur.title).trim() || cur.title,
    b.author_note ?? cur.author_note,
    Number.isFinite(+b.note_depth) ? Math.max(0, Math.min(20, +b.note_depth)) : cur.note_depth,
    b.wallpaper !== undefined ? String(b.wallpaper) : cur.wallpaper,
    b.persona_id !== undefined ? (b.persona_id || null) : cur.persona_id,
    b.scenario !== undefined ? String(b.scenario) : cur.scenario,
    // A hex colour or nothing; anything else is not a colour and would go
    // straight into a stylesheet.
    b.accent !== undefined
      ? (/^#[0-9a-f]{6}$/i.test(String(b.accent)) ? String(b.accent) : "")
      : cur.accent,
    b.ambience !== undefined ? String(b.ambience).slice(0, 20) : cur.ambience,
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
  forgetSteward(ids.map(String), false);
  const stmt = db.query("DELETE FROM messages WHERE id = ?");
  db.transaction((list: string[]) => { for (const id of list) stmt.run(id); })(ids);
  return c.json({ deleted: ids.length });
});

api.delete("/messages/:id", (c) => {
  if (editsLocked()) return c.json(LOCKED, 403);
  forgetSteward([c.req.param("id")], false);
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

  /*
   * The host waits their turn too, when the table is taking turns. Only their
   * own words: an empty reply is the narrator answering whoever just spoke,
   * which is this machine's job whatever the rotation says.
   */
  if (mode === "reply" && content.trim()) {
    const share = db.query("SELECT * FROM shares WHERE chat_id = ? AND open = 1 LIMIT 1").get(chatId) as any;
    const turn = share ? turnAt(share) : { on: false, player: null };
    if (turn.on && turn.player && turn.player !== HOST_SEAT) {
      const who = seatOrder(share.id).find((p) => p.id === turn.player);
      return c.json({ error: `It is ${who?.name || "somebody else"}'s turn. Together can hand it to you.` }, 409);
    }
  }

  const t = now();
  let userMessageId: string | null = null;
  if (mode === "reply" && content.trim()) {
    userMessageId = uid();
    db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at, tokens) VALUES (?,?,?,?,?,?,?)")
      .run(userMessageId, chatId, "user", "", content.trim(), t, Math.round(content.trim().length / 4));
    hostSpoke(chatId);
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
      /*
       * Every frame goes two places: down this socket to whoever asked, and
       * out to the table if this chat is open to anybody.
       *
       * A tee rather than a refactor. The obvious move is to lift three
       * hundred lines of generation into something that takes an emitter, and
       * the obvious move here would be three hundred lines of risk for one
       * extra call — the frames are already a stream of plain objects, which
       * is exactly what the other people at the table need to see.
       *
       * Guests never call this route. They watch, and their own turns come
       * back to them the same way the narrator's do.
       */
      const openShare = db
        .query("SELECT * FROM shares WHERE chat_id = ? AND open = 1 LIMIT 1")
        .get(chatId) as any;
      const send = (o: unknown) => {
        push(`data: ${JSON.stringify(o)}\n\n`);
        if (openShare) publish(openShare.id, "frame", o);
      };
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
            ...connectionFrom(s, a.provider),
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
        /*
         * What the narrator threw, in the shape the die on screen reads.
         *
         * The resolution happens here and only the finished sentence was sent
         * on, so a roll the narrator made itself — the commonest kind at a
         * table, since it is the narrator that calls for them — arrived as
         * text with nothing happening, while pressing the die button beside it
         * threw a die you could watch. Same roll, same server, two different
         * experiences depending on who asked for it.
         */
        const thrown: any[] = [];
        {
          const rolled = resolveRolls(full);
          full = rolled.text;
          // Logged here rather than at the die, because this is the branch
          // where the narrator rolls — the one a player has least reason to
          // take on faith and most reason to want written down.
          for (const r of rolled.rolls) {
            logRoll(chatId, "dice", r.notation, describeRoll(r), r.total, who?.name ?? "");
            const dice = r.rolls.reduce((x, y) => x + y, 0);
            thrown.push({
              label: r.notation, total: r.total, die: dice, modifier: r.modifier,
              faces: { min: r.count, max: r.count * r.sides },
              parts: [
                { label: `${r.count}d${r.sides}`, value: dice },
                ...(r.modifier ? [{ label: r.modifier < 0 ? "penalty" : "bonus", value: r.modifier }] : []),
              ],
            });
          }
        }
        // And checks, against the sheet of whoever is playing this chat — the
        // reason a sheet is kept at all rather than described in prose.
        {
          const checked = resolveChecks(full, sheetFor(a.playerId));
          full = checked.text;
          const me = whoAmI(chat.persona_id);
          for (const ch of checked.checks) {
            logRoll(chatId, "check", `${ABILITY_NAMES[ch.ability]} check`,
                    describeCheck(ch), ch.total, me.name);
            thrown.push({
              label: `${ABILITY_NAMES[ch.ability]} check`,
              total: ch.total, die: ch.die, modifier: ch.modifier,
              faces: { min: 1, max: 20 },
              parts: [
                { label: "d20", value: ch.die },
                { label: ABILITY_NAMES[ch.ability], value: ch.modifier },
              ],
            });
          }
        }

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
          tieNarration(chatId, continuingId, t0);
          send({ done: true, id: continuingId, text: joined, thrown, ...stats });
        } else if (mode === "swipe" && swipeTarget) {
          const list = JSON.parse(swipeTarget.swipes || "[]");
          if (!list.length) list.push(swipeTarget.content);
          list.push(full);
          db.query(
            "UPDATE messages SET content = ?, swipes = ?, swipe_index = ?, reasoning = ?, tokens = ?, ms = ? WHERE id = ?",
          ).run(full, JSON.stringify(list), list.length - 1, think, tokens, ms, swipeTarget.id);
          // What the Steward made of the reply this one replaced no longer happened.
          forgetSteward([swipeTarget.id]);
          tieNarration(chatId, swipeTarget.id, t0);
          openingTime(chatId, swipeTarget.id, full);
          send({ done: true, id: swipeTarget.id, text: full, swipes: list.length, index: list.length - 1, thrown, ...stats });
        } else {
          const id = uid();
          db.query(
            `INSERT INTO messages (id, chat_id, role, name, content, created_at, swipes, swipe_index, reasoning, tokens, ms, character_id)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).run(id, chatId, "assistant", who.name, full, now(), JSON.stringify([full]), 0,
                think, tokens, ms, who.id ?? null);
          tieNarration(chatId, id, t0);
          openingTime(chatId, id, full);
          send({ done: true, id, text: full, swipes: 1, index: 0, name: who.name, avatar: who.avatar ?? "", thrown, ...stats });
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
        // And the Steward, on the same terms: a failed reading is a gap in the
        // records, never a broken reply.
        if (!failed && !ac.signal.aborted) stewardTurn(chatId).catch(() => {});
        // A threat that was let in has had its reply; it was a scene to start, not a standing order.
        if (!failed && !ac.signal.aborted) {
          db.query("UPDATE chronicle SET undone_at = ? WHERE chat_id = ? AND kind = 'threat' AND proposed = 0 AND undone_at IS NULL AND created_at < ?")
            .run(now(), chatId, t0);
        }
        // And the Offstage, when a day has turned: what the people nobody is watching do.
        if (!failed && !ac.signal.aborted) offstageTurn(chatId).catch(() => {});
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
  if (index !== m.swipe_index) forgetSteward([m.id]);
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
      const pid = uid();
      db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES (?,?,?,?,?)")
        .run(pid, label, JSON.stringify(data), 0, now());
      importScriptsFrom(oai, label, pid);
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
  forgetSteward([c.req.param("id")]);
  db.query("UPDATE messages SET content = ? WHERE id = ?").run(content, c.req.param("id"));
  return c.json({ ok: true });
});

// ---- avatar packs ---------------------------------------------------------
/**
 * The drawn art the face-maker is built out of.
 *
 * A pack is a manifest and a folder of transparent pictures, all drawn to the
 * same landmarks. It is the only part of the avatar feature the server touches:
 * a made avatar is an ordinary PNG uploaded through the ordinary avatar
 * endpoint, with its recipe written into the file in the browser. See
 * src/avatar.ts for why it is arranged that way.
 *
 * Arrives either as a zip or as loose files, because "export a folder" and
 * "zip a folder" are both things people do, and refusing one of them means
 * explaining which. Loose files carry their relative paths in a parallel field,
 * since a browser does not send them with the file itself.
 */
const PACKS = join(UPLOADS, "avatarpacks");

/** Big enough for a generous pack, small enough that a mistake is not fatal. */
const PACK_MAX_BYTES = 48 * 1024 * 1024;
const PACK_MAX_FILES = 600;

function packList() {
  if (!existsSync(PACKS)) return [];
  const out: any[] = [];
  for (const id of readdirSync(PACKS)) {
    try {
      const raw = JSON.parse(readFileSync(join(PACKS, id, "manifest.json"), "utf8"));
      const { pack } = readPackManifest(raw, id);
      out.push({
        id,
        name: pack.name,
        author: pack.author,
        parts: pack.parts.map((p) => ({
          layer: p.layer,
          id: p.id,
          name: p.name,
          tint: p.tint,
          url: `/uploads/avatarpacks/${id}/${p.file}`,
        })),
      });
    } catch { /* a folder without a readable manifest is not a pack */ }
  }
  return out;
}

api.get("/avatar/packs", (c) => c.json(packList()));

api.post("/avatar/packs", async (c) => {
  const form = await c.req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return c.json({ error: "Nothing arrived." }, 400);

  let paths: string[] = [];
  try { paths = JSON.parse(String(form.get("paths") ?? "[]")); } catch { paths = []; }

  /* Everything, flattened to path -> bytes, whether it came zipped or loose. */
  const entries = new Map<string, Uint8Array>();
  let total = 0;
  const take = (name: string, bytes: Uint8Array) => {
    total += bytes.length;
    if (entries.size >= PACK_MAX_FILES || total > PACK_MAX_BYTES) return false;
    entries.set(String(name).split("\\").join("/").replace(/^\.?\//, ""), bytes);
    return true;
  };

  for (const [i, f] of files.entries()) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name)) {
      const { unzipSync } = await import("fflate");
      let unzipped: Record<string, Uint8Array>;
      try { unzipped = unzipSync(bytes); }
      catch { return c.json({ error: "That zip could not be opened." }, 400); }
      for (const [name, data] of Object.entries(unzipped)) {
        if (name.endsWith("/")) continue;
        if (!take(name, data)) return c.json({ error: "That pack is too large." }, 400);
      }
    } else if (!take(paths[i] || f.name, bytes)) {
      return c.json({ error: "That pack is too large." }, 400);
    }
  }

  /*
   * The manifest can be at the root or one folder down, because zipping a
   * folder puts everything under its name and telling somebody their zip has
   * one directory too many is a worse experience than looking one level in.
   */
  const manifestAt = [...entries.keys()]
    .filter((k) => k.split("/").pop() === "manifest.json")
    .sort((a, b) => a.split("/").length - b.split("/").length)[0];
  if (!manifestAt) return c.json({ error: "No manifest.json in that." }, 400);
  const root = manifestAt.slice(0, manifestAt.length - "manifest.json".length);

  let raw: any;
  try { raw = JSON.parse(new TextDecoder().decode(entries.get(manifestAt)!)); }
  catch { return c.json({ error: "That manifest.json is not readable JSON." }, 400); }

  const { pack, skipped } = readPackManifest(raw, "Pack");
  if (!packIsUsable(pack)) {
    return c.json({ error: "Nothing in that manifest described a part we could use." }, 400);
  }

  /* Every part has to actually have its picture, or the maker offers a blank. */
  const missing: string[] = [];
  const kept = pack.parts.filter((p) => {
    if (entries.has(root + p.file)) return true;
    missing.push(p.name);
    return false;
  });
  if (!kept.length) {
    return c.json({ error: "None of the pictures the manifest names were in that." }, 400);
  }

  /* A new id rather than overwriting, so installing twice never destroys the
   * copy somebody is already using. */
  let id = pack.id;
  for (let n = 2; existsSync(join(PACKS, id)); n++) id = `${pack.id}-${n}`;

  for (const p of kept) {
    const dest = join(PACKS, id, p.file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, entries.get(root + p.file)!);
  }
  mkdirSync(join(PACKS, id), { recursive: true });
  writeFileSync(join(PACKS, id, "manifest.json"),
    JSON.stringify({ ...pack, id, parts: kept }, null, 2));

  return c.json({
    id,
    name: pack.name,
    added: kept.length,
    skipped: [...skipped, ...missing],
  });
});

api.delete("/avatar/packs/:id", (c) => {
  const id = slugId(c.req.param("id"));
  const dir = join(PACKS, id);
  if (!id || !existsSync(dir)) return c.json({ error: "No such pack." }, 404);
  rmSync(dir, { recursive: true, force: true });
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
    return c.json({ models: await listModels(provider, s[`key_${provider}`] ?? "",
      { base: s.custom_base, format: s.custom_format }) });
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
  /*
   * Everything about the chat comes across, the way carrying on already did.
   *
   * This listed a handful of columns and left the rest behind — who is in the
   * scene, which persona you are playing, where everyone is standing, the
   * wallpaper, the sound, the campaign — so switching to a branch quietly
   * switched all of those back to defaults: a group scene became a one-on-one
   * with whoever started it, and the player became somebody else. Branching
   * is "the same story, told again from here"; only what genuinely belongs
   * to the moment is left out.
   *
   * The fight is the exception. It describes the end of the parent, and a
   * branch from three exchanges before the wolves arrived must not open with
   * them already mid-fight.
   */
  db.query(
    `INSERT INTO chats (id, character_id, title, created_at, updated_at, parent_chat_id, branch_note,
                        author_note, note_depth, wallpaper, persona_id, is_group, auto_reply, scenario,
                        location, fight, campaign, campaign_asked, accent, ambience,
                        auto_lore_book_id, auto_lore_asked, auto_lore_at, apocrypha, calendar)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(newId, src.character_id, `${src.title} — branch`, t, t, src.id,
        (m.content ?? "").slice(0, 80), src.author_note ?? "", src.note_depth ?? 2,
        src.wallpaper ?? "", src.persona_id ?? null, src.is_group ?? 0, src.auto_reply ?? 0,
        src.scenario ?? "", src.location ?? "", "", src.campaign ?? "", src.campaign_asked ?? 0,
        src.accent ?? "", src.ambience ?? "",
        // A branch is the same story told again from a fork, so it keeps its
        // parent's record-keeping. Without this, every branch asks where to
        // file its notes all over again — and branching is exactly the moment
        // you least want to be interrupted with a question you have answered.
        // (It is then given a copy of that book to write into: ownNotesBook, below.)
        src.auto_lore_book_id ?? null, src.auto_lore_asked ?? 0, src.auto_lore_at ?? 0,
        // And its place in the plan, as a copy: from here the two go their
        // own ways through the same book.
        src.apocrypha ?? "",
        // The same calendar: the story is still counting the same days.
        src.calendar ?? "");

  // The room — every member of a group, in order — and the people the
  // narrator has introduced, who are part of the story so far.
  const members = db.query(
    "SELECT character_id, position, muted FROM chat_members WHERE chat_id = ? ORDER BY position",
  ).all(src.id) as any[];
  const addMember = db.query(
    "INSERT INTO chat_members (id, chat_id, character_id, position, muted) VALUES (?,?,?,?,?)",
  );
  const npcs = db.query("SELECT name, brief, avatar, created_at FROM npcs WHERE chat_id = ? AND deleted_at IS NULL")
    .all(src.id) as any[];
  const addNpc = db.query("INSERT INTO npcs (id, chat_id, name, brief, avatar, created_at) VALUES (?,?,?,?,?,?)");
  db.transaction(() => {
    for (const x of members) addMember.run(uid(), newId, x.character_id, x.position, x.muted ?? 0);
    for (const n of npcs) addNpc.run(uid(), newId, n.name, n.brief, n.avatar, n.created_at);
  })();

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
  // Which copy each message became, so the chronicle can follow them across.
  const kept = new Map<string, string>();
  db.transaction(() => {
    for (const r of rows) {
      const copy = uid();
      kept.set(r.id, copy);
      ins.run(copy, newId, r.role, r.name, r.content, r.created_at, r.swipes, r.swipe_index,
              r.reasoning ?? "", r.tokens ?? 0, r.ms ?? 0);
    }
  })();

  // The story so far, exactly as far as the fork and no further.
  copyChronicle(forBranch(chronicleOf(src.id), kept, m.created_at), newId);

  /*
   * And a notes book of its own.
   *
   * A branch used to go on writing into its parent's book, so two versions of
   * one story filed contradictory notes in the same place and each was fed
   * the other's. It now writes into a copy, named for what it is. Only for
   * branches made from here on: a branch that already shares a book is left
   * sharing it until somebody asks for it to be split (/own-notes, below).
   */
  ownNotesBook(newId);

  return c.json({ id: newId, copied: rows.length });
});

/**
 * Summing up, and carrying on somewhere fresh.
 *
 * Every turn resends the whole conversation, so an evening that has run long
 * costs more per message than the same evening did at the start — for a
 * transcript whose early half nobody is thinking about any more. The standing
 * advice is "start a new chat sometimes", and nobody does it, because doing it
 * by hand means losing the thread.
 *
 * So this does the losing-nothing part. The recap goes into the memory book as
 * an entry that is always in the prompt, the new chat opens on the last thing
 * that was actually said, and everything that made the old chat what it was —
 * the cast, the books, the notes, the scene, the persona, the campaign — comes
 * across with it. It is filed as a child of the old chat, so the story still
 * reads as one story in the fork view.
 *
 * Nothing is deleted. The old chat is left exactly as it was, which is the
 * only thing that makes this safe to press.
 */
api.post("/chats/:id/carry-on", async (c) => {
  const src = db.query("SELECT * FROM chats WHERE id = ? AND deleted_at IS NULL")
    .get(c.req.param("id")) as any;
  if (!src) return c.json({ error: "Chat not found." }, 404);
  const char = db.query("SELECT * FROM characters WHERE id = ?").get(src.character_id) as any;
  if (!char) return c.json({ error: "That character no longer exists." }, 404);

  const all = db.query(
    "SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at, rowid",
  ).all(src.id) as any[];
  if (all.length < 2) return c.json({ error: "There is not enough here to sum up yet." }, 400);

  const s = getSettings();
  const size = Number(s.summary_size) || 300;
  const picked = recentFor(all, tailBudget(size));

  /*
   * Written before anything is created.
   *
   * A half-made chat with no recap in it is worse than no chat at all — you
   * would have to notice it had failed, and the failure looks exactly like a
   * successful carry-on until you read it. So the model is asked first, and a
   * refusal leaves the library untouched.
   */
  let said = "";
  try {
    for await (const chunk of generate({
      ...connectionFrom(s),
      model: s.model,
      system: CARRY_SYSTEM,
      messages: [{ role: "user", content: carryPrompt(picked, char.name, size) }],
      sampling: {
        // Low, because this reports rather than embroiders — a recap that
        // invents a detail puts it in the prompt of every turn that follows.
        temperature: 0.3, topP: 1, minP: 0,
        /*
         * Room to overshoot, because they do — asked for three hundred tokens
         * a model will happily write seven. There is still a ceiling, since a
         * length slider that can be ignored is not a setting, and `endWhole`
         * tidies the sentence it lands in the middle of.
         */
        maxTokens: Math.min(4000, Math.max(300, Math.round(size * 3.5 + 120))),
        repetitionPenalty: 1, frequencyPenalty: 0, presencePenalty: 0,
        stream: false, reasoningEffort: "off",
      },
    })) {
      if (chunk.kind === "text") said += chunk.text;
      if (said.length > 20000) break;
    }
  } catch (err: any) {
    return c.json({ error: err?.message || "The summary could not be written." }, 502);
  }

  const summary = cleanSummary(said);
  if (!summary) return c.json({ error: "The summary came back empty." }, 502);

  const newId = uid();
  const t = now();
  db.query(
    `INSERT INTO chats (id, character_id, title, created_at, updated_at, parent_chat_id, branch_note,
                        author_note, note_depth, wallpaper, persona_id, is_group, auto_reply, scenario,
                        location, fight, campaign, campaign_asked, accent, ambience,
                        auto_lore_book_id, auto_lore_asked, auto_lore_at, apocrypha, calendar)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    newId, src.character_id, carriedTitle(src.title || char.name), t, t, src.id,
    "Summed up and carried on",
    src.author_note ?? "", src.note_depth ?? 2, src.wallpaper ?? "", src.persona_id ?? null,
    src.is_group ?? 0, src.auto_reply ?? 0, src.scenario ?? "",
    src.location ?? "", src.fight ?? "", src.campaign ?? "", src.campaign_asked ?? 0,
    src.accent ?? "", src.ambience ?? "",
    src.auto_lore_book_id ?? null, src.auto_lore_asked ?? 0,
    // The note-taker starts fresh here rather than inheriting a mark from a
    // transcript this chat does not have: with the old timestamp every message
    // in the new chat would read as already covered.
    0,
    // Still in the same scene of the same plan: carrying on is not starting over.
    src.apocrypha ?? "",
    src.calendar ?? "",
  );

  /*
   * The room, not just the founder.
   *
   * `character_id` is only whoever the chat was started with. In a group the
   * cast lives in chat_members, and a carry-on that dropped it would open a
   * scene with everybody but one person missing — the failure hardest to spot
   * in exactly the chats this feature is for, since a long evening is usually
   * a full one.
   */
  const members = db.query(
    "SELECT character_id, position, muted FROM chat_members WHERE chat_id = ? ORDER BY position",
  ).all(src.id) as any[];
  const addMember = db.query(
    "INSERT INTO chat_members (id, chat_id, character_id, position, muted) VALUES (?,?,?,?,?)",
  );
  db.transaction(() => {
    for (const m of members) addMember.run(uid(), newId, m.character_id, m.position, m.muted ?? 0);
  })();

  // The same story, so all of what has happened in it so far.
  copyChronicle(forCarryOn(chronicleOf(src.id)), newId);

  // The books pinned to the old chat, exactly as a branch inherits them.
  const pinned = db
    .query("SELECT book_id FROM lorebook_links WHERE scope = 'chat' AND target_id = ?")
    .all(src.id) as any[];
  for (const link of pinned) {
    db.query("INSERT INTO lorebook_links (id, book_id, scope, target_id) VALUES (?,?,?,?)")
      .run(uid(), link.book_id, "chat", newId);
  }

  /*
   * Where the recap goes.
   *
   * The chat's own memory book if it has one — that is the thing the recap
   * *is*, and putting it there means it is applied by the ordinary lore
   * machinery rather than by something new. A chat that never picked a book
   * gets one made for it: refusing to carry on because of a question nobody
   * answered would be a strange place to stop.
   */
  // Including a book that was replaced by a re-imported copy of itself.
  let bookId: string | null = notesBookOf(src.id);
  if (!bookId) {
    bookId = uid();
    db.query("INSERT INTO lorebooks (id, name, entries, created_at, world) VALUES (?,?,?,?,?)")
      .run(bookId, freeBookName(`${char.name} — notes`), "[]", t, currentWorld());
    db.query("UPDATE chats SET auto_lore_book_id = ?, auto_lore_asked = 1 WHERE id = ?")
      .run(bookId, newId);
    db.query("INSERT INTO lorebook_links (id, book_id, scope, target_id) VALUES (?,?,?,?)")
      .run(uid(), bookId, "chat", newId);
  } else if (!pinned.some((l) => l.book_id === bookId)) {
    // Named as the chat's book but never actually attached to it, which is
    // possible for chats older than that link. Attach it, or the recap is
    // written somewhere nothing reads.
    db.query("INSERT INTO lorebook_links (id, book_id, scope, target_id) VALUES (?,?,?,?)")
      .run(uid(), bookId, "chat", newId);
  }

  const book = db.query("SELECT * FROM lorebooks WHERE id = ?").get(bookId) as any;
  const entries = readEntries(book);
  entries.push(normaliseEntry(carryEntry(summary, src.title || char.name)));
  db.query("UPDATE lorebooks SET entries = ? WHERE id = ?")
    .run(JSON.stringify(entries), bookId);

  /*
   * And the last thing that was said, word for word.
   *
   * A recap tells you what happened; it does not give you the sentence you
   * were about to answer. Copied as a row rather than quoted into the summary,
   * so it keeps its speaker and draws as whoever actually said it — and so the
   * recap does not spend its budget repeating it.
   */
  const last = all[all.length - 1];
  db.query(
    `INSERT INTO messages (id, chat_id, role, name, content, created_at, swipes, swipe_index,
                           reasoning, tokens, ms, character_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(uid(), newId, last.role, last.name ?? "", last.content, t,
        "[]", 0, "", last.tokens ?? 0, last.ms ?? 0, last.character_id ?? null);

  return c.json({ id: newId, summary, book_id: bookId, members: members.length });
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

/**
 * The database plus every uploaded image, as one downloadable archive.
 *
 * Streamed, a megabyte at a time, and stored rather than compressed. It used
 * to build the whole zip in memory before sending a byte — every picture, the
 * database, and the compressed copy of all of it at once. A 190 MB library
 * took the server to 770 MB to export, which a desktop shrugs at and a phone
 * does not: Android kills the app, or the zip takes so long to build on a
 * phone's processor that the download gives up waiting for its first byte.
 * Either way "export" did nothing at all, on exactly the device where a
 * backup matters most. Now the first bytes leave at once and memory stays
 * around one chunk, whatever the library weighs. The pictures are already
 * compressed, so storing them costs nothing; the database is the only thing
 * that would shrink, and it is not worth a phone's minute of CPU.
 */
api.get("/backup/export", async () => {
  const { Zip, ZipPassThrough } = await import("fflate");
  const { closeSync, openSync, readSync, readdirSync, statSync } = await import("node:fs");

  // Everything still in memory or in a write-ahead log, onto disk first.
  settle();

  const files: [name: string, path: string][] = [];
  const add = (name: string, path: string) => {
    try { if (statSync(path).isFile()) files.push([name, path]); } catch {}
  };

  add("hearth.db", join(DATA, "hearth.db"));
  for (const extra of [".env", "lumiverse.identity"]) add(extra, join(DATA, extra));
  // A phone that had to rebuild a damaged database keeps the original beside
  // it, with a report (mobile/server/db.mobile.ts). The phone's storage is
  // out of reach without a cable, so a backup is how that file gets to a
  // computer, where better tools can have another go at it.
  try {
    for (const f of readdirSync(DATA)) {
      if (/^hearth\.db\.damaged-|^recovery-.*\.txt$/.test(f)) add(`recovery/${f}`, join(DATA, f));
    }
  } catch {}

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

  // fflate hands over finished zip bytes here; pull() below passes them on.
  const ready: Uint8Array[] = [];
  let done = false;
  let failed: Error | null = null;
  const zip = new Zip((err, chunk, final) => {
    if (err) { failed = err; return; }
    ready.push(chunk);
    if (final) done = true;
  });

  let next = 0;
  let open: { entry: InstanceType<typeof ZipPassThrough>; fd: number } | null = null;
  const buf = new Uint8Array(1 << 20);

  const body = new ReadableStream<Uint8Array>({
    // Called only when the reader wants more, so nothing piles up: each call
    // reads until it has something to hand over, and no further.
    pull(controller) {
      try {
        while (!ready.length && !done && !failed) {
          if (!open) {
            if (next >= files.length) { zip.end(); continue; }
            const [name, path] = files[next++];
            let fd: number;
            try { fd = openSync(path, "r"); } catch { continue; }
            const entry = new ZipPassThrough(name);
            zip.add(entry);
            open = { entry, fd };
          }
          const n = readSync(open.fd, buf, 0, buf.length, null);
          if (n > 0) open.entry.push(buf.slice(0, n), false);
          else {
            closeSync(open.fd);
            open.entry.push(new Uint8Array(0), true);
            open = null;
          }
        }
        if (failed) return controller.error(failed);
        while (ready.length) controller.enqueue(ready.shift()!);
        if (done) controller.close();
      } catch (e) {
        if (open) { try { closeSync(open.fd); } catch {} open = null; }
        controller.error(e);
      }
    },
    cancel() {
      if (open) { try { closeSync(open.fd); } catch {} open = null; }
    },
  });

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new Response(body, {
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
  remembered: ReturnType<typeof recall> | null;
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

  /**
   * Prompt-side regex scripts, applied per message with its depth from the end
   * of the transcript — the newest is 0. This is the half of the feature that
   * pays for itself: a preset's "remove older <status> from context" scripts
   * stop every state block the scene has ever produced from being resent on
   * every turn. Display-side scripts are the browser's business; the model
   * never sees them, and this never touches the stored rows.
   */
  const scripts = liveScripts().filter((r) => r.active);
  const names = { char: char.name, user: me.name };
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
        names,
      ),
    }));
  }

  /*
   * Everybody at this table, named, whichever mode it is being played in.
   *
   * Without it a shared chat is a narrator running a story for one person
   * while somebody else types into it: the other turns arrive signed with a
   * name it has never been told, attached to a person it does not know exists,
   * and it writes around them or invents them from scratch.
   *
   * Two things this used to get wrong.
   *
   * It only existed in tabletop mode, so a shared *story* chat had nothing at
   * all — the guests were invisible and the narrator answered the host for
   * every turn anybody took. A story told by three people is as shared as a
   * game played by three, and the narrator needs the same list either way.
   *
   * And it listed the guests and not the host. The `players` table is seats at
   * the share; the person running it has a persona instead, described further
   * up under a heading of its own. So the narrator was told "more than one
   * person is playing" and then handed exactly one name, with the host's
   * persona floating unattached somewhere above — which reads as one player
   * and one narrator, not two players. Whoever owns the chat is at the table
   * too, and goes first, because they are the one whose turns arrive unsigned.
   */
  const openTable = db
    .query("SELECT * FROM shares WHERE chat_id = ? AND open = 1 LIMIT 1")
    .get(chat.id) as any;
  let roster = "";
  if (openTable) {
    const seats = db.query("SELECT * FROM players WHERE share_id = ? ORDER BY created_at")
      .all(openTable.id) as any[];
    if (seats.length) {
      const mine = sheetFor(me.id);
      const party = [
        mine
          ? sheetForPrompt(me.name, mine)
          : `${me.name} — whose chat this is. Their turns are the ones that arrive without a name in front of them.`,
        ...seats.map((p) => {
          const sh = sheetFor(p.id);
          return sh ? sheetForPrompt(p.name, sh) : `${p.name} — at the table, no character sheet yet.`;
        }),
      ];
      roster =
        `# Who is playing\nThis is being played by more than one person: ` +
        `${[me.name, ...seats.map((p) => p.name)].join(", ")}. Their turns are signed with their ` +
        `names — those names are who acted, and they are different people.\n\n` +
        `Answer whoever has just acted, by name. If two of them acted before you replied, ` +
        `answer both in the one turn rather than picking one and leaving the other standing ` +
        `there. Never write a turn, a line of speech or a decision for any of them, and never ` +
        `attribute what one of them did to another.\n\n${party.join("\n\n")}`;
    }
  }

  /*
   * Whether the human turns need names on them: only when more than one person
   * is writing them. See buildMessages.
   */
  const sharedWith = db
    .query("SELECT COUNT(*) n FROM players p JOIN shares sh ON sh.id = p.share_id"
         + " WHERE sh.chat_id = ? AND sh.open = 1")
    .get(chat.id) as any;
  const manyHands = (sharedWith?.n ?? 0) > 0;
  const messages = buildMessages(
    history, char, me.name, Number(s.context_tokens), others.length > 0, manyHands);
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
  // The plan this chat follows, if any: only ever the scene being played.
  const tale = taleBrief(chat.id);
  // And the record of what is so: the date, and how everyone is.
  const remembered: { value?: ReturnType<typeof recall> } = {};
  const storyWorld = worldBrief(chat, s, history, remembered);

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
    // A plan of the player's own sits beside the campaign: what the game is,
    // then the scene of it being played.
    if (tale) table.push(tale);
    if (storyWorld) table.push(storyWorld);

    table.push(DICE_BRIEF);

    const mySheet = sheetFor(me.id);
    if (mySheet) table.push(`${sheetForPrompt(me.name, mySheet)}\n\n${CHECK_BRIEF}`);

    /*
     * How hard the table is, next to the sheet the numbers get rolled against.
     *
     * Here rather than in the system prompt for the same reason everything
     * else at the table is: a stated target the narrator can apply the same
     * way twice is worth more than an adjective it reads once and forgets.
     */
    table.push(difficultyForPrompt(s.tabletop_difficulty));

    // Who is playing, built above and shared with story mode — see whoIsPlaying.
    if (roster) table.push(roster);

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
  } else if (roster || tale || storyWorld) {
    /*
     * A shared story chat gets the roster on its own, in the same place the
     * table's block goes: after the transcript, where an instruction is read
     * rather than skimmed past. There is no table to fold it into here, but
     * the reason for it is identical — somebody else is typing.
     *
     * The scene from an apocryphon goes here too, for the same reason: it is
     * the instruction about this part of the story, and last is where an
     * instruction holds.
     */
    // What is so, then who is here, then where it is going.
    const block = [storyWorld, roster, tale].filter(Boolean).join("\n\n");
    const last = messages[messages.length - 1];
    if (last?.role === "user") last.content += `\n\n[${block}]`;
    else messages.push({ role: "user", content: `[${block}]` });
    if (storyWorld) note("Story World", storyWorld);
    if (roster) note("Who is playing", roster);
    if (tale) note("Where the story is headed", tale);
  }

  /*
   * Hands off the players, said where it is obeyed.
   *
   * The rule was already in the prompt — in the roster, at the top of the
   * table's block, and in a preset tail that said "the player" in the singular
   * and only existed when the table's own preset was on. A model reads the
   * end of a long prompt as the instruction and the rest as background, so at
   * a table with real people in it the narrator kept writing their lines and
   * their moves, and the only thing that stopped it was a guided swipe — which
   * lands exactly here. So this lands here every time, naming everybody, and
   * the steer below still has the last word.
   *
   * Not when impersonating: that is the player asking to be written.
   */
  const players = (() => {
    const names = [me.name];
    if (openTable) {
      for (const p of db.query("SELECT name FROM players WHERE share_id = ? ORDER BY created_at").all(openTable.id) as any[]) {
        if (p.name && !names.includes(p.name)) names.push(p.name);
      }
    }
    return names;
  })();
  if (mode !== "impersonate" && (s.mode === "tabletop" || players.length > 1)) {
    const who = players.length > 1
      ? `${players.slice(0, -1).join(", ")} and ${players[players.length - 1]} are played by real people`
      : `${players[0]} is played by a real person`;
    const handsOff =
      `[${who}. Write only the narration and the people of the world. Never write what ` +
      `${players.length > 1 ? "any of them" : "they"} say, do, decide, think or feel — not a line, ` +
      `not a small action, not a reaction. When it comes to one of their moments, stop there and ` +
      `leave it to them.]`;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "user") lastMsg.content += `\n\n${handsOff}`;
    else messages.push({ role: "user", content: handsOff });
    note("Hands off the players", handsOff);
  }

  /*
   * The steer, last of all — after the transcript, after the table.
   *
   * It used to be appended to the system prompt, which is the tidier place and
   * the wrong one, for exactly the reason the table's own block had to move: a
   * preset like DEUS EX MACHINA is fifty thousand characters of formatting
   * law, and one sentence underneath it is one sentence the model reads once
   * and then spends the rest of its attention obeying something else. Which is
   * what "the guided line does not seem to insert anything" looks like from
   * the outside — it was in the prompt the whole time, in the one place where
   * a preset could drown it.
   *
   * And last full stop, after the table too: a steer is the one instruction
   * the person is giving by hand, about this reply, right now.
   */
  if (guide?.trim()) {
    const subject = mode === "impersonate" ? me.name : char.name;
    const g = `${guide.trim()}\nFollow this direction when writing ${subject}. Do not mention it or acknowledge it in the text.`;
    const lastMsg = messages[messages.length - 1];
    const block = `[Direction for this response only:\n${g}]`;
    if (lastMsg?.role === "user") lastMsg.content += `\n\n${block}`;
    else messages.push({ role: "user", content: block });
    note("Guidance for this reply", g);
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
    // What the narrator was reminded of from earlier, and why — so it can be checked, not assumed.
    remembered: remembered.value ?? null,
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

  /*
   * And whatever the extensions do to it, because they do it on the way out.
   *
   * The inspector ran assemble() and stopped, so an extension's prompt:before
   * was invisible here and present in every real send — an inspector that can
   * disagree with the thing it inspects, which is the one thing it must never
   * be. Same call, same order, same payload as generate.
   */
  const shapedForView = runServerHook(
    liveExtensions(),
    "prompt:before",
    { system: a.system, messages: a.messages },
    (where, err) => console.error(`[extension] ${where}`, err ?? ""),
  );
  /*
   * And it has to be *visible*, not merely applied. The inspector reports
   * `sections`, which assemble() fills in as it goes and which therefore knows
   * nothing about anything that happens afterwards — so applying the hook and
   * stopping would have left the numbers right and the reading wrong, which is
   * the same lie in quieter clothes.
   */
  if (shapedForView.system !== a.system) {
    a.sections.push({
      label: "Extensions changed the system prompt",
      content: shapedForView.system,
      chars: shapedForView.system.length,
    });
  }
  a.system = shapedForView.system;
  a.messages = shapedForView.messages;

  const chars =
    a.system.length +
    a.messages.reduce((n, m) => n + m.content.length, 0) +
    (a.prefill?.length ?? 0);
  return c.json({
    provider: a.provider, model: a.model, sampling: a.sampling,
    speaker: speaker ? { id: speaker.id, name: speaker.name } : null,
    sections: a.sections, lore: a.lore, remembered: a.remembered,
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
  let data: PresetData = {};
  try { data = JSON.parse(p.data); } catch {}
  // SillyTavern's shape by default, so the file opens where most presets are
  // made; ?format=hearth for Hearth's own, which is what a Hearth backup reads.
  if (c.req.query("format") === "hearth") {
    return download(`${p.name}.preset.json`, { hearth_preset: 1, name: p.name, ...data });
  }
  return download(`${p.name}.json`, toSillyTavernPreset(data, presetScripts(p.id)));
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

// ---- apocrypha --------------------------------------------------------------
//
// The other half of the bookshelf: plans for a story rather than facts about a
// world. See src/apocrypha.ts for why the two are kept apart, and why a chat
// holds its own place in a book instead of the book holding one for everyone.

const apocryphonFrom = (r: any): Apocryphon & { created_at: number; updated_at: number } => {
  let chapters: unknown = [];
  try { chapters = JSON.parse(r.chapters || "[]"); } catch {}
  return { id: r.id, name: r.name, premise: r.premise, chapters: normaliseChapters(chapters),
           steering: steeringOf(r.steering), created_at: r.created_at, updated_at: r.updated_at };
};

const apocryphon = (id: string) => {
  const r = db.query("SELECT * FROM apocrypha WHERE id = ?").get(id);
  return r ? apocryphonFrom(r) : null;
};

/**
 * A chat's book and its place in it, or nulls.
 *
 * Mended on the way out: a scene that has since been deleted from the book
 * cannot be the one being played, so the chat moves on to the first open
 * scene rather than sitting on a bookmark that points at nothing.
 */
function taleOf(chatId: string): { book: Apocryphon | null; mark: Bookmark | null } {
  const row = db.query("SELECT apocrypha FROM chats WHERE id = ?").get(chatId) as { apocrypha?: string } | undefined;
  const mark = readBookmark(row?.apocrypha);
  if (!mark) return { book: null, mark: null };
  const book = apocryphon(mark.book);
  if (!book) return { book: null, mark: null };
  const ids = new Set(scenesOf(book).map(({ scene }) => scene.id));
  if (mark.scene && !ids.has(mark.scene)) {
    const done = mark.done.filter((x) => ids.has(x));
    const skipped = mark.skipped.filter((x) => ids.has(x));
    const scene = [...ids].find((x) => !done.includes(x) && !skipped.includes(x)) ?? "";
    const fixed = { book: book.id, scene, done, skipped };
    setTale(chatId, fixed);
    return { book, mark: fixed };
  }
  return { book, mark };
}

const setTale = (chatId: string, mark: Bookmark | null) =>
  db.query("UPDATE chats SET apocrypha = ? WHERE id = ?").run(mark ? JSON.stringify(mark) : "", chatId);

/** What the model is told about the plan this chat follows, if it follows one. */
function taleBrief(chatId: string): string | null {
  const { book, mark } = taleOf(chatId);
  const brief = book ? briefFor(book, mark) : null;
  if (!brief || getSettings().story_world === "0") return brief;
  // The open threads this scene touches — its people, its place, what it is about — so the plan and
  // what the story has left hanging know about each other. Only the story's own, public threads.
  const scene = scenesOf(book!).find(({ scene }) => scene.id === mark!.scene)?.scene;
  if (!scene) return brief;
  const about = [scene.title, scene.setting, scene.cast, scene.purpose, scene.beats, scene.ending].join(" ");
  const touching = threadsOf(chronicleOf(chatId)).filter((t) => t.open && related(`${t.title} ${t.evidence}`, about)).slice(0, 4);
  return touching.length
    ? `${brief}\nMatters still open in the story that this scene could pick up, if it fits: ${touching.map((t) => t.title).join("; ")}.`
    : brief;
}

api.get("/apocrypha", (c) => {
  const rows = db.query("SELECT * FROM apocrypha ORDER BY updated_at DESC").all();
  return c.json(rows.map(apocryphonFrom));
});

api.post("/apocrypha", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const id = uid();
  const t = now();
  db.query("INSERT INTO apocrypha (id, name, premise, chapters, created_at, updated_at) VALUES (?,?,?,?,?,?)")
    .run(id, String(b.name ?? "").trim().slice(0, 200) || "An untold story",
         String(b.premise ?? "").slice(0, 20000), JSON.stringify(normaliseChapters(b.chapters)), t, t);
  return c.json({ id });
});

api.put("/apocrypha/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const r = db.query("UPDATE apocrypha SET name = ?, premise = ?, chapters = ?, steering = ?, updated_at = ? WHERE id = ?").run(
    String(b.name ?? "").trim().slice(0, 200) || "An untold story",
    String(b.premise ?? "").slice(0, 20000),
    JSON.stringify(normaliseChapters(b.chapters)), steeringOf(b.steering), now(), c.req.param("id"));
  if (!r.changes) return c.json({ error: "That book is not on the shelf any more." }, 404);
  return c.json({ ok: true });
});

api.delete("/apocrypha/:id", (c) => {
  const id = c.req.param("id");
  db.query("DELETE FROM apocrypha WHERE id = ?").run(id);
  // Chats that were following it are following nothing now, and should say so.
  const following = db.query("SELECT id, apocrypha FROM chats WHERE apocrypha LIKE ?").all(`%${id}%`) as any[];
  for (const ch of following) if (readBookmark(ch.apocrypha)?.book === id) setTale(ch.id, null);
  return c.json({ ok: true });
});

/** Stories from a file: Hearth's own export, or the outline text (see src/apocrypha.ts). */
api.post("/apocrypha/import", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const books = readImport(String(b.text ?? "").slice(0, 2_000_000));
  if (!books.length) {
    return c.json({ error: "Nothing in that file reads as a story. Hearth takes its own export, or an outline: \"# Name\", then \"## Chapter\" and \"### Scene\" headings." }, 400);
  }
  const fallback = String(b.filename ?? "").replace(/\.[a-z0-9]+$/i, "").trim();
  const ins = db.query("INSERT INTO apocrypha (id, name, premise, chapters, steering, created_at, updated_at) VALUES (?,?,?,?,?,?,?)");
  const made: { id: string; name: string }[] = [];
  db.transaction(() => {
    for (const book of books) {
      const id = uid();
      const t = now();
      const name = book.name || fallback || "An untold story";
      ins.run(id, name.slice(0, 200), book.premise, JSON.stringify(book.chapters), book.steering ?? "gentle", t, t);
      made.push({ id, name });
    }
  })();
  return c.json({ books: made });
});

/** One story, as Hearth's own JSON or as the outline text. */
api.get("/apocrypha/:id/export", (c) => {
  const book = apocryphon(c.req.param("id"));
  if (!book) return c.json({ error: "That book is not on the shelf any more." }, 404);
  const { created_at, updated_at, ...plain } = book;
  return c.req.query("format") === "md"
    ? c.json({ filename: `${book.name}.md`, text: toOutline(book) })
    : c.json({ filename: `${book.name}.json`, text: JSON.stringify({ hearth: "apocrypha", version: 1, ...plain }, null, 2) });
});

/**
 * A model writing part of a story's plan, when asked: the premise, the next
 * chapters, or the blanks in one scene. It writes in the outline text and the
 * same reader as an import takes it in, so a cheap model's untidy answer still
 * lands as fields — and nothing is saved here. The editor puts what came back
 * into the draft, where the person can keep it, change it, or not save it.
 */
api.post("/apocrypha/write", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const what = b.what === "premise" || b.what === "scene" ? b.what : "outline";
  const book = {
    name: String(b.book?.name ?? "").slice(0, 200),
    premise: String(b.book?.premise ?? "").slice(0, 20000),
    chapters: normaliseChapters(b.book?.chapters),
  };
  const s = getSettings();
  const model = s.model;
  // One field, from its randomize button.
  const target = b.what === "field" ? { field: String(b.field ?? ""), chapter: Number(b.chapter), scene: Number(b.scene) } : null;
  const fieldPrompt = target ? apocFieldPrompt(book, target as any) : null;
  if (target && !fieldPrompt) return c.json({ error: "That is not a field Hearth can fill." }, 400);
  const prompt = fieldPrompt ?? apocWritePrompt(what, book, { idea: b.idea, chapter: Number(b.chapter), scene: Number(b.scene), chapters: Number(b.chapters) });
  const fold = needsFoldedSystem(model);
  let text = "";
  try {
    for await (const chunk of generate({
      ...connectionFrom(s),
      model,
      system: fold ? "" : WRITE_APOC_SYSTEM,
      messages: [{ role: "user", content: fold ? `${WRITE_APOC_SYSTEM}\n\n${prompt}` : prompt }],
      sampling: { temperature: target ? 1 : 0.9, maxTokens: target ? 500 : what === "outline" ? 3000 : what === "scene" ? 900 : 500, topP: 1, minP: 0,
                  repetitionPenalty: 1, frequencyPenalty: 0, presencePenalty: 0,
                  stream: false, reasoningEffort: "off" },
    })) {
      if (chunk.kind === "text") text += chunk.text;
      if (text.length > 40000) break;
    }
  } catch (err: any) {
    return c.json({ error: err?.message ?? "The model could not be reached." }, 502);
  }
  text = withoutThinking(text).replace(/^```[a-z]*\n?|```\s*$/gim, "").trim();

  if (target) {
    const value = cleanField(target.field, text);
    if (!value) return c.json({ error: "The model did not write anything usable. Try again." }, 502);
    return c.json({ value });
  }

  if (what === "premise") {
    const premise = text.replace(/^#+.*$/gm, "").replace(/^\s*(?:premise|the story)\s*:\s*/i, "").trim().replace(/^["“]|["”]$/g, "");
    if (premise.length < 20) return c.json({ error: "The model did not write a premise. Try again, or say a little more." }, 502);
    return c.json({ premise: premise.slice(0, 4000) });
  }
  const read = readOutline(text);
  const scenes = (read?.chapters ?? []).flatMap((ch) => ch.scenes);
  if (what === "scene") {
    const sc = scenes[0];
    if (!sc || !(sc.setting || sc.cast || sc.purpose || sc.beats || sc.ending)) {
      return c.json({ error: "The model did not fill in the scene. Try again." }, 502);
    }
    return c.json({ scene: sc });
  }
  const chapters = (read?.chapters ?? []).filter((ch) => ch.scenes.length);
  if (!chapters.length) return c.json({ error: "The model did not write any chapters. Try again, or say a little more." }, 502);
  return c.json({ chapters });
});

/** Which book this chat follows, and where it has got to. */
api.get("/chats/:id/apocrypha", (c) => c.json(taleOf(c.req.param("id"))));

// ---- the chronicle ---------------------------------------------------------
//
// What has happened in one chat, and when. See src/chronicle.ts for why it is
// a list that is only ever added to, and src/calendar.ts for why a date is a
// number. Host only for now: none of these routes is on the guests' list in
// src/share.ts, so a seat at a shared table cannot reach them.

/** The calendar a chat counts in — its own copy, or Undated. */
function calendarOf(chatId: string): Calendar {
  const row = db.query("SELECT calendar FROM chats WHERE id = ?").get(chatId) as any;
  return (row?.calendar && normaliseCalendar(row.calendar)) || UNDATED;
}

function chronicleOf(chatId: string): ChronicleEntry[] {
  return (db.query("SELECT * FROM chronicle WHERE chat_id = ? ORDER BY created_at, rowid").all(chatId) as any[])
    .map(normaliseChronicleEntry);
}

/** Writes entries into a chat as they are — a copy keeps its times and its undone marks. */
function copyChronicle(entries: ChronicleEntry[], chatId: string) {
  const ins = db.query(
    `INSERT INTO chronicle (id, chat_id, message_id, kind, day, minute, span, title, body, visibility,
                            source, evidence, scene_id, subject, field, object, amount, data, created_at, undone_at, proposed)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  db.transaction(() => {
    for (const e of entries) {
      ins.run(e.id && !db.query("SELECT 1 FROM chronicle WHERE id = ?").get(e.id) ? e.id : uid(),
              chatId, e.message_id, e.kind, e.day, e.minute, e.span, e.title, e.body, e.visibility,
              e.source, e.evidence, e.scene_id, e.subject, e.field, e.object, e.amount, e.data,
              e.created_at, e.undone_at, e.proposed ? 1 : 0);
    }
  })();
  if (entries.length) worldChanged(chatId);
}

/**
 * Anyone sitting at this chat's table is told the world moved on — only the
 * small summary, so a phone on a slow tunnel is not sent the whole chronicle
 * every time somebody's mood changes. The rest is fetched when they look.
 */
function worldChanged(chatId: string) {
  const share = db.query("SELECT id FROM shares WHERE chat_id = ? AND open = 1 LIMIT 1").get(chatId) as any;
  if (share) publish(share.id, "world", { world: worldSummary(chatId) });
}

/** The few words a guest's screen shows without opening Story World: the date, and the latest thing that happened. */
function worldSummary(chatId: string) {
  const cal = calendarOf(chatId);
  const entries = chronicleOf(chatId).filter((e) => e.visibility === "table");
  const at = clockOf(cal, entries);
  const last = liveEntries(entries).filter((e) => e.kind === "event").pop();
  return { today: formatDate(cal, at), latest: last?.title ?? "" };
}

/**
 * Story World as a guest sees it. Built from what the table may read and
 * nothing else — a hidden entry is left out before anything is worked out
 * from it, so no date, status, bond or faction can give it away. No
 * proposals, which are the host's to decide; no evidence, which quotes the
 * transcript in ways a secret could ride along with. Bonds come seen from
 * the guest's own character, theirs first.
 */
function tableWorld(chatId: string, seenFrom: string) {
  const cal = calendarOf(chatId);
  const entries = chronicleOf(chatId).filter((e) => e.visibility === "table");
  const at = clockOf(cal, entries);
  const bonds = bondsOf(entries).map((b) => ({ from: b.from, to: b.to, score: b.score, label: b.label }));
  const mine = (b: { from: string; to: string }) => (b.from === seenFrom || b.to === seenFrom ? 0 : 1);
  return {
    calendar: cal.name,
    now: { ...at, text: formatDate(cal, at) },
    seenFrom,
    events: liveEntries(entries).filter((e) => e.kind === "event")
      .map((e) => ({ id: e.id, title: e.title, body: e.body, day: e.day, minute: e.minute,
        when: e.day === null ? "" : formatDate(cal, { day: e.day, minute: e.minute ?? 0 }) })),
    status: Object.fromEntries(Object.entries(statusOf(entries)).map(([who, fields]) => [who,
      Object.fromEntries(Object.entries(fields).map(([f, e]) => [f, e!.title]))])),
    bonds: bonds.sort((a, b) => mine(a) - mine(b)),
    factions: factionsOf(entries).map((f) => ({ key: f.key, name: f.name, description: f.description, members: f.members, standing: f.standing })),
    threads: threadsOf(entries).map((t) => ({ key: t.key, title: t.title, open: t.open })),
  };
}

/**
 * Something happened, now: stamped with the story's current moment and tied to
 * the chat's latest message, which is the one it happened after.
 */
function recordEvent(chatId: string, fields: Partial<ChronicleEntry>) {
  const at = clockOf(calendarOf(chatId), chronicleOf(chatId));
  const last = db.query("SELECT id FROM messages WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(chatId) as any;
  copyChronicle([normaliseChronicleEntry({
    ...fields, id: uid(), kind: "event", message_id: last?.id ?? null, day: at.day, minute: at.minute, created_at: now(),
  })], chatId);
}

/**
 * What the story model is told about the world, after the transcript where it
 * is read: what day it is, once the story has a calendar or has let time pass
 * — a chat that never has is not told "Day 1" for nothing — and, when Hearth
 * keeps the tracker, how everyone in the scene is right now. When a preset
 * keeps it, Hearth's own is left out entirely, so the model is never handed
 * two versions of one person.
 */
/**
 * What from earlier matters now — see src/recall.ts. The scene is the last few
 * messages; what is already in the conversation being sent is not remembered
 * twice, so the cut-off is worked out the way buildMessages makes it.
 */
function rememberFor(chat: any, s: Record<string, string>, entries: ChronicleEntry[], cal: Calendar, threads: string[],
  history?: { id: string; content: string }[]) {
  // The conversation as this reply will see it — without a reply being swiped away, with words not yet sent — newest first.
  const rows = history ? [...history].reverse()
    : db.query("SELECT id, content FROM messages WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC").all(chat.id) as any[];
  const budget = Number(s.context_tokens) > 0 ? Number(s.context_tokens) : 8000;
  const inContext = new Set<string>();
  let used = 0;
  for (const r of rows) {
    const cost = estimateTokens(r.content) + 4;
    if (used + cost > budget && inContext.size) break;
    used += cost;
    inContext.add(r.id);
  }
  const people = peopleOf(chat);
  const when = (e: ChronicleEntry) => (e.day !== null ? formatDate(cal, { day: e.day, minute: e.minute ?? 0 }) : "");
  return recall({
    entries: liveEntries(entries),
    bonds: bondsOf(entries),
    present: people.filter((p) => p.present).map((p) => p.name),
    everyone: [...new Set([...people.map((p) => p.name), ...peopleOfChat(chat.id)])],
    recent: rows.slice(0, 6).map((r) => r.content).join("\n"),
    inContext,
    threads,
    when,
  });
}

function worldBrief(chat: any, s: Record<string, string>, history?: { id: string; content: string }[],
  /** Filled with what was remembered and why, for the prompt inspector. */
  remembered?: { value?: ReturnType<typeof recall> }): string | null {
  // Story World off: a plain story, with nothing of it in the prompt.
  if (s.story_world === "0") return null;
  const cal = calendarOf(chat.id);
  const entries = chronicleOf(chat.id);
  const lines: string[] = [];
  const dated = cal.kind !== "undated" || liveEntries(entries).some((e) => e.kind === "time" || e.kind === "set");
  if (dated) {
    const at = clockOf(cal, entries);
    lines.push(`Today in the story: ${formatDate(cal, at)}${at.minute ? `, ${partOf(cal, at.minute)}` : ""}.`);
  }
  if (s.tracker_source !== "preset") {
    const status = statusOf(entries);
    const here = peopleOf(chat).filter((p) => p.present && status[p.name]);
    if (here.length) {
      lines.push("How everyone here is right now — keep to this unless the story changes it:");
      for (const p of here) {
        const facts = STATUS_FIELDS.filter((f) => status[p.name]![f]).map((f) => `${f}: ${status[p.name]![f]!.title}`);
        lines.push(`- ${p.name} — ${facts.join("; ")}`);
      }
    }
  }
  // Loose ends the story has left open, so they are not forgotten — a handful,
  // newest first; each a possibility to return to, not something to force.
  const open = threadsOf(entries).filter((t) => t.open).slice(0, 8);
  if (open.length) lines.push(`Threads still open, to pick up when it fits: ${open.map((t) => t.title).join("; ")}.`);
  const memory = rememberFor(chat, s, entries, cal, open.map((t) => t.title), history);
  if (remembered) remembered.value = memory;
  lines.push(...recallBrief(memory));
  lines.push(...offstageBrief(chat.id, entries));
  return lines.length ? lines.join("\n") : null;
}

/** Whether anybody else is sitting at this chat, which is when secrets start to matter. */
const isShared = (chatId: string) =>
  !!db.query("SELECT 1 FROM shares WHERE chat_id = ? AND open = 1 LIMIT 1").get(chatId);

function chronicleState(chatId: string) {
  const cal = calendarOf(chatId);
  const entries = chronicleOf(chatId);
  const at = clockOf(cal, entries);
  return {
    calendar: cal,
    now: { ...at, text: formatDate(cal, at) },
    // Whether anyone else is sitting at this chat: when secrets, the players'
    // view and hiding things start to mean something.
    shared: isShared(chatId),
    // The Offstage's ledger and what it hands the narrator are not part of
    // these pages: the ledger has its own, sealed one (GET /chats/:id/offstage).
    entries: chronicleView(entries.filter(onStage), { shared: isShared(chatId), host: true }),
    // How everyone is now, by the tracker — whichever field has a word on it.
    status: Object.fromEntries(Object.entries(statusOf(entries)).map(([who, fields]) => [who,
      Object.fromEntries(Object.entries(fields).map(([f, e]) => [f, { value: e!.title, evidence: e!.evidence, source: e!.source, id: e!.id }]))])),
    // How each person feels about each other one, one way round.
    bonds: bondsOf(entries).map((b) => ({ from: b.from, to: b.to, score: b.score, label: b.label, memory: b.memory,
      changes: b.history.length })),
    // The groups in the story, with their arms and the party's standing with them.
    factions: factionsOf(entries).map(({ entry, ...f }) => f),
    // Loose ends: open first, then the settled.
    threads: threadsOf(entries),
    // Waiting on the host. A hidden one is still hidden here: accepting it is
    // not the same as reading it.
    proposals: [
      ...chronicleView(pending(entries).filter(onStage).map((e) => ({ ...e, proposed: false })), { shared: isShared(chatId), host: true }),
      // A threat is asked about without being told: who is coming, and how, stays in the ledger.
      ...pending(entries).filter((e) => e.kind === "threat").map((e) => ({ id: e.id, kind: "threat", title: "", data: e.data })),
      // So is a conflict with the plan: which scene, and nothing of what happened. A scene not yet reached
      // in a book read blind is not named either.
      ...pending(entries).filter((e) => e.kind === "conflict").map((e) => ({ id: e.id, kind: "conflict", scene_id: e.scene_id,
        title: blindAhead(chatId, e.scene_id) ? "" : e.title })),
    ],
  };
}

/** Not the Offstage's: its ledger is private, and what it hands the narrator is the narrator's alone. */
const OFFSTAGE_KINDS = new Set(["agenda", "offstage", "hook", "consequence", "threat", "trait", "knows", "conflict"]);
const onStage = (e: ChronicleEntry) => e.visibility !== "private" && !OFFSTAGE_KINDS.has(e.kind);

api.get("/calendars", (c) => c.json(BUILTINS));

api.get("/chats/:id/chronicle", (c) => {
  const id = c.req.param("id");
  const chat = db.query("SELECT persona_id FROM chats WHERE id = ?").get(id) as any;
  if (!chat) return c.json({ error: "No such chat." }, 404);
  // The players' view: exactly what a seat at the table is shown, so the host
  // can check what is visible before revealing anything — or after.
  if (c.req.query("as") === "players") return c.json(tableWorld(id, whoAmI(chat.persona_id)?.name ?? ""));
  return c.json(chronicleState(id));
});

/**
 * Adding to it by hand: an event, time passing, or the clock set to a date.
 *
 * Time passing takes either a number of minutes or words ("three days",
 * "until dawn"), read by the same function the steward's answers will go
 * through — so the person and the model are held to one rule, and words it
 * cannot read are refused rather than guessed at.
 */
api.post("/chats/:id/chronicle", async (c) => {
  const chatId = c.req.param("id");
  if (!db.query("SELECT 1 FROM chats WHERE id = ?").get(chatId)) return c.json({ error: "No such chat." }, 404);
  const b = await c.req.json().catch(() => ({}));
  const cal = calendarOf(chatId);
  const at = clockOf(cal, chronicleOf(chatId));
  const kind = ["event", "time", "set", "status", "bond", "faction", "standing", "thread"].includes(b.kind) ? b.kind : "event";
  const lastMessage = () =>
    (db.query("SELECT id FROM messages WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(chatId) as any)?.id ?? null;
  const add = (fields: Record<string, unknown>) => {
    copyChronicle([normaliseChronicleEntry({ ...fields, id: uid(), kind, message_id: lastMessage(), day: at.day, minute: at.minute,
      visibility: b.visibility, source: "user", created_at: now() })], chatId);
    return c.json(chronicleState(chatId));
  };
  if (kind === "bond") {
    const from = String(b.from ?? "").trim().slice(0, 120);
    const to = String(b.to ?? "").trim().slice(0, 120);
    if (!from || !to || from === to) return c.json({ error: "A bond needs two different people." }, 400);
    // A person may set it outright: the step is whatever gets it there.
    const current = bondsOf(chronicleOf(chatId)).find((x) => x.from === from && x.to === to)?.score ?? BOND_START;
    const amount = Number.isFinite(Number(b.score)) && b.score !== null && b.score !== ""
      ? Math.max(0, Math.min(100, Math.round(Number(b.score)))) - current
      : Math.round(Number(b.amount) || 0);
    return add({ subject: from, object: to, amount, title: b.label, body: b.memory });
  }
  if (kind === "faction") {
    const set = await charges();
    const name = String(b.name ?? "").trim().slice(0, 80);
    const existing = b.key ? factionsOf(chronicleOf(chatId)).find((f) => f.key === b.key) : null;
    if (b.key && !existing) return c.json({ error: "No such faction in this chat." }, 404);
    if (b.gone) return add({ subject: existing!.key, title: existing!.name, data: { gone: true } });
    if (!name && !existing) return c.json({ error: "A faction needs a name." }, 400);
    let arms: Blazon | null = b.arms === undefined ? (existing?.arms as Blazon) ?? null : normaliseBlazon(b.arms, choosableCharges(set));
    if (!arms) arms = armsFromName(name || existing!.name, set.ids);
    if (getSettings().heraldry_contrast !== "0") arms = withContrast(arms);
    const members = Array.isArray(b.members) ? b.members.map((m: unknown) => String(m).slice(0, 120)).slice(0, 100) : existing?.members ?? [];
    return add({ subject: existing?.key ?? uid(), title: name || existing!.name,
      body: b.description === undefined ? existing?.description ?? "" : b.description, data: { arms, members } });
  }
  if (kind === "thread") {
    // Opened by name, or an existing one settled or reopened by its key.
    const name = String(b.name ?? b.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    const known = b.key ? threadsOf(chronicleOf(chatId)).find((t) => t.key === b.key) : null;
    if (b.key && !known) return c.json({ error: "No such thread in this chat." }, 404);
    if (!known && !name) return c.json({ error: "A thread needs a name." }, 400);
    const subject = known?.key ?? groupKey(name);
    if (!subject) return c.json({ error: "A thread needs a name." }, 400);
    const chat = db.query("SELECT * FROM chats WHERE id = ?").get(chatId) as any;
    const everyone = chat ? peopleOf(chat).map((p) => p.name) : [];
    return add({ subject, title: name || known!.title, amount: b.open === false || b.settled ? -1 : 1,
      data: { people: Array.isArray(b.people) ? b.people.map((p: unknown) => String(p).slice(0, 120)).slice(0, 20) : namedIn(name, everyone) } });
  }
  if (kind === "standing") {
    if (!factionsOf(chronicleOf(chatId)).some((f) => f.key === b.key)) return c.json({ error: "No such faction in this chat." }, 404);
    return add({ subject: b.key, amount: Math.round(Number(b.amount) || 0), title: b.title, body: b.body });
  }
  if (kind === "status") {
    const field = fieldOf(b.field);
    const subject = String(b.subject ?? "").trim().slice(0, 120);
    const value = String(b.value ?? "").trim().slice(0, 160);
    if (!field || !subject || !value) return c.json({ error: "A status needs who, which part of them, and how they are." }, 400);
    const last = db.query("SELECT id FROM messages WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(chatId) as any;
    copyChronicle([normaliseChronicleEntry({
      id: uid(), kind, subject, field, title: value, message_id: last?.id ?? null, day: at.day, minute: at.minute,
      visibility: b.visibility, source: "user", created_at: now(),
    })], chatId);
    return c.json(chronicleState(chatId));
  }

  let span = 0;
  let day: number | null = at.day;
  let minute: number | null = at.minute;
  if (kind === "time") {
    const read = Number.isFinite(Number(b.span)) && Number(b.span) > 0 ? Math.round(Number(b.span)) : readSpan(cal, b.text, at);
    if (!read) return c.json({ error: "Hearth could not tell how long that is. Try \"3 days\" or \"until dawn\"." }, 400);
    span = read;
    day = minute = null;
  } else if (kind === "set") {
    const d = b.date && typeof b.date === "object"
      ? fromParts(cal, Number(b.date.year), Number(b.date.month), Number(b.date.day))
      : Number.isInteger(Number(b.day)) && b.day !== null && b.day !== "" ? Number(b.day) : null;
    if (d === null) return c.json({ error: "That is not a date in this chat's calendar." }, 400);
    day = d;
    minute = Number.isFinite(Number(b.minute)) ? Math.round(Number(b.minute)) : 0;
  }

  const last = db.query("SELECT id FROM messages WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(chatId) as any;
  const e = normaliseChronicleEntry({
    id: uid(), kind, message_id: last?.id ?? null, day, minute, span,
    title: b.title, body: b.body, visibility: b.visibility, source: "user",
    scene_id: b.scene_id, created_at: now(),
  });
  if (kind === "event" && !e.title) return c.json({ error: "An event needs a name." }, 400);
  copyChronicle([e], chatId);
  return c.json(chronicleState(chatId));
});

/** Taking an entry back, and changing your mind about that. Nothing is ever deleted. */
function markUndone(c: any, undone: number | null) {
  const row = db.query("SELECT chat_id FROM chronicle WHERE id = ?").get(c.req.param("id")) as any;
  if (!row) return c.json({ error: "That entry is not in the chronicle." }, 404);
  db.query("UPDATE chronicle SET undone_at = ? WHERE id = ?").run(undone, c.req.param("id"));
  worldChanged(row.chat_id);
  return c.json(chronicleState(row.chat_id));
}
api.post("/chronicle/:id/undo", (c) => markUndone(c, now()));
api.post("/chronicle/:id/restore", (c) => markUndone(c, null));

/** Saying yes to something the Steward proposed: it counts from now on. Saying no is undo. */
api.post("/chronicle/:id/accept", (c) => {
  const row = db.query("SELECT chat_id, kind, scene_id FROM chronicle WHERE id = ?").get(c.req.param("id")) as any;
  if (!row) return c.json({ error: "That entry is not in the chronicle." }, 404);
  if (row.kind === "scene") {
    // "Move on": the scene is done, exactly as the tray's button does it — if
    // the chat is still in that scene. "Jump there": the story is already in a
    // later one, so it catches up to it. The question itself is then closed.
    const { book, mark } = taleOf(row.chat_id);
    let to = "";
    try { to = JSON.parse(String((db.query("SELECT data FROM chronicle WHERE id = ?").get(c.req.param("id")) as any)?.data || "{}")).to ?? ""; } catch {}
    if (to && book && mark) {
      setTale(row.chat_id, catchUpTo(book, mark, to));
      db.query("UPDATE chronicle SET undone_at = ? WHERE chat_id = ? AND kind = 'scene' AND proposed = 1 AND undone_at IS NULL").run(now(), row.chat_id);
    } else if (mark?.scene === row.scene_id) advanceTale(row.chat_id, "done");
    db.query("UPDATE chronicle SET proposed = 0, undone_at = ? WHERE id = ?").run(now(), c.req.param("id"));
    worldChanged(row.chat_id);
    return c.json(chronicleState(row.chat_id));
  }
  db.query("UPDATE chronicle SET proposed = 0 WHERE id = ?").run(c.req.param("id"));
  worldChanged(row.chat_id);
  return c.json(chronicleState(row.chat_id));
});

/**
 * A secret, told: everybody at the table may read it from now on. And the
 * other way, for the host: something the table should not see yet.
 */
function setVisibility(c: any, visibility: "table" | "hidden") {
  const row = db.query("SELECT chat_id FROM chronicle WHERE id = ?").get(c.req.param("id")) as any;
  if (!row) return c.json({ error: "That entry is not in the chronicle." }, 404);
  db.query("UPDATE chronicle SET visibility = ? WHERE id = ?").run(visibility, c.req.param("id"));
  worldChanged(row.chat_id);
  return c.json(chronicleState(row.chat_id));
}
api.post("/chronicle/:id/reveal", (c) => setVisibility(c, "table"));
api.post("/chronicle/:id/hide", (c) => setVisibility(c, "hidden"));

/**
 * Choosing a chat's calendar: a built-in by id, or a whole custom calendar.
 * Stored as a copy either way. Undated is stored as nothing at all, which is
 * also what every chat from before calendars has.
 */
api.put("/chats/:id/calendar", async (c) => {
  const chatId = c.req.param("id");
  if (!db.query("SELECT 1 FROM chats WHERE id = ?").get(chatId)) return c.json({ error: "No such chat." }, 404);
  const b = await c.req.json().catch(() => ({}));
  const cal = typeof b.id === "string" && builtin(b.id) ? builtin(b.id)! : normaliseCalendar(b.calendar);
  if (!cal) return c.json({ error: "That is not a calendar Hearth can read." }, 400);
  db.query("UPDATE chats SET calendar = ? WHERE id = ?").run(cal.kind === "undated" ? "" : JSON.stringify(cal), chatId);
  worldChanged(chatId);
  return c.json(chronicleState(chatId));
});

// ---- the faction charges ---------------------------------------------------
//
// The emblems in public/charges, read by the server to draw arms. Read from
// the public folder on disk, except in the installed desktop app, which has
// no such folder: desktop.ts points this at the copies compiled into it.

let readAsset: (path: string) => Promise<string | null> = async (path) => {
  try { return readFileSync(join("public", path), "utf8"); } catch { return null; }
};
let chargeSet: Promise<{ ids: string[]; paths: Record<string, string> }> | null = null;

/** Where the server reads public files from, for a build that keeps them somewhere else. */
export function readAssetsWith(read: (path: string) => Promise<string | null>) {
  readAsset = read;
  chargeSet = null;
  charges();
}

/** The charges if they have been read, for the places that cannot wait: an empty set until then. */
let chargesRead: { ids: string[]; paths: Record<string, string> } = { ids: [], paths: {} };
const chargesNow = () => chargesRead;

/** Every charge: its id, and its shape. Read once. An unreadable set is an empty one, never an error. */
function charges() {
  return (chargeSet ??= (async () => {
    const paths: Record<string, string> = {};
    try {
      const manifest = JSON.parse((await readAsset("/charges/manifest.json")) ?? "{}");
      for (const a of manifest.assets ?? []) {
        const d = (await readAsset(`/charges/${a.svg}`))?.match(/ d="([^"]+)"/)?.[1];
        if (d) paths[a.id] = d;
      }
    } catch {}
    chargesRead = { ids: Object.keys(paths), paths };
    return chargesRead;
  })());
}
// Read at start, so a narrator's [[faction:]] in the first reply finds them.
charges();

/*
 * Emblems of the person's own, uploaded. Kept apart from the drawn set: they
 * are pictures rather than paths, and they are never picked for a faction by
 * itself — a narrator's [[faction:]] or arms from a name only ever draws from
 * the set above. One folder, and an index of names beside the files.
 */
const OWN_CHARGES = join(UPLOADS, "charges");
type OwnCharge = { id: string; name: string; file: string };

function ownCharges(): OwnCharge[] {
  try {
    const list = JSON.parse(readFileSync(join(OWN_CHARGES, "index.json"), "utf8"));
    return Array.isArray(list) ? list.filter((x) => /^own_[a-z]+$/.test(x?.id) && existsSync(join(OWN_CHARGES, x.file))) : [];
  } catch { return []; }
}

/** The pictures, as data, for drawing — only those this blazon uses. */
function ownChargeImages(b: Blazon | null): Record<string, string> {
  const want = b?.charge?.type;
  const own = want ? ownCharges().find((x) => x.id === want) : null;
  if (!own) return {};
  try { return { [own.id]: `data:image/png;base64,${readFileSync(join(OWN_CHARGES, own.file)).toString("base64")}` }; }
  catch { return {}; }
}

/** Every id a person may choose: the drawn set and their own. */
const choosableCharges = (set: { ids: string[] }) => [...set.ids, ...ownCharges().map((x) => x.id)];

api.get("/charges/own", (c) => c.json({ guide: UPLOAD_GUIDE, charges: ownCharges().map(({ id, name, file }) => ({ id, name, url: `/uploads/charges/${file}` })) }));

api.post("/charges/own", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "No picture received." }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = uploadProblem(bytes);
  if (problem) return c.json({ error: problem }, 400);
  mkdirSync(OWN_CHARGES, { recursive: true });
  // Letters only: chargeFor reads an id as words, and digits are not words.
  const id = "own_" + Array.from(crypto.getRandomValues(new Uint8Array(10)), (n) => String.fromCharCode(97 + (n % 26))).join("");
  const name = String(form?.get("name") ?? file.name.replace(/\.[a-z0-9]+$/i, "")).trim().slice(0, 60) || "My emblem";
  writeFileSync(join(OWN_CHARGES, `${id}.png`), bytes);
  const list = [...ownCharges(), { id, name, file: `${id}.png` }];
  writeFileSync(join(OWN_CHARGES, "index.json"), JSON.stringify(list, null, 2));
  return c.json({ id, name, url: `/uploads/charges/${id}.png` });
});

/** A faction already wearing it keeps the choice and draws no emblem, the same as one whose charge was never found. */
api.delete("/charges/own/:id", (c) => {
  const id = c.req.param("id");
  const list = ownCharges();
  const gone = list.find((x) => x.id === id);
  if (!gone) return c.json({ error: "No such emblem." }, 404);
  rmSync(join(OWN_CHARGES, gone.file), { force: true });
  writeFileSync(join(OWN_CHARGES, "index.json"), JSON.stringify(list.filter((x) => x !== gone), null, 2));
  return c.json({ ok: true });
});

/** A faction's arms, drawn. A badge on the modern calendar unless told otherwise. */
api.get("/chats/:id/factions/:key/arms.svg", async (c) => {
  const chatId = c.req.param("id");
  const f = factionsOf(chronicleOf(chatId)).find((x) => x.key === c.req.param("key"))
    ?? pending(chronicleOf(chatId)).filter((e) => e.kind === "faction" && e.subject === c.req.param("key"))
      .map((e) => ({ key: e.subject!, name: e.title, arms: (() => { try { return JSON.parse(e.data).arms; } catch { return null; } })() }))[0];
  if (!f) return c.json({ error: "No such faction in this chat." }, 404);
  const set = await charges();
  const s = getSettings();
  const style = s.heraldry_style === "shield" || s.heraldry_style === "badge" ? s.heraldry_style
    : calendarOf(chatId).kind === "gregorian" ? "badge" : "shield";
  const arms = normaliseBlazon(f.arms, choosableCharges(set)) ?? armsFromName(f.name, set.ids);
  const svg = drawArms(s.heraldry_contrast === "0" ? arms : withContrast(arms), set.paths,
    { style, id: `f${String(f.key).slice(0, 12)}`, label: `Arms of ${f.name}`, images: ownChargeImages(arms) });
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "no-cache" } });
});

// ---- the Offstage -----------------------------------------------------------
//
// What the people the player is not watching decide to do. See src/offstage.ts
// for why the narrator is only ever handed what became true and what could be
// noticed, never who did it or why.


/** The Offstage's own connection: its own if set, then the Steward's, then the story's. */
function offstageConnection(s: Record<string, string>) {
  const provider = s.offstage_provider || s.steward_provider || s.provider;
  return { ...connectionFrom(s, provider), model: s.offstage_model || s.steward_model || s.model };
}

const dataOf = (e: { data: string }): any => { try { return e.data ? JSON.parse(e.data) : {}; } catch { return {}; } };

/** Goals, with how each stands now: a goal is its entry, and any later entry about it (`data.of`) changes its status. */
function agendasOf(entries: ChronicleEntry[]) {
  const out = new Map<string, Agenda & { status: string; since: number; source: string }>();
  for (const e of liveEntries(entries)) {
    if (e.kind !== "agenda") continue;
    const d = dataOf(e);
    if (d.of) { const g = out.get(d.of); if (g) g.status = String(d.status || g.status); continue; }
    out.set(e.id, { id: e.id, who: e.subject ?? "", goal: e.title, why: e.body, status: "active", since: e.day ?? 0, source: e.source });
  }
  return [...out.values()];
}

/** Someone who cannot act today: dead, or held. Read from the tracker; anything unclear may act. */
const cannotAct = (fields: Record<string, { title: string } | undefined> | undefined) =>
  /\b(dead|died|slain|killed|executed|imprisoned|in chains|in a cell|dungeon|captive|unconscious)\b/i
    .test(`${fields?.physical?.title ?? ""} ${fields?.location?.title ?? ""}`);

/**
 * What one person may know when they decide, and nothing more: what they were
 * there for, what they did themselves and how it went, how they are, how they
 * feel. Never the ledger's other entries, never anything hidden they had no
 * part in. A secret they could not have does not reach the prompt.
 */
/** How careful each person is, as the author last set it. */
function discretions(entries: ChronicleEntry[]): Record<string, Discretion> {
  const out: Record<string, Discretion> = {};
  for (const e of liveEntries(entries)) if (e.kind === "trait" && e.subject) out[e.subject] = discretionOf(e.title);
  return out;
}

/** Words too common to say two things are about the same matter. */
const NOT_TELLING = new Set(["about", "their", "there", "which", "would", "could", "other", "where", "while", "after", "before", "again"]);

function viewFor(chat: any, who: string, entries: ChronicleEntry[], cal: Calendar, goals: Agenda[]): View & { lately: string[] } {
  const live = liveEntries(entries);
  const at = clockOf(cal, entries);
  const status = statusOf(entries)[who] ?? {};
  const card = db.query("SELECT description, personality FROM characters WHERE name = ? LIMIT 1").get(who) as any;
  const mine = live.filter((e) => e.kind === "offstage" && e.subject === who);
  const known = live.filter((e) => e.kind === "event" && e.visibility !== "private" && namesIn(`${e.title} ${e.body}`, who))
    .slice(-12).map((e) => `${e.day !== null ? `${formatDate(cal, { day: e.day, minute: e.minute ?? 0 })}: ` : ""}${e.title}${e.body ? ` (${e.body})` : ""}`);
  // What they have seen, found or been told — their version, garbled or not.
  known.push(...knowingsOf(entries).filter((k) => k.holder === who).slice(-6).map((k) => knowingTold(k, "self")));
  const lately = mine.slice(-5).map((e) => {
    const d = dataOf(e);
    return `${e.title}${d.outcome === "failed" ? " — it failed" : d.outcome === "succeeded" ? " — it worked" : ""}`;
  });
  const oldest = Math.min(...goals.map((g) => (g as any).since ?? at.day), at.day);
  // The unresolved matters they are caught up in: open threads the story has that name them or touch what
  // they want, and those they have had a hand in — their own secret ones included, which nobody else is shown.
  const wanting = new Set(goals.flatMap((g) => groupKey(g.goal).split(" ")).filter((w) => w.length > 4 && !NOT_TELLING.has(w)));
  const all = threadsOf(entries, { hidden: true });
  const theirs = all.filter((t) => t.open && (t.by.includes(who) || (!t.hidden
    && (t.people.includes(who) || namesIn(`${t.title} ${t.evidence}`, who) || t.key.split(" ").some((w) => wanting.has(w))))));
  // And the public threads tied to theirs: Cersei's secret matter is bound up with the wedding, whatever either is called.
  const tied = all.filter((t) => t.open && !t.hidden && !theirs.includes(t) && theirs.some((m) => m.related.includes(t.key) || t.related.includes(m.key)));
  const threads = [...theirs, ...tied]
    .slice(0, 6).map((t) => {
      const mine = t.notes.filter((n) => n.by === who).at(-1);
      return `${t.title}${t.hidden ? " (nobody else knows of it yet)" : ""}${mine ? ` — last: ${mine.text}` : ""}`;
    });
  return {
    who,
    card: card ? `${card.description ?? ""}\n${card.personality ?? ""}`.trim().slice(0, 1500) : "",
    player: whoAmI(chat.persona_id)?.name ?? "",
    today: formatDate(cal, at),
    state: STATUS_FIELDS.filter((f) => status[f]).map((f) => `${f}: ${status[f]!.title}`),
    feelings: bondsOf(entries).filter((b) => b.from === who).map((b) => `${b.to}: ${b.label || "no particular word for it"} (${b.score}/100)`),
    goals,
    known,
    lately,
    threads,
    discretion: discretions(entries)[who],
    pressure: pressureOf(mine.slice(-3).map((e) => { const o = dataOf(e).outcome; return { succeeded: o === "succeeded" ? true : o === "failed" ? false : null }; }), at.day - oldest),
  };
}

/**
 * What someone did to the story's threads, checked against the threads there
 * are. Everything the Offstage does to one is private — a new matter moving
 * out of sight, a step on an old one — so a plot never names itself on a page
 * the story or its author can see. A thread comes into the open only when the
 * story shows it, and the Steward, reading the story, says so.
 *
 * The one exception is settling a thread the story already has: when it
 * worked and left something true in the world, the thread is settled where
 * everyone sees, in the words of what became true — which have already been
 * checked for pointing at anyone.
 */
function threadMoves(r: ReturnType<typeof ruleOn>, outcome: "succeeded" | "failed", who: string, entries: ChronicleEntry[],
  base: Record<string, unknown>, next: () => number, everyone: string[] = []) {
  const known = threadsOf(entries, { hidden: true });
  // Threads moved by one decision are one matter seen from two sides — the wedding, and the plot against it.
  const together = r.threads.map((m) => {
    const key = groupKey(m.name);
    return (known.find((t) => t.key === key) ?? known.find((t) => Math.min(t.key.length, key.length) >= 6 && (t.key.includes(key) || key.includes(t.key))))?.key ?? key;
  }).filter(Boolean);
  const out: ChronicleEntry[] = [];
  const kept: { move: string; name: string; note: string }[] = [];
  let secretOpen = known.filter((t) => t.hidden && t.open).length;
  for (const m of r.threads) {
    const key = groupKey(m.name);
    if (!key) continue;
    // The same matter under a slightly different name is the same matter.
    const same = known.find((t) => t.key === key)
      ?? known.find((t) => Math.min(t.key.length, key.length) >= 6 && (t.key.includes(key) || key.includes(t.key)));
    let move = m.move;
    if (move === "open" && same?.open) move = "advance";
    if (move !== "open" && !same) { r.notes.push(`moved a thread there is none of: ${m.name}`); continue; }
    if (move !== "open" && !same!.open) { r.notes.push(`moved a thread already settled: ${same!.title}`); continue; }
    if (move === "advance" && outcome === "failed") { r.notes.push(`it failed, so ${same!.title} did not move on`); continue; }
    if (move === "settle" && outcome === "failed") { r.notes.push(`it failed, so ${same!.title} is not settled`); continue; }
    if (move === "open" && secretOpen >= 12) { r.notes.push("too many matters already moving out of sight"); continue; }
    if (kept.some((k) => groupKey(k.name) === (same?.key ?? key))) continue;
    const note = m.note || r.act;
    const data = { by: who, move, people: [...new Set([who, ...namedIn(`${m.name} ${note}`, everyone)])],
      related: together.filter((k) => k !== (same?.key ?? key)) };
    if (move === "open") {
      out.push(normaliseChronicleEntry({ ...base, id: uid(), kind: "thread", subject: same?.key ?? key, title: m.name, amount: 1, body: note, data, created_at: next() }));
      secretOpen++;
    } else if (move === "settle") {
      out.push(normaliseChronicleEntry({ ...base, id: uid(), kind: "thread", subject: same!.key, title: same!.title, amount: -1, body: note, data, created_at: next() }));
      if (!same!.hidden && r.fact) {
        out.push(normaliseChronicleEntry({ ...base, visibility: "table", id: uid(), kind: "thread", subject: same!.key, title: same!.title, amount: -1,
          body: r.fact, created_at: next() }));
      }
    } else {
      out.push(normaliseChronicleEntry({ ...base, id: uid(), kind: "thread", subject: same!.key, title: "", amount: 0, body: note, data, created_at: next() }));
    }
    kept.push({ move, name: same?.title ?? m.name, note });
  }
  return { entries: out, kept };
}

/**
 * One run: a few people, each deciding from inside their own head, checked in
 * code, rolled where the outcome is in doubt, and written to the ledger. The
 * narrator gets only what became true and what could be noticed; a threat to
 * the player's character becomes a question, then a scene — never an outcome.
 */
async function offstageRun(chatId: string, o: { manual?: boolean } = {}) {
  const s = getSettings();
  const level = levelOf(s.offstage_level);
  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(chatId) as any;
  if (!chat) return { error: "No such chat." };
  const cal = calendarOf(chatId);
  let entries = chronicleOf(chatId);
  const at = clockOf(cal, entries);
  const goals = agendasOf(entries).filter((g) => g.status === "active" && g.who);
  if (!goals.length) return { acted: 0, quiet: 0, threats: 0, note: "Nobody has a goal yet." };
  const status = statusOf(entries);
  const lastActed = new Map<string, number>();
  for (const e of liveEntries(entries)) if (e.kind === "offstage" && e.subject) lastActed.set(e.subject, e.created_at);
  const perDay = Math.max(1, Number(s.offstage_per_day) || 2);
  const today = liveEntries(entries).filter((e) => e.kind === "offstage" && dataOf(e).day === at.day && dataOf(e).outcome !== "dropped").length;
  const room = Math.max(0, perDay - today);
  if (!room) return { acted: 0, quiet: 0, threats: 0, note: "Everyone who could act today already has." };
  // Who goes: those with a goal, longest idle first, and able to act at all.
  const who = [...new Set(goals.map((g) => g.who))]
    .filter((w) => !cannotAct(status[w] as any))
    .sort((a, b) => (lastActed.get(a) ?? 0) - (lastActed.get(b) ?? 0))
    .slice(0, Math.min(room, Math.max(1, ACTORS_PER_RUN[level] || (o.manual ? 1 : 0))));
  const trigger = (db.query("SELECT id FROM messages WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(chatId) as any)?.id ?? null;
  const player = whoAmI(chat.persona_id)?.name ?? "";
  const conn = offstageConnection(s);
  const fold = needsFoldedSystem(conn.model);
  const protection = protectionOf(s.offstage_protection);
  let acted = 0, quiet = 0, threats = 0;
  let t = now();
  // The author's plan, the scene now and the two after: for the referee, never for the person deciding.
  const { book: taleBook, mark: taleMark } = taleOf(chatId);
  const planned = taleBook && taleMark?.scene ? (() => {
    const now_ = scenesOf(taleBook).find(({ scene }) => scene.id === taleMark.scene)?.scene;
    const ahead = scenesAhead(taleBook, taleMark).slice(0, 2).map((a) => scenesOf(taleBook).find(({ scene }) => scene.id === a.id)!.scene);
    return [now_, ...ahead].filter(Boolean).map((sc, i) => ({ n: i + 1, id: sc!.id, title: sc!.title.trim() || "untitled",
      about: [sc!.cast.trim() && `with ${sc!.cast.trim()}`, sc!.purpose.trim() || sc!.ending.trim()].filter(Boolean).join("; ").slice(0, 240) }));
  })() : [];
  for (const person of who) {
    const theirs = goals.filter((g) => g.who === person);
    const view = { ...viewFor(chat, person, entries, cal, theirs), plan: planned.map(({ n, title, about }) => ({ n, title, about })) };
    const prompt = offstagePrompt(view);
    let said = "";
    try {
      for await (const chunk of generate({
        ...conn, system: fold ? "" : OFFSTAGE_SYSTEM,
        messages: [{ role: "user", content: fold ? `${OFFSTAGE_SYSTEM}\n\n---\n\n${prompt}` : prompt }],
        sampling: { temperature: 0.8, maxTokens: 700, topP: 1, minP: 0, repetitionPenalty: 1, frequencyPenalty: 0, presencePenalty: 0, stream: false, reasoningEffort: "off" },
      })) {
        if (chunk.kind === "text") said += chunk.text;
        if (said.length > 6000) break;
      }
    } catch (e: any) {
      return { acted, quiet, threats, error: e?.message || "The Offstage could not be reached." };
    }
    const d = readDecision(withoutThinking(said));
    const card = db.query("SELECT description, personality FROM characters WHERE name = ? LIMIT 1").get(person) as any;
    const theirFactions = factionsOf(entries).filter((f) => f.members.includes(person)).map((f) => f.name);
    const identity = identityOf(person, `${card?.description ?? ""} ${card?.personality ?? ""}`, theirFactions);
    const r = ruleOn(d, { who: person, player, protection, goals: theirs, identity });
    const out = r.kind === "act" && !r.threat ? resolveAttempt(r.difficulty) : { succeeded: r.kind !== "dropped", roll: null, dc: 0 };
    const outcome = r.kind === "dropped" ? "dropped" : r.threat ? "threat" : r.kind !== "act" ? "routine"
      : out.roll === null ? "succeeded" : out.succeeded ? "succeeded" : "failed";
    // Whether it worked and whether it was seen are two questions, rolled apart.
    const trace = r.clue && (outcome === "succeeded" || outcome === "failed") ? traceOf(r.difficulty, outcome === "succeeded", Math.random, discretions(entries)[person]) : { left: false, roll: null, dc: 0 };
    const add: ChronicleEntry[] = [];
    const base = { message_id: trigger, day: at.day, minute: at.minute, source: "offstage", visibility: "private" };
    // How it bore on the plan, matched to the scenes that were listed. A failure bears on nothing.
    const planMarks = outcome === "succeeded" || outcome === "failed"
      ? r.plan.filter((m) => outcome === "succeeded" || m.relation !== "supports").map((m) => {
        const sc = planned.find((p) => p.n === m.n);
        return sc ? { scene: sc.id, title: sc.title, relation: m.relation, how: m.how } : null;
      }).filter((m): m is NonNullable<typeof m> => !!m) : [];
    const moved = outcome === "succeeded" || outcome === "failed" ? threadMoves(r, outcome, person, entries, base, () => t++, [...peopleOfChat(chatId), player]) : { entries: [], kept: [] };
    add.push(normaliseChronicleEntry({ ...base, id: uid(), kind: "offstage", subject: person,
      title: r.act || (r.kind === "abandon" ? "Gave something up" : "An ordinary day"), body: r.why, created_at: t++,
      data: { day: at.day, want: d.want, fear: d.fear, considered: d.considered.slice(0, 4), choice: d.choice, kind: r.kind,
              difficulty: r.difficulty, harm: r.harm, roll: out.roll, dc: out.dc, outcome, notes: r.notes,
              seen: r.seen, fact: r.fact, clue: r.clue, traced: trace.left, trace_roll: trace.roll, trace_dc: trace.dc, threads: moved.kept, plan: planMarks } }));
    add.push(...moved.entries);
    // A conflict with the plan is the author's to know about — not to have solved for them. Asked once per scene,
    // above the writing line, like a threat: which scene, never who or how; that stays in the ledger.
    if (outcome === "succeeded" || outcome === "failed") {
      const flagged = new Set(pending(entries).filter((e) => e.kind === "conflict" && e.scene_id).map((e) => e.scene_id));
      for (const m of planMarks) {
        if (m.relation !== "conflicts" || flagged.has(m.scene)) continue;
        flagged.add(m.scene);
        add.push(normaliseChronicleEntry({ ...base, id: uid(), kind: "conflict", scene_id: m.scene, title: m.title, body: m.how,
          created_at: t++, proposed: true, data: { relation: m.relation } }));
      }
    }
    // What the narrator may have: what could be seen — even of a failure — and what is now true, only on success.
    if (r.seen && outcome !== "dropped" && !r.threat) {
      add.push(normaliseChronicleEntry({ ...base, visibility: "hidden", id: uid(), kind: "hook", title: r.seen, created_at: t++, data: { until: at.day + 3 } }));
    }
    // The one deliberate clue, which may point to them — left when their discretion failed, whether or not the thing worked.
    if (r.clue && trace.left) {
      const hook = uid();
      add.push(normaliseChronicleEntry({ ...base, visibility: "hidden", id: hook, kind: "hook", title: r.clue, created_at: t++, data: { until: at.day + 5, clue: true, by: [person] } }));
      // Someone saw: their own knowledge, apart from the trace — what they took in, which may not be who.
      if (r.witness) {
        const g = gossipOf(s.gossip_level);
        add.push(knowingEntry({ holder: r.witness.who, version: r.witness.saw, of: hook, source: "saw", from: "", distortion: 0, blames: "",
          spreads: willSpread(r.witness.who, [person], g, { rng: Math.random, closeness: (f, to) => bondsOf(entries).find((b) => b.from === f && b.to === to)?.score ?? 50 }),
          day: at.day, by: [person] }, base, t++));
      }
    }
    if (r.fact && outcome === "succeeded") {
      add.push(normaliseChronicleEntry({ ...base, visibility: "hidden", id: uid(), kind: "consequence", title: r.fact, created_at: t++ }));
    }
    if (r.threat) {
      add.push(normaliseChronicleEntry({ ...base, id: uid(), kind: "threat", subject: person, title: r.act, body: r.why,
        created_at: t++, proposed: true, data: { player, harm: r.harm } }));
      threats++;
    }
    if (r.abandons) add.push(normaliseChronicleEntry({ ...base, id: uid(), kind: "agenda", subject: person, title: "", created_at: t++, data: { of: r.abandons, status: "abandoned" } }));
    if (r.goal && outcome !== "dropped") add.push(normaliseChronicleEntry({ ...base, id: uid(), kind: "agenda", subject: person, title: r.goal.goal, body: r.goal.why, created_at: t++ }));
    copyChronicle(add, chatId);
    entries = chronicleOf(chatId);
    if (outcome === "routine") quiet++; else if (outcome !== "dropped") acted++;
  }
  // And then the day's whispering: traces found, things told on. See src/whispers.ts.
  const g = gossipOf(s.gossip_level);
  if (g !== "off") {
    const live = liveEntries(entries);
    const knowings = knowingsOf(entries);
    const traces = live.filter((e) => e.kind === "hook" && dataOf(e).clue)
      .map((e) => ({ id: e.id, text: e.title, by: Array.isArray(dataOf(e).by) ? dataOf(e).by : [], day: e.day ?? at.day }));
    const fresh = gossipDay({ level: g, distortion: Number(s.gossip_distortion) || 0, misinformation: s.gossip_misinfo !== "0",
      decayDays: Number(s.gossip_decay) > 0 ? Number(s.gossip_decay) : 10, day: at.day, knowings, traces,
      people: peopleOfChat(chatId), player, rng: Math.random,
      // Along the story's own ties: how each feels about the other, and who stands together.
      closeness: (() => { const b = new Map(bondsOf(entries).map((x) => [`${x.from}\u0000${x.to}`, x.score])); return (f: string, t: string) => b.get(`${f}\u0000${t}`) ?? 50; })(),
      together: (() => { const fs = factionsOf(entries).map((f) => f.members); return (x: string, y: string) => fs.some((m) => m.includes(x) && m.includes(y)); })() });
    const base = { message_id: trigger, day: at.day, minute: at.minute, source: "offstage", visibility: "private" };
    if (fresh.length) copyChronicle(fresh.map((k) => knowingEntry(k, base, t++)), chatId);
  }
  return { acted, quiet, threats };
}

/** Someone knowing something, as a record: private, never the thing itself, pointing back at it. */
function knowingEntry(k: Knowing, base: Record<string, unknown>, at: number) {
  return normaliseChronicleEntry({ ...base, id: uid(), kind: "knows", subject: k.holder, title: k.version, created_at: at,
    data: { of: k.of, source: k.source, from: k.from, distortion: k.distortion, blames: k.blames, spreads: k.spreads, day: k.day, by: k.by } });
}

function knowingsOf(entries: ChronicleEntry[]): Knowing[] {
  return liveEntries(entries).filter((e) => e.kind === "knows" && e.subject).map((e) => {
    const d = dataOf(e);
    return { holder: e.subject!, version: e.title, of: String(d.of ?? ""), source: d.source === "saw" || d.source === "found" ? d.source : "told",
      from: String(d.from ?? ""), distortion: Number(d.distortion) || 0, blames: String(d.blames ?? ""), spreads: !!d.spreads,
      day: Number.isFinite(Number(d.day)) ? Number(d.day) : e.day ?? 0, by: Array.isArray(d.by) ? d.by.map(String) : [] };
  });
}

/** After a reply: when the story's day has turned, the Offstage takes its turn — once per day, never per message. */
export async function offstageTurn(chatId: string) {
  const s = getSettings();
  if (levelOf(s.offstage_level) === "off" || s.mode === "tabletop" || s.story_world === "0") return;
  const chat = db.query("SELECT offstage_day FROM chats WHERE id = ?").get(chatId) as any;
  if (!chat) return;
  const day = clockOf(calendarOf(chatId), chronicleOf(chatId)).day;
  // The first time, the day is only noted: turning this on does not set the world moving behind a scene already under way.
  if (chat.offstage_day < 0 || day <= chat.offstage_day) {
    if (chat.offstage_day < 0) db.query("UPDATE chats SET offstage_day = ? WHERE id = ?").run(day, chatId);
    return;
  }
  db.query("UPDATE chats SET offstage_day = ? WHERE id = ?").run(day, chatId);
  await offstageRun(chatId);
}

/**
 * What the narrator is told of it all: what has become true, what could be
 * noticed, and a threat let in as a scene. Never a name with a secret, never
 * a plan — those are in the ledger, and the ledger is not in the prompt.
 */
function offstageBrief(chatId: string, entries: ChronicleEntry[]): string[] {
  const live = liveEntries(entries);
  const day = clockOf(calendarOf(chatId), entries).day;
  const facts = live.filter((e) => e.kind === "consequence").slice(-6).map((e) => e.title);
  const hooks = live.filter((e) => e.kind === "hook" && (dataOf(e).until ?? day) >= day).slice(-4).map((e) => e.title);
  const threat = live.filter((e) => e.kind === "threat").at(-1);
  const out: string[] = [];
  // Rumours held by people in the scene: theirs to bring up, believe or keep — never the truth of it.
  const s = getSettings();
  if (gossipOf(s.gossip_level) !== "off") {
    const chat = db.query("SELECT * FROM chats WHERE id = ?").get(chatId) as any;
    const here = new Set(chat ? peopleOf(chat).filter((p) => p.present && p.note !== "the player").map((p) => p.name) : []);
    const decay = Number(s.gossip_decay) > 0 ? Number(s.gossip_decay) : 10;
    const rumours = knowingsOf(entries).filter((k) => here.has(k.holder) && !k.by.includes(k.holder) && stillGoing(k, day, decay * 2)).slice(-4);
    if (rumours.length) {
      out.push(`What some of the people here have seen or heard — each knows only their own, may be wrong, and may or may not choose to share it. It is not the truth, and the player's character does not know it unless told in the story: ${rumours.map((k) => knowingTold(k, "narrator")).join("; ")}.`);
    }
  }
  if (facts.length) {
    out.push(`True in the world now, whether or not the player's character knows it — let it show only through what they could actually see or hear: ${facts.join("; ")}.`);
  }
  if (hooks.length) {
    out.push(`Things that could be noticed, if the player's character is somewhere to notice them. Never decide that they noticed, or what they make of it — that is the player's: ${hooks.join("; ")}.`);
  }
  if (threat) {
    out.push(`Bring this into the story now, as something happening in the scene: ${threat.title}. Play out the attempt, but do not decide whether it succeeds — the player's character may resist, escape or be helped. Never decide what they do, say or feel.`);
  }
  return out;
}

/** The ledger: goals, what people did, what reached the narrator. For the author, who sees it only when they unseal it. */
api.get("/chats/:id/offstage", (c) => {
  const chatId = c.req.param("id");
  const entries = chronicleOf(chatId);
  const live = liveEntries(entries);
  const cal = calendarOf(chatId);
  const when = (e: ChronicleEntry) => (e.day !== null ? formatDate(cal, { day: e.day, minute: e.minute ?? 0 }) : "");
  return c.json({
    goals: agendasOf(entries).map(({ id, who, goal, why, status, source }) => ({ id, who, goal, why, status, source })),
    actions: live.filter((e) => e.kind === "offstage").reverse().slice(0, 60)
      .map((e) => ({ id: e.id, who: e.subject, what: e.title, why: e.body, when: when(e), ...dataOf(e) })),
    told: {
      facts: live.filter((e) => e.kind === "consequence").reverse().slice(0, 20).map((e) => ({ id: e.id, text: e.title, when: when(e) })),
      hooks: live.filter((e) => e.kind === "hook").reverse().slice(0, 20).map((e) => ({ id: e.id, text: e.title, when: when(e) })),
    },
    discretion: discretions(entries),
    // Who knows what: every version, where it came from, and whether it is still going around.
    whispers: knowingsOf(entries).reverse().slice(0, 60),
    // Matters moving out of sight, and what was done offstage to the ones the story has.
    threads: threadsOf(entries, { hidden: true }).filter((t) => t.hidden || t.notes.some((n) => n.private))
      .map((t) => ({ key: t.key, title: t.title, open: t.open, hidden: t.hidden, notes: t.notes.filter((n) => n.private).map((n) => ({ ...n, when: n.day === null ? "" : formatDate(cal, { day: n.day, minute: 0 }) })) })),
    people: [...new Set([...peopleOfChat(chatId), ...agendasOf(entries).map((g) => g.who)])].filter(Boolean),
  });
});

/** People who could be given a goal: the chat's own cast first, then everyone the story's records name. */
function peopleOfChat(chatId: string): string[] {
  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(chatId) as any;
  if (!chat) return [];
  const player = whoAmI(chat.persona_id)?.name ?? "";
  const entries = chronicleOf(chatId);
  const named = [...Object.keys(statusOf(entries)), ...bondsOf(entries).flatMap((b) => [b.from, b.to])];
  return [...new Set([...peopleOf(chat).map((p: any) => p.name), ...named])].filter((n) => n && n !== player);
}

api.post("/chats/:id/offstage/goal", async (c) => {
  const chatId = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const who = String(b.who ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const goal = String(b.goal ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!who || !goal) return c.json({ error: "A goal needs someone, and what they want." }, 400);
  const at = clockOf(calendarOf(chatId), chronicleOf(chatId));
  copyChronicle([normaliseChronicleEntry({ id: uid(), kind: "agenda", subject: who, title: goal, body: String(b.why ?? "").slice(0, 300),
    visibility: "private", source: "user", day: at.day, minute: at.minute, created_at: now() })], chatId);
  return c.json({ ok: true });
});

/** How careful someone is: the author's to say. Not a secret, and not tied to any message — it is not something the story did. */
api.post("/chats/:id/offstage/trait", async (c) => {
  const chatId = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const who = String(b.who ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!who) return c.json({ error: "Who?" }, 400);
  copyChronicle([normaliseChronicleEntry({ id: uid(), kind: "trait", subject: who, title: discretionOf(b.discretion),
    visibility: "private", source: "user", created_at: now() })], chatId);
  return c.json({ ok: true, discretion: discretions(chronicleOf(chatId)) });
});

api.post("/chats/:id/offstage/goal/:goal", async (c) => {
  const chatId = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const status = ["active", "abandoned", "achieved"].includes(b.status) ? b.status : "abandoned";
  if (!agendasOf(chronicleOf(chatId)).some((g) => g.id === c.req.param("goal"))) return c.json({ error: "No such goal." }, 404);
  copyChronicle([normaliseChronicleEntry({ id: uid(), kind: "agenda", title: "", visibility: "private", source: "user",
    created_at: now(), data: { of: c.req.param("goal"), status } })], chatId);
  return c.json({ ok: true });
});

/** A day offstage, now: for trying it, and for when the story wants the world to move. */
api.post("/chats/:id/offstage/run", async (c) => c.json(await offstageRun(c.req.param("id"), { manual: true })));

// ---- the Steward -----------------------------------------------------------
//
// The background model that keeps the chronicle. See src/steward.ts for why
// nothing it says is believed until it has been checked against the story.

/** The Steward's own connection, falling back to the story's for anything left empty. */
function stewardConnection(s: Record<string, string>) {
  const provider = s.steward_provider || s.provider;
  return { ...connectionFrom(s, provider), model: s.steward_model || s.model };
}

/** Who the Steward may refer to, by number: the room, the people met on the way, and the player. */
function peopleOf(chat: any): Person[] {
  // A muted member is away from the scene: named, so events can mention them,
  // but not tracked, since nothing about them is being shown.
  const out: Person[] = membersOf(chat).map((m: any) => ({ name: m.name, present: !m.muted }));
  if (!out.length) {
    const founder = db.query("SELECT name FROM characters WHERE id = ?").get(chat.character_id) as any;
    if (founder?.name) out.push({ name: founder.name, present: true });
  }
  for (const n of db.query("SELECT name FROM npcs WHERE chat_id = ? AND deleted_at IS NULL ORDER BY created_at").all(chat.id) as any[]) {
    out.push({ name: n.name, note: "met in the story", present: true });
  }
  const me = whoAmI(chat.persona_id);
  if (me?.name) out.push({ name: me.name, note: "the player", present: true });
  const seen = new Set<string>();
  return out.filter((p) => p.name && !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase()));
}

/**
 * The Steward has read something that has since changed. What it recorded
 * from those words is taken back, and its place is wound back to before
 * them, so the new words are read in their turn. Taken back, not deleted:
 * the record of what it once thought stays, counting for nothing.
 */
function forgetSteward(messageIds: string[], reread = true, narrator = true) {
  const t = now();
  // The narrator's own marks go with the words they were written in, as the Steward's readings do —
  // when the words change. The Steward reading the same words again replaces only its own.
  const undo = db.query(`UPDATE chronicle SET undone_at = ? WHERE message_id = ? AND source IN (${narrator ? "'steward', 'narrator', 'offstage'" : "'steward'"}) AND undone_at IS NULL`);
  const rewind = db.query("UPDATE chats SET steward_at = MIN(steward_at, ?) WHERE id = ?");
  // A day the Offstage acted on because of these words is a day it has not acted on any more:
  // its marker goes back with them, so the day gets its turn again from whatever replaces them.
  const offstageDays = db.query("SELECT data FROM chronicle WHERE message_id = ? AND kind = 'offstage' AND undone_at IS NULL");
  const unturn = db.query("UPDATE chats SET offstage_day = MIN(offstage_day, ?) WHERE id = ? AND offstage_day >= 0");
  const chats = new Set<string>();
  db.transaction(() => {
    for (const id of messageIds) {
      const m = db.query("SELECT chat_id, created_at FROM messages WHERE id = ?").get(id) as any;
      if (!m) continue;
      if (narrator) {
        const days = (offstageDays.all(id) as any[]).map((r) => { try { return Number(JSON.parse(r.data || "{}").day); } catch { return NaN; } })
          .filter(Number.isFinite);
        if (days.length) unturn.run(Math.min(...days) - 1, m.chat_id);
      }
      undo.run(t, id);
      if (reread) rewind.run(m.created_at - 1, m.chat_id);
      chats.add(m.chat_id);
    }
  })();
  for (const id of chats) worldChanged(id);
}

/**
 * One reading: the Steward is shown these messages, and whatever survives
 * the checks goes into the chronicle.
 *
 * Its place moves on before it is asked, as the note-taker's does, so that a
 * Steward that keeps failing is not asked again on every turn forever. What
 * it recorded earlier from these same messages is taken back only once a new
 * answer has actually arrived — a failed call never costs a good record.
 */
async function stewardRun(chat: any, rows: any[], s: Record<string, string>) {
  if (!rows.length) return { kept: 0, proposed: 0, dropped: 0, problem: "" };
  db.query("UPDATE chats SET steward_at = MAX(steward_at, ?) WHERE id = ?").run(rows[rows.length - 1].created_at, chat.id);

  const me = whoAmI(chat.persona_id);
  const passages: Passage[] = rows.map((m) => ({
    id: m.id,
    who: m.role === "user" ? me?.name || "The player" : m.name || "The narrator",
    text: m.content ?? "",
  }));
  const cal = calendarOf(chat.id);
  const tracking = s.tracker_source !== "preset";
  /*
   * The world as it stood before these messages: without whatever the Steward
   * made of them last time it read them. Otherwise a second reading would find
   * its own earlier answer already "known", skip it as no change, and then
   * take the original back — and the date would count the same days twice.
   */
  const reading = new Set(rows.map((m) => m.id));
  const before = chronicleOf(chat.id).filter((e) => !(e.source === "steward" && e.message_id && reading.has(e.message_id)));
  const known = statusOf(before);
  const people = peopleOf(chat).map((p) => ({
    ...p,
    known: Object.fromEntries(Object.entries(known[p.name] ?? {}).map(([f, e]) => [f, e!.title])),
  }));
  // Factions it should not propose again: those that exist, and those already waiting on a person.
  const groups = [...factionsOf(before).map((f) => f.name),
    ...pending(before).filter((e) => e.kind === "faction").map((e) => e.title)];
  // Threads already open, by name, so it settles them rather than opening them again.
  const threads = threadsOf(before).filter((t) => t.open).map((t) => t.title);
  // Matters moving out of sight that the story may have brought into the open: named so that, if the
  // passage plainly shows one, it comes out under the same name — and is the same thread.
  const surfacing = threadsOf(before, { hidden: true }).filter((t) => t.hidden && t.open).slice(0, 8).map((t) => t.title);
  // The planned scene, if the chat follows a story and nobody has been asked about this one yet.
  const { book: taleBook, mark: taleMark } = taleOf(chat.id);
  const planned = taleBook && taleMark?.scene ? scenesOf(taleBook).find(({ scene }) => scene.id === taleMark.scene)?.scene : undefined;
  const askedAlready = planned && pending(before).some((e) => e.kind === "scene" && e.scene_id === planned.id);
  const scene = planned && !askedAlready
    ? { title: planned.title, ending: planned.ending.trim() || planned.purpose.trim() || "its purpose is fulfilled",
        ahead: scenesAhead(taleBook!, taleMark!).slice(0, 8) }
    : undefined;
  const conn = stewardConnection(s);
  const start = clockOf(cal, before);
  const req = stewardRequest(conn.model, people, formatDate(cal, start), passages, { tracking, factions: groups, threads, surfacing, scene });

  let said = "";
  let problem = "";
  try {
    for await (const chunk of generate({
      ...conn,
      ...req,
      // Low and short: it reports, it does not write. No reasoning asked for;
      // what a model thinks anyway arrives as reasoning, or is cut out of the
      // text by steward.ts.
      sampling: { temperature: 0.1, maxTokens: 700, topP: 1, minP: 0,
                  repetitionPenalty: 1, frequencyPenalty: 0, presencePenalty: 0,
                  stream: false, reasoningEffort: "off" },
    })) {
      if (chunk.kind === "text") said += chunk.text;
      if (said.length > 8000) break;
    }
  } catch (e: any) {
    problem = e?.message || "The Steward could not be reached.";
  }

  const askDays = Number(s.steward_ask_days);
  const limits = {
    askAboveMinutes: s.steward_ask_days !== "" && Number.isFinite(askDays) && askDays >= 0 ? askDays * minutesPerDay(cal) : -1,
    maxEvents: 5,
    maxStatus: 12,
    maxBonds: 6,
    maxFactions: 3,
    maxThreads: 3,
  };
  const checked = problem
    ? { claims: [] as Claim[], dropped: [], none: false, noise: 0 }
    : checkAnswer(said, passages, people, cal, start, limits, { tracking, factions: groups, threads, surfacing, scene });
  if (!problem && !checked.claims.length && !checked.none) problem = "Nothing in the answer could be used.";

  if (!problem) {
    // Read again, so whatever it made of these messages before is replaced.
    forgetSteward(rows.map((m) => m.id), false, false);
    const order = new Map(passages.map((p, i) => [p.id, i]));
    // Time a message already moved the clock by — its opening line, the
    // narrator's mark, a person — is not counted a second time.
    const timed = new Set(liveEntries(chronicleOf(chat.id))
      .filter((e) => e.kind === "time" && e.source !== "steward" && e.message_id).map((e) => e.message_id));
    // In story order, and within one message: time first, then what happened, then how everyone is after it.
    const rank = { time: 0, event: 1, status: 2, bond: 3, faction: 4, thread: 5, scene: 6 } as const;
    const set = await charges();
    const story = [...checked.claims].filter((c) => !(c.kind === "time" && timed.has(c.message_id))).sort((a, b) =>
      order.get(a.message_id)! - order.get(b.message_id)! || rank[a.kind] - rank[b.kind]);
    let at = start;
    let t = now();
    const entries: ChronicleEntry[] = [];
    for (const claim of story) {
      if (claim.kind === "time") {
        entries.push(normaliseChronicleEntry({
          id: uid(), kind: "time", message_id: claim.message_id, span: claim.span, title: claim.said,
          evidence: claim.evidence, source: "steward", created_at: t++, proposed: claim.proposed,
        }));
        if (!claim.proposed) at = later(cal, at, claim.span);
      } else if (claim.kind === "event") {
        entries.push(normaliseChronicleEntry({
          id: uid(), kind: "event", message_id: claim.message_id, day: at.day, minute: at.minute, title: claim.title,
          body: claim.people.length ? `With ${claim.people.join(", ")}.` : "",
          evidence: claim.evidence, source: "steward", created_at: t++,
        }));
      } else if (claim.kind === "bond") {
        entries.push(normaliseChronicleEntry({
          id: uid(), kind: "bond", message_id: claim.message_id, day: at.day, minute: at.minute,
          subject: claim.from, object: claim.to, amount: claim.amount, title: claim.label,
          evidence: claim.evidence, source: "steward", created_at: t++,
        }));
      } else if (claim.kind === "faction") {
        // Proposed, never made: a person says yes. Its arms are derived from its
        // name, with the emblem the story gave it if that is one Hearth has.
        const arms = armsFromName(claim.name, set.ids);
        const emblem = chargeFor(claim.symbol, set.ids);
        if (emblem && arms.charge) arms.charge = { ...arms.charge, type: emblem };
        entries.push(normaliseChronicleEntry({
          id: uid(), kind: "faction", message_id: claim.message_id, day: at.day, minute: at.minute,
          subject: uid(), title: claim.name, body: claim.description, data: { arms: withContrast(arms), members: [] },
          evidence: claim.evidence, source: "steward", created_at: t++, proposed: true,
        }));
      } else if (claim.kind === "scene") {
        // Proposed, never done here: moving on is the person's, with one tap.
        entries.push(sceneProposal(taleBook!, taleMark!, claim.to, claim.message_id, claim.evidence, at, t++));
      } else if (claim.kind === "thread") {
        entries.push(normaliseChronicleEntry({
          id: uid(), kind: "thread", message_id: claim.message_id, day: at.day, minute: at.minute,
          subject: groupKey(claim.name), title: claim.name, amount: claim.open ? 1 : -1,
          evidence: claim.evidence, source: "steward", created_at: t++,
          data: { people: namedIn(`${claim.name} ${claim.evidence}`, people.map((p) => p.name)) },
        }));
      } else {
        entries.push(normaliseChronicleEntry({
          id: uid(), kind: "status", message_id: claim.message_id, day: at.day, minute: at.minute,
          subject: claim.subject, field: claim.field, title: claim.value,
          evidence: claim.evidence, source: "steward", created_at: t++,
        }));
      }
    }
    copyChronicle(entries, chat.id);
  }

  const proposed = checked.claims.filter((c) => (c.kind === "time" && c.proposed) || c.kind === "faction" || c.kind === "scene").length;
  db.query(
    `INSERT INTO steward_runs (id, chat_id, model, kept, proposed, dropped, problem, answer, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(uid(), chat.id, conn.model, checked.claims.length - proposed, proposed,
        JSON.stringify(checked.dropped.slice(0, 40)), problem.slice(0, 500), said.slice(0, 4000), now());
  if (problem) console.error(`[steward] ${chat.id}: ${problem} (${said.length} chars)`);
  return { kept: checked.claims.length - proposed, proposed, dropped: checked.dropped.length, problem };
}

/** After a reply: read the new messages if enough of them have arrived. */
export async function stewardTurn(chatId: string) {
  const s = getSettings();
  if (s.steward_on !== "1" || s.story_world === "0") return;
  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(chatId) as any;
  if (!chat) return;
  const fresh = db.query(
    "SELECT id, role, name, content, created_at FROM messages WHERE chat_id = ? AND created_at > ? ORDER BY created_at, rowid",
  ).all(chatId, chat.steward_at ?? 0) as any[];
  if (!isDue(fresh.length, Number(s.steward_every) || 0)) return;
  // A long silence is read in its latest stretch, not handed over whole.
  await stewardRun(chat, fresh.slice(-40), s);
}

/** What the Steward has done in a chat lately, for whoever wants to know why Story World says what it says. */
api.get("/chats/:id/steward", (c) => {
  const rows = db.query("SELECT * FROM steward_runs WHERE chat_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(c.req.param("id")) as any[];
  return c.json(rows.map((r) => ({ ...r, dropped: JSON.parse(r.dropped || "[]") })));
});

/**
 * Building Story World from a chat's whole history, when asked — never on its
 * own, since on a long chat it is many calls. Read from the start in stretches,
 * in order, so the clock builds as the story did. Replaces what the Steward
 * recorded before, stretch by stretch; leaves alone everything a person wrote.
 */
api.post("/chats/:id/steward/history", async (c) => {
  const chatId = c.req.param("id");
  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(chatId) as any;
  if (!chat) return c.json({ error: "No such chat." }, 404);
  const s = getSettings();
  const all = db.query("SELECT id, role, name, content, created_at FROM messages WHERE chat_id = ? ORDER BY created_at, rowid")
    .all(chatId) as any[];
  const STRETCH = 20;
  const MAX_STRETCHES = 100;
  // Nothing is cleared first: each stretch replaces what the Steward made of
  // those same messages only once it has a new answer for them, so a rebuild
  // that fails halfway leaves the old record standing where it failed.
  db.query("UPDATE chats SET steward_at = 0 WHERE id = ?").run(chatId);
  const total = { runs: 0, kept: 0, proposed: 0, failed: 0 };
  for (let i = 0; i < all.length && total.runs < MAX_STRETCHES; i += STRETCH) {
    const r = await stewardRun(chat, all.slice(i, i + STRETCH), s);
    total.runs++;
    total.kept += r.kept;
    total.proposed += r.proposed;
    if (r.problem) total.failed++;
  }
  return c.json({ ...total, unread: Math.max(0, all.length - total.runs * STRETCH), ...chronicleState(chatId) });
});

/**
 * Whether this chat's notes book is also another chat's — a branch made before
 * branches got a copy of their own, and still writing into its parent's.
 */
api.get("/chats/:id/own-notes", (c) => {
  const chatId = c.req.param("id");
  const book = notesBookOf(chatId);
  if (!book) return c.json({ book: null, shared: false });
  const other = db.query(
    `SELECT 1 FROM chats WHERE id != ? AND auto_lore_book_id = ?
     UNION SELECT 1 FROM lorebook_links WHERE book_id = ? AND scope = 'chat' AND ifnull(target_id,'') != ?`,
  ).get(chatId, book, book, chatId);
  return c.json({ book, shared: !!other });
});

/** Splitting a branch that already shares its parent's notes book, when asked. */
api.post("/chats/:id/own-notes", (c) => {
  const chatId = c.req.param("id");
  if (!db.query("SELECT 1 FROM chats WHERE id = ?").get(chatId)) return c.json({ error: "No such chat." }, 404);
  const book = ownNotesBook(chatId);
  if (!book) return c.json({ error: "This chat does not keep notes." }, 400);
  return c.json({ book });
});

/**
 * Following a book, choosing a scene, or putting the book down.
 *
 * `{ book }` opens one at its first scene — or carries on from wherever this
 * chat already was in it. `{ book, scene }` moves the bookmark by hand. An
 * empty `book` stops following anything.
 */
api.put("/chats/:id/apocrypha", async (c) => {
  const chatId = c.req.param("id");
  if (!db.query("SELECT id FROM chats WHERE id = ?").get(chatId)) return c.json({ error: "Chat not found." }, 404);
  const b = await c.req.json().catch(() => ({}));
  const wanted = String(b.book ?? "");
  if (!wanted) { setTale(chatId, null); return c.json({ book: null, mark: null }); }
  const book = apocryphon(wanted);
  if (!book) return c.json({ error: "That book is not on the shelf any more." }, 404);
  const current = taleOf(chatId).mark;
  const fresh = current?.book !== book.id;
  let mark = fresh ? startBookmark(book) : current!;
  if (b.scene) {
    // Chosen by a person. Later than where the story was: everything before
    // it happened. Earlier: that scene is reopened and played again.
    const ids = scenesOf(book).map(({ scene }) => scene.id);
    const to = String(b.scene);
    mark = ids.indexOf(to) > ids.indexOf(mark.scene) && mark.scene ? catchUpTo(book, mark, to)
      : !mark.scene && ids.includes(to) ? catchUpTo(book, mark, to)
      : jumpTo(book, mark, to);
    // Whatever the plan was asking about its scenes is answered.
    db.query("UPDATE chronicle SET undone_at = ? WHERE chat_id = ? AND kind = 'scene' AND proposed = 1 AND undone_at IS NULL").run(now(), chatId);
  }
  setTale(chatId, mark);
  // A chat already under way that starts following a book is probably not at
  // its first scene: find out where it is, and ask. Not awaited; a failure is
  // simply no question.
  const said = (db.query("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?").get(chatId) as any)?.n ?? 0;
  if (fresh && !b.scene && said >= 4) locateTale(chatId).catch(() => {});
  return c.json({ book, mark });
});

/** The scene is over, one way or the other; on to the next. */
api.post("/chats/:id/apocrypha/advance", async (c) => {
  const chatId = c.req.param("id");
  if (!taleOf(chatId).book) return c.json({ error: "This chat is not following a story." }, 400);
  const b = await c.req.json().catch(() => ({}));
  return c.json(advanceTale(chatId, b.how === "skipped" ? "skipped" : "done"));
});

/** A scene the person has not reached yet, in a story they are playing blind: not to be named to them. */
function blindAhead(chatId: string, sceneId: string | null) {
  if (getSettings().apocrypha_blind !== "1" || !sceneId) return false;
  const { book, mark } = taleOf(chatId);
  if (!book || !mark) return false;
  return mark.scene !== sceneId && !mark.done.includes(sceneId) && !mark.skipped.includes(sceneId);
}

/** The scenes still to come after the current one, in order: neither played nor passed over. */
function scenesAhead(book: Apocryphon, mark: Bookmark) {
  const all = scenesOf(book);
  const at = all.findIndex(({ scene }) => scene.id === mark.scene);
  const closed = new Set([...mark.done, ...mark.skipped]);
  return all.slice(at + 1).filter(({ scene }) => !closed.has(scene.id))
    .map(({ scene }) => ({ id: scene.id, title: scene.title, setting: scene.setting.slice(0, 80) }));
}

/**
 * A question for the person about the plan, never an answer: "this scene is
 * over, move on?" or, with `to`, "the story is already at that scene, jump
 * there?". What the popup by the writing line shows is kept on it.
 */
function sceneProposal(book: Apocryphon, mark: Bookmark, to: string | undefined, messageId: string | null,
                       evidence: string, at: { day: number; minute: number }, createdAt: number): ChronicleEntry {
  const all = scenesOf(book);
  const here = all.find(({ scene }) => scene.id === mark.scene)?.scene;
  const target = to ? all.find(({ scene }) => scene.id === to)?.scene : undefined;
  const next = scenesAhead(book, mark)[0];
  return normaliseChronicleEntry({
    id: uid(), kind: "scene", message_id: messageId, day: at.day, minute: at.minute,
    scene_id: mark.scene, title: here?.title || "This scene",
    data: { to: target?.id ?? "", toTitle: target?.title ?? "", next: next?.title ?? "" },
    evidence, source: "steward", created_at: createdAt, proposed: true,
  });
}

/**
 * Where the story is in its plan, read from the latest messages: for a chat
 * that started following a book partway through, or that has run ahead of
 * it. Every scene of the book is offered, numbered; the answer is checked
 * like any of the Steward's, and is a question for the person, not a move.
 */
async function locateTale(chatId: string): Promise<{ asked: boolean; here?: boolean; problem?: string }> {
  const { book, mark } = taleOf(chatId);
  if (!book || !mark) return { asked: false, problem: "This chat is not following a story." };
  const rows = (db.query("SELECT id, role, name, content FROM messages WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 12")
    .all(chatId) as any[]).reverse();
  if (!rows.length) return { asked: false };
  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(chatId) as any;
  const me = whoAmI(chat.persona_id);
  const passages: Passage[] = rows.map((m) => ({ id: m.id, who: m.role === "user" ? me?.name || "The player" : m.name || "The narrator", text: m.content }));
  const scenes = scenesOf(book).map(({ scene }) => ({ id: scene.id, title: scene.title, setting: scene.setting.slice(0, 80) }));
  const s = getSettings();
  const conn = stewardConnection(s);
  const system = "You find where a story is in its plan. You read the latest part of the story and a numbered list of planned scenes, and say which scene is happening now. You never continue the story and never explain yourself.";
  const prompt = `Planned scenes:\n${scenes.map((x, i) => `${i + 1}. ${x.title || "untitled"}${x.setting ? ` (${x.setting})` : ""}`).join("\n")}` +
    `\n\nThe story, latest part:\n\n${passages.map((p) => `${p.who}: ${storyOnly(p.text)}`).join("\n\n")}` +
    `\n\nWrite one line, exactly like this:\nSCENE | the number of the scene happening now | "four to twenty-five words copied exactly from the story that show it"\nIf none of them fits, write only: NONE`;
  const fold = needsFoldedSystem(conn.model);
  let said = "";
  try {
    for await (const chunk of generate({
      ...conn, system: fold ? "" : system,
      messages: [{ role: "user", content: fold ? `${system}\n\n---\n\n${prompt}` : prompt }],
      sampling: { temperature: 0.1, maxTokens: 300, topP: 1, minP: 0, repetitionPenalty: 1, frequencyPenalty: 0, presencePenalty: 0, stream: false, reasoningEffort: "off" },
    })) {
      if (chunk.kind === "text") said += chunk.text;
      if (said.length > 4000) break;
    }
  } catch (e: any) {
    return { asked: false, problem: e?.message || "The model could not be reached." };
  }
  const cal = calendarOf(chatId);
  const entries = chronicleOf(chatId);
  const at = clockOf(cal, entries);
  const checked = checkAnswer(said, passages, [], cal, at, { ...DEFAULT_LIMITS }, { tracking: false, scene: { title: "", ending: "", ahead: scenes } });
  const found = checked.claims.find((c) => c.kind === "scene" && c.to) as { to: string; evidence: string; message_id: string } | undefined;
  if (!found) return { asked: false };
  if (found.to === mark.scene) return { asked: false, here: true };
  db.query("UPDATE chronicle SET undone_at = ? WHERE chat_id = ? AND kind = 'scene' AND proposed = 1 AND undone_at IS NULL").run(now(), chatId);
  copyChronicle([sceneProposal(book, mark, found.to, found.message_id, found.evidence, at, now())], chatId);
  return { asked: true };
}

api.post("/chats/:id/apocrypha/locate", async (c) => {
  const r = await locateTale(c.req.param("id"));
  if (r.problem) return c.json({ error: r.problem }, 400);
  return c.json({ ...r, ...chronicleState(c.req.param("id")) });
});

/** The scene is over, one way or the other: on to the next, and a scene played goes in the chronicle. */
function advanceTale(chatId: string, how: "done" | "skipped") {
  const { book, mark } = taleOf(chatId);
  if (!book || !mark) return { book: null, mark: null };
  // Any open question about this scene is answered by moving on, either way.
  db.query("UPDATE chronicle SET undone_at = ? WHERE chat_id = ? AND kind = 'scene' AND proposed = 1 AND undone_at IS NULL")
    .run(now(), chatId);
  const moved = advance(book, mark, how);
  setTale(chatId, moved);
  // A scene played is something that happened, so the chronicle says so. A
  // scene passed over did not happen, and is left out of it.
  const played = how === "done" && scenesOf(book).find(({ scene }) => scene.id === mark.scene);
  if (played) {
    recordEvent(chatId, {
      title: played.scene.title || "A scene of the story",
      body: played.chapter.title ? `From "${played.chapter.title}".` : "",
      source: "scene",
      scene_id: played.scene.id,
    });
  }
  return { book, mark: moved };
}

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
api.get("/lorebooks/elsewhere", (c) => {
  const rows = db.query(
    `SELECT id, name, entries FROM lorebooks
     WHERE deleted_at IS NULL AND NOT ${worldWhere("lorebooks")}
     ORDER BY name COLLATE NOCASE`,
  ).all() as any[];
  /*
   * How much is in each, which the picker that starts a campaign from a book
   * needs in order not to offer an empty one. Counted rather than sent whole:
   * this is a list for choosing from, and a shelf of long books would be a
   * megabyte of entries nobody is going to read here.
   */
  return c.json(rows.map((b) => ({
    id: b.id,
    name: b.name,
    entry_count: readEntries(b).length,
  })));
});

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
 * The book this chat's notes go into, found again if it has gone.
 *
 * A chat remembers its book by id, and an id does not survive the obvious way
 * of fixing a book: export it, correct it, import it, delete the old one. The
 * import is a new book with a new id and the same name, the old one is gone,
 * and the chat used to respond by quietly forgetting it had a book at all —
 * no more notes, no word about it, and never asked again. Or, carrying on,
 * by making yet another "— notes" book beside the one you had just fixed.
 *
 * So a missing book is looked for by name first: a live book called what the
 * old one was called is, in every case anyone has hit, the same book come
 * back. It is adopted and attached to the chat. Only if there is none does
 * the chat let go — and then it asks again next time it is opened, rather
 * than keeping notes nowhere in silence.
 */
function notesBookOf(chatId: string): string | null {
  const chat = db.query("SELECT auto_lore_book_id FROM chats WHERE id = ?").get(chatId) as any;
  const id = chat?.auto_lore_book_id;
  if (!id) return null;
  if (db.query("SELECT id FROM lorebooks WHERE id = ? AND deleted_at IS NULL").get(id)) return id;

  const gone = db.query("SELECT name FROM lorebooks WHERE id = ?").get(id) as any;
  const heir = gone?.name
    ? (db.query(
        "SELECT id FROM lorebooks WHERE name = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
      ).get(gone.name) as any)
    : null;
  if (heir) {
    db.query("UPDATE chats SET auto_lore_book_id = ? WHERE id = ?").run(heir.id, chatId);
    attachToChat(heir.id, chatId);
    return heir.id;
  }
  db.query("UPDATE chats SET auto_lore_book_id = NULL, auto_lore_asked = 0 WHERE id = ?").run(chatId);
  return null;
}

/**
 * Gives a chat a notes book of its own: a copy of the one it writes into now,
 * named "— BRANCH", which it writes into from then on. The book it shared is
 * left exactly as it was for whoever else is using it. Returns the copy's id,
 * or null for a chat that keeps no notes.
 */
function ownNotesBook(chatId: string): string | null {
  const bookId = notesBookOf(chatId);
  if (!bookId) return null;
  const book = db.query("SELECT * FROM lorebooks WHERE id = ?").get(bookId) as any;
  // A branch of a branch is still "— BRANCH", not "— BRANCH — BRANCH";
  // freeBookName tells the copies apart.
  const base = String(book.name ?? "Notes").replace(/\s+— BRANCH\b.*$/, "");
  const copy = uid();
  db.transaction(() => {
    db.query("INSERT INTO lorebooks (id, name, entries, created_at, world) VALUES (?,?,?,?,?)")
      .run(copy, freeBookName(`${base} — BRANCH`), book.entries ?? "[]", now(), book.world ?? "story");
    db.query("DELETE FROM lorebook_links WHERE book_id = ? AND scope = 'chat' AND ifnull(target_id,'') = ?")
      .run(bookId, chatId);
    attachToChat(copy, chatId);
    db.query("UPDATE chats SET auto_lore_book_id = ? WHERE id = ?").run(copy, chatId);
  })();
  return copy;
}

/** Links a book to one chat, once. */
function attachToChat(bookId: string, chatId: string) {
  db.query("DELETE FROM lorebook_links WHERE book_id = ? AND scope = 'chat' AND ifnull(target_id,'') = ?")
    .run(bookId, chatId);
  db.query("INSERT INTO lorebook_links (id, book_id, scope, target_id) VALUES (?,?,?,?)")
    .run(uid(), bookId, "chat", chatId);
}

/**
 * Writes a note for this chat if enough has happened since the last one.
 *
 * Deliberately quiet: every failure path leaves the chat exactly as it was and
 * says nothing. A note is a nicety, and nothing about a roleplay should break
 * because the note-taker had a bad day.
 */
async function takeNote(chatId: string) {
  const bookId = notesBookOf(chatId);
  if (!bookId) return;
  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(chatId) as any;
  const book = db.query("SELECT * FROM lorebooks WHERE id = ?").get(bookId) as any;

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
    ...connectionFrom(s),
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

  // A book nothing reads is a book nothing reads: attach it to this chat so
  // the notes it collects actually come back into the story.
  if (bookId) attachToChat(bookId, chatId);

  /*
   * Start the clock now, so the first note covers what happens next rather
   * than everything that came before the question was answered — but only
   * the first time. Moving the notes to a different book later is a change
   * of where they go, not a fresh start: resetting here would quietly skip
   * everything that happened since the last note.
   */
  const before = db.query("SELECT auto_lore_book_id, auto_lore_at FROM chats WHERE id = ?").get(chatId) as any;
  const last = db
    .query("SELECT created_at FROM messages WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(chatId) as any;
  const clock = before?.auto_lore_book_id && before?.auto_lore_at ? before.auto_lore_at : last?.created_at ?? 0;
  db.query("UPDATE chats SET auto_lore_book_id = ?, auto_lore_asked = 1, auto_lore_at = ? WHERE id = ?")
    .run(bookId, clock, chatId);

  return c.json({ ok: true, book_id: bookId });
});

/** Where this chat's notes go — found again by name if the book was replaced. */
api.get("/chats/:id/autolore", (c) => {
  const id = notesBookOf(c.req.param("id"));
  const book = id ? (db.query("SELECT id, name FROM lorebooks WHERE id = ?").get(id) as any) : null;
  return c.json({ book });
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

/** A script as the API hands it out: where it lives, and whether it is running now. */
type LiveScript = RegexScript & { presetId: string | null; presetName: string; active: boolean; position: number };

/**
 * The preset whose scripts are live. None while the table's built-in preset is
 * on, since that preset has no scripts and a story preset's scripts are aimed
 * at a story's output.
 */
function activePresetId(): string | null {
  if (tablePresetOn(getSettings())) return null;
  const p = db.query("SELECT id FROM presets WHERE is_active = 1 AND deleted_at IS NULL LIMIT 1").get() as
    | { id: string } | undefined;
  return p?.id ?? null;
}

/**
 * Every live script, in list order. Read on each assembly rather than cached:
 * a script you have just switched off should stop applying to the next reply,
 * not to the one after a restart.
 *
 * `active` is whether it runs at all right now: shared scripts always do, and
 * a preset's own only while that preset is the one in use. Switching presets
 * therefore brings each one's scripts with it without anything being copied
 * or toggled — a script's own on/off switch is left exactly as the person set
 * it.
 */
function liveScripts(): LiveScript[] {
  const rows = db
    .query(`SELECT r.*, p.name AS preset_name, p.deleted_at AS preset_gone FROM regex_scripts r
            LEFT JOIN presets p ON p.id = r.preset_id
            WHERE r.deleted_at IS NULL ORDER BY r.position, r.created_at`)
    .all() as any[];
  const current = activePresetId();
  return rows.flatMap((r) => {
    try {
      return [{
        ...normaliseScript(JSON.parse(r.script), r.source),
        id: r.id,
        enabled: !!r.enabled,
        presetId: r.preset_id ?? null,
        presetName: r.preset_id ? String(r.preset_name ?? "") : "",
        active: !r.preset_id || (r.preset_id === current && !r.preset_gone),
        position: r.position,
      }];
    } catch {
      return [];
    }
  });
}

const nextScriptPosition = () =>
  ((db.query("SELECT MAX(position) AS n FROM regex_scripts WHERE deleted_at IS NULL").get() as any)?.n ?? -1) + 1;

/**
 * Stores one, keeping SillyTavern's own id so a re-import updates in place.
 *
 * With a preset, the script is bound to it — unless the same script is
 * already here and shared, in which case it stays shared: binding it as well
 * would leave it running twice whenever that preset is on. If it is already
 * bound to some other preset that is still around, the newcomer is a copy of
 * its own rather than a theft from the first.
 */
function saveScript(raw: any, source: string, position: number, presetId: string | null = null) {
  let script = normaliseScript(raw, source);
  const existing = db.query(
    `SELECT r.id, r.preset_id, r.deleted_at, p.deleted_at AS preset_gone FROM regex_scripts r
     LEFT JOIN presets p ON p.id = r.preset_id WHERE r.id = ?`,
  ).get(script.id) as any;
  const elsewhere = existing && !existing.deleted_at && existing.preset_id && existing.preset_id !== presetId &&
    !existing.preset_gone;
  if (existing && !elsewhere) {
    const keepShared = !existing.deleted_at && !existing.preset_id;
    db.query("UPDATE regex_scripts SET name = ?, script = ?, source = ?, preset_id = ?, deleted_at = NULL WHERE id = ?")
      .run(script.name, JSON.stringify(script), source, keepShared ? null : presetId, script.id);
    return script;
  }
  if (elsewhere) script = { ...script, id: crypto.randomUUID() };
  db.query(
    "INSERT INTO regex_scripts (id, name, script, enabled, source, position, created_at, preset_id) VALUES (?,?,?,?,?,?,?,?)",
  ).run(script.id, script.name, JSON.stringify(script), script.enabled ? 1 : 0, source, position, now(), presetId);
  return script;
}

/**
 * Pulls any regex scripts a preset carries. DEUS EX MACHINA and its kind ship
 * sixty of them inside `extensions.regex_scripts`, and half the preset does
 * not work without them — importing the preset and silently dropping them is
 * how you get a preset that "does nothing". They come in bound to the preset
 * they arrived with.
 */
function importScriptsFrom(json: any, source: string, presetId: string | null = null): number {
  const list = json?.extensions?.regex_scripts ?? json?.regex_scripts;
  if (!Array.isArray(list) || !list.length) return 0;
  const base = nextScriptPosition();
  list.forEach((r: any, i: number) => saveScript(r, source, base + i, presetId));
  return list.length;
}

/** A preset's own scripts, in SillyTavern's shape, for its export. */
function presetScripts(presetId: string): Record<string, unknown>[] {
  return liveScripts().filter((r) => r.presetId === presetId).map(scriptToSillyTavern);
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
/*
 * The classes on offer, which are now rows rather than a constant — the
 * shipped six seeded alongside anything written since, so there is one list
 * rather than "ours" and "yours".
 */
api.get("/tabletop/classes", (c) => c.json(kitsOf("class")));
api.get("/tabletop/races", (c) => c.json(kitsOf("race")));

/*
 * And tabletop.ts is told where classes live now, so that rolling a Warden
 * makes a Warden and — the quieter half — reading one back does not turn it
 * into a Fighter.
 */
provideClasses((id) => {
  const k = kitById(id);
  return k && k.kind === "class" ? (k as any) : null;
});
provideRaces((id) => raceForPrompt(id ? kitById(id) : null));
// ---- classes and races ----------------------------------------------------

/**
 * Six classes in the code was fine for a first evening and wrong for a
 * campaign: everybody's table has a thing in it nobody else's has. These are
 * rows now, the shipped ones seeded alongside anything you write, so the game
 * offers you one list rather than "ours" and "yours".
 */
const RACES_ON_FIRST_RUN = [
  { id: "human", name: "Human", blurb: "Adaptable, everywhere, and rarely the strangest thing in the room.",
    bonus: { con: 1, cha: 1 },
    traits: ["They are found in most places and belong to none of them particularly."] },
  { id: "dwarf", name: "Dwarf", blurb: "Built low and patient, and hard to move once decided.",
    bonus: { con: 2, str: 1, dex: -1 },
    traits: ["They see in the dark as well as most people see at dusk.",
             "Stone and metalwork tell them things other people have to be told."] },
  { id: "elf", name: "Elf", blurb: "Long-lived enough to be unhurried about nearly everything.",
    bonus: { dex: 2, int: 1, con: -1 },
    traits: ["They do not sleep so much as stop paying attention for a few hours.",
             "They remember conversations that everyone else has forgotten happened."] },
  { id: "halfling", name: "Halfling", blurb: "Small, lucky, and consistently underestimated.",
    bonus: { dex: 2, cha: 1, str: -1 },
    traits: ["They are easy to overlook, and have made a habit of it.",
             "Their luck is not magic, but it is remarked upon."] },
  { id: "tiefling", name: "Tiefling", blurb: "Somebody's old bargain, still being paid off in the face.",
    bonus: { cha: 2, int: 1, wis: -1 },
    traits: ["Fire does not trouble them, and they are quietly used to that being noticed.",
             "Strangers decide something about them before they have spoken.",
             "The bargain was not theirs. Everyone assumes it was."] },
];

function seedKits() {
  /*
   * One at a time, and only ones this database has never heard of.
   *
   * All-or-nothing on an empty table meant a built-in added later never
   * reached anybody who had already run the app once — which is how the chain
   * ended up with a horned pip and no Tiefling behind it. Checked against
   * every row *including* the soft-deleted ones, so a built-in you have
   * thrown away stays thrown away rather than coming back each restart.
   */
  const known = db.query("SELECT id FROM kits WHERE id = ?");
  const ins = db.query(
    "INSERT INTO kits (id, kind, name, data, builtin, position, created_at) VALUES (?,?,?,?,1,?,?)",
  );
  const place = db.query("SELECT ifnull(MAX(position), -1) p FROM kits WHERE kind = ?");

  for (const [kind, source] of [["class", CLASSES], ["race", RACES_ON_FIRST_RUN]] as const) {
    for (const raw of source) {
      const kit = normaliseKit({ ...raw, kind, builtin: true });
      if (known.get(kit.id)) continue;
      const at = ((place.get(kind) as any).p ?? -1) + 1;
      ins.run(kit.id, kind, kit.name, JSON.stringify(kit), at, now());
    }
  }
}

/** Everything of one kind, in order, built-ins and yours together. */
function kitsOf(kind: "class" | "race"): Kit[] {
  seedKits();
  return (db.query(
    "SELECT data FROM kits WHERE kind = ? AND deleted_at IS NULL ORDER BY position, created_at",
  ).all(kind) as any[]).map((r) => {
    try { return normaliseKit(JSON.parse(r.data)); } catch { return null; }
  }).filter(Boolean) as Kit[];
}

function kitById(id: string): Kit | null {
  seedKits();
  const row = db.query("SELECT data FROM kits WHERE id = ? AND deleted_at IS NULL").get(id) as any;
  if (!row) return null;
  try { return normaliseKit(JSON.parse(row.data)); } catch { return null; }
}

api.get("/kits", (c) => {
  const kind = c.req.query("kind") === "race" ? "race" : "class";
  return c.json(kitsOf(kind));
});

api.post("/kits", async (c) => {
  const kit = normaliseKit(await c.req.json().catch(() => ({})));
  if (!kitWritten(kit)) {
    return c.json({ error: "Give it a name and at least one thing that makes it itself." }, 400);
  }
  /*
   * A name that is already taken gets a suffix rather than an error.
   *
   * Somebody importing a pack of six classes over a pack of five should end up
   * with eleven and a duplicate to tidy, not a failed import halfway through
   * and no way to tell which ones landed.
   */
  let id = kit.id;
  for (let n = 2; db.query("SELECT id FROM kits WHERE id = ?").get(id); n++) id = `${kit.id}-${n}`;

  const at = (db.query("SELECT ifnull(MAX(position), -1) p FROM kits WHERE kind = ?")
    .get(kit.kind) as any).p + 1;
  const saved = { ...kit, id, builtin: false };
  db.query("INSERT INTO kits (id, kind, name, data, builtin, position, created_at) VALUES (?,?,?,?,0,?,?)")
    .run(id, saved.kind, saved.name, JSON.stringify(saved), at, now());
  return c.json(saved);
});

api.put("/kits/:id", async (c) => {
  const before = kitById(c.req.param("id"));
  if (!before) return c.json({ error: "No such class or race." }, 404);
  const kit = normaliseKit({ ...before, ...(await c.req.json().catch(() => ({}))), id: before.id });
  if (!kitWritten(kit)) return c.json({ error: "There is nothing left in it." }, 400);
  // Editing a built-in makes it yours. It stays edited, and stops being
  // something the app claims to have provided.
  const saved = { ...kit, builtin: false };
  db.query("UPDATE kits SET name = ?, data = ?, builtin = 0 WHERE id = ?")
    .run(saved.name, JSON.stringify(saved), saved.id);
  return c.json(saved);
});

api.delete("/kits/:id", (c) => {
  const kit = kitById(c.req.param("id"));
  if (!kit) return c.json({ error: "No such class or race." }, 404);
  db.query("UPDATE kits SET deleted_at = ? WHERE id = ?").run(now(), kit.id);
  return c.json({ ok: true });
});

/**
 * Importing a file somebody else made.
 *
 * Takes one, or an array, or the shape this exports — so a pack and a single
 * class are the same button. Each is normalised on the way in, and one bad
 * entry is skipped rather than failing the lot: an import that refuses six
 * good classes because the seventh has a typo is an import nobody uses twice.
 */
api.post("/kits/import", async (c) => {
  const body = await c.req.json().catch(() => null);
  const raw = Array.isArray(body) ? body
    : Array.isArray(body?.kits) ? body.kits
    : body ? [body] : [];
  if (!raw.length) return c.json({ error: "There was nothing in that file." }, 400);

  const added: Kit[] = [];
  const skipped: string[] = [];
  for (const one of raw.slice(0, 200)) {
    const kit = normaliseKit(one);
    if (!kitWritten(kit)) { skipped.push(kit.name); continue; }
    let id = kit.id;
    for (let n = 2; db.query("SELECT id FROM kits WHERE id = ?").get(id); n++) id = `${kit.id}-${n}`;
    const at = (db.query("SELECT ifnull(MAX(position), -1) p FROM kits WHERE kind = ?")
      .get(kit.kind) as any).p + 1;
    const saved = { ...kit, id, builtin: false };
    db.query("INSERT INTO kits (id, kind, name, data, builtin, position, created_at) VALUES (?,?,?,?,0,?,?)")
      .run(id, saved.kind, saved.name, JSON.stringify(saved), at, now());
    added.push(saved);
  }
  return c.json({ added: added.length, skipped, kits: added });
});

/** Everything, as a file to hand somebody. */
api.get("/kits/export", (c) =>
  c.json({ hearth: "kits", version: 1, kits: [...kitsOf("class"), ...kitsOf("race")] }));

api.get("/tabletop/difficulties", (c) =>
  c.json(LEVELS.map(({ id, name, blurb, dc }) => ({ id, name, blurb, dc }))));

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
      ...connectionFrom(s),
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

/**
 * A campaign out of a memory book.
 *
 * You have already written the world down. Starting a game in it should not
 * mean typing it all out again in a box, so the book becomes the idea and the
 * same ghostwriter turns it into a brief — and the book comes with it, bound
 * to the campaign, because a game set in a world you wrote should have that
 * world in its context without you going and ticking it.
 */
api.post("/campaigns/from-book", async (c) => {
  const { book_id, length } = await c.req.json().catch(() => ({}));
  const book = db.query("SELECT * FROM lorebooks WHERE id = ? AND deleted_at IS NULL")
    .get(String(book_id ?? "")) as any;
  if (!book) return c.json({ error: "No such lorebook." }, 404);

  let entries: any[] = [];
  try { entries = JSON.parse(book.entries ?? "[]"); } catch { entries = []; }
  if (!bookIsUsable(entries)) {
    return c.json({ error: "That book has nothing written in it yet." }, 400);
  }

  const idea = seedFromBook(book.name, entries);
  const s = getSettings();
  let text = "";
  try {
    for await (const chunk of generate({
      ...connectionFrom(s),
      model: s.model,
      system: WRITE_SYSTEM,
      messages: [{ role: "user", content: writePrompt(idea, length) }],
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
    return c.json({ error: "The model did not write a campaign from that book." }, 502);
  }
  // Bound, not merely mentioned: the point of starting here is that the world
  // is already written and should be in the prompt without being asked for.
  const campaign = normaliseCampaign({ ...written, books: [book.id] });
  return c.json({ campaign });
});

/**
 * The room follows the story, if you have asked it to.
 *
 * When the narrator moves the scene it has just described what the place
 * sounds and looks like, and nothing was reading that: a game walking from a
 * tavern into a storm sounded identical in both. This reads it.
 *
 * Off unless switched on, and picking only from wallpapers already in your own
 * folder — it does not fetch one, generate one, or invent one. That limit is
 * deliberate and not negotiable: nobody's wallpapers get messed with, and a
 * room that silently redecorates is worse than one that does not, because you
 * cannot tell whether you did it.
 *
 * A weak match changes nothing. See scenery.ts.
 */
function readdirSyncSafe(dir: string): string[] {
  try { return require("node:fs").readdirSync(dir) as string[]; } catch { return []; }
}

function dressTheScene(chatId: string, where: string) {
  const s = getSettings();
  if (s.scene_follows !== "1") return;

  const sound = soundFor(where);
  if (sound) db.query("UPDATE chats SET ambience = ? WHERE id = ?").run(sound, chatId);

  let files: string[] = [];
  try {
    // Only real pictures, and only the ones already here.
    files = readdirSyncSafe(WALLS).filter((f) => /\.(png|jpe?g|webp|gif|avif)$/i.test(f));
  } catch { files = []; }
  const paper = wallpaperFor(where, files);
  if (paper) {
    db.query("UPDATE chats SET wallpaper = ? WHERE id = ?")
      .run(`/uploads/wallpapers/${paper}`, chatId);
  }
}

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
  const { klass, race, how, kind } = await c.req.json().catch(() => ({}));
  const sheet = makeSheet(String(klass ?? ""), how === "array" ? "array" : "roll");
  if (!sheet) return c.json({ error: "No such class." }, 400);
  const withRace = dressWithRace(sheet, String(race ?? ""));
  saveSheet(c.req.param("ownerId"), String(kind ?? "persona"), withRace);
  return c.json({ sheet: withRace });
});

/**
 * A race's contribution, applied after the class has rolled.
 *
 * After, never before: rolling against a total that already includes the bonus
 * is how a +2 becomes a +2 *and* a better roll, and then a Dwarf Fighter is
 * not a Fighter who is a Dwarf, it is a better Fighter. The hit points are
 * recomputed because constitution may have moved, and the character is given
 * the same fraction of health they had rather than being quietly healed.
 */
function dressWithRace(sheet: Sheet, raceId: string): Sheet {
  const race = raceId ? kitById(raceId) : null;
  if (!race || race.kind !== "race") return sheet;
  const abilities = applyRace(sheet.abilities, race);
  const conBefore = modifier(sheet.abilities.con);
  const conAfter = modifier(abilities.con);
  const maxHp = Math.max(1, sheet.maxHp + (conAfter - conBefore));
  return {
    ...sheet,
    race: race.id,
    abilities,
    maxHp,
    hp: Math.max(1, Math.round(maxHp * (sheet.hp / Math.max(1, sheet.maxHp)))),
  };
}

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
  // `chat` is optional: pressing an ability on the sheet with no chat open is
  // a legitimate thing to do and there is nowhere to file the result.
  const { ability, chat } = await c.req.json().catch(() => ({}));
  const key = String(ability ?? "").toLowerCase() as Ability;
  if (!(key in ABILITY_NAMES)) return c.json({ error: "No such ability." }, 400);
  const sheet = sheetFor(c.req.param("ownerId"));
  if (!sheet) return c.json({ error: "No sheet to roll against." }, 400);
  const check = abilityCheck(sheet, key);
  if (chat) {
    logRoll(String(chat), "check", `${ABILITY_NAMES[key]} check`,
            describeCheck(check), check.total, whoAmI().name);
  }
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

/* ---- the roll log -----------------------------------------------------------
   Every table keeps one, and for the same reason: it is the only proof a
   player has that the dice were not quietly decided by whoever is narrating.
   Hearth's dice were already honest — rolled server-side, never by the model —
   but "trust me" is not evidence and a scrollback is. */

export function logRoll(
  chatId: string,
  kind: "dice" | "check" | "attack" | "initiative",
  label: string,
  detail: string,
  total: number,
  who = "",
) {
  if (!chatId) return;
  db.query(
    "INSERT INTO rolls (id, chat_id, kind, label, detail, total, who, created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(uid(), chatId, kind, label.slice(0, 80), detail.slice(0, 200), Math.round(total), who.slice(0, 60), now());
}

api.get("/chats/:id/rolls", (c) =>
  c.json(db.query(
    "SELECT * FROM rolls WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200",
  ).all(c.req.param("id"))),
);

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
    sheet: { owner: playerId!, kind: "persona" },
  };
}

/**
 * Everyone who fights: the host's character, and each guest at this chat's
 * table who is actually there and has a sheet. A guest without a sheet has no
 * hit points to track and stays out, as the host would without one.
 */
function partyInFight(chatId: string, hostPersonaId: string | null | undefined) {
  const party: NonNullable<ReturnType<typeof playerInFight>>[] = [];
  const host = playerInFight(hostPersonaId);
  if (host) party.push(host);
  const share = db.query("SELECT id FROM shares WHERE chat_id = ? AND open = 1 LIMIT 1").get(chatId) as any;
  if (share) {
    for (const p of seatOrder(share.id)) {
      if (p.id === HOST_SEAT) continue;
      const sheet = sheetFor(p.id);
      if (!sheet) continue;
      party.push({
        name: p.name, hp: sheet.hp, maxHp: sheet.maxHp,
        initiativeBonus: modifier(sheet.abilities.dex),
        sheet: { owner: p.id, kind: "player" },
      });
    }
  }
  return party;
}

/**
 * A fight is over: everyone who fought is back to full.
 *
 * Without it hit points only ever went down — the sheet kept the last fight's
 * damage into the next one and the one after, with no rest in the game to put
 * it back. The story can still say somebody is hurt; the numbers start fresh.
 */
/**
 * Something the narrator marked, written into the chronicle now and tied to
 * its message once the reply has been saved — it has no id until then. See
 * tieNarration.
 */
function recordNarrated(chatId: string, fields: Record<string, unknown>) {
  const at = clockOf(calendarOf(chatId), chronicleOf(chatId));
  copyChronicle([normaliseChronicleEntry({
    day: at.day, minute: at.minute, ...fields, id: uid(), message_id: null, source: "narrator", created_at: now(),
  })], chatId);
}

/** The reply is saved: whatever the narrator marked in it now belongs to it. */
function tieNarration(chatId: string, messageId: string, since: number) {
  db.query("UPDATE chronicle SET message_id = ? WHERE chat_id = ? AND source = 'narrator' AND message_id IS NULL AND created_at >= ?")
    .run(messageId, chatId, since);
}

/**
 * Time a reply opens on: "Three days later, …", "The next morning, …".
 *
 * Read the moment the reply is saved, so a time skip moves the date at once
 * rather than whenever the Steward next reads (every so many messages, and
 * only with a model to read with). Only the opening clause, and only through
 * readSpan, which reads a plain span or nothing: "Some time later" and a
 * line of dialogue move nothing. Skipped where the narrator already marked
 * the time, so nothing is counted twice; recorded as the narrator's, so an
 * edit or a swipe of the reply takes it away with the words.
 */
export function openingClause(text: string): string {
  const start = String(text ?? "").replace(/^(?:\s|[*_>#~]|<[^>]*>)+/, "");
  if (/^["“'‘(\[]/.test(start)) return "";
  const clause = start.split(/[,.;:!?\n—–]/)[0]?.replace(/[*_~]/g, "").trim() ?? "";
  return clause.length <= 60 ? clause : "";
}

function openingTime(chatId: string, messageId: string, text: string) {
  if (getSettings().story_world === "0") return;
  const entries = chronicleOf(chatId);
  if (liveEntries(entries).some((e) => e.kind === "time" && e.message_id === messageId)) return;
  const said = openingClause(text);
  if (!said) return;
  const cal = calendarOf(chatId);
  const span = readSpan(cal, said, clockOf(cal, entries));
  if (!span) return;
  const t = now();
  recordNarrated(chatId, { kind: "time", span, title: said, day: null, minute: null });
  tieNarration(chatId, messageId, t);
}

/**
 * Time passing, by the narrator's word — and what it does to the party.
 *
 * Read by the calendar like every other span: "three days" moves the clock,
 * "a while" moves nothing and its brackets stay where they are. Then the
 * table's rules: a rest heals, and each night that passes eats a day of
 * rations (src/tabletop.ts, afterTime). Whoever healed gets the same hit
 * point chip a fight would give them, so the sheet and the story agree.
 */
function narrateTime(chatId: string, said: string, playerId?: string | null): string | null {
  const cal = calendarOf(chatId);
  const before = clockOf(cal, chronicleOf(chatId));
  const span = readSpan(cal, said, before);
  if (!span) return null;
  recordNarrated(chatId, { kind: "time", span, title: said, day: null, minute: null });
  const nights = later(cal, before, span).day - before.day;
  const marks = [`[[passed: ${said}]]`];
  for (const member of partyInFight(chatId, playerId)) {
    if (!member.sheet) continue;
    const sheet = sheetFor(member.sheet.owner);
    if (!sheet) continue;
    const after = afterTime(sheet, span, nights);
    if (after.healed || after.rations) saveSheet(member.sheet.owner, member.sheet.kind, after.sheet);
    if (after.healed) marks.push(`[[hp: ${member.name} +${after.healed}, ${after.sheet.hp}/${after.sheet.maxHp}]]`);
    if (after.rations) marks.push(`[[supplies: ${member.name} — ${after.rations}]]`);
  }
  return marks.join(" ");
}

/** A group the narrator named: put forward to the host, never made outright. */
function narrateFaction(chatId: string, name: string, brief: string): string | null {
  const entries = chronicleOf(chatId);
  const known = [...factionsOf(entries).map((f) => f.name), ...pending(entries).filter((e) => e.kind === "faction").map((e) => e.title)];
  if (known.some((n) => groupKey(n) === groupKey(name))) return `[[faction: ${name}]]`;
  const set = chargesNow();
  recordNarrated(chatId, {
    kind: "faction", subject: uid(), title: name, body: brief, proposed: true,
    data: { arms: withContrast(armsFromName(`${name} ${brief}`.trim(), set.ids)), members: [] },
  });
  return `[[faction: ${name}]]`;
}

/**
 * The party rose or fell in a faction's eyes: one step, whichever way the
 * narrator wrote it. A faction the chat does not have yet cannot be stood
 * with, and its brackets are left as written.
 */
function narrateStanding(chatId: string, who: string, way: string): string | null {
  const step = wayOf(way);
  const f = factionsOf(chronicleOf(chatId)).find((x) => groupKey(x.name) === groupKey(who));
  if (!step || !f) return null;
  recordNarrated(chatId, { kind: "standing", subject: f.key, amount: step * STANDING_STEP, title: f.name });
  return `[[standing: ${f.name} ${step > 0 ? "+" : "−"}${STANDING_STEP}]]`;
}

/** How far one mark moves the party's standing with a faction, on its -100 to 100 scale. */
const STANDING_STEP = 10;

function restoreAfterFight(fight: Fight | null) {
  for (const c of fight?.order ?? []) {
    if (!c.player || !c.sheet) continue;
    const sheet = sheetFor(c.sheet.owner);
    if (sheet && sheet.hp !== sheet.maxHp) saveSheet(c.sheet.owner, c.sheet.kind, { ...sheet, hp: sheet.maxHp });
  }
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

    // What the narrator says about the world goes into the chronicle.
    if (intent.kind === "time") return narrateTime(chatId, intent.said, playerId);
    if (intent.kind === "event") {
      recordNarrated(chatId, { kind: "event", title: intent.title });
      return `[[event: ${intent.title}]]`;
    }
    if (intent.kind === "faction") return narrateFaction(chatId, intent.name, intent.brief);
    if (intent.kind === "standing") return narrateStanding(chatId, intent.who, intent.way);

    if (intent.kind === "fight") {
      const fight = startFight(intent.foes, partyInFight(chatId, playerId));
      if (!fight) return null;
      saveFight(chatId, fight);
      logRoll(chatId, "initiative", "Initiative", describeInitiative(fight),
              fight.order[0]?.initiative ?? 0, fight.order[0]?.name ?? "");
      return `[[initiative: ${describeInitiative(fight)}]]`;
    }

    if (intent.kind === "endfight") {
      const ending = fightIn(chatId);
      if (!ending) return null;
      saveFight(chatId, null);
      restoreAfterFight(ending);
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
    const owner = who.sheet ?? (who.player && playerId ? { owner: playerId, kind: "persona" } : null);
    if (who.player && owner) {
      const sheet = sheetFor(owner.owner);
      if (sheet) saveSheet(owner.owner, owner.kind, { ...sheet, hp: who.hp });
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
      dressTheScene(chatId, intent.where);
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
    restoreAfterFight(after);
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
    // Named with the word the narrator used. Asked for perception and handed
    // a "Wisdom check", a table looks like a table with no perception in it —
    // the roll was always right, only its name was the stat's rather than the
    // skill's.
    const asked = askedFor(last?.content ?? "");
    ability = asked?.ability ?? null;
    if (asked) {
      label = `${asked.word.replace(/\b\w/g, (ch) => ch.toUpperCase())} check`;
    }
  }

  // No sheet, or nothing asked for: a die is still a die.
  if (!ability) {
    const roll = rollDice("1d20")!;
    logRoll(chatId, "dice", "1d20", describeRoll(roll), roll.total, me.name);
    return c.json({
      total: roll.total, die: roll.rolls[0], modifier: 0, label: "Roll",
      parts: [{ label: "d20", value: roll.rolls[0] }],
      text: `1d20: ${roll.total}`,
    });
  }

  const check = abilityCheck(sheet!, ability);
  logRoll(chatId, label === "Attack" ? "attack" : "check", label,
          describeCheck(check), check.total, me.name);
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
  const { notation, chat } = await c.req.json().catch(() => ({ notation: "" }));
  const roll = rollDice(String(notation ?? ""));
  if (!roll) return c.json({ error: `"${String(notation ?? "").slice(0, 40)}" is not dice.` }, 400);
  if (chat) logRoll(String(chat), "dice", roll.notation, describeRoll(roll), roll.total, whoAmI().name);
  /*
   * The same shape the table's own roll answers in, so the die can be thrown
   * where you can watch it here too. A story chat has no situation to read and
   * still asks what to roll, but once it knows, a roll is a roll: it should
   * land rather than appear.
   *
   * `die` is the dice added up without the modifier — what the dice came up,
   * which is what belongs on a face. `faces` bounds the scramble so a d6 never
   * flickers through seventeen on its way down.
   */
  const dice = roll.rolls.reduce((a, b) => a + b, 0);
  return c.json({
    roll,
    text: describeRoll(roll),
    total: roll.total,
    die: dice,
    modifier: roll.modifier,
    label: roll.notation,
    faces: { min: roll.count, max: roll.count * roll.sides },
    parts: [
      { label: `${roll.count}d${roll.sides}`, value: dice },
      ...(roll.modifier ? [{ label: roll.modifier < 0 ? "penalty" : "bonus", value: roll.modifier }] : []),
    ],
  });
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

/** Which preset, if any, a request wants a script bound to; checked, so a typo cannot orphan one. */
function presetFor(v: unknown): { ok: true; id: string | null } | { ok: false } {
  if (v === null || v === undefined || v === "") return { ok: true, id: null };
  const row = db.query("SELECT id FROM presets WHERE id = ? AND deleted_at IS NULL").get(String(v)) as any;
  return row ? { ok: true, id: row.id } : { ok: false };
}

/** Import: one script, an array, or anything with `regex_scripts` inside it. */
api.post("/regex/import", async (c) => {
  const body = await c.req.json().catch(() => null);
  const source = String((body as any)?.source ?? "").trim();
  const owner = presetFor((body as any)?.presetId);
  if (!owner.ok) return c.json({ error: "That preset no longer exists." }, 400);
  const raw = (body as any)?.scripts ?? body;
  const list: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.regex_scripts) ? raw.regex_scripts
    : Array.isArray(raw?.extensions?.regex_scripts) ? raw.extensions.regex_scripts
    : raw && typeof raw === "object" ? [raw] : [];
  if (!list.length) return c.json({ error: "No regex scripts in that file." }, 400);

  const base = nextScriptPosition();
  list.forEach((r, i) => saveScript(r, source, base + i, owner.id));
  return c.json({ imported: list.length });
});

/**
 * A new script, or an edited one. The pattern is compiled before anything is
 * written: a script that cannot compile does nothing at all when it runs,
 * silently, and the place to find that out is the editor, not a chat that
 * looks wrong a week later.
 */
function writeScript(id: string | null, body: any): Response {
  const owner = presetFor(body?.presetId);
  if (!owner.ok) return Response.json({ error: "That preset no longer exists." }, { status: 400 });
  const script = normaliseScript({ ...body, id: id ?? body?.id ?? crypto.randomUUID() }, String(body?.source ?? ""));
  if (!script.name.trim()) return Response.json({ error: "A script needs a name." }, { status: 400 });
  const bad = compileError(script.find);
  if (bad) return Response.json({ error: `The find pattern does not compile: ${bad}` }, { status: 400 });
  if (script.minDepth !== null && script.maxDepth !== null && script.minDepth > script.maxDepth) {
    return Response.json({ error: "Minimum depth is deeper than maximum depth, so the script could never run." }, { status: 400 });
  }
  if (id) {
    const row = db.query("SELECT id FROM regex_scripts WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!row) return Response.json({ error: "Script not found." }, { status: 404 });
    db.query("UPDATE regex_scripts SET name = ?, script = ?, enabled = ?, source = ?, preset_id = ? WHERE id = ?")
      .run(script.name, JSON.stringify(script), script.enabled ? 1 : 0, script.source, owner.id, id);
  } else {
    if (db.query("SELECT id FROM regex_scripts WHERE id = ?").get(script.id)) script.id = crypto.randomUUID();
    db.query(
      "INSERT INTO regex_scripts (id, name, script, enabled, source, position, created_at, preset_id) VALUES (?,?,?,?,?,?,?,?)",
    ).run(script.id, script.name, JSON.stringify(script), script.enabled ? 1 : 0, script.source,
          nextScriptPosition(), now(), owner.id);
  }
  return Response.json(liveScripts().find((r) => r.id === script.id) ?? null);
}

api.post("/regex", async (c) => writeScript(null, await c.req.json().catch(() => ({}))));
api.put("/regex/:id", async (c) => writeScript(c.req.param("id"), await c.req.json().catch(() => ({}))));

/** A copy placed straight after the original, switched off so it cannot run twice by surprise. */
api.post("/regex/:id/duplicate", (c) => {
  const src = liveScripts().find((r) => r.id === c.req.param("id"));
  if (!src) return c.json({ error: "Script not found." }, 404);
  const id = crypto.randomUUID();
  const copy = { ...src, id, name: `${src.name} (copy)`, enabled: false };
  db.transaction(() => {
    db.query("UPDATE regex_scripts SET position = position + 1 WHERE deleted_at IS NULL AND position > ?").run(src.position);
    db.query(
      "INSERT INTO regex_scripts (id, name, script, enabled, source, position, created_at, preset_id) VALUES (?,?,?,?,?,?,?,?)",
    ).run(id, copy.name, JSON.stringify(normaliseScript(copy, src.source)), 0, src.source, src.position + 1, now(), src.presetId);
  })();
  return c.json(liveScripts().find((r) => r.id === id));
});

/** The whole order at once. Scripts run in this order, so it is the order that matters. */
api.post("/regex/reorder", async (c) => {
  const { ids } = await c.req.json().catch(() => ({ ids: [] }));
  const list: string[] = Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
  if (!list.length) return c.json({ error: "Nothing to order." }, 400);
  // Anything the client did not mention keeps its relative place, after the rest.
  const rest = liveScripts().map((r) => r.id).filter((id) => !list.includes(id));
  const stmt = db.query("UPDATE regex_scripts SET position = ? WHERE id = ?");
  db.transaction(() => { [...list, ...rest].forEach((id, i) => stmt.run(i, id)); })();
  return c.json({ ok: true });
});

/** Switch several on or off together. */
api.post("/regex/enable", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const list: string[] = Array.isArray(b?.ids) ? b.ids.filter((x: unknown) => typeof x === "string") : [];
  if (!list.length) return c.json({ error: "Nothing chosen." }, 400);
  const stmt = db.query("UPDATE regex_scripts SET enabled = ? WHERE id = ?");
  db.transaction(() => { for (const id of list) stmt.run(b.enabled ? 1 : 0, id); })();
  return c.json({ changed: list.length });
});

/** Move several to a preset, or make them shared (`presetId: null`). */
api.post("/regex/assign", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const list: string[] = Array.isArray(b?.ids) ? b.ids.filter((x: unknown) => typeof x === "string") : [];
  if (!list.length) return c.json({ error: "Nothing chosen." }, 400);
  const owner = presetFor(b?.presetId);
  if (!owner.ok) return c.json({ error: "That preset no longer exists." }, 400);
  const stmt = db.query("UPDATE regex_scripts SET preset_id = ? WHERE id = ?");
  db.transaction(() => { for (const id of list) stmt.run(owner.id, id); })();
  return c.json({ changed: list.length });
});

/**
 * SillyTavern's own file shape: one script as an object, several as an array
 * — the two shapes its regex importer reads.
 */
api.get("/regex/export", (c) => {
  const want = String(c.req.query("ids") ?? "").split(",").filter(Boolean);
  const all = liveScripts();
  const picked = want.length ? want.map((id) => all.find((r) => r.id === id)).filter(Boolean) as LiveScript[] : all;
  if (!picked.length) return c.json({ error: "Nothing to export." }, 404);
  if (picked.length === 1) {
    return download(`regex-${picked[0].name || "script"}.json`, scriptToSillyTavern(picked[0]));
  }
  return download("regex-scripts.json", picked.map(scriptToSillyTavern));
});

/**
 * The test chamber. Runs a script — saved or still being edited — over sample
 * text with the same functions assembly uses, and returns what came out. It
 * reads nothing but the request and, for `pipeline`, the list of scripts, and
 * it writes nothing at all: no chat, no message, no script.
 */
api.post("/regex/test", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const text = String(b?.text ?? "").slice(0, 200_000);
  const where: "prompt" | "display" = b?.where === "prompt" ? "prompt" : "display";
  const placement = b?.role === "user" ? PLACEMENT.userInput : PLACEMENT.aiOutput;
  const depth = Number.isFinite(+b?.depth) ? Math.max(0, Math.floor(+b.depth)) : 0;
  const names = { char: String(b?.names?.char ?? "") || undefined, user: String(b?.names?.user ?? "") || undefined };
  const script = normaliseScript(b?.script ?? {}, "");
  const error = compileError(script.find);

  // Why a script would sit this one out, in the order a person would check.
  const reasons: string[] = [];
  if (!script.enabled) reasons.push("The script is switched off.");
  if (where === "prompt" ? !script.prompt : !script.display) {
    reasons.push(where === "prompt" ? "It does not run on what the model is sent." : "It does not run on what is shown.");
  }
  if (!script.placement.includes(placement)) {
    reasons.push(placement === PLACEMENT.userInput ? "It does not target your messages." : "It does not target replies.");
  }
  if (script.minDepth !== null && depth < script.minDepth) reasons.push(`The message is newer than its minimum depth (${script.minDepth}).`);
  if (script.maxDepth !== null && depth > script.maxDepth) reasons.push(`The message is older than its maximum depth (${script.maxDepth}).`);
  if (!script.placement.some((p) => RUNS_HERE.has(p))) {
    reasons.push("Its only targets are ones Hearth has nothing to run on.");
  }

  const output = error ? text : runScript(text, script, names);
  // With every other live script in order around it — what a message would
  // actually go through. The edited version stands in for the saved one.
  let pipeline: string | null = null;
  if (b?.pipeline) {
    const others = liveScripts().filter((r) => r.active);
    const at = others.findIndex((r) => r.id === script.id);
    const list = at >= 0 ? others.map((r, i) => (i === at ? script : r)) : [...others, script];
    pipeline = applyScripts(text, list, where, placement, depth, names);
  }
  return c.json({
    error,
    applies: !error && applies(script, where, placement, depth),
    reasons,
    matches: error ? [] : matchesOf(text, script, names),
    output,
    pipeline,
  });
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
  const id = c.req.param("id");
  const row = db.query("SELECT name, data FROM presets WHERE id = ?").get(id) as { name: string; data: string } | undefined;
  if (!row) return c.json({ error: "Preset not found." }, 404);
  let old: PresetData = {};
  try { old = JSON.parse(row.data) ?? {}; } catch {}
  const data: PresetData = { ...(b.data ?? {}) };
  // The SillyTavern original rides along whether or not the page sent it back:
  // an editor that only knows about blocks must not be able to drop it.
  if (data.st === undefined && old.st !== undefined) data.st = old.st;
  const name = String(b.name ?? "").trim() || row.name;
  db.query("UPDATE presets SET name = ?, data = ? WHERE id = ?").run(name, JSON.stringify(data), id);
  return c.json({ ok: true });
});

api.post("/presets/:id/rename", async (c) => {
  const { name } = await c.req.json().catch(() => ({}));
  const clean = String(name ?? "").trim();
  if (!clean) return c.json({ error: "A preset needs a name." }, 400);
  const r = db.query("UPDATE presets SET name = ? WHERE id = ? AND deleted_at IS NULL").run(clean, c.req.param("id"));
  if (!r.changes) return c.json({ error: "Preset not found." }, 404);
  return c.json({ ok: true });
});

/**
 * A copy to experiment on. Its scripts come too, bound to the copy, so the
 * copy behaves like the original the moment it is switched on; it starts
 * inactive, so nothing changes until it is.
 */
api.post("/presets/:id/duplicate", (c) => {
  const src = db.query("SELECT * FROM presets WHERE id = ? AND deleted_at IS NULL").get(c.req.param("id")) as any;
  if (!src) return c.json({ error: "Preset not found." }, 404);
  const id = uid();
  const name = `${src.name} (copy)`;
  db.transaction(() => {
    db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES (?,?,?,?,?)")
      .run(id, name, src.data, 0, now());
    const own = liveScripts().filter((r) => r.presetId === src.id);
    let at = nextScriptPosition();
    for (const r of own) {
      const copy = { ...r, id: crypto.randomUUID() };
      db.query(
        "INSERT INTO regex_scripts (id, name, script, enabled, source, position, created_at, preset_id) VALUES (?,?,?,?,?,?,?,?)",
      ).run(copy.id, copy.name, JSON.stringify(normaliseScript(copy, r.source)), r.enabled ? 1 : 0, name, at++, now(), id);
    }
  })();
  return c.json({ id, name });
});

/** What a preset holds that Hearth keeps for SillyTavern but does not use. */
api.get("/presets/:id/kept", (c) => {
  const row = db.query("SELECT data FROM presets WHERE id = ?").get(c.req.param("id")) as { data: string } | undefined;
  if (!row) return c.json({ error: "Preset not found." }, 404);
  let data: PresetData = {};
  try { data = JSON.parse(row.data) ?? {}; } catch {}
  const st = data.st ?? {};
  return c.json(keptOnly(data).map((k) => ({ key: k, value: st[k] })));
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
      const { name, data } = isHearthPreset(json) ? fromHearth(json) : fromSillyTavern(json);
      const label = name === "Imported preset" ? f.name.replace(/(\.preset)?\.json$/i, "") : name;
      const pid = uid();
      db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES (?,?,?,?,?)")
        .run(pid, label, JSON.stringify(data), 0, now());
      importScriptsFrom(json, label, pid);
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
/**
 * Restores one of Hearth's own backups — the zip /backup/export makes, with
 * hearth.db and the uploads folder at its root — from wherever it has been
 * unpacked to.
 *
 * This is what makes a backup worth having. The import beside it only ever
 * understood SillyTavern's layout, so Hearth could write a backup it could
 * not read: exporting, reinstalling and importing — the obvious way to move a
 * library, and the only way onto a phone whose old copy was signed with a key
 * that is gone — brought back nothing at all.
 *
 * Merged rather than swapped in: the backup's rows win where both copies have
 * the same one, and anything only this copy has is left where it is.
 */
async function restoreHearth(root: string, send: (o: unknown) => void) {
  send({ stage: "Restoring your Hearth backup", done: 0, total: 1 });

  // A fresh install seeds its own narrator. If it has never been written to
  // and the backup brings its own, the library would hold two.
  const untouched = (db.query(
    `SELECT c.id FROM characters c WHERE c.name = ? AND NOT EXISTS (
       SELECT 1 FROM messages m JOIN chats ch ON ch.id = m.chat_id
       WHERE ch.character_id = c.id AND m.role = 'user')`,
  ).all(STARTER.name) as { id: string }[]).map((r) => r.id);

  const { counts, notes } = mergeDatabase(new Uint8Array(readFileSync(join(root, "hearth.db"))));

  if (untouched.length) {
    const marks = untouched.map(() => "?").join(", ");
    const theirs = (db.query(
      `SELECT COUNT(*) AS n FROM characters WHERE name = ? AND id NOT IN (${marks})`,
    ).get(STARTER.name, ...untouched) as { n: number }).n;
    if (theirs > 0) for (const id of untouched) db.query("DELETE FROM characters WHERE id = ?").run(id);
  }

  send({ stage: "Restoring your pictures", done: 0, total: 1 });
  let pictures = 0;
  const copyTree = (from: string, to: string) => {
    let names: string[] = [];
    try { names = readdirSync(from); } catch { return; }
    for (const n of names) {
      const src = join(from, n);
      const dest = join(to, n);
      try {
        if (statSync(src).isDirectory()) { copyTree(src, dest); continue; }
        mkdirSync(to, { recursive: true });
        copyFileSync(src, dest);
        pictures++;
      } catch {}
    }
  };
  copyTree(join(root, "uploads"), UPLOADS);

  const n = (t: string) => counts[t] ?? 0;
  send({
    finished: true,
    // Settings came in too — theme, look, keys — and the page only reads
    // those as it loads.
    reload: true,
    count: {
      characters: n("characters"), chats: n("chats"), messages: n("messages"),
      personas: n("personas"), lorebooks: n("lorebooks"), presets: n("presets"), pictures,
    },
    notes: notes.slice(0, 12),
  });
}

/** Where a Hearth backup's database sits once its archive is unpacked. */
const hearthBackupIn = (dir: string) => existsSync(join(dir, "hearth.db"));

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
          if (hearthBackupIn(stage)) { await restoreHearth(stage, send); return; }
          if (!entries.length) throw new Error("Nothing importable was found in that archive.");
        } else if (localPath && hearthBackupIn(localPath)) {
          // The phone unpacks an archive itself (ZipImport.java) and sends the
          // folder; a Hearth backup arrives here that way.
          await restoreHearth(localPath, send);
          return;
        } else if (localPath) {
          send({ stage: `Reading ${localPath}`, done: 0, total: 1 });
          const got = collect(localPath);
          entries.push(...got.entries);
          if (!entries.length) throw new Error("Nothing importable was found in that folder.");
        }

        for (const { file, path } of incoming) {
          const raw = new Uint8Array(await file.arrayBuffer());
          if (/\.zip$/i.test(path)) {
            const inside = readZip(raw);
            if (inside.some((e) => e.path === "hearth.db")) {
              // A Hearth backup uploaded from a browser: lay it out on disk
              // the way the other two routes find it, and restore from there.
              stage = join(DATA, "import-staging", uid());
              for (const e of inside) {
                const safe = e.path.split("/").filter((p) => p && p !== "." && p !== "..").join("/");
                if (!safe) continue;
                const dest = join(stage, safe);
                mkdirSync(dirname(dest), { recursive: true });
                writeFileSync(dest, e.read());
              }
              await restoreHearth(stage, send);
              return;
            }
            entries.push(...inside);
          } else entries.push({ path, read: () => raw });
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
          const pid = uid();
          db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES (?,?,?,?,?)")
            .run(pid, label, JSON.stringify(data), 0, now());
          importScriptsFrom(pr.json, label, pid);
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


// ---- playing together -----------------------------------------------------

/**
 * Opening a chat to other people, and sitting at one that has been opened.
 *
 * The host's half is ordinary: list, open, close, see who is here, show
 * somebody the door. It is behind the gate above like everything else, so it
 * is reachable from this machine and nowhere on earth besides.
 *
 * The guest's half is the short list in share.ts and nothing else. Note what
 * is *not* here: no route to read a setting, list the cast, open another chat,
 * or start a generation. A guest's turn is written down and announced, and the
 * host's copy is what answers it — which is right in more than one way, since
 * it is the host's key that pays for the answer.
 */

/** The chat a share is for, or nothing, without trusting the caller's word. */
function shareOf(id: string) {
  return db.query("SELECT * FROM shares WHERE id = ?").get(id) as any;
}

function playersAt(shareId: string) {
  const host = hostSeat(shareId);
  return [
    // Everyone at the table sees the host in the strip, so "Waiting on Bingus"
    // names somebody they can see.
    { ...publicPlayer(host as any), sheet: sheetFor(host.persona_id) },
    ...(db.query("SELECT * FROM players WHERE share_id = ? ORDER BY created_at").all(shareId) as any[])
      .map((p) => ({ ...publicPlayer(p), sheet: sheetFor(p.id) })),
  ];
}

/* ---- taking turns ----------------------------------------------------------
 * Whose go it is, when a table has asked for an order.
 *
 * Seating order, which is arrival order — the same order `playersAt` already
 * returns and the same order the faces are drawn in, so the turn visibly goes
 * round the table rather than hopping about.
 *
 * The host is not in the rotation. They are running the game rather than
 * playing in it: they hand the turn out, they can take it back, and they are
 * never stopped from speaking. A narrator who has to wait their turn cannot
 * answer the person whose turn it is.
 */

/**
 * How long a seat counts as filled after its page was last heard from. An
 * open page is heard from every 15 seconds — the live feed's heartbeat marks
 * it — so this is four missed beats: a phone that dropped off the Wi-Fi, a
 * tab that was closed, or the same person coming back through a new tunnel
 * address, which reaches the table as a new seat and leaves the old one empty.
 */
const SEAT_GONE_AFTER = 60_000;

/**
 * Everyone who can hold a turn, in the order they sat down — leaving out
 * seats nobody has been at for a while. Without that, a seat whose page had
 * gone kept its place in the rotation, and the turn came round to it and
 * stayed there: everyone else's composer said "Waiting on A player…" for good.
 */
function seatOrder(shareId: string): any[] {
  const guests = db.query(
    "SELECT * FROM players WHERE share_id = ? AND host = 0 AND seen_at >= ? ORDER BY created_at",
  ).all(shareId, now() - SEAT_GONE_AFTER) as any[];
  return [hostSeat(shareId), ...guests];
}

/**
 * The host's seat in the rotation.
 *
 * Left out at first, on the theory that the host runs the game and must
 * always be able to speak. But the narrator is the model, not the host: at a
 * real table the host is a player like everyone else — Bingus, here — and
 * with them outside the rotation a table of one guest had a rotation of one,
 * which never moved and never made anybody wait. The host still has the
 * override: Together can hand the turn to anyone, the host included.
 *
 * Not a row: the host has no token and nothing to store. It sits first, and
 * is always there — it is the machine the table runs on.
 */
const HOST_SEAT = "host";
function hostSeat(shareId: string) {
  const share = shareOf(shareId);
  const chat = share ? db.query("SELECT persona_id FROM chats WHERE id = ?").get(share.chat_id) as any : null;
  const me = whoAmI(chat?.persona_id);
  return { id: HOST_SEAT, name: me.name, host: 1, persona_id: me.id, seen_at: now(), created_at: 0 };
}

/**
 * The host's turn, used: called when the host's own words go into the chat.
 * Guests' turns move on in POST /table/say; this is the same for the host.
 */
function hostSpoke(chatId: string) {
  const share = db.query("SELECT * FROM shares WHERE chat_id = ? AND open = 1 LIMIT 1").get(chatId) as any;
  if (!share) return;
  const turn = turnAt(share);
  if (!turn.on || turn.player !== HOST_SEAT) return;
  setTurn(share.id, advanceTurn(share, HOST_SEAT));
  publishTurn(share.id);
}

/**
 * Moves the turn along one seat.
 *
 * `from` is who has just finished. Passing nobody — an empty table, or a
 * rotation that has just been switched on — starts it at the first seat.
 */
function advanceTurn(share: any, from?: string | null): string | null {
  const seats = seatOrder(share.id);
  if (!seats.length) return null;
  const at = from ? seats.findIndex((p) => p.id === from) : -1;
  const next = seats[(at + 1) % seats.length];
  return next?.id ?? null;
}

function setTurn(shareId: string, playerId: string | null) {
  db.query("UPDATE shares SET turn_player_id = ? WHERE id = ?").run(playerId, shareId);
}

/**
 * The turn as everybody should see it.
 *
 * Read rather than trusted: the stored id can name somebody who has since got
 * up, and a table waiting for a player who is not there is a table that has
 * stopped. When that happens the turn moves to the first seat still filled.
 */
function turnAt(share: any): { on: boolean; player: string | null } {
  const on = !!share.taking_turns;
  if (!on) return { on: false, player: null };
  const seats = seatOrder(share.id);
  if (!seats.length) return { on: true, player: null };
  const held = seats.some((p) => p.id === share.turn_player_id);
  if (held) return { on: true, player: share.turn_player_id };
  const first = seats[0].id;
  setTurn(share.id, first);
  return { on: true, player: first };
}

/** Announces the turn to the whole table, players and host alike. */
function publishTurn(shareId: string) {
  const share = shareOf(shareId);
  if (!share) return;
  publish(shareId, "turn", { turn: turnAt(share), players: playersAt(shareId) });
}

api.get("/shares", (c) => {
  const rows = db.query("SELECT * FROM shares WHERE open = 1 ORDER BY created_at DESC").all() as any[];
  return c.json(rows.map((r) => ({
    id: r.id, chat_id: r.chat_id, name: r.name, created_at: r.created_at,
    // The invitation, spelled out, because the host has to be able to send it.
    join: `/join/${r.token}`,
    players: playersAt(r.id),
    // So the panel can draw the rotation without a second round trip.
    turn: turnAt(r),
  })));
});

api.post("/shares", async (c) => {
  const { chat_id = "", name = "" } = await c.req.json().catch(() => ({}));
  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(String(chat_id)) as any;
  if (!chat) return c.json({ error: "Chat not found." }, 404);

  // One open share per chat. Two links to the same table is two ways to
  // revoke half of it.
  const already = db.query("SELECT * FROM shares WHERE chat_id = ? AND open = 1 LIMIT 1").get(chat.id) as any;
  if (already) return c.json({ id: already.id, join: `/join/${already.token}`, reused: true });

  const id = uid();
  db.query("INSERT INTO shares (id, chat_id, token, name, open, created_at) VALUES (?,?,?,?,1,?)")
    .run(id, chat.id, newToken(), String(name ?? "").slice(0, 80), now());
  const row = shareOf(id);
  return c.json({ id, join: `/join/${row.token}`, reused: false });
});

/**
 * The host's control of the rotation: switch it on or off, or hand the turn to
 * a particular seat.
 *
 * A host route rather than a guest one, and deliberately: whose turn it is is
 * the sort of thing one person should decide, and at this table that person is
 * the one whose machine is answering.
 */
api.put("/shares/:id/turns", async (c) => {
  const row = shareOf(c.req.param("id"));
  if (!row) return c.json({ error: "No such table." }, 404);
  const { on, player } = await c.req.json().catch(() => ({}));

  if (on !== undefined) {
    db.query("UPDATE shares SET taking_turns = ? WHERE id = ?").run(on ? 1 : 0, row.id);
    // Switching it on starts the round at the first seat rather than at
    // whoever happened to hold the turn last time it was on.
    if (on) setTurn(row.id, advanceTurn(row, null));
  }
  if (typeof player === "string" && player) {
    const seat = seatOrder(row.id).find((p) => p.id === player);
    if (!seat) return c.json({ error: "Nobody is in that seat." }, 400);
    setTurn(row.id, seat.id);
  }

  publishTurn(row.id);
  return c.json({ ok: true, turn: turnAt(shareOf(row.id)) });
});

/** The first chat a branch was cut from, however many branches deep. */
function rootOf(chatId: string): string {
  let id = chatId;
  for (let i = 0; i < 200; i++) {
    const row = db.query("SELECT parent_chat_id FROM chats WHERE id = ?").get(id) as any;
    if (!row?.parent_chat_id) return id;
    id = row.parent_chat_id;
  }
  return id;
}

/**
 * Moving the table to another branch of the same story.
 *
 * A table is opened on one chat, and branching makes another. The host moving
 * to the branch used to leave the guests behind on the old one: they kept
 * talking into a chat nobody was reading, the host's copy stopped answering
 * them because it was looking at something else, and the evening came apart.
 * The table follows the host instead — only within one story, so a link to
 * one game can never be turned into a seat at a different one.
 */
api.put("/shares/:id/chat", async (c) => {
  const row = shareOf(c.req.param("id"));
  if (!row || !row.open) return c.json({ error: "No such table." }, 404);
  const { chat_id } = await c.req.json().catch(() => ({}));
  const to = db.query("SELECT id FROM chats WHERE id = ? AND deleted_at IS NULL").get(String(chat_id ?? "")) as any;
  if (!to) return c.json({ error: "That chat is not here." }, 404);
  if (rootOf(to.id) !== rootOf(row.chat_id)) {
    return c.json({ error: "A table can follow you between branches of its own story, not to another one." }, 400);
  }
  db.query("UPDATE shares SET chat_id = ? WHERE id = ?").run(to.id, row.id);
  publish(row.id, "moved", { chat_id: to.id });
  return c.json({ ok: true, chat_id: to.id });
});

api.delete("/shares/:id", (c) => {
  const row = shareOf(c.req.param("id"));
  if (!row) return c.json({ error: "No such table." }, 404);
  /*
   * Closed, not deleted, and the players go with it.
   *
   * Closing has to actually turn the token off — a link that keeps working
   * after you have shut the table is not a link you have shut. The rows stay
   * so the transcript can still say who wrote what.
   */
  db.query("UPDATE shares SET open = 0 WHERE id = ?").run(row.id);
  publish(row.id, "closed", {});
  clearRoom(row.id);
  return c.json({ ok: true });
});

/**
 * The host's ear on the table.
 *
 * The same room the guests listen to, but reachable from this machine — the
 * guest feed is behind the guest gate, and the host is not a guest.
 *
 * This is what makes a guest's turn actually happen. Their turn is written
 * down and announced; this copy hears the announcement and answers it, with
 * the host's provider and the host's key. Which is right twice over: it is the
 * host's table and the host's bill, and it means a guest holding down a button
 * cannot start work on somebody else's account.
 *
 * The cost is that the host has to be here. That is not a limitation to
 * apologise for so much as what hosting means.
 */
api.get("/shares/:id/live", (c) => {
  const share = shareOf(c.req.param("id"));
  if (!share) return c.json({ error: "No such table." }, 404);

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let alive = true;
      const push = (s: string) => {
        if (!alive) return;
        try { controller.enqueue(enc.encode(s)); } catch { alive = false; }
      };
      const emit = (event: string, data: unknown) =>
        push(`data: ${JSON.stringify({ event, ...(data as object) })}\n\n`);

      emit("players", { players: playersAt(share.id) });
      const off = subscribe(share.id, (event, data) => {
        // The host already has its own copy of the frames it is producing;
        // echoing them back would paint every reply twice.
        if (event === "frame") return;
        emit(event, data);
      });
      const beat = setInterval(() => push(": keep-alive\n\n"), 15_000);
      const stop = () => {
        alive = false;
        clearInterval(beat);
        off();
        try { controller.close(); } catch {}
      };
      c.req.raw.signal?.addEventListener("abort", stop);
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
});

api.delete("/shares/:id/players/:pid", (c) => {
  const row = shareOf(c.req.param("id"));
  if (!row) return c.json({ error: "No such table." }, 404);
  db.query("DELETE FROM players WHERE id = ? AND share_id = ?").run(c.req.param("pid"), row.id);
  publish(row.id, "players", { players: playersAt(row.id) });
  return c.json({ ok: true, players: playersAt(row.id) });
});

/**
 * Opening and shutting the door.
 *
 * Host only — it is behind the gate like everything else, so this is reachable
 * from this machine and nowhere on earth besides. Which matters more here than
 * anywhere: a route that starts a process is a route worth reaching.
 *
 * It takes no command and no arguments. The only thing it can start is the one
 * tunnel it goes looking for, pointed at this server's own port.
 */
/**
 * Hosting from this device.
 *
 * The tunnel is one way to be reachable and not the only one. A phone cannot
 * run cloudflared — Android will not let an app execute a binary it shipped —
 * but it can perfectly well open a second listener on the network, and then
 * anyone who can already reach the phone can reach the table: everybody on the
 * same Wi-Fi, and everybody on the VPN if one is running.
 *
 * Off unless asked, every time. A device that quietly starts answering a
 * strange network because this was switched on once is not something to ship,
 * so the state lives here rather than in a setting that survives a restart.
 */
/** The socket guests arrive on, which is never the one the app itself uses. */
function publicPort(): number {
  return Number(process.env.PUBLIC_PORT ?? Number(process.env.PORT ?? 7870) + 1);
}

/**
 * How to be the owner of this Hearth from another device you own.
 *
 * The key used to exist only on the console, which is fine for somebody
 * running it in a terminal and useless everywhere else: the installed desktop
 * build hides its console outright, and a phone does not have one at all. A
 * credential you can only read by not using the app is a credential nobody
 * uses.
 *
 * Host-only, because guestMayTouch is an allow-list and this is not on it. So
 * the only people who can read the key are the ones who already have the
 * powers it grants — which is the same reason it is safe to print.
 */
api.get("/host-link", (c) => {
  const state = hostingState(publicPort());
  const key = hostKey();
  const ownPort = Number(process.env.PORT ?? 7870);

  /*
   * Two doors can be open, and they are on different ports. The main one when
   * Hearth was started bound past loopback, and the hosting one when the
   * network switch is on. Both take the key; neither exists by default.
   */
  const links: { where: string; port: number; url: string }[] = [];
  const add = (port: number) => {
    for (const where of state.addresses) {
      const url = `http://${where}:${port}/host/${key}`;
      if (!links.some((l) => l.url === url)) links.push({ where, port, url });
    }
  };
  if (BOUND_WIDE) add(ownPort);
  if (state.on && state.port) add(state.port);

  return c.json({
    key,
    wide: BOUND_WIDE,
    hosting: state.on,
    addresses: state.addresses,
    links,
  });
});

api.get("/hosting", (c) => c.json(hostingState(publicPort())));

api.put("/hosting", async (c) => {
  const { on } = await c.req.json().catch(() => ({}));
  // A code waiting for a door that has just shut is a code for nothing.
  if (!on) pairing = null;
  return c.json(setHosting(!!on, publicPort()));
});

api.get("/door", (c) => c.json(doorState()));

api.post("/door", async (c) => {
  // The public listener, never the ordinary one — see serve.ts. Pointing a
  // tunnel at the ordinary port is exactly the mistake this exists to stop.
  return c.json(await openDoor(publicPort()));
});

api.delete("/door", (c) => c.json(closeDoor()));

// ---- the guest's half -----------------------------------------------------

/** Everything a guest is allowed to know, in one shape. */
function tableState(share: any, player: any) {
  const chat = db.query("SELECT * FROM chats WHERE id = ?").get(share.chat_id) as any;
  const msgs = db.query(
    "SELECT id, role, name, content, created_at FROM messages WHERE chat_id = ? ORDER BY created_at, rowid",
  ).all(share.chat_id) as any[];
  // Who the narrator is. A guest has no cast to look them up in, so without
  // this every reply at the table is written by nobody.
  const host = chat
    ? (db.query("SELECT name, avatar FROM characters WHERE id = ?").get(chat.character_id) as any)
    : null;
  /*
   * And who the host is. The host's own turns are saved unsigned — at home
   * an unsigned turn is "mine" — and a guest's page, given nothing else, drew
   * every one of them as "You", as though the guest had said them.
   */
  const me = whoAmI(chat?.persona_id);
  return {
    table: { id: share.id, name: share.name },
    chat: {
      id: chat?.id ?? "", title: chat?.title ?? "", mode: getSettings().mode,
      character_name: host?.name ?? "", character_avatar: host?.avatar ?? "",
    },
    host: { name: me.name, avatar: me.avatar ?? "" },
    you: publicPlayer(player),
    players: playersAt(share.id),
    turn: turnAt(share),
    messages: msgs,
    fight: fightIn(share.chat_id),
    // Story World, in a line: the full view is fetched only when opened.
    world: worldSummary(share.chat_id),
  };
}

/** Story World for a seat at the table, seen from that seat's character. */
api.get("/table/world", (c) => {
  const g = guestOf(c);
  if (!g) return c.json({ error: "Not a seat at this table." }, 403);
  const persona = g.player.persona_id ? (db.query("SELECT name FROM personas WHERE id = ?").get(g.player.persona_id) as any) : null;
  return c.json(tableWorld(g.share.chat_id, persona?.name || g.player.name));
});

api.get("/table/state", (c) => {
  const g = guestOf(c);
  if (!g) return c.json({ error: "Not a seat at this table." }, 403);
  return c.json(tableState(g.share, g.player));
});

api.put("/table/me", async (c) => {
  const g = guestOf(c);
  if (!g) return c.json({ error: "Not a seat at this table." }, 403);
  const { name } = await c.req.json().catch(() => ({}));
  const taken = (db.query("SELECT name FROM players WHERE share_id = ? AND id != ?")
    .all(g.share.id, g.player.id) as any[]).map((r) => r.name);
  const tidy = tidyPlayerName(name ?? g.player.name, taken);
  db.query("UPDATE players SET name = ? WHERE id = ?").run(tidy, g.player.id);
  publish(g.share.id, "players", { players: playersAt(g.share.id) });
  return c.json({ ok: true, you: { ...publicPlayer(g.player), name: tidy } });
});

api.get("/table/me", (c) => {
  const g = guestOf(c);
  if (!g) return c.json({ error: "Not a seat at this table." }, 403);
  return c.json(publicPlayer(g.player));
});

api.post("/table/leave", (c) => {
  const g = guestOf(c);
  if (!g) return c.json({ error: "Not a seat at this table." }, 403);
  db.query("DELETE FROM players WHERE id = ?").run(g.player.id);
  publish(g.share.id, "players", { players: playersAt(g.share.id) });
  return c.json({ ok: true });
});

/**
 * A guest's turn.
 *
 * Written down and announced, and that is all this route does. It does not
 * generate: the host's copy hears the announcement and answers, so the reply
 * is made with the host's provider and the host's key, and a guest cannot
 * start work on somebody else's account by holding down a button.
 */
api.post("/table/say", async (c) => {
  const g = guestOf(c);
  if (!g) return c.json({ error: "Not a seat at this table." }, 403);
  const { content = "" } = await c.req.json().catch(() => ({}));
  const text = String(content ?? "").trim();
  if (!text) return c.json({ error: "Nothing to say." }, 400);
  if (text.length > 8000) return c.json({ error: "That is longer than a turn." }, 400);

  /*
   * Whose go it is, when the table has asked for an order.
   *
   * Checked here rather than only in the browser, because the browser is the
   * one place at this table that belongs to the person being checked. A
   * disabled composer is a courtesy; this is the rule.
   */
  const turn = turnAt(g.share);
  if (turn.on && turn.player && turn.player !== g.player.id) {
    const who = seatOrder(g.share.id).find((p) => p.id === turn.player);
    return c.json({ error: `It is ${who?.name || "somebody else"}'s turn.` }, 409);
  }

  const id = uid();
  const at = now();
  db.query(
    "INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES (?,?,?,?,?,?)",
  ).run(id, g.share.chat_id, "user", g.player.name, text, at);
  db.query("UPDATE chats SET updated_at = ? WHERE id = ?").run(at, g.share.chat_id);

  const msg = { id, role: "user", name: g.player.name, content: text, created_at: at };
  publish(g.share.id, "said", { message: msg, by: publicPlayer(g.player) });

  /*
   * Speaking passes the turn on.
   *
   * Rather than waiting for the narrator to answer — which would leave the
   * table staring at a disabled composer for the length of a generation, and
   * would break entirely if the host's copy were closed. This way the next
   * player can be writing while the reply arrives.
   */
  if (turn.on) {
    setTurn(g.share.id, advanceTurn(g.share, g.player.id));
    publishTurn(g.share.id);
  }
  return c.json({ ok: true, message: msg });
});

/**
 * Handing your turn on without using it.
 *
 * Somebody has stepped away from the table, or has nothing to add. Without
 * this, one person in the kitchen stops the game — which is the failure a
 * rotation invites and the reason most tables never enforce one.
 */
api.post("/table/pass", (c) => {
  const g = guestOf(c);
  if (!g) return c.json({ error: "Not a seat at this table." }, 403);
  const turn = turnAt(g.share);
  if (!turn.on) return c.json({ error: "This table is not taking turns." }, 400);
  // Anyone may pass the turn along, not only its holder: the point is a table
  // that cannot stall, and the person who has wandered off is precisely the
  // one who cannot press this.
  setTurn(g.share.id, advanceTurn(g.share, turn.player));
  publishTurn(g.share.id);
  return c.json({ ok: true, turn: turnAt(shareOf(g.share.id)) });
});

/**
 * Making a character at somebody else's table.
 *
 * The same classes, the same roller, the same sheet the host's own character
 * uses — a guest is a player, not a spectator with a name. Stored against
 * their player id rather than a persona, so joining a table does not quietly
 * add rows to the host's persona list, and leaving takes it with them.
 */
api.get("/table/classes", (c) => {
  if (!guestOf(c)) return c.json({ error: "Not a seat at this table." }, 403);
  // The host's classes, including any they wrote — a guest at your table plays
  // your game, not the one that shipped.
  return c.json(kitsOf("class"));
});

api.get("/table/races", (c) => {
  if (!guestOf(c)) return c.json({ error: "Not a seat at this table." }, 403);
  return c.json(kitsOf("race"));
});

api.post("/table/roll-sheet", async (c) => {
  const g = guestOf(c);
  if (!g) return c.json({ error: "Not a seat at this table." }, 403);
  const { klass, how } = await c.req.json().catch(() => ({}));
  const sheet = makeSheet(String(klass ?? ""), how === "array" ? "array" : "roll");
  if (!sheet) return c.json({ error: "No such class." }, 400);
  // Their own id, never one from the request: a guest may write their own
  // character and nobody else's, and the way to guarantee that is to not
  // accept an owner at all.
  saveSheet(g.player.id, "player", sheet);
  publish(g.share.id, "players", { players: playersAt(g.share.id) });
  return c.json({ sheet });
});

api.put("/table/sheet", async (c) => {
  const g = guestOf(c);
  if (!g) return c.json({ error: "Not a seat at this table." }, 403);
  const body = await c.req.json().catch(() => ({}));
  const sheet = normaliseSheet(body.sheet ?? body);
  if (!sheet) return c.json({ error: "That is not a sheet." }, 400);
  saveSheet(g.player.id, "player", sheet);
  publish(g.share.id, "players", { players: playersAt(g.share.id) });
  return c.json({ sheet });
});

/**
 * Your character, carried by you.
 *
 * A seat lives in a cookie, a cookie belongs to one address, and a quick
 * tunnel hands out a new one every time it opens — so the second evening of a
 * campaign the same person on the same phone arrives as a stranger with no
 * character. Accounts would fix it and are the wrong size: passwords, resets
 * and a login screen so that friends can play a game on a machine one of them
 * owns.
 *
 * A passport is the small version. It grants nothing — the invitation is what
 * seats you — it only says what to call you and what your character can do
 * once you are already sitting down. So it can be handed over in the open, and
 * works at anybody's table rather than only at this one.
 */
api.get("/table/passport", (c) => {
  const g = guestOf(c);
  if (!g) return c.json({ error: "Not a seat at this table." }, 403);
  return c.json({
    passport: writePassport({
      id: g.player.id,
      name: g.player.name,
      sheet: sheetFor(g.player.id),
      at: now(),
    }),
  });
});

api.post("/table/passport", async (c) => {
  const g = guestOf(c);
  if (!g) return c.json({ error: "Not a seat at this table." }, 403);
  const { passport } = await c.req.json().catch(() => ({}));
  const p = readPassport(passport);
  if (!p) return c.json({ error: "That is not a passport." }, 400);

  /*
   * The seat this passport came from, if it is still sitting there.
   *
   * A passport is used precisely when somebody has arrived on a new seat — a
   * new address, a new browser — so the old one is the same person and has to
   * go. Left behind it is a ghost at the table holding their name, which then
   * collides with them and turns them into "Dan (2)"; do it twice and the
   * table is a list of empty chairs.
   */
  if (p.id && p.id !== g.player.id) {
    db.query("DELETE FROM players WHERE id = ? AND share_id = ?").run(p.id, g.share.id);
    db.query("DELETE FROM sheets WHERE owner_id = ?").run(p.id);
  }

  const taken = (db.query("SELECT name FROM players WHERE share_id = ? AND id != ?")
    .all(g.share.id, g.player.id) as any[]).map((r) => r.name);
  const name = tidyPlayerName(p.name || g.player.name, taken);
  db.query("UPDATE players SET name = ? WHERE id = ?").run(name, g.player.id);

  /*
   * The sheet is normalised rather than trusted. It arrived as text from
   * somebody's clipboard, which is exactly the shape of thing that turns up
   * with a level of 9e99 in it.
   */
  const sheet = p.sheet ? normaliseSheet(p.sheet) : null;
  if (sheet) saveSheet(g.player.id, "player", sheet);

  publish(g.share.id, "players", { players: playersAt(g.share.id) });
  return c.json({ ok: true, name, sheet });
});

api.post("/table/roll", async (c) => {
  const g = guestOf(c);
  if (!g) return c.json({ error: "Not a seat at this table." }, 403);
  const { notation = "1d20" } = await c.req.json().catch(() => ({}));
  const roll = rollDice(String(notation ?? "1d20"));
  if (!roll) return c.json({ error: "That is not dice." }, 400);
  logRoll(g.share.chat_id, "dice", roll.notation, describeRoll(roll), roll.total, g.player.name);

  const dice = roll.rolls.reduce((x, y) => x + y, 0);
  const thrown = {
    label: roll.notation, total: roll.total, die: dice, modifier: roll.modifier,
    faces: { min: roll.count, max: roll.count * roll.sides },
    parts: [
      { label: `${roll.count}d${roll.sides}`, value: dice },
      ...(roll.modifier ? [{ label: roll.modifier < 0 ? "penalty" : "bonus", value: roll.modifier }] : []),
    ],
  };
  // Everybody at the table watches the same die land, which is most of the
  // point of rolling in company.
  publish(g.share.id, "rolled", { thrown, by: publicPlayer(g.player) });
  return c.json({ ...thrown, text: describeRoll(roll) });
});

/**
 * The table's live feed.
 *
 * One socket per person, fed by the room in share.ts. Everything that happens
 * — a turn, the narrator's reply arriving token by token, a die, somebody
 * joining or leaving — comes down here, so nobody has to poll and nobody sees
 * a different version of the evening.
 */
api.get("/table/live", (c) => {
  const g = guestOf(c);
  if (!g) return c.json({ error: "Not a seat at this table." }, 403);
  const share = g.share;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let alive = true;
      const push = (s: string) => {
        if (!alive) return;
        try { controller.enqueue(enc.encode(s)); } catch { alive = false; }
      };
      const emit = (event: string, data: unknown) =>
        push(`data: ${JSON.stringify({ event, ...(data as object) })}\n\n`);

      emit("hello", tableState(share, g.player));
      const off = subscribe(share.id, emit);
      /*
       * A heartbeat the browser can see, not just one the socket can feel.
       *
       * This used to be an SSE comment — `: keep-alive` — which keeps the
       * connection warm and is invisible to the page: the EventSource parser
       * eats comment lines without firing anything. So a guest had no way to
       * tell a quiet table from a dead socket, and on iOS that difference is
       * the whole feature. Safari suspends and reaps these connections on its
       * own schedule, and the readyState it leaves behind can still say OPEN
       * while nothing will ever arrive again — which looks exactly like a
       * table where nobody is talking, until you reload and find six replies
       * waiting.
       *
       * As an event, the page can time it. See the watchdog in app.js.
       */
      // The same beat says this seat is still filled. See seatOrder.
      const beat = setInterval(() => {
        emit("ping", { at: Date.now() });
        try { db.query("UPDATE players SET seen_at = ? WHERE id = ?").run(now(), g.player.id); } catch {}
      }, 15_000);

      const stop = () => {
        alive = false;
        clearInterval(beat);
        off();
        try { controller.close(); } catch {}
      };
      c.req.raw.signal?.addEventListener("abort", stop);
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
});

/**
 * The door.
 *
 * Someone clicks the link you sent them and this is what happens: the
 * invitation is checked, a seat is made, a token for that seat is set as a
 * cookie, and they are sent to the app, which sees the cookie and runs as a
 * guest. No account, no password, no e-mail — the link *is* the credential,
 * which is why it is 128 bits and why closing the table turns it off.
 *
 * Deliberately outside the gate: nobody arriving here has a token yet, so
 * requiring one would mean nobody could ever get one.
 *
 * A cookie rather than a header, because the live feed is an EventSource and
 * an EventSource cannot send headers. HttpOnly so a stray script on the page
 * cannot read somebody's seat back out. Not `Secure`, because the same link
 * has to work over a plain-http LAN as over an https tunnel, and a cookie that
 * silently fails on half the ways people will use this is worse than one that
 * rides an already-trusted network.
 */
app.get("/join/:token", (c) => {
  const token = c.req.param("token");
  const share = db.query("SELECT * FROM shares WHERE token = ? AND open = 1").get(token) as any;
  if (!share || !sameToken(share.token, token)) {
    return c.html(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Hearth</title><style>body{background:#16110e;color:#e6d8bd;font:16px/1.6 Georgia,serif;` +
      `display:grid;place-items:center;height:100dvh;margin:0;text-align:center;padding:2rem}` +
      `h1{font-size:1.3rem;font-weight:400;letter-spacing:.05em}p{color:#a8937a;max-width:32ch}</style>` +
      `<div><h1>That table has closed.</h1><p>Ask whoever invited you for a fresh link — an old one ` +
      `stops working the moment the table is shut, which is the point of it.</p></div>`,
      410,
    );
  }

  /*
   * Coming back is not the same as arriving. A link opened twice, or reloaded,
   * or followed again the next evening should sit you back in the seat you had
   * rather than filling the table with copies of you.
   */
  const existing = playerToken(c);
  const seated = existing
    ? (db.query("SELECT * FROM players WHERE token = ? AND share_id = ?").get(existing, share.id) as any)
    : null;

  let token2 = seated?.token;
  if (!seated) {
    const taken = (db.query("SELECT name FROM players WHERE share_id = ?").all(share.id) as any[]).map((r) => r.name);
    token2 = newToken();
    db.query(
      "INSERT INTO players (id, share_id, token, name, persona_id, host, seen_at, created_at) VALUES (?,?,?,?,?,0,?,?)",
    ).run(uid(), share.id, token2, tidyPlayerName("", taken), null, now(), now());
    publish(share.id, "players", {
      players: (db.query("SELECT * FROM players WHERE share_id = ? ORDER BY created_at").all(share.id) as any[])
        .map(publicPlayer),
    });
  }

  c.header("set-cookie",
    `${PLAYER_COOKIE}=${encodeURIComponent(token2)}; Path=/; Max-Age=${60 * 60 * 24 * 90}; HttpOnly; SameSite=Lax`);
  return c.redirect("/?at=table", 302);
});

/**
 * Claiming this server as its host, from somewhere that is not this machine.
 *
 * The key is printed on the console when Hearth binds to an address other
 * than loopback, and written beside the database. Both places need access to
 * the machine already, which is the point: the key says "I am the person who
 * started this", and nothing on the network can say that for you.
 *
 * Exchanged once for a cookie so it stops travelling in URLs — where it would
 * sit in history, in logs, and in whatever the browser syncs. HttpOnly, so a
 * bad extension cannot read it back out.
 */
/* ---- pairing a device of your own -------------------------------------------
 *
 * The other way into your own Hearth from another device, for when that
 * device is a computer and the key is thirty-odd characters to type by hand.
 *
 * The phone shows a six-digit code; the computer, arriving at the phone's
 * address with no key, is asked for it; the right code is exchanged for the
 * same cookie /host/:key hands out, and the computer is yours from then on.
 * One code at a time, gone after five minutes, after its first use, or after
 * five wrong guesses — a million codes and five tries is not something to
 * guess your way through, and a code that has been shown once is not a
 * password to keep lying about.
 */
const PAIR_LIFE = 5 * 60 * 1000;
const PAIR_TRIES = 5;
let pairing: { code: string; until: number; tries: number } | null = null;

/** Host only, like everything under /api that guests are not allowed. */
api.post("/pair/start", (c) => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const code = String(buf[0] % 1_000_000).padStart(6, "0");
  pairing = { code, until: now() + PAIR_LIFE, tries: 0 };
  return c.json({ code, until: pairing.until });
});

api.delete("/pair", (c) => {
  pairing = null;
  return c.json({ ok: true });
});

/** Outside /api, because the caller has nothing yet that would get it past the gate. */
app.post("/pair", async (c) => {
  const { code } = await c.req.json().catch(() => ({}));
  const live = pairing && pairing.until > now() ? pairing : null;
  if (!live) {
    pairing = null;
    return c.json({ error: "There is no code waiting. Make a new one on your phone." }, 403);
  }
  if (!sameToken(live.code, String(code ?? "").replace(/\D/g, ""))) {
    live.tries++;
    if (live.tries >= PAIR_TRIES) pairing = null;
    return c.json({ error: live.tries >= PAIR_TRIES
      ? "Too many wrong codes. Make a new one on your phone."
      : "That is not the code." }, 403);
  }
  pairing = null;
  c.header("set-cookie",
    `${HOST_COOKIE}=${encodeURIComponent(hostKey())}; Path=/; Max-Age=${60 * 60 * 24 * 365}; HttpOnly; SameSite=Lax`);
  return c.json({ ok: true });
});

app.get("/host/:key", (c) => {
  const given = String(c.req.param("key") ?? "");
  if (!sameToken(hostKey(), given)) {
    return c.text("That is not this hearth's key.", 403);
  }
  c.header("set-cookie",
    `${HOST_COOKIE}=${encodeURIComponent(given)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; HttpOnly; SameSite=Lax`);
  return c.redirect("/", 302);
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
