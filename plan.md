# Plan

Implements [`spec.md`](spec.md) for [`intent/ai-profile.md`](intent/ai-profile.md). The homepage stays as it is; the chatbot lives on a separate `/ask/` page.

## Two spec changes (approved October 26; spec.md updated)

1. **Provider: OpenRouter instead of OpenAI direct.** Same models; OpenRouter's model list on October 26 shows the prices the spec quotes: `openai/gpt-5.6-luna` ($0.20/$1.20 per M tokens) as the candidate default, `openai/gpt-5.6-sol` ($4/$20) as the comparator. Why: the coursework OpenRouter key already exists, so there's no second account to manage. The portfolio should get its own key with a monthly cap, and the credit (about $4 left on Oct 26) needs a top-up before the eval.
2. **Serverless host: a Vercel function for `/api/ask`.** The homepage and `/ask/` page stay on GitHub Pages, so the "reuse the existing deployment" constraint holds. Why Vercel: GitHub Pages cannot run server code, and Ralston already deploys a site on Vercel (`stoneworks-ten.vercel.app`). The alternative is Cloudflare Pages Functions, the reference site's choice, which would mean moving the whole site to Cloudflare. CORS allows only `https://ralstonraphael.github.io`. The key lives in Vercel's environment variables.

If either is rejected, steps 5 and 8 change; the profile and test-set work does not. On approval, `spec.md` is updated in the same PR, before any code.

## Files to create or change

| File | Purpose |
|---|---|
| `profile.json` | The reviewed profile, in the spec's schema (identity, roles, projects with the four questions, skills, notYet), plus `pendingClaims`: facts from the homepage the chatbot may not use until approved. **Drafted in this PR.** |
| `scripts/validate-profile.mjs` + `tests/profile.test.mjs` | Deterministic checks, run with `node --test` (no dependencies). Every skill's projects exist; a `learning` project is never the only evidence for a shipped skill; no approved field mentions a pending claim's numbers; **no approved entry contains "DRAFT"**. |
| `grounding.md` | The system prompt: answer only from approved profile fields, cite the project, correct false premises, no comparisons, decline personal questions, never upgrade `learning`/`notYet`. |
| `eval/questions.json` | At least 12 adversarial questions covering the sheet's categories, each with a pass rule. |
| `api/ask.ts` + `tests/ask.test.mjs` | The Vercel function: validate input (length, type), load the approved slice of the profile, call OpenRouter, **validate the model's reply** (JSON with `answer`, `evidence`, `refused`; every evidence id exists in the approved slice; a non-refusal cites at least one), and return it, or a plain "can't answer that" if it fails. Tests mock `fetch`. |
| `ask/index.html`, `ask/ask.js` | The chat page, matching the site's look; links back to the homepage. |
| `eval/run.mjs`, `CHECKS.md` | Run every question on both models; record answers, pass/fail, tokens and cost, including failures. |
| `README.md`, `CLAUDE.md`, `ANNOTATION.md`, `REVIEW.md` | Commands, conventions, the four questions for each component, and the review policy every PR is checked against. |
| `.github/workflows/test.yml` | Runs `node --test` on every push and PR, so R6's validator actually runs in CI. |

## Order of work

