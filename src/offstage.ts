/**
 * The Offstage: what the people the player is not watching decide to do.
 *
 * Hearth has three roles, kept apart on purpose. The narrator writes the
 * story. The Steward reads it and keeps the records. The Offstage decides,
 * now and then, what someone does when nobody is looking — and it is the only
 * one of the three that ever sees their plans.
 *
 * The whole design rests on one rule: a secret is kept by not being said. The
 * narrator is never handed what an NPC is plotting, only what has become true
 * in the world (a document is missing — not who took it) and what could be
 * noticed (the septa seems nervous — not that anyone did notice). Telling a
 * model "do not reveal this" does not hold; a model leaks what is in front of
 * it. So the plan stays in the ledger, and the ledger stays out of the story.
 *
 * And the decisions are not a dice table of schemes. Every one is made by a
 * person, from inside their own head: what they want, what they are afraid of
 * losing, what they know — only what they know — and whether they believe
 * they can get away with it. The model judges motive and choice, because it
 * is good at that; this file judges permission, consistency and chance,
 * because a model is not. Doing nothing is a choice, and usually the right
 * one. Giving up is a choice too.
 *
 * Pure: storing all of this, and asking a model, is index.ts's business.
 */

export const LEVELS = ["off", "balanced", "dynamic"] as const;
export type Level = (typeof LEVELS)[number];
export const PROTECTIONS = ["sheltered", "fair", "grim"] as const;
export type Protection = (typeof PROTECTIONS)[number];

const pickOf = <T extends string>(v: unknown, from: readonly T[], fallback: T): T =>
  from.includes(v as T) ? (v as T) : fallback;
export const levelOf = (v: unknown): Level => pickOf(v, LEVELS, "off");
export const protectionOf = (v: unknown): Protection => pickOf(v, PROTECTIONS, "fair");

/** How many people may act in one run, by level. */
// Balanced moves two a turn: with one, too little happened for the story to feel anything of it.
export const ACTORS_PER_RUN: Record<Level, number> = { off: 0, balanced: 2, dynamic: 3 };

/** "none", "nothing", "n/a", "no new goal": a model filling in a line it was told to leave out. Never a goal. */
export const saysNothing = (text: string) =>
  /^\W*(none|nothing|n\/?a|null|no( new)?( goal| aim)?s?|not applicable|-+)\W*$/i.test(String(text ?? "").trim());

/** One goal someone is pursuing. */
export type Agenda = { id: string; who: string; goal: string; why: string };

/** Everything one person is allowed to know when they decide. Nothing else goes in. */
export type View = {
  who: string;
  /** From their character card, if they have one: who they are. */
  card: string;
  /** The player's character, by name: someone they may act on, never someone they may speak or act for. */
  player: string;
  /** Where the player's character is, as far as the story says: for how word of what they do would reach them. */
  playerAt?: string;
  /** Word travels badly this time: the telling may be partly wrong. */
  newsWrong?: boolean;
  today: string;
  /** How they are now, from the tracker. */
  state: string[];
  /** How they feel about people, in their own direction only. */
  feelings: string[];
  goals: Agenda[];
  /** Things they were there for, or did themselves, newest last. */
  known: string[];
  /** How their own recent attempts went. */
  lately: string[];
  /** Unresolved matters they are caught up in: the story's open threads that touch them, and their own secret ones. */
  threads?: string[];
  /** Said plainly when things have been going badly: what pushes a careful person to a risk. */
  pressure: string;
  /** How careful they are, when the author has said. */
  discretion?: Discretion;
  /**
   * The author's plan, ahead: scenes they hope will happen. The person does
   * not know it, and is not to be steered toward it; it is here only so what
   * they do can be said to bear on it — help it, get in its way, or make it
   * impossible as written, which the author is then told about.
   */
  plan?: { n: number; title: string; about: string }[];
};

