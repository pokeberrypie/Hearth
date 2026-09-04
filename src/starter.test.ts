/**
 * The starter character.
 *
 *   bun test src/starter.test.ts
 */

import { describe, expect, test } from "bun:test";

import { db, wipe } from "./test-support";
import { STARTER, STARTER_NAME, libraryIsEmpty, narratorMissing } from "./starter";

describe("when it is offered", () => {
  test("an empty library is empty", () => {
    wipe();
    expect(libraryIsEmpty(db)).toBe(true);
  });

  test("one character is enough for it not to be", () => {
    wipe();
    db.query("INSERT INTO characters (id, name, first_message, created_at) VALUES (?,?,?,?)")
      .run("c1", "Someone", "hi", 1);
    expect(libraryIsEmpty(db)).toBe(false);
  });

  test("a deleted character still counts, so a removed starter stays removed", () => {
    wipe();
    db.query("INSERT INTO characters (id, name, first_message, created_at, deleted_at) VALUES (?,?,?,?,?)")
      .run("c1", "Deleted", "hi", 1, 2);
    expect(libraryIsEmpty(db)).toBe(false);
  });
});

describe("the card itself", () => {
  test("says the things a narrator card has to say", () => {
    // The failure this guards against is a card that quietly loses the line
    // telling it not to play the person sitting at the table.
    expect(STARTER.system_prompt).toMatch(/never write the player/i);
    expect(STARTER.description).toBeTruthy();
    expect(STARTER.first_message).toBeTruthy();
  });

  test("carries the dice notation itself, rather than relying on the setting", () => {
    expect(STARTER.system_prompt).toContain("[[2d6]]");
    expect(STARTER.system_prompt).toMatch(/never write the outcome/i);
  });
});

describe("walking into tabletop mode", () => {
  test("a full library with no narrator still needs one", () => {
    wipe();
    db.query("INSERT INTO characters (id, name, first_message, created_at) VALUES (?,?,?,?)")
      .run("c1", "Someone Else", "hi", 1);
    // libraryIsEmpty says no seeding; the door still needs somebody behind it.
    expect(libraryIsEmpty(db)).toBe(false);
    expect(narratorMissing(db)).toBe(true);
  });

  test("once it is there, it is not added again", () => {
    wipe();
    db.query("INSERT INTO characters (id, name, first_message, created_at) VALUES (?,?,?,?)")
      .run("c1", STARTER_NAME, "hi", 1);
    expect(narratorMissing(db)).toBe(false);
  });

  test("a deleted narrator stays deleted, not restored every session", () => {
    wipe();
    db.query("INSERT INTO characters (id, name, first_message, created_at, deleted_at) VALUES (?,?,?,?,?)")
      .run("c1", STARTER_NAME, "hi", 1, 2);
    expect(narratorMissing(db)).toBe(false);
  });
});
