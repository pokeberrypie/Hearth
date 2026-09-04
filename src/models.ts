import { PROVIDERS, type ProviderId } from "./providers";

export type ModelInfo = {
  id: string;
  name: string;
  in: number | null;   // USD per million prompt tokens
  out: number | null;  // USD per million completion tokens
  context: number | null;
  approx?: boolean;    // price came from the local table, not the provider
};

/**
 * Anthropic and Google don't publish pricing through their APIs, so these are
 * carried locally. Live values from a provider always win over this table.
 * Prices move — treat anything flagged `approx` as a guide, not a quote.
 */
const FALLBACK: Record<string, [number, number]> = {
  "claude-opus-4": [15, 75],
  "claude-opus-4-5": [5, 25],
  "claude-sonnet-4": [3, 15],
  "claude-sonnet-4-5": [3, 15],
  "claude-haiku-4-5": [1, 5],
  "claude-3-5-haiku": [0.8, 4],
  "gemini-2.5-pro": [1.25, 10],
  "gemini-2.5-flash": [0.3, 2.5],
  "gemini-2.5-flash-lite": [0.1, 0.4],
  "gemini-2.0-flash": [0.1, 0.4],
};

function fallbackFor(id: string): [number, number] | null {
  const key = Object.keys(FALLBACK)
    .filter((k) => id.includes(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? FALLBACK[key] : null;
}

const cache = new Map<string, { at: number; list: ModelInfo[] }>();
const TTL = 10 * 60 * 1000;

export async function listModels(provider: string, apiKey: string): Promise<ModelInfo[]> {
  const hit = cache.get(provider);
  if (hit && Date.now() - hit.at < TTL) return hit.list;

  const p = PROVIDERS[provider as ProviderId];
  if (!p) throw new Error(`Unknown provider "${provider}"`);
  const key = (apiKey ?? "").trim();

  const url = provider === "anthropic" ? `${p.base}/models?limit=1000` : `${p.base}/models`;
  const headers: Record<string, string> =
    provider === "anthropic"
      ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
      : { authorization: `Bearer ${key}` };

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${p.label} would not list models (${res.status}). ${body.slice(0, 200)}`);
  }

  const json: any = await res.json();
  const raw: any[] = json.data ?? json.models ?? [];

  const list: ModelInfo[] = raw.map((m) => {
    const id: string = m.id ?? m.name ?? "";
    // OpenRouter and NanoGPT report per-token prices as strings.
    const pr = m.pricing ?? {};
    const perTok = (v: unknown) => {
      const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
      return Number.isFinite(n) ? n * 1e6 : null;
    };
    let inp = perTok(pr.prompt ?? pr.input);
    let out = perTok(pr.completion ?? pr.output);
    let approx = false;

    if (inp === null && out === null) {
      const fb = fallbackFor(id);
      if (fb) { [inp, out] = fb; approx = true; }
    }

    return {
      id,
      name: m.display_name ?? m.name ?? id,
      in: inp,
      out,
      context: m.context_length ?? m.context_window ?? m.top_provider?.context_length ?? null,
      approx,
    };
  }).filter((m) => m.id);

  // Cheapest first; anything without a known price sinks to the bottom.
  list.sort((a, b) => {
    const ca = a.in === null && a.out === null ? Infinity : (a.in ?? 0) + (a.out ?? 0);
    const cb = b.in === null && b.out === null ? Infinity : (b.in ?? 0) + (b.out ?? 0);
    if (ca !== cb) return ca - cb;
    return a.id.localeCompare(b.id);
  });

  cache.set(provider, { at: Date.now(), list });
  return list;
}
