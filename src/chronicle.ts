/**
 * The chronicle: what has actually happened in one chat.
 *
 * The bookshelf already keeps two kinds of book apart — the Archives, which
 * are true, and the Apocrypha, which are plans. The chronicle is the third
 * thing, and it is not a book at all: it is this chat's own record of its
 * story, which belongs to the chat and to nothing else. Two branches of one
 * story have two chronicles from the moment they part, which is exactly what
 * a shared lorebook could never give them.
 *
 * It is a list of entries, appended to and never rewritten. Nothing in it is
 * a stored "current value": the story's date is worked out by reading the
 * list from the top, and so will a bond's standing and a character's state be
 * when those arrive. That is the whole defence against a bad update — from a
 * small model having an off day, or from anyone. A wrong entry is one more
 * line, and taking it back marks that line undone; there is no earlier value
 * it could have overwritten, so there is nothing for it to have destroyed.
 *
 * Each entry is tied to the message it belongs to. That tie is what lets a
 * branch inherit precisely the history it was cut from: everything up to the
 * fork comes along, nothing after it does, and from then on the two diverge.
 *
 * Pure: storing all of this is index.ts's business.
 */

import { later, type Calendar, type Moment } from "./calendar";

export const KINDS = ["event", "time", "set", "status", "bond", "faction", "standing"] as const;

/**
 * Bonds run from 0 to 100 and start in the middle: a stranger is neither
 * friend nor enemy. The Steward moves one by a single step at a time; only a
 * person sets one outright. Small steps are the point — a model that misreads
 * one scene can nudge a relationship, never overturn it.
 */
export const BOND_START = 50;
export const BOND_STEP = 5;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * What the tracker keeps for each person. Fixed, so a model cannot invent a
 * sixth thing to track, and named for what a reader would call them.
 */
export const STATUS_FIELDS = ["physical", "mental", "clothes", "location", "inventory"] as const;
export type StatusField = (typeof STATUS_FIELDS)[number];
export type Kind = (typeof KINDS)[number];

/**
 * Who may read an entry once a chat is shared. `table` is everyone sitting at
 * it. `hidden` is something the players' characters have not learned yet: the
 * model knows it, the host can reveal it, and until then nobody at the table
 * reads it — the host included, who is a player too when the AI is running
 * the game. A chat nobody else is sitting at shows everything to its owner,
 * who is writing the story and is spoiled by nothing in it.
 */
export const VISIBILITY = ["table", "hidden"] as const;
export type Visibility = (typeof VISIBILITY)[number];

/** Where an entry came from, so a bad run can be found and taken back as a whole. */
export const SOURCES = ["user", "scene", "steward", "narrator"] as const;
export type Source = (typeof SOURCES)[number];

export type Entry = {
  id: string;
  kind: Kind;
  /** The message this belongs to; null once that message is gone. */
  message_id: string | null;
  /** For "set": the moment the clock is set to. For an event: when it happened. */
  day: number | null;
  minute: number | null;
  /** For "time": how many minutes passed. */
  span: number;
  title: string;
  body: string;
  visibility: Visibility;
  source: Source;
  /** The words in the story this was read from, for anything not written by hand. */
  evidence: string;
  /** The Apocrypha or campaign scene this records, if it records one. */
  scene_id: string | null;
  /** For a status: whose it is, and which of STATUS_FIELDS. The value is the title. */
  subject: string | null;
  field: StatusField | null;
  /** For a bond: whom it is towards. (The subject is whom it is from.) */
  object: string | null;
  /** For a bond or a standing: how far it moves, in points. */
  amount: number;
  /** For a faction: the rest of it — arms, members — as JSON. */
  data: string;
  created_at: number;
  /** Set when taken back. An undone entry is kept, for the record, and counts for nothing. */
  undone_at: number | null;
  /** Waiting for a person to accept it, and counting for nothing until they do. */
  proposed: boolean;
};

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const intOrNull = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};
const pick = <T extends string>(v: unknown, from: readonly T[], fallback: T): T =>
  from.includes(v as T) ? (v as T) : fallback;

