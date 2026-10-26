import { test } from "node:test";
import assert from "node:assert/strict";
import { runEval } from "../eval/run.mjs";

// A fake OpenRouter that always answers with a grounded, cited reply.
function fakeFetch(content) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 1000, completion_tokens: 50, cost: 0.0003 },
    }), { status: 200 });
  };
  return { fetch, calls };
}

test("runs every question once on the chosen model and summarizes", async () => {
  const { fetch, calls } = fakeFetch({ answer: "He built Flash Report AI.", evidence: ["flash-report-ai"], refused: false });
  const result = await runEval({ model: "test/model", fetch, env: { OPENROUTER_API_KEY: "test-key" } });

  assert.equal(calls.length, result.rows.length);
  assert.ok(result.rows.length >= 12);
  assert.ok(calls.every((body) => body.model === "test/model"));
  assert.ok(result.markdown.includes("| q01-grounded-rag |"));
  assert.match(result.markdown, /Passed: \d+ \/ \d+/);
  assert.match(result.markdown, /Cost: \$0\.\d+/);
  // A canned "always answer" bot must fail the refusal questions.
  const q12 = result.rows.find((r) => r.id === "q12-personal");
  assert.equal(q12.pass, false);
  const q01 = result.rows.find((r) => r.id === "q01-grounded-rag");
  assert.equal(q01.pass, true);
});

test("a missing key fails every question without calling the model", async () => {
  const { fetch, calls } = fakeFetch({});
  const result = await runEval({ model: "test/model", fetch, env: {} });
  assert.equal(calls.length, 0);
  assert.ok(result.rows.every((r) => !r.pass && r.failures.some((f) => f.includes("not_configured"))));
});
