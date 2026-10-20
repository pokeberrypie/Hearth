/**
 * The Steward, against the answers cheap models actually give.
 *
 * Every case here is a way a small model gets this wrong — thinking out loud
 * in the answer, wrapping it in a fence, chatting around it, fullwidth bars,
 * markdown, inventing an event, quoting a tracker block, doing its own date
 * arithmetic, ignoring the format entirely. The rule for all of them is the
 * same: what can be checked against the story survives, and nothing else does.
 *
 *   bun test src/steward.test.ts
 */

import { describe, expect, test } from "bun:test";

import { MOONS, UNDATED } from "./calendar";
import {
  STEWARD_SYSTEM, checkAnswer, findEvidence, needsFoldedSystem, parseAnswer, storyOnly, stewardRequest, whoIs,
  type Passage, type Person,
} from "./steward";

const STORY: Passage[] = [
  { id: "m1", who: "Loras Tyrell", text: "Loras came through the door at speed and stopped dead two steps inside. <status>Location: the stables. Mood: furious.</status>" },
  { id: "m2", who: "Yvenna", text: "\"Well?\" Yvenna laughed, turning toward him. \"Have you nothing to say?\"" },
  { id: "m3", who: "Jaime Lannister", text: "Three days later, the court gathered in the Great Hall, and Jaime publicly affirmed his betrothal to Yvenna before the king." },
];
const PEOPLE: Person[] = [{ name: "Loras Tyrell" }, { name: "Jaime Lannister" }, { name: "Yvenna Hightower", note: "the player" }];
const NOW = { day: 10, minute: 12 * 60 };
const DAY = 1440;

const check = (raw: string, passages = STORY) => checkAnswer(raw, passages, PEOPLE, MOONS, NOW);

describe("a well-behaved answer", () => {
  test("is taken as written, each claim tied to the message it quotes", () => {
    const r = check([
      'TIME | 3 days | "Three days later, the court gathered in the Great Hall"',
      'EVENT | Jaime affirms the betrothal | "Jaime publicly affirmed his betrothal to Yvenna"',
      'EVENT | Loras arrives | "Loras came through the door at speed"',
    ].join("\n"));
    expect(r.dropped).toEqual([]);
    expect(r.claims).toEqual([
      { kind: "time", span: 3 * DAY, said: "3 days", evidence: "Three days later, the court gathered in the Great Hall", message_id: "m3", proposed: false },
      { kind: "event", title: "Jaime affirms the betrothal", people: [], evidence: "Jaime publicly affirmed his betrothal to Yvenna", message_id: "m3" },
      { kind: "event", title: "Loras arrives", people: [], evidence: "Loras came through the door at speed", message_id: "m1" },
    ]);
  });

  test("NONE means nothing happened, and is not a failure", () => {
    expect(check("NONE")).toMatchObject({ claims: [], none: true, dropped: [] });
    expect(check("none.")).toMatchObject({ none: true });
  });
});

describe("reasoning models thinking out loud", () => {
  test("a think block is cut out, braces and all, before anything is read", () => {
    const r = check('<think>The user wants {"time": 9}. Maybe TIME | 9 days | "nope"</think>\nTIME | three days | “Three days later, the court gathered”');
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]).toMatchObject({ kind: "time", span: 3 * DAY });
  });

  test("a think block that never closes is all thinking, and none of it is an answer", () => {
    expect(check('<think>Let me see. TIME | 5 days | "Three days later, the court gathered"').claims).toEqual([]);
  });

  test("a closing tag whose opening the provider ate", () => {
    const r = check('so the answer is probably three days</think>\nTIME | 3 days | "Three days later, the court gathered"');
    expect(r.claims).toHaveLength(1);
  });
});