export const OFFSTAGE_SYSTEM = [
  "You decide what one person in a story does next, offstage, while the player is not watching. You are not the narrator: you write no story, only a decision, as short lines in a fixed format.",
  "",
  "Decide as this person would, from inside their own head. They act on what they want and what they are afraid of losing, using only what they know — never anything else about the world. They protect what matters to them: their life and safety, their reputation and relationships, their power and position, the people they love, and who they believe themselves to be. A desperate person takes risks a secure one would not; someone who loves enough may risk everything; an ambitious one may retreat to keep what they have. Most days, most people simply live their lives — that is a good answer.",
  "",
  "Write these lines, exactly like this:",
  "WANT | what they want most right now | what they are afraid of losing",
  "CONSIDER | something they could do | what they believe would happen, and what could go wrong for them",
  "(two or three CONSIDER lines, one of which may be doing nothing out of the ordinary)",
  "CHOOSE | which one, in a few words, or NOTHING, or ABANDON | why, in their own terms",
  "ACT | what they do, in one plain sentence | easy or uncertain or hard | none or social or physical or grave",
  "SEEN | something another person might notice, without saying who did it or why",
  "FACT | what is now true in the world because of it, without saying who did it",
  "CLUE | a trace it could leave, whether or not it works: something someone could find or notice that points toward who was behind it",
  "WITNESS | who might have seen it — someone in the story by name, or a role like a kitchen maid | what they saw, as they saw it",
  "THREAD | open or advance or complicate or settle | its name | what changed, in a few words",
  "GOAL | a new goal, only if they take one up | why",
  "DONE | the goal this finishes, as it is listed | how it came about, in a few words",
  "REACHES | how word of it would reach the player's character where they are — a raven, a rider, travellers' talk, a change they would run into | what they would hear, in a sentence | in how many days",
  "PLAN | the number of a planned scene, if one is listed | supports or complicates or conflicts | how, in a few words",
  "",
  "Rules:",
  "- ACT is only what this person does themselves. Never what the player's character does, says, thinks or feels.",
  "- easy: it simply happens (writing a letter, a walk, a word with a friend). uncertain or hard: it could fail (bribing a loyal servant, a theft, a lie to someone sharp).",
  "- The last field of ACT is the harm it would do to the player's character: none, social (their name, standing, friendships), physical (their body or freedom), grave (death, maiming, imprisonment for good).",
  "- SEEN and FACT never name the person acting, never point to them — not by title, house, household, servants or friends — and never say why. \"The marriage contract is missing\", not \"the queen's handmaiden took it\". Leave them out when nothing would show or nothing changed.",
  "- CLUE is the only line that may point to them: the trace a careless or unlucky moment leaves — a witness, a dropped pin, a smell of their perfume. A theft can succeed and still be seen. Whether it is left at all is decided separately, by chance.",
  "- WITNESS goes with CLUE: who might have caught sight of it, and what they took in — often not who it was. Never the player's character, never the person acting. It counts only if the trace is left.",
  "- THREAD only when what they do moves a matter that will take more than a day: open a new one (named as people would speak of it if it came out — \"Unrest in the Guild\", never \"the Duke's plot\"), or advance, complicate or settle one of the matters listed, by its name exactly as listed. At most two. Leave it out on an ordinary day.",
  "- PLAN only if a plan is listed and what they do bears on it: supports (it makes the scene likelier or possible), complicates (an obstacle, or the scene will play differently), conflicts (the scene cannot happen as written). Never choose what they do because of the plan.",
  "- NOTHING when they simply live their day: then ACT is the ordinary thing they do, easy, none, and there is no SEEN or FACT.",
  "- ABANDON when they give up a goal because it is costing them more than it is worth: then name the goal in the why.",
  "- DONE only when what they do today, if it works, finishes one of the goals listed for them — the thing itself achieved, not a step toward it.",
  "- REACHES only when what they do, if it works, would be talked of or felt beyond the room — an arrest, a decree, a death, a marriage, a march, a bounty, a fall from favour. Leave it out for what stays quiet. What they would hear is only what a messenger or a stranger could know: never who was secretly behind it. The days are how long it would take to travel to where the player's character is.",
  "- When what they do lands on the player's character or the people with them — sent after them, aimed at their name, their home, their marriage, their friends — REACHES is the thing itself arriving where they are, as it would begin in a scene: riders at the gate, a letter of summons, a host who has heard and greets them coldly. Its days are until it gets there. Never say how the player's character answers it.",
].join("\n");

