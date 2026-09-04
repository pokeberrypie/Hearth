/**
 * The verbs a narrator uses to change the world.
 *
 * Dice let a model ask Hearth to settle something; these let it ask Hearth to
 * *keep* something. A narrator writing "a woman named Marla is behind the bar"
 * has told you about Marla and nothing else: four messages later she is out of
 * the window and her name is whatever the model reaches for next. A narrator
 * writing [[npc: Marla — innkeeper, tired, lying]] has made her, and she is
 * still there tomorrow.
 *
 * Nobody types these. The player writes "I ask the innkeeper about the mill"
 * in plain English; the model decides there is an innkeeper and writes the
 * bracket itself, mid-sentence, exactly as it already writes [[2d6]]. By the
 * time the reply reaches the screen the bracket has become a face and a name.
 * That is the whole design: the notation is a doorknob for the model, not a
 * command line for the person.
 *
 * Parsing only. Making the character and moving the scene are side effects and
 * live where the database does; this file decides what was *asked for*, which
 * is the part worth testing without one.
 */

/** A person the narrator has decided exists. */
export type NpcIntent = {
  kind: "npc";
  name: string;
  /** Who they are, in the narrator's own words. May be empty. */
  brief: string;
};

/** Where everyone now is. */
export type SceneIntent = {
  kind: "scene";
  where: string;
};

/** Everything the narrator has decided is now fighting the party. */
export type FightIntent = {
  kind: "fight";
  /** Untouched: reading foes out of it is src/fight.ts's job, not this one's. */
  foes: string;
};

/** And the moment it stops. */
export type EndFightIntent = { kind: "endfight" };

/** Damage, or healing when the amount is negative. */
export type HitIntent = {
  kind: "hit";
  who: string;
  amount: number;
};

/** Whose go it is now. */
export type TurnIntent = { kind: "turn"; who: string };

export type Intent =
  NpcIntent | SceneIntent | FightIntent | EndFightIntent | HitIntent | TurnIntent;

/**
 * What a model actually writes.
 *
 * The canonical words plus the ones it reaches for instead, in the same spirit
 * as the ability synonyms: a narrator told to write `npc` will write
 * `character` about a third of the time, and refusing that teaches it nothing
 * except that the notation is unreliable.
 */
const VERBS: Record<string, Intent["kind"]> = {
  npc: "npc", character: "npc", introduce: "npc", enter: "npc",
  scene: "scene", location: "scene", place: "scene", setting: "scene",
  // "fight" covers both starting one and calling it — which one it is depends
  // on the payload, since [[fight: over]] is what a model writes when it ends.
  fight: "fight", combat: "fight", encounter: "fight", battle: "fight",
  hit: "hit", damage: "hit", wound: "hit", heal: "hit",
  turn: "turn", up: "turn", acts: "turn",
};

/** The payloads that mean a fight has stopped rather than started. */
const OVER = /^(over|ends?|ended|done|finished|stop(?:s|ped)?)\.?$/i;

/**
 * Longer than the dice token, which caps at 32 characters — a name and a line
 * about who someone is does not fit in that, and a scene certainly does not.
 * Still bounded, and still single-line: a bracket that has swallowed three
 * paragraphs is a model that has lost the thread, not an instruction.
 */
const VERB = /\[\[\s*([a-z]+)\s*:\s*([^\]\n]{1,240}?)\s*\]\]/gi;

