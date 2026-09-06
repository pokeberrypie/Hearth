/**
 * The inspector has to describe the character who is about to speak.
 *
 * In a group there is one Character section and five people it could be about.
 * The panel exists to show what will actually be sent — so if it builds its
 * prompt for somebody other than the one whose turn it is, it is not a
 * preview, it is a different question answered confidently.
 *
 * That is what it was doing. The client posted mode, guide and content and no
 * speaker, so the server fell back to "whoever has been quietest" and the
 * Character section described them instead. Reported from a real game: Joffrey
 * was the one talking and the section was Olenna's. And because a full tie is
 * broken at random, two openings of the same panel could disagree.
 */

import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db, wipe } from "./test-support";

const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const post = (path: string, body: unknown) =>
  app.fetch(new Request(`http://home.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), HOME);

const CHAT = "g1";

/** A room with two people in it, each with a description of their own. */
function seedGroup() {
  wipe();
  const t = Date.now();
  const add = (id: string, name: string, description: string) =>
    db.query(
      "INSERT INTO characters (id, name, description, created_at) VALUES (?,?,?,?)",
    ).run(id, name, description, t);

  add("joffrey", "Joffrey", "A boy king, and pleased about it.");
  add("olenna", "Olenna", "Old, rich, and done pretending to be polite.");

  db.query(
    "INSERT INTO chats (id, character_id, title, is_group, created_at, updated_at) VALUES (?,?,?,?,?,?)",
  ).run(CHAT, "joffrey", "The wedding", 1, t, t);

  for (const [i, id] of ["joffrey", "olenna"].entries()) {
    db.query(
      "INSERT INTO chat_members (id, chat_id, character_id, position, muted) VALUES (?,?,?,?,0)",
    ).run(`m${i}`, CHAT, id, i);
  }

  // Joffrey has spoken; Olenna has not. So "quietest" is Olenna, and any
  // fallback will pick her — which is exactly how the bug hid.
  db.query(
    "INSERT INTO messages (id, chat_id, role, name, content, character_id, created_at) VALUES (?,?,?,?,?,?,?)",
  ).run("u1", CHAT, "user", "", "Say something.", null, t);
  db.query(
    "INSERT INTO messages (id, chat_id, role, name, content, character_id, created_at) VALUES (?,?,?,?,?,?,?)",
  ).run("a1", CHAT, "assistant", "Joffrey", "I am the king.", "joffrey", t + 1);
}

const inspect = async (speaker?: string) => {
  seedGroup();
  const body: Record<string, unknown> = { mode: "reply", guide: "", content: "Go on." };
  if (speaker !== undefined) body.speaker = speaker;
  return (await post(`/api/chats/${CHAT}/inspect`, body)).json();
};

describe("asked for a particular speaker", () => {
  test("that is who it builds the prompt for", async () => {
    const r = await inspect("joffrey");
    expect(r.speaker?.name).toBe("Joffrey");
    expect(r.system).toContain("A boy king");
  });

  test("and the other one is scenery, not the subject", async () => {
    const r = await inspect("joffrey");
    // Olenna is still named — the model is told who else is in the room — but
    // she is not the character it is being asked to be.
    expect(r.system).toContain("Olenna");
    expect(r.system.indexOf("A boy king")).toBeLessThan(r.system.indexOf("Also in the scene"));
  });

  test("the same question, the other way round", async () => {
    const r = await inspect("olenna");
    expect(r.speaker?.name).toBe("Olenna");
    expect(r.system).toContain("done pretending");
  });
});

describe("the client's half of the contract", () => {
  /*
   * Everything above proves the server answers correctly when it is asked
   * properly. The bug was that it never was: the page posted mode, guide and
   * content and no speaker at all, so every test like the ones above passed
   * while the panel on screen described the wrong character.
   *
   * So this reads the page. It is a coarse check, and it is the only thing
   * standing between "the server behaves" and "the feature works".
   */
  const APP = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");

  test("the inspector posts the speaker it is looking at", () => {
    const call = APP.slice(APP.indexOf("/inspect"), APP.indexOf("/inspect") + 900);
    expect(call).toContain("speaker");
    expect(call).toContain("S.speaker");
  });

  test("and so does the send, which is what it is previewing", () => {
    expect(APP).toContain("speaker: S.speaker");
  });
});

describe("what it reports", () => {
  test("always says whose prompt this is", async () => {
    // The panel showed a Character section without naming whose it was, so a
    // wrong one looked exactly like a right one.
    for (const who of ["joffrey", "olenna"]) {
      const r = await inspect(who);
      expect(r.speaker?.id).toBe(who);
      expect(r.speaker?.name).toBeTruthy();
    }
  });

  test("with no speaker named it still answers, and says who it chose", async () => {
    const r = await inspect(undefined);
    expect(r.speaker?.name).toBeTruthy();
    expect(["Joffrey", "Olenna"]).toContain(r.speaker.name);
  });
});
