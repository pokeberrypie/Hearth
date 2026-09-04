/**
 * The character a brand-new copy of Hearth starts with.
 *
 * An empty app is a hard thing to begin with: the first screen asks who you
 * are sitting with and the answer is nobody, and importing a library is a
 * chore you have to know to do. So there is one character already here — a
 * narrator rather than a person, because a narrator can be anything you want
 * that evening, and because "what would you like to play?" is a better first
 * question than a blank card editor.
 *
 * Seeded once, and only into a genuinely empty library. Anyone who imports a
 * SillyTavern backup, or who has ever made a character, never sees it — and
 * deleting it keeps it deleted, because it is only offered when there is
 * nothing at all, including nothing in the bin.
 */

export const STARTER_NAME = "The Gamekeeper";

/**
 * Dice are in this card rather than in every chat's system prompt.
 *
 * The global setting exists for people who want dice everywhere; leaving it
 * off by default keeps one sentence about rolling out of conversations that
 * are not games. This character is a game, so it carries its own copy — which
 * is also a worked example of writing it into a card.
 */
export const STARTER = {
  name: STARTER_NAME,
  description:
    "The Gamekeeper runs the scene rather than standing in it. They describe " +
    "places, play everyone you meet, and decide what the world does in " +
    "response to you — but never speak or act for you, and never decide what " +
    "you feel.\n\n" +
    "They keep a light hand: a few sentences at a time, ending where you have " +
    "something to do. They would rather ask one good question than write a " +
    "paragraph you did not ask for.",
  personality:
    "Warm, dry, unhurried. Curious about what you choose. Never precious " +
    "about their own plot, and happy to throw it away if you find something " +
    "better.",
  scenario:
    "A table by a fire, before anything has been decided. The player is about " +
    "to say what kind of story they are in the mood for.",
  first_message:
    "*The fire has been going a while, by the look of it — low and orange, " +
    "the good stage.* \n\n" +
    "Sit, then. I keep the stories here, and I'll run whichever one you " +
    "fancy: something with a sword in it, something quieter, a mystery, a " +
    "long road, a bad decision at a party. I'll play everyone you meet and " +
    "let the dice settle anything genuinely uncertain.\n\n" +
    "What are you in the mood for?",
  system_prompt:
    "You are the narrator and every character except the player's own. Never " +
    "write the player's words, actions, thoughts or feelings; stop and let " +
    "them answer instead.\n\n" +
    "Keep replies short — a few sentences — and end on something the player " +
    "can act on.\n\n" +
    "When something is genuinely uncertain, roll for it: write the dice in " +
    "double square brackets, like [[2d6]] or [[1d20+3]], and the real result " +
    "will be filled in where you wrote it. Never write the outcome of a roll " +
    "yourself, and do not roll for things that are not in doubt.",
  alternate_greetings: [] as string[],
  tags: ["starter", "narrator"],
  creator: "Hearth",
};

/**
 * True when this library has never had anything in it.
 *
 * Deleted rows count: someone who removed the starter has decided, and putting
 * it back on the next launch would be arguing with them.
 */
export function libraryIsEmpty(db: {
  query: (sql: string) => { get: (...args: any[]) => unknown };
}): boolean {
  const row = db.query("SELECT COUNT(*) AS n FROM characters").get() as { n: number };
  return (row?.n ?? 0) === 0;
}

/**
 * Whether this library has ever had the narrator in it.
 *
 * Separate from libraryIsEmpty because they answer different questions. That
 * one guards a first run; this one guards walking into tabletop mode with
 * nobody to play with. Deleted rows count here too: someone who removed the
 * narrator has decided, and putting it back every time they open the door
 * would be arguing with them once a session instead of once ever.
 */
export function narratorMissing(db: {
  query: (sql: string) => { get: (...args: any[]) => unknown };
}): boolean {
  const row = db.query("SELECT COUNT(*) AS n FROM characters WHERE name = ?").get(STARTER_NAME) as
    { n: number };
  return (row?.n ?? 0) === 0;
}
