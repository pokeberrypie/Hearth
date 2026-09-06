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

/**
 * The shape a request goes out in.
 *
 * Not the same thing as who you are talking to. Half the interesting endpoints
 * — relays, proxies, whatever somebody is running on their own machine — speak
 * one of these three dialects while being none of the named services below, so
 * the wire format has to be nameable on its own.
 */
export type Wire = "openai" | "anthropic" | "responses";

export const WIRES: { id: Wire; label: string; path: string }[] = [
  { id: "openai", label: "OpenAI-compatible", path: "/chat/completions" },
  { id: "anthropic", label: "Anthropic messages", path: "/messages" },
  { id: "responses", label: "OpenAI responses", path: "/responses" },
];

export type GenerateArgs = {
  provider: string;
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  sampling: Sampling;
  prefill?: string; // seeds the reply, used by Continue
  signal?: AbortSignal;
  /** Where to send it, when the provider is `custom`. */
  baseUrl?: string;
  /** Which dialect to send, when the provider is `custom`. */
  format?: Wire;
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
  /**
   * Anywhere else.
   *
   * A base address and a choice of dialect, which between them cover the two
   * things this list could never enumerate: relay services that speak a
   * standard wire without being on it, and whatever somebody is running on
   * their own machine. The address and format come from settings rather than
   * from here, which is why `base` is empty.
   */
  custom: {
    label: "Custom endpoint",
    kind: "openai",
    base: "",
    keyUrl: "",
  },
} as const;

export type ProviderId = keyof typeof PROVIDERS;

/**
 * Addresses worth having one click away.
 *
 * All of these speak the OpenAI wire on localhost and differ only in port,
 * which is exactly the sort of thing nobody should have to look up. Offered as
 * suggestions, not as providers: they are the same custom endpoint underneath,
 * and inventing five near-identical providers would mean five things to keep
 * working when one of them changes a default port.
 */
export const LOCAL_SUGGESTIONS: { label: string; base: string; format: Wire }[] = [
  { label: "KoboldCpp", base: "http://localhost:5001/v1", format: "openai" },
  { label: "Ollama", base: "http://localhost:11434/v1", format: "openai" },
  { label: "LM Studio", base: "http://localhost:1234/v1", format: "openai" },
  { label: "llama.cpp", base: "http://localhost:8080/v1", format: "openai" },
  { label: "text-generation-webui", base: "http://127.0.0.1:5000/v1", format: "openai" },
];

/**
 * Whether an address points at this machine, and so plausibly needs no key.
 *
 * Parsed rather than matched as a string: this decides whether a request may
 * go out with no credentials at all, and `https://localhost.evil.example/`
 * contains "localhost" while being somebody else's server entirely.
 *
 * An IPv6 literal keeps its brackets in `hostname`, so `[::1]` never equals
 * `::1` and the loopback address quietly asked for a key it had no use for.
 */
export function isLocalBase(base: string): boolean {
  try {
    const h = new URL(base).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0"
      || h.endsWith(".local");
  } catch {
    return false;
  }
}

/**
 * Who we are actually talking to, after the custom endpoint has had its say.
 *
 * Everything downstream asks this rather than reading PROVIDERS directly, so
 * that "custom" is not a special case in five different places.
 */
export function resolveTarget(a: GenerateArgs) {
  const p = PROVIDERS[a.provider as ProviderId];
  if (!p) throw new Error(`Unknown provider "${a.provider}"`);
  if (a.provider !== "custom") {
    return { label: p.label, wire: p.kind as Wire, base: p.base, needsKey: true };
  }
  const base = String(a.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error("No address saved for the custom endpoint. Add one in Connection.");
  }
  const wire: Wire = WIRES.some((w) => w.id === a.format) ? (a.format as Wire) : "openai";
  // Something on this machine is usually open; anything else usually is not.
  return { label: "the custom endpoint", wire, base, needsKey: !isLocalBase(base) };
}

export type Chunk =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "usage"; tokens: number };

