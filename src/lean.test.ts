/**
 * Sending less over a tunnel: compressed text, validators on files, and the
 * live feed left exactly as it is.
 *
 *   bun test src/lean.test.ts
 */
import { describe, expect, test } from "bun:test";
import { withLean } from "./lean";

const big = "x".repeat(50_000);
const serve = withLean((req) => {
  const path = new URL(req.url).pathname;
  if (path === "/app.js") return new Response(big, { headers: { "content-type": "text/javascript" } });
  if (path === "/fonts/a.woff2") return new Response(new Uint8Array(2000), { headers: { "content-type": "font/woff2" } });
  if (path === "/live") {
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("data: 1\n\n")); } }),
      { headers: { "content-type": "text/event-stream" } });
  }
  if (path === "/backup.zip") return new Response(new Uint8Array(5000), { headers: { "content-type": "application/zip" } });
  return new Response("nope", { status: 404 });
});
const get = (path: string, headers: Record<string, string> = {}) =>
  serve(new Request(`http://x${path}`, { headers })) as Promise<Response>;

describe("lean responses", () => {
  test("script is gzipped for a browser that accepts it, and still the same script", async () => {
    const r = await get("/app.js", { "accept-encoding": "gzip, br" });
    expect(r.headers.get("content-encoding")).toBe("gzip");
    const packed = new Uint8Array(await r.arrayBuffer());
    expect(packed.length).toBeLessThan(big.length / 10);
    expect(new TextDecoder().decode(Bun.gunzipSync(packed))).toBe(big);
  });

  test("and sent plain to one that does not", async () => {
    const r = await get("/app.js");
    expect(r.headers.get("content-encoding")).toBeNull();
    expect((await r.text()).length).toBe(big.length);
  });

  test("a browser that already has it gets 'not modified' and no body", async () => {
    const tag = (await get("/app.js")).headers.get("etag")!;
    expect(tag).toBeTruthy();
    const r = await get("/app.js", { "if-none-match": tag });
    expect(r.status).toBe(304);
    expect((await r.arrayBuffer()).byteLength).toBe(0);
  });

  test("fonts may simply be kept", async () => {
    const r = await get("/fonts/a.woff2");
    expect(r.headers.get("cache-control")).toContain("immutable");
  });

  test("the live feed is never held back or rewritten", async () => {
    const r = await get("/live", { "accept-encoding": "gzip" });
    expect(r.headers.get("content-encoding")).toBeNull();
    expect(r.headers.get("etag")).toBeNull();
  });

  test("nor is a backup, which is already as small as it gets", async () => {
    const r = await get("/backup.zip", { "accept-encoding": "gzip" });
    expect(r.headers.get("content-encoding")).toBeNull();
  });
});
