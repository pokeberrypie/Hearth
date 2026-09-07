/**
 * The strip above a chat, and the room it describes.
 *
 * It used to appear only once a chat had two or more people in it, on the
 * reasoning that a solo chat has no turn to hand out and therefore nothing to
 * press. That was true of the one job the strip had and wrong about the room:
 * in a solo chat you still want to fix a line in the card you are talking to,
 * set the scene, give the chat a name that is not the character's, or bring
 * somebody else in.
 *
 * That last one is the interesting half. The server has always been able to
 * turn a solo chat into a group — it seeds the missing member row and flips
 * `is_group` — and nothing in the app ever offered it, because the only way in
 * was a button on a strip that solo chats did not draw.
 *
 * The server behaviour is tested here properly. The wiring that decides which
 * of those things a face does is browser-side, so it is read out of app.js —
 * the same reason the other client contracts in this suite are.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db, wipe } from "./test-support";

const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function seed() {
  wipe();
  const make = async (name: string) =>
    (await (await send("/api/characters", "POST", { name, description: `${name} is here.` })).json()).id as string;
  const marla = await make("Marla Vance");
  const edwin = await make("Edwin Ash");
  const colm = await make("Sister Colm");
  const chat = (await (await send("/api/chats", "POST", { character_id: marla })).json()).id as string;
  return { marla, edwin, colm, chat };
}

const chatRow = (id: string) => db.query("SELECT * FROM chats WHERE id = ?").get(id) as any;
const members = async (id: string) => (await (await ask(`/api/chats/${id}/members`)).json()) as any[];

describe("a solo chat is a room with one person in it", () => {
  test("it reports that person as its cast", async () => {
    // There is no chat_members row at all for a solo chat — membersOf falls
    // back to the character the chat was started with. The strip draws from
    // this, so a solo chat that reported nobody would draw an empty strip.
    const { chat } = await seed();
    const list = await members(chat);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Marla Vance");
  });

  test("and is not marked as a group", async () => {
    const { chat } = await seed();
    expect(chatRow(chat).is_group).toBe(0);
  });
});

describe("bringing somebody into a solo chat", () => {
  test("makes it a group, keeping the one who was already there", async () => {
    const { chat, edwin } = await seed();
    await send(`/api/chats/${chat}/members`, "POST", { add: edwin });

    const list = await members(chat);
    expect(list.map((m) => m.name)).toEqual(["Marla Vance", "Edwin Ash"]);
    expect(chatRow(chat).is_group).toBe(1);
  });

  test("the first one keeps their place at the front", async () => {
    // Whoever the chat was started with is position 0, seeded before the new
    // arrival. A group that reordered itself when somebody walked in would
    // shuffle the faces in the strip for no reason anybody could see.
    const { chat, edwin, colm } = await seed();
    await send(`/api/chats/${chat}/members`, "POST", { add: edwin });
    await send(`/api/chats/${chat}/members`, "POST", { add: colm });
    expect((await members(chat)).map((m) => m.name))
      .toEqual(["Marla Vance", "Edwin Ash", "Sister Colm"]);
  });
});

describe("emptying a group back down", () => {
  test("one person left is a solo chat again", async () => {
    const { chat, edwin } = await seed();
    await send(`/api/chats/${chat}/members`, "POST", { add: edwin });
    expect(chatRow(chat).is_group).toBe(1);

    await send(`/api/chats/${chat}/members`, "POST", { remove: edwin });
    expect(chatRow(chat).is_group).toBe(0);
    expect((await members(chat)).map((m) => m.name)).toEqual(["Marla Vance"]);
  });

  test("and the chat still belongs to whoever is left", async () => {
    // is_group and character_id move together. If they part company the chat
    // opens on somebody who is not in it.
    const { chat, marla, edwin } = await seed();
    await send(`/api/chats/${chat}/members`, "POST", { add: edwin });
    await send(`/api/chats/${chat}/members`, "POST", { remove: marla });
    const row = chatRow(chat);
    expect(row.is_group).toBe(0);
    expect(row.character_id).toBe(edwin);
  });
});

describe("naming a chat", () => {
  test("it starts named after the character", async () => {
    const { chat } = await seed();
    expect(chatRow(chat).title).toBe("Marla Vance");
  });

  test("and can be given a name of its own", async () => {
    const { chat } = await seed();
    await send(`/api/chats/${chat}`, "PUT", { title: "The night the lamp failed" });
    expect(chatRow(chat).title).toBe("The night the lamp failed");
  });

  test("a blank name is refused rather than stored", async () => {
    // The strip shows this title. A chat called "" would read as a bug there,
    // and the prompt that sets it is one keystroke from producing one.
    const { chat } = await seed();
    await send(`/api/chats/${chat}`, "PUT", { title: "   " });
    expect(chatRow(chat).title).toBe("Marla Vance");
  });
});

describe("the scenario", () => {
  test("saves on its own, without touching anything else", async () => {
    // The strip's scenario button sends only this field. Everything the chat
    // already holds has to survive that.
    const { chat } = await seed();
    await send(`/api/chats/${chat}`, "PUT", { title: "The night the lamp failed" });
    await send(`/api/chats/${chat}`, "PUT", { scenario: "The lamp has failed three nights running." });

    const row = chatRow(chat);
    expect(row.scenario).toBe("The lamp has failed three nights running.");
    expect(row.title).toBe("The night the lamp failed");
  });

  test("and can be cleared back to nothing", async () => {
    const { chat } = await seed();
    await send(`/api/chats/${chat}`, "PUT", { scenario: "Something." });
    await send(`/api/chats/${chat}`, "PUT", { scenario: "" });
    expect(chatRow(chat).scenario).toBe("");
  });
});

describe("what the strip does with a face", () => {
  const APP = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");
  const renderRoom = (() => {
    const start = APP.indexOf("function renderRoom(");
    return APP.slice(start, APP.indexOf("\n}\n", start));
  })();

  test("it is drawn for a solo chat too", () => {
    // The whole point. `S.cast.length < 2` was the old condition and it is the
    // one thing that must not come back.
    expect(renderRoom).toContain("bar.hidden = !S.chatId || !S.cast.length");
    expect(renderRoom).not.toContain("S.cast.length < 2");
  });

  test("a face hands over the turn in a group and opens the card in a solo chat", () => {
    /*
     * One gesture, two meanings, and the solo one has to come first — a solo
     * chat that fell through to the speaker-picking branch would set S.speaker
     * to the only person in the room, which is not wrong so much as pointless,
     * and would leave the card unreachable from the strip.
     */
    expect(renderRoom).toContain("if (!group) return editChar(m);");
    expect(renderRoom.indexOf("if (!group) return editChar(m);"))
      .toBeLessThan(renderRoom.indexOf("S.speaker = S.speaker === m.id ? null : m.id;"));
  });

  test("nobody is drawn as the chosen speaker when there is no choice to make", () => {
    expect(renderRoom).toContain(`(group && S.speaker === m.id ? " picked" : "")`);
  });
});

