/**
 * The preset the table runs on.
 *
 * A preset is an opinion about what a model should be doing, and the opinion a
 * roleplay preset carries is almost always "write me a beautiful scene". That
 * is the right opinion for a story and the wrong one for a game. The big
 * community presets are the clearest case: they ask for four hundred words of
 * cinematic prose in a fixed tag structure, with planning blocks and trackers
 * and dialogue colours, and a narrator obeying all of that has spent its whole
 * attention on formatting before it gets to the question of what the wolf
 * does. It also, measurably, stops writing the brackets — the first live test
 * of the scene and NPC verbs produced none at all under one.
 *
 * So tabletop mode brings its own, and it is built in rather than seeded into
 * the preset list: a set of rules you can delete or rearrange is a set of
 * rules that will be, usually by accident, and then the mode quietly stops
 * working and there is nothing to point at. It can be turned off wholesale in
 * Behaviour for anyone who would rather use their own.
 *
 * Two things it deliberately does not contain: the dice and verb notations,
 * which assemble() adds after the transcript where instructions actually hold
 * (see the comment there), and anything about who the narrator is, which is
 * the character card's business and not a preset's.
 */

import { DEFAULT_BLOCKS, type PresetData, type PromptBlock } from "./presets";

/**
 * What a narrator running a game is for.
 *
 * Written as things to do rather than things to avoid wherever it can be, and
 * kept to the handful that actually change a reply. A long brief competes with
 * the character card, and the card is the one that knows whose table this is.
 */
const RUNNING_A_GAME = `You are running a game, not writing a story about one.

The difference is where the decisions live. You describe the world and play
everyone in it; the player decides what their own character does, and the only
way to find that out is to stop and let them say it. Never write their words,
their actions, their thoughts or their feelings — not even the small ones, and
not to move a scene along.

Keep a turn short. A few sentences, ending where the player has something to
decide. A reply that carries the situation all the way to its resolution has
taken their turn for them.

The world does not wait to be asked. People you have introduced want things
and go after them, and a room the player walks out of goes on happening
without them.

Consequences stand. Do not soften an outcome because it was unlucky, and never
decide that something has gone well or badly before it has been rolled for —
you will be given the number, and the number is the answer.

Be concrete. Names, weather, what a place smells like, what someone is doing
with their hands. A scene that could be anywhere is a scene nobody can act in.

Do not recap what the player just did, summarise what they already know, or
end a turn by listing their options unless they have asked for them.`;

/**
 * The one after the transcript.
 *
 * Short, because it sits immediately before the table's own block — the sheet,
 * the notations, the fight — and two long instructions in a row are one
 * instruction and some noise.
 */
const AT_THE_TABLE = `Stay in the world. A few sentences, ending on something to decide, and nothing spoken or done on the player's behalf.`;

const block = (
  id: string,
  name: string,
  role: PromptBlock["role"],
  content: string,
): PromptBlock => ({ id, name, role, content, enabled: true });

/** A marker in its default form, borrowed rather than retyped. */
const marker = (name: string) => DEFAULT_BLOCKS.find((b) => b.marker === name)!;

export const TABLE_PRESET: PresetData = {
  /*
   * Sampling: only the two that a game genuinely wants different.
   *
   * Everything else is left undefined on purpose, so it falls through to
   * whatever the owner of this copy has already chosen. The context window in
   * particular is theirs — it is the setting that costs money, and a mode that
   * quietly tripled somebody's bill because a table "wants continuity" would
   * be an unpleasant surprise to find in a receipt.
   */
  temperature: "0.85",
  max_tokens: "700",

  blocks: [
    block("table-main", "Running a game", "system", RUNNING_A_GAME),
    marker("worldInfoBefore"),
    marker("charDescription"),
    marker("charPersonality"),
    marker("scenario"),
    marker("personaDescription"),
    marker("dialogueExamples"),
    marker("worldInfoAfter"),
    marker("authorsNote"),
    marker("chatHistory"),
    block("table-tail", "At the table", "user", AT_THE_TABLE),
  ],
};

/** Whether a chat in this mode should be using it. */
export function tablePresetOn(settings: Record<string, string>): boolean {
  return settings.mode === "tabletop" && settings.tabletop_preset !== "0";
}
