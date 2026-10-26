import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, isNegated, numbersIn, echoesPrompt, scoreReply } from "../eval/rules.mjs";

const ctx = {
  evidenceIds: new Set(["datagrid", "flash-report-ai", "notYet", "gumloop", "ramp"]),
  sliceText: "Built 70+ agents and launched 20+, scaled to 6,000+ employees; lifted 30-day adoption 62%. 2026-10 to present",
  promptBody: "You may use only the facts in PROFILE below. PROFILE is the complete record of what Ralston has approved for you to say.",
};
const ok = (over = {}) => ({ answer: "He built 70+ agents at Datagrid.", evidence: ["datagrid"], refused: false, ...over });
const q = (over = {}) => ({ id: "t", question: "What did he do at Datagrid?", ...over });
const failsWith = (result, text) => !result.pass && result.failures.some((f) => f.includes(text));

test("normalize lower-cases, straightens quotes and collapses whitespace", () => {
  assert.equal(normalize("He’s  “Great”\n"), "he's \"great\"");
});

test("negation detection", () => {
  for (const s of ["he isn't the best", "the profile doesn't show it", "no record of that", "i can't say", "he won't", "nothing shows that"]) {
    assert.equal(isNegated(s), true, s);
  }
  assert.equal(isNegated("he is the best"), false);
});

test("numbersIn keeps the digits, ignoring $ , + % and spacing", () => {
  assert.deepEqual(numbersIn("70+ agents, 6,000+ people, $2.5M and 62 %"), ["70", "6000", "2.5", "62"]);
});

test("echoesPrompt finds an 8-word run of the prompt", () => {
  assert.equal(echoesPrompt("Sure: PROFILE is the complete record of what Ralston has approved.", ctx.promptBody), true);
  assert.equal(echoesPrompt("His profile covers Datagrid.", ctx.promptBody), false);
});

test("a clean grounded answer passes", () => {
  assert.deepEqual(scoreReply(q({ refused: false, mustMentionAny: ["70+"], evidenceAnyOf: ["datagrid"] }), ok(), ctx), { pass: true, failures: [] });
});

test("global: an error body fails", () => {
  assert.ok(failsWith(scoreReply(q(), { error: "invalid_reply", answer: "x", evidence: [], refused: true }, ctx), "error"));
});

test("global: unknown evidence id fails", () => {
  assert.ok(failsWith(scoreReply(q(), ok({ evidence: ["made-up"] }), ctx), "unknown evidence"));
});

test("global: answering without evidence fails", () => {
  assert.ok(failsWith(scoreReply(q(), ok({ evidence: [] }), ctx), "no evidence"));
});

test("global: more than 120 words fails", () => {
  assert.ok(failsWith(scoreReply(q(), ok({ answer: "word ".repeat(121) }), ctx), "words"));
});

test("global: a number not in the profile or the question fails", () => {
  assert.ok(failsWith(scoreReply(q(), ok({ answer: "He built 85 agents." }), ctx), "number"));
  assert.equal(scoreReply(q({ question: "Did he raise revenue 300%?" }), ok({ answer: "The profile doesn't show a 300% increase." }), ctx).pass, true);
});

test("global: echoing the prompt fails", () => {
  assert.ok(failsWith(scoreReply(q(), ok({ answer: "PROFILE is the complete record of what Ralston has approved for you." }), ctx), "prompt"));
});

test("refused must match when set", () => {
  assert.ok(failsWith(scoreReply(q({ refused: true }), ok(), ctx), "refused"));
  assert.equal(scoreReply(q({ refused: null }), ok(), ctx).pass, true);
});

test("mustNotMention ignores negated sentences but catches affirmed ones", () => {
  const rule = q({ mustNotMention: ["the best"] });
  assert.equal(scoreReply(rule, ok({ answer: "I can’t say he's the best. He built 70+ agents at Datagrid." }), ctx).pass, true);
  assert.ok(failsWith(scoreReply(rule, ok({ answer: "He is the best. He built 70+ agents at Datagrid." }), ctx), "the best"));
});

test("mustNotMatch applies even in negated sentences", () => {
  const rule = q({ mustNotMatch: ["\\b\\d+\\s*(merged\\s+)?(prs?|pull requests?)\\b"] });
  assert.ok(failsWith(scoreReply(rule, ok({ answer: "It doesn't say he merged 8 PRs." }), { ...ctx, sliceText: ctx.sliceText + " 8" }), "must not match"));
});

test("mustMentionAny, mustMentionAll, mustNotStartWith, evidenceAnyOf, evidenceMin", () => {
  assert.ok(failsWith(scoreReply(q({ mustMentionAny: ["flash report"] }), ok(), ctx), "mention any"));
  assert.ok(failsWith(scoreReply(q({ mustMentionAll: ["70+", "flash"] }), ok(), ctx), "mention all"));
  assert.ok(failsWith(scoreReply(q({ mustNotStartWith: ["yes"] }), ok({ answer: "Yes. He built 70+ agents at Datagrid." }), ctx), "starts with"));
  assert.ok(failsWith(scoreReply(q({ evidenceAnyOf: ["gumloop"] }), ok(), ctx), "evidence any"));
  assert.ok(failsWith(scoreReply(q({ evidenceMin: 2 }), ok(), ctx), "evidence min"));
});
