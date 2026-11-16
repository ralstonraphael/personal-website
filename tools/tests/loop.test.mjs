// No-key tests for the Week 8 tool loop: the tool, the decision, the loop, the claim check.
// The model is scripted: each test says exactly what the "model" replied, in order, and checks
// what our program did about it. GitHub is a fake too, so nothing here touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RECENT_COMMITS, recentCommits } from "../github.ts";
import { TOOLS, runTool, runLoop } from "../loop.ts";
import { checkClaims } from "../check.ts";
import { askCore } from "../../api/ask.ts";

const EMAIL = "ralstone2005@gmail.com";
const FALLBACK = `I can't answer that reliably right now. You can email Ralston at ${EMAIL}.`;
const CAP_SENTENCE = `I couldn't finish answering that in 4 steps. You can email Ralston at ${EMAIL}.`;

// ---- a scripted model ----------------------------------------------------------------------------
const toolCall = (name, args, id = "call_1") => ({
  choices: [{ message: { content: "", tool_calls: [{ id, type: "function", function: { name, arguments: args } }] }, finish_reason: "tool_calls" }],
  usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.0001 },
});
const answer = (content) => ({
  choices: [{ message: { content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.0001 },
});

// `send` is what the loop calls to reach the model. It records what it was sent.
function scriptedModel(replies) {
  const queue = [...replies];
  const sent = [];
  const send = async (messages) => {
    sent.push(structuredClone(messages));
    if (queue.length === 0) throw new Error("the loop asked the model again after the script ran out");
    return queue.shift();
  };
  send.sent = sent;
  return send;
}

// A fake GitHub: answers /repos/ralstonraphael/<repo>/commits from a table of repos.
const COMMITS = [
  { sha: "0e2d99b1234567890abcdef", commit: { author: { date: "2026-11-09T18:00:00Z" }, message: "Week 7: re-spoke answers\n\nbody" } },
  { sha: "334240e1234567890abcdef", commit: { author: { date: "2026-11-09T17:00:00Z" }, message: "Speak email addresses as words (green)" } },
];
function fakeGitHub({ status = 200, repos = { "personal-website": COMMITS }, throws } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (throws) throw Object.assign(new Error("boom"), { name: throws });
    const m = /\/repos\/ralstonraphael\/([^/]+)\/commits/.exec(String(url));
    if (status !== 200) return new Response("{}", { status });
    if (!m || !repos[m[1]]) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    return new Response(JSON.stringify(repos[m[1]]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  fetch.calls = calls;
  return fetch;
}
const toolDeps = (fetch = fakeGitHub()) => ({ fetch, env: {} });

// ---- the tool: schema, owner fixed, GitHub failures as results -----------------------------------
test("the schema the model sees: recent_commits(repo, count), repo required, nothing else", () => {
  const f = RECENT_COMMITS.function;
  assert.equal(RECENT_COMMITS.type, "function");
  assert.equal(f.name, "recent_commits");
  assert.match(f.description, /Use this before saying anything/);
  assert.deepEqual(f.parameters.required, ["repo"]);
  assert.deepEqual(Object.keys(f.parameters.properties).sort(), ["count", "repo"]);
  assert.equal(f.parameters.additionalProperties, false);
});

test("recent_commits reads ralstonraphael/<repo> only and maps commits to sha, date, first line", async () => {
  const gh = fakeGitHub();
  const r = await recentCommits({ repo: "personal-website" }, toolDeps(gh));
  assert.match(gh.calls[0].url, /^https:\/\/api\.github\.com\/repos\/ralstonraphael\/personal-website\/commits\?per_page=5$/);
  assert.equal(r.repo, "ralstonraphael/personal-website");
  assert.deepEqual(r.commits[0], { sha: "0e2d99b", date: "2026-11-09", message: "Week 7: re-spoke answers" });
});

test("GitHub failures come back as results: 404, rate limit, unreachable", async () => {
  const missing = await recentCommits({ repo: "rocket-app" }, toolDeps());
  assert.match(missing.error, /no public repository named ralstonraphael\/rocket-app/);
  assert.equal(missing.found, false);
  assert.match((await recentCommits({ repo: "x" }, toolDeps(fakeGitHub({ status: 403 })))).error, /rate limit/);
  assert.match((await recentCommits({ repo: "x" }, toolDeps(fakeGitHub({ status: 429 })))).error, /rate limit/);
  assert.match((await recentCommits({ repo: "x" }, toolDeps(fakeGitHub({ throws: "TypeError" })))).error, /could not reach GitHub/);
});

// ---- the decision: every bad request is a result, never an exception -----------------------------
test("bad arguments are error results: not JSON, missing repo, extra key, wrong type, bad name, count out of range", async () => {
  const d = toolDeps();
  assert.match((await runTool("recent_commits", '{"repo": "pers', d)).result.error, /not valid JSON/);
  assert.match((await runTool("recent_commits", '{"name": "personal-website"}', d)).result.error, /missing required argument 'repo'/);
  assert.match((await runTool("recent_commits", '{"repo": "a", "owner": "kousen"}', d)).result.error, /unexpected argument 'owner'/);
  assert.match((await runTool("recent_commits", '{"repo": 42}', d)).result.error, /'repo' must be a string/);
  assert.match((await runTool("recent_commits", '{"repo": "kousen/ai-integration-course"}', d)).result.error, /repository name only/);
  assert.match((await runTool("recent_commits", '{"repo": "a", "count": 50}', d)).result.error, /'count' must be/);
  assert.equal(d.fetch.calls.length, 0, "GitHub is never called for a bad request");
});

// ---- the six misuse cases --------------------------------------------------------------------------
test("1. single shot: the result goes back as a tool message with the same tool_call_id", async () => {
  const send = scriptedModel([toolCall("recent_commits", '{"repo": "personal-website"}', "call_1"), answer("done")]);
  const r = await runLoop({ messages: [{ role: "user", content: "q" }], send, toolDeps: toolDeps() });
  assert.equal(r.stoppedBy, "answer");
  assert.equal(r.content, "done");
  const second = send.sent[1];
  assert.equal(second.at(-2).role, "assistant");
  assert.equal(second.at(-2).tool_calls[0].id, "call_1");
  assert.equal(second.at(-1).role, "tool");
  assert.equal(second.at(-1).tool_call_id, "call_1");
  assert.equal(JSON.parse(second.at(-1).content).commits[0].sha, "0e2d99b");
  assert.equal(r.trace.length, 1);
  assert.equal(r.trace[0].tool, "recent_commits");
  assert.equal(r.steps, 2);
  assert.ok(Math.abs(r.cost - 0.0002) < 1e-12);
});

test("2. bad arguments: the error goes back to the model and the loop continues", async () => {
  const gh = fakeGitHub();
  const send = scriptedModel([
    toolCall("recent_commits", '{"name": "personal-website"}', "call_1"),
    toolCall("recent_commits", '{"repo": "personal-website"}', "call_2"),
    answer("done"),
  ]);
  const r = await runLoop({ messages: [], send, toolDeps: toolDeps(gh) });
  assert.match(JSON.parse(send.sent[1].at(-1).content).error, /missing required argument 'repo'/);
  assert.equal(r.stoppedBy, "answer");
  assert.equal(gh.calls.length, 1, "only the corrected call reaches GitHub");
});

test("3. unknown tool: an error result that names the real tool", async () => {
  const send = scriptedModel([toolCall("get_resume", "{}"), answer("I can't get that.")]);
  const r = await runLoop({ messages: [], send, toolDeps: toolDeps() });
  const result = JSON.parse(send.sent[1].at(-1).content);
  assert.match(result.error, /unknown tool 'get_resume'/);
  assert.match(result.error, /recent_commits/);
  assert.equal(r.stoppedBy, "answer");
});

test("4. endless caller: stopped after 4 chat calls; the answer is the program's sentence", async () => {
  const replies = Array.from({ length: 10 }, (_, i) => toolCall("recent_commits", '{"repo": "personal-website"}', `c${i}`));
  const send = scriptedModel(replies);
  const r = await runLoop({ messages: [], send, toolDeps: toolDeps() });
  assert.equal(r.stoppedBy, "cap");
  assert.equal(send.sent.length, 4);
  assert.equal(r.content, null);

  // Through askCore: the visitor sees the program's sentence, never the model's last reply.
  let n = 0;
  const fetch = async (url) => {
    if (String(url).includes("api.github.com")) return new Response(JSON.stringify(COMMITS), { status: 200 });
    n++;
    return new Response(JSON.stringify(toolCall("recent_commits", '{"repo": "personal-website"}', `k${n}`)), { status: 200 });
  };
  const out = await askCore({ question: "What is he working on?", ip: "10.8.0.1" }, { fetch, env: { OPENROUTER_API_KEY: "sk-test" } });
  assert.equal(n, 4);
  assert.equal(out.body.answer, CAP_SENTENCE);
  assert.equal(out.body.stopped_by, "cap");
  assert.equal(out.body.refused, true);
  assert.equal(out.body.trace.length, 4);
});

test("5. side effect held: recorded as pending, the function never runs", async () => {
  let ran = false;
  const registry = {
    ...TOOLS,
    send_intro: {
      schema: { type: "function", function: { name: "send_intro", description: "test stub", parameters: { type: "object", properties: { email: { type: "string" } }, required: ["email"], additionalProperties: false } } },
      sideEffect: true,
      run: async () => {
        ran = true;
        return { sent: true };
      },
    },
  };
  const send = scriptedModel([toolCall("send_intro", '{"email": "r@x.com"}'), answer("Ralston will need to confirm that first.")]);
  const r = await runLoop({ messages: [], send, toolDeps: toolDeps(), registry });
  assert.equal(ran, false);
  assert.deepEqual(r.pending, [{ tool: "send_intro", arguments: { email: "r@x.com" } }]);
  assert.match(JSON.parse(send.sent[1].at(-1).content).error, /side effect and needs a person's confirmation first/);
  assert.equal(TOOLS.recent_commits.sideEffect ?? false, false, "the real tool is read-only");
});

test("6. unsupported claim: a SHA, date or repo no tool returned is flagged", () => {
  const trace = [{ tool: "recent_commits", result: { repo: "ralstonraphael/personal-website", commits: [{ sha: "0e2d99b", date: "2026-11-09", message: "Week 7" }] } }];
  assert.equal(checkClaims("His latest commit 0e2d99b on 2026-11-09 re-spoke the answers.", trace).supported, true);
  const bad = checkClaims("Yesterday (2026-11-15) he pushed a1b2c3d to ralstonraphael/rocket-app.", trace);
  assert.equal(bad.supported, false);
  assert.equal(bad.unsupported.length, 3);
  assert.equal(checkClaims("He committed a1b2c3d.", []).supported, false, "a SHA with no tool call at all");
});

test("6b. a repository the tool did not find may only be named as not found", () => {
  const trace = [{ tool: "recent_commits", result: { error: "no public repository named ralstonraphael/rocket-app", repo: "ralstonraphael/rocket-app", found: false } }];
  assert.equal(checkClaims("I couldn't find a public repository called rocket-app.", trace).supported, true);
  assert.equal(checkClaims("In rocket-app he has been adding a login page.", trace).supported, false);
});

test("6c. through askCore: an invented commit is replaced by the fallback, with the reason", async () => {
  const replies = [
    toolCall("recent_commits", '{"repo": "personal-website"}'),
    answer(JSON.stringify({ answer: "Yesterday he committed f00ba47 to personal-website.", evidence: ["tool:recent_commits"], refused: false })),
  ];
  const fetch = async (url) => {
    if (String(url).includes("api.github.com")) return new Response(JSON.stringify(COMMITS), { status: 200 });
    return new Response(JSON.stringify(replies.shift()), { status: 200 });
  };
  const out = await askCore({ question: "What did he commit yesterday?", ip: "10.8.0.2" }, { fetch, env: { OPENROUTER_API_KEY: "sk-test" } });
  assert.equal(out.body.answer, FALLBACK);
  assert.equal(out.body.error, "unsupported_claim");
  assert.equal(out.body.check.supported, false);
});

// ---- wiring: the chatbot's answer function --------------------------------------------------------
test("askCore sends the schema, answers from the tool result, and returns the trace", async () => {
  const replies = [
    toolCall("recent_commits", '{"repo": "personal-website"}'),
    answer(JSON.stringify({ answer: "His latest commit, 0e2d99b on 2026-11-09, re-spoke the chatbot's answers.", evidence: ["tool:recent_commits"], refused: false })),
  ];
  const bodies = [];
  const fetch = async (url, init) => {
    if (String(url).includes("api.github.com")) return new Response(JSON.stringify(COMMITS), { status: 200 });
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify(replies.shift()), { status: 200 });
  };
  const out = await askCore({ question: "What is he working on lately?", ip: "10.8.0.3" }, { fetch, env: { OPENROUTER_API_KEY: "sk-test" } });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].tools[0].function.name, "recent_commits");
  assert.equal(out.status, 200);
  assert.equal(out.body.refused, false);
  assert.match(out.body.answer, /0e2d99b/);
  assert.deepEqual(out.body.evidence, ["tool:recent_commits"]);
  assert.equal(out.body.stopped_by, "answer");
  assert.equal(out.body.trace[0].tool, "recent_commits");
  assert.ok(Math.abs(out.body.usage.cost - 0.0002) < 1e-12, "cost is summed over both chat calls");
  assert.equal(JSON.stringify(out.body).includes("sk-test"), false);
});

test("tool evidence is only accepted when the tool returned commits this turn", async () => {
  const fetch = async () =>
    new Response(JSON.stringify(answer(JSON.stringify({ answer: "He has been busy.", evidence: ["tool:recent_commits"], refused: false }))), { status: 200 });
  const out = await askCore({ question: "What is he working on?", ip: "10.8.0.4" }, { fetch, env: { OPENROUTER_API_KEY: "sk-test" } });
  assert.equal(out.body.error, "invalid_reply");
});

// Found in the first billed run (November 16): M3 spent all 600 tokens reasoning after the tool
// result and returned no content (finish_reason "length"). It keeps reasoning on, with more room.
test("minimax-m3 gets room to reason after a tool result; luna keeps 600", async () => {
  const sent = [];
  const fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify(answer(JSON.stringify({ answer: "ok", evidence: [], refused: true }))), { status: 200 });
  };
  await askCore({ question: "hi", ip: "10.8.0.5" }, { fetch, env: { OPENROUTER_API_KEY: "sk-test", PORTFOLIO_MODEL: "minimax/minimax-m3" } });
  await askCore({ question: "hi", ip: "10.8.0.6" }, { fetch, env: { OPENROUTER_API_KEY: "sk-test" } });
  assert.equal(sent[0].max_tokens, 3000);
  assert.equal(sent[1].max_tokens, 600);
});
