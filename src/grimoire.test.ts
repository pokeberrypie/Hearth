/**
 * The preset editor and the regex grimoire, from the data side.
 *
 * Two promises are tested here above everything else. A SillyTavern file that
 * passes through Hearth comes back out with everything it went in with, the
 * fields Hearth does not use included. And a preset's scripts follow the
 * preset: they run while it is the one in use and rest while it is not,
 * without anybody's existing scripts changing behaviour.
 *
 *   bun test src/grimoire.test.ts
 */

import { describe, expect, test } from "bun:test";

import { db, wipe, setSettings } from "./test-support";
import { compileError, findWith, matchesOf, normaliseScript, runScript, toSillyTavern } from "./regex";
import { fromHearth, fromSillyTavern, keptOnly, toSillyTavernPreset } from "./presets";

const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`http://home.test${path}`, init), HOME);
const send = (path: string, method: string, body: unknown) =>
  ask(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const json = async (r: Response | Promise<Response>) => (await r).json() as Promise<any>;

/** Shaped exactly as SillyTavern exports one, with a field from some later version. */
const ST_SCRIPT = (over: Record<string, unknown> = {}) => ({
  id: "st-1",
  scriptName: "Fold status",
  findRegex: "/<status>([\\s\\S]*?)<\\/status>/g",
  replaceString: "<details><summary>Status</summary>$1</details>",
  trimStrings: [],
  placement: [2],
  disabled: false,
  markdownOnly: true,
  promptOnly: false,
  runOnEdit: true,
  substituteRegex: 0,
  minDepth: null,
  maxDepth: null,
  someFutureField: { kept: true },
  ...over,
});

/** A trimmed-down SillyTavern chat-completion preset. */
const ST_PRESET = () => ({
  temperature: 0.9,
  top_p: 0.95,
  top_k: 40,
  openai_max_tokens: 800,
  openai_max_context: 32000,
  stream_openai: true,
  logit_bias: [{ text: "x", value: -50 }],
  prompts: [
    { identifier: "main", name: "Main Prompt", system_prompt: true, role: "system", content: "Write well." },
    { identifier: "charDescription", name: "Char Description", system_prompt: true, marker: true },
    { identifier: "chatHistory", name: "Chat History", system_prompt: true, marker: true },
    { identifier: "deep", name: "Deep note", role: "system", content: "Stay in character.",
      injection_position: 1, injection_depth: 4, forbid_overrides: false },
    { identifier: "empty", name: "Empty one", role: "system", content: "" },
  ],
  prompt_order: [
    { character_id: 100000, order: [{ identifier: "main", enabled: true }] },
    { character_id: 100001, order: [
      { identifier: "main", enabled: true },
      { identifier: "empty", enabled: true },
      { identifier: "charDescription", enabled: true },
      { identifier: "deep", enabled: false },
      { identifier: "chatHistory", enabled: true },
    ] },
  ],
  extensions: { regex_scripts: [ST_SCRIPT()], other_ext: { on: 1 } },
});

describe("a regex script's round trip", () => {
  test("comes back out exactly as it went in", () => {
    const raw = ST_SCRIPT({ substituteRegex: 2, minDepth: 2, maxDepth: 9, placement: [1, 2, 6] });
    expect(toSillyTavern(normaliseScript(raw))).toEqual(raw);
  });

  test("survives being stored as Hearth's own shape and read again", () => {
    const raw = ST_SCRIPT();
    const stored = JSON.parse(JSON.stringify(normaliseScript(raw)));
    expect(toSillyTavern(normaliseScript(stored))).toEqual(raw);
  });

  test("a rewrite script runs both ways here and still exports as a rewrite", () => {
    const raw = ST_SCRIPT({ markdownOnly: false, promptOnly: false });
    const s = normaliseScript(raw);
    expect(s.display && s.prompt).toBe(true);
    expect(s.rewrite).toBe(true);
    expect(toSillyTavern(s)).toEqual(raw);
  });
});

describe("the engine's new parts", () => {
  test("substituteRegex fills names into the pattern, raw or escaped", () => {
    expect(findWith({ find: "/{{char}} says/g", substitute: 0 }, { char: "A.B" })).toBe("/{{char}} says/g");
    expect(findWith({ find: "/{{char}} says/g", substitute: 1 }, { char: "A.B" })).toBe("/A.B says/g");
    expect(findWith({ find: "/{{char}} says/g", substitute: 2 }, { char: "A.B" })).toBe("/A\\.B says/g");
    const s = normaliseScript(ST_SCRIPT({ findRegex: "/{{user}}/g", replaceString: "[{{char}}]", substituteRegex: 1 }));
    expect(runScript("hi Ana", s, { user: "Ana", char: "Jaime" })).toBe("hi [Jaime]");
  });

  test("a pattern that will not compile says why", () => {
    expect(compileError("/ok/g")).toBeNull();
    expect(compileError("")).toContain("empty");
    expect(compileError("/(unclosed/g")).toBeTruthy();
    expect(compileError("/a/q")).toContain("flag");
  });

  test("matches are found where the script would replace", () => {
    const s = normaliseScript(ST_SCRIPT({ findRegex: "/o/g" }));
    expect(matchesOf("foo bo", s)).toEqual([[1, 2], [2, 3], [5, 6]]);
    const once = normaliseScript(ST_SCRIPT({ findRegex: "/o/" }));
    expect(matchesOf("foo bo", once)).toEqual([[1, 2]]);
    // A pattern that matches nothing at every position still ends.
    expect(matchesOf("abc", normaliseScript(ST_SCRIPT({ findRegex: "/x*/g" })))).toHaveLength(4);
  });
});

describe("a preset's round trip", () => {
  test("keeps everything Hearth does not use, and writes back what it changed", () => {
    const { data } = fromSillyTavern(ST_PRESET());
    data.temperature = "0.7";
    const out = toSillyTavernPreset(data) as any;
    expect(out.temperature).toBe(0.7);
    expect(out.top_k).toBe(40);
    expect(out.logit_bias).toEqual([{ text: "x", value: -50 }]);
    expect(out.extensions.other_ext).toEqual({ on: 1 });
    // The block's own SillyTavern settings ride along.
    const deep = out.prompts.find((p: any) => p.identifier === "deep");
    expect(deep).toMatchObject({ injection_position: 1, injection_depth: 4, content: "Stay in character." });
    // The empty block Hearth dropped is still there, in its place.
    expect(out.prompts.some((p: any) => p.identifier === "empty")).toBe(true);
    const order = out.prompt_order[1].order.map((o: any) => o.identifier);
    expect(order).toEqual(["main", "empty", "charDescription", "deep", "chatHistory"]);
    expect(out.prompt_order[1].order.find((o: any) => o.identifier === "deep").enabled).toBe(false);
    // The other character's list is untouched.
    expect(out.prompt_order[0]).toEqual(ST_PRESET().prompt_order[0]);
    // Markers stay placeholders; the main prompt keeps its text.
    expect(out.prompts.find((p: any) => p.identifier === "charDescription").marker).toBe(true);
    expect(out.prompts.find((p: any) => p.identifier === "main").content).toBe("Write well.");
  });

  test("an edit to a block's text and order is what goes out", () => {
    const { data } = fromSillyTavern(ST_PRESET());
    const blocks = data.blocks!;
    blocks.find((b) => b.id === "main")!.content = "Write better.";
    data.blocks = [blocks[blocks.length - 1], ...blocks.slice(0, -1)];
    const out = toSillyTavernPreset(data) as any;
    expect(out.prompts.find((p: any) => p.identifier === "main").content).toBe("Write better.");
    expect(out.prompt_order[1].order[0].identifier).toBe(data.blocks[0].id);
  });

  test("the scripts are not stored twice", () => {
    const { data } = fromSillyTavern(ST_PRESET());
    expect((data.st as any).extensions.regex_scripts).toBeUndefined();
  });

  test("a preset made in Hearth exports with only what it has", () => {
    const out = toSillyTavernPreset({ temperature: "1", blocks: [
      { id: "main", name: "Main", role: "system", content: "Hello", enabled: true, marker: "main" },
      { id: "chatHistory", name: "chatHistory", role: "system", content: "", enabled: true, marker: "chatHistory" },
    ] }) as any;
    expect(out.temperature).toBe(1);
    expect(out.top_k).toBeUndefined();
    expect(out.prompt_order).toEqual([{ character_id: 100001, order: [
      { identifier: "main", enabled: true }, { identifier: "chatHistory", enabled: true },
    ] }]);
  });

  test("lists what it keeps without using", () => {
    expect(keptOnly(fromSillyTavern(ST_PRESET()).data)).toEqual(["logit_bias", "top_k"]);
  });

  test("Hearth's own export reads back with its blocks", () => {
    const { data } = fromSillyTavern(ST_PRESET());
    const back = fromHearth({ hearth_preset: 1, name: "Mine", ...JSON.parse(JSON.stringify(data)) });
    expect(back.name).toBe("Mine");
    expect(back.data.blocks).toEqual(data.blocks);
    expect(back.data.st).toEqual(data.st);
  });
});

describe("scripts that belong to a preset", () => {
  async function importPreset(name: string) {
    const form = new FormData();
    form.append("files", new File([JSON.stringify(ST_PRESET())], `${name}.json`));
    const r = await json(ask("/api/import/presets", { method: "POST", body: form }));
    expect(r.imported).toEqual([name]);
    return (db.query("SELECT id FROM presets WHERE name = ?").get(name) as any).id as string;
  }
  function seedChat() {
    const t = Date.now();
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('jaime', 'Jaime', ?)").run(t);
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'jaime', 'Lions', ?, ?)").run(t, t);
    db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES ('m1', 'ch', 'user', 'Say SECRET.', ?)").run(t);
  }
  const convo = async () =>
    ((await json(send("/api/chats/ch/inspect", "POST", {}))).sections as any[])
      .find((s) => s.label === "Conversation")?.content as string;

  test("arrive bound to their preset, and run only while it is active", async () => {
    wipe();
    setSettings({ mode: "story" });
    seedChat();
    const id = await importPreset("Deus");
    let list = await json(ask("/api/regex"));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ presetId: id, presetName: "Deus", active: false });

    await ask(`/api/presets/${id}/activate`, { method: "POST" });
    list = await json(ask("/api/regex"));
    expect(list[0].active).toBe(true);

    await ask("/api/presets/none", { method: "POST" });
    expect((await json(ask("/api/regex")))[0].active).toBe(false);
  });

  test("a prompt script bound to a resting preset does not touch the prompt", async () => {
    wipe();
    setSettings({ mode: "story" });
    seedChat();
    const id = await importPreset("Deus");
    await send("/api/regex", "POST", {
      name: "Hide secret", find: "/SECRET/g", replace: "[gone]", placement: [1], display: false, prompt: true,
      enabled: true, presetId: id,
    });
    expect(await convo()).toContain("SECRET");
    await ask(`/api/presets/${id}/activate`, { method: "POST" });
    expect(await convo()).toContain("[gone]");
  });

  test("scripts that already existed stay shared and keep running", async () => {
    wipe();
    setSettings({ mode: "story" });
    seedChat();
    // As an older Hearth stored it: no preset column value at all.
    db.query("INSERT INTO regex_scripts (id, name, script, enabled, source, position, created_at) VALUES (?,?,?,?,?,?,?)")
      .run("old", "Old", JSON.stringify(normaliseScript({ ...ST_SCRIPT({ id: "old", findRegex: "/SECRET/g",
        replaceString: "[old]", placement: [1], markdownOnly: false, promptOnly: true }) })), 1, "", 0, Date.now());
    expect((await json(ask("/api/regex")))[0]).toMatchObject({ presetId: null, active: true });
    expect(await convo()).toContain("[old]");
    // Re-importing a preset that carries the same script does not bind it, or
    // it would run twice whenever that preset is on.
    const form = new FormData();
    form.append("files", new File([JSON.stringify({ ...ST_PRESET(), extensions: { regex_scripts: [ST_SCRIPT({ id: "old" })] } })], "P.json"));
    await ask("/api/import/presets", { method: "POST", body: form });
    const rows = await json(ask("/api/regex"));
    expect(rows).toHaveLength(1);
    expect(rows[0].presetId).toBeNull();
  });

  test("a second preset carrying the same script gets a copy of its own", async () => {
    wipe();
    const a = await importPreset("A");
    const b = await importPreset("B");
    const rows = await json(ask("/api/regex"));
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.presetId).sort()).toEqual([a, b].sort());
  });

  test("duplicating a preset copies its scripts to the copy", async () => {
    wipe();
    const id = await importPreset("Deus");
    const dup = await json(ask(`/api/presets/${id}/duplicate`, { method: "POST" }));
    expect(dup.name).toBe("Deus (copy)");
    const rows = await json(ask("/api/regex"));
    expect(rows.filter((r: any) => r.presetId === dup.id)).toHaveLength(1);
    expect(rows.filter((r: any) => r.presetId === id)).toHaveLength(1);
  });

  test("the preset's export carries its own scripts and nobody else's", async () => {
    wipe();
    const id = await importPreset("Deus");
    await send("/api/regex", "POST", { name: "Shared one", find: "/x/g", replace: "y", placement: [2], display: true, enabled: true });
    const out = await json(ask(`/api/presets/${id}/export`));
    expect(out.extensions.regex_scripts).toHaveLength(1);
    expect(out.extensions.regex_scripts[0]).toEqual(ST_SCRIPT());
    expect(out.top_k).toBe(40);
    // Hearth's own shape is still there for anyone who wants it.
    expect((await json(ask(`/api/presets/${id}/export?format=hearth`))).hearth_preset).toBe(1);
  });

  test("saving blocks from an editor that never saw the original keeps it", async () => {
    wipe();
    const id = await importPreset("Deus");
    const row = (await json(ask("/api/presets"))).find((p: any) => p.id === id);
    const data = JSON.parse(row.data);
    const { st: _, ...withoutOriginal } = data;
    await send(`/api/presets/${id}`, "PUT", { name: "Deus", data: withoutOriginal });
    expect((await json(ask(`/api/presets/${id}/export`))).logit_bias).toBeDefined();
    expect((await json(ask(`/api/presets/${id}/kept`))).map((k: any) => k.key)).toEqual(["logit_bias", "top_k"]);
  });

  test("renaming", async () => {
    wipe();
    const id = await importPreset("Deus");
    expect((await send(`/api/presets/${id}/rename`, "POST", { name: "  " })).status).toBe(400);
    await send(`/api/presets/${id}/rename`, "POST", { name: "Deus Ex" });
    expect((await json(ask("/api/presets")))[0].name).toBe("Deus Ex");
  });
});

