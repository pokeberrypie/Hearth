/**
 * Calendars: how a story counts its days.
 *
 * The one rule this file is built around is that a date is a number. Every
 * moment in a story is stored as a count of days from the calendar's first day
 * plus the minutes since that day's midnight, and nothing anywhere does
 * arithmetic on anything else. "Three days later", "a ride of ten to fourteen
 * days", "in two days' time" are all subtraction. The calendar is only ever
 * asked two questions: what is this number called, and what number is this
 * name.
 *
 * That is what makes a calendar somebody else wrote safe to load. A thirteen-
 * month year with a leap day every fifth winter cannot corrupt a timeline,
 * because the timeline never held anything but numbers; at worst it prints
 * strangely. It is also why a chat can change calendars halfway through and
 * lose nothing.
 *
 * Four kinds ship:
 *
 * - **Undated** — "Day 14". Most stories never name a date, and asking them to
 *   pick a calendar is a question with no answer. This is where every chat
 *   starts.
 * - **Modern** — the Gregorian calendar, done by hand rather than through
 *   `Date`, which knows about time zones and daylight saving and does not know
 *   about a story set in 1347.
 * - **Moons** — a generic fantasy reckoning: twelve moons of thirty days.
 * - Anything imported, which is a custom calendar described in JSON.
 *
 * Pure: storing a chat's calendar and its clock is index.ts's business.
 */

export const KINDS = ["undated", "gregorian", "custom"] as const;
export type Kind = (typeof KINDS)[number];

export type Month = { name: string; days: number };

/**
 * A named count of years. A year belongs to the latest era that has started by
 * then, and is numbered from 1 within it. A year before every era is counted
 * backwards from the first one, under `before` — which is how "BC" works, and
 * "Before the Conquest".
 */
export type Era = { name: string; abbr: string; start: number; before: string };

/** Extra days in some years. Year numbers are absolute, not era-relative. */
export type Leap = { every: number; offset: number; month: number; days: number };

/** A named hour, so a story can say "until dawn" and mean something. */
export type DayPart = { name: string; hour: number };

export type Calendar = {
  id: string;
  name: string;
  kind: Kind;
  months: Month[];
  weekdays: string[];
  eras: Era[];
  leap: Leap | null;
  /** Days in one cycle of the moon, and where day 0 falls in it (0 = new). */
  moon: { cycle: number; offset: number } | null;
  hoursPerDay: number;
  parts: DayPart[];
  /** The absolute year that day 0 falls in. */
  firstYear: number;
  /** See `format()` for the tokens. */
  format: string;
};

/** A point in a story: whole days from the calendar's day 0, and minutes into that day. */
export type Moment = { day: number; minute: number };

/** Where a day falls, in the calendar's own terms. Month is 0-based; day is 1-based. */
export type DateParts = { year: number; month: number; day: number; weekday: number };

/** The marker an exported calendar carries, so a stray JSON file is not mistaken for one. */
export const FILE_MARK = "calendar";
export const FILE_VERSION = 1;

const DEFAULT_PARTS: DayPart[] = [
  { name: "midnight", hour: 0 },
  { name: "dawn", hour: 6 },
  { name: "morning", hour: 8 },
  { name: "noon", hour: 12 },
  { name: "afternoon", hour: 14 },
  { name: "dusk", hour: 18 },
  { name: "evening", hour: 19 },
  { name: "night", hour: 21 },
];

export const UNDATED: Calendar = {
  id: "undated",
  name: "Undated",
  kind: "undated",
  months: [],
  weekdays: [],
  eras: [],
  leap: null,
  moon: null,
  hoursPerDay: 24,
  parts: DEFAULT_PARTS,
  firstYear: 1,
  format: "Day {n}",
};

/**
 * Day 0 is 1 January 1970, which is arbitrary but conventional and makes the
 * numbers easy to check against anything else.
 */
