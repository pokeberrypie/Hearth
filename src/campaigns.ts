/**
 * What the game is going to be about.
 *
 * A tabletop chat that opens on "what are you in the mood for?" is asking a
 * question most people cannot answer cold. At a real table somebody has done
 * the reading: they arrive with a place, a problem and a tone, and the first
 * half hour is spent playing rather than deciding. So a new game offers three
 * that are already written, and a way to build one for anyone who would rather.
 *
 * Everything here is Hearth's own. Three premises and a handful of monsters are
 * the common furniture of the genre, but the words are written for this app and
 * owe nothing to anyone's book.
 *
 * Pure: the campaign is data and this file turns it into the paragraph the
 * narrator reads. Storing it is the database's business, elsewhere.
 */

/** How long the story is meant to run, and what that asks of a narrator. */
export const LENGTHS = ["one-shot", "short", "long", "open"] as const;
export type Length = (typeof LENGTHS)[number];

export const LENGTH_NAMES: Record<Length, string> = {
  "one-shot": "One evening",
  short: "A few sittings",
  long: "A long campaign",
  open: "Open-ended",
};

/**
 * The only part of the length that reaches the model.
 *
 * Pacing is the thing a narrator is worst at judging alone: left to itself it
 * will either wrap a whole world up in four exchanges or open a thread every
 * turn and close none of them.
 */
export const LENGTH_BRIEF: Record<Length, string> = {
  "one-shot": "This is one evening's story. Move briskly, raise the stakes early, " +
    "and do not open a thread you cannot close tonight.",
  short: "This runs a handful of sittings. One clear arc; let a subplot or two " +
    "exist, but keep the main question in sight.",
  long: "This is a long campaign. Plant more than you resolve, let people the " +
    "player meets have lives that continue offstage, and take your time.",
  open: "This has no set length. Follow what the player is interested in and " +
    "let the shape come from that rather than from a plan.",
};

export type Campaign = {
  /** The prefab this came from, or "" for one built by hand. */
  id: string;
  title: string;
  /** The situation, in a sentence or two, as the narrator should understand it. */
  premise: string;
  /** Tone and texture: what this should feel like. */
  theme: string;
  length: Length;
  /** What the narrator should put in front of the player first. */
  opening: string;
  /** Things that may be out there. Permission, not a schedule. */
  bestiary: string[];
  /** Lorebooks bound to this game, by id. Empty is normal. */
  books: string[];
  /** Anything else the player wanted said. */
  notes: string;
};

/**
 * The three on offer.
 *
 * Chosen to be different in *shape* rather than in setting: one where the
 * problem is people, one where the problem is the country itself, and one
 * where the problem is what you agreed to. Someone who does not know what they
 * want can tell those apart, which is more than can be said for three fantasy
 * villages with different names.
 */
export const CAMPAIGNS: Campaign[] = [
  {
    id: "greywater",
    title: "A Debt in Greywater",
    premise:
      "Greywater is a river town that borrowed heavily from someone it should " +
      "not have, twenty years ago, and the loan has come due. The lender's " +
      "people are already in town, being extremely polite. Nobody will say " +
      "what was promised — only that it was not money.",
    theme:
      "Low fantasy, close to the ground. The trouble is people: what they owe, " +
      "what they will do to get out from under it, and who they are willing to " +
      "hand over. Warm in places. Nobody is a villain from the outside.",
    length: "short",
    opening:
      "The player arrives in Greywater on ordinary business and finds the town " +
      "too quiet and too courteous. Give them somewhere to sleep, somebody who " +
      "wants to talk, and somebody who very much does not.",
    bestiary: ["Hired swords", "A debt-collector who does not blink", "Something in the river"],
    books: [],
    notes: "",
  },
  {
    id: "longcold",
    title: "The Long Cold",
    premise:
      "The road north closed a month early this year. The player is on it " +
      "anyway, with a reason that matters, and the weather is not the worst " +
      "thing about the crossing. Something is keeping pace, out past the light, " +
      "and it is in no hurry at all.",
    theme:
      "Cold, spare and mounting. Survival first — food, warmth, distance — and " +
      "dread underneath it. Long silences. What is following is patient, and " +
      "should be shown rather than explained.",
    length: "one-shot",
    opening:
      "Late afternoon, failing light, and the last shelter behind them. Make the " +
      "cold a real problem before anything else is.",
    bestiary: ["Wolves, ordinary and hungry", "Something that walks on two legs in the snow", "The cold itself"],
    books: [],
    notes: "",
  },
  {
    id: "saltcourt",
    title: "The Salt Court",
    premise:
      "A city under the tide keeps a court, and the court keeps its bargains " +
      "exactly — never generously, never a word beyond what was said. The " +
      "player has business there: something owed to them, or by them. Either " +
      "way they will have to speak carefully, and everything they say will be " +
      "remembered.",
    theme:
      "Courtly, strange and beautiful. Almost no violence; the danger is in " +
      "wording, obligation and gifts that cannot be refused. Everyone is " +
      "charming and nobody is safe.",
    length: "long",
    opening:
      "The player is granted an audience they asked for and does not yet know " +
      "the price of the asking. Somebody helpful attaches themselves to them " +
      "immediately.",
    bestiary: ["Courtiers who cannot lie and never tell the truth", "A drowned herald", "Something that keeps the tide"],
    books: [],
    notes: "",
  },
];