describe("editing scripts", () => {
  const make = (over: Record<string, unknown> = {}) =>
    send("/api/regex", "POST", { name: "S", find: "/a/g", replace: "b", placement: [2], display: true, enabled: true, ...over });

  test("a pattern that will not compile is refused, and nothing is saved", async () => {
    wipe();
    const r = await make({ find: "/(oops/g" });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("does not compile");
    expect(await json(ask("/api/regex"))).toHaveLength(0);
  });

  test("depths that could never both hold are refused", async () => {
    wipe();
    expect((await make({ minDepth: 5, maxDepth: 2 })).status).toBe(400);
  });

  test("an edit changes the script and keeps its place", async () => {
    wipe();
    const a = await json(make({ name: "A" }));
    const b = await json(make({ name: "B" }));
    const edited = await json(send(`/api/regex/${a.id}`, "PUT", { ...a, find: "/z/g", substitute: 1 }));
    expect(edited).toMatchObject({ id: a.id, find: "/z/g", substitute: 1 });
    expect((await json(ask("/api/regex"))).map((r: any) => r.name)).toEqual(["A", "B"]);
    expect(b.name).toBe("B");
  });

  test("a duplicate sits right after the original, switched off", async () => {
    wipe();
    const a = await json(make({ name: "A" }));
    await make({ name: "B" });
    await ask(`/api/regex/${a.id}/duplicate`, { method: "POST" });
    const rows = await json(ask("/api/regex"));
    expect(rows.map((r: any) => r.name)).toEqual(["A", "A (copy)", "B"]);
    expect(rows[1].enabled).toBe(false);
  });

  test("reordering, switching several, moving to a preset", async () => {
    wipe();
    const a = await json(make({ name: "A" }));
    const b = await json(make({ name: "B" }));
    const c = await json(make({ name: "C" }));
    await send("/api/regex/reorder", "POST", { ids: [c.id, a.id] });
    expect((await json(ask("/api/regex"))).map((r: any) => r.name)).toEqual(["C", "A", "B"]);

    await send("/api/regex/enable", "POST", { ids: [a.id, b.id], enabled: false });
    expect((await json(ask("/api/regex"))).filter((r: any) => r.enabled).map((r: any) => r.name)).toEqual(["C"]);

    const t = Date.now();
    db.query("INSERT INTO presets (id, name, data, is_active, created_at) VALUES ('p', 'P', '{}', 0, ?)").run(t);
    await send("/api/regex/assign", "POST", { ids: [b.id], presetId: "p" });
    expect((await json(ask("/api/regex"))).find((r: any) => r.id === b.id).presetId).toBe("p");
    expect((await send("/api/regex/assign", "POST", { ids: [b.id], presetId: "nope" })).status).toBe(400);
  });

  test("export is SillyTavern's shape: one as an object, several as a list", async () => {
    wipe();
    const a = await json(make({ name: "A" }));
    const b = await json(make({ name: "B" }));
    const one = await json(ask(`/api/regex/export?ids=${a.id}`));
    expect(one).toMatchObject({ scriptName: "A", findRegex: "/a/g", disabled: false, markdownOnly: true });
    const both = await json(ask(`/api/regex/export?ids=${a.id},${b.id}`));
    expect(both.map((s: any) => s.scriptName)).toEqual(["A", "B"]);
    // And it imports straight back.
    wipe();
    await send("/api/regex/import", "POST", both);
    expect((await json(ask("/api/regex"))).map((r: any) => r.name)).toEqual(["A", "B"]);
  });
});

