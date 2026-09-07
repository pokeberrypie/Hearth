/**
 * The room you are in: who is in it, what it is called, and where all of that
 * is managed from.
 *
 * Two surfaces, and the split between them is the point. The strip above the
 * chat is the turn-picker and nothing else — it appears for groups, where
 * there is a turn to hand out, and a face hands it over. Everything about the
 * room itself lives on a page in the Cast panel: the story's name, the
 * scenario, who is in it, adding and dropping people.
 *
 * That split was learnt the hard way. The strip briefly carried all of it, in
 * every chat, and on a phone it put "JAIME LA…" between a pencil and an icon
 * directly under a title bar already reading "JAIME LANNISTE…". Managing a
 * room is not something you do while reading, and it should not sit on top of
 * the thing being read.
 *
 * The interesting server behaviour underneath is that a solo chat can become a
 * group and back: adding a second character seeds the missing member row and
 * flips `is_group`, and dropping back to one flips it again. That is tested
 * properly here. The wiring that decides which surface offers what is
 * browser-side, so it is read out of app.js — the same reason the other client
 * contracts in this suite are.
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
    // back to the character the chat was started with. The scene page draws
    // from this, so a solo chat that reported nobody would draw an empty room.
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
    // The scene page shows this title. A chat called "" would read as a bug
    // there, and the prompt that sets it is one keystroke from producing one.
    const { chat } = await seed();
    await send(`/api/chats/${chat}`, "PUT", { title: "   " });
    expect(chatRow(chat).title).toBe("Marla Vance");
  });
});

describe("the scenario", () => {
  test("saves on its own, without touching anything else", async () => {
    // The scene page sends only this field. Everything else the chat holds
    // has to survive that.
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

describe("the strip above the chat stays what it was", () => {
  const APP = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");
  const renderRoom = (() => {
    const start = APP.indexOf("function renderRoom(");
    return APP.slice(start, APP.indexOf("\n}\n", start));
  })();

  test("it is the turn-picker, so it appears where there is a turn to pick", () => {
    /*
     * It briefly showed in every chat and carried the chat's name, a scenario
     * button and an add button. On a phone that put "JAIME LA…" between a
     * pencil and an icon directly under a title bar already reading "JAIME
     * LANNISTE…" — the same name, truncated twice, ten pixels apart.
     *
     * Managing a room is not something you do while reading. It is in the Cast
     * panel now. What is over the thread is the one thing that is about the
     * next line rather than about the room: whose turn it is.
     */
    expect(renderRoom).toContain("bar.hidden = S.cast.length < 2;");
  });

  test("and it holds nothing but faces, the hint, and the way into the room", () => {
    expect(renderRoom).toContain("castface");
    expect(renderRoom).toContain("casthint");
    expect(renderRoom).toContain("castedit");
    for (const gone of ["castname", "castscene", "castfaces", "renameChat", "openScenario"]) {
      expect(renderRoom.includes(gone)).toBe(false);
    }
  });

  test("a face still hands over the turn, and hands it back", () => {
    expect(renderRoom).toContain("S.speaker = S.speaker === m.id ? null : m.id;");
    expect(renderRoom).toContain("if (m.muted) return;");
  });
});

