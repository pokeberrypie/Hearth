/**
 * Opening a character to edit them must not empty them.
 *
 * The cast list carries what a list draws — id, name, avatar, description —
 * and the edit dialog was being handed a row straight out of it. Personality,
 * the scene and the greeting arrived as `undefined` and showed as empty boxes,
 * which is what got reported. The dangerous half went unreported: saving
 * writes all five fields, so those blanks went back over the real ones. A
 * character was gutted by somebody opening it to fix a typo, and carried on
 * looking fine in the list afterwards.
 *
 * So the editor fetches the whole record. This is the endpoint it fetches
 * from, and the reason it has to exist.
 */

import { describe, expect, test } from "bun:test";

import { db, wipe } from "./test-support";

const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`http://home.test${path}`, init), HOME);

const FULL = {
  name: "Marla Vance",
  description: "Keeper of the light at Cold Harbour.",
  personality: "Blunt. Kind in a way she would deny.",
  scenario: "The lamp has failed three nights running.",
  first_message: "You're the one they sent, then.",
};

async function seed() {
  wipe();
  const res = await ask("/api/characters", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(FULL),
  });
  return (await res.json()).id as string;
}

describe("fetching one character", () => {
  test("returns every field the editor writes back", async () => {
    const id = await seed();
    const got = await (await ask(`/api/characters/${id}`)).json();
    for (const [key, value] of Object.entries(FULL)) {
      expect(got[key]).toBe(value);
    }
  });

  test("a character that is not there says so", async () => {
    wipe();
    expect((await ask("/api/characters/nobody")).status).toBe(404);
  });

  test("a deleted one is not handed back either", async () => {
    const id = await seed();
    db.query("UPDATE characters SET deleted_at = ? WHERE id = ?").run(Date.now(), id);
    expect((await ask(`/api/characters/${id}`)).status).toBe(404);
  });
});

describe("the list the editor must not be built from", () => {
  /*
   * Not a complaint about /cast — it is right to be small. This is here so
   * that if somebody ever wires the dialog back to it, the reason it cannot be
   * is written down next to the proof.
   */
  test("/cast omits the fields a save would overwrite", async () => {
    await seed();
    const cast = await (await ask("/api/cast")).json();
    expect(cast).toHaveLength(1);
    expect(cast[0].name).toBe(FULL.name);
    expect(cast[0].personality).toBeUndefined();
    expect(cast[0].scenario).toBeUndefined();
    expect(cast[0].first_message).toBeUndefined();
  });
});

describe("a save from a fully-loaded editor", () => {
  test("keeps everything it was not asked to change", async () => {
    const id = await seed();
    const whole = await (await ask(`/api/characters/${id}`)).json();

    // What the dialog does: read the record, change one field, send them all.
    await ask(`/api/characters/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...whole, name: "Marla V." }),
    });

    const after = await (await ask(`/api/characters/${id}`)).json();
    expect(after.name).toBe("Marla V.");
    expect(after.personality).toBe(FULL.personality);
    expect(after.scenario).toBe(FULL.scenario);
    expect(after.first_message).toBe(FULL.first_message);
  });
});
