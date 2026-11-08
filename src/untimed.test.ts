/**
 * A model on this phone or network may take more than five minutes to begin: the runtime's own fetch limit is lifted
 * for it (Hearth's own still hold). A provider on the internet keeps the runtime's limit.
 */
import { afterAll, expect, test } from "bun:test";
import { generate } from "./providers";
const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });

const ask = async (base: string, apiKey = "") => {
  let seen: any = null;
  globalThis.fetch = (async (_u: any, init: any) => { seen = init; return Response.json({ choices: [{ message: { content: "ok" } }] }); }) as any;
  for await (const _ of generate({ provider: "custom", baseUrl: base, apiKey, model: "m", system: "", messages: [{ role: "user", content: "hi" }],
    sampling: { temperature: 1, maxTokens: 10, topP: 1, minP: 0, repetitionPenalty: 1, frequencyPenalty: 0, presencePenalty: 0, stream: false } } as any)) { /* drain */ }
  return seen;
};

test("a model on this machine or network is waited for as long as it takes: no five-minute runtime limit", async () => {
  expect((await ask("http://127.0.0.1:8080/v1")).timeout).toBe(false);
  expect((await ask("http://192.168.1.20:8080/v1")).timeout).toBe(false);
});

test("a provider on the internet keeps the runtime's own limit", async () => {
  expect((await ask("https://api.example.com/v1", "sk-test")).timeout).toBeUndefined();
});

test("GLM on NanoGPT is told not to think in the words it hears: reasoning_effort low (none and /nothink are not)", async () => {
  const { thinkingOffRequest } = await import("./providers");
  expect(thinkingOffRequest("nanogpt", "https://nano-gpt.com/api/v1", "z-ai/glm-5.3-flash").extra).toEqual({ reasoning_effort: "low" });
  // Not sent to other NanoGPT models, where it has not been tried.
  expect(thinkingOffRequest("nanogpt", "https://nano-gpt.com/api/v1", "deepseek/deepseek-v3").extra).toEqual({});
});

test("refused for asking more room to answer than the provider gives: asked once more at 2,048, and remembered", async () => {
  const asked: number[] = [];
  globalThis.fetch = (async (_u: any, init: any) => {
    const b = JSON.parse(init.body); asked.push(b.max_tokens);
    return b.max_tokens > 2048 ? new Response("upstream request failed", { status: 502 }) : Response.json({ choices: [{ message: { content: "ok" } }] });
  }) as any;
  const go = async () => { let out = ""; for await (const c of generate({ provider: "nanogpt", apiKey: "sk", model: "z-ai/glm-test-cap", system: "", messages: [{ role: "user", content: "hi" }],
    sampling: { temperature: 1, maxTokens: 4000, topP: 1, minP: 0, repetitionPenalty: 1, frequencyPenalty: 0, presencePenalty: 0, stream: false } } as any)) if (c.kind === "text") out += c.text; return out; };
  expect(await go()).toBe("ok");
  expect(asked).toEqual([4000, 2048]);
  expect(await go()).toBe("ok");
  expect(asked).toEqual([4000, 2048, 2048]);
});

test("refused for some other reason, a retry with less room that is refused too leaves later askings their full room", async () => {
  const asked: number[] = [];
  globalThis.fetch = (async (_u: any, init: any) => { asked.push(JSON.parse(init.body).max_tokens); return new Response("content filtered", { status: 400 }); }) as any;
  const go = async () => { try { for await (const _ of generate({ provider: "nanogpt", apiKey: "sk", model: "z-ai/glm-other", system: "", messages: [{ role: "user", content: "hi" }],
    sampling: { temperature: 1, maxTokens: 3000, topP: 1, minP: 0, repetitionPenalty: 1, frequencyPenalty: 0, presencePenalty: 0, stream: false } } as any)) { /* */ } } catch { /* refused */ } };
  await go();
  await go();
  expect(asked).toEqual([3000, 2048, 3000, 2048]);
});
