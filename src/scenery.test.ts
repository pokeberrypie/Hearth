/**
 * Matching a scene to the sound of it, and to a picture already on disk.
 *
 * Most of this is about refusing. A weak match is worse than none: a room that
 * changes sound for a reason nobody can name is a feature you switch off
 * rather than one you trust, and the first "the sea" that fires on the word
 * "seat" is the one that does it.
 */

import { describe, expect, test } from "bun:test";

import { soundFor, wallpaperFor } from "./scenery";

describe("the sound a scene wants", () => {
  test("hears the obvious ones", () => {
    expect(soundFor("The bridge at dusk, rain coming on")).toBe("rain");
    expect(soundFor("The harbour, waves against the quay")).toBe("sea");
    expect(soundFor("By the fire in the hearth, embers low")).toBe("fire");
    expect(soundFor("Open country, wind across the moor")).toBe("wind");
  });

  test("says nothing when the scene says nothing", () => {
    for (const s of ["", "   ", null, undefined, "A corridor.", "She looked at him."]) {
      expect(soundFor(s as any)).toBeNull();
    }
  });

  test("never matches a word inside another word", () => {
    // The one that would ruin it: "seat" is not the sea, "windows" is not wind,
    // "firearm" is not a fire.
    expect(soundFor("He took a seat.")).toBeNull();
    expect(soundFor("Rows of windows.")).toBeNull();
    expect(soundFor("A firearm on the table.")).toBeNull();
    expect(soundFor("The training ground.")).toBeNull();
  });

  test("a scene that says two things equally is not a decision", () => {
    // A tie is not an answer; leaving the room as it was is.
    expect(soundFor("rain and sea")).toBeNull();
  });

  test("but a clear majority is", () => {
    expect(soundFor("Rain, downpour, thunder over the harbour")).toBe("rain");
  });

  test("punctuation is a word boundary", () => {
    expect(soundFor("Outside: rain.")).toBe("rain");
    expect(soundFor("(wind)")).toBe("wind");
  });
});

describe("the wallpaper it picks", () => {
  const files = [
    "greywater-bridge-dusk.png",
    "mistridge-fog-woods.png",
    "IMG_2043.png",
    "tavern-interior-night.jpg",
  ];

  test("finds one whose name says the same things", () => {
    expect(wallpaperFor("The Greywater bridge at dusk", files))
      .toBe("greywater-bridge-dusk.png");
    expect(wallpaperFor("Fog over the Mistridge woods", files))
      .toBe("mistridge-fog-woods.png");
  });

  test("one word in common is a coincidence, not a match", () => {
    // "bridge" alone must not pull up the Greywater picture for a scene set on
    // a completely different bridge.
    expect(wallpaperFor("A bridge", files)).toBeNull();
    expect(wallpaperFor("The woods", files)).toBeNull();
  });

  test("picks nothing rather than something wrong", () => {
    expect(wallpaperFor("A cellar under the barracks", files)).toBeNull();
    expect(wallpaperFor("", files)).toBeNull();
    expect(wallpaperFor("The bridge at dusk", [])).toBeNull();
    expect(wallpaperFor("anything", ["IMG_2043.png", "IMG_2044.png"])).toBeNull();
  });

  test("the file extension is not a word anybody meant", () => {
    // Otherwise every scene mentioning a picture matches every png.
    expect(wallpaperFor("a png image wallpaper", files)).toBeNull();
  });

  test("and the best of several wins", () => {
    const many = ["bridge-dusk.png", "greywater-bridge-dusk-rain.png"];
    expect(wallpaperFor("The greywater bridge at dusk in the rain", many))
      .toBe("greywater-bridge-dusk-rain.png");
  });
});
