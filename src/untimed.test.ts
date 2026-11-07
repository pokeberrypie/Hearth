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
