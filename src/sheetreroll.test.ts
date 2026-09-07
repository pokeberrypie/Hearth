/**
 * "Start again with a different character" did nothing at all.
 *
 * Not slowly, not with an error — nothing. No dialog, no request, no line in
 * the console. The sheet card draws the button with id `csReroll`; the code
 * that wires it asked for `sheetReroll`, an id that appears nowhere in the
 * app. `$()` returned null, the `if` guarding it took the other branch, and
 * the button sat there looking exactly like a button.
 *
 * Reported by somebody trying tabletop mode for the first time, who assumed
 * the feature was unfinished. Reasonable: from the outside there is no
 * difference between a control that does nothing and one that was never
 * finished, which is what makes this kind of bug expensive.
 *
 * The endpoint behind it was fine the whole time and is checked here too — so
 * that if this ever breaks again, the test says which half broke.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db, wipe } from "./test-support";

const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`http://home.test${path}`, init), HOME);

const OWNER = "persona-1";

const SHEET = {
  klass: "fighter", race: "", level: 1, hp: 12, maxHp: 12,
  abilities: { str: 15, dex: 13, con: 15, int: 12, wis: 10, cha: 9 },
  skills: [], inventory: [],
};

function seedSheet() {
  wipe();
  db.query(
    "INSERT INTO sheets (owner_id, owner_kind, sheet, updated_at) VALUES (?,?,?,?)",
  ).run(OWNER, "persona", JSON.stringify(SHEET), Date.now());
}

describe("the button", () => {
  const APP = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");

  test("is wired to the id the sheet actually draws", () => {
    expect(APP).toContain(`id="csReroll"`);
    expect(APP).toContain(`$("#csReroll")`);
  });

  test("and nothing still reaches for the id that never existed", () => {
    // The whole bug, in one string. Everything below this line passed while
    // the button was dead, which is the reason this assertion is here at all.
    //
    // Asserted on the boolean rather than the file: a failure here otherwise
    // prints the entire three-hundred-kilobyte script as the "received" value,
    // which buries the one line that matters.
    expect(APP.includes("sheetReroll")).toBe(false);
  });
});

describe("the question it asks first", () => {
  const APP = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");
  const call = APP.slice(APP.indexOf(`title: "Start again?"`) - 400,
                         APP.indexOf(`title: "Start again?"`) + 400);

  test("says what actually happens", () => {
    /*
     * ask() takes a title and nothing else. The sentence written for this was
     * passed to it as a second argument and dropped, so the question would
     * have come up under the stock "This cannot be undone" — which is true but
     * says nothing about what is being thrown away, and a sheet is an evening
     * of somebody's game.
     *
     * It went unnoticed for the obvious reason: the button never opened a
     * dialog at all. One dead handler hid the other bug completely.
     */
    expect(call).toContain("askDialog");
    expect(call).toContain("The sheet you have now is replaced");
  });

  test("and still lets somebody who turned confirmations off past it", () => {
    // What ask() did for free, and what going around ask() has to do by hand.
    expect(call).toContain("askBeforeDelete &&");
  });
});

describe("what pressing it does", () => {
  test("throws the sheet away", async () => {
    seedSheet();
    expect((await (await ask(`/api/sheets/${OWNER}`)).json()).sheet).toBeTruthy();

    const res = await ask(`/api/sheets/${OWNER}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    expect((await (await ask(`/api/sheets/${OWNER}`)).json()).sheet).toBeNull();
  });

  test("and leaves everybody else's alone", async () => {
    seedSheet();
    db.query(
      "INSERT INTO sheets (owner_id, owner_kind, sheet, updated_at) VALUES (?,?,?,?)",
    ).run("persona-2", "persona", JSON.stringify(SHEET), Date.now());

    await ask(`/api/sheets/${OWNER}`, { method: "DELETE" });

    expect((await (await ask("/api/sheets/persona-2")).json()).sheet).toBeTruthy();
  });

  test("asking twice is not an error", async () => {
    // The card is redrawn from the server after the delete, but a double tap
    // on a phone gets there first. Nothing to delete is not a failure.
    seedSheet();
    await ask(`/api/sheets/${OWNER}`, { method: "DELETE" });
    expect((await ask(`/api/sheets/${OWNER}`, { method: "DELETE" })).status).toBe(200);
  });
});