describe("models that will not just answer", () => {
  test("a fence and some chatter around it", () => {
    const r = check('Here are the records:\n```\nEVENT | Loras arrives | "Loras came through the door at speed"\n```\nLet me know if you need anything else!');
    expect(r.claims).toHaveLength(1);
    expect(r.noise).toBe(2);
  });

  test("markdown, numbering and bullets", () => {
    const r = check([
      "1. **TIME** | **3 days** | *\"Three days later, the court gathered\"*",
      "- EVENT | Jaime affirms the betrothal | \"Jaime publicly affirmed his betrothal to Yvenna\"",
    ].join("\n"));
    expect(r.claims.map((c) => c.kind)).toEqual(["time", "event"]);
  });

  test("fullwidth bars and corner-bracket quotes", () => {
    const r = check("EVENT｜Jaime affirms the betrothal｜「Jaime publicly affirmed his betrothal to Yvenna」");
    expect(r.claims).toHaveLength(1);
  });

  test("an answer written as prose instead of lines records nothing, and is not taken for NONE", () => {
    const r = check("Three days passed and Jaime affirmed the betrothal in front of the court.");
    expect(r).toMatchObject({ claims: [], none: false, noise: 1 });
  });

  test("JSON, despite being told not to, records nothing", () => {
    expect(check('{"time": "3 days", "events": ["betrothal"]}').claims).toEqual([]);
  });
});

describe("claims the story does not support", () => {
  test("an event with a quote that is not in the story", () => {
    const r = check('EVENT | Loras draws his sword | "Loras drew his sword and charged at Jaime"');
    expect(r.claims).toEqual([]);
    expect(r.dropped[0].why).toBe("the quote is not in the story");
  });

  test("a quote taken from a tracker block proves nothing", () => {
    expect(check('EVENT | Loras goes to the stables | "Location: the stables. Mood: furious"').claims).toEqual([]);
  });

  test("a line with no quote at all", () => {
    expect(check("EVENT | Jaime affirms the betrothal").dropped[0].why).toBe("no quote from the story");
  });

  test("a quote too short to mean anything", () => {
    expect(check('EVENT | Yvenna laughs | "Yvenna laughed"').claims).toEqual([]);
  });

  test("the right words scattered through the story are not a quotation", () => {
    expect(findEvidence("the court affirmed the king before Yvenna", STORY)).toBeNull();
  });

  test("a near copy with a word dropped still counts", () => {
    expect(findEvidence("Jaime affirmed his betrothal to Yvenna before the king", STORY)).toBe("m3");
    expect(findEvidence("three days later the court gathered in the great hall", STORY)).toBe("m3");
  });

  test("languages written without spaces are compared by characters", () => {
    const zh: Passage[] = [{ id: "z1", who: "詹姆", text: "三天后，宫廷聚集在大殿里，詹姆当众确认了他与伊文娜的婚约。" }];
    expect(findEvidence("詹姆当众确认了他与伊文娜的婚约", zh)).toBe("z1");
    expect(findEvidence("詹姆拔出了他的剑", zh)).toBeNull();
  });
});

describe("time", () => {
  test("words the calendar cannot read move nothing", () => {
    const r = check('TIME | a while | "Three days later, the court gathered"');
    expect(r.claims).toEqual([]);
    expect(r.dropped[0].why).toBe("how long could not be read");
  });

  test("the model's own date arithmetic is not trusted, only how long", () => {
    // "the 13th day" is a date, not a span: refused rather than guessed at.
    expect(check('TIME | until the 13th day of the eighth moon | "Three days later, the court gathered"').claims).toEqual([]);
  });

  test("only the first readable TIME line is kept", () => {
    const r = check([
      'TIME | 3 days | "Three days later, the court gathered"',
      'TIME | 4 days | "Three days later, the court gathered"',
    ].join("\n"));
    expect(r.claims).toHaveLength(1);
    expect(r.dropped[0].why).toBe("more than one TIME line");
  });

  test("a jump past the limit is proposed, not applied", () => {
    const story: Passage[] = [{ id: "w", who: "Narrator", text: "Two weeks passed before the wedding party set out for the Vale." }];
    const r = check('TIME | two weeks | "Two weeks passed before the wedding party set out"', story);
    expect(r.claims[0]).toMatchObject({ kind: "time", span: 14 * DAY, proposed: true });
    const never = checkAnswer('TIME | two weeks | "Two weeks passed before the wedding party set out"', story, PEOPLE, MOONS, NOW, { askAboveMinutes: -1, maxEvents: 5 });
    expect(never.claims[0]).toMatchObject({ proposed: false });
  });
});

