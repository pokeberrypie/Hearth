/**
 * Extensions: the model, and what happens when one misbehaves.
 *
 *   bun test src/extensions.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  collectServerHooks,
  hasClient,
  hasServer,
  normaliseExtension,
  runServerHook,
  type Extension,
  type PromptPayload,
} from "./extensions";

const make = (over: Partial<Extension> = {}): Extension =>
  normaliseExtension({ name: "Test", ...over });

describe("the model", () => {
  test("fills in what an imported file leaves out", () => {
    const e = normaliseExtension({ name: "Dice" });
    expect(e.name).toBe("Dice");
    expect(e.version).toBe("0.0.0");
    expect(e.enabled).toBe(true);
    expect(e.client).toBe("");
    expect(e.server).toBe("");
    expect(e.id).toBeTruthy();
  });

  test("an extension you just added is one you want on", () => {
    expect(normaliseExtension({ name: "A" }).enabled).toBe(true);
    expect(normaliseExtension({ name: "A", enabled: false }).enabled).toBe(false);
  });

  test("survives nonsense rather than throwing", () => {
    const e = normaliseExtension({ name: 42, version: null, client: undefined });
    expect(e.name).toBe("42");
    expect(e.version).toBe("0.0.0");
    expect(e.client).toBe("");
  });

  test("something with no name is still openable", () => {
    expect(normaliseExtension({}).name).toBe("Untitled extension");
  });

  test("a half is only worth running if it is there and switched on", () => {
    expect(hasServer(make({ server: "x" }))).toBe(true);
    expect(hasServer(make({ server: "x", enabled: false }))).toBe(false);
    expect(hasServer(make({ server: "   " }))).toBe(false);
    expect(hasClient(make({ client: "x" }))).toBe(true);
  });
});

describe("registering", () => {
  test("collects the hooks a source registers", () => {
    const hooks = collectServerHooks(make({
      server: `hearth.on("prompt:before", p => p); hearth.on("reply:after", p => p);`,
    }));
    expect(hooks.get("prompt:before")).toHaveLength(1);
    expect(hooks.get("reply:after")).toHaveLength(1);
  });

  test("an unknown hook is reported, not registered", () => {
    const seen: string[] = [];
    const hooks = collectServerHooks(
      make({ server: `hearth.on("prompt:whenever", p => p);` }),
      (where) => seen.push(where),
    );
    expect(hooks.size).toBe(0);
    expect(seen[0]).toContain("unknown hook");
  });

  test("a source that will not even parse loads as nothing", () => {
    const seen: string[] = [];
    const hooks = collectServerHooks(make({ server: `this is not javascript(` }), (w) => seen.push(w));
    expect(hooks.size).toBe(0);
    expect(seen[0]).toContain("failed to load");
  });

  test("a source that throws while registering loads as nothing", () => {
    const hooks = collectServerHooks(make({ server: `throw new Error("nope");` }));
    expect(hooks.size).toBe(0);
  });

  test("cannot see the host's own variables", () => {
    // `ext` and `hooks` exist in the function that compiles this; the source
    // must not be able to reach them.
    const hooks = collectServerHooks(make({
      server: `hearth.on("reply:after", () => (typeof ext) + "," + (typeof hooks));`,
    }));
    const out = hooks.get("reply:after")![0]({});
    expect(out).toBe("undefined,undefined");
  });
});

describe("running a hook", () => {
  const prompt = (): PromptPayload => ({ system: "You are Maren.", messages: [{ role: "user", content: "hi" }] });

  test("a returned value replaces the payload", () => {
    const out = runServerHook([make({
      server: `hearth.on("prompt:before", p => ({ ...p, system: p.system + " Be brief." }));`,
    })], "prompt:before", prompt());
    expect(out.system).toBe("You are Maren. Be brief.");
  });

  test("changing it in place works too", () => {
    const out = runServerHook([make({
      server: `hearth.on("prompt:before", p => { p.messages.push({ role: "user", content: "and" }); });`,
    })], "prompt:before", prompt());
    expect(out.messages).toHaveLength(2);
  });

  test("extensions run in order, each seeing the last one's work", () => {
    const a = make({ name: "A", server: `hearth.on("reply:after", t => t + " one");` });
    const b = make({ name: "B", server: `hearth.on("reply:after", t => t + " two");` });
    expect(runServerHook([a, b], "reply:after", "start")).toBe("start one two");
  });

  test("a disabled extension does nothing", () => {
    const off = make({ enabled: false, server: `hearth.on("reply:after", t => "hijacked");` });
    expect(runServerHook([off], "reply:after", "kept")).toBe("kept");
  });

  test("one that throws is skipped, and the rest still run", () => {
    const seen: string[] = [];
    const bad = make({ name: "Bad", server: `hearth.on("reply:after", () => { throw new Error("x"); });` });
    const good = make({ name: "Good", server: `hearth.on("reply:after", t => t + "!");` });
    expect(runServerHook([bad, good], "reply:after", "hi", (w) => seen.push(w))).toBe("hi!");
    expect(seen[0]).toContain("Bad threw");
  });

  test("a hook returning nothing means it only looked", () => {
    const e = make({ server: `hearth.on("reply:after", t => { const x = t.length; });` });
    expect(runServerHook([e], "reply:after", "unchanged")).toBe("unchanged");
  });

  test("a hook returning the wrong shape cannot blank the payload", () => {
    // The classic accident: a handler whose last expression is a number.
    const e = make({ server: `hearth.on("reply:after", t => 42);` });
    expect(runServerHook([e], "reply:after", "safe")).toBe("safe");

    const p = make({ server: `hearth.on("prompt:before", p => "oops");` });
    expect(runServerHook([p], "prompt:before", prompt()).system).toBe("You are Maren.");
  });

  test("no extensions at all is not a special case", () => {
    expect(runServerHook([], "reply:after", "same")).toBe("same");
  });
});
