/**
 * A passport: your character, carried by you rather than kept by a host.
 *
 * The failures worth guarding here are the paste-box ones. People put all
 * sorts into a field labelled "paste your passport", and the wrong answer to
 * a bad paste is a character called `{"name":` — so anything that is not one
 * of ours has to come back as nothing, not as a half-read guess.
 */

import { describe, expect, test } from "bun:test";

import { readPassport, writePassport, type Passport } from "./passport";

const dan: Passport = {
  id: "abc123",
  name: "Dan",
  sheet: { klass: "fighter", level: 1, hp: 12, maxHp: 12 },
  at: 1_700_000_000_000,
};

describe("carrying one", () => {
  test("survives the round trip whole", () => {
    expect(readPassport(writePassport(dan))).toEqual(dan);
  });

  test("survives being pasted with whitespace around it", () => {
    expect(readPassport(`\n  ${writePassport(dan)}  \n`)?.name).toBe("Dan");
  });

  test("carries a character that does not exist yet", () => {
    const blank = { ...dan, sheet: null };
    expect(readPassport(writePassport(blank))?.sheet).toBeNull();
  });

  test("holds names that are not ASCII", () => {
    const p = { ...dan, name: "Dán — the wolf" };
    expect(readPassport(writePassport(p))?.name).toBe("Dán — the wolf");
  });
});

describe("refusing what is not one", () => {
  test("nothing, and rubbish, and things that merely look close", () => {
    for (const bad of [
      "", "   ", null, undefined, 42,
      "hello", "{\"name\":\"Dan\"}",
      // Right shape, wrong thing: base64 of valid JSON with no prefix.
      Buffer.from('{"id":"x","name":"Dan"}').toString("base64"),
      // Our prefix, but the body is not ours.
      "hearth1.not-base64!!",
      "hearth2." + Buffer.from('{"id":"x"}').toString("base64url"),
    ]) {
      expect(readPassport(bad as any)).toBeNull();
    }
  });

  test("a passport with no id is not a passport", () => {
    // The id is the only part that says it is still the same person; without
    // it this is just a name somebody typed.
    const forged = "hearth1." + Buffer.from('{"name":"Dan"}').toString("base64url");
    expect(readPassport(forged)).toBeNull();
  });

  test("an absurd name is cut rather than carried", () => {
    const p = writePassport({ ...dan, name: "x".repeat(500) });
    expect(readPassport(p)!.name.length).toBe(40);
  });
});
