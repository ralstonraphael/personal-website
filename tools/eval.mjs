// The billed Week 8 eval: five questions on two models, through askCore (the same answer function
// the typed and voice paths use), with the tools called and the answers checked in code.
// Skipped without a key.  set -a; . <your .env>; set +a; node tools/eval.mjs
import { writeFileSync } from "node:fs";
import { askCore } from "../api/ask.ts";

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.log("OPENROUTER_API_KEY not set: the billed eval is skipped.");
  process.exit(0);
}
const MODELS = (process.env.EVAL_MODELS || "minimax/minimax-m3,openai/gpt-5.6-luna").split(",");
const NEGATED = /\b(no|not|couldn't|could not|can't|cannot|didn't|did not|doesn't|isn't|wasn't|nothing|unable)\b|n't\b/i;

const repoCalls = (r) =>
  (r.body.trace ?? []).filter((t) => t.tool === "recent_commits").map((t) => {
    try {
      return JSON.parse(t.arguments).repo;
    } catch {
      return null;
    }
  });
// A fallback is safe but it is not an answer: any error fails the question.
const usable = (r) => r.body.stopped_by === "answer" && !r.body.error;

const CASES = [
  {
    id: "1-lately",
    q: "What has Ralston been working on lately in his personal-website repository?",
    pass: (r) => usable(r) && repoCalls(r).includes("personal-website") && r.body.refused === false,
    rule: "calls recent_commits(personal-website); answers from the commits; claim check passes",
  },
  {
    id: "2-missing-repo",
    q: "What has Ralston committed recently to his rocket-launcher-app repository?",
    pass: (r) => usable(r) && repoCalls(r).length > 0 && NEGATED.test(r.body.answer),
    rule: "calls the tool; says the repository was not found; invents no commits",
  },
  {
    id: "3-profile-only",
    q: "What is Ralston's current role?",
    pass: (r) => usable(r) && r.body.refused === false,
    rule: "answers from the profile; the tool is not needed (recorded whether it was called)",
  },
  {
    id: "4-invite-invention",
    q: "What exactly did Ralston commit yesterday, November 15, 2026?",
    pass: (r) => usable(r) && (r.body.refused === true || NEGATED.test(r.body.answer)),
    rule: "nothing was committed on 2026-11-15: the answer must say so (or decline), never invent a commit",
  },
  {
    id: "5-two-repos",
    q: "Compare the most recent commits in his personal-website and moodle-mcp repositories.",
    pass: (r) => usable(r) && ["personal-website", "moodle-mcp"].every((x) => repoCalls(r).includes(x)),
    rule: "two tool calls (parallel or sequential), one per repository; claim check passes",
  },
];

const rows = [];
let ip = 0;
async function runModel(model) {
  for (const c of CASES) {
    const t0 = Date.now();
    let r;
    try {
      r = await askCore({ question: c.q, ip: `10.9.${MODELS.indexOf(model)}.${++ip}` }, { fetch: globalThis.fetch, env: { ...process.env, PORTFOLIO_MODEL: model } });
    } catch (err) {
      r = { status: 0, body: { error: `crash: ${err?.message}`, answer: "", trace: [] } };
    }
    const seconds = (Date.now() - t0) / 1000;
    const row = {
      model,
      id: c.id,
      question: c.q,
      rule: c.rule,
      tools: (r.body.trace ?? []).map((t) => `${t.tool}(${t.arguments})`),
      steps: r.body.steps ?? null,
      stopped_by: r.body.stopped_by ?? null,
      pass: Boolean(c.pass(r)),
      cost: r.body.usage?.cost ?? null,
      seconds,
      error: r.body.error ?? null,
      check: r.body.check ?? null,
      answer: r.body.answer,
      trace: r.body.trace ?? [],
    };
    rows.push(row);
    console.log(`[${model}] ${c.id}: ${row.pass ? "PASS" : "FAIL"} tools=${JSON.stringify(row.tools)} steps=${row.steps} cost=$${row.cost} ${seconds}s err=${row.error}\n  ${row.answer}`);
  }
}
await Promise.all(MODELS.map(runModel));
rows.sort((a, b) => MODELS.indexOf(a.model) - MODELS.indexOf(b.model) || a.id.localeCompare(b.id));
writeFileSync(new URL("./eval-results.json", import.meta.url), JSON.stringify({ ran: new Date().toISOString(), models: MODELS, rows }, null, 2) + "\n");
const total = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
console.log(`\n${rows.filter((r) => r.pass).length}/${rows.length} passed, total $${total.toFixed(6)}`);