/** About 1.9 million years of minutes: past anything a story needs, short of anything that breaks arithmetic. */
const MAX_SPAN = 1e12;

/** Whatever came in — a request, a row, a model's answer — made into an entry that cannot surprise anyone. */
export function normaliseEntry(raw: any): Entry {
  const span = Math.round(Number(raw?.span));
  return {
    id: str(raw?.id, 80),
    kind: pick(raw?.kind, KINDS, "event"),
    message_id: str(raw?.message_id, 80) || null,
    day: intOrNull(raw?.day),
    minute: intOrNull(raw?.minute),
    span: Number.isFinite(span) ? Math.max(-MAX_SPAN, Math.min(MAX_SPAN, span)) : 0,
    title: str(raw?.title, 200),
    body: str(raw?.body, 4000),
    visibility: pick(raw?.visibility, VISIBILITY, "table"),
    source: pick(raw?.source, SOURCES, "user"),
    evidence: str(raw?.evidence, 600),
    scene_id: str(raw?.scene_id, 80) || null,
    subject: str(raw?.subject, 120) || null,
    field: STATUS_FIELDS.includes(raw?.field) ? raw.field : null,
    object: str(raw?.object, 120) || null,
    amount: clamp(Math.round(Number(raw?.amount)) || 0, -100, 100),
    data: str(typeof raw?.data === "object" && raw?.data ? JSON.stringify(raw.data) : raw?.data, 8000),
    created_at: Math.round(Number(raw?.created_at)) || 0,
    undone_at: intOrNull(raw?.undone_at),
    proposed: !!Number(raw?.proposed ?? 0) || raw?.proposed === true,
  };
}

/** The ones that count: not taken back, not waiting on anyone, in the order they were written. */
export function live(entries: Entry[]): Entry[] {
  return entries.filter((e) => !e.undone_at && !e.proposed).sort((a, b) => a.created_at - b.created_at);
}

/**
 * How everyone is now: for each person and each field, the latest word on it
 * that counts. A status is never edited in place — a change is a new entry,
 * and taking one back lets the one before it show through again.
 */
export function statusOf(entries: Entry[]): Record<string, Partial<Record<StatusField, Entry>>> {
  const out: Record<string, Partial<Record<StatusField, Entry>>> = {};
  for (const e of live(entries)) {
    if (e.kind !== "status" || !e.subject || !e.field || !e.title) continue;
    (out[e.subject] ??= {})[e.field] = e;
  }
  return out;
}

export type Bond = {
  from: string;
  to: string;
  score: number;
  label: string;
  /** The latest reason it moved, in the story's own words where there are any. */
  memory: string;
  /** Every change, oldest first, each with what it was read from. */
  history: Entry[];
};

/**
 * Every bond, one way round: Loras towards Yvenna is not Yvenna towards
 * Loras. Each change moves the score and is kept, with its evidence, so
 * "why does he feel this way?" always has an answer.
 */
export function bondsOf(entries: Entry[]): Bond[] {
  const out = new Map<string, Bond>();
  for (const e of live(entries)) {
    if (e.kind !== "bond" || !e.subject || !e.object || e.subject === e.object) continue;
    const key = `${e.subject}\u0000${e.object}`;
    const b = out.get(key) ?? { from: e.subject, to: e.object, score: BOND_START, label: "", memory: "", history: [] };
    b.score = clamp(b.score + e.amount, 0, 100);
    if (e.title) b.label = e.title;
    if (e.body || e.evidence) b.memory = e.body || e.evidence;
    b.history.push(e);
    out.set(key, b);
  }
  return [...out.values()];
}

export type Faction = {
  key: string;
  name: string;
  description: string;
  /** A blazon (see src/heraldry.ts), or null for arms not yet chosen. */
  arms: unknown;
  members: string[];
  /** How the party stands with them, in tabletop: -100 to 100, starting at 0. */
  standing: number;
  entry: Entry;
};