export const MODERN: Calendar = {
  id: "modern",
  name: "Modern",
  kind: "gregorian",
  months: [
    ["January", 31], ["February", 28], ["March", 31], ["April", 30], ["May", 31], ["June", 30],
    ["July", 31], ["August", 31], ["September", 30], ["October", 31], ["November", 30], ["December", 31],
  ].map(([name, days]) => ({ name: name as string, days: days as number })),
  weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  eras: [{ name: "Anno Domini", abbr: "AD", start: 1, before: "BC" }],
  leap: null,
  // The mean synodic month, counted from the new moon of 6 January 2000 (day 10962).
  moon: { cycle: 29.530588, offset: 10962 % 29.530588 },
  hoursPerDay: 24,
  parts: DEFAULT_PARTS,
  firstYear: 1970,
  format: "{weekday}, {day} {month} {year}",
};

export const MOONS: Calendar = {
  id: "moons",
  name: "The Reckoning of Moons",
  kind: "custom",
  months: [
    "First Moon", "Second Moon", "Third Moon", "Fourth Moon", "Fifth Moon", "Sixth Moon",
    "Seventh Moon", "Eighth Moon", "Ninth Moon", "Tenth Moon", "Eleventh Moon", "Twelfth Moon",
  ].map((name) => ({ name, days: 30 })),
  weekdays: ["Moonsday", "Fathersday", "Mothersday", "Warriorsday", "Smithsday", "Maidensday", "Crownsday"],
  eras: [{ name: "After the Crowning", abbr: "AC", start: 1, before: "BC" }],
  leap: null,
  moon: { cycle: 30, offset: 0 },
  hoursPerDay: 24,
  parts: DEFAULT_PARTS,
  firstYear: 1,
  format: "{day:ord} Day of the {month}, {year} {era}",
};

export const BUILTINS: Calendar[] = [UNDATED, MODERN, MOONS];

// ---- the arithmetic -------------------------------------------------------

const floorDiv = (a: number, b: number) => Math.floor(a / b);
const mod = (a: number, b: number) => ((a % b) + b) % b;

/** Days from 1 January 1970 to a proleptic Gregorian date. Howard Hinnant's days_from_civil. */
function gregorianToDays(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = floorDiv(yy, 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = floorDiv(153 * mp + 2, 5) + d - 1;
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The reverse: civil_from_days. Month here is 1-based, as in the algorithm. */
function daysToGregorian(z: number): { y: number; m: number; d: number } {
  const zz = z + 719468;
  const era = floorDiv(zz, 146097);
  const doe = zz - era * 146097;
  const yoe = floorDiv(doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096), 365);
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100));
  const mp = floorDiv(5 * doy + 2, 153);
  const d = doy - floorDiv(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: era * 400 + yoe + (m <= 2 ? 1 : 0), m, d };
}

const gregorianLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Whether a custom calendar's absolute year carries its leap days. */
function isLeapYear(cal: Calendar, year: number): boolean {
  if (cal.kind === "gregorian") return gregorianLeap(year);
  return !!cal.leap && mod(year - cal.leap.offset, cal.leap.every) === 0;
}

function monthLength(cal: Calendar, year: number, month: number): number {
  const base = cal.months[month]?.days ?? 0;
  if (cal.kind === "gregorian") return month === 1 && gregorianLeap(year) ? 29 : base;
  return cal.leap && cal.leap.month === month && isLeapYear(cal, year) ? base + cal.leap.days : base;
}

export function yearLength(cal: Calendar, year: number): number {
  let n = 0;
  for (let i = 0; i < cal.months.length; i++) n += monthLength(cal, year, i);
  return n;
}

/**
 * A custom calendar's years come in a repeating cycle — one leap period, or a
 * single year when there are no leap days — so a date three thousand years out
 * is found by jumping whole cycles first rather than walking every year.
 */
function cycleOf(cal: Calendar): { years: number; days: number } {
  const years = cal.leap ? cal.leap.every : 1;
  let days = 0;
  for (let i = 0; i < years; i++) days += yearLength(cal, cal.firstYear + i);
  return { years, days };
}