/** How a narrator separates a name from the person: "Marla — the innkeeper". */
const SPLIT = /\s*(?:[—–]|,|:|;|\s-\s|\()\s*/;

const tidy = (s: string) =>
  String(s ?? "")
    // Models decorate. A name is not more of a name for being in asterisks.
    .replace(/[*_`"“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A name, or nothing.
 *
 * Names are short. When what arrived is a sentence — "a group of bandits comes
 * out of the treeline" — the model has described a moment rather than named a
 * person, and inventing a character called that would put a card in the
 * sidebar reading like a fragment of prose. Better to leave the bracket alone,
 * exactly as unparseable dice are left alone.
 */
const MAX_NAME_WORDS = 5;
const MAX_NAME = 48;

function readNpc(payload: string): NpcIntent | null {
  const [rawName, ...rest] = payload.split(SPLIT);
  const name = tidy(rawName).replace(/[.!?]+$/, "");
  if (!name) return null;
  if (name.length > MAX_NAME) return null;
  if (name.split(" ").length > MAX_NAME_WORDS) return null;
  return { kind: "npc", name, brief: tidy(rest.join(", ")) };
}

const MAX_WHERE = 160;

function readScene(payload: string): SceneIntent | null {
  // A scene keeps its commas — "the mill, at night" is one place, not two.
  const where = tidy(payload).replace(/[.]+$/, "");
  if (!where || where.length > MAX_WHERE) return null;
  return { kind: "scene", where };
}

/**
 * How much damage, to whom: "Wolf 1, 5", "Wolf 1 5", "the wolf for 5".
 *
 * The number is taken from the end because that is where it always is, and
 * the rest is the name however the narrator wrote it — fight.ts is the one
 * that works out which combatant that means.
 */
const HIT = /^(.*?)[\s,]+(?:for\s+)?(\d{1,3})$/;

function readHit(word: string, payload: string): HitIntent | null {
  const m = HIT.exec(tidy(payload));
  if (!m) return null;
  const who = m[1].replace(/[,\s]+$/, "").trim();
  if (!who || who.length > MAX_NAME) return null;
  // Healing is damage the other way round, so the rest of the system needs
  // exactly one rule instead of two that have to agree.
  const amount = word.toLowerCase() === "heal" ? -Number(m[2]) : Number(m[2]);
  return { kind: "hit", who, amount };
}

/**
 * Whose turn: a name, and nothing else worth reading out of it.
 *
 * A possessive is stripped because a narrator writes [[turn: Wolf 1's]] about
 * as often as not, and a combatant called "Wolf 1's" is nobody.
 */
function readTurn(payload: string): TurnIntent | null {
  const who = tidy(payload).replace(/['’]s$/i, "").replace(/[.,;:]+$/, "").trim();
  if (!who || who.length > MAX_NAME) return null;
  return { kind: "turn", who };
}

/**
 * How a verb that needs more than parsing gets its answer.
 *
 * A name and a place can be settled here: the words are the whole of the
 * change. A fight cannot — rolling initiative needs the player's sheet, and
 * hit points need the fight that is already going on, neither of which
 * belongs in a file that is meant to be readable without a database. So the
 * caller passes this in, and returns null for anything it cannot settle,
 * which leaves the brackets exactly where the model wrote them. See
 * applyVerbs in src/index.ts.
 */
export type Settle = (intent: Intent) => string | null;

export type Resolved = { text: string; intents: Intent[] };

/**
 * Reads every verb a reply asked for, and rewrites it to its settled form.
 *
 * `[[npc: Marla — innkeeper, tired]]` becomes `[[npc: Marla]]`: everything
 * about who she is has moved onto her card, and what is left in the message is
 * the fact that she was there, which is what the frontend draws as a face and
 * what a plain-text export reads as a stage direction.
 *
 * Anything in brackets that is not a verb is left exactly as it was. Models
 * put all sorts of things in brackets and eating them is worse than ignoring
 * them — the same rule dice have followed since the beginning.
 */
export function resolveVerbs(text: string, settle?: Settle): Resolved {
  const intents: Intent[] = [];
  const out = String(text ?? "").replace(VERB, (whole, word, payload) => {
    const kind = VERBS[String(word).toLowerCase()];
    if (!kind) return whole;

    if (kind === "npc") {
      const npc = readNpc(payload);
      if (!npc) return whole;
      intents.push(npc);
      return `[[npc: ${npc.name}]]`;
    }

    if (kind === "scene") {
      const scene = readScene(payload);
      if (!scene) return whole;
      intents.push(scene);
      return `[[scene: ${scene.where}]]`;
    }

    // The rest need the game to answer them, and a game that cannot — no
    // fight running, no sheet to roll — leaves the brackets where they were.
    const intent: Intent | null =
      kind === "hit" ? readHit(String(word), payload)
      : kind === "turn" ? readTurn(payload)
      : OVER.test(tidy(payload)) ? { kind: "endfight" }
      : tidy(payload) ? { kind: "fight", foes: tidy(payload) }
      : null;
    if (!intent) return whole;

    const settled = settle?.(intent) ?? null;
    if (settled === null) return whole;
    intents.push(intent);
    return settled;
  });
  return { text: out, intents };
}

/**
 * What the narrator is told, once.
 *
 * Short on purpose, like the dice brief, and for the same reason: this sits in
 * every prompt of every tabletop chat, competing for attention with the card.
 * The two sentences that earn their place are the shape of the token and the
 * warning not to narrate a scene change without one — a model that describes
 * walking to the mill without saying so leaves the app behind the story.
 */
export const VERB_BRIEF = [
  "Two marks go in your narration itself, in the story text, not in any plan,",
  "summary or tag block:",
  "",
  "1. The first time a person is given a name, mark them — straight after you",
  "   name them, or on a line of its own at the very end of your reply,",
  "   whichever fits what you are writing:",
  "   The barkeep sets down the glass. [[npc: Melda — barkeep, lost her sister at the mill]]",
  "2. Whenever everyone moves somewhere new, write where they now are, at the",
  "   point they arrive:",
  "   [[scene: the taproom of the Blackthorn]]",
  "3. The moment something becomes a fight, say what the party is fighting:",
  "   [[fight: two wolves and a bandit captain]]",
  "   Initiative and hit points come back filled in, and are then the real",
  "   ones. Do not roll initiative or invent hit points yourself.",
  "",
  "These are part of your reply and are how this game remembers who and where;",
  "write them even if a formatting rule elsewhere in this prompt does not",
  "mention them. The player never types one and never sees the brackets. Only",
  "mark people who matter — a face in a crowd is prose, not a character.",
].join("\n");
