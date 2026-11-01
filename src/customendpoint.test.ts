/**
 * Talking to somewhere this program has never heard of.
 *
 * Four of the five providers are a name and a fixed address. The fifth is
 * whatever somebody types, which is the one that has to be tested: a relay
 * that speaks a standard wire without being a standard service, or a model
 * server running on the same machine. Two things decide what happens, and both
 * are easy to get subtly wrong —
 *
 *   - which dialect the request goes out in, which is a separate question from
 *     who is being addressed; and
 *   - whether a key is required, because demanding one from a local server
 *     means typing a fake key to satisfy a check that protects nothing.
 */

import { describe, expect, test } from "bun:test";

import {
  LOCAL_SUGGESTIONS, PROVIDERS, WIRES, isLocalBase, resolveTarget, thinkingOffSwitch, unreachable, generate,
  type GenerateArgs, type Wire,
} from "./providers";

const args = (over: Partial<GenerateArgs> = {}): GenerateArgs => ({
  provider: "custom",
  apiKey: "",
  model: "a-model",
  system: "",
  messages: [],
  sampling: {
    temperature: 1, maxTokens: 100, topP: 1, minP: 0, repetitionPenalty: 1,
    frequencyPenalty: 0, presencePenalty: 0, stream: false, reasoningEffort: "",
  },
  ...over,
});

describe("the named providers still resolve the way they did", () => {
  test("each one keeps its own address and dialect", () => {
    for (const [id, meta] of Object.entries(PROVIDERS)) {
      if (id === "custom") continue;
      const t = resolveTarget(args({ provider: id }));
      expect(t.base).toBe(meta.base);
      expect(t.wire).toBe(meta.kind);
      expect(t.needsKey).toBe(true);
    }
  });

  test("an unknown provider is refused rather than guessed at", () => {
    expect(() => resolveTarget(args({ provider: "nope" }))).toThrow(/Unknown provider/);
  });
});

describe("the custom endpoint", () => {
  test("needs an address before it will do anything", () => {
    expect(() => resolveTarget(args({ baseUrl: "" }))).toThrow(/No address/);
    expect(() => resolveTarget(args({ baseUrl: "   " }))).toThrow(/No address/);
  });

  test("takes the address given, without a trailing slash", () => {
    expect(resolveTarget(args({ baseUrl: "https://relay.example/v1/" })).base)
      .toBe("https://relay.example/v1");
    expect(resolveTarget(args({ baseUrl: "  https://relay.example/v1///  " })).base)
      .toBe("https://relay.example/v1");
  });

  test("sends whichever dialect was chosen", () => {
    for (const w of WIRES) {
      const t = resolveTarget(args({ baseUrl: "https://relay.example/v1", format: w.id }));
      expect(t.wire).toBe(w.id);
    }
  });

  test("falls back to the OpenAI wire when the format is missing or nonsense", () => {
    for (const bad of [undefined, "", "soap", "openai-ish"]) {
      const t = resolveTarget(args({ baseUrl: "https://relay.example/v1", format: bad as Wire }));
      expect(t.wire).toBe("openai");
    }
  });

  test("wants a key for somewhere out on the internet", () => {
    expect(resolveTarget(args({ baseUrl: "https://relay.example/v1" })).needsKey).toBe(true);
  });

  test("does not want one for something on this machine", () => {
    for (const base of [
      "http://localhost:5001/v1",
      "http://127.0.0.1:5000/v1",
      "http://[::1]:8080/v1",
      "http://0.0.0.0:1234/v1",
      "http://desktop.local:11434/v1",
    ]) {
      expect(resolveTarget(args({ baseUrl: base })).needsKey).toBe(false);
    }
  });
});

describe("isLocalBase", () => {
  test("is not fooled by a hostname that merely mentions localhost", () => {
    // The check decides whether a key may be skipped, so a remote host that
    // reads as local would quietly send requests with no credentials.
    for (const base of [
      "https://localhost.evil.example/v1",
      "https://notlocalhost/v1",
      "https://127.0.0.1.evil.example/v1",
      "https://example.com/?localhost",
    ]) {
      expect(isLocalBase(base)).toBe(false);
    }
  });

  test("says no rather than throwing on something that is not a URL", () => {
    for (const junk of ["", "not a url", "localhost:5001", "://"]) {
      expect(isLocalBase(junk)).toBe(false);
    }
  });
});

describe("the local suggestions", () => {
  test("all point at this machine, so none of them will demand a key", () => {
    for (const s of LOCAL_SUGGESTIONS) {
      expect(isLocalBase(s.base)).toBe(true);
      expect(resolveTarget(args({ baseUrl: s.base, format: s.format })).needsKey).toBe(false);
    }
  });

  test("each names a dialect this program can actually send", () => {
    for (const s of LOCAL_SUGGESTIONS) {
      expect(WIRES.some((w) => w.id === s.format)).toBe(true);
    }
  });
});