/** The request: who they are and what they know, and nothing else. */
export function offstagePrompt(v: View): string {
  const part = (title: string, lines: string[]) => (lines.length ? `${title}\n${lines.map((l) => `- ${l}`).join("\n")}` : "");
  return [
    `You are deciding for: ${v.who}`,
    v.card && `Who they are:\n${v.card}`,
    `Today in the story: ${v.today}`,
    part("How they are now:", v.state),
    part("How they feel about people:", v.feelings),
    v.goals.length ? part("What they want:", v.goals.map((g) => `${g.goal}${g.why ? ` — ${g.why}` : ""}`))
      : "Nobody has set them an aim. Decide from who they are and what they know what they want now — on most days, nothing out of the ordinary. If they set themselves something that will take more than a day, take it up with a GOAL line.",
    part("What they know (and only this):", v.known),
    part("How their own recent attempts went:", v.lately),
    part("Unresolved matters they are caught up in — these weigh on what they do next:", v.threads ?? []),
    v.pressure && `Their situation: ${v.pressure}`,
    v.plan?.length ? `For you, not for them — the author's plan for scenes ahead, which ${v.who} knows nothing of. Do not steer them toward it; their own wants come first. Only say, with a PLAN line, if what they do bears on one:\n${v.plan.map((p) => `${p.n}. ${p.title}${p.about ? ` — ${p.about}` : ""}`).join("\n")}` : "",
    v.discretion && v.discretion !== "ordinary" && `By nature they are ${v.discretion}${v.discretion === "careless" ? " — they leave traces and talk too much" : v.discretion === "masterful" ? " — they plan for being watched and rarely leave a trace" : " — they cover themselves"}.`,
    `The player's character is ${v.player || "the player"}${v.playerAt ? `, now at ${v.playerAt}` : ""}: someone ${v.who} may act toward, never someone they decide for.`,
    v.newsWrong ? "If you write a REACHES line, word travels badly this time: let what they would hear be partly wrong — exaggerated, a detail mistaken, or laid at the wrong door (never the player's character's)." : "",
    "Write the lines now.",
  ].filter(Boolean).join("\n\n");
}

export type Difficulty = "easy" | "uncertain" | "hard";
export type Harm = "none" | "social" | "physical" | "grave";

export type Decision = {
  want: string;
  fear: string;
  considered: { option: string; stakes: string }[];
  choice: string;
  why: string;
  kind: "act" | "nothing" | "abandon";
  act: string;
  difficulty: Difficulty;
  harm: Harm;
  seen: string;
  fact: string;
  clue: string;
  goal: { goal: string; why: string } | null;
  /** A goal of theirs this would finish, if it works. */
  done: { goal: string; how: string } | null;
  /** How word of it would reach the player's character, if it works: by what, what they hear, in how many days. */
  reaches: { how: string; told: string; days: number } | null;
  threads: ThreadMove[];
  plan: PlanMark[];
  witness: { who: string; saw: string } | null;
};

export type PlanMark = { n: number; relation: "supports" | "complicates" | "conflicts"; how: string };

export type ThreadMove = { move: "open" | "advance" | "complicate" | "settle"; name: string; note: string };

