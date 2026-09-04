/**
 * Character card reading and writing.
 *
 * The important property is the round trip: a card written into a PNG has to
 * come back out unchanged, and re-exporting must not leave the file carrying
 * two copies of itself.
 *
 *   bun test
 */

import { describe, expect, test } from "bun:test";
import { normalise, pngTextChunks, readCard, toCard, writeCardPng } from "./cards";

// ---- a PNG to write into ---------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const join = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

const SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const IHDR = chunk("IHDR", new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]));
const IDAT = chunk("IDAT", new Uint8Array([1, 2, 3, 4]));
const IEND = chunk("IEND", new Uint8Array(0));

/** A structurally valid one-pixel PNG, optionally carrying extra chunks. */
const png = (...extra: Uint8Array[]) => join([SIG, IHDR, ...extra, IDAT, IEND]);

const tEXt = (key: string, value: string) => {
  const k = new TextEncoder().encode(key);
  const v = new TextEncoder().encode(value);
  const data = new Uint8Array(k.length + 1 + v.length);
  data.set(k, 0);
  data[k.length] = 0;
  data.set(v, k.length + 1);
  return chunk("tEXt", data);
};

/** Counts card-bearing text chunks, which a Record<string,string> would hide. */
function cardChunkKeys(buf: Uint8Array): string[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const keys: string[] = [];
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
    if (type === "tEXt" || type === "iTXt") {
      const body = buf.subarray(p + 8, p + 8 + len);
      const nul = body.indexOf(0);
      if (nul > 0) keys.push(String.fromCharCode(...body.subarray(0, nul)));
    }
    if (type === "IEND") break;
    p += 12 + len;
  }
  return keys;
}

const CARD = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Akira",
    description: "A letter carrier who reads the letters.",
    personality: "Curious, guarded",
    scenario: "A wet evening in Ashvale.",
    first_mes: "\"You're late,\" she said — and it's a “smart quote” too.",
    mes_example: "<START>\n{{user}}: hi\n{{char}}: hi",
    system_prompt: "Stay in character.",
    post_history_instructions: "Never speak for {{user}}.",
    alternate_greetings: ["Another way in.", "And a third."],
    tags: ["original", "slice of life"],
    creator: "someone",
  },
};

// ---- reading ---------------------------------------------------------------

