/**
 * Real files, brought in the way the app brings them in. Build 154 narrowed what a lorebook's entries could be, to
 * keep out bad input, and every SillyTavern lorebook — entries keyed by number, not a list — came in "0 of 0": the
 * tests sent bad input and checked it was refused, and none sent a real book and checked it arrived.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { db, wipe } from "./test-support";
import { looseKind, planBackup } from "./backup";
const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const send = (path: string, method: string, body: unknown) =>
  app.fetch(new Request(`http://home.test/api${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), HOME);
const bytes = (s: string) => new TextEncoder().encode(s);

const WORLD_INFO = { entries: {
  "0": { uid: 0, key: ["Winterfell"], keysecondary: [], comment: "Winterfell", content: "Seat of House Stark.", constant: false, disable: false, order: 100, position: 0, probability: 100, useProbability: true },
  "1": { uid: 1, key: ["Wall"], keysecondary: ["Night's Watch"], comment: "", content: "It guards the realms of men.", constant: true, disable: false, order: 50, position: 1 },
  "2": { uid: 2, key: ["Old Gods"], keysecondary: [], comment: "", content: "The heart trees.", constant: false, disable: true, order: 10, position: 0 },
} };
const CARD = { spec: "chara_card_v2", spec_version: "2.0", data: { name: "Arya Stark", description: "A girl with a sword.", personality: "", scenario: "", first_mes: "Not today.", mes_example: "",
  character_book: { entries: [{ keys: ["Needle"], content: "Her sword.", enabled: true, insertion_order: 0 }] } } };
const PRESET = { temperature: 0.85, top_p: 0.92, prompts: [{ identifier: "main", content: "Write the next reply." }], prompt_order: [] };
const CHAT = [{ user_name: "Yvenna", character_name: "Arya Stark" }, { name: "Arya Stark", is_user: false, mes: "Not today.", swipes: ["Not today.", "Valar morghulis."], swipe_id: 0 }, { name: "Yvenna", is_user: true, mes: "I draw." }]
  .map((l) => JSON.stringify(l)).join("\n");

beforeEach(() => wipe());

describe("a lorebook, as the Lore tab sends it", () => {
  const books = () => (db.query("SELECT name, entries FROM lorebooks").all() as any[]).map((b) => ({ name: b.name, entries: JSON.parse(b.entries) }));

  test("SillyTavern's World Info — entries keyed by number — comes in whole", async () => {
    // The page sends the whole file as `entries` (app.js, #loreImport).
    expect((await send("/lorebooks", "POST", { name: "The North", entries: WORLD_INFO })).status).toBe(200);
    const [b] = books();
    expect(b.entries.length).toBe(3);
    expect(b.entries.filter((e: any) => e.enabled).length).toBe(2);
    expect(b.entries.map((e: any) => e.content)).toContain("Seat of House Stark.");
  });

  test("and a plain list of entries, and a card's book", async () => {
    await send("/lorebooks", "POST", { name: "South", entries: [{ keys: ["Highgarden"], content: "Tyrells.", enabled: true }] });
    await send("/lorebooks", "POST", { name: "Riverlands", entries: { name: "Riverlands", entries: [{ keys: ["Riverrun"], content: "Tullys.", enabled: true }] } });
    expect(books().map((b) => [b.name, b.entries.length])).toEqual([["South", 1], ["Riverlands", 1]]);
  });

  test("and what is not entries at all is an empty book, not a crash", async () => {
    expect((await send("/lorebooks", "POST", { name: "Odd", entries: "nonsense" })).status).toBe(200);
    expect(books()[0].entries).toEqual([]);
  });
});

describe("files picked by hand, on their own, are known by what is in them", () => {
  const one = (name: string, text: string) => looseKind(name, () => bytes(text));

  test("a lorebook, a card, a preset, a chat — and what is none of those", () => {
    expect(one("north.json", JSON.stringify(WORLD_INFO))?.kind).toBe("lorebook");
    expect(one("list.json", JSON.stringify([{ key: ["a"], content: "x" }]))?.kind).toBe("lorebook");
    expect(one("arya.json", JSON.stringify(CARD))?.kind).toBe("character");
    expect(one("sandor.json", JSON.stringify({ name: "Sandor", first_mes: "Hm.", description: "" }))?.kind).toBe("character");
    expect(one("preset.json", JSON.stringify(PRESET))?.kind).toBe("preset");
    expect(one("chat.jsonl", CHAT)).toMatchObject({ kind: "chat", character: "Arya Stark" });
    expect(one("face.jpg", "")?.kind).toBe("picture");
    for (const junk of ["{}", "[]", "[1,2]", "null", "{\"entries\":{}}", "{\"a\":1}", "not json"]) expect([junk, one("x.json", junk)]).toEqual([junk, null]);
  });

  test("only on their own: a whole backup's other JSON is left as it was", () => {
    const plan = planBackup([
      { path: "north.json", read: () => bytes(JSON.stringify(WORLD_INFO)) },
      { path: "data/default-user/extensions/thing/entries.json", read: () => bytes(JSON.stringify(WORLD_INFO)) },
      { path: "data/default-user/worlds/east.json", read: () => bytes(JSON.stringify(WORLD_INFO)) },
    ]);
    expect(plan.lorebooks.map((b) => b.name).sort()).toEqual(["east", "north"]);
  });

  test("brought in, a loose chat finds its character in the library", async () => {
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('a', 'Arya Stark', 1)").run();
    const form = new FormData();
    form.append("files", new Blob([CHAT]), "Arya Stark - 2026.jsonl");
    form.append("files", new Blob([JSON.stringify(WORLD_INFO)]), "north.json");
    const r = await app.fetch(new Request("http://home.test/api/import/backup", { method: "POST", body: form }), HOME);
    expect(r.status).toBe(200);
    await r.text();
    const chats = db.query("SELECT id, character_id FROM chats").all() as any[];
    expect(chats.map((c) => c.character_id)).toEqual(["a"]);
    expect((db.query("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?").get(chats[0].id) as any).n).toBe(2);
    expect((db.query("SELECT entries FROM lorebooks").all() as any[]).map((b) => JSON.parse(b.entries).length)).toEqual([3]);
  });
});
