/**
 * Playing together, over any distance.
 *
 * Hearth is one person's program running on one person's machine, and every
 * decision in it assumes that: no accounts, no login, bound to loopback, the
 * API keys sitting in the same database as the chats. Opening a chat to a
 * friend in another country means putting that program on the open internet,
 * which is a different thing entirely, and this file is where the difference
 * is made safe.
 *
 * Three ideas, and the whole of multiplayer is built out of them.
 *
 * A **share** is one chat opened to other people. It carries a token, and that
 * token is the invitation — it goes in the link you send. Closing the share
 * revokes it.
 *
 * A **player** is somebody sitting at the share. They get their own token when
 * they join, so that removing one person does not turn the lights out for
 * everybody, and so the transcript can say who did what.
 *
 * A **scope** is what a token is allowed to touch. This is the important one.
 * A guest token does not mean "logged in"; it means "may see this one chat and
 * act in it". It cannot read a key, list the cast, open another chat, change a
 * setting or import a thing. That is decided here, once, rather than
 * remembered at each route — a boundary you have to remember at forty call
 * sites is a boundary you only have to forget once.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";

export type Share = {
  id: string;
  chat_id: string;
  token: string;
  name: string;
  open: boolean;
  created_at: number;
};

export type Player = {
  id: string;
  share_id: string;
  token: string;
  name: string;
  persona_id: string | null;
  host: boolean;
  seen_at: number;
  created_at: number;
};

/**
 * 128 bits, from the platform's cryptographic source.
 *
 * Not `Math.random()`, and not a six-digit room code. A short code is fine
 * for a projector in a classroom, where guessing it gets you into a room with
 * a teacher in it. This link is reachable from anywhere on earth and the thing
 * behind it is somebody's whole evening; the only reason not to guess it has
 * to be that guessing it is not possible.
 */
export function newToken(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Compare two tokens without leaking, through timing, how much of one matched.
 *
 * Probably unnecessary — the tokens are long and the attack is fiddly over a
 * network — but "probably unnecessary" is how the comparison ends up being a
 * plain `===` in the one place it turns out to matter.
 */
export function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length || x.length === 0) return false;
  return timingSafeEqual(x, y);
}

/** What a caller is allowed to be. */
export type Scope =
  /** Loopback, or the machine Hearth is running on: the whole program. */
  | { kind: "host" }
  /** A guest at one share: that chat, and nothing else in the library. */
  | { kind: "guest"; share: Share; player: Player }
  /** Neither. */
  | { kind: "denied"; why: string };

/**
 * The paths a guest may reach, and no others.
 *
 * Written as an allow list rather than a deny list, because the failure modes
 * are not symmetrical: forgetting to allow something makes a feature not work
 * and somebody complains, and forgetting to deny something hands a stranger
 * an API key and nobody says a word.
 *
 * Every entry is scoped to the share's own chat as well — see `guestMayTouch`,
 * which is the half that stops a guest at one table reading another.
 */
const GUEST_ROUTES: { method: string; re: RegExp }[] = [
  // The table itself: who is here, what has been said, what happens next.
  { method: "GET",  re: /^\/api\/table\/state$/ },
  { method: "GET",  re: /^\/api\/table\/live$/ },
  { method: "POST", re: /^\/api\/table\/say$/ },
  { method: "POST", re: /^\/api\/table\/roll$/ },
  { method: "POST", re: /^\/api\/table\/leave$/ },
  // Who they are playing, and their own sheet. A guest may write their own
  // character and nobody else's; the id is checked against their player row.
  { method: "GET",  re: /^\/api\/table\/me$/ },
  { method: "PUT",  re: /^\/api\/table\/me$/ },
  // Making one. The class list is the same one the host picks from, and is
  // not private — it is the rules, not anybody's data.
  { method: "GET",  re: /^\/api\/table\/classes$/ },
  { method: "GET",  re: /^\/api\/table\/races$/ },
  { method: "POST", re: /^\/api\/table\/roll-sheet$/ },
  { method: "PUT",  re: /^\/api\/table\/sheet$/ },
  // Your character, to carry away or to bring with you.
  { method: "GET",  re: /^\/api\/table\/passport$/ },
  { method: "POST", re: /^\/api\/table\/passport$/ },
];

