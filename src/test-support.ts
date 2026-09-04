/**
 * One throwaway database for the whole test run.
 *
 * `bun test` loads every test file into a single process, so `db.ts` is
 * evaluated once and whichever file imports it first decides where the data
 * lives. This settles that before anything else can.
 *
 * The directory is fixed rather than random, and cleared on the way in rather
 * than on the way out: an exit hook cannot reliably delete a SQLite file that
 * Windows still has open, and a run that leaves a few megabytes of write-ahead
 * log in the temp folder every time is its own small bug.
 *
 * DATA_DIR is written, never read, so a real DATA_DIR in the environment can
 * never be pointed at by a test run.
 */

import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TEST_DIR = join(tmpdir(), "hearth-test-data");

if (!process.env.HEARTH_TEST_DIR) {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.HEARTH_TEST_DIR = TEST_DIR;
}
process.env.DATA_DIR = TEST_DIR;

// Dynamic, so DATA_DIR above is already set when db.ts first runs.
const dbModule = await import("./db");
export const { db, setSettings, getSettings } = dbModule;

/** Empties every table so one test cannot colour the next. */
export function wipe() {
  for (const t of [
    // Before chats, which they hang off: relying on the cascade would make
    // this depend on a pragma rather than on what it says.
    "npcs", "sheets",
    "chat_members", "messages", "chats", "characters", "personas",
    "presets", "lorebooks", "lorebook_links", "settings",
    // Extensions run code during generation, so one left behind by an earlier
    // test would quietly rewrite a later test's reply.
    "extensions", "regex_scripts",
  ]) {
    db.query(`DELETE FROM ${t}`).run();
  }
}