/** The calendar's name for a day. Undated has no months, so it has no parts. */
export function toParts(cal: Calendar, day: number): DateParts | null {
  const d = Math.floor(day);
  const weekday = cal.weekdays.length ? mod(d, cal.weekdays.length) : 0;
  if (cal.kind === "undated" || !cal.months.length) return null;
  if (cal.kind === "gregorian") {
    const g = daysToGregorian(d);
    // 1 January 1970 was a Thursday, the fourth day of a Monday-first week.
    return { year: g.y, month: g.m - 1, day: g.d, weekday: mod(d + 3, 7) };
  }
  const cycle = cycleOf(cal);
  const skip = floorDiv(d, cycle.days);
  let year = cal.firstYear + skip * cycle.years;
  let left = d - skip * cycle.days;
  // At most one cycle's worth of years left to walk, in either direction.
  while (left >= yearLength(cal, year)) left -= yearLength(cal, year++);
  let month = 0;
  while (month < cal.months.length - 1 && left >= monthLength(cal, year, month)) {
    left -= monthLength(cal, year, month++);
  }
  return { year, month, day: left + 1, weekday };
}

/**
 * The day number for a date, or null if there is no such date — the 31st of a
 * thirty-day month, or a month that does not exist. Out-of-range input is
 * refused rather than rolled over, because "the 31st of the Eighth Moon"
 * quietly becoming the 1st of the Ninth is a mistake nobody would notice.
 */
export function fromParts(cal: Calendar, year: number, month: number, day: number): number | null {
  if (cal.kind === "undated" || !cal.months.length) return null;
  if (![year, month, day].every(Number.isInteger)) return null;
  if (month < 0 || month >= cal.months.length) return null;
  if (day < 1 || day > monthLength(cal, year, month)) return null;
  if (cal.kind === "gregorian") return gregorianToDays(year, month + 1, day);
  const cycle = cycleOf(cal);
  const skip = floorDiv(year - cal.firstYear, cycle.years);
  let n = skip * cycle.days;
  for (let y = cal.firstYear + skip * cycle.years; y < year; y++) n += yearLength(cal, y);
  for (let m = 0; m < month; m++) n += monthLength(cal, year, m);
  return n + day - 1;
}

/** Which era a year falls in, and its number within it. */
export function eraOf(cal: Calendar, year: number): { era: Era | null; year: number; before: boolean } {
  if (!cal.eras.length) return { era: null, year, before: false };
  const sorted = [...cal.eras].sort((a, b) => a.start - b.start);
  const found = [...sorted].reverse().find((e) => e.start <= year);
  if (found) return { era: found, year: year - found.start + 1, before: false };
  return { era: sorted[0], year: sorted[0].start - year, before: true };
}

/** 0 is new, 0.5 is full. Null for a calendar with no moon. */
export function moonPhase(cal: Calendar, day: number): number | null {
  if (!cal.moon || !(cal.moon.cycle > 0)) return null;
  return mod(day - cal.moon.offset, cal.moon.cycle) / cal.moon.cycle;
}

// ---- moments and spans ----------------------------------------------------

export const minutesPerDay = (cal: Calendar) => cal.hoursPerDay * 60;

/** A moment with its minutes folded into whole days, so it is always in range. */
export function settle(cal: Calendar, m: Moment): Moment {
  const per = minutesPerDay(cal);
  const total = Math.round(m.minute);
  return { day: Math.floor(m.day) + floorDiv(total, per), minute: mod(total, per) };
}

/** Time passing. Negative minutes are allowed, for undo; nothing else should need them. */
export function later(cal: Calendar, m: Moment, minutes: number): Moment {
  return settle(cal, { day: m.day, minute: m.minute + minutes });
}