/**
 * Every faction as it stands now. A faction is defined by its latest entry —
 * renaming one, or giving it arms, is a new entry under the same key, and
 * taking that back shows the one before. One marked gone is gone.
 */
export function factionsOf(entries: Entry[]): Faction[] {
  const out = new Map<string, Faction>();
  const standing = new Map<string, number>();
  for (const e of live(entries)) {
    if (e.kind === "standing" && e.subject) standing.set(e.subject, clamp((standing.get(e.subject) ?? 0) + e.amount, -100, 100));
    if (e.kind !== "faction" || !e.subject || !e.title) continue;
    let d: any = {};
    try { d = e.data ? JSON.parse(e.data) : {}; } catch {}
    if (d?.gone) { out.delete(e.subject); continue; }
    out.set(e.subject, {
      key: e.subject,
      name: e.title,
      description: e.body,
      arms: d?.arms ?? null,
      members: Array.isArray(d?.members) ? d.members.filter((m: unknown) => typeof m === "string").slice(0, 100) : [],
      standing: 0,
      entry: e,
    });
  }
  for (const f of out.values()) f.standing = standing.get(f.key) ?? 0;
  return [...out.values()];
}

/** What is waiting for a person to say yes or no. */
export function pending(entries: Entry[]): Entry[] {
  return entries.filter((e) => e.proposed && !e.undone_at).sort((a, b) => a.created_at - b.created_at);
}

/** Where every story starts until told otherwise: its first day, at the start of it. */
export const START: Moment = { day: 0, minute: 0 };

/**
 * The story's date: read from the top. A "set" puts the clock somewhere; a
 * "time" moves it on; events do not move it. With `upTo`, the date as it was
 * just after that entry — which is what an event is stamped with.
 */
export function clockOf(cal: Calendar, entries: Entry[], upTo?: string): Moment {
  let at = START;
  for (const e of live(entries)) {
    if (e.kind === "set" && e.day !== null) at = later(cal, { day: e.day, minute: e.minute ?? 0 }, 0);
    else if (e.kind === "time") at = later(cal, at, e.span);
    if (upTo && e.id === upTo) break;
  }
  return at;
}

/**
 * What a branch takes with it.
 *
 * `kept` maps each message the branch copied to the id it has in the branch,
 * because a branch's messages are new rows. An entry tied to one of those comes
 * along, re-tied to the copy. An entry tied to a message that is no longer
 * anywhere — deleted, or left behind by carrying on — comes along if it was
 * written before the fork. Taken-back entries come too, still taken back, so
 * the branch's record says the same thing its parent's did.
 */
export function forBranch(entries: Entry[], kept: Map<string, string>, forkAt: number): Entry[] {
  return entries
    .filter((e) => (e.message_id ? kept.has(e.message_id) : e.created_at <= forkAt))
    .map((e) => ({ ...e, message_id: e.message_id ? kept.get(e.message_id)! : null }));
}

/**
 * Carrying on is the same story in a new chat with none of the old messages,
 * so everything comes, untied.
 */
export function forCarryOn(entries: Entry[]): Entry[] {
  return entries.map((e) => ({ ...e, message_id: null }));
}

export type Viewer = { shared: boolean; host: boolean };

/** An entry the host is allowed to know exists, but not to read. */
export type Sealed = Pick<Entry, "id" | "kind" | "message_id" | "created_at" | "source"> & { sealed: true };

/**
 * The chronicle as one person sees it.
 *
 * Alone, everything. At a shared table, hidden entries are left out entirely
 * for guests, and shown to the host only as sealed — that something is there,
 * when it was written, and a way to reveal it — because the host has to be
 * able to reveal a secret without first being made to read it.
 */
export function view(entries: Entry[], who: Viewer): (Entry | Sealed)[] {
  const out: (Entry | Sealed)[] = [];
  for (const e of live(entries)) {
    if (!who.shared || e.visibility === "table") out.push(e);
    else if (who.host) {
      out.push({ id: e.id, kind: e.kind, message_id: e.message_id, created_at: e.created_at, source: e.source, sealed: true });
    }
  }
  return out;
}
