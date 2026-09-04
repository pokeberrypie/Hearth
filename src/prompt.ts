import type { ChatMessage } from "./providers";

export type Character = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_message: string;
  mes_example?: string;
  system_prompt?: string;
  post_history?: string;
};

export type StoredMessage = { role: string; content: string; name?: string };

/**
 * Removes a speaker's own name from the front of their line.
 *
 * Group prompts prefix each stored reply with who said it, so the model can
 * tell voices apart (see buildMessages). Models copy that convention into
 * their own output — and the label was then saved as part of the reply and
 * prefixed *again* on the next turn, one deeper every time:
 * "Jaime: Jaime: Jaime: …". Stripped both on the way in and on the way back
 * out, so transcripts already carrying it stop compounding and read straight.
 */
export function stripSpeakerLabel(text: string, name: string): string {
  const who = (name ?? "").trim();
  if (!who) return text;
  let out = text;
  // Repeatedly, because a transcript may already have several stacked up.
  for (;;) {
    const lead = out.replace(/^[\s>*_]+/, '');
    if (lead.slice(0, who.length).toLowerCase() !== who.toLowerCase()) return out;
    const sep = lead.slice(who.length).match(/^\s*:[ \t]*/);
    if (!sep) return out;
    out = lead.slice(who.length + sep[0].length);
  }
}

/** Replaces {{char}} / {{user}} and their SillyTavern aliases. */
export function macros(text: string, char: string, user: string): string {
  return text
    .replace(/\{\{char\}\}/gi, char)
    .replace(/\{\{user\}\}/gi, user)
    .replace(/<BOT>/g, char)
    .replace(/<USER>/g, user);
}

/**
 * The named pieces a system prompt is made of, matching SillyTavern's prompt
 * manager identifiers so an imported preset can order them by name. Lore fills
 * in `worldInfoBefore` and `worldInfoAfter`; everything else comes off the card.
 */
export type PartId =
  | "main" | "worldInfoBefore" | "charDescription" | "charPersonality"
  | "scenario" | "personaDescription" | "dialogueExamples" | "worldInfoAfter";

/** The order used when a preset has no opinion. */
export const DEFAULT_PARTS: PartId[] = [
  "main", "worldInfoBefore", "charDescription", "charPersonality",
  "scenario", "personaDescription", "dialogueExamples", "worldInfoAfter",
];

export function buildParts(
  char: Character,
  personaName: string,
  personaDescription: string,
): Record<PartId, string> {
  const m = (s: string) => macros(s, char.name, personaName).trim();
  return {
    // A card may carry its own framing. When it does, honour it instead of ours.
    main: char.system_prompt?.trim()
      ? m(char.system_prompt)
      : `You are ${char.name} in an ongoing collaborative roleplay with ${personaName}. ` +
        `Stay in character. Write ${char.name}'s dialogue, actions and inner life only — ` +
        `never speak or act for ${personaName}. Narration in past tense, dialogue in quotes. ` +
        `End on a beat that leaves ${personaName} something to respond to.`,
    worldInfoBefore: "",
    charDescription: char.description ? `# ${char.name}\n${m(char.description)}` : "",
    charPersonality: char.personality ? `# Personality\n${m(char.personality)}` : "",
    scenario: char.scenario ? `# Scene\n${m(char.scenario)}` : "",
    personaDescription: personaDescription ? `# ${personaName}\n${m(personaDescription)}` : "",
    // Example dialogue teaches voice better than any description of it.
    dialogueExamples: char.mes_example?.trim()
      ? `# How ${char.name} sounds\nExamples of style only — these did not happen ` +
        `and must not be referred to as events.\n\n${m(char.mes_example)}`
      : "",
    worldInfoAfter: "",
  };
}

export function buildSystem(
  char: Character,
  personaName: string,
  personaDescription: string,
): string {
  const parts = buildParts(char, personaName, personaDescription);
  return DEFAULT_PARTS.map((k) => parts[k]).filter(Boolean).join("\n\n");
}

/**
 * Card instructions meant to sit *after* the conversation, where they carry
 * more weight than anything in the opening system block.
 */
export function buildPostHistory(char: Character, personaName: string): string {
  return char.post_history?.trim()
    ? macros(char.post_history, char.name, personaName).trim()
    : "";
}

/**
 * A rough token count. Four characters to a token is the same estimate the
 * inspector shows and every provider's own count lands near it; a real
 * tokeniser per model would be more exact and would mean shipping one per
 * provider to save a few percent on a budget the user sets by feel anyway.
 */
export const estimateTokens = (text: string) => Math.ceil(String(text ?? "").length / 4);

export function buildMessages(
  history: StoredMessage[],
  char: Character,
  personaName: string,
  /**
   * How much of the conversation to send, in tokens. This used to be a count
   * of messages, which is only a proxy for the thing that actually costs money
   * and actually overflows: forty turns of two-line replies and forty turns of
   * a preset's full status blocks are not the same request at all.
   */
  budgetTokens: number,
  /** Group chats prefix each reply with who said it; solo chats have no need. */
  labelSpeakers = false,
): ChatMessage[] {
  // Newest first until the budget runs out, then put it back in order. The
  // oldest turns are the ones to lose; the newest are the scene.
  const budget = Number.isFinite(budgetTokens) && budgetTokens > 0 ? budgetTokens : 8000;
  const kept: StoredMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = estimateTokens(history[i].content) + 4; // + the role envelope
    // Always keep one, or a single long turn would send an empty conversation.
    if (used + cost > budget && kept.length) break;
    used += cost;
    kept.unshift(history[i]);
  }
  const recent = kept;
  const out: ChatMessage[] = recent.map((h) => {
    const role = h.role === "user" ? "user" : "assistant";
    // Strip any label the stored line already carries before adding ours, or
    // the prompt teaches the model to write one more of them every turn.
    const body = macros(stripSpeakerLabel(h.content, h.name ?? ""), char.name, personaName);
    return {
      role,
      content: labelSpeakers && role === "assistant" && h.name?.trim()
        ? `${h.name.trim()}: ${body}`
        : body,
    };
  });

  // Both APIs want the turn order to start with the user.
  while (out.length && out[0].role === "assistant") out.shift();
  if (!out.length) out.push({ role: "user", content: "(begin the scene)" });
  return out;
}