/** Whole minutes between two moments; positive when `b` is after `a`. */
export function between(cal: Calendar, a: Moment, b: Moment): number {
  return (b.day - a.day) * minutesPerDay(cal) + (b.minute - a.minute);
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, hundred: 100, few: 3, several: 3, couple: 2, half: 0.5, dozen: 12,
};

/** Units a span can be counted in, in minutes; months and years depend on the calendar. */
function unitMinutes(cal: Calendar, unit: string): number | null {
  const day = minutesPerDay(cal);
  const u = unit.replace(/s$/, "");
  if (/^(minute|min)$/.test(u)) return 1;
  if (/^(hour|hr|h)$/.test(u)) return 60;
  if (/^(day|d|night)$/.test(u)) return day;
  if (/^(week|wk|sennight)$/.test(u)) return day * (cal.weekdays.length || 7);
  if (/^fortnight$/.test(u)) return day * (cal.weekdays.length || 7) * 2;
  if (/^(month|moon|turn)$/.test(u)) {
    const avg = cal.months.length ? yearLength(cal, cal.firstYear) / cal.months.length : 30;
    return Math.round(avg * day);
  }
  if (/^(year|yr)$/.test(u)) return (cal.months.length ? yearLength(cal, cal.firstYear) : 365) * day;
  return null;
}

/**
 * How long a phrase means, in minutes, from a given moment — or null when it
 * cannot be read with confidence.
 *
 * This is the half of the steward's work that must not be left to the model.
 * A small model asked "what is the date three days after the 29th of the
 * Eighth Moon?" will get it wrong a fair share of the time; asked only "how
 * much time passed?" it says "three days", and the sum is done here.
 *
 * Deliberately narrow. It reads a number and a unit ("3 days", "two weeks",
 * "a fortnight", "half a day", "8h"), a range by its first half ("ten to
 * fourteen days" is ten — the low end, because overshooting a clock is worse
 * than undershooting it), and "until <part of the day>" ("until dawn", "the
 * next morning"). Anything else is null, and null means "do not move the
 * clock", never "guess".
 */
