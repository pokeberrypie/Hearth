/**
 * The models Hearth asks in its fixed line format — `KEY | this | that` — do not always write it that way. Asked for
 * pipes, GLM and Qwen will at times write `ACT: sends a man | hard | grave`, `**GOAL:** …`, a markdown table, or
 * fields set apart with dashes. Every one of those was a line read as nothing: a decision that became "an ordinary
 * day", a goal that was never given, with nothing said anywhere. Here each line is put back into the form the
 * readers expect before any of them sees it, so they need know only the one.
 */
const PIPES = /[｜¦│┃]/g;

export function fielded(text: string): string {
  return String(text ?? "").split(/\r?\n/).map(fieldLine).join("\n");
}

export function fieldLine(raw: string): string {
  let line = raw.replace(PIPES, "|");
  const lead = /^\s*(?:[-*•·>]+\s*|\d{1,3}[.)]\s+)?/.exec(line)![0];
  let body = line.slice(lead.length).replace(/\*\*|__/g, "").trim();
  // A table row: | ACT | sends a man | hard |. Its outer bars go; a divider row (|---|---|) is nothing.
  if (/^\|.*\|$/.test(body)) {
    if (/^\|[\s:|-]+\|$/.test(body)) return "";
    body = body.slice(1, -1).trim();
  }
  // KEY: rest, or KEY — rest: one word, then the colon or dash. A word no reader knows ("Note:", "Cersei:") becomes a
  // field no reader asks for, which is what it was before — nothing.
  const keyed = /^([A-Za-z][A-Za-z_]{1,15})\s*(?::|：|\s[—–-])\s*(.*)$/.exec(body);
  if (keyed && !keyed[2].startsWith("|")) {
    let rest = keyed[2];
    // Fields set apart with dashes rather than bars, when there are no bars at all.
    if (!rest.includes("|") && /\s[—–]\s/.test(rest)) rest = rest.split(/\s[—–]\s/).join(" | ");
    body = `${keyed[1]} | ${rest}`;
  }
  return lead.trim() ? `${lead.trim()} ${body}` : body;
}

/**
 * Names, in any alphabet. Words are letters and numbers of any script — "Anaïs" is one word, not "ana" and "s" —
 * and a script written without spaces between words (Japanese, Chinese, Thai) is matched by containing the name,
 * since there are no word edges to find. Before, a name outside a–z was stripped to nothing: never found, or, worse,
 * found in every line there was.
 */
const UNSPACED = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF\u0E00-\u0E7F]/;
// What is between words, as explicit ranges: no Unicode property escapes — the phone's Node has no ICU, and one
// property escape anywhere in the bundle stops it before its first line (see mobilesafe.test.ts). The apostrophe stays.
const BETWEEN = /[\s\u0000-\u0026\u0028-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u00BF\u00D7\u00F7\u2000-\u2017\u201A-\u206F\u2E00-\u2E7F\u3000-\u303F\uFF00-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]+/;
/** NFKC where the runtime has it; the text as it is where it has not (a Node without ICU). */
const fold = (s: string) => { try { return s.normalize("NFKC"); } catch { return s; } };
export const nameWords = (s: string) =>
  fold(String(s ?? "")).toLowerCase().replace(/[\u2018\u2019`\u00B4]/g, "'").split(BETWEEN).map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean);
/** One word, with nothing of what lies between words left on it. */
export const bareName = (w: string) => String(w ?? "").split(BETWEEN).join("");
/** Whether this name (one word of it) is in the text, as a whole word — or, for a name in an unspaced script, at all. */
export function hasName(text: string, name: string): boolean {
  const n = fold(String(name ?? "")).toLowerCase().trim();
  if (!n) return false;
  const t = fold(String(text ?? "")).toLowerCase();
  if (UNSPACED.test(n)) return t.includes(n);
  const said = new Set(nameWords(t));
  return said.has(n) || said.has(`${n}s`) || said.has(`${n}'s`);
}
