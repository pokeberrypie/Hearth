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

/**
 * The list a preset gets when it has never been given one.
 *
 * Character first — the same order as DEFAULT_PARTS in src/prompt.ts and
 * MARKER_LABEL in public/app.js, which is where the reasoning is written down.
 * All three are the same decision expressed in three places, so they move
 * together or the app disagrees with itself about what it sends.
 */
export const DEFAULT_BLOCKS: PromptBlock[] = [
  "worldInfoBefore", "charDescription", "main", "charPersonality", "scenario",
  "personaDescription", "dialogueExamples", "worldInfoAfter", "authorsNote",
  "chatHistory", "jailbreak",
].map((marker) => ({
  id: marker, name: marker, role: "system" as const,
  content: "", enabled: true, marker,
}));

export type PresetData = Partial<Record<(typeof PRESET_FIELDS)[number], string>> & {
  blocks?: PromptBlock[];
  /**
   * The SillyTavern file this preset came from, as it came, less the regex
   * scripts (which live in their own table). Hearth reads ten of its fields;
   * the other hundred — top_k, seeds, bias lists, each prompt's injection
   * depth — are none of Hearth's business, and that is exactly why they are
   * kept: an export without them would hand SillyTavern back a preset that
   * had quietly lost its settings in the round trip.
   */
  st?: Record<string, unknown>;
};

/**
 * SillyTavern keys Hearth reads into its own fields. Everything else in a
 * preset is kept but not used, and the generation view lists it as such.
 */
export const ST_MAPPED = new Set([
  "temperature", "temp", "top_p", "min_p", "frequency_penalty", "freq_pen",
  "presence_penalty", "pres_pen", "repetition_penalty", "rep_pen",
  "openai_max_tokens", "genamt", "max_length", "max_tokens",
  "openai_max_context", "max_context", "truncation_length",
  "stream_openai", "reasoning_effort", "prompts", "prompt_order", "extensions", "name",
]);

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

  // Everything as it came, for the export. The scripts are stored apart.
  const st: Record<string, unknown> = { ...json };
  if (st.extensions && typeof st.extensions === "object") {
    const { regex_scripts: _, ...rest } = st.extensions as Record<string, unknown>;
    st.extensions = rest;
  }
  delete st.regex_scripts;
  data.st = st;

  return { name: String(json.name ?? "Imported preset"), data };
}

/** A file Hearth itself exported, in its own shape. */
export function isHearthPreset(json: any): boolean {
  return !!json && typeof json === "object" && json.hearth_preset === 1;
}

/** Reads Hearth's own export back in, which fromSillyTavern would half-lose. */
export function fromHearth(json: any): { name: string; data: PresetData } {
  const data: PresetData = {};
  for (const f of PRESET_FIELDS) if (json[f] !== undefined) data[f] = String(json[f]);
  const blocks = normaliseBlocks(json.blocks);
  if (blocks.length) data.blocks = blocks;
  if (json.st && typeof json.st === "object") data.st = json.st;
  return { name: String(json.name ?? "Imported preset"), data };
}

/**
 * Back into SillyTavern's chat-completion preset shape.
 *
 * Built on top of the file the preset came from, so whatever Hearth does not
 * understand goes back out unchanged; Hearth's own values are written over the
 * keys they were read from. A preset made in Hearth has no such file and gets
 * only the keys it actually has values for — the prompt manager's two lists,
 * and the sampling numbers that were set. Nothing is invented to fill the
 * rest; SillyTavern supplies its own defaults for what a file leaves out.
 */
export function toSillyTavernPreset(
  data: PresetData,
  scripts: Record<string, unknown>[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(data.st ?? {}) };
  const n = (v: string | undefined) => (v === undefined || v === "" || !Number.isFinite(+v) ? undefined : +v);
  const put = (k: string, v: unknown) => { if (v !== undefined) out[k] = v; };

  put("temperature", n(data.temperature));
  put("top_p", n(data.top_p));
  put("min_p", n(data.min_p));
  put("frequency_penalty", n(data.frequency_penalty));
  put("presence_penalty", n(data.presence_penalty));
  put("repetition_penalty", n(data.repetition_penalty));
  put("openai_max_tokens", n(data.max_tokens));
  put("openai_max_context", n(data.context_tokens));
  if (data.stream !== undefined && data.stream !== "") out.stream_openai = data.stream === "1";
  // "off" has no SillyTavern spelling, so the file keeps whatever it said.
  const effort: Record<string, string> = { "": "auto", minimal: "min", low: "low", medium: "medium", high: "high" };
  if (data.reasoning_effort !== undefined && data.reasoning_effort in effort) {
    out.reasoning_effort = effort[data.reasoning_effort];
  }

  const blocks = normaliseBlocks(data.blocks);
  if (blocks.length) {
    const st = data.st ?? {};
    const pool = new Map<string, Record<string, unknown>>(
      (Array.isArray(st.prompts) ? st.prompts : [])
        .filter((b: any) => b && typeof b === "object")
        .map((b: any) => [String(b.identifier ?? b.name), b]),
    );
    const ids = new Set(blocks.map((b) => b.id));
    out.prompts = [
      ...blocks.map((b) => {
        const base = pool.get(b.id) ?? {};
        // "main" and "jailbreak" are prompts with text in SillyTavern, not
        // placeholders, though Hearth gives them a marker of its own.
        const placeholder = typeof base.marker === "boolean"
          ? base.marker
          : !!b.marker && b.marker !== "main" && b.marker !== "jailbreak";
        return {
          ...base,
          identifier: b.id,
          name: b.name,
          role: b.role,
          ...(placeholder ? {} : { content: b.content }),
          system_prompt: base.system_prompt ?? !!b.marker,
          marker: placeholder,
        };
      }),
      // Blocks Hearth could not use — empty ones, mostly — go back as they came.
      ...[...pool.entries()].filter(([id]) => !ids.has(id)).map(([, b]) => b),
    ];

    const mine = blocks.map((b) => ({ identifier: b.id, enabled: b.enabled }));
    const lists = Array.isArray(st.prompt_order) ? [...(st.prompt_order as any[])] : [];
    const last = lists[lists.length - 1];
    if (last && Array.isArray(last.order)) {
      // Entries Hearth dropped keep their place after whichever neighbour survived.
      const merged = [...mine];
      let after = -1;
      for (const o of last.order) {
        const id = String(o?.identifier);
        const at = merged.findIndex((m) => m.identifier === id);
        if (at >= 0) { after = at; continue; }
        merged.splice(after + 1, 0, o);
        after++;
      }
      lists[lists.length - 1] = { ...last, order: merged };
      out.prompt_order = lists;
    } else {
      // SillyTavern's global prompt list is the one under this character id.
      out.prompt_order = [{ character_id: 100001, order: mine }];
    }
  }

  if (scripts.length) {
    const ext = out.extensions && typeof out.extensions === "object" ? out.extensions as Record<string, unknown> : {};
    out.extensions = { ...ext, regex_scripts: scripts };
  }
  return out;
}

/** The SillyTavern keys this preset carries that Hearth keeps but does not act on. */
export function keptOnly(data: PresetData): string[] {
  return Object.keys(data.st ?? {}).filter((k) => !ST_MAPPED.has(k)).sort();
}
