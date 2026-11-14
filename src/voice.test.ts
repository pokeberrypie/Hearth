import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db, setSettings, wipe } from "./test-support";
import { linesOf, sayable } from "./voice";
const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test/api${path}`, init), HOME);
const post = (path: string, body: unknown) => ask(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("what a reply says, aloud", () => {
  const REPLY = `<thinking>She is lying.</thinking>Jaime leaned on the rail. *The wind came off the sea.* "You came," he said. [[passed: 2 hours]]
"Sit, then — before they see you." He poured the wine. ((OOC: brb))
<status>Location: the Red Keep</status>`;

  test("nothing only the app reads: thinking, sheets, marks, markup, asides", () => {
    const s = sayable(REPLY);
    for (const gone of ["lying", "passed", "OOC", "brb", "Location", "*", "<", "[["]) expect(s).not.toContain(gone);
    expect(s).toContain("The wind came off the sea.");
  });

  test("their words: what is said in quotes, as one voice", () => {
    expect(linesOf(REPLY, "speech").map((l) => l.who)).toEqual(["speaker"]);
    const said = linesOf(REPLY, "speech").map((l) => l.text).join(" ");
    expect(said).toContain("You came,");
    expect(said).toContain("before they see you.");
    expect(said).not.toContain("leaned");
  });

  test("everything: the telling as the narrator, the words as the speaker, in order", () => {
    const lines = linesOf(REPLY, "all");
    expect(lines.map((l) => l.who)).toEqual(["narrator", "speaker", "narrator", "speaker", "narrator"]);
    expect(lines[0].text).toBe("Jaime leaned on the rail. The wind came off the sea.");
  });

  test("a reply of telling alone is still said, not silence", () => {
    const lines = linesOf("The fire burned low. Nobody spoke.", "speech");
    expect(lines).toEqual([{ who: "speaker", text: "The fire burned low. Nobody spoke." }]);
  });

  test("the first line is short, so the voice starts at once; a long one is cut at a comma", () => {
    const long = `"${"I will not go back to the city, not now, not after what they did. ".repeat(8)}"`;
    const lines = linesOf(long, "speech");
    expect(lines[0].text.length).toBeLessThanOrEqual(140);
    expect(lines.slice(1).every((l) => l.text.length <= 320)).toBe(true);
    expect(lines.map((l) => l.text).join(" ").replace(/\s+/g, " ")).toBe(long.slice(1, -1).trim().replace(/\s+/g, " "));
  });

  test("nothing to say is no lines, not an empty request", () => {
    expect(linesOf("", "all")).toEqual([]);
    expect(linesOf("[[hp: Jaime -2, 8/10]] <status>x</status> --- …", "all")).toEqual([]);
  });
});

describe("speaking and listening, through ElevenLabs", () => {
  const real = globalThis.fetch;
  let sent: { url: string; init: any }[] = [];
  let reply: (url: string, init: any) => Response = () => new Response("{}");
  beforeEach(() => {
    wipe();
    sent = [];
    globalThis.fetch = (async (u: any, init: any) => { const url = String(u?.url ?? u); if (url.startsWith("http://home.test")) return real(u, init); sent.push({ url, init }); return reply(url, init); }) as any;
    db.query("INSERT INTO characters (id, name, voice, created_at) VALUES ('j', 'Jaime', 'jaime-voice', 1), ('t', 'Tywin', '', 1)").run();
  });
  afterEach(() => { globalThis.fetch = real; });

  test("no key: told how to add one, and nothing is sent", async () => {
    const r = await post("/voice/speak", { text: "Hello." });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("ElevenLabs key");
    expect(sent).toEqual([]);
  });

  test("a line is spoken in the character's own voice, else the default; the narrator's for the telling", async () => {
    setSettings({ key_elevenlabs: "sk-el", voice_default: "default-voice", voice_narrator: "narrator-voice" });
    reply = () => new Response(new Uint8Array([0xff, 0xf3, 1, 2]), { headers: { "content-type": "audio/mpeg" } });
    const r = await post("/voice/speak", { text: "You came.", character_id: "j" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xf3, 1, 2]));
    expect(sent[0].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/jaime-voice/stream?output_format=mp3_44100_64");
    expect(sent[0].init.headers["xi-api-key"]).toBe("sk-el");
    expect(JSON.parse(sent[0].init.body)).toMatchObject({ text: "You came.", model_id: "eleven_flash_v2_5", apply_text_normalization: "on" });
    await post("/voice/speak", { text: "Hm.", character_id: "t" });
    expect(sent[1].url).toContain("/default-voice/");
    await post("/voice/speak", { text: "The wind rose.", character_id: "j", who: "narrator" });
    expect(sent[2].url).toContain("/narrator-voice/");
  });

  test("ElevenLabs' refusals are said plainly", async () => {
    setSettings({ key_elevenlabs: "sk-el", voice_default: "v" });
    reply = () => new Response(JSON.stringify({ detail: { status: "invalid_api_key", message: "Invalid API key" } }), { status: 401 });
    expect((await (await post("/voice/speak", { text: "Hi." })).json()).error).toContain("did not accept the key");
    // Out of credits comes as a 401 too: said as what it is, not as a bad key.
    reply = () => new Response(JSON.stringify({ detail: { status: "quota_exceeded", message: "This request exceeds your quota." } }), { status: 401 });
    expect((await (await post("/voice/speak", { text: "Hi." })).json()).error).toContain("out of credits");
    reply = () => new Response(JSON.stringify({ detail: { status: "quota_exceeded", message: "You have exceeded your credits quota" } }), { status: 429 });
    expect((await (await post("/voice/speak", { text: "Hi." })).json()).error).toContain("out of credits");
  });

  test("what was said into the microphone comes back as words", async () => {
    setSettings({ key_elevenlabs: "sk-el" });
    reply = () => Response.json({ text: " I draw my blade. ", language_code: "eng" });
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(4000)], { type: "audio/webm" }), "speech.webm");
    const r = await ask("/voice/hear", { method: "POST", body: form });
    expect(await r.json()).toEqual({ text: "I draw my blade.", language: "eng" });
    expect(sent[0].url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    const out = sent[0].init.body as FormData;
    expect(out.get("model_id")).toBe("scribe_v3");
    expect(out.get("tag_audio_events")).toBe("false");
    expect((out.get("file") as File).size).toBe(4000);
    // A breath, not a sentence: not sent at all.
    const tiny = new FormData();
    tiny.set("file", new Blob([new Uint8Array(100)]), "speech.webm");
    expect(await (await ask("/voice/hear", { method: "POST", body: tiny })).json()).toEqual({ text: "" });
    expect(sent.length).toBe(1);
  });

  test("every page of voices", async () => {
    setSettings({ key_elevenlabs: "sk-el" });
    reply = (url) => url.includes("next_page_token=p2")
      ? Response.json({ voices: [{ voice_id: "b", name: "Bella", category: "premade", preview_url: "https://x/b.mp3" }], has_more: false })
      : Response.json({ voices: [{ voice_id: "a", name: "Wren", category: "cloned" }], has_more: true, next_page_token: "p2" });
    const r = await (await ask("/voice/voices")).json();
    expect(r.voices).toEqual([{ id: "a", name: "Wren", category: "cloned", preview: null }, { id: "b", name: "Bella", category: "premade", preview: "https://x/b.mp3" }]);
  });

  test("a character keeps the voice it is given, and the key is never handed to the page", async () => {
    setSettings({ key_elevenlabs: "sk-el" });
    await ask("/characters/t", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ voice: "tywin-voice" }) });
    expect((db.query("SELECT voice, name FROM characters WHERE id = 't'").get() as any)).toEqual({ voice: "tywin-voice", name: "Tywin" });
    expect((await (await ask("/settings")).json()).key_elevenlabs).toBe("__saved__");
  });
});
