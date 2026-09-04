/**
 * Character card reading.
 *
 * V2 cards hide JSON in a PNG tEXt chunk keyed "chara" (base64).
 * V3 cards use "ccv3" and wrap the same shape in { spec, data }.
 * Plain .json exports are also accepted.
 */

export type ParsedCard = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_message: string;
  mes_example: string;
  system_prompt: string;
  post_history: string;
  alternate_greetings: string[];
  tags: string[];
  creator: string;
  character_book: unknown | null;
  raw: unknown;
};

/**
 * A PNG chunk keyword, decoded.
 *
 * The spec says Latin-1, and in practice these are printable ASCII — "chara",
 * "ccv3". TextDecoder("latin1") would do the job, but it is a legacy encoding
 * that only exists in a full-ICU build: nodejs-mobile ships small-icu, where
 * constructing one throws "The latin1 encoding is not supported", and that is
 * what every character card import on the phone died of. Latin-1 maps each
 * byte to the code point of the same value, so do that and depend on nothing.
 */
const latin1 = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
};


/** Walks PNG chunks and returns every tEXt / iTXt key-value pair. */
export function pngTextChunks(buf: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== sig[i]) throw new Error("That file is not a PNG.");
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
    const start = p + 8;
    if (type === "IEND") break;

    if (type === "tEXt" || type === "iTXt") {
      const chunk = buf.subarray(start, start + len);
      const nul = chunk.indexOf(0);
      if (nul > 0) {
        const key = latin1(chunk.subarray(0, nul));
        let rest = chunk.subarray(nul + 1);
        // iTXt has compression flag, method, language and translated-key fields
        // before the payload. Uncompressed only — skip the four extra fields.
        if (type === "iTXt") {
          if (rest[0] === 1) { p = start + len + 4; continue; } // compressed, skip
          rest = rest.subarray(2);
          for (let skipped = 0; skipped < 2; skipped++) {
            const z = rest.indexOf(0);
            if (z === -1) break;
            rest = rest.subarray(z + 1);
          }
        }
        out[key] = new TextDecoder("utf-8").decode(rest);
      }
    }
    p = start + len + 4; // payload + CRC
  }
  return out;
}

function b64ToText(s: string): string {
  const clean = s.replace(/\s/g, "");
  try {
    return new TextDecoder("utf-8").decode(Buffer.from(clean, "base64"));
  } catch {
    return clean;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** Normalises V1, V2 and V3 shapes into one flat card. */
export function normalise(json: any): ParsedCard {
  const d = json?.data && typeof json.data === "object" ? json.data : json;
  return {
    name: str(d.name) || str(d.char_name) || "Unnamed",
    description: str(d.description) || str(d.char_persona),
    personality: str(d.personality),
    scenario: str(d.scenario) || str(d.world_scenario),
    first_message: str(d.first_mes) || str(d.char_greeting),
    mes_example: str(d.mes_example) || str(d.example_dialogue),
    system_prompt: str(d.system_prompt),
    post_history: str(d.post_history_instructions),
    alternate_greetings: arr(d.alternate_greetings),
    tags: arr(d.tags),
    creator: str(d.creator),
    character_book: d.character_book ?? null,
    raw: json,
  };
}

/** Accepts a PNG or a JSON export and returns the card. */
export function readCard(bytes: Uint8Array, filename: string): ParsedCard {
  if (/\.json$/i.test(filename)) {
    return normalise(JSON.parse(new TextDecoder().decode(bytes)));
  }
  const chunks = pngTextChunks(bytes);
  const payload = chunks.ccv3 ?? chunks.chara ?? chunks.Chara ?? chunks.CHARA;
  if (!payload) {
    throw new Error("No character data found in that PNG. Is it a character card?");
  }
  const text = b64ToText(payload);
  return normalise(JSON.parse(text));
}


// ---- writing ---------------------------------------------------------------

const CRC_TABLE = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const body = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

/**
 * Rebuilds a PNG with the card JSON embedded, dropping any existing card so a
 * re-export never carries two. Written under both keys so old and new readers
 * both find it.
 */
export function writeCardPng(png: Uint8Array, card: unknown): Uint8Array {
  const json = JSON.stringify(card);
  const b64 = Buffer.from(json, "utf8").toString("base64");

  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let p = 8;
  let wrote = false;

  while (p + 8 <= png.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    const whole = png.subarray(p, p + 12 + len);

    if (type === "tEXt" || type === "iTXt") {
      const body = png.subarray(p + 8, p + 8 + len);
      const nul = body.indexOf(0);
      const key = nul > 0 ? latin1(body.subarray(0, nul)) : "";
      if (["chara", "ccv3", "Chara", "CHARA"].includes(key)) { p += 12 + len; continue; }
    }

    if (type === "IDAT" && !wrote) {
      for (const key of ["chara", "ccv3"]) {
        const payload = new Uint8Array(key.length + 1 + b64.length);
        for (let i = 0; i < key.length; i++) payload[i] = key.charCodeAt(i);
        payload[key.length] = 0;
        for (let i = 0; i < b64.length; i++) payload[key.length + 1 + i] = b64.charCodeAt(i);
        parts.push(chunk("tEXt", payload));
      }
      wrote = true;
    }

    parts.push(whole);
    p += 12 + len;
    if (type === "IEND") break;
  }

  const total = parts.reduce((n, x) => n + x.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** Our stored columns back into a V2 card object. */
export function toCard(row: any) {
  // Both callers want a list. A NULL column parses as `null` rather than
  // throwing, so check the shape as well as the parse — a card that leaves with
  // `alternate_greetings: null` is not a valid V2 card.
  const j = (v: any, d: string[]): string[] => {
    try { const out = JSON.parse(v); return Array.isArray(out) ? out : d; } catch { return d; }
  };
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: row.name,
      description: row.description ?? "",
      personality: row.personality ?? "",
      scenario: row.scenario ?? "",
      first_mes: row.first_message ?? "",
      mes_example: row.mes_example ?? "",
      system_prompt: row.system_prompt ?? "",
      post_history_instructions: row.post_history ?? "",
      alternate_greetings: j(row.alternate_greetings, []),
      tags: j(row.tags, []),
      creator: row.creator ?? "",
      character_version: "",
      creator_notes: "",
      extensions: {},
    },
  };
}
