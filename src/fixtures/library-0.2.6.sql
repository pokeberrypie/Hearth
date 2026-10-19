-- A Hearth 0.2.6 library, frozen. Built from 0.2.6's own schema by a one-off script;
-- never regenerate it from a newer schema, or it stops being a 0.2.6 library.
-- See src/upgrade.test.ts.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE characters (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  personality   TEXT NOT NULL DEFAULT '',
  scenario      TEXT NOT NULL DEFAULT '',
  first_message TEXT NOT NULL DEFAULT '',
  avatar        TEXT,
  created_at    INTEGER NOT NULL
, mes_example TEXT NOT NULL DEFAULT '', system_prompt TEXT NOT NULL DEFAULT '', post_history TEXT NOT NULL DEFAULT '', alternate_greetings TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]', creator TEXT NOT NULL DEFAULT '', raw_card TEXT NOT NULL DEFAULT '', deleted_at INTEGER, default_persona_id TEXT, world TEXT NOT NULL DEFAULT 'story');
CREATE TABLE chats (
  id           TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  title        TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
, deleted_at INTEGER, parent_chat_id TEXT, branch_note TEXT NOT NULL DEFAULT '', author_note TEXT NOT NULL DEFAULT '', note_depth INTEGER NOT NULL DEFAULT 2, wallpaper TEXT NOT NULL DEFAULT '', persona_id TEXT, is_group INTEGER NOT NULL DEFAULT 0, auto_reply INTEGER NOT NULL DEFAULT 0, scenario TEXT NOT NULL DEFAULT '', auto_lore_book_id TEXT, auto_lore_asked INTEGER NOT NULL DEFAULT 0, auto_lore_at INTEGER NOT NULL DEFAULT 0, location TEXT NOT NULL DEFAULT '', fight TEXT NOT NULL DEFAULT '', campaign TEXT NOT NULL DEFAULT '', campaign_asked INTEGER NOT NULL DEFAULT 0, accent TEXT NOT NULL DEFAULT '', ambience TEXT NOT NULL DEFAULT '', apocrypha TEXT NOT NULL DEFAULT '');
CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
, swipes TEXT NOT NULL DEFAULT '[]', swipe_index INTEGER NOT NULL DEFAULT 0, reasoning TEXT NOT NULL DEFAULT '', tokens INTEGER NOT NULL DEFAULT 0, ms INTEGER NOT NULL DEFAULT 0, character_id TEXT);
CREATE TABLE personas (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar      TEXT,
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
, deleted_at INTEGER, world TEXT NOT NULL DEFAULT 'story');
CREATE TABLE presets (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}',
  is_active  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
, deleted_at INTEGER);
CREATE TABLE lorebooks (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  entries    TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
, world TEXT NOT NULL DEFAULT 'story', deleted_at INTEGER);
CREATE TABLE regex_scripts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  script     TEXT NOT NULL DEFAULT '{}',
  enabled    INTEGER NOT NULL DEFAULT 1,
  source     TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