export const campaignById = (id: string) => CAMPAIGNS.find((c) => c.id === id) ?? null;

/** A blank one, for the storybook. */
export const emptyCampaign = (): Campaign => ({
  id: "",
  title: "",
  premise: "",
  theme: "",
  length: "short",
  opening: "",
  bestiary: [],
  books: [],
  notes: "",
});

const clamp = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Accepts a stored row, a chosen prefab, or a half-filled storybook. */
export function normaliseCampaign(raw: any): Campaign | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (v: unknown, max: number, each: number) =>
    Array.isArray(v)
      ? v.map((x) => clamp(x, each)).filter(Boolean).slice(0, max)
      : [];
  const c: Campaign = {
    id: clamp(raw.id, 40),
    title: clamp(raw.title, 80),
    premise: clamp(raw.premise, 1200),
    theme: clamp(raw.theme, 800),
    length: LENGTHS.includes(raw.length) ? raw.length : "short",
    opening: clamp(raw.opening, 800),
    /*
     * Sixty characters was enough for the ones written here — "Something in
     * the river" — and cut a model's off mid-word: "the previous keeper's
     * daughter who answers when no one is th". An entry is allowed to be a
     * small sentence, because that is what they turn out to be.
     */
    bestiary: list(raw.bestiary, 12, 120),
    books: list(raw.books, 12, 64),
    notes: clamp(raw.notes, 800),
  };
  // A campaign with no words in it is not a campaign; "none, thank you" is
  // stored as nothing at all rather than as an empty one.
  if (!c.title && !c.premise && !c.theme && !c.bestiary.length && !c.notes) return null;
  return c;
}

/**
 * The campaign as the narrator reads it, at the top of every prompt in the
 * game.
 *
 * The opening is deliberately absent: it describes the first scene, which by
 * the second exchange is a stale instruction telling the narrator to introduce
 * a town it introduced twenty minutes ago. See openingBrief().
 */
export function campaignForPrompt(c: Campaign): string {
  const lines = [`The game: ${c.title || "untitled"}`];
  if (c.premise) lines.push(c.premise);
  if (c.theme) lines.push(`Tone: ${c.theme}`);
  lines.push(LENGTH_BRIEF[c.length]);
  if (c.bestiary.length) {
    lines.push(
      `Things that may be out there, if and when they fit: ${c.bestiary.join(", ")}. ` +
      `This is permission, not a schedule — do not work through the list.`,
    );
  }
  if (c.notes) lines.push(`The player also asked for: ${c.notes}`);
  return lines.join("\n\n");
}

/* ---- dreaming one up --------------------------------------------------------
   For anyone who wants a game rather than a writing exercise. Not mad-libs:
   the parts that have to hang together — a place, a trouble and an opening —
   are written together and picked as a unit, and only the parts that survive
   any pairing are shuffled independently. A premise assembled word by word
   from four lists reads like it was, and reads worse the second time. */

type Seed = {
  titles: string[];
  /** Place and trouble, written as one sentence so they cannot disagree. */
  premise: string;
  opening: string;
  beasts: string[];
};