describe("the rest of the strip", () => {
  const APP = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");

  test("renaming goes through one function, wherever it was asked for", () => {
    /*
     * Three places ask: the strip, the chat menu, and the row for any chat in
     * "Manage chat files". They were three copies, and the copies had already
     * drifted — two treated a cancelled prompt and an emptied box as the same
     * answer, and none of them redrew a strip that now shows the name.
     */
    expect(APP).toContain("async function renameChat(id = S.chatId");
    expect(APP.match(/askFor\("Name this chat"/g) ?? []).toHaveLength(1);
    expect(APP).toMatch(/case "rename": \{[\s\S]{0,220}await renameChat\(\);/);
    expect(APP).toContain("if (await renameChat(c.id, c.title ?? \"\")) await renderFiles();");
  });

  test("the strip's button does not hand the click event in as a chat id", () => {
    // renameChat's first parameter is an id and an onclick handler is called
    // with the event, so `onclick = renameChat` would ask the server to rename
    // a chat called [object PointerEvent].
    expect(APP).toContain("name.onclick = () => renameChat();");
  });

  test("it says whether anything changed, for the caller that redraws a list", () => {
    const fn = APP.slice(APP.indexOf("async function renameChat(id = S.chatId"));
    expect(fn.slice(0, 1400)).toContain("return true;");
    expect(fn.slice(0, 1400)).toContain("return false;");
  });

  test("cancelling the prompt does not clear the name", () => {
    // askFor resolves null on cancel and "" on an emptied box, and those must
    // not be treated the same. Asserted on the boolean so a failure prints the
    // line rather than the whole script.
    expect(APP.includes("if (title === null) return false;")).toBe(true);
  });

  test("the scenario has a button and a dialog of its own", () => {
    expect(APP).toContain("function openScenario()");
    expect(APP).toContain(`$("#scenarioDialog").showModal()`);
    const html = readFileSync(join(import.meta.dir, "..", "public", "index.html"), "utf8");
    expect(html).toContain(`id="scenarioDialog"`);
    expect(html).toContain(`id="sc_text"`);
  });

  test("saving it keeps the members dialog's copy of the same field in step", () => {
    // Two boxes onto one value. The other one is only redrawn when its dialog
    // is opened, so it would otherwise sit there showing the old scenario.
    expect(APP).toContain(`if ($("#roomScenario")) $("#roomScenario").value = next;`);
  });

  test("every member row offers to edit that character", () => {
    expect(APP).toContain("data-edit-member");
    expect(APP).toMatch(/data-edit-member[\s\S]{0,400}\$\("#castDialog"\)\.close\(\);\s*editChar\(m\);/);
  });
});
