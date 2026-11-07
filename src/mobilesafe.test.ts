/**
 * The phone's Node (nodejs-mobile, Node 18) is built without ICU. There, a
 * regular expression with a Unicode property escape — \p{L}, \P{...},
 * \p{Script=Han} — is a syntax error in the whole bundle: Node stops before
 * the first line of main.js runs and the app dies with nothing recorded.
 * 0.2.7's first APK shipped one and did exactly that. Nothing the server
 * bundles may use them.
 *
 *   bun test src/mobilesafe.test.ts
 */

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const roots = [join(import.meta.dir), join(import.meta.dir, "..", "mobile", "server")];

test("no Unicode property escapes anywhere the server is built from", () => {
  const found: string[] = [];
  for (const dir of roots) {
    for (const name of readdirSync(dir)) {
      if (!/\.(ts|js)$/.test(name) || name.endsWith(".test.ts")) continue;
      readFileSync(join(dir, name), "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line)) return;
        if (/\\[pP]\{/.test(line)) found.push(`${name}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  expect(found).toEqual([]);
});

test("nothing else that needs ICU: no Intl, and .normalize() only where a failure is caught", () => {
  const found: string[] = [];
  for (const dir of roots) {
    for (const name of readdirSync(dir)) {
      if (!/\.(ts|js)$/.test(name) || name.endsWith(".test.ts")) continue;
      readFileSync(join(dir, name), "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line)) return;
        if (/\bIntl\./.test(line)) found.push(`${name}:${i + 1}: ${line.trim()}`);
        if (/\.normalize\(/.test(line) && !/\btry\b/.test(line)) found.push(`${name}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  expect(found).toEqual([]);
});

test("and the phone's built bundle itself — its libraries included — has none either", () => {
  const bundle = join(import.meta.dir, "..", "mobile", "dist", "nodejs-project", "main.js");
  let text = "";
  try { text = readFileSync(bundle, "utf8"); } catch { return; } // not built here: the source checks above stand
  expect(text.match(/\\[pP]\{[A-Za-z_=]*\}/g) ?? []).toEqual([]);
  expect(text.match(/\bIntl\.[A-Za-z]+/g) ?? []).toEqual([]);
});
