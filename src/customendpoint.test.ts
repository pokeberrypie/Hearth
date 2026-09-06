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
  LOCAL_SUGGESTIONS, PROVIDERS, WIRES, isLocalBase, resolveTarget,
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
