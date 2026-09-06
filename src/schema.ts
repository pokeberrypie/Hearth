/**
 * The database schema, migrations, and settings defaults — engine-agnostic.
 *
 * `db.ts` (desktop, `bun:sqlite`) and `mobile/server/db.mobile.ts` (Android,
 * sql.js) both apply exactly this, through their own connection. Nothing
 * platform-specific lives here; if the two ever run different migrations
 * against the same export/import, that is how a backup silently stops
 * opening on the other platform.
 */

export const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  personality   TEXT NOT NULL DEFAULT '',
  scenario      TEXT NOT NULL DEFAULT '',
  first_message TEXT NOT NULL DEFAULT '',
  avatar        TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id           TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  title        TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS personas (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar      TEXT,
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS presets (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}',
  is_active  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lorebooks (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  entries    TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

-- SillyTavern regex scripts: find/replace over message text, applied to what
-- is sent, to what is shown, or to both. See src/regex.ts. The script column
-- holds the whole normalised object; only what the list and the query need is
-- pulled out beside it, so a future field costs no migration.
-- (No backticks in here: this whole block is a TypeScript template literal.)
CREATE TABLE IF NOT EXISTS regex_scripts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  script     TEXT NOT NULL DEFAULT '{}',
  enabled    INTEGER NOT NULL DEFAULT 1,
  source     TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

-- Extensions: other people's code, in two halves. The client half runs in the
-- page, the server half runs beside the prompt pipeline. Either may be empty.
-- (No backticks in here: this whole block is a TypeScript template literal.)
-- Stored rather
-- than kept in a folder for the same reason lorebooks and regex scripts are —
-- a phone has no comfortable filesystem, and everything else you can add to
-- Hearth is managed the same way. See src/extensions.ts.
CREATE TABLE IF NOT EXISTS extensions (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  version     TEXT NOT NULL DEFAULT '0.0.0',
  description TEXT NOT NULL DEFAULT '',
  enabled     INTEGER NOT NULL DEFAULT 1,
  client      TEXT NOT NULL DEFAULT '',
  server      TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

-- A character sheet, for tabletop mode. Keyed by whoever it belongs to: a
-- persona (the player) or a character (an NPC the narrator made). One row per
-- owner, the sheet itself kept as JSON because it is read and written whole
-- and never queried into. See src/tabletop.ts.
CREATE TABLE IF NOT EXISTS sheets (
  owner_id   TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL DEFAULT 'persona',
  sheet      TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

-- People the narrator made up, in tabletop mode. Not characters: a character
-- is something you start a chat with, and putting every innkeeper the DM
-- invents into a library of hand-made cards would bury it. These belong to
-- the game they appeared in, go into its prompt so the narrator remembers who
-- is standing there, and leave with the chat. See src/verbs.ts.
-- (No backticks in here: this whole block is a TypeScript template literal.)
CREATE TABLE IF NOT EXISTS npcs (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  brief      TEXT NOT NULL DEFAULT '',
  avatar     TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

-- Every roll this game has made, in order. Tables keep one of these, and it
-- is the only proof a player has that the dice were not decided by whoever is
-- narrating. Rows, not JSON on the chat: a log is appended to and read back in
-- order, which is what a table is for. See src/index.ts.
-- (No backticks in here: this whole block is a TypeScript template literal.)
CREATE TABLE IF NOT EXISTS rolls (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'dice',
  label      TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  total      INTEGER NOT NULL DEFAULT 0,
  who        TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lorebook_links (
  id        TEXT PRIMARY KEY,
  book_id   TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
  scope     TEXT NOT NULL,        -- global | character | chat
  target_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_npcs_chat ON npcs(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rolls_chat ON rolls(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_links_book ON lorebook_links(book_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chats_character ON chats(character_id, updated_at);
`;

/** `ALTER TABLE` statements, applied in order, each ignored if it already ran. */
export const ALTER_TABLES: string[] = [
  ...[
    "mes_example TEXT NOT NULL DEFAULT ''",
    "system_prompt TEXT NOT NULL DEFAULT ''",
    "post_history TEXT NOT NULL DEFAULT ''",
    "alternate_greetings TEXT NOT NULL DEFAULT '[]'",
    "tags TEXT NOT NULL DEFAULT '[]'",
    "creator TEXT NOT NULL DEFAULT ''",
    "raw_card TEXT NOT NULL DEFAULT ''",
  ].map((col) => `ALTER TABLE characters ADD COLUMN ${col}`),

  // Soft deletion: rows are hidden, not destroyed, so anything can come back.
  ...["characters", "chats", "personas", "presets"].map(
    (t) => `ALTER TABLE ${t} ADD COLUMN deleted_at INTEGER`,
  ),

  ...[
    "parent_chat_id TEXT",
    "branch_note TEXT NOT NULL DEFAULT ''",
    "author_note TEXT NOT NULL DEFAULT ''",
    "note_depth INTEGER NOT NULL DEFAULT 2",
    "wallpaper TEXT NOT NULL DEFAULT ''",
    "persona_id TEXT",
  ].map((col) => `ALTER TABLE chats ADD COLUMN ${col}`),

  "ALTER TABLE characters ADD COLUMN default_persona_id TEXT",

  /*
   * Which side of the door a character lives on: 'story', 'tabletop', or
   * 'both'.
   *
   * Everything that already exists defaults to 'story', which is the whole
   * point — walking into tabletop mode should not hand you your entire
   * library of hand-made cards as though they had all agreed to play D&D.
   * They come over one at a time, when asked. See worldWhere() in index.ts.
   */
  "ALTER TABLE characters ADD COLUMN world TEXT NOT NULL DEFAULT 'story'",
  // And the same for personas: who you are at the table is not necessarily
  // who you are in your stories, and a mode that arrived already wearing one
  // of your personas has decided something personal on your behalf.
  "ALTER TABLE personas ADD COLUMN world TEXT NOT NULL DEFAULT 'story'",
  // And books. A world you built for a story is not automatically the world
  // the game is set in, and a shelf that shows both is a shelf you have to
  // read twice every time you link one.
  "ALTER TABLE lorebooks ADD COLUMN world TEXT NOT NULL DEFAULT 'story'",
  "ALTER TABLE lorebooks ADD COLUMN deleted_at INTEGER",

  ...[
    "swipes TEXT NOT NULL DEFAULT '[]'",
    "swipe_index INTEGER NOT NULL DEFAULT 0",
    "reasoning TEXT NOT NULL DEFAULT ''",
    "tokens INTEGER NOT NULL DEFAULT 0",
    "ms INTEGER NOT NULL DEFAULT 0",
  ].map((col) => `ALTER TABLE messages ADD COLUMN ${col}`),

  ...[
    "is_group INTEGER NOT NULL DEFAULT 0",
    "auto_reply INTEGER NOT NULL DEFAULT 0",
    // A group's shared premise. Overrides each speaker's own `scenario` field
    // while it is set, since in a group the scene belongs to the room, not to
    // whichever character is answering.
    "scenario TEXT NOT NULL DEFAULT ''",
  ].map((col) => `ALTER TABLE chats ADD COLUMN ${col}`),

  // Which member said it, so a reply can be traced back to a character rather
  // than matched by name.
  "ALTER TABLE messages ADD COLUMN character_id TEXT",

  ...[
    // Where this chat's own notes are filed. Null means it has not been
    // decided; a chat that was asked and declined has `asked` set and this
    // left null, which is how "no thanks" is remembered without a third state.
    "auto_lore_book_id TEXT",
    "auto_lore_asked INTEGER NOT NULL DEFAULT 0",
    // created_at of the last message the previous note covered.
    "auto_lore_at INTEGER NOT NULL DEFAULT 0",
  ].map((col) => `ALTER TABLE chats ADD COLUMN ${col}`),

  // Where the party currently is, in tabletop mode — set by the narrator's
  // own [[scene: ...]] and read back into every prompt after, so a story that
  // walked to the mill three messages ago is still at the mill.
  "ALTER TABLE chats ADD COLUMN location TEXT NOT NULL DEFAULT ''",

  // The fight currently happening, as JSON, or empty for the usual case of
  // none. Read and written whole and never queried into, exactly like a
  // sheet — and belonging to the chat, because two games can be mid-fight at
  // once and neither is the other's. See src/fight.ts.
  "ALTER TABLE chats ADD COLUMN fight TEXT NOT NULL DEFAULT ''",

  // What this game is about, as JSON, or empty for a chat that was never
  // asked or said no thanks. `campaign_asked` is the difference between those
  // two, exactly as auto_lore_asked is for the memory book. See
  // src/campaigns.ts.
  "ALTER TABLE chats ADD COLUMN campaign TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE chats ADD COLUMN campaign_asked INTEGER NOT NULL DEFAULT 0",

  // A room of its own. The wallpaper was already per-chat; these are the rest
  // of what makes one story feel unlike the next — the colour everything gilt
  // is drawn in, and what the room sounds like. Both empty means "follow the
  // global look", which is what every chat that already exists wants.
  "ALTER TABLE chats ADD COLUMN accent TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE chats ADD COLUMN ambience TEXT NOT NULL DEFAULT ''",
];

/** Group chats. A chat keeps its `character_id` as the one it was started
 *  from, so every existing chat and every query that joins on it still
 *  works; members are additive on top. */
/**
 * Playing together, over any distance.
 *
 * A share is one chat opened to other people. A player is somebody sitting at
 * it. Both carry a token, and the difference between them is the whole
 * security model:
 *
 * - the share's token is the invitation. It goes in the link you send, it is
 *   128 bits of randomness because that link is going across the open
 *   internet, and it can be revoked by closing the share.
 * - a player's token is issued once, when they join, and is theirs. It is what
 *   every later request carries, so revoking one person does not turn out the
 *   lights for everybody.
 *
 * Neither token is a login. Hearth has no accounts and is not growing any.
 * What they are is a capability: this token may see this chat, act in it, and
 * nothing else in the library — no keys, no other chats, no settings. That
 * boundary is enforced in one place (see guestScope in index.ts) rather than
 * remembered at each route, because a boundary you have to remember is a
 * boundary you will forget once and only need to forget once.
 */
/**
 * Classes and races, including the ones that shipped.
 *
 * Both in one table because they are the same shape of thing — a name, a line
 * about what it is for, and a few mechanical facts — and keeping them apart
 * would mean writing import, export, listing and validation twice with a
 * subtle difference between them.
 *
 * The built-ins are seeded into this table on first run rather than living
 * only in code, so that everything the game offers you comes from one place
 * and a built-in you have edited stays edited. The flag exists to warn before
 * deleting one and for nothing else.
 */
export const CREATE_KITS = `
CREATE TABLE IF NOT EXISTS kits (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'class',
  name       TEXT NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}',
  builtin    INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_kits_kind ON kits(kind, position, created_at);
`;

export const CREATE_SHARES = `
CREATE TABLE IF NOT EXISTS shares (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL DEFAULT '',
  open       INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,
  share_id   TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL DEFAULT '',
  persona_id TEXT,
  host       INTEGER NOT NULL DEFAULT 0,
  seen_at    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shares_chat ON shares(chat_id);
CREATE INDEX IF NOT EXISTS idx_players_share ON players(share_id, seen_at);
`;

export const CREATE_CHAT_MEMBERS = `
CREATE TABLE IF NOT EXISTS chat_members (
  id           TEXT PRIMARY KEY,
  chat_id      TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  muted        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_members_chat ON chat_members(chat_id, position);
`;

export const DEFAULTS: Record<string, string> = {
  provider: "openrouter",
  model: "anthropic/claude-sonnet-4.5",
  key_openrouter: "",
  key_nanogpt: "",
  key_google: "",
  key_anthropic: "",
  /*
   * Anywhere this list does not name: a relay, a proxy, or something running
   * on this machine. The address and the dialect it speaks are settings rather
   * than code, because the whole point is the ones nobody thought of.
   */
  key_custom: "",
  custom_base: "",
  custom_format: "openai",
  // Faces in page mode. Off, so nobody's reading view changes under them.
  page_faces: "0",
  tabletop_difficulty: "faircount",
  // The room following the story. Off: it changes what you are looking at.
  scene_follows: "0",
  persona_name: "You",
  persona_description: "",

  // sampling
  temperature: "1.0",
  max_tokens: "1200",
  // How much of the transcript to send, in tokens. Was a message count,
  // which is only a proxy for what actually costs money and overflows.
  context_tokens: "16000",
  top_p: "1.0",
  min_p: "0",
  repetition_penalty: "1.0",
  frequency_penalty: "0",
  presence_penalty: "0",
  // "1" streams the reply token by token; "0" waits and shows it all at once.
  stream: "1",
  /**
   * How hard a reasoning model should think before answering: "" leaves the
   * decision to the model (and sends nothing), "off" asks for no reasoning at
   * all, and minimal/low/medium/high map onto whatever each provider calls it.
   */
  reasoning_effort: "",

  // appearance
  wallpaper: "",
  message_style: "banner",
  banner_width: "150",
  bleed: "1",
  measure: "40",
  fade_start: "55",
  plate_blur: "14",
  plate_opacity: "0.78",
  tuck: "0.08",
  show_stats: "1",
  /** Tells every character the dice notation. Off: see assemble() for why. */
  dice_enabled: "0",
  /** "story" or "tabletop". See src/tabletop.ts and the door in app.js. */
  mode: "story",
  /**
   * Alternates allowed per reply at the table, on top of the first one. Ten
   * is the ceiling; zero means what happened, happened. Story mode ignores
   * this entirely — see the guard in generate for why a game is different.
   */
  tabletop_swipes: "3",
  /**
   * Whether a played turn can be rewritten or removed at the table. Off, so
   * what happened happened; see editsLocked() in index.ts for why deleting is
   * closed alongside editing rather than on its own.
   */
  tabletop_edits: "0",
  /**
   * Whether the table runs on its own built-in preset rather than whichever
   * of yours is active. On: a preset asking for four hundred words of
   * cinematic prose is the wrong opinion for a game. See src/tablepreset.ts.
   */
  tabletop_preset: "1",
  /**
   * Who you are at the table. Kept here rather than as another is_active flag
   * on the row, so activating a persona for a game cannot deactivate the one
   * your stories have been using for a year.
   */
  tabletop_persona: "",
  /** The line marking where the conversation stops being sent. */
  show_cutoff: "0",
  /** A quill scratching as a reply is written. Off until asked for. */
  sound: "0",
  /** Whatever the owner of this copy wants to add to the stylesheet. */
  custom_css: "",
  confirm_deletes: "1",
  default_author_note: "",
  use_default_note: "1",
  lore_scan_depth: "4",
  /** How many messages between the notes a chat takes on itself. 0 is off. */
  auto_lore_every: "20",
  /** "since" the last note, or a "window" of the last `auto_lore_every`. */
  auto_lore_scope: "since",
  lore_budget: "8000",
  radius: "10",
  avatar_size: "56",
  overlay_opacity: "0.72",
  glow_opacity: "0.20",
  font_scale: "1",
  theme_vars: "{}",
};

export const KEY_FIELDS = ["key_openrouter", "key_nanogpt", "key_google", "key_anthropic",
  "key_custom"];
