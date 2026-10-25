/**
 * Who answers when the player sends, in a group.
 *
 * The quietest, as it always was; down the list, in the order the author has
 * dragged the cast into; or whoever the player's message names first — by
 * their own name, never their house — and down the list when it names nobody.
 * The old auto-reply switch saved a choice nothing read.
 */

import { describe, expect, test } from "bun:test";

import { db, wipe } from "./test-support";

const { app, nextSpeaker, firstMention } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const send = (path: string, body: unknown) => app.fetch(new Request(`http://home.test${path}`,
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), HOME);

let t = 0;
function seed(order = "") {
  wipe();
  t = Date.now();
  for (const [id, name] of [["j", "Jaime Lannister"], ["a", "Ser Arys Oakheart"], ["d", "Davren Baratheon"], ["c", "Cersei Lannister"]]) {
    db.query("INSERT INTO characters (id, name, created_at) VALUES (?, ?, 1)").run(id, name);
  }
  db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at, is_group, turn_order) VALUES ('ch', 'j', 'The road', 1, 1, 1, ?)").run(order);
  db.query("INSERT INTO chat_members (id, chat_id, character_id, position) VALUES ('m1','ch','j',0), ('m2','ch','a',1), ('m3','ch','d',2)").run();
}
const spoke = (who: string) => db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at, character_id) VALUES (?, 'ch', 'assistant', '', 'Said.', ?, ?)")
  .run(`s${Math.random()}`, ++t, who);
const player = (content: string) => db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at) VALUES (?, 'ch', 'user', '', ?, ?)")
  .run(`u${Math.random()}`, content, ++t);
const chat = () => db.query("SELECT * FROM chats WHERE id = 'ch'").get() as any;
const next = () => nextSpeaker(chat())?.name;

describe("who answers", () => {
  test("down the list: the one after whoever spoke last, round again from the top", () => {
    seed("list");
    spoke("j");
    expect(next()).toBe("Ser Arys Oakheart");
    spoke("a");
    expect(next()).toBe("Davren Baratheon");
    spoke("d");
    expect(next()).toBe("Jaime Lannister");
  });

  test("the list is the order the author dragged them into", async () => {
    seed("list");
    await send("/api/chats/ch/members", { order: ["d", "j", "a"] });
    spoke("d");
    expect(next()).toBe("Jaime Lannister");
    spoke("a");
    expect(next()).toBe("Davren Baratheon");
  });

  test("whoever I name first answers — by their own name; naming nobody, down the list", () => {
    seed("named");
    spoke("j");
    player("Davren, Arys — keep watch on the road.");
    expect(next()).toBe("Davren Baratheon");
    player("Ser Arys, walk with me. Davren can wait.");
    expect(next()).toBe("Ser Arys Oakheart");
    // A house is not a person: "the Lannisters" does not call on Jaime.
    player("The Lannisters will hear of this.");
    expect(next()).toBe("Ser Arys Oakheart");
  });

  test("a muted member is never chosen, whatever the way", () => {
    seed("named");
    db.query("UPDATE chat_members SET muted = 1 WHERE character_id = 'd'").run();
    spoke("a");
    player("Davren, say something.");
    expect(next()).toBe("Jaime Lannister");
  });

  test("the way is saved, and only the ways there are", async () => {
    seed();
    expect((await (await send("/api/chats/ch/turns", { order: "named" })).json()).order).toBe("named");
    expect(chat().turn_order).toBe("named");
    expect((await (await send("/api/chats/ch/turns", { order: "chaos" })).json()).order).toBe("");
  });

  test("a name is found where it first stands, as a whole word", () => {
    expect(firstMention("Ser Arys, walk with me", "Ser Arys Oakheart")).toBe(4);
    expect(firstMention("Davrenson is not Davren", "Davren Baratheon")).toBe(17);
    expect(firstMention("Nobody here", "Davren Baratheon")).toBe(-1);
  });
});