const SEEDS: Seed[] = [
  {
    titles: ["The Quiet Season", "What the Fields Keep"],
    premise:
      "A farming valley has had three good years in a row, which everybody " +
      "agrees is one more than it should have had, and nobody will say what " +
      "they think is paying for it.",
    opening: "Harvest, warm weather, and a village being extremely normal at the player.",
    beasts: ["Something under the barley", "Neighbours who have already decided", "A very old arrangement"],
  },
  {
    titles: ["The Sixth Bell", "Nobody Rings It"],
    premise:
      "A city rings five bells for the hours and has a sixth that is never " +
      "rung. It rang last night. Half the people who heard it are behaving " +
      "as though it did not happen, and the other half have gone.",
    opening: "Morning after, in a street where a shop that was there yesterday is not.",
    beasts: ["Someone wearing a face they borrowed", "The people who came for the bell", "A door in a wall with no door"],
  },
  {
    titles: ["A Small Favour", "The Errand"],
    premise:
      "Somebody the player owes has asked for something trivial: carry a " +
      "sealed box two days east and hand it over. Three other people already " +
      "know about the box, which was not part of the arrangement.",
    opening: "The road, the box, and the first person to take too much interest in it.",
    beasts: ["Rivals who are also being polite", "Whatever the box is for", "A tollkeeper with a long memory"],
  },
  {
    titles: ["The Lower Works", "Down Where It Is Warm"],
    premise:
      "A mine that closed a generation ago has started paying wages again. " +
      "Nobody knows who is signing for them, the people going down are coming " +
      "back up, and they will not talk about the shift.",
    opening: "The gate at dawn, a queue, and somebody the player recognises in it.",
    beasts: ["Something the digging woke", "The foreman, who is very reassuring", "Miners on their fourth shift"],
  },
  {
    titles: ["The Guest", "Ordinary Hospitality"],
    premise:
      "A house has taken in a traveller who cannot leave until a particular " +
      "thing is done, and has been very gracious about it for eleven years. " +
      "The household has arranged itself around them. The player is the first " +
      "outsider to be invited in.",
    opening: "Dinner, and the seating plan being explained more carefully than seems necessary.",
    beasts: ["The guest", "A household that has stopped noticing", "Something waiting outside for its turn"],
  },
  {
    titles: ["Slack Water", "The Turn of the Tide"],
    premise:
      "A harbour town's fleet came home a day early with full holds and no " +
      "explanation, and the catch is selling for nothing. The harbourmaster " +
      "has stopped writing things down.",
    opening: "The quay at low tide, with more boats in than there should be and nobody working.",
    beasts: ["What came back with the catch", "Crews who agree with each other too quickly", "A creditor from further out"],
  },
  {
    titles: ["Letters of Passage", "The Border Season"],
    premise:
      "A border is being redrawn on paper, and everybody on the wrong side of " +
      "the new line has until spring to prove they were always on the right " +
      "one. The clerk with the stamp has opinions.",
    opening: "A queue outside an office, in weather, with the player's papers being read slowly.",
    beasts: ["Somebody selling certainty", "A commander with a quota", "Whatever crosses the line at night"],
  },
  {
    titles: ["Nine Days", "The Wager"],
    premise:
      "The player agreed to something in front of witnesses and has nine days " +
      "to make good on it. It seemed reasonable at the time. Since then two " +
      "people have offered to help, which is worrying.",
    opening: "The morning of the first day, with the terms being read back to them.",
    beasts: ["The other party's second", "Somebody collecting on an older bet", "The thing that was actually wagered"],
  },
];

/**
 * The bit that can go with anything.
 *
 * Kept separate because a complication that fits every seed is doing the work
 * of making the same eight premises come out differently, and one that only
 * fits three would be better written into those three.
 */
const COMPLICATIONS = [
  "Somebody the player knows is already involved, on the other side of it.",
  "There is a deadline nobody has said out loud, and it is closer than it looks.",
  "The obvious explanation is true, and is not the problem.",
  "Whoever asked the player to come has stopped answering.",
  "Everyone involved is being reasonable, which is how it has got this far.",
  "The weather is about to make all of this considerably harder.",
  "There is money in it, and the money is the least interesting part.",
  "One person has worked it out already and would rather nobody else did.",
];

const TONES = [
  "Warm and close to the ground, until it is not. People first, weather second, monsters last.",
  "Dry and a bit funny. Everyone is competent and it does not help.",
  "Cold and mounting. Long silences, and things shown rather than explained.",
  "Bright and busy, with the dread underneath rather than on top.",
  "Melancholy and slow. Nothing here is anybody's fault and it is happening anyway.",
  "Tense and close. Small rooms, careful wording, and very little sword.",
];

const pick = <T,>(list: T[], rng: () => number): T => list[Math.floor(rng() * list.length) % list.length];

/**
 * A whole campaign, in one press.
 *
 * Everything is filled in — including the opening and the bestiary — because a
 * page that comes back half blank is a page that still has to be written, and
 * the point of the button is not having to. Press it again for another.
 */
export function dreamCampaign(rng: () => number = Math.random): Campaign {
  const seed = pick(SEEDS, rng);
  // Two of the three, so two dreams from one seed do not read identically.
  const beasts = [...seed.beasts].sort(() => rng() - 0.5).slice(0, 2);
  return {
    id: "",
    title: pick(seed.titles, rng),
    premise: `${seed.premise} ${pick(COMPLICATIONS, rng)}`,
    theme: pick(TONES, rng),
    length: pick([...LENGTHS], rng),
    opening: seed.opening,
    bestiary: beasts,
    books: [],
    notes: "",
  };
}

/** Only for the first reply, where it is the whole of the instruction. */
export function openingBrief(c: Campaign): string {
  return c.opening
    ? `Open the game here: ${c.opening}`
    : "Open the game: put the player somewhere specific, with something in front of them.";
}