/** Whether a guest may make this request at all. */
export function guestMayTouch(method: string, path: string): boolean {
  const m = String(method ?? "").toUpperCase();
  const p = String(path ?? "").split("?")[0];
  return GUEST_ROUTES.some((r) => r.method === m && r.re.test(p));
}

/**
 * Is this request coming from the machine Hearth is running on?
 *
 * Everything that is not a guest request has to be, or multiplayer would mean
 * "anyone who finds the tunnel gets the keys". IPv4 loopback, IPv6 loopback,
 * and the IPv4-mapped form of it, which is what Node hands you on a dual-stack
 * socket and which reads like a public address if you only check for "::1".
 */
export function isLoopback(addr: string | null | undefined): boolean {
  const a = String(addr ?? "").trim().toLowerCase();
  if (!a) return false;
  if (a === "::1" || a === "::ffff:127.0.0.1" || a === "localhost") return true;
  // 127.0.0.0/8, all of it — 127.0.0.1 is the common one and not the only one.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

/**
 * May this request be treated as the owner sitting at their own machine?
 *
 * Its own function, and tested to death, because getting it wrong is not a bug
 * you notice. The first version of this lived inline and read "no address means
 * local" — reasonable-sounding, and wrong in the one case that matters. Every
 * test passed, because a test supplies an address. On the runtime this actually
 * ships on, the address lookup was reading the wrong property and returning
 * nothing, so every request on the network was "local" and the gate was open
 * while its own suite reported it shut.
 *
 * So: an unrecognised address counts as local only while this copy is
 * listening to nothing but this machine, where it could not have been anything
 * else. The moment it is bound wider, an unknown address is unknown, and the
 * benefit of the doubt goes to the keys rather than to the caller.
 */
export function treatAsHost(addr: string | null | undefined, boundWide: boolean): boolean {
  if (isLoopback(addr)) return true;
  const known = String(addr ?? "").trim() !== "";
  return !known && !boundWide;
}

/**
 * The events a table broadcasts, and everyone who is listening for them.
 *
 * Single-process and in-memory on purpose: there is one Hearth server and it
 * is the table. Subscribers are cleaned up by the caller's `return`, and a
 * listener that throws is dropped rather than allowed to take the loop down
 * with it — one guest's dead socket must not stop the narrator reaching
 * everybody else.
 */
type Listener = (event: string, data: unknown) => void;
const rooms = new Map<string, Set<Listener>>();

export function subscribe(shareId: string, fn: Listener): () => void {
  let set = rooms.get(shareId);
  if (!set) rooms.set(shareId, (set = new Set()));
  set.add(fn);
  return () => {
    const s = rooms.get(shareId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) rooms.delete(shareId);
  };
}

export function publish(shareId: string, event: string, data: unknown): void {
  const set = rooms.get(shareId);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(event, data);
    } catch {
      set.delete(fn);
    }
  }
}

/** How many people are listening to this table right now. */
export function listeners(shareId: string): number {
  return rooms.get(shareId)?.size ?? 0;
}

/** Only for tests and for shutting a share down. */
export function clearRoom(shareId: string): void {
  rooms.delete(shareId);
}

/**
 * A guest's view of a player, for the "who is here" strip.
 *
 * Tokens never leave the server. It would be easy to hand the whole player row
 * to the client and let it render the name — and then one person's token is in
 * everybody else's browser.
 */
export function publicPlayer(p: Player) {
  return {
    id: p.id,
    name: p.name,
    host: !!p.host,
    persona_id: p.persona_id ?? null,
    seen_at: p.seen_at,
  };
}

/**
 * Somebody has to be able to tell one player from another at a glance, and
 * "Player 2" is not a person. Falls back only when they gave nothing.
 */
export function tidyPlayerName(name: unknown, taken: string[] = []): string {
  let n = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  /*
   * A name that already carries one of our suffixes loses it first.
   *
   * Otherwise they compound: somebody who was "Dan (2)" at one table comes
   * back with that as their name, finds it taken, and becomes "Dan (2) (2)" —
   * and worse every time, since the passport they carry away now says so.
   */
  n = n.replace(/\s*\(\d+\)$/, "").trim();
  if (!n) n = "A player";
  // Two people called Dan is a real thing and a confusing transcript.
  if (!taken.includes(n)) return n;
  for (let i = 2; i < 50; i++) {
    const candidate = `${n} (${i})`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${n} (${Date.now() % 1000})`;
}