describe("reading", () => {
  test("rejects a file that is not a PNG", () => {
    expect(() => pngTextChunks(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a PNG/);
  });

  test("says so when a PNG carries no card", () => {
    expect(() => readCard(png(), "plain.png")).toThrow(/No character data/);
  });

  test("reads a base64 tEXt chunk under `chara`", () => {
    const b64 = Buffer.from(JSON.stringify(CARD), "utf8").toString("base64");
    expect(readCard(png(tEXt("chara", b64)), "a.png").name).toBe("Akira");
  });

  test("prefers ccv3 over chara when a card carries both", () => {
    const v2 = Buffer.from(JSON.stringify(CARD), "utf8").toString("base64");
    const v3 = Buffer.from(
      JSON.stringify({ spec: "chara_card_v3", data: { ...CARD.data, name: "Newer" } }),
      "utf8",
    ).toString("base64");
    expect(readCard(png(tEXt("chara", v2), tEXt("ccv3", v3)), "a.png").name).toBe("Newer");
  });

  test("reads an uncompressed iTXt chunk", () => {
    const b64 = Buffer.from(JSON.stringify(CARD), "utf8").toString("base64");
    const k = new TextEncoder().encode("chara");
    const v = new TextEncoder().encode(b64);
    // key \0 compressionFlag compressionMethod language \0 translatedKey \0 text
    const data = new Uint8Array(k.length + 1 + 2 + 1 + 1 + v.length);
    data.set(k, 0);
    data.set(v, k.length + 5);
    expect(readCard(png(chunk("iTXt", data)), "a.png").name).toBe("Akira");
  });

  test("reads a plain .json export", () => {
    const bytes = new TextEncoder().encode(JSON.stringify(CARD));
    expect(readCard(bytes, "akira.json").description).toBe(CARD.data.description);
  });

  test("understands a V1 card's older field names", () => {
    const v1 = normalise({
      char_name: "Old", char_persona: "from 2022",
      char_greeting: "hello", world_scenario: "somewhere", example_dialogue: "<START>",
    });
    expect(v1.name).toBe("Old");
    expect(v1.description).toBe("from 2022");
    expect(v1.first_message).toBe("hello");
    expect(v1.scenario).toBe("somewhere");
    expect(v1.mes_example).toBe("<START>");
  });

  test("a nameless card is Unnamed rather than blank", () => {
    expect(normalise({}).name).toBe("Unnamed");
  });

  test("drops non-string entries from the list fields", () => {
    const c = normalise({ name: "x", tags: ["a", 3, null], alternate_greetings: "not a list" });
    expect(c.tags).toEqual(["a"]);
    expect(c.alternate_greetings).toEqual([]);
  });

  test("keeps a card's own lorebook", () => {
    const c = normalise({ name: "x", character_book: { entries: [{ key: "a" }] } });
    expect(c.character_book).toBeTruthy();
    expect(normalise({ name: "x" }).character_book).toBeNull();
  });
});

// ---- writing ---------------------------------------------------------------

describe("writing", () => {
  test("a card written into a PNG comes back out whole", () => {
    const out = writeCardPng(png(), CARD);
    const back = readCard(out, "akira.png");
    expect(back.name).toBe(CARD.data.name);
    expect(back.description).toBe(CARD.data.description);
    expect(back.personality).toBe(CARD.data.personality);
    expect(back.scenario).toBe(CARD.data.scenario);
    expect(back.first_message).toBe(CARD.data.first_mes);
    expect(back.mes_example).toBe(CARD.data.mes_example);
    expect(back.system_prompt).toBe(CARD.data.system_prompt);
    expect(back.post_history).toBe(CARD.data.post_history_instructions);
    expect(back.alternate_greetings).toEqual(CARD.data.alternate_greetings);
    expect(back.tags).toEqual(CARD.data.tags);
    expect(back.creator).toBe(CARD.data.creator);
  });

  test("writes under both keys so old and new readers find it", () => {
    expect(cardChunkKeys(writeCardPng(png(), CARD)).sort()).toEqual(["ccv3", "chara"]);
  });

  test("the image survives: signature and chunk order are intact", () => {
    const out = writeCardPng(png(), CARD);
    expect([...out.subarray(0, 8)]).toEqual([...SIG]);
    const types: string[] = [];
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    let p = 8;
    while (p + 8 <= out.length) {
      const len = view.getUint32(p);
      types.push(String.fromCharCode(out[p + 4], out[p + 5], out[p + 6], out[p + 7]));
      if (types[types.length - 1] === "IEND") break;
      p += 12 + len;
    }
    expect(types).toEqual(["IHDR", "tEXt", "tEXt", "IDAT", "IEND"]);
  });

  test("re-exporting replaces the old card instead of stacking another", () => {
    const once = writeCardPng(png(), CARD);
    const twice = writeCardPng(once, { ...CARD, data: { ...CARD.data, name: "Renamed" } });
    expect(cardChunkKeys(twice).sort()).toEqual(["ccv3", "chara"]);
    expect(readCard(twice, "a.png").name).toBe("Renamed");
    expect(twice.length).toBeLessThanOrEqual(once.length + 16);
  });

  test("an inherited card chunk is stripped whatever its casing", () => {
    const stale = png(tEXt("Chara", "garbage"), tEXt("CHARA", "garbage"));
    expect(cardChunkKeys(writeCardPng(stale, CARD)).sort()).toEqual(["ccv3", "chara"]);
  });

  test("unrelated text chunks are left alone", () => {
    const withNote = png(tEXt("Software", "Hearth"));
    expect(pngTextChunks(writeCardPng(withNote, CARD)).Software).toBe("Hearth");
  });
});

// ---- the database row round trip -------------------------------------------

describe("toCard", () => {
  const row = {
    name: "Akira",
    description: "A letter carrier.",
    personality: "Curious",
    scenario: "Ashvale",
    first_message: "You're late.",
    mes_example: "<START>",
    system_prompt: "Stay in character.",
    post_history: "Never speak for {{user}}.",
    alternate_greetings: JSON.stringify(["b", "c"]),
    tags: JSON.stringify(["original"]),
    creator: "someone",
  };

  test("a stored row exports and reads back as the same character", () => {
    const back = readCard(writeCardPng(png(), toCard(row)), "akira.png");
    expect(back.name).toBe(row.name);
    expect(back.first_message).toBe(row.first_message);
    expect(back.post_history).toBe(row.post_history);
    expect(back.alternate_greetings).toEqual(["b", "c"]);
    expect(back.tags).toEqual(["original"]);
  });

  test("announces itself as a V2 card", () => {
    const card = toCard(row);
    expect(card.spec).toBe("chara_card_v2");
    expect(card.spec_version).toBe("2.0");
  });

  test("a row with unparseable list columns still exports", () => {
    const card = toCard({ ...row, tags: "not json", alternate_greetings: null });
    expect(card.data.tags).toEqual([]);
    expect(card.data.alternate_greetings).toEqual([]);
  });

  test("missing optional columns become empty strings, not undefined", () => {
    const card = toCard({ name: "Bare" });
    expect(card.data.description).toBe("");
    expect(card.data.post_history_instructions).toBe("");
  });
});
