/**
 * What the page may not do, because the phone cannot.
 *
 * Hearth on Android is a WebView, and a WebView is not a browser: it answers confirm() "no" at once and cancels
 * prompt() and alert(), and a download is handed to the app, which fetches it over HTTP and cannot fetch a blob:.
 * Each was found as a button that did nothing on the phone and worked on the desktop — the date correction, the
 * Steward's reading of a whole chat, the emblem, the wipe; the story, calendar, classes and face template that
 * "would not save". Hearth's own dialogs (askDialog, ask, askFor) and saveFile are what to use.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..", "public");
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
// The code, without its comments: a comment may name what it must not call.
const code = (f: string) => readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

test("no browser dialogs: the phone answers them before anyone sees them", () => {
  const found = files.flatMap((f) => [...code(f).matchAll(/(^|[^.\w])(?:window\.)?(confirm|prompt|alert)\s*\(/g)].map((m) => `${f}: ${m[2]}()`));
  expect(found).toEqual([]);
});

test("no blob: downloads: the phone cannot fetch them, so they never save there", () => {
  const found = files.flatMap((f) => [...code(f).matchAll(/\.download\s*=/g)].map(() => `${f}: <a download> on a made-up link`));
  expect(found).toEqual([]);
});