describe("this scene, in the Cast panel", () => {
  const APP = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");
  const HTML = readFileSync(join(import.meta.dir, "..", "public", "index.html"), "utf8");
  const scene = (() => {
    const start = APP.indexOf("async function renderScene(");
    return APP.slice(start, APP.indexOf("\n}\n", start));
  })();

  test("the Cast panel has two pages and the markup for both", () => {
    expect(HTML).toContain(`id="sceneNow"`);
    expect(HTML).toContain(`id="castLibrary"`);
    expect(HTML).toContain(`id="sceneAll"`);
    expect(HTML).toContain(`id="sceneBack"`);
  });

  test("it carries the four things it was asked to carry", () => {
    // Rename, scenario, adding, removing. All of it here, none of it over the
    // story.
    expect(APP).toContain(`$("#sceneTitleBtn").onclick = () => renameChat();`);
    expect(scene).toContain(`$("#sceneScenario")`);
    expect(scene).toContain(`$("#scene_search")`);
    expect(scene).toContain("data-drop");
    expect(scene).toContain("data-edit-member");
  });

  test("the scene page opens first while a chat is running", () => {
    expect(APP).toContain(`if (tab === "cast") paintCastView();`);
    expect(APP).toMatch(/castView = "scene";\s*\n\s*paintCastView\(\);/);
  });

  test("and there is no scene page without a chat", () => {
    const paint = APP.slice(APP.indexOf("function paintCastView()"));
    expect(paint.slice(0, 500)).toContain("const inChat = !!S.chatId;");
    expect(paint.slice(0, 500)).toContain(`$("#sceneBack").hidden = !inChat;`);
    // Leaving a chat puts the panel back to the library.
    expect(APP).toMatch(/castView = "library";\s*\n\s*paintCastView\(\);/);
  });

  test("muting and dropping are group questions and only asked in groups", () => {
    // In a solo chat there is nobody to take the turn instead, and nobody left
    // if the one person goes.
    expect(scene).toContain("const group = S.cast.length > 1;");
    expect(scene).toMatch(/group\s*\?\s*`<label class="switch"/);
    expect(scene).toContain(`auto.closest("label").hidden = !group;`);
  });

  test("the scenario keeps the members dialog's copy of it in step", () => {
    // Two boxes onto one value; the other is only filled when its dialog opens.
    expect(scene).toContain(`if ($("#roomScenario")) $("#roomScenario").value = sc.value;`);
  });
});

describe("naming, wherever it is asked for", () => {
  const APP = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");

  test("goes through one function", () => {
    // The scene page, the chat menu, and the row for any chat in "Manage chat
    // files". They were three copies and the copies had drifted.
    expect(APP).toContain("async function renameChat(id = S.chatId");
    expect(APP.match(/askFor\("Name this chat"/g) ?? []).toHaveLength(1);
    expect(APP).toMatch(/case "rename": \{[\s\S]{0,220}await renameChat\(\);/);
    expect(APP).toContain(`if (await renameChat(c.id, c.title ?? "")) await renderFiles();`);
  });

  test("the scene page's button does not hand the click event in as a chat id", () => {
    // renameChat's first parameter is an id; an onclick handler is called with
    // the event, so a bare reference would rename a chat called
    // [object PointerEvent].
    expect(APP).toContain("$(\"#sceneTitleBtn\").onclick = () => renameChat();");
  });

  test("cancelling the prompt does not clear the name", () => {
    expect(APP.includes("if (title === null) return false;")).toBe(true);
  });
});

describe("naming the story when it opens", () => {
  const APP = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");
  const HTML = readFileSync(join(import.meta.dir, "..", "public", "index.html"), "utf8");

  test("the question is asked in the one already asked at the top of a chat", () => {
    // Rather than as a prompt of its own, and rather than as a control sitting
    // over the story for the rest of the evening.
    expect(HTML).toContain(`id="storyName"`);
    expect(HTML).toContain("Name your story");
    expect(APP).toContain(`const story = $("#storyName");`);
  });

  test("it is left blank, with the character's name as the placeholder", () => {
    // A box already holding the answer you would have got anyway is a box
    // nobody reads. Blank means "keep the name it has".
    const fn = APP.slice(APP.indexOf("async function askAboutRecord("));
    expect(fn.slice(0, 1600)).toContain(`story.value = "";`);
    expect(fn.slice(0, 1600)).toContain("story.placeholder = chat.character_name;");
  });

  test("naming the story names the chronicle under it, until somebody types their own", () => {
    const fn = APP.slice(APP.indexOf("async function askAboutRecord("));
    expect(fn.slice(0, 2200)).toContain("let notesTouched = false;");
    expect(fn.slice(0, 2200)).toContain("name.oninput = () => { notesTouched = true; };");
  });

  test("and the name is saved even if the chronicle is declined", () => {
    // Two answers to two questions. Somebody who names their story and then
    // says no to notes should still have named their story.
    const go = APP.slice(APP.indexOf(`$("#loreWelcomeGo").onclick`));
    expect(go.slice(0, 1400)).toContain("const told = story.value.trim();");
    expect(go.indexOf("const told = story.value.trim();"))
      .toBeLessThan(go.indexOf("/autolore"));
  });
});
