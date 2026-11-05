/**
 * Story World inside its room. Context size caps the whole request, and Story World is part of it: at a small
 * context it gives up what the next reply can most do without — rumours before the people in the room — and
 * never the date or a threat at the door.
 */
import { describe, expect, test } from "bun:test";
import { wipe } from "./test-support";
wipe();
const { fitWorld } = await import("./index");

const L = (keep: number, text: string) => ({ keep, text });
const world = [
  L(0, "Today in the story: the 3rd day of the 2nd moon."),
  L(2, "How everyone here is right now — keep to this unless the story changes it:"),
  L(2, "- Jaime Lannister — health: a cut on the arm"),
  L(3, "Threads still open, to pick up when it fits: the missing letter."),
  L(5, "From earlier in the story, and relevant now — remembered, not happening again:"),
  L(5, "- They fought on the bridge. " + "x".repeat(200)),
  L(7, "What some of the people here have seen or heard: " + "y".repeat(300)),
  L(0, "Bring this into the story now, as something happening in the scene: someone sends a hired knife."),
];

describe("Story World inside its room", () => {
  test("all of it when it fits", () => {
    expect(fitWorld(world, 100000)!.split("\n")).toHaveLength(world.length);
  });

  test("the least needed goes first, and a heading left with nothing under it goes with it", () => {
    const out = fitWorld(world, 700)!;
    expect(out).not.toContain("What some of the people here");
    expect(out).toContain("Jaime Lannister — health");
    const tight = fitWorld(world, 330)!;
    expect(tight).not.toContain("From earlier in the story");
    expect(tight).not.toContain("They fought on the bridge");
    expect(tight).toContain("Today in the story");
    expect(tight).toContain("hired knife");
  });

  test("never the date or a threat, however little room there is", () => {
    const out = fitWorld(world, 10)!;
    expect(out).toContain("Today in the story");
    expect(out).toContain("hired knife");
    expect(out).not.toContain("How everyone here");
  });
});
