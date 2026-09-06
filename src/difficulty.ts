/**
 * How hard the table is.
 *
 * Not a number the narrator is told to hit. A difficulty setting that says
 * "make it harder" gets you a narrator that invents obstacles and gloats, and
 * one that says "make it easier" gets you a narrator that removes the story.
 * What actually changes between an easy table and a brutal one is narrower and
 * duller than that, and it is three things:
 *
 *   - what a roll has to beat,
 *   - what happens when you fail one,
 *   - and whether the world was already moving before you got there.
 *
 * So each setting says those three things plainly, and says nothing about
 * tone. The story stays whatever you and the narrator make it; the difficulty
 * decides how much the dice are allowed to take from you.
 *
 * The names are on the nose on purpose. "Normal" tells you nothing about what
 * you are agreeing to.
 */

export type Difficulty = "hearthlight" | "faircount" | "hardwinter";

export type Level = {
  id: Difficulty;
  name: string;
  /** One line, for the setting. What you are choosing, not how it feels. */
  blurb: string;
  /** The number an ordinary task asks for. */
  dc: number;
  brief: string;
};

export const LEVELS: Level[] = [
  {
    id: "hearthlight",
    name: "Hearthlight",
    blurb: "Nothing is wasted. A bad roll costs you something, never the story.",
    dc: 10,
    brief:
      "An ordinary task asks for 10. A hard one asks for 15, and nothing asks for more than 18.\n\n" +
      "A failed roll never ends the thread it was on. It costs time, or noise, or a resource, or " +
      "it gets them there in a worse position — but the door still opens, the lie still half " +
      "lands, the climb still gets made with a torn coat. Never answer a failure with \"nothing " +
      "happens\": that is a turn taken away for no story.\n\n" +
      "Death does not arrive without warning. Before anything can kill a character, they get a " +
      "turn in which it is obvious that it might, and a way out that costs something.",
  },
  {
    id: "faircount",
    name: "Fair Count",
    blurb: "The dice mean what they say. Failure closes doors, and there are others.",
    dc: 12,
    brief:
      "An ordinary task asks for 12. A hard one asks for 17, and something genuinely beyond them " +
      "asks for 20 or more and should be said to be.\n\n" +
      "A failed roll fails. The door stays shut, the lie is heard as a lie, the climb does not " +
      "happen — and the scene continues from there rather than rewinding. Do not soften a bad " +
      "roll into a good one with a complication attached, and do not offer the same test twice " +
      "in different words.\n\n" +
      "Consequences land where they were aimed. If a fight was going badly it keeps going badly. " +
      "Characters can die, but only from something they saw coming and chose to walk into.",
  },
  {
    id: "hardwinter",
    name: "Hard Winter",
    blurb: "The world does not care whether you are ready. Some doors do not open.",
    dc: 14,
    brief:
      "An ordinary task asks for 14. A hard one asks for 19, and some things cannot be done at " +
      "all — say so rather than setting a number nobody can reach.\n\n" +
      "A failed roll fails and costs. Losing a fight has a price beyond hit points: a wound that " +
      "stays, a thing taken, somebody who will not be there next time. Resources run out and are " +
      "not quietly replaced.\n\n" +
      "The world was already moving. People act on their own plans between scenes, and those " +
      "plans do not wait for the players to be ready for them. Death is a real outcome of a bad " +
      "decision, and does not require a warning first — though it should always be the result of " +
      "something the player chose, and never of a single unlucky roll out of nowhere.",
  },
];

export const DEFAULT_DIFFICULTY: Difficulty = "faircount";

export function levelOf(id: unknown): Level {
  const found = LEVELS.find((l) => l.id === String(id ?? ""));
  return found ?? LEVELS.find((l) => l.id === DEFAULT_DIFFICULTY)!;
}

/**
 * What the narrator is told, and what the dice are actually checked against.
 *
 * The number matters more than the paragraph: a brief asking for "harder
 * checks" is a suggestion, and a stated target is a rule the narrator can
 * apply the same way twice.
 */
export function difficultyForPrompt(id: unknown): string {
  const l = levelOf(id);
  return `# How hard this table is: ${l.name}\n${l.brief}`;
}
