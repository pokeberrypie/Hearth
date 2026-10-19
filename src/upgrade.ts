/**
 * Upgrading a library without surprising it.
 *
 * Hearth's migrations have always been additive — new tables, new columns,
 * never a column renamed or a row rewritten — and that is what makes it safe
 * to go back: an older Hearth opening a newer library meets tables and
 * columns it does not know about, and SQLite lets it ignore them. This file
 * holds the two things that keep it that way.
 *
 * The first is a rule, enforced by a test rather than remembered: no
 * migration may drop, rename, update or delete. A change that needs one of
 * those is a change that cannot be undone by reinstalling the old version,
 * and it should have to argue its way past the test.
 *
 * The second is a copy. The first time a newer Hearth opens a library, before
 * it changes a single table, the file as it was is set aside as
 * `hearth.db.before-level-N`. Only the latest is kept: it is a way back from
 * one upgrade, not a history.
 *
 * Pure: opening files and running statements is db.ts's business, and
 * db.mobile.ts's on the phone.
 */

/**
 * Which shape of database this Hearth expects. 0 is every library from before
 * this was counted — 0.2.6 and earlier. Bump it with any migration, so the
 * next launch knows to take its copy first.
 */
export const SCHEMA_LEVEL = 1;

const SNAPSHOT_PREFIX = "hearth.db.before-level-";

export const snapshotName = (level: number) => `${SNAPSHOT_PREFIX}${level}`;

/** Whether a file in the data folder is one of these copies. */
export const isSnapshot = (name: string) => name.startsWith(SNAPSHOT_PREFIX);

/**
 * What to do on opening a library, given the level it was last left at —
 * null for a library that did not exist a moment ago.
 *
 * `newer` is the case of somebody going back: this Hearth is older than the
 * one that last touched the library. Nothing is migrated away from them and
 * the level is not lowered, so the newer version finds its library as it left
 * it when they come back.
 */
export function planOpen(stored: number | null, current = SCHEMA_LEVEL): {
  snapshot: boolean;
  mark: boolean;
  newer: boolean;
} {
  if (stored === null) return { snapshot: false, mark: true, newer: false };
  if (stored > current) return { snapshot: false, mark: false, newer: true };
  const behind = stored < current;
  return { snapshot: behind, mark: behind, newer: false };
}

/** The stored level, read leniently: anything unreadable is a library from before levels. */
export function readLevel(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/** SQL comments, which may say "update" or "drop" in passing and mean nothing by it. */
const uncomment = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const FORBIDDEN: [RegExp, string][] = [
  [/\bDROP\s+(TABLE|INDEX|VIEW|TRIGGER|COLUMN)\b/i, "drops something"],
  [/\bRENAME\b/i, "renames something"],
  [/\bUPDATE\s+[\w"]+\s+SET\b/i, "rewrites rows"],
  [/\bDELETE\s+FROM\b/i, "deletes rows"],
];

/**
 * Every statement in the migrations that an older Hearth could not live
 * with, and why. The test suite asserts this is empty.
 */
export function migrationProblems(statements: string[]): string[] {
  const problems: string[] = [];
  for (const stmt of statements) {
    const sql = uncomment(stmt);
    for (const [re, why] of FORBIDDEN) {
      if (re.test(sql)) problems.push(`${why}: ${sql.trim().replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  return problems;
}
