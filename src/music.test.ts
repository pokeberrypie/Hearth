/**
 * Music under the story: your files, kept with the library, served a piece at a time, and a playlist per chat.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TEST_DIR, db, wipe } from "./test-support";
import { audioKind, playlistOf, rangeOf, titleOf } from "./music";
const { app } = await import("./index");

const HOME = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const ask = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://home.test/api${path}`, init), HOME);
const json = (path: string, method: string, body: unknown) => ask(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const SONG = new Uint8Array(10_000).map((_, i) => i % 251);
const upload = (...files: [string, Uint8Array][]) => {
  const form = new FormData();
  for (const [name, bytes] of files) form.append("files", new Blob([bytes as unknown as BlobPart]), name);
  return Promise.resolve(ask("/music", { method: "POST", body: form })).then((r: Response) => r.json() as Promise<any>);
};

beforeEach(() => wipe());

describe("the parts, on their own", () => {
  test("what is audio, by name", () => {
    expect(audioKind("Hightower's High Towers.MP3")).toEqual({ ext: "mp3", type: "audio/mpeg" });
    expect(audioKind("a.m4a")?.type).toBe("audio/mp4");
    expect(audioKind("cover.jpg")).toBeNull();
    expect(audioKind("noext")).toBeNull();
  });

  test("a title from a file name", () => {
    expect(titleOf("03 - Hightower's High Towers (Full).mp3")).toBe("Hightower's High Towers (Full)");
    expect(titleOf("the_west_has_got_the_cock.mp3")).toBe("the west has got the cock");
    expect(titleOf("1984.mp3")).toBe("1984");
    expect(titleOf(".mp3")).toBe("Untitled");
  });

  test("ranges: from a point, a span, the last bytes, the open end capped, and the impossible", () => {
    expect(rangeOf(null, 100)).toBeNull();
    expect(rangeOf("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(rangeOf("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(rangeOf("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(rangeOf("bytes=0-", 100, 30)).toEqual({ start: 0, end: 29 });
    expect(rangeOf("bytes=100-", 100)).toBe("bad");
    expect(rangeOf("bytes=50-10", 100)).toBe("bad");
    expect(rangeOf("items=0-1", 100)).toBeNull();
  });

  test("a playlist: tracks once each, and nothing that is not one", () => {
    expect(playlistOf('{"tracks":["a","b","a",3,""],"shuffle":1}')).toEqual({ tracks: ["a", "b"], shuffle: true });
    expect(playlistOf("")).toEqual({ tracks: [], shuffle: false });
    expect(playlistOf("{nonsense")).toEqual({ tracks: [], shuffle: false });
  });
});

describe("your music", () => {
  test("brought in several at once, named after the file; what is not audio is said and left out", async () => {
    const r = await upload(["Hightower's High Towers.mp3", SONG], ["The West Has Got the Cock.mp3", SONG], ["cover.jpg", SONG]);
    expect(r.added.map((t: any) => t.title)).toEqual(["Hightower's High Towers", "The West Has Got the Cock"]);
    expect(r.skipped).toEqual(["cover.jpg (not a sound file Hearth can play)"]);
    const list = await (await ask("/music")).json();
    expect(list.map((t: any) => t.title)).toEqual(["Hightower's High Towers", "The West Has Got the Cock"]);
    // Kept under uploads, which is what a full backup carries.
    const file = (db.query("SELECT file FROM tracks LIMIT 1").get() as any).file;
    expect(existsSync(join(TEST_DIR, "uploads", "music", file))).toBe(true);
  });

  test("played whole, or a piece at a time as a player asks", async () => {
    const { added: [t] } = await upload(["song.mp3", SONG]);
    const whole = await ask(`/music/${t.id}/play`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(SONG);
    const part = await ask(`/music/${t.id}/play`, { headers: { range: "bytes=100-199" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 100-199/10000");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(SONG.slice(100, 200));
    expect((await ask(`/music/${t.id}/play`, { headers: { range: "bytes=20000-" } })).status).toBe(416);
    expect((await ask("/music/nope/play")).status).toBe(404);
  });

  test("renamed; deleted for good, and out of every playlist it was in", async () => {
    const { added: [a, b] } = await upload(["a.mp3", SONG], ["b.mp3", SONG]);
    expect((await json(`/music/${a.id}`, "PUT", { title: "  Hightower's   High Towers " })).status).toBe(200);
    expect((db.query("SELECT title FROM tracks WHERE id = ?").get(a.id) as any).title).toBe("Hightower's High Towers");
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('c', 'Jaime', 1)").run();
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'c', 'x', 1, 1)").run();
    await json("/chats/ch/music", "PUT", { tracks: [a.id, b.id], shuffle: true });
    const file = (db.query("SELECT file FROM tracks WHERE id = ?").get(a.id) as any).file;
    expect((await ask(`/music/${a.id}`, { method: "DELETE" })).status).toBe(200);
    expect(existsSync(join(TEST_DIR, "uploads", "music", file))).toBe(false);
    expect(playlistOf((db.query("SELECT music FROM chats WHERE id = 'ch'").get() as any).music)).toEqual({ tracks: [b.id], shuffle: true });
  });

  test("a chat's playlist keeps only your tracks, and comes with the chat", async () => {
    const { added: [a] } = await upload(["a.mp3", SONG]);
    db.query("INSERT INTO characters (id, name, created_at) VALUES ('c', 'Jaime', 1)").run();
    db.query("INSERT INTO chats (id, character_id, title, created_at, updated_at) VALUES ('ch', 'c', 'x', 1, 1)").run();
    expect(await (await json("/chats/ch/music", "PUT", { tracks: [a.id, "made-up"], shuffle: false })).json()).toEqual({ tracks: [a.id], shuffle: false });
    expect(playlistOf((await (await ask("/chats/ch")).json()).chat.music).tracks).toEqual([a.id]);
    expect((await json("/chats/nope/music", "PUT", { tracks: [] })).status).toBe(404);
  });
});
