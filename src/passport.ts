/**
 * A passport: who you are at somebody else's table, carried by you.
 *
 * The problem it solves is small and very annoying. A seat lives in a cookie,
 * a cookie belongs to one address, and a quick tunnel hands out a new address
 * every time it opens — so the second evening of a campaign, the same person
 * on the same phone turns up as a stranger with no character. Play across two
 * different people's servers and it happens even sooner.
 *
 * The obvious answer is accounts, and it is the wrong size. Accounts mean
 * passwords, storage, resets and a login screen, all so that friends can play
 * a game on a machine one of them owns. What is actually needed is only that
 * your character comes with you.
 *
 * So: a passport. Your name and your sheet, encoded into something you can
 * copy, paste into any Hearth table anywhere, and get yourself back. No server
 * stores anything about you, nothing has to be logged into, and it works
 * across addresses and across hosts for the same reason — the host was never
 * where it lived.
 *
 * ## Why it is not signed, on purpose
 *
 * A passport is not a credential and must never be treated as one. It grants
 * nothing: a seat at a table is granted by the invitation, and this only says
 * what to call you and what your character can do once you are already sitting
 * down. Signing it would suggest it means more than it does — and the thing it
 * would protect against, somebody claiming to be called Dan, is not an attack.
 * The table can see who is there.
 */

export type Passport = {
  /** Yours, for as long as you keep it. Only used to notice it is still you. */
  id: string;
  name: string;
  /** Whatever the sheet was, or null for somebody who has not made one. */
  sheet: unknown | null;
  /** When it was written, so an older copy can be spotted. */
  at: number;
};

const MAGIC = "hearth1";

/** base64url, so a passport survives being pasted into anything. */
function toB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64(s: string): string {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
  const bytes = new Uint8Array([...bin].map((ch) => ch.charCodeAt(0)));
  return new TextDecoder().decode(bytes);
}

/**
 * Written with its own name on the front.
 *
 * The prefix is not decoration: people paste all sorts of things into a box
 * labelled "paste your passport", and a decoder that will have a go at
 * anything gives you a character called `{"foo":` rather than an error.
 */
export function writePassport(p: Passport): string {
  return `${MAGIC}.${toB64(JSON.stringify({
    id: String(p.id ?? ""),
    name: String(p.name ?? ""),
    sheet: p.sheet ?? null,
    at: Number(p.at) || Date.now(),
  }))}`;
}

/** Reads one back, or returns null rather than throwing at the caller. */
export function readPassport(text: unknown): Passport | null {
  const raw = String(text ?? "").trim();
  if (!raw.startsWith(`${MAGIC}.`)) return null;
  try {
    const body = JSON.parse(fromB64(raw.slice(MAGIC.length + 1)));
    if (!body || typeof body !== "object") return null;
    const name = String(body.name ?? "").trim().slice(0, 40);
    const id = String(body.id ?? "").trim().slice(0, 64);
    if (!id) return null;
    return { id, name, sheet: body.sheet ?? null, at: Number(body.at) || 0 };
  } catch {
    return null;
  }
}
