// Run the adversarial test set through the real /api/ask logic (askCore) on one model.
//
//   node eval/run.mjs --model openai/gpt-5.6-luna [--out eval/results-luna.json]
//
// Needs OPENROUTER_API_KEY in the environment or in .env (git-ignored). Prints a markdown
// section for CHECKS.md; --out also writes every answer as JSON for the human read.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { askCore } from "../api/ask.ts";
import { approvedSlice, evidenceIds } from "../lib/profile.mjs";
import { scoreReply, profileText } from "./rules.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

function promptBody() {
  const lines = read("grounding.md").split(/\r?\n/);
  return lines.slice(lines.indexOf("---") + 1).join("\n");
}

export async function runEval({ model, fetch, env }) {
  const slice = approvedSlice(JSON.parse(read("profile.json")));
  const ctx = { evidenceIds: evidenceIds(slice), sliceText: profileText(slice), promptBody: promptBody() };
  const { questions } = JSON.parse(read("eval/questions.json"));

  const rows = [];
  for (const [i, q] of questions.entries()) {
    const started = Date.now();
    // A distinct ip per question, so the function's rate limit doesn't throttle the eval.
    const res = await askCore({ question: q.question, ip: `eval-${i}` }, { fetch, env: { ...env, PORTFOLIO_MODEL: model } });
    const score = scoreReply(q, res.body, ctx);
    rows.push({
      id: q.id, category: q.category, question: q.question,
      status: res.status, ...score,
      answer: res.body.answer ?? "", evidence: res.body.evidence ?? [], refused: res.body.refused,
      usage: res.body.usage ?? {}, latencyS: (Date.now() - started) / 1000,
    });
  }

  const passed = rows.filter((r) => r.pass).length;
  const sum = (key) => rows.reduce((total, r) => total + (r.usage[key] ?? 0), 0);
  const cell = (s) => String(s).replace(/\|/g, "\\|");
  const markdown = [
    `## ${model}`,
    "",
    "| Question | Category | Pass | Refused | Evidence | Failures |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.id} | ${cell(r.category)} | ${r.pass ? "pass" : "**FAIL**"} | ${r.refused} | ${r.evidence.join(", ")} | ${cell(r.failures.join("; "))} |`),
    "",
    `- Passed: ${passed} / ${rows.length}`,
    `- Tokens in/out: ${sum("prompt_tokens")} / ${sum("completion_tokens")}`,
    `- Cost: ${rows.some((r) => r.usage.cost == null) ? "n/a (the provider didn't report cost for every call)" : `$${sum("cost").toFixed(4)}`}`,
    `- Mean latency: ${(rows.reduce((t, r) => t + r.latencyS, 0) / rows.length).toFixed(1)} s`,
  ].join("\n");
  return { rows, markdown, passed };
}

function loadDotEnv() {
  const path = new URL(".env", root);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
  loadDotEnv();
  const model = arg("--model") ?? "openai/gpt-5.6-luna";
  const { rows, markdown } = await runEval({ model, fetch, env: process.env });
  console.log(markdown);
  const out = arg("--out");
  if (out) writeFileSync(out, JSON.stringify({ model, ranAt: new Date().toISOString(), rows }, null, 2) + "\n");
}