, preset_id TEXT);
CREATE TABLE extensions (
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
CREATE TABLE sheets (
  owner_id   TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL DEFAULT 'persona',
  sheet      TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
CREATE TABLE npcs (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  brief      TEXT NOT NULL DEFAULT '',
  avatar     TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE rolls (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'dice',
  label      TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  total      INTEGER NOT NULL DEFAULT 0,
  who        TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE lorebook_links (
  id        TEXT PRIMARY KEY,
  book_id   TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
  scope     TEXT NOT NULL,        -- global | character | chat
  target_id TEXT
);
CREATE TABLE apocrypha (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  premise    TEXT NOT NULL DEFAULT '',
  chapters   TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE chat_members (
  id           TEXT PRIMARY KEY,
  chat_id      TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  muted        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE shares (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL DEFAULT '',
  open       INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
, taking_turns INTEGER NOT NULL DEFAULT 0, turn_player_id TEXT);
CREATE TABLE players (
  id         TEXT PRIMARY KEY,
  share_id   TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL DEFAULT '',
  persona_id TEXT,
  host       INTEGER NOT NULL DEFAULT 0,
  seen_at    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE kits (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'class',
  name       TEXT NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}',
  builtin    INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
INSERT INTO "settings" ("key", "value") VALUES ('provider', 'openrouter');
INSERT INTO "settings" ("key", "value") VALUES ('model', 'z-ai/glm-4.6');
INSERT INTO "settings" ("key", "value") VALUES ('auto_lore_every', '20');
INSERT INTO "characters" ("id", "name", "description", "personality", "scenario", "first_message", "avatar", "created_at", "mes_example", "system_prompt", "post_history", "alternate_greetings", "tags", "creator", "raw_card", "deleted_at", "default_persona_id", "world") VALUES ('c-loras', 'Loras Tyrell', 'Knight of Flowers', 'proud', 'The Red Keep', 'He came through the door at speed.', NULL, 1790000000000, '', '', '', '[]', '[]', '', '', NULL, NULL, 'story');
INSERT INTO "characters" ("id", "name", "description", "personality", "scenario", "first_message", "avatar", "created_at", "mes_example", "system_prompt", "post_history", "alternate_greetings", "tags", "creator", "raw_card", "deleted_at", "default_persona_id", "world") VALUES ('c-jaime', 'Jaime Lannister', 'Kingsguard', '', '', '', NULL, 1790000000000, '', '', '', '[]', '[]', '', '', NULL, NULL, 'story');
INSERT INTO "chats" ("id", "character_id", "title", "created_at", "updated_at", "deleted_at", "parent_chat_id", "branch_note", "author_note", "note_depth", "wallpaper", "persona_id", "is_group", "auto_reply", "scenario", "auto_lore_book_id", "auto_lore_asked", "auto_lore_at", "location", "fight", "campaign", "campaign_asked", "accent", "ambience", "apocrypha") VALUES ('chat-main', 'c-loras', 'The Champion of the Hand', 1790000000000, 1790000005000, NULL, NULL, '', '', 2, 'hall.jpg', NULL, 1, 0, '', 'b-notes', 1, 1790000003000, '', '', '', 0, '#c8994f', '', '{"book":"a-lion","scene":"s7","done":[],"skipped":[]}');
INSERT INTO "chats" ("id", "character_id", "title", "created_at", "updated_at", "deleted_at", "parent_chat_id", "branch_note", "author_note", "note_depth", "wallpaper", "persona_id", "is_group", "auto_reply", "scenario", "auto_lore_book_id", "auto_lore_asked", "auto_lore_at", "location", "fight", "campaign", "campaign_asked", "accent", "ambience", "apocrypha") VALUES ('chat-branch', 'c-loras', 'The Champion of the Hand — branch', 1790000006000, 1790000007000, NULL, 'chat-main', 'He came through', '', 2, '', NULL, 1, 0, '', 'b-notes', 1, 1790000003000, '', '', '', 0, '', '', '{"book":"a-lion","scene":"s7","done":[],"skipped":[]}');
INSERT INTO "messages" ("id", "chat_id", "role", "name", "content", "created_at", "swipes", "swipe_index", "reasoning", "tokens", "ms", "character_id") VALUES ('chat-main-m0', 'chat-main', 'assistant', 'Loras Tyrell', 'He stopped dead two steps inside.', 1790000001000, '[]', 0, '', 0, 0, 'c-loras');
INSERT INTO "messages" ("id", "chat_id", "role", "name", "content", "created_at", "swipes", "swipe_index", "reasoning", "tokens", "ms", "character_id") VALUES ('chat-main-m1', 'chat-main', 'user', 'Yvenna', '"Well?" Yvenna laughed.', 1790000002000, '[]', 0, '', 0, 0, NULL);
INSERT INTO "messages" ("id", "chat_id", "role", "name", "content", "created_at", "swipes", "swipe_index", "reasoning", "tokens", "ms", "character_id") VALUES ('chat-main-m2', 'chat-main', 'assistant', 'Loras Tyrell', 'He stopped dead two steps inside.', 1790000003000, '["a","b"]', 0, '', 0, 0, 'c-loras');
INSERT INTO "messages" ("id", "chat_id", "role", "name", "content", "created_at", "swipes", "swipe_index", "reasoning", "tokens", "ms", "character_id") VALUES ('chat-branch-m0', 'chat-branch', 'assistant', 'Loras Tyrell', 'He stopped dead two steps inside.', 1790000001000, '[]', 0, '', 0, 0, 'c-loras');
INSERT INTO "personas" ("id", "name", "description", "avatar", "is_active", "created_at", "deleted_at", "world") VALUES ('p-yvenna', 'Yvenna Hightower', 'A bride with opinions', NULL, 0, 1790000000000, NULL, 'story');
INSERT INTO "lorebooks" ("id", "name", "entries", "created_at", "world", "deleted_at") VALUES ('b-world', 'The Seven Kingdoms', '[{"id":"e1","keys":["Red Keep"],"content":"The royal castle.","comment":"Red Keep","enabled":true}]', 1790000000000, 'story', NULL);
INSERT INTO "lorebooks" ("id", "name", "entries", "created_at", "world", "deleted_at") VALUES ('b-notes', 'Notes: The Champion of the Hand', '[{"id":"n1","keys":["Jaime","Yvenna"],"content":"Jaime affirmed the betrothal.","comment":"Betrothal","order":200}]', 1790000000000, 'story', NULL);
INSERT INTO "npcs" ("id", "chat_id", "name", "brief", "avatar", "created_at", "deleted_at") VALUES ('n-melda', 'chat-main', 'Melda', 'barkeep', NULL, 1790000000000, NULL);
INSERT INTO "lorebook_links" ("id", "book_id", "scope", "target_id") VALUES ('l1', 'b-world', 'chat', 'chat-main');
INSERT INTO "apocrypha" ("id", "name", "premise", "chapters", "created_at", "updated_at") VALUES ('a-lion', 'The Champion of the Hand', 'A marriage on his own terms.', '[{"id":"c3","title":"The Lion''s Bargain","summary":"","scenes":[{"id":"s7","title":"The Contract","setting":"Tywin''s solar","cast":"","purpose":"","beats":"","ending":""}]}]', 1790000000000, 1790000000000);
INSERT INTO "chat_members" ("id", "chat_id", "character_id", "position", "muted") VALUES ('chat-main-c-loras', 'chat-main', 'c-loras', 0, 0);
INSERT INTO "chat_members" ("id", "chat_id", "character_id", "position", "muted") VALUES ('chat-main-c-jaime', 'chat-main', 'c-jaime', 1, 0);
INSERT INTO "chat_members" ("id", "chat_id", "character_id", "position", "muted") VALUES ('chat-branch-c-loras', 'chat-branch', 'c-loras', 0, 0);
INSERT INTO "chat_members" ("id", "chat_id", "character_id", "position", "muted") VALUES ('chat-branch-c-jaime', 'chat-branch', 'c-jaime', 1, 0);
CREATE INDEX idx_npcs_chat ON npcs(chat_id, created_at);
CREATE INDEX idx_rolls_chat ON rolls(chat_id, created_at);
CREATE INDEX idx_links_book ON lorebook_links(book_id);
CREATE INDEX idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX idx_chats_character ON chats(character_id, updated_at);
CREATE INDEX idx_members_chat ON chat_members(chat_id, position);
CREATE INDEX idx_shares_chat ON shares(chat_id);
CREATE INDEX idx_players_share ON players(share_id, seen_at);
CREATE INDEX idx_kits_kind ON kits(kind, position, created_at);
