export type ChatMessage = { role: "user" | "assistant"; content: string };

export type Sampling = {
  temperature: number;
  maxTokens: number;
  topP: number;
  minP: number;
  repetitionPenalty: number;
  frequencyPenalty: number;
  presencePenalty: number;
  /** False asks for the whole reply in one response instead of token by token. */
  stream: boolean;
  /**
   * How hard a reasoning model should think: "" says nothing and lets the
   * model decide, "off" asks for none, the rest are the usual four rungs.
   * Every provider spells this differently; the request builders translate.
   */
  reasoningEffort: "" | "off" | "minimal" | "low" | "medium" | "high";
};

export type GenerateArgs = {
  provider: string;
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  sampling: Sampling;
  prefill?: string; // seeds the reply, used by Continue
  signal?: AbortSignal;
};

export const PROVIDERS = {
  openrouter: {
    label: "OpenRouter",
    kind: "openai",
    base: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
  },
  nanogpt: {
    label: "NanoGPT",
    kind: "openai",
    base: "https://nano-gpt.com/api/v1",
    keyUrl: "https://nano-gpt.com/api",
  },
  google: {
    label: "Google AI Studio",
    kind: "openai",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  anthropic: {
    label: "Anthropic",
    kind: "anthropic",
    base: "https://api.anthropic.com/v1",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
} as const;

export type ProviderId = keyof typeof PROVIDERS;

export type Chunk =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "usage"; tokens: number };

export async function* generate(a: GenerateArgs): AsyncGenerator<Chunk> {
  const p = PROVIDERS[a.provider as ProviderId];
  if (!p) throw new Error(`Unknown provider "${a.provider}"`);
  const key = (a.apiKey ?? "").trim();
  if (!key) throw new Error(`No API key saved for ${p.label}. Add one in Settings.`);
  a = { ...a, apiKey: key };

  const res =
    p.kind === "anthropic" ? await callAnthropic(a, p.base) : await callOpenAI(a, p.base);

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    console.error(
      `\n--- ${p.label} request failed -------------------------\n` +
        `  POST     ${p.base}/${p.kind === "anthropic" ? "messages" : "chat/completions"}\n` +
        `  model    ${a.model}\n` +
        `  key      ${key.length} chars, starts "${key.slice(0, 6)}", ends "${key.slice(-4)}"\n` +
        `  status   ${res.status} ${res.statusText}\n` +
        `  response ${detail.slice(0, 800) || "(empty)"}\n` +
        `-------------------------------------------------------\n`,
    );
    if (res.status === 401 || res.status === 403)
      throw new Error(`${p.label} rejected the request (${res.status}). ${trimDetail(detail)}`);
    if (res.status === 404)
      throw new Error(`${p.label} has no model called "${a.model}". ${trimDetail(detail)}`);
    throw new Error(`${p.label} returned ${res.status}. ${trimDetail(detail)}`);
  }

  /**
   * Streaming off: one response, whole. The caller consumes chunks either way,
   * so the reply is handed over as a single text chunk rather than making
   * every call site care which mode it asked for.
   */
  if (!a.sampling.stream) {
    const json: any = await res.json().catch(() => null);
    if (!json) throw new Error(`${p.label} sent a reply that could not be read.`);
    if (json.error) throw new Error(json.error.message ?? "Provider reported an error.");
    if (p.kind === "anthropic") {
      for (const block of json.content ?? []) {
        if (block?.type === "thinking" && block.thinking)
          yield { kind: "reasoning", text: block.thinking };
        if (block?.type === "text" && block.text) yield { kind: "text", text: block.text };
      }
      if (json.usage?.output_tokens) yield { kind: "usage", tokens: json.usage.output_tokens };
    } else {
      const m = json.choices?.[0]?.message ?? {};
      const think = m.reasoning ?? m.reasoning_content;
      if (typeof think === "string" && think) yield { kind: "reasoning", text: think };
      if (typeof m.content === "string" && m.content) yield { kind: "text", text: m.content };
      if (json.usage?.completion_tokens)
        yield { kind: "usage", tokens: json.usage.completion_tokens };
    }
    return;
  }

  for await (const data of sseLines(res.body)) {
    if (data === "[DONE]") return;
    let evt: any;
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }
    if (evt.error) throw new Error(evt.error.message ?? "Provider reported an error.");

    if (p.kind === "anthropic") {
      if (evt.type === "content_block_delta") {
        const d = evt.delta ?? {};
        if (d.type === "text_delta" && d.text) yield { kind: "text", text: d.text };
        if (d.type === "thinking_delta" && d.thinking)
          yield { kind: "reasoning", text: d.thinking };
      }
      const u = evt.usage ?? evt.message?.usage;
      if (u?.output_tokens) yield { kind: "usage", tokens: u.output_tokens };
    } else {
      const d = evt.choices?.[0]?.delta ?? {};
      // Providers disagree on the field name for reasoning streams.
      const think = d.reasoning ?? d.reasoning_content;
      if (typeof think === "string" && think) yield { kind: "reasoning", text: think };
      if (typeof d.content === "string" && d.content) yield { kind: "text", text: d.content };
      if (evt.usage?.completion_tokens)
        yield { kind: "usage", tokens: evt.usage.completion_tokens };
    }
  }
}

