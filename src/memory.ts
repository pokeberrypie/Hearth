/**
 * What the server holds in memory between requests, by chat — who is in the scene, a day under way, the window a
 * story is sent in — gathered so it can all be let go at once.
 *
 * Only tests do: each wipes the database, and a reading or a lock kept from the test before, for a chat with the same
 * id, would answer for the next (a day still "under way" from a test that had ended had the next file's days skipped).
 * Work still in flight is stopped, not just forgotten: left running, it writes into whatever test comes after it.
 */
const held: (() => void)[] = [];

/** A map or set held for the life of the server; given back as it is. */
export function held_<T extends { clear(): void }>(m: T, stop?: (m: T) => void): T {
  held.push(() => { try { stop?.(m); } catch { /* already stopped */ } m.clear(); });
  return m;
}

/** Everything held, stopped and let go. */
export function forgetAll() {
  for (const f of held) f();
}