describe("the test chamber", () => {
  test("shows matches and output, and writes nothing anywhere", async () => {
    wipe();
    const t = Date.now();
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('c', 'C', ?)").run(t);
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'c', 'T', ?, ?)").run(t, t);
    db.query("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES ('m', 'ch', 'assistant', 'foo', ?)").run(t);
    const before = JSON.stringify([
      db.query("SELECT * FROM messages").all(), db.query("SELECT * FROM regex_scripts").all(),
    ]);
    const r = await json(send("/api/regex/test", "POST", {
      text: "foo <status>hp 3</status>",
      script: { name: "T", find: "/<status>(.*?)<\\/status>/g", replace: "[$1]", placement: [2], display: true, enabled: true },
      where: "display", role: "assistant", depth: 0, pipeline: true,
    }));
    expect(r.error).toBeNull();
    expect(r.applies).toBe(true);
    expect(r.output).toBe("foo [hp 3]");
    expect(r.pipeline).toBe("foo [hp 3]");
    expect(r.matches).toEqual([[4, 25]]);
    const after = JSON.stringify([
      db.query("SELECT * FROM messages").all(), db.query("SELECT * FROM regex_scripts").all(),
    ]);
    expect(after).toBe(before);
  });

  test("says why a script would sit a message out", async () => {
    const r = await json(send("/api/regex/test", "POST", {
      text: "foo",
      script: { name: "T", find: "/foo/", replace: "x", placement: [2], display: true, enabled: true, minDepth: 3 },
      where: "prompt", role: "user", depth: 0,
    }));
    expect(r.applies).toBe(false);
    expect(r.reasons.join(" ")).toContain("model is sent");
    expect(r.reasons.join(" ")).toContain("your messages");
    expect(r.reasons.join(" ")).toContain("minimum depth");
    // It still shows what the script itself would do, so it can be tried out.
    expect(r.output).toBe("x");
  });

  test("a broken pattern is reported, not thrown", async () => {
    const r = await json(send("/api/regex/test", "POST", { text: "a", script: { name: "T", find: "/(/" } }));
    expect(r.error).toBeTruthy();
    expect(r.output).toBe("a");
  });
});
