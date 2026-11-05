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
