/**
 * Calendars: a date is a number, and the calendar only names it.
 *
 *   bun test src/calendar.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  BUILTINS, MODERN, MOONS, UNDATED, between, eraOf, exportCalendar, format, fromParts, importCalendar,
  later, moonPhase, normaliseCalendar, ordinal, readSpan, settle, toParts, yearLength, type Calendar,
} from "./calendar";

/** A world with a thirteen-month year and a leap day every fifth year. */
const ODD = normaliseCalendar({
  name: "The Thirteen Turns",
  months: Array.from({ length: 13 }, (_, i) => ({ name: `Turn ${i + 1}`, days: 28 })),
  weekdays: ["One", "Two", "Three", "Four", "Five", "Six", "Seven"],
  eras: [{ name: "After the Flood", abbr: "AF", start: 1, before: "BF" }],
  leap: { every: 5, offset: 0, month: 12, days: 1 },
  firstYear: 1,
  format: "{day:ord} of {month}, {year} {era}",
}) as Calendar;

describe("the modern calendar", () => {
  test("day 0 is 1 January 1970, a Thursday", () => {
    expect(toParts(MODERN, 0)).toEqual({ year: 1970, month: 0, day: 1, weekday: 3 });
    expect(format(MODERN, { day: 0, minute: 0 })).toBe("Thursday, 1 January 1970");
  });

  test("agrees with the platform's own arithmetic across leap years and centuries", () => {
    for (const iso of ["2000-02-29", "1900-03-01", "2024-12-31", "1600-01-01", "2100-02-28"]) {
      const day = Math.round(Date.parse(iso + "T00:00:00Z") / 86400000);
      const [y, m, d] = iso.split("-").map(Number);
      expect(fromParts(MODERN, y, m - 1, d)).toBe(day);
      expect(toParts(MODERN, day)).toMatchObject({ year: y, month: m - 1, day: d });
    }
  });

  test("refuses dates that do not exist instead of rolling them over", () => {
    expect(fromParts(MODERN, 2023, 1, 29)).toBeNull();
    expect(fromParts(MODERN, 2024, 1, 29)).not.toBeNull();
    expect(fromParts(MODERN, 2024, 12, 1)).toBeNull();
    expect(fromParts(MODERN, 2024, 0, 0)).toBeNull();
  });

  test("goes back before the common era", () => {
    const day = fromParts(MODERN, -43, 2, 15) as number;
    expect(toParts(MODERN, day)).toMatchObject({ year: -43, month: 2, day: 15 });
    expect(eraOf(MODERN, -43)).toMatchObject({ before: true, year: 44 });
  });

  test("knows a full moon from a new one", () => {
    const newMoon = fromParts(MODERN, 2000, 0, 6) as number;
    expect(moonPhase(MODERN, newMoon)).toBeCloseTo(0, 2);
    expect(moonPhase(MODERN, newMoon + 15)).toBeGreaterThan(0.45);
    expect(moonPhase(MODERN, newMoon + 15)).toBeLessThan(0.55);
  });
});

describe("the reckoning of moons", () => {
  test("names the day the mockups use", () => {
    const day = fromParts(MOONS, 298, 7, 14) as number;
    expect(format(MOONS, { day, minute: 0 })).toBe("14th Day of the Eighth Moon, 298 AC");
  });

  test("every day maps to a date and back", () => {
    for (let day = -800; day <= 800; day += 37) {
      const p = toParts(MOONS, day)!;
      expect(fromParts(MOONS, p.year, p.month, p.day)).toBe(day);
    }
  });
});

describe("a calendar somebody made", () => {
  test("leap years land where the rule says", () => {
    expect(yearLength(ODD, 4)).toBe(364);
    expect(yearLength(ODD, 5)).toBe(365);
    expect(fromParts(ODD, 5, 12, 29)).not.toBeNull();
    expect(fromParts(ODD, 4, 12, 29)).toBeNull();
  });

  test("round-trips far from day 0 in both directions", () => {
    for (const day of [0, 1, 363, 364, 365, 1819, 1820, 100000, -1, -365, -100000]) {
      const p = toParts(ODD, day)!;
      expect(fromParts(ODD, p.year, p.month, p.day)).toBe(day);
    }
  });

  test("survives an export and an import unchanged", () => {
    const back = importCalendar(exportCalendar(ODD))!;
    expect(back).toEqual(ODD);
  });

  test("turns away files that are not calendars, by their mark", () => {
    expect(importCalendar(JSON.stringify({ name: "A lorebook", entries: [] }))).toBeNull();
    expect(importCalendar("not json")).toBeNull();
    expect(importCalendar(JSON.stringify({ hearth: "calendar", v: 1, months: [] }))).toBeNull();
  });

  test("clamps what it cannot trust", () => {
    const wild = normaliseCalendar({
      months: [{ name: "x".repeat(500), days: 1e9 }, { days: -4 }],
      hoursPerDay: 0,
      leap: { every: 0 },
      eras: [{ abbr: "" }],
    })!;
    expect(wild.months[0].name.length).toBeLessThanOrEqual(60);
    expect(wild.months[0].days).toBe(1000);
    expect(wild.months[1]).toEqual({ name: "Month 2", days: 1 });
    expect(wild.hoursPerDay).toBe(1);
    expect(wild.leap).toBeNull();
    expect(wild.eras).toEqual([]);
  });
});

