/** Fields a preset owns. Everything else in settings stays global. */
export const PRESET_FIELDS = [
  "temperature", "max_tokens", "context_tokens",
  "top_p", "min_p", "repetition_penalty",
  "frequency_penalty", "presence_penalty",
  "stream", "reasoning_effort",
] as const;

/**
 * A named piece of prompt the preset contributes. `system` blocks join the
 * opening brief in list order; `user` and `assistant` blocks are appended to
 * the conversation. Order is the array's own order — there is no order field
 * to fall out of step with it.
 */
export type PromptBlock = {
  id: string;
  name: string;
  role: "system" | "user" | "assistant";
  content: string;
  enabled: boolean;
  /**
   * A block that stands in for something Hearth assembles rather than for text
   * you typed — the card's description, the lorebook, the transcript itself.
   * This is what makes a preset an ordering of the whole prompt instead of a
   * pile of extra paragraphs bolted onto a fixed one.
   */
  marker?: string;
};

/** SillyTavern identifiers we know how to stand in for. */
export const MARKERS = new Set([
  "main", "worldInfoBefore", "charDescription", "charPersonality", "scenario",
  "personaDescription", "dialogueExamples", "worldInfoAfter", "chatHistory",
  "authorsNote", "jailbreak",
]);

/** The list a preset gets when it has never been given one. */
export const DEFAULT_BLOCKS: PromptBlock[] = [
  "main", "worldInfoBefore", "charDescription", "charPersonality", "scenario",
  "personaDescription", "dialogueExamples", "worldInfoAfter", "authorsNote",
  "chatHistory", "jailbreak",
].map((marker) => ({
  id: marker, name: marker, role: "system" as const,
  content: "", enabled: true, marker,
}));

export type PresetData = Partial<Record<(typeof PRESET_FIELDS)[number], string>> & {
  blocks?: PromptBlock[];
};

/** Accepts our shape or a SillyTavern prompt entry. Empty blocks are dropped. */
export function normaliseBlocks(raw: unknown): PromptBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b: any, i: number) => {
      const id = String(b?.id ?? b?.identifier ?? `b${i}`);
      /**
       * SillyTavern writes `marker: true` on a block that stands in for
       * something the app assembles, and puts the *name* of the thing in
       * `identifier` — `{ identifier: "charDescription", marker: true }`.
       * Reading `b.marker` as the name therefore yields the string "true",
       * which matches nothing, and every one of those blocks lost its marker,
       * had no content of its own, and was dropped by the filter below. The
       * effect was a preset that silently discarded the character, the
       * persona, the lorebook and the transcript itself — see the test.
       * Only a string marker names a marker; a boolean one means "look at the
       * identifier".
       */
      const named = typeof b?.marker === "string" && b.marker ? b.marker : id;
      const marker = MARKERS.has(named) ? named : undefined;
      return {
        id,
        name: String(b?.name ?? b?.identifier ?? "").trim() || marker || `Block ${i + 1}`,
        role: (b?.role === "user" || b?.role === "assistant" ? b.role : "system") as PromptBlock["role"],
        content: String(b?.content ?? ""),
        enabled: b?.enabled === undefined ? true : !!b.enabled,
        marker,
      };
    })
    // A marker carries no text of its own, so only plain blocks need content.
    .filter((b) => b.marker || b.content.trim());
}

/**
 * SillyTavern chat-completion presets. Field names differ from ours and some
 * live under different scales, so map explicitly rather than spreading.
 */
export function fromSillyTavern(json: any): { name: string; data: PresetData } {
  // Exporters are inconsistent about quoting numbers, and a preset that came
  // back with half its fields blank was almost always a string where a number
  // was expected.
  const num = (v: unknown, fallback?: string) => {
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(+v)) return String(+v);
    return fallback;
  };

  const data: PresetData = {};
  const set = (k: (typeof PRESET_FIELDS)[number], v: string | undefined) => {
    if (v !== undefined) data[k] = v;
  };

  set("temperature", num(json.temperature ?? json.temp));
  set("top_p", num(json.top_p));
  set("min_p", num(json.min_p));
  set("frequency_penalty", num(json.frequency_penalty ?? json.freq_pen));
  set("presence_penalty", num(json.presence_penalty ?? json.pres_pen));
  set("repetition_penalty", num(json.repetition_penalty ?? json.rep_pen));
  set("max_tokens", num(json.openai_max_tokens ?? json.genamt ?? json.max_length ?? json.max_tokens));

  // SillyTavern's own names for the two switches that are not sampling numbers.
  if (json.stream_openai !== undefined) data.stream = json.stream_openai ? "1" : "0";
  // ST writes "min"/"low"/"medium"/"high"/"auto"; ours calls the first "minimal"
  // and treats "auto" as "let the model decide", which is the empty string.
  if (typeof json.reasoning_effort === "string") {
    const e = json.reasoning_effort.trim().toLowerCase();
    const map: Record<string, string> = {
      min: "minimal", minimal: "minimal", low: "low", medium: "medium",
      high: "high", max: "high", none: "off", off: "off", auto: "",
    };
    if (e in map) data.reasoning_effort = map[e];
  }

  // Both count context in tokens now, so this comes across as written. The
  // ceiling is a sanity bound, not a model limit: presets routinely carry a
  // nominal 1,000,000 and sending that would be a very expensive surprise.
  const ctxTokens = Number(json.openai_max_context ?? json.max_context ?? json.truncation_length);
  if (Number.isFinite(ctxTokens) && ctxTokens > 0) {
    set("context_tokens", String(Math.max(1000, Math.min(200000, Math.round(ctxTokens)))));
  }

  // ST's prompt manager. `prompts` is an unordered pool keyed by identifier;
  // `prompt_order` is the list that actually decides sequence and on/off, and
  // the newest entry in it wins. Markers come across too — the whole point of a
  // preset is that it orders the card and the history, not just extra text.
  const pool = new Map(
    (Array.isArray(json.prompts) ? json.prompts : [])
      .filter((b: any) => b && typeof b === "object")
      .map((b: any) => [String(b.identifier ?? b.name), b]),
  );
  const order: any[] = Array.isArray(json.prompt_order)
    ? json.prompt_order[json.prompt_order.length - 1]?.order ?? []
    : [];

  const listed = order.length
    ? order.map((o: any) => {
        const id = String(o?.identifier);
        return { ...(pool.get(id) ?? { identifier: id }), enabled: o?.enabled !== false };
      })
    : [...pool.values()];

  const blocks = normaliseBlocks(listed);
  // A preset that never mentions the transcript would send no history at all.
  if (blocks.length && !blocks.some((b) => b.marker === "chatHistory")) {
    blocks.push({ id: "chatHistory", name: "chatHistory", role: "system",
                  content: "", enabled: true, marker: "chatHistory" });
  }
  if (blocks.length) data.blocks = blocks;

  return { name: String(json.name ?? "Imported preset"), data };
}
