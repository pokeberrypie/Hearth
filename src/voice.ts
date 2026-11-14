/**
 * A call: Hearth heard and spoken, through ElevenLabs.
 *
 * What a reply says, aloud, is not what it shows: no thinking, no tracker sheets, no [[marks]], no markup, no
 * asides out of character. Read as "their words", it is what is said in quotes — and all of it when nothing is,
 * so a reply of narration alone is not silence on a call. Read as "everything", the telling is read too, and may
 * have a narrator's voice of its own.
 *
 * Lines are short, and the first shortest: the voice starts on the first few words while the rest is still being
 * made, and the call does not wait on the whole reply.
 */
import { storyOnly, withoutSheets, withoutThinking } from "./steward";

export type Line = { text: string; who: "speaker" | "narrator" };

const ELEVEN = "https://api.elevenlabs.io";
export const voiceBase = () => process.env.HEARTH_ELEVEN_BASE || ELEVEN;

/** The words of a reply that are for saying aloud: everything shown, nothing that only the app reads. */
export function sayable(text: string): string {
  let t = withoutThinking(withoutSheets(storyOnly(String(text ?? ""))));
  t = t.replace(/\[\[[^\]]*\]\]/g, " ")              // the narrator's marks: [[passed: 2 days]], [[hp: …]]
    .replace(/<[^>]+>/g, " ")                        // markup
    .replace(/```[\s\S]*?```/g, " ")                 // code blocks
    .replace(/\(\(([^)]|\)(?!\)))*\)\)/g, " ")       // ((out of character))
    .replace(/\bOOC:[^\n]*/gi, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_~`#>|]+/g, "")                      // emphasis, headings, quotes, tables
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return t;
}

/** Spoken and told, in order: what is in double quotes is said; the rest is the telling around it. */
function parts(text: string): Line[] {
  const out: Line[] = [];
  const re = /"([^"]+)"|“([^”]+)”|«([^»]+)»/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const told = text.slice(at, m.index).trim();
    if (told) out.push({ text: told, who: "narrator" });
    const said = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (said) out.push({ text: said, who: "speaker" });
    at = m.index + m[0].length;
  }
  const rest = text.slice(at).trim();
  if (rest) out.push({ text: rest, who: "narrator" });
  return out;
}

/** Sentences, gathered up to `most` characters each; one longer than that is cut at a comma, then a space. */
function sentences(text: string, first: number, most: number): string[] {
  const bits = text.replace(/\n+/g, " ").match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  const room = () => (out.length === 0 ? first : most);
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (let s of bits.map((b) => b.trim()).filter(Boolean)) {
    while (s.length > room()) {
      const cut = Math.max(s.lastIndexOf(", ", room()), s.lastIndexOf(" ", room()));
      const at = cut > room() / 3 ? cut + 1 : room();
      if (cur) push();
      cur = s.slice(0, at); push();
      s = s.slice(at).trim();
    }
    if (cur && (cur + " " + s).length > room()) push();
    cur = cur ? `${cur} ${s}` : s;
  }
  push();
  return out;
}

/**
 * The lines to speak, in order. "speech": what is said aloud, or everything when nothing is. "all": the telling
 * too, each part marked as said or told.
 */
export function linesOf(text: string, mode: "speech" | "all" = "speech", first = 140, most = 320): Line[] {
  const clean = sayable(text);
  if (!clean) return [];
  const all = parts(clean);
  const said = all.filter((p) => p.who === "speaker");
  const pick = mode === "all" ? all : said.length ? said : all.map((p) => ({ ...p, who: "speaker" as const }));
  const out: Line[] = [];
  for (const p of pick) {
    for (const s of sentences(p.text, out.length ? most : first, most)) {
      // Speech run together into one line when it is the same voice: fewer, longer requests, and one breath.
      const last = out[out.length - 1];
      if (last && last.who === p.who && (last.text + " " + s).length <= (out.length === 1 ? first : most)) last.text += " " + s;
      else out.push({ text: s, who: p.who });
    }
  }
  // Something to say: a letter or a digit, in any script — not a line of dashes or a lone "…". No Unicode property escapes: the phone's
  // Node has no ICU, and a property escape stops the whole server there.
  return out.filter((l) => /[A-Za-z0-9\u00C0-\u024F\u0370-\u1FFF\u3040-\u9FFF\uAC00-\uD7AF]/.test(l.text));
}

/** ElevenLabs' answer, as something to tell the person: what went wrong, in words they can act on. */
export function elevenTrouble(status: number, body: string): string {
  let detail = "";
  try {
    const j = JSON.parse(body);
    detail = String(j?.detail?.message ?? j?.detail?.status ?? j?.detail ?? j?.message ?? "");
  } catch { detail = body.slice(0, 200); }
  // Out of credits first: ElevenLabs says so with a 401 too, and "check your key" would send you the wrong way.
  if (/quota|credits|limit_exceeded/i.test(detail + body) || status === 402) return "ElevenLabs says the account is out of credits for now.";
  if (status === 401) return "ElevenLabs did not accept the key. Check it under Connection → Voice.";
  if (status === 429) return "ElevenLabs is busy (too many requests at once). Try again in a moment.";
  if (status === 404 && /voice/i.test(detail)) return "That voice is not on this ElevenLabs account any more. Pick another under Connection → Voice.";
  return `ElevenLabs answered ${status}${detail ? `: ${detail}` : ""}.`;
}