export function readSpan(cal: Calendar, text: string, from: Moment): number | null {
  const whole = String(text ?? "").toLowerCase().replace(/[’'.!~]/g, "").replace(/\s+/g, " ").trim();
  if (!whole || whole.length > 80) return null;
  const once = spanOf(cal, whole, from);
  if (once) return once;
  // "overnight, into the morning", "a night (until morning)": the first part, set off by its punctuation, that
  // can be read alone. Never the parts added up, and never split on "and" — out of a rambling sentence that would
  // pick a number, which is a guess.
  for (const part of whole.split(/\s*[(),;:]\s*/)) {
    const span = part.trim() && part.trim() !== whole ? spanOf(cal, part.trim(), from) : null;
    if (span) return span;
  }
  return null;
}

/** Other names for the parts of the day, as the story says them, to the part the calendar has. */
const PART_NAMES: Record<string, string[]> = {
  dawn: ["sunrise", "daybreak", "sunup", "firstlight", "cockcrow"],
  dusk: ["sunset", "nightfall", "sundown", "twilight", "dark"],
  noon: ["midday"],
  night: ["nighttime"],
  midnight: [],
};

/** The calendar's part of the day a word means, if it has one. */
function partNamed(cal: Calendar, word: string) {
  const own = cal.parts.find((p) => p.name === word);
  if (own) return own;
  for (const [name, also] of Object.entries(PART_NAMES)) if (also.includes(word)) return cal.parts.find((p) => p.name === name);
  return undefined;
}

function spanOf(cal: Calendar, input: string, from: Moment): number | null {
  const perDay = minutesPerDay(cal);
  let t = input
    .replace(/^(?:approximately|approx|about|around|roughly|some)\s+/, "")
    .replace(/\bfirst light\b/g, "firstlight");
  // A night slept through ends in the morning: "overnight", "through the night", "a night's sleep", "they slept
  // the night". Not a whole day from now — a night, from the evening, is not twenty-four hours.
  if (/^(?:overnight|over night|through the night|all night|the night through|(?:a|one) nights? (?:sleep|rest)|(?:they |we |she |he |i )?(?:slept|sleep|rested|camped)(?: through)? the night)$/.test(t)) {
    t = cal.parts.some((p) => p.name === "morning") ? "until morning" : "until dawn";
  }
  // "until the next morning", "the morning after": the next one; "at dawn", "come morning", "in the morning",
  // and the bare "morning" or "dawn": the coming one.
  t = t.replace(/^(?:until|till|til|to|by)\s+the\s+(?:next|following)\s+([a-z]+)$/, "the next $1")
    .replace(/^(?:the\s+)?([a-z]+)\s+after$/, "the next $1")
    .replace(/^(?:at|come|in the|by the|into the|into)\s+([a-z]+)$/, "until $1");
  if (/^[a-z]+$/.test(t) && partNamed(cal, t)) t = `until ${t}`;

  // "Later that evening", "that night": later today, and only if that part of
  // the day is still to come — one already past is not guessed at.
  const sameDay = t.match(/^(?:later\s+)?that\s+(?:same\s+)?([a-z]+)$/);
  if (sameDay) {
    const part = cal.parts.find((p) => p.name === sameDay[1]);
    const wait = part ? part.hour * 60 - from.minute : 0;
    return wait > 0 ? wait : null;
  }

  // "until dawn", "by dawn", "the next morning", "the following day", "tomorrow", "morning came".
  const toward = t.match(/^(?:until|till|til|to|by)\s+(?:the\s+)?([a-z]+)$/)
    ?? t.match(/^([a-z]+)\s+(?:came|comes|broke|breaks|arrived)$/);
  const nextOne = t.match(/^(?:the\s+)?(?:next|following)\s+([a-z]+)$/) ?? t.match(/^([a-z]+)\s+tomorrow$/);
  if (toward || nextOne || t === "tomorrow") {
    const name = (toward ?? nextOne)?.[1] ?? "morning";
    if (name === "day") return nextOne ? perDay : null;
    const part = partNamed(cal, name);
    if (!part) return null;
    const wait = part.hour * 60 - from.minute;
    // "Until dawn" is the next dawn, however soon. "The next morning" is
    // tomorrow's — unless it is still the small hours, when the coming
    // morning is the one everybody means.
    const dawn = (cal.parts.find((p) => p.name === "dawn")?.hour ?? 6) * 60;
    const today = toward || from.minute < dawn;
    return today && wait > 0 ? wait : wait + perDay;
  }

  let rest = t;
  let half = 0;
  if (/\band a half\b/.test(rest)) { half = 0.5; rest = rest.replace(/\band a half\b/, " "); }
  let words = rest
    .replace(/(\d)\s*-\s*(\d)/g, "$1 to $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .split(/[\s-]+/)
    .filter((w) => w && !FILLER.has(w));
  // A range is read by its low end: overshooting a clock is worse than undershooting it.
  const or = words.findIndex((w, i) => (w === "or" || w === "to") && i > 0 && i < words.length - 1);
  if (or > 0 && countOf(words[or - 1]) !== null && countOf(words[or + 1]) !== null) words.splice(or, 2);
  words = words.filter((w) => w !== "a" && w !== "an");

  let count: number | null = 1;
  let unit: string | undefined;
  if (words.length === 1) unit = words[0];
  else if (words.length === 2) { count = countOf(words[0]); unit = words[1]; }
  else return null;
  if (count === null || !unit) return null;
  // A night ends in the morning: "a night" from the evening is until morning, not until this time tomorrow — read
  // that way, every night's camp skipped a day of the story. Two nights is a day more, and so on.
  if (/^nights?$/.test(unit) && Number.isInteger(count) && count >= 1 && !half) {
    const morning = partNamed(cal, "morning") ?? partNamed(cal, "dawn");
    if (morning) {
      const wait = morning.hour * 60 - from.minute;
      return (count - 1) * perDay + (wait > 0 && from.minute < (partNamed(cal, "dawn")?.hour ?? 6) * 60 ? wait : wait + perDay);
    }
  }
  const size = unitMinutes(cal, unit);
  if (size === null) return null;
  const total = Math.round((count + half) * size);
  return total > 0 ? total : null;
}

const FILLER = new Set([
  "about", "around", "roughly", "some", "nearly", "almost", "over", "another", "just", "later",
  "pass", "passes", "passed", "go", "goes", "went", "by", "of", "has", "have", "had", "after",
  "for", "the", "full", "whole", "good", "long", "on",
  // How the time was spent, which is not how much of it: "a day's ride", "two days of marching".
  "ride", "riding", "rode", "march", "marching", "travel", "travelling", "traveling", "walk", "walking",
  "sail", "sailing", "journey", "journeying", "road", "hard", "approximately", "approx",
]);

function countOf(word: string): number | null {
  if (/^\d+(\.\d+)?$/.test(word)) return Number(word);
  return WORD_NUMBERS[word] ?? null;
}

// ---- words ----------------------------------------------------------------

export function ordinal(n: number): string {
  const v = Math.abs(n) % 100;
  const s = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][v % 10] ?? "th";
  return n + s;
}

/** The part of the day a minute falls in: the latest part that has begun. */
export function partOf(cal: Calendar, minute: number): string {
  const hour = minute / 60;
  const sorted = [...cal.parts].sort((a, b) => a.hour - b.hour);
  return [...sorted].reverse().find((p) => p.hour <= hour)?.name ?? sorted[sorted.length - 1]?.name ?? "";
}

/**
 * A date as words, from the calendar's format string.
 *
 * Tokens: {n} the story's day counting from 1 · {day} {day:ord} · {month}
 * {month:num} · {year} · {era} its abbreviation, {era:name} in full ·
 * {weekday} · {time} as hh:mm · {part} the part of the day. A token the
 * calendar cannot fill — {month} on an undated calendar — is left out along
 * with the spaces around it rather than printed as a stray brace.
 */
export function format(cal: Calendar, m: Moment, pattern = cal.format): string {
  const at = settle(cal, m);
  const parts = toParts(cal, at.day);
  const era = parts ? eraOf(cal, parts.year) : null;
  const hh = Math.floor(at.minute / 60);
  const mm = at.minute % 60;
  const values: Record<string, string> = {
    n: String(at.day + 1),
    day: parts ? String(parts.day) : "",
    "day:ord": parts ? ordinal(parts.day) : "",
    month: parts ? cal.months[parts.month]?.name ?? "" : "",
    "month:num": parts ? String(parts.month + 1) : "",
    year: era ? String(era.year) : parts ? String(parts.year) : "",
    era: era?.era ? (era.before ? era.era.before : era.era.abbr) : "",
    "era:name": era?.era ? (era.before ? era.era.before : era.era.name) : "",
    weekday: parts && cal.weekdays.length ? cal.weekdays[parts.weekday] : "",
    time: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    part: partOf(cal, at.minute),
  };
  return pattern
    .replace(/\{([a-z]+(?::[a-z]+)?)\}/g, (_w, k) => values[k] ?? "")
    .replace(/\s+([,.])/g, "$1")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .replace(/\s{2,}/g, " ");
}

// ---- files ----------------------------------------------------------------

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const int = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/**
 * Whatever came out of a file, made into a calendar that cannot surprise
 * anyone — or null when it is not a calendar at all.
 *
 * The limits are generous and absolute: up to 40 months of up to 1000 days, up
 * to 20 weekdays and 20 eras, and a day of 1 to 100 hours. Inside them anything
 * goes, because somebody's world has a 400-day year and that is their
 * business; outside them the file is broken or hostile and is clamped rather
 * than trusted.
 */
export function normaliseCalendar(raw: unknown): Calendar | null {
  let j: any = raw;
  if (typeof raw === "string") {
    try { j = JSON.parse(raw); } catch { return null; }
  }
  if (!j || typeof j !== "object") return null;
  const kind: Kind = KINDS.includes(j.kind) ? j.kind : "custom";
  if (kind === "undated") return { ...UNDATED, name: str(j.name, 80) || UNDATED.name };
  if (kind === "gregorian") return { ...MODERN, name: str(j.name, 80) || MODERN.name };

  const months: Month[] = (Array.isArray(j.months) ? j.months : [])
    .slice(0, 40)
    .map((m: any, i: number) => ({ name: str(m?.name, 60) || `Month ${i + 1}`, days: int(m?.days, 1, 1000, 30) }));
  if (!months.length) return null;

  const weekdays = (Array.isArray(j.weekdays) ? j.weekdays : [])
    .slice(0, 20).map((w: unknown) => str(w, 40)).filter(Boolean);
  const eras: Era[] = (Array.isArray(j.eras) ? j.eras : []).slice(0, 20).map((e: any) => ({
    name: str(e?.name, 80),
    abbr: str(e?.abbr, 12) || str(e?.name, 12),
    start: int(e?.start, -1e7, 1e7, 1),
    before: str(e?.before, 12),
  })).filter((e: Era) => e.abbr);

  const leap: Leap | null = j.leap && typeof j.leap === "object" && Number(j.leap.every) >= 1
    ? {
        every: int(j.leap.every, 1, 1000, 4),
        offset: int(j.leap.offset, -1e7, 1e7, 0),
        month: int(j.leap.month, 0, months.length - 1, months.length - 1),
        days: int(j.leap.days, 1, 100, 1),
      }
    : null;
  const moon = j.moon && typeof j.moon === "object" && Number(j.moon.cycle) > 0
    ? { cycle: Math.min(10000, Number(j.moon.cycle)), offset: Number(j.moon.offset) || 0 }
    : null;
  const hoursPerDay = int(j.hoursPerDay, 1, 100, 24);
  const parts: DayPart[] = Array.isArray(j.parts)
    ? j.parts.slice(0, 24).map((p: any) => ({
        name: str(p?.name, 30).toLowerCase(),
        hour: Math.min(hoursPerDay - 1, Math.max(0, Number(p?.hour) || 0)),
      })).filter((p: DayPart) => p.name)
    : DEFAULT_PARTS.filter((p) => p.hour < hoursPerDay);

  const name = str(j.name, 80) || "A calendar";
  return {
    id: str(j.id, 80) || slug(name) || "custom",
    name,
    kind: "custom",
    months,
    weekdays,
    eras,
    leap,
    moon,
    hoursPerDay,
    parts: parts.length ? parts : DEFAULT_PARTS.filter((p) => p.hour < hoursPerDay),
    firstYear: int(j.firstYear, -1e7, 1e7, 1),
    format: str(j.format, 200) || "{day:ord} of {month}, {year} {era}",
  };
}

/** A calendar as a file someone else can load. */
export function exportCalendar(cal: Calendar): string {
  const { id, name, kind, months, weekdays, eras, leap, moon, hoursPerDay, parts, firstYear, format } = cal;
  return JSON.stringify(
    { hearth: FILE_MARK, v: FILE_VERSION, id, name, kind, months, weekdays, eras, leap, moon, hoursPerDay, parts, firstYear, format },
    null,
    2,
  );
}

/**
 * A file, read back. Refuses anything not marked as a Hearth calendar, so a
 * lorebook or a preset dropped on the wrong button is turned away by name
 * instead of becoming a calendar with one month called "entries".
 */
export function importCalendar(text: string): Calendar | null {
  let j: any;
  try { j = JSON.parse(String(text ?? "")); } catch { return null; }
  if (!j || j.hearth !== FILE_MARK) return null;
  return normaliseCalendar(j);
}

export function builtin(id: string): Calendar | undefined {
  return BUILTINS.find((c) => c.id === id);
}
