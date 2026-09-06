/**
 * Avatar packs.
 *
 * A pack is a file somebody downloaded from a stranger, and the manifest inside
 * it names paths that this program then reads and writes. That is the whole
 * reason this file exists: `safePackPath` is the only thing standing between a
 * pack and an arbitrary write, so it is tested against the ways that go wrong
 * rather than only against the way that goes right.
 *
 * The rest is the same bargain the class importer makes — one bad entry is
 * dropped, the good ones land — because an import that refuses thirty-nine good
 * hairstyles over a typo in the fortieth is an import nobody uses twice.
 */

import { describe, expect, test } from "bun:test";

import { LAYERS, TINTS, packIsUsable, readPackManifest, safePackPath, slugId } from "./avatar";

const part = (over: Record<string, unknown> = {}) => ({
  layer: "hair", id: "long", name: "Long", file: "hair/long.png", tint: "hair", ...over,
});

const manifest = (parts: unknown[], over: Record<string, unknown> = {}) =>
  ({ name: "A pack", author: "Somebody", parts, ...over });

describe("paths inside a pack", () => {
  test("an ordinary relative path is fine", () => {
    expect(safePackPath("hair/long.png")).toBe("hair/long.png");
    expect(safePackPath("eyes.webp")).toBe("eyes.webp");
    expect(safePackPath("a/b/c/d.svg")).toBe("a/b/c/d.svg");
  });

  test("nothing climbs out of the pack", () => {
    for (const bad of [
      "../secret.png",
      "hair/../../secret.png",
      "./../x.png",
      "/etc/passwd.png",
      "C:/Windows/system32/x.png",
      "c:\\windows\\x.png",
      "hair\\long.png",
      "hair//long.png",
      "..",
      "hair/./long.png",
    ]) {
      expect(safePackPath(bad)).toBeNull();
    }
  });

  test("a NUL byte does not sneak a shorter path past the check", () => {
    expect(safePackPath("hair/long.png\0.txt")).toBeNull();
  });

  test("only picture extensions", () => {
    expect(safePackPath("hair/long.exe")).toBeNull();
    expect(safePackPath("manifest.json")).toBeNull();
    expect(safePackPath("hair/long")).toBeNull();
    expect(safePackPath("hair/long.PNG")).toBe("hair/long.PNG");
  });

  test("nothing absurd", () => {
    expect(safePackPath("")).toBeNull();
    expect(safePackPath(null)).toBeNull();
    expect(safePackPath(`${"a/".repeat(80)}x.png`)).toBeNull();
  });
});

describe("reading a manifest", () => {
  test("keeps a good part whole", () => {
    const { pack, skipped } = readPackManifest(manifest([part()]));
    expect(skipped).toEqual([]);
    expect(pack.parts).toEqual([
      { layer: "hair", id: "long", name: "Long", file: "hair/long.png", tint: "hair" },
    ]);
    expect(pack.name).toBe("A pack");
    expect(pack.author).toBe("Somebody");
  });

  test("drops the bad one and keeps the rest", () => {
    const { pack, skipped } = readPackManifest(manifest([
      part({ id: "a" }),
      part({ id: "b", layer: "trousers" }),      // no such layer
      part({ id: "c", file: "../out.png" }),     // climbing out
      part({ id: "d" }),
    ]));
    expect(pack.parts.map((p) => p.id)).toEqual(["a", "d"]);
    expect(skipped.length).toBe(2);
  });

  test("a repeated id within a layer loses, because the second is unreachable", () => {
    const { pack, skipped } = readPackManifest(manifest([
      part({ id: "long", name: "First" }),
      part({ id: "long", name: "Second" }),
    ]));
    expect(pack.parts.length).toBe(1);
    expect(pack.parts[0].name).toBe("First");
    expect(skipped).toEqual(["Second"]);
  });

  test("the same id on a different layer is a different part", () => {
    const { pack } = readPackManifest(manifest([
      part({ layer: "hair", id: "long" }),
      part({ layer: "ears", id: "long" }),
    ]));
    expect(pack.parts.length).toBe(2);
  });

  test("an unknown tint becomes no tint rather than a rejection", () => {
    const { pack } = readPackManifest(manifest([part({ tint: "trousers" })]));
    expect(pack.parts[0].tint).toBeNull();
  });

  test("every real tint survives", () => {
    for (const tint of TINTS) {
      const { pack } = readPackManifest(manifest([part({ tint })]));
      expect(pack.parts[0].tint).toBe(tint);
    }
  });

  test("every real layer survives", () => {
    for (const layer of LAYERS) {
      const { pack } = readPackManifest(manifest([part({ layer })]));
      expect(pack.parts[0].layer).toBe(layer);
    }
  });

  test("an id is derived from the name when one is missing", () => {
    const { pack } = readPackManifest(manifest([
      { layer: "hair", name: "Very Long Braid", file: "a.png" },
    ]));
    expect(pack.parts[0].id).toBe("very-long-braid");
  });

  test("nothing usable is reported as such rather than as an empty pack", () => {
    const { pack } = readPackManifest(manifest([part({ layer: "nope" })]));
    expect(packIsUsable(pack)).toBe(false);
  });

  test("junk in place of a manifest does not throw", () => {
    for (const junk of [null, undefined, 42, "hello", [], {}, { parts: "no" }]) {
      const { pack } = readPackManifest(junk as any);
      expect(packIsUsable(pack)).toBe(false);
    }
  });

  test("an enormous manifest is capped rather than accepted whole", () => {
    const many = Array.from({ length: 900 }, (_, i) => part({ id: `h${i}` }));
    const { pack } = readPackManifest(manifest(many));
    expect(pack.parts.length).toBeLessThanOrEqual(500);
  });

  test("an id cannot be used to smuggle markup", () => {
    const { pack } = readPackManifest(manifest([
      part({ id: `"><script>alert(1)</script>`, name: "x" }),
    ]));
    /*
     * Slugged rather than refused. The id is not the interesting field to a
     * person writing a pack, so mangling it into something safe keeps their
     * hairstyle working; what matters is only that nothing that could close an
     * attribute or open a tag survives into the markup it ends up in.
     */
    expect(pack.parts[0].id).toBe("script-alert-1-script");
    expect(pack.parts[0].id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  test("a name is kept for reading but never has to be safe as a path", () => {
    const { pack } = readPackManifest(manifest([
      part({ id: "ok", name: `<b>Bold</b>` }),
    ]));
    // Kept verbatim; the client escapes it where it is shown, as it does for
    // every other name a person types.
    expect(pack.parts[0].name).toBe("<b>Bold</b>");
    expect(pack.parts[0].file).toBe("hair/long.png");
  });
});

describe("slugId", () => {
  test("makes something usable in a path out of a name", () => {
    expect(slugId("A Pack of Hats")).toBe("a-pack-of-hats");
    expect(slugId("  ...Weird!! ")).toBe("weird");
    expect(slugId("")).toBe("");
    expect(slugId(null)).toBe("");
  });

  test("cannot produce a path segment that climbs", () => {
    expect(slugId("../..")).toBe("");
    expect(slugId("..")).toBe("");
  });
});
