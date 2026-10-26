# Plan

Implements [`spec.md`](spec.md) for [`intent/ai-profile.md`](intent/ai-profile.md). The homepage stays as it is; the chatbot lives on a separate `/ask/` page.

## Two spec changes to approve first

1. **Provider: OpenRouter instead of OpenAI direct.** Same models at the prices the spec quotes: `openai/gpt-5.6-luna` ($0.20/$1.20 per M tokens) as the candidate default, `openai/gpt-5.6-sol` ($4/$20) as the comparator. Why: an OpenRouter key with credit already exists for coursework, so there is no second account or key to manage.
2. **Serverless host: a Vercel function for `/api/ask`.** The homepage and `/ask/` page stay on GitHub Pages, so the "reuse the existing deployment" constraint holds. Why Vercel: GitHub Pages cannot run server code, and a Vercel account already exists. The alternative is Cloudflare Pages Functions, the reference site's choice, which would mean moving the whole site to Cloudflare. CORS allows only `https://ralstonraphael.github.io`. The key lives in Vercel's environment variables.

If either is rejected, steps 5 and 8 change; the profile and test-set work does not.

## Files to create or change

| File | Purpose |
|---|---|
| `profile.json` | The reviewed profile, in the spec's schema (identity, roles, projects with the four questions, skills, notYet), plus `pendingClaims`: facts from the homepage the chatbot may not use until approved. **Drafted in this PR.** |
| `scripts/validate-profile.mjs` + `tests/profile.test.mjs` | Deterministic checks, run with `node --test` (no dependencies). Every skill's projects exist; a `learning` project is never the only evidence for a shipped skill; no field mentions a pending claim's numbers. |
| `grounding.md` | The system prompt: answer only from approved profile fields, cite the project, correct false premises, no comparisons, decline personal questions, never upgrade `learning`/`notYet`. |
| `eval/questions.json` | At least 12 adversarial questions covering the sheet's categories, each with a pass rule. |
| `api/ask.ts` + `tests/ask.test.mjs` | The Vercel function: validate input (length, type), load the approved slice of the profile, call OpenRouter, return `{answer, evidence, refused}`. Tests mock `fetch`. |
| `ask/index.html`, `ask/ask.js` | The chat page, matching the site's look; links back to the homepage. |
| `eval/run.mjs`, `CHECKS.md` | Run every question on both models; record answers, pass/fail, tokens and cost, including failures. |
| `README.md`, `CLAUDE.md`, `ANNOTATION.md` | Commands, conventions, and the four questions for each component. |

## Order of work

1. **Profile review (Oct 19 milestone, this PR).** Ralston approves or edits each project's four answers (the DRAFT ones are his to write), moves the claims he can stand behind out of `pendingClaims`, and adds `notYet` entries.
2. **Profile validator, tests first.** `tests/profile.test.mjs` red, then `scripts/validate-profile.mjs` green.
3. **Grounding prompt.** `grounding.md`, reviewed against the spec's behaviors 2–4.
4. **Adversarial questions.** `eval/questions.json`, written before any model sees them.
5. **Chat function, tests first.** `tests/ask.test.mjs` red (mocked `fetch`), then `api/ask.ts` green.
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

**No key needed** (`node --test`): the profile rules (step 2), and the function's input handling, request shape, refusal on a missing key, and absence of pending claims in the request (step 5). These prove the plumbing and the grounding inputs, not the model's honesty.

**Needs a key** (`node eval/run.mjs`, step 7): every adversarial question on both models, scored against its pass rule, with tokens and cost, in `CHECKS.md`. This is the only evidence of whether the chatbot refuses to fabricate. A failure is recorded, not hidden.

**By hand:** the homepage is pixel-identical before and after (step 6), and `/ask/` works with the keyboard and on a narrow screen (spec behavior 6).

## Subagents and parallel work

Steps 2 and 4 are independent and can run in parallel: the validator touches only `scripts/` and `tests/`, the questions only `eval/questions.json`. Everything that touches the model (5, 7) waits for the grounding prompt (3), so the prompt is fixed before the eval runs.

**Approved by:** _pending: Ralston to review the two spec changes and step 1_