export async function* generate(a: GenerateArgs): AsyncGenerator<Chunk> {
  const t = resolveTarget(a);
  const key = (a.apiKey ?? "").trim();
  /*
   * A key is required everywhere except a server on this machine, which
   * usually has no notion of one. Demanding a key from KoboldCpp would mean
   * typing a fake one to get past a check that protects nothing.
   */
  if (!key && t.needsKey) {
    throw new Error(`No API key saved for ${t.label}. Add one in Connection.`);
  }
  a = { ...a, apiKey: key };

  const res =
    t.wire === "anthropic" ? await callAnthropic(a, t.base)
    : t.wire === "responses" ? await callResponses(a, t.base)
    : await callOpenAI(a, t.base);

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    const path = WIRES.find((w) => w.id === t.wire)?.path ?? "/chat/completions";
    console.error(
      `\n--- ${t.label} request failed -------------------------\n` +
        `  POST     ${t.base}${path}\n` +
        `  model    ${a.model}\n` +
        `  key      ${key ? `${key.length} chars, starts "${key.slice(0, 6)}", ends "${key.slice(-4)}"` : "(none sent)"}\n` +
        `  status   ${res.status} ${res.statusText}\n` +
        `  response ${detail.slice(0, 800) || "(empty)"}\n` +
        `-------------------------------------------------------\n`,
    );
    if (res.status === 401 || res.status === 403)
      throw new Error(`${t.label} rejected the request (${res.status}). ${trimDetail(detail)}`);
    if (res.status === 404)
      throw new Error(`${t.label} has no model called "${a.model}". ${trimDetail(detail)}`);
    throw new Error(`${t.label} returned ${res.status}. ${trimDetail(detail)}`);
  }

  /**
   * Streaming off: one response, whole. The caller consumes chunks either way,
   * so the reply is handed over as a single text chunk rather than making
   * every call site care which mode it asked for.
   */
  if (!a.sampling.stream) {
    const json: any = await res.json().catch(() => null);
    if (!json) throw new Error(`${t.label} sent a reply that could not be read.`);
    if (json.error) throw new Error(json.error.message ?? "Provider reported an error.");
    if (t.wire === "anthropic") {
      for (const block of json.content ?? []) {
        if (block?.type === "thinking" && block.thinking)
          yield { kind: "reasoning", text: block.thinking };
        if (block?.type === "text" && block.text) yield { kind: "text", text: block.text };
      }
      if (json.usage?.output_tokens) yield { kind: "usage", tokens: json.usage.output_tokens };
    } else if (t.wire === "responses") {
      /*
       * The responses shape nests one level deeper than chat completions: a
       * list of output items, each with its own list of content parts. Reasoning
       * arrives as its own item type rather than as a field on the message.
       */
      for (const item of json.output ?? []) {
        if (item?.type === "reasoning") {
          for (const s of item.summary ?? []) {
            if (s?.text) yield { kind: "reasoning", text: s.text };
          }
        }
        for (const part of item?.content ?? []) {
          if (part?.type === "output_text" && part.text) yield { kind: "text", text: part.text };
        }
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

    if (t.wire === "anthropic") {
      if (evt.type === "content_block_delta") {
        const d = evt.delta ?? {};
        if (d.type === "text_delta" && d.text) yield { kind: "text", text: d.text };
        if (d.type === "thinking_delta" && d.thinking)
          yield { kind: "reasoning", text: d.thinking };
      }
      const u = evt.usage ?? evt.message?.usage;
      if (u?.output_tokens) yield { kind: "usage", tokens: u.output_tokens };
    } else if (t.wire === "responses") {
      // Typed events rather than deltas on a choice. Only the text and the
      // reasoning summary are wanted; the rest describe structure we rebuilt
      // ourselves on the way in.
      if (evt.type === "response.output_text.delta" && evt.delta) {
        yield { kind: "text", text: evt.delta };
      }
      if (evt.type === "response.reasoning_summary_text.delta" && evt.delta) {
        yield { kind: "reasoning", text: evt.delta };
      }
      const done = evt.response?.usage?.output_tokens;
      if (done) yield { kind: "usage", tokens: done };
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
  };
  // Sent only when there is one. A bare `Bearer ` is not the same as silence,
  // and some local servers refuse it rather than ignoring it.
  if (a.apiKey) headers.authorization = `Bearer ${a.apiKey}`;
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

/**
 * OpenAI's newer shape, which some relays speak and some only speak.
 *
 * Same conversation, different nouns: the system prompt is `instructions`
 * rather than a message, the turns are `input`, and the ceiling is
 * `max_output_tokens`. Worth supporting on its own rather than pretending
 * every OpenAI-compatible address takes chat/completions, because the ones
 * that don't fail with a 404 that reads like a missing model.
 */
function callResponses(a: GenerateArgs, base: string) {
  const s = a.sampling;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: s.stream ? "text/event-stream" : "application/json",
  };
  if (a.apiKey) headers.authorization = `Bearer ${a.apiKey}`;

  const body: Record<string, unknown> = {
    model: a.model,
    stream: s.stream,
    instructions: a.system,
    input: [
      ...a.messages,
      ...(a.prefill ? [{ role: "assistant", content: a.prefill }] : []),
    ],
    temperature: s.temperature,
    top_p: s.topP,
    max_output_tokens: s.maxTokens,
  };
  // This shape has no repetition or presence penalties at all, so they are
  // dropped rather than faked. "off" means don't ask for thinking.
  if (s.reasoningEffort && s.reasoningEffort !== "off") {
    body.reasoning = { effort: s.reasoningEffort, summary: "auto" };
  }

  return fetch(`${base}/responses`, {
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
      // Omitted when absent, for the same reason as the bearer token above.
      ...(a.apiKey ? { "x-api-key": a.apiKey } : {}),
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