function callOpenAI(a: GenerateArgs, base: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // NanoGPT requires this for streaming, and would be misled by it otherwise.
    accept: a.sampling.stream ? "text/event-stream" : "application/json",
    authorization: `Bearer ${a.apiKey}`,
  };
  if (a.provider === "openrouter") {
    headers["http-referer"] = "http://localhost";
    headers["x-title"] = "Hearth";
  }

  const s = a.sampling;
  const body: Record<string, unknown> = {
    model: a.model,
    stream: s.stream,
    temperature: s.temperature,
    max_tokens: s.maxTokens,
    top_p: s.topP,
    messages: [
      { role: "system", content: a.system },
      ...a.messages,
      ...(a.prefill ? [{ role: "assistant", content: a.prefill }] : []),
    ],
  };
  // Only meaningful on a stream; some servers reject it on a plain request.
  if (s.stream) body.stream_options = { include_usage: true };
  // Not universally supported, so only sent when moved off neutral.
  if (s.frequencyPenalty) body.frequency_penalty = s.frequencyPenalty;
  if (s.presencePenalty) body.presence_penalty = s.presencePenalty;
  if (s.minP > 0) body.min_p = s.minP;
  if (s.repetitionPenalty !== 1) body.repetition_penalty = s.repetitionPenalty;
  /**
   * Reasoning effort, in each provider's own dialect. OpenRouter takes a
   * `reasoning` object and is the only one that can be told to skip thinking
   * outright; the plain OpenAI shape is a single string. Nothing is sent when
   * the setting is empty, which leaves the model's own default alone.
   */
  if (s.reasoningEffort === "off") {
    if (a.provider === "openrouter") body.reasoning = { exclude: true, effort: "low" };
  } else if (s.reasoningEffort) {
    if (a.provider === "openrouter") body.reasoning = { effort: s.reasoningEffort };
    else body.reasoning_effort = s.reasoningEffort;
  }

  return fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    signal: a.signal,
    body: JSON.stringify(body),
  });
}

/** Thinking budgets, in tokens, for each rung of `reasoningEffort`. */
const ANTHROPIC_THINKING: Record<string, number> = {
  minimal: 1024, low: 4096, medium: 10000, high: 20000,
};

function callAnthropic(a: GenerateArgs, base: string) {
  const s = a.sampling;
  // Anthropic supports temperature and top_p only. min_p and the repetition
  // penalties have no equivalent, so they are dropped rather than faked.
  const body: Record<string, unknown> = {
    model: a.model,
    stream: s.stream,
    system: a.system,
    temperature: Math.min(s.temperature, 1),
    top_p: s.topP,
    max_tokens: s.maxTokens,
    messages: [...a.messages, ...(a.prefill ? [{ role: "assistant", content: a.prefill }] : [])],
  };

  /**
   * Extended thinking, when asked for. Anthropic's rules are strict: the
   * budget must be below max_tokens, and neither temperature nor top_p may be
   * set alongside it — so both come back out rather than being sent and
   * rejected. "off" and "" both mean no thinking block, which is the default.
   */
  const budget = ANTHROPIC_THINKING[s.reasoningEffort];
  if (budget) {
    const room = Math.max(1024, Math.min(budget, s.maxTokens - 512));
    body.thinking = { type: "enabled", budget_tokens: room };
    body.max_tokens = Math.max(s.maxTokens, room + 512);
    delete body.temperature;
    delete body.top_p;
  }

  return fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": a.apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal: a.signal,
    body: JSON.stringify(body),
  });
}

async function* sseLines(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
}

function trimDetail(s: string) {
  try {
    const j = JSON.parse(s);
    return j.error?.message ?? j.message ?? s.slice(0, 300);
  } catch {
    return s.slice(0, 300);
  }
}