describe("a model on this phone, or on the computer next to it", () => {
  test("the home network is local: a phone reaches the computer running the model by its address, with no key", () => {
    for (const base of ["http://192.168.1.20:1234/v1", "http://10.0.0.5:11434/v1", "http://172.20.1.9:5001/v1",
      "http://100.101.102.103:8080/v1", "http://127.0.0.1:8080/v1", "http://gaming-pc.lan:1234/v1", "http://[fd12:3456::1]:8080/v1"]) {
      expect([base, isLocalBase(base)]).toEqual([base, true]);
    }
    // Outside the private ranges, or only named to look private: not trusted to need no key.
    for (const base of ["http://172.32.0.1/v1", "http://192.169.0.1/v1", "http://8.8.8.8/v1", "https://192.168.1.20.evil.example/v1", "http://100.128.0.1/v1"]) {
      expect([base, isLocalBase(base)]).toEqual([base, false]);
    }
    expect(resolveTarget({ provider: "custom", baseUrl: "http://192.168.1.20:1234/v1" } as any).needsKey).toBe(false);
  });

  test("Qwen3's 2507 models are not told /no_think, which neither reads; the original Qwen3 still is", () => {
    expect(thinkingOffSwitch("Qwen3-4B-Instruct-2507-Q4_K_M.gguf")).toBeNull();
    expect(thinkingOffSwitch("qwen3-4b-thinking-2507")).toBeNull();
    expect(thinkingOffSwitch("Qwen3-4B-Q4_K_M.gguf")).toBe("/no_think");
  });

  test("nothing answering is said as what to do, not 'fetch failed'", () => {
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    expect(unreachable("http://127.0.0.1:8080/v1", refused)!.message).toContain("Nothing is answering at 127.0.0.1:8080");
    (globalThis as any).__hearthOnPhone = true;
    try {
      expect(unreachable("http://127.0.0.1:8080/v1", refused)!.message).toContain("localhost is the phone itself");
    } finally { delete (globalThis as any).__hearthOnPhone; }
    const lost = Object.assign(new TypeError("fetch failed"), { cause: { code: "EHOSTUNREACH" } });
    expect(unreachable("http://192.168.1.20:1234/v1", lost)!.message).toContain("same wifi");
    expect(unreachable("http://x/v1", new Error("something else"))).toBeNull();
  });

  test("a local model is given twenty minutes, not four: a phone reading a long story is slow", async () => {
    const real = globalThis.fetch;
    let limit: AbortSignal | undefined;
    globalThis.fetch = (async (_u: any, init: any) => { limit = init.signal; throw new DOMException("t", "TimeoutError"); }) as any;
    try {
      const run = generate({ provider: "custom", baseUrl: "http://127.0.0.1:8080/v1", format: "openai", apiKey: "", model: "m",
        system: "", messages: [{ role: "user", content: "hi" }],
        sampling: { temperature: 1, maxTokens: 10, topP: 1, minP: 0, repetitionPenalty: 1, frequencyPenalty: 0, presencePenalty: 0, stream: false, reasoningEffort: "" } } as any);
      await expect((async () => { for await (const _ of run) {} })()).rejects.toThrow("after 20 minutes");
      expect(limit).toBeInstanceOf(AbortSignal);
    } finally { globalThis.fetch = real; }
  });
});

test("llama-server's 'too long for my context' is said as which setting to lower", async () => {
  const real = globalThis.fetch;
  const ask = (maxTokens: number, prompt: number) => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: 400, message: "the request exceeds the available context size, try increasing it",
      type: "exceed_context_size_error", n_prompt_tokens: prompt, n_ctx: 8192 } }), { status: 400 })) as any;
    const run = generate({ provider: "custom", baseUrl: "http://127.0.0.1:8080/v1", format: "openai", apiKey: "", model: "m", system: "", messages: [{ role: "user", content: "hi" }],
      sampling: { temperature: 1, maxTokens, topP: 1, minP: 0, repetitionPenalty: 1, frequencyPenalty: 0, presencePenalty: 0, stream: true, reasoningEffort: "" } } as any);
    return (async () => { for await (const _ of run) {} })().then(() => "", (e) => e.message);
  };
  try {
    const big = await ask(9000, 150);
    expect(big).toContain("It holds 8192 tokens; this asked for 150 of story and up to 9000 for the reply");
    expect(big).toContain('Lower "Reply length"');
    expect(await ask(800, 7900)).toContain('Lower "Conversation sent" (or "Reply length")');
  } finally { globalThis.fetch = real; }
});
