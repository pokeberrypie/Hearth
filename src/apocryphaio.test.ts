/**
 * Stories in and out of the Apocrypha, and a model writing parts of one.
 *
 *   bun test src/apocryphaio.test.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { readImport, readOutline, toOutline } from "./apocrypha";
import { db, setSettings, wipe } from "./test-support";

const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body?: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const OUTLINE = `# The Champion of the Hand
A marriage on her own terms.

## The Tourney
Where it starts.

### A Lion Cornered
Setting: The Red Keep, that evening
Cast: Jaime, Cersei
Purpose: Cersei learns of the betrothal
Beats:
- a dropped cup
- a threat, quietly made
Ending: Jaime leaves without answering

### The Feast
Where: The Great Hall
Who: everyone
`;

describe("the outline text", () => {
  test("reads names, chapters, scenes and loosely named fields", () => {
    const b = readOutline(OUTLINE)!;
    expect(b.name).toBe("The Champion of the Hand");
    expect(b.premise).toBe("A marriage on her own terms.");
    expect(b.chapters).toHaveLength(1);
    expect(b.chapters[0]).toMatchObject({ title: "The Tourney", summary: "Where it starts." });
    expect(b.chapters[0].scenes[0]).toMatchObject({
      title: "A Lion Cornered", setting: "The Red Keep, that evening", cast: "Jaime, Cersei",
      purpose: "Cersei learns of the betrothal", beats: "- a dropped cup\n- a threat, quietly made",
      ending: "Jaime leaves without answering",
    });
    expect(b.chapters[0].scenes[1]).toMatchObject({ title: "The Feast", setting: "The Great Hall", cast: "everyone" });
  });

  test("round-trips through export", () => {
    const b = readOutline(OUTLINE)!;
    const again = readOutline(toOutline({ ...b, chapters: b.chapters }))!;
    expect(again.name).toBe(b.name);
    expect(again.chapters[0].scenes.map((s) => [s.title, s.setting, s.beats])).toEqual(b.chapters[0].scenes.map((s) => [s.title, s.setting, s.beats]));
  });

  test("a model's untidy answer still lands: bold labels, \"Chapter 1:\" prefixes, a fence, chatter", () => {
    const b = readOutline("Sure! Here you go:\n## Chapter 1: Ashes\n### Scene 1 - The Pyre\n**Setting:** a hillside at dusk\n**Beats:**\n- smoke\n**Ending:** night falls")!;
    expect(b.chapters[0].title).toBe("Ashes");
    expect(b.chapters[0].scenes[0]).toMatchObject({ title: "The Pyre", setting: "a hillside at dusk", beats: "- smoke", ending: "night falls" });
  });

  test("Hearth's own JSON, one book or several; anything else is nothing", () => {
    expect(readImport(JSON.stringify({ hearth: "apocrypha", name: "A", premise: "p", chapters: [] }))[0]).toMatchObject({ name: "A", premise: "p" });
    expect(readImport(JSON.stringify([{ name: "A", chapters: [] }, { name: "B", chapters: [] }]))).toHaveLength(2);
    expect(readImport('{"not": "a story"}')).toEqual([]);
    expect(readImport("")).toEqual([]);
  });
});

describe("the routes", () => {
  const realFetch = globalThis.fetch;
  let answer = "";
  beforeEach(() => {
    wipe();
    db.query("DELETE FROM apocrypha").run();
    setSettings({ provider: "openrouter", key_openrouter: "sk-test", model: "test/model", steward_on: "0" });
    globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: answer } }] })) as any;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  test("import makes the book; export gives it back in either form", async () => {
    const r = await (await send("/api/apocrypha/import", "POST", { text: OUTLINE, filename: "x.md" })).json();
    expect(r.books).toHaveLength(1);
    const md = await (await ask(`/api/apocrypha/${r.books[0].id}/export?format=md`)).json();
    expect(md.text).toContain("### A Lion Cornered");
    const js = await (await ask(`/api/apocrypha/${r.books[0].id}/export`)).json();
    const again = await (await send("/api/apocrypha/import", "POST", { text: js.text })).json();
    expect(again.books[0].name).toBe("The Champion of the Hand");
    expect((await (await send("/api/apocrypha/import", "POST", { text: "just some words" })).json()).books?.[0]?.name).toBe("An untold story");
    expect((await send("/api/apocrypha/import", "POST", { text: "" })).status).toBe(400);
  });

  test("writing: chapters, a scene's blanks, a premise — and a non-answer is an error, not an empty book", async () => {
    const book = readOutline(OUTLINE)!;
    answer = "<think>hmm</think>## The Wedding\n### Vows\nSetting: the sept\nPurpose: it happens";
    const ch = await (await send("/api/apocrypha/write", "POST", { what: "outline", book })).json();
    expect(ch.chapters[0]).toMatchObject({ title: "The Wedding" });
    expect(ch.chapters[0].scenes[0]).toMatchObject({ title: "Vows", setting: "the sept" });

    answer = "### The Feast\nSetting: The Great Hall\nPurpose: a toast goes wrong\nEnding: Cersei leaves";
    const sc = await (await send("/api/apocrypha/write", "POST", { what: "scene", book, chapter: 0, scene: 1 })).json();
    expect(sc.scene).toMatchObject({ purpose: "a toast goes wrong", ending: "Cersei leaves" });

    answer = "Premise: A Hightower daughter bargains for a husband and finds she has bargained for a war.";
    const p = await (await send("/api/apocrypha/write", "POST", { what: "premise", book })).json();
    expect(p.premise).toStartWith("A Hightower daughter");

    answer = "I'm sorry, I can't help with that.";
    expect((await send("/api/apocrypha/write", "POST", { what: "outline", book })).status).toBe(502);
  });
});