describe("undated", () => {
  test("counts the story's days from one", () => {
    expect(format(UNDATED, { day: 0, minute: 0 })).toBe("Day 1");
    expect(format(UNDATED, { day: 13, minute: 600 })).toBe("Day 14");
  });

  test("has no date to name, so leaves out what it cannot fill", () => {
    expect(toParts(UNDATED, 5)).toBeNull();
    expect(format(UNDATED, { day: 4, minute: 1140 }, "{part} of day {n}, {month}")).toBe("evening of day 5");
  });
});

describe("time passing", () => {
  test("minutes fold into days, forwards and back", () => {
    expect(settle(MOONS, { day: 3, minute: 1500 })).toEqual({ day: 4, minute: 60 });
    expect(later(MOONS, { day: 3, minute: 30 }, -60)).toEqual({ day: 2, minute: 1410 });
    expect(between(MOONS, { day: 1, minute: 0 }, { day: 3, minute: 120 })).toBe(2 * 1440 + 120);
  });

  test("a day can be another length", () => {
    const long = normaliseCalendar({ months: [{ name: "M", days: 10 }], hoursPerDay: 30 })!;
    expect(settle(long, { day: 0, minute: 30 * 60 + 5 })).toEqual({ day: 1, minute: 5 });
  });
});

describe("reading how long something took", () => {
  const noon = { day: 10, minute: 12 * 60 };
  const DAY = 1440;

  test("numbers and units, as a model writes them", () => {
    expect(readSpan(MOONS, "3 days", noon)).toBe(3 * DAY);
    expect(readSpan(MOONS, "three days", noon)).toBe(3 * DAY);
    expect(readSpan(MOONS, "Three days passed.", noon)).toBe(3 * DAY);
    expect(readSpan(MOONS, "a day", noon)).toBe(DAY);
    expect(readSpan(MOONS, "a fortnight", noon)).toBe(14 * DAY);
    expect(readSpan(MOONS, "half a day", noon)).toBe(DAY / 2);
    expect(readSpan(MOONS, "two and a half hours", noon)).toBe(150);
    expect(readSpan(MOONS, "8h", noon)).toBe(480);
    expect(readSpan(MOONS, "about two weeks", noon)).toBe(14 * DAY);
    expect(readSpan(MOONS, "a few hours", noon)).toBe(180);
    expect(readSpan(MOONS, "a moon", noon)).toBe(30 * DAY);
  });

  test("a range is read by its low end", () => {
    expect(readSpan(MOONS, "ten to fourteen days", noon)).toBe(10 * DAY);
    expect(readSpan(MOONS, "2-3 days", noon)).toBe(2 * DAY);
  });

  test("until a part of the day", () => {
    expect(readSpan(MOONS, "until dusk", noon)).toBe(6 * 60);
    expect(readSpan(MOONS, "until dawn", noon)).toBe(18 * 60);
    expect(readSpan(MOONS, "the next morning", noon)).toBe(20 * 60);
    expect(readSpan(MOONS, "tomorrow", noon)).toBe(20 * 60);
    // In the small hours, "the next morning" is the one about to arrive.
    expect(readSpan(MOONS, "the next morning", { day: 10, minute: 120 })).toBe(6 * 60);
  });

  test("anything it cannot read with confidence moves nothing", () => {
    for (const vague of ["", "a while", "some time later", "soon", "ages", "3 bananas", "x".repeat(200),
      "until the king returns", "then there was a long silence and three days passed and"]) {
      expect(readSpan(MOONS, vague, noon)).toBeNull();
    }
  });
});

test("ordinals", () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal))
    .toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
});

test("every built-in calendar formats day 0 without a stray brace", () => {
  for (const cal of BUILTINS) expect(format(cal, { day: 0, minute: 0 })).not.toMatch(/[{}]/);
});