describe("events", () => {
  test("the same event twice is kept once", () => {
    const r = check([
      'EVENT | Jaime affirms the betrothal | "Jaime publicly affirmed his betrothal to Yvenna"',
      'EVENT | jaime affirms the betrothal. | "Jaime publicly affirmed his betrothal"',
    ].join("\n"));
    expect(r.claims).toHaveLength(1);
    expect(r.dropped[0].why).toBe("the same event twice");
  });

  test("no more than the limit in one go", () => {
    const lines = Array.from({ length: 7 }, (_, i) => `EVENT | Event ${i} | "Jaime publicly affirmed his betrothal to Yvenna"`);
    expect(check(lines.join("\n")).claims).toHaveLength(5);
  });

  test("people are named by number from the list, never by whatever the model typed", () => {
    const r = check('EVENT | The betrothal | 2, 3, 9, Ser Jamie | "Jaime publicly affirmed his betrothal to Yvenna"');
    expect(r.claims[0]).toMatchObject({ people: ["Jaime Lannister", "Yvenna Hightower"] });
  });
});

describe("who is who", () => {
  test("numbers, and names that are on the list", () => {
    expect(whoIs("2", PEOPLE)?.name).toBe("Jaime Lannister");
    expect(whoIs("#1", PEOPLE)?.name).toBe("Loras Tyrell");
    expect(whoIs("jaime", PEOPLE)?.name).toBe("Jaime Lannister");
    expect(whoIs("Ser Jaime", PEOPLE)).toBeNull();
    expect(whoIs("7", PEOPLE)).toBeNull();
  });
});

describe("what the Steward is shown", () => {
  test("the story without the scaffolding", () => {
    expect(storyOnly(STORY[0].text)).not.toContain("stables");
    expect(storyOnly("<prose>She left.</prose>")).toBe("She left.");
  });

  test("a numbered list of who is here, the date, and the story", () => {
    const req = stewardRequest("z-ai/glm-4.6", PEOPLE, "Day 11", STORY);
    expect(req.system).toBe(STEWARD_SYSTEM);
    expect(req.messages[0].content).toContain("2. Jaime Lannister");
    expect(req.messages[0].content).toContain("3. Yvenna Hightower (the player)");
    expect(req.messages[0].content).toContain("It is now: Day 11");
    expect(req.messages[0].content).not.toContain("<status>");
  });

  test("Gemma gets its instructions in the request, since it will not take a system prompt", () => {
    expect(needsFoldedSystem("google/gemma-3-27b-it")).toBe(true);
    expect(needsFoldedSystem("deepseek/deepseek-chat")).toBe(false);
    const req = stewardRequest("gemma-3-12b-it", PEOPLE, "Day 11", STORY);
    expect(req.system).toBe("");
    expect(req.messages[0].content.startsWith(STEWARD_SYSTEM)).toBe(true);
  });
});

test("an undated story reads time the same way", () => {
  const r = checkAnswer('TIME | until dawn | "Three days later, the court gathered"', STORY, PEOPLE, UNDATED, NOW);
  expect(r.claims[0]).toMatchObject({ span: 18 * 60 });
});

test("parseAnswer on its own: findings, drops and noise", () => {
  const p = parseAnswer("Sure!\nTIME | 2 days\nEVENT | x | \"\"\nNONE");
  expect(p).toMatchObject({ none: true, noise: 1 });
  expect(p.dropped.map((d) => d.why)).toEqual(["no quote from the story", "no quote from the story"]);
});