const unquote = (s: string) => String(s ?? "").replace(/^["'“”‘’*_\s]+|["'“”‘’*_\s]+$/g, "").trim();
const words = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

/** A model's answer, read. Untidy answers are read as far as they go; nothing here is believed yet. */
export function readDecision(raw: string): Decision {
  const d: Decision = { want: "", fear: "", considered: [], choice: "", why: "", kind: "nothing", act: "", difficulty: "easy",
    harm: "none", seen: "", fact: "", clue: "", goal: null, done: null, reaches: null, threads: [], plan: [], witness: null };
  const text = String(raw ?? "")
    .replace(/<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/```[a-z]*\n?/gi, "");
  for (const line of text.split(/\r?\n/)) {
    const parts = line.replace(/^[\s>*\-•\d.)]+/, "").split("|").map((p) => unquote(p));
    const key = (parts[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "");
    if (key === "WANT") { d.want = parts[1] ?? ""; d.fear = parts[2] ?? ""; }
    else if (key === "CONSIDER" && parts[1]) d.considered.push({ option: parts[1], stakes: parts.slice(2).join(" | ") });
    else if (key === "CHOOSE" || key === "CHOICE") {
      d.choice = parts[1] ?? "";
      d.why = parts.slice(2).join(" | ");
      d.kind = /^nothing\b/i.test(d.choice) ? "nothing" : /^abandon\b/i.test(d.choice) ? "abandon" : "act";
    } else if (key === "ACT" || key === "ACTION") {
      d.act = parts[1] ?? "";
      const diff = (parts[2] ?? "").toLowerCase();
      d.difficulty = /hard|difficult/.test(diff) ? "hard" : /uncertain|risky|could fail|chance/.test(diff) ? "uncertain" : "easy";
      const harm = (parts[3] ?? "").toLowerCase();
      d.harm = /grave|death|kill|maim|permanent/.test(harm) ? "grave" : /physical|body|bodily|freedom|injur/.test(harm) ? "physical"
        : /social|name|reputation|standing/.test(harm) ? "social" : "none";
    } else if (key === "SEEN" || key === "NOTICE" || key === "NOTICED") d.seen = parts[1] ?? "";
    else if (key === "FACT" || key === "CONSEQUENCE") d.fact = parts[1] ?? "";
    else if (key === "CLUE" || key === "TRACE") d.clue = parts[1] ?? "";
    else if ((key === "THREAD" || key === "PLOTTHREAD") && parts[1] && parts[2]) {
      const m = parts[1].toLowerCase();
      const move = /^(open|new|start|begin)/.test(m) ? "open" : /^(settle|resolve|close|end|finish)/.test(m) ? "settle"
        : /^(complicat|worsen|twist|setback|hinder)/.test(m) ? "complicate" : /^(advance|progress|move|further|develop)/.test(m) ? "advance" : null;
      if (move) d.threads.push({ move, name: parts[2], note: parts.slice(3).join(" | ") });
    } else if ((key === "WITNESS" || key === "WITNESSES") && parts[1] && parts[2]) {
      d.witness = { who: parts[1], saw: parts.slice(2).join(" | ") };
    } else if (key === "PLAN" && parts[1] && parts[2]) {
      const n = parseInt(parts[1].replace(/[^0-9]/g, ""), 10);
      const rel = parts[2].toLowerCase();
      const relation = /^conflict|imposs|prevent/.test(rel) ? "conflicts" : /^complicat|hinder|obstacle/.test(rel) ? "complicates" : /^support|help|enable/.test(rel) ? "supports" : null;
      if (n > 0 && relation) d.plan.push({ n, relation, how: parts.slice(3).join(" | ") });
    } else if (key === "GOAL" && parts[1] && !saysNothing(parts[1])) d.goal = { goal: parts[1], why: parts.slice(2).join(" | ") };
    else if ((key === "DONE" || key === "ACHIEVED" || key === "ACCOMPLISHED") && parts[1] && !saysNothing(parts[1])) d.done = { goal: parts[1], how: parts.slice(2).join(" | ") };
    else if ((key === "REACHES" || key === "NEWS" || key === "WORD") && parts[1] && parts[2] && !saysNothing(parts[2])) {
      const n = parseInt(String(parts[3] ?? "").replace(/[^0-9]/g, ""), 10);
      const words_ = String(parts[3] ?? "").toLowerCase();
      const days = Number.isFinite(n) ? n : /week/.test(words_) ? 7 : /fortnight/.test(words_) ? 14 : /month/.test(words_) ? 30 : /day/.test(words_) ? 1 : 3;
      d.reaches = { how: parts[1], told: parts[2], days: Math.max(0, Math.min(60, days)) };
    }
  }
  if (d.kind === "act" && !d.act) d.kind = "nothing";
  return d;
}

/** What a run may do with a decision, once it has been checked. */
export type Ruling = {
  /** What is recorded in the private ledger. */
  kind: "act" | "nothing" | "abandon" | "dropped";
  act: string;
  why: string;
  difficulty: Difficulty;
  harm: Harm;
  /** True when it touches the player's character in a way that has to be played out, not decided offstage. */
  threat: boolean;
  seen: string;
  fact: string;
  /** What the attempt could leave behind that points to them — the one deliberate clue. Whether it is left is rolled apart from whether it works: see traceOf. */
  clue: string;
  goal: { goal: string; why: string } | null;
  /** What they do to the story's unresolved matters. Matched against the real threads, and kept, in the run. */
  threads: ThreadMove[];
  /** How it bears on the author's plan. Matched against the scenes listed, in the run. */
  plan: PlanMark[];
  /** Who may have seen it, kept only with a trace, and only if the trace is left. */
  witness: { who: string; saw: string } | null;
  /** Which goal was given up, when one was. */
  abandons: string;
  /** Which goal this finishes if it works, and how — kept only on success, in the run. */
  achieves: string;
  how: string;
  /** Word of it on its way to the player's character, if it works: checked like what could be seen. */
  news: { how: string; told: string; days: number } | null;
  /** Why anything was taken out. Shown in the author's ledger, so a dull run can be understood. */
  notes: string[];
};

/** Names a line must not carry: the one acting, by any part of their name a reader would recognise. */
function namesOf(who: string): string[] {
  const all = words(who).filter((w) => w.length > 2 && !["the", "lord", "lady", "ser", "king", "queen", "prince", "princess", "of"].includes(w));
  return all.length ? all : words(who);
}

/** Does this text give away who did it — by name, or by any of the other words that mark them out? */
export function names(text: string, who: string, identity: string[] = []): boolean {
  const said = new Set(words(text));
  return [...namesOf(who), ...identity].some((n) => said.has(n) || said.has(`${n}s`));
}

/**
 * Titles and roles that point to one person as surely as a name: "the queen's
 * handmaiden" is Cersei, in a story with one queen. Taken from what their card
 * calls them; the house from their name; and the factions they are counted in.
 */
const TITLES = ["king", "queen", "prince", "princess", "hand", "regent", "lord commander", "commander", "kingsguard", "septa",
  "septon", "maester", "grand maester", "spymaster", "master of whisperers", "master of coin", "master of laws", "steward",
  "duke", "duchess", "earl", "countess", "baron", "baroness", "emperor", "empress", "chancellor", "captain", "general",
  "high priest", "high priestess", "archbishop", "bishop", "abbot", "abbess", "khal", "khaleesi", "sultan", "shah", "tsar",
  "mayor", "sheriff", "magistrate", "headmaster", "headmistress", "ceo", "president", "director", "boss", "don"];

export function identityOf(who: string, card: string, factions: string[] = []): string[] {
  const text = ` ${words(`${who} ${String(card ?? "").slice(0, 600)}`).join(" ")} `;
  const titles = TITLES.filter((t) => text.includes(` ${t} `)).flatMap((t) => words(t)).filter((w) => w.length > 2);
  const houses = factions.flatMap((f) => words(f)).filter((w) => w.length > 3 && !["house", "order", "guild", "company", "the"].includes(w));
  return [...new Set([...titles, ...houses])];
}

/**
 * The checks, all of them code: who may be harmed and how, what must become a
 * scene instead, and what may reach the narrator — never anything that says
 * who did it. Nothing the model said about the world is believed past this.
 */
export function rule(d: Decision, o: { who: string; player: string; protection: Protection; goals: Agenda[]; identity?: string[] }): Ruling {
  const notes: string[] = [];
  const r: Ruling = { kind: d.kind, act: d.act.slice(0, 300), why: d.why.slice(0, 400), difficulty: d.difficulty, harm: d.harm,
    threat: false, seen: d.seen.slice(0, 240), fact: d.fact.slice(0, 240), clue: d.clue.slice(0, 240), goal: d.goal, threads: [], plan: [], witness: null, abandons: "", achieves: "", how: "", news: null, notes };
  if (d.kind === "nothing") { r.seen = ""; r.fact = ""; r.clue = ""; r.harm = "none"; r.difficulty = "easy"; }
  // Something that cannot fail leaves no careless trace.
  if (r.difficulty === "easy") r.clue = "";
  if (d.kind === "abandon") {
    const target = o.goals.find((g) => words(d.why + " " + d.choice).some((w) => w.length > 3 && words(g.goal).includes(w))) ?? (o.goals.length === 1 ? o.goals[0] : undefined);
    if (target) r.abandons = target.id;
    else { notes.push("gave up a goal it could not name"); r.kind = "nothing"; }
  }
  // Finished, if it works: one of their own goals, named so it can be found — by its words, or the only one they have.
  if (d.kind === "act" && d.done) {
    const said = words(d.done.goal);
    const target = o.goals.find((g) => said.filter((w) => w.length > 3 && words(g.goal).includes(w)).length >= Math.min(2, said.filter((w) => w.length > 3).length))
      ?? (o.goals.length === 1 ? o.goals[0] : undefined);
    if (target) { r.achieves = target.id; r.how = d.done.how.replace(/\s+/g, " ").trim().slice(0, 240); }
    else notes.push("said it finished a goal it could not name");
  }
  // Only ever their own actions: a line that puts words or deeds in the player's mouth is not a decision of theirs.
  const playerWords = words(o.player).filter((w) => w.length > 2);
  if (playerWords.length && d.act && playerWords.includes(words(d.act)[0] ?? "")) {
    notes.push("acted for the player's character");
    return { ...r, kind: "dropped", act: "", seen: "", fact: "", clue: "", threat: false };
  }
  // A witness: someone else, never the player's character (whose eyes are the player's), with something they saw.
  if (d.kind === "act" && d.witness && r.clue) {
    const who = d.witness.who.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!who || names(who, o.who)) notes.push("the witness was the one acting");
    else if (o.player && names(who, o.player)) notes.push("the witness was the player's character");
    else r.witness = { who, saw: d.witness.saw.replace(/\s+/g, " ").trim().slice(0, 240) };
  }
  // How it bears on the plan: only for something they actually did, once per scene, at most two.
  if (d.kind === "act") {
    for (const m of d.plan) {
      if (r.plan.length >= 2 || r.plan.some((p) => p.n === m.n)) continue;
      r.plan.push({ n: m.n, relation: m.relation, how: m.how.replace(/\s+/g, " ").trim().slice(0, 240) });
    }
  }
  // A thread's name is public the moment it comes out: it may no more point to them than what could be seen.
  if (d.kind === "act") {
    for (const t of d.threads) {
      if (r.threads.length >= 2) break;
      const name = t.name.replace(/\s+/g, " ").trim().slice(0, 80);
      if (!name) continue;
      if (names(name, o.who, o.identity ?? [])) { notes.push("a thread's name pointed to who is behind it"); continue; }
      r.threads.push({ move: t.move, name, note: t.note.replace(/\s+/g, " ").trim().slice(0, 240) });
    }
  }
  const atPlayer = !!o.player && names(d.act, o.player);
  if (atPlayer && (d.harm === "physical" || d.harm === "grave")) {
    if (o.protection === "sheltered") {
      notes.push("would have harmed the player's character, which this story does not allow");
      return { ...r, kind: "dropped", act: "", seen: "", fact: "", clue: "", threat: false };
    }
    // Fair: anything to their body or freedom is played out. Grim: only the grave is.
    if (o.protection === "fair" || d.harm === "grave") { r.threat = true; r.fact = ""; r.clue = ""; r.threads = []; r.plan = []; r.witness = null; }
  }
  const id = o.identity ?? [];
  if (r.seen && names(r.seen, o.who, id)) { notes.push("what could be seen pointed to who did it"); r.seen = ""; }
  if (r.fact && names(r.fact, o.who, id)) { notes.push("what changed pointed to who did it"); r.fact = ""; }
  // News: only of something they did, and — when it was done in secret, which a deliberate trace says it was —
  // never naming them. Done openly (a decree, a public disowning), the messenger may well say who.
  if (d.kind === "act" && d.reaches && !r.threat) {
    const told = d.reaches.told.replace(/\s+/g, " ").trim().slice(0, 240);
    if ((d.clue || r.clue) && names(told, o.who, id)) notes.push("the news named who was secretly behind it");
    else if (told) r.news = { how: d.reaches.how.replace(/\s+/g, " ").trim().slice(0, 120), told, days: d.reaches.days };
  }
  if (r.goal && r.kind !== "dropped") r.goal = { goal: r.goal.goal.slice(0, 200), why: r.goal.why.slice(0, 300) };
  return r;
}

/** Only the uncertain is rolled. A letter is written; a loyal servant may or may not take the gold. */
export const DIFFICULTY_DC: Record<Difficulty, number> = { easy: 0, uncertain: 11, hard: 16 };

export type Outcome = { succeeded: boolean; roll: number | null; dc: number };

export function resolve(difficulty: Difficulty, rng: () => number = Math.random): Outcome {
  const dc = DIFFICULTY_DC[difficulty];
  if (!dc) return { succeeded: true, roll: null, dc: 0 };
  const roll = 1 + Math.floor(rng() * 20);
  return { succeeded: roll >= dc, roll, dc };
}

/**
 * Whether it left a trace: a second roll, apart from whether it worked. A
 * theft can succeed and still be seen; a botched one can still go unnoticed,
 * though less often. Discretion against these — under it, the clue is left.
 * Harder things are messier, and failing at them messier still. Something
 * easy leaves nothing worth finding.
 */
export const TRACE_DC: Record<Difficulty, { worked: number; failed: number }> = {
  easy: { worked: 0, failed: 0 },
  uncertain: { worked: 6, failed: 13 }, // a quarter of the time when it works, three in five when it doesn't
  hard: { worked: 9, failed: 16 }, //      two in five, three in four
};

export type Trace = { left: boolean; roll: number | null; dc: number };

/**
 * How careful someone is, set by the author — never guessed from their card,
 * where nearly everyone would read as "careful". A master spy and a first-time
 * thief do not leave a trace equally often. It moves the line, never past
 * the point where a bad enough moment (a 1) can still give anyone away.
 */
export const DISCRETION = ["careless", "ordinary", "careful", "masterful"] as const;
export type Discretion = (typeof DISCRETION)[number];
export const discretionOf = (v: unknown): Discretion => (DISCRETION.includes(v as Discretion) ? (v as Discretion) : "ordinary");
const DISCRETION_SHIFT: Record<Discretion, number> = { careless: 4, ordinary: 0, careful: -3, masterful: -6 };

export function traceOf(difficulty: Difficulty, succeeded: boolean, rng: () => number = Math.random, discretion: Discretion = "ordinary"): Trace {
  const base = TRACE_DC[difficulty][succeeded ? "worked" : "failed"];
  if (!base) return { left: false, roll: null, dc: 0 };
  const dc = Math.max(2, Math.min(20, base + DISCRETION_SHIFT[discretion]));
  const roll = 1 + Math.floor(rng() * 20);
  return { left: roll < dc, roll, dc };
}

/**
 * Pressure, said in words: two failures running, or a goal held for a long
 * time with nothing to show — what makes a careful person reckless. Computed,
 * never stored, so it eases on its own when things go better.
 */
export function pressureOf(lately: { succeeded: boolean | null }[], goalAgeDays: number): string {
  const recent = lately.slice(-3).filter((l) => l.succeeded !== null);
  const failures = recent.filter((l) => l.succeeded === false).length;
  const bits: string[] = [];
  if (failures >= 2) bits.push(`their last ${failures === recent.length ? "attempts have all" : "attempts have mostly"} failed`);
  if (goalAgeDays >= 14) bits.push(`they have wanted this for ${goalAgeDays} days with little to show for it`);
  return bits.length ? `${bits.join(", and ")}. Time and patience are running out.` : "";
}
