/**
 * "No thinking", in each model family's own words, and on the services that have a setting for it.
 *
 *   bun test src/thinking.test.ts
 */

import { afterAll, expect, test } from "bun:test";

import { generate, thinkingOffSwitch } from "./providers";

const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });

async function bodyFor(provider: string, model: string, reasoningEffort: string, system = "Be the narrator.") {
  let body: any = null;
  globalThis.fetch = (async (_u: any, init: any) => {
    body = JSON.parse(init.body);
    return Response.json({ choices: [{ message: { content: "ok" } }] });
  }) as any;
  for await (const _ of generate({
    provider, apiKey: "k", baseUrl: "http://localhost:8080/v1", format: "openai", model, system,
    messages: [{ role: "user", content: "Hello." }],
    sampling: { temperature: 1, maxTokens: 100, topP: 1, minP: 0, repetitionPenalty: 1, frequencyPenalty: 0, presencePenalty: 0,
      stream: false, reasoningEffort: reasoningEffort as any },
  } as any)) { /* drain */ }
  return body;
}

test("the families with a switch, and the ones without", () => {
  expect(thinkingOffSwitch("nvidia/llama-3.3-nemotron-super-49b-v1.5")).toContain("/no_think");
  expect(thinkingOffSwitch("nvidia/nemotron-nano-12b-v2-vl")).toContain("/no_think");
  expect(thinkingOffSwitch("qwen/qwen3-235b-a22b")).toBe("/no_think");
  expect(thinkingOffSwitch("z-ai/glm-4.6")).toBe("/nothink");
  expect(thinkingOffSwitch("deepseek/deepseek-v3.2")).toBeNull();
  expect(thinkingOffSwitch("anthropic/claude-sonnet-4.5")).toBeNull();
});

test("Nemotron on NanoGPT, thinking off: told so in its system message — and nothing when thinking is left alone", async () => {
  const off = await bodyFor("nanogpt", "nvidia/nemotron-super-vl", "off");
  expect(off.messages[0]).toEqual({ role: "system", content: "Be the narrator.\n\ndetailed thinking off\n/no_think" });
  const left = await bodyFor("nanogpt", "nvidia/nemotron-super-vl", "");
  expect(left.messages[0].content).toBe("Be the narrator.");
});

test("no system message: the switch goes on the last thing the user said", async () => {
  const b = await bodyFor("google", "qwen3-32b", "off", "");
  expect(b.messages.at(-1)).toEqual({ role: "user", content: "Hello.\n\n/no_think" });
});

test("OpenRouter is told not to think at all, not just to hide it; a local server gets its template's switch", async () => {
  expect((await bodyFor("openrouter", "deepseek/deepseek-v3.2", "off")).reasoning).toEqual({ enabled: false, exclude: true });
  expect((await bodyFor("custom", "qwen3-8b", "off")).chat_template_kwargs).toEqual({ enable_thinking: false });
  expect((await bodyFor("nanogpt", "qwen3-8b", "off")).chat_template_kwargs).toBeUndefined();
});
