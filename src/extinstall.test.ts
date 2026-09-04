/**
 * Installing an extension from a repository — the parts that need no network.
 *
 *   bun test src/extinstall.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  archiveUrls,
  buildFromRepo,
  parseRepo,
  readManifest,
  stripRoot,
  type RepoFile,
} from "./extinstall";

describe("reading a repository address", () => {
  test("the forms people actually paste", () => {
    for (const input of [
      "https://github.com/pokeberrypie/hearth-dice",
      "https://github.com/pokeberrypie/hearth-dice/",
      "https://github.com/pokeberrypie/hearth-dice.git",
      "https://www.github.com/pokeberrypie/hearth-dice",
      "git@github.com:pokeberrypie/hearth-dice.git",
      "pokeberrypie/hearth-dice",
      "  https://github.com/pokeberrypie/hearth-dice  ",
    ]) {
      expect(parseRepo(input)).toMatchObject({ owner: "pokeberrypie", repo: "hearth-dice" });
    }
  });

  test("a branch named in the URL is kept", () => {
    expect(parseRepo("https://github.com/a/b/tree/dev")).toEqual({ owner: "a", repo: "b", ref: "dev" });
  });

  test("refuses what it cannot actually fetch", () => {
    expect(parseRepo("https://gitlab.com/a/b")).toBeNull();
    expect(parseRepo("https://example.com/evil.zip")).toBeNull();
    expect(parseRepo("https://github.com/onlyowner")).toBeNull();
    expect(parseRepo("")).toBeNull();
    expect(parseRepo("not a url at all")).toBeNull();
  });

  test("a named branch is tried alone, an unnamed one both ways", () => {
    expect(archiveUrls({ owner: "a", repo: "b", ref: "dev" }))
      .toEqual(["https://codeload.github.com/a/b/zip/refs/heads/dev"]);
    expect(archiveUrls({ owner: "a", repo: "b" })).toEqual([
      "https://codeload.github.com/a/b/zip/refs/heads/main",
      "https://codeload.github.com/a/b/zip/refs/heads/master",
    ]);
  });
});

describe("the archive's wrapper directory", () => {
  test("is stripped when everything shares it", () => {
    const files: RepoFile[] = [
      { path: "hearth-dice-main/manifest.json", text: "{}" },
      { path: "hearth-dice-main/client.js", text: "x" },
    ];
    expect(stripRoot(files).map((f) => f.path)).toEqual(["manifest.json", "client.js"]);
  });

  test("is left alone when it is not actually shared", () => {
    const files: RepoFile[] = [{ path: "a/x.js", text: "" }, { path: "b/y.js", text: "" }];
    expect(stripRoot(files).map((f) => f.path)).toEqual(["a/x.js", "b/y.js"]);
  });
});

describe("the manifest", () => {
  test("Hearth's own fields", () => {
    expect(readManifest({ name: "Dice", version: "1.2.0", description: "rolls", client: "c.js", server: "s.js" }))
      .toEqual({ name: "Dice", version: "1.2.0", description: "rolls", client: "c.js", server: "s.js" });
  });

  test("SillyTavern's field names are understood", () => {
    // It will not run here, but it arrives named rather than blank.
    expect(readManifest({ display_name: "Quick Replies", js: "index.js" }))
      .toMatchObject({ name: "Quick Replies", client: "index.js" });
  });

  test("a manifest with no name is no manifest", () => {
    expect(readManifest({ version: "1.0.0" })).toBeNull();
    expect(readManifest(null)).toBeNull();
    expect(readManifest("nope")).toBeNull();
  });

  test("missing version has a sensible default", () => {
    expect(readManifest({ name: "A" })?.version).toBe("0.0.0");
  });
});

describe("building the extension", () => {
  const repo = (extra: RepoFile[] = []): RepoFile[] => [
    { path: "dice-main/hearth.json", text: JSON.stringify({ name: "Dice", version: "1.0.0", client: "client.js" }) },
    { path: "dice-main/client.js", text: "hearth.on('ready', () => {})" },
    ...extra,
  ];

  test("reads the manifest and picks up the code", () => {
    const out = buildFromRepo(repo(), "github.com/x/dice");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.extension.name).toBe("Dice");
    expect(out.extension.client).toContain("hearth.on");
    expect(out.extension.enabled).toBe(true);
  });

  test("says which file is missing rather than installing a blank", () => {
    const out = buildFromRepo([
      { path: "d-main/hearth.json", text: JSON.stringify({ name: "D", client: "nope.js" }) },
    ], "src");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain("nope.js");
  });

  test("refuses a manifest reaching outside its own archive", () => {
    const out = buildFromRepo([
      { path: "d-main/hearth.json", text: JSON.stringify({ name: "D", client: "../../../etc/passwd" }) },
    ], "src");
    expect(out.ok).toBe(false);
  });

  test("refuses a repository with no manifest", () => {
    const out = buildFromRepo([{ path: "d-main/README.md", text: "# hi" }], "src");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain("No manifest");
  });

  test("refuses a manifest that names no code", () => {
    const out = buildFromRepo([
      { path: "d-main/hearth.json", text: JSON.stringify({ name: "D" }) },
    ], "src");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain("no code");
  });

  test("says so when the manifest is not valid JSON", () => {
    const out = buildFromRepo([{ path: "d-main/hearth.json", text: "{ oops" }], "src");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain("not valid JSON");
  });

  test("falls back to where it came from when there is no description", () => {
    const out = buildFromRepo(repo(), "github.com/x/dice");
    if (!out.ok) throw new Error("expected ok");
    expect(out.extension.description).toBe("github.com/x/dice");
  });
});
