/**
 * Who answers when the player sends, in a group.
 *
 * The quietest, as it always was; down the list, in the order the author has
 * dragged the cast into; or whoever the latest message names first — the
 * player's, or a character's — by their own name, never their house, and down
 * the list when nobody is named.
 * The old auto-reply switch saved a choice nothing read.
 */

import { describe, expect, test } from "bun:test";

import { db, wipe } from "./test-support";

const { app, nextSpeaker, firstMention, calledOn } = await import("./index");

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
const spoke = (who: string | null, content = "Said.") => db.query("INSERT INTO messages (id, chat_id, role, name, content, created_at, character_id) VALUES (?, 'ch', 'assistant', '', ?, ?, ?)")
  .run(`s${Math.random()}`, content, ++t, who);
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
    // A house is not a person: "the Lannisters" does not call on Jaime. And my message before it is not a reply,
    // so its naming Davren is spent: down the list, after Jaime.
    player("Davren, go.");
    player("The Lannisters will hear of this.");
    expect(next()).toBe("Ser Arys Oakheart");
  });

  test("a character who asks someone something is answered by them", () => {
    seed("named");
    spoke("j", 'Jaime glanced back at the road. "Davren. What do you make of it?"');
    // Sent empty, to let the scene go on: Davren answers Jaime — down the list would have been Arys.
    expect(next()).toBe("Davren Baratheon");
    spoke("d", 'Davren shook his head. "Ask Arys, he has the better eyes."');
    // Down the list would have gone round to Jaime.
    expect(next()).toBe("Ser Arys Oakheart");
  });

  test("my message naming nobody leaves it to the reply before it; naming someone, it is mine", () => {
    seed("named");
    spoke("j", '"Davren," Jaime said, "ride ahead."');
    player("*Yvenna waits, watching the treeline.*");
    expect(next()).toBe("Davren Baratheon");
    player("Arys, stay with me.");
    expect(next()).toBe("Ser Arys Oakheart");
  });

  test("only the latest reply counts: an old question is not answered forever", () => {
    seed("named");
    spoke("j", '"Davren, ride ahead."');
    spoke("d", "Davren rode on without a word.");
    // Davren's own name is all through his reply, and it names no one else: down the list, after Davren.
    expect(next()).toBe("Jaime Lannister");
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

  test("in a reply, the speaker never counts, and what is said aloud comes before what is told", () => {
    const cast = [{ id: "j", name: "Jaime Lannister" }, { id: "a", name: "Ser Arys Oakheart" }, { id: "d", name: "Davren Baratheon" }];
    const line = 'Jaime glanced at Davren. “Arys, take the left.”';
    expect(calledOn(line, cast, "j").name).toBe("Ser Arys Oakheart");
    // Nothing named aloud: the telling decides.
    expect(calledOn("Jaime glanced at Davren.", cast, "j").name).toBe("Davren Baratheon");
    // The narrator, speaking for no one, still puts dialogue first.
    expect(calledOn('Davren drew rein. "Jaime!" someone shouted.', cast, "").name).toBe("Jaime Lannister");
    // My own message reads in order, quotes or not.
    expect(calledOn('Jaime glanced at Davren. "Arys, take the left."', cast, null).name).toBe("Jaime Lannister");
  });

  test("a name is found where it first stands, as a whole word", () => {
    expect(firstMention("Ser Arys, walk with me", "Ser Arys Oakheart")).toBe(4);
    expect(firstMention("Davrenson is not Davren", "Davren Baratheon")).toBe(17);
    expect(firstMention("Nobody here", "Davren Baratheon")).toBe(-1);
  });
});