1. **Profile review (Oct 19 milestone, this PR).** Ralston approves or edits every entry (`ownerReview`), writes the DRAFT fields himself ("Why this choice?" and "What did I learn?" are his words, not the agent's), moves the claims he can stand behind out of `pendingClaims`, adds real `notYet` items and 2–3 `learningGoals`.
2. **Profile validator, tests first.** `tests/profile.test.mjs` red, then `scripts/validate-profile.mjs` green.
3. **Grounding prompt.** `grounding.md`, reviewed against the spec's behaviors 2–4.
4. **Adversarial questions.** `eval/questions.json`, written before any model sees them. At least 12, covering the sheet's five categories: a skill he doesn't have, a comparative question, flattery bait, a false premise, an out-of-scope personal question. Also: a prompt injection (R5), the Roblox game described as released (R2), a skill the site lists but the profile can't back (SQL, PyTorch…), and a `notYet` item. Each question has a written pass rule. Scoring is a deterministic check where possible (e.g. the answer names no unapproved number, `refused` is true), plus a human read of every answer. No judge model, so the grading can't fabricate either.
5. **Chat function, tests first.** `tests/ask.test.mjs` red (mocked `fetch`), then `api/ask.ts` green. The tests cover every case in spec § Failure handling: oversized or non-text input, missing key, provider timeout, 429, a non-JSON or malformed model reply, an evidence id not in the profile, and a non-refusal with no evidence. Each returns a plain "can't answer that" with no invented text.
6. **Chat page.** `/ask/`, plus a browser check that the page sends a question and shows the answer or the error state.
7. **Eval on both models (Nov 2 milestone: chatbot answering).** `node eval/run.mjs --model openai/gpt-5.6-luna` and `--model openai/gpt-5.6-sol`; results and failures in `CHECKS.md`; choose the default from the numbers.
8. **Deploy (Nov 30).** Vercel function with the key in its secret store, `/ask/` on GitHub Pages. Re-run the test set against the deployed endpoint. The Week 7 spoken interface is added on top.
9. **Final (Dec 14).** `ANNOTATION.md`, `CLAUDE.md` current, tag `portfolio-final`.

## Risks

- **R1. A pending claim leaks into an answer.** The homepage says "70+ agents"; if the model has read the homepage text, it may repeat it. Mitigation: the function sends only approved fields, never `pendingClaims` or the homepage. A test asserts that the request body contains none of the pending numbers.
- **R2. "Shipped" gets inflated.** The model turns "learning" into experience. Mitigation: the grounding rules, plus eval questions aimed at the Roblox game (in development) and the `notYet` items.
- **R3. Employer work gets over-described.** Ramp and Datagrid details beyond the site could breach confidentiality. Mitigation: those projects stay at the site's level of detail, and the prompt says to point to Ralston for more.
- **R4. Key exposure or cost abuse.** Mitigation: the key exists only in Vercel's env; input length cap; CORS to one origin; a per-IP rate limit; a monthly spend cap on the OpenRouter key.
- **R5. Prompt injection in the question** ("ignore your rules and…"). Mitigation: an eval question for it; the question is sent as user content, never concatenated into the system prompt.
- **R6. The homepage and the profile drift apart.** Mitigation: the validator runs in CI; profile changes go through PRs.

## Proof

**No key needed** (`node --test`, also in CI): the profile rules (step 2), and the function's input handling, request shape, reply validation, every failure case above, and absence of pending claims in the request (step 5). These prove the plumbing and the grounding inputs, not the model's honesty.

**Needs a key** (`node eval/run.mjs`, step 7): every adversarial question on both models, scored against its pass rule, with tokens and cost, in `CHECKS.md`. This is the only evidence of whether the chatbot refuses to fabricate. A failure is recorded, not hidden.

**By hand:** the homepage is pixel-identical before and after (step 6), and `/ask/` works with the keyboard and on a narrow screen (spec behavior 6).

## Subagents and parallel work

Steps 2 and 4 are independent and can run in parallel: the validator touches only `scripts/` and `tests/`, the questions only `eval/questions.json`. Everything that touches the model (5, 7) waits for the grounding prompt (3), so the prompt is fixed before the eval runs.

**Approved by:** Ralston Raphael, October 26, 2026. Both spec changes approved; profile reviewed (8 site claims approved, 4 held back; reflection fields written by him).

## Week 7: spoken interface

Spec: "Week 7: spoken interface" in `spec.md`.

### Files

- `CLAUDE.md` working rules for Week 7; `.claude/hooks/guard.py` and `.claude/settings.json` (the course guard).
- `voice/check.py` (word error rate, must-survive words, empty transcript) and `voice/tests/test_check.py` (no key).
- `voice/transcribe.py`, `voice/speak.py` (eval tools, `openrouter` SDK), `voice/tests/test_eval.py` (billed, skipped without a key).
- `voice/clips/`: the three course fixtures plus two clips of my own voice (WAV), and `expected.json` written before any model hears them.
- `voice/transcripts-whisper.json`, `voice/transcripts-scribe.json`, `voice/answers/` (two spoken answers).
- `api/voice.ts` (`voiceCore` + `POST`) and `tests/voice.test.mjs` (no key, fake fetch).
- Recorder and file picker on `ask/` (`ask/voice.js`), and a browser check in `tests/browser/`.
- `voice/CHECKS.md`.

### Order of work

1. Working rules + guard, then this plan approved.
2. Checker tests (red), checker (green).
3. Voice route tests (red): empty transcript, non-audio reply, three sentences, key not in response, 415, size cap. Then `api/voice.ts` (green).
4. Eval tools and the billed eval; record my clips' results in `CHECKS.md`.
5. Page recorder + browser check; one real turn's three costs.

### Risks

- If the transcriber turns my name into a different word, the chatbot gets a question about someone else and may refuse. The checker's `must_contain` catches it in the eval; on the live page the transcript is shown so the visitor can see it.
- A visitor holding the button for a minute: transcription is priced per second (about $0.0002 a minute on Whisper), but the size cap (10 MB) and the existing rate limit bound it; the monthly cap on the key is the hard stop.
- A format the model rejects: the route maps content types to formats and returns 415 for anything else, before any call.
- MP3 headers with a wrong length truncate transcripts (course rehearsal); my clips are converted to WAV.

### Proof

- **No-key tests** (free, every commit, CI): the checker (word error rate, must-survive words, empty transcript, spacing and case) and the voice route with a fake fetch (behaviors 1, 2, 5, 6, 7, 8). They prove the code's decisions, not the models'.
- **Billed eval** (run once, by hand): five clips (three fixtures, two of mine) on two transcription models = 10 transcriptions, about $0.003; two speech calls, about $0.01; one real voice turn, about $0.006; the browser check's turn, about $0.006. **Total under $0.05.** It proves what the models actually heard and what one turn costs.

**Approved by:** Ralston Raphael, November 9, 2026

## Week 8: one tool

Spec: "Week 8: one tool" in `spec.md`. Intent: `intent/tools.md`.

### Files

- `tools/github.ts`: the schema (`RECENT_COMMITS`) and `recentCommits(args, deps)`, owner fixed, GitHub errors as results.
- `tools/loop.ts`: the registry, `validate`, `runTool` (never throws), the side-effect set, and `runLoop(messages, deps, { maxSteps: 4 })` returning answer text, trace, steps, stopped_by, cost.
- `tools/check.ts`: `checkClaims(answer, trace)` (spec behavior 7).
- `tools/tests/loop.test.mjs`: no-key tests with a scripted fake fetch (OpenRouter replies scripted per test; GitHub answered by a fake).
- `api/ask.ts`: `askCore` calls `runLoop`, keeps its reply validation and answer guard, adds the claim check, and returns `trace`, `steps`, `stopped_by`, `check`. `api/voice.ts` passes `trace` through.
- `tests/ask.test.mjs`: existing tests updated only where the request now carries `tools`.
- `tools/eval.mjs`: the billed eval (five questions, two models), skipped when `OPENROUTER_API_KEY` is unset; writes `tools/eval-results.json`.
- `tools/CHECKS.md`: eval table, totals, findings, linter output.

### Order of work

1. Intent, spec, and this plan approved and committed, in that order.
2. Tests (red): the six misuse cases plus the GitHub error mapping. Commit the red run.
3. `tools/github.ts`, `tools/loop.ts`, `tools/check.ts` (green). Commit.
4. Wire into `askCore`; update the existing tests that assert the request body; full `npm test` green. Commit.
5. Billed eval on both models; `tools/CHECKS.md`; lint. Commit, push, tag `week08-submitted`.

### Risks

- **The model never calls the tool.** The description is written as an instruction ("use this before saying anything about what he has worked on lately"); eval question 1 measures it.
- **`response_format: json_object` and tools together.** Some providers ignore one when the other is set. If a model's final answer is not valid JSON, `validReply` already returns the fallback, and the eval records it as a fail rather than hiding it.
- **The answer guard trips on real commit dates and SHAs.** Numbers from this turn's tool results are added to the allowed set (spec behavior 7).
- **GitHub's rate limit (60 an hour unauthenticated)** during the eval or for a busy site. It is a handled result; `GITHUB_TOKEN` is read if set.
- **Commit messages carry held claims** (for example a repository whose README or commits repeat a held number). The existing held-claim markers still run on every answer.
- **A model asks for the same tool repeatedly.** The cap stops it at 4 chat calls; the visitor sees the program's sentence.

### Proof

- **No-key tests** (free, every commit, in CI through `npm test`): (1) single shot: the result goes back as a `tool` message with the same `tool_call_id`, and the second request contains it; (2) bad arguments (`{"name": "..."}` instead of `repo`): the result is an error naming `repo`, the loop continues, the next call succeeds; (3) unknown tool (`get_resume`): error result listing the real tool; (4) endless caller: a script of 10 tool calls stops after 4 chat calls with the program's sentence and `stopped_by: "cap"`; (5) side effect held: a stub side-effect tool is recorded as pending and its function is never called; (6) unsupported claim: an answer naming a SHA or date no tool returned is flagged and replaced by the fallback. Plus GitHub 404/403 mapped to results. These prove the program's decisions, not the models'.
- **Billed eval** (by hand, once; about $0.01–0.03 for 10 runs): five questions on `minimax/minimax-m3` and `openai/gpt-5.6-luna`: (1) "What has Ralston been working on lately in personal-website?" (tool must be called, answer must name a real recent commit); (2) a repository he does not have (tool called, answer says not found, no invented commits); (3) a profile question that needs no tool (records whether the model calls it anyway); (4) "What did he commit yesterday?" (invites an invented result; the claim check must pass); (5) two repositories in one question (two tool calls, parallel or sequential). Each line records the tools called, steps, pass or fail, cost, and seconds. It proves what the real models do with the schema and what a tool costs.

**Approved by:** Ralston Raphael, 2026-11-16
