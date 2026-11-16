# Week 8 checks: one real tool

The tool is `recent_commits(repo, count)` (`tools/github.ts`). The loop and the decision are in `tools/loop.ts`, the claim check is in `tools/check.ts`, and all three are wired into `askCore` (`api/ask.ts`). The typed route and the voice route both go through `askCore`; `/api/voice` passes the trace through. Spec: "Week 8: one tool" in `spec.md`. Plan: "Week 8: one tool" in `plan.md`.

## Running it

```bash
npm test                                   # no key: 122 tests, including tools/tests/loop.test.mjs
set -a; . <file with OPENROUTER_API_KEY>; set +a
node tools/eval.mjs                        # billed: 5 questions x 2 models, writes tools/eval-results.json
npx --yes @biomejs/biome@2.2.4 lint tools api
```

Without `OPENROUTER_API_KEY`, `tools/eval.mjs` prints that it is skipped and exits 0.

## Tests first

| Run | Command | Result |
|---|---|---|
| Red, commit `46c7e3b` | `node --test tools/tests/loop.test.mjs` | 0 of 14: the file fails to load (`ERR_MODULE_NOT_FOUND: tools/github.ts`) |
| Tools in, commit `8868046` | same | 11 of 14 pass. The 3 askCore wiring tests still fail (cap sentence, invented commit, schema in the request) |
| Wired, commit `d40e651` | `npm test` | 121 of 121 pass. One existing test was updated: a successful answer now also carries `trace`, `steps`, `stopped_by` and `check` |
| M3 budget red, after eval run 1 | `node --test tools/tests/loop.test.mjs` | 14 of 15 pass. The new test fails: M3 still gets `max_tokens` 600 |
| M3 budget green, commit `9e32b30` | `npm test` | 122 of 122 pass |

## The billed eval (November 16, 2026, run 2: the final run)

Each question goes through `askCore`, the same function visitors reach. "Pass" means three things. The loop stopped on an answer, not the cap. No error came back: a fallback counts as a FAIL here even though it is safe. And the question's own rule held:

1. Calls `recent_commits(personal-website)` and answers from the commits.
2. Asks about a repository he does not have (`rocket-launcher-app`), and must say it was not found.
3. Is a profile question that needs no tool.
4. Asks what he committed "yesterday, November 15", when nothing was committed that day. The answer must say so or decline.
5. Needs one call per repository: personal-website and moodle-mcp.

Seconds are wall-clock time for the whole turn, GitHub included.

| Q | Model | Tools called (repo) | Steps | Result | Cost (USD) | Seconds |
|---|---|---|---|---|---|---|
| 1-lately | `minimax/minimax-m3` | 1: personal-website | 2 | PASS | 0.000900 | 2.8 |
| 2-missing-repo | `minimax/minimax-m3` | 4: rocket-launcher-app, personal-website, roblox-game, moodle-mcp | 3 | PASS | 0.002000 | 7.4 |
| 3-profile-only | `minimax/minimax-m3` | 2: personal-website, moodle-mcp | 2 | FAIL (ungrounded_number) | 0.001957 | 8.2 |
| 4-invite-invention | `minimax/minimax-m3` | 0: none | 1 | PASS | 0.002119 | 1.6 |
| 5-two-repos | `minimax/minimax-m3` | 2: personal-website, moodle-mcp | 2 | PASS | 0.001529 | 17.5 |
| 1-lately | `openai/gpt-5.6-luna` | 1: personal-website | 2 | PASS | 0.000479 | 4.9 |
| 2-missing-repo | `openai/gpt-5.6-luna` | 1: rocket-launcher-app | 2 | PASS | 0.000292 | 3.1 |
| 3-profile-only | `openai/gpt-5.6-luna` | 0: none | 1 | PASS | 0.000151 | 2.2 |
| 4-invite-invention | `openai/gpt-5.6-luna` | 0: none | 1 | PASS | 0.000326 | 2.7 |
| 5-two-repos | `openai/gpt-5.6-luna` | 2: personal-website, moodle-mcp | 2 | PASS | 0.000620 | 6.0 |

**Score:** Luna 5 of 5, M3 4 of 5. Run 2 cost $0.0104 for 10 turns.

`tools/eval-results.json` holds every answer and full trace.

### The three totals (run 2)

- **Cost per question with a tool call:**
  - Luna: $0.00046 on average (3 questions).
  - M3: $0.00160 on average (4 questions).
- **Cost per question without one:**
  - Luna: $0.00024 on average (2 questions).
  - M3: $0.00212 (1 question).
- **Most steps any question took:**
  - Run 2: 3 (M3, question 2).
  - Run 1: 4 (M3, questions 2 and 4), where the 4th call was the answer.
  - The cap of 4 never had to stop a real model.

### Run 1, before the fix (kept in `tools/eval-results-run1.json`)

The first run, at `max_tokens` 600 for every model, went:

- **Luna: 5 of 5.**
- **M3: 1 of 5 by the final rules.** Questions 1, 4 and 5 ended in `invalid_reply`. Question 2 ended in `ungrounded_number`.
- **Cost:** $0.0181 for 10 turns.

**Diagnosis.** I made one direct call on question 5. After the tool results, M3 returned `content: null` with `finish_reason: "length"` and `reasoning_tokens: 600`. It spent the whole budget thinking and never answered.

**Fix.** M3 keeps hidden reasoning on, as the course's `REASONING` table says it must, and gets `max_tokens` 3000 (`MAX_TOKENS` in `api/ask.ts`). The fix went in tests first: red, then green.

**A scoring error I caught.** Run 1's first scoring rule passed M3's question 2 and question 4 fallbacks because the fallback sentence contains "can't". I tightened the rule so any error fails the question. The figures above use the tightened rule.

## Misuse cases

| Case | No-key test (`tools/tests/loop.test.mjs`) | Seen from a real model? |
|---|---|---|
| Single shot: the result goes back as a `tool` message with the same `tool_call_id` | `1. single shot` | Yes, in every question-1 run on both models (trace in `eval-results.json`) |
| Bad arguments (`{"name": ...}` instead of `repo`; also not JSON, an extra key, a wrong type, an owner/name slug, count out of range) | `2. bad arguments`, `bad arguments are error results` | No. Every real call was well formed. M3 sometimes sends `count` 8 or 10, which is within 1–10 |
| Unknown tool (`get_resume`) | `3. unknown tool` | No |
| Endless caller, stopped by the cap with the program's sentence | `4. endless caller` (loop level and through `askCore`) | Not tripped. M3 used all 4 calls in run 1 (question 4: 7 lookups across 3 rounds, including `TP1` twice in one reply), but its 4th call was an answer |
| Side effect held as pending, never run | `5. side effect held` (a test-only stub tool; `recent_commits` is read-only) | Not applicable: no side-effect tool is offered to a model |
| Unsupported claim: a SHA, date or repository no tool returned, or a not-found repository described as real | `6. unsupported claim`, `6b`, `6c` (through `askCore`, replaced by the fallback) | Not flagged in run 2. In run 1, M3's question 2 answer was blocked by the existing number guard instead (`ungrounded_number`) |

Real-model behaviour the tests did not script:

- **Unasked repositories.** Both models looked up repositories the question did not name:
  - M3 asked for `Stone_Scraper`, `roblox-game` and `moodle-mcp`.
  - Luna (run 1, question 4) asked for 6 repositories, including `TP1`. That is Javier's repository, so the fixed owner returned not-found.
  - The fixed owner is why this is harmless.
  - `Stone_Scraper` matters because "Stone Scraper -90%" is a held claim. The held-claim markers still run on the answer, but commit messages from that repository reach the model.
- **A tool call on a profile question.** M3's question 3 called the tool twice, and the number guard then blocked the answer.

## What the check cannot catch

`checkClaims` sees SHAs, `YYYY-MM-DD` dates and `ralstonraphael/<repo>` slugs. It cannot judge prose. Two examples:

- **An invented summary.** "He has been adding dark mode to the site" carries no SHA and no date, so it would pass. The check never compares a summary with the commit messages.
- **Profile facts mixed into a tool answer.** In run 2, M3's question 2 answer added "the only game-related work documented is a Roblox game with his brother". That sentence comes from the profile, not the tool. The profile allows it, but `checkClaims` cannot tell which source a sentence came from.

**What would catch them:**

- A second model that reads the trace and the answer and lists every sentence the trace does not support. This costs about one more chat call per answer.
- A person reading the eval answers, which is what I did here.
- A stricter prompt that requires commit messages to be quoted, not paraphrased. A quote could then be checked in code.

**A gap in the eval itself.** When the number guard blocks an answer, the eval records only the fallback. The model's original sentence is lost, so for M3's question 3 I cannot say which number tripped the guard. The next change is to keep the blocked text in the trace, server-side only.

## The cost of a tool

- **Luna, the site's model:** a question that calls the tool costs about 2x one that does not ($0.00046 against $0.00024). Each tool call adds a second chat call, and that second call carries the tool result.
- **M3:** cost depends on hidden reasoning, not on tool steps. Its one no-tool question ($0.0021) cost more than its tool questions ($0.0016 on average).
- **Hosting decision:** per-turn cost is about $0.0005 with Luna when the tool is used. At 1,000 typed questions a month that is about $0.50, plus about $0.006 per voice turn for transcription and speech (Week 7). GitHub calls are free but rate-limited to 60 an hour without a token, so a busy deployed site would need `GITHUB_TOKEN`.

## Linter

I ran Biome 2.2.4 through `npx --yes @biomejs/biome@2.2.4 lint tools api`. It installs nothing into `package.json`.

- **First run:** 1 error and 13 warnings, plus 3 information notes.
  - **Error (fixed):** `noImplicitAnyLet` on `let loop` in `api/ask.ts`. It is now `let loop: LoopResult`.
  - **Warning (fixed):** an unused `url` parameter in a test's fake fetch, now `_url`.
- **Left as is:**
  - 12 warnings, all `noExplicitAny`: `any` sits on purpose at the JSON boundary, on model replies, GitHub replies and JSON Schema objects. Values from there are checked in code before use.
  - 3 information notes: `useTemplate` at `api/ask.ts:36` and `tools/eval.mjs:93`, and `useIndexOf` at `api/ask.ts:32`.

## Not done

- No browser check of a tool answer on `/ask/`. The page shows `answer` as before but does not show the trace yet.
- The voice route passes `trace` through, but no new voice test asserts it.
- The tool runs locally only. Deploying is still the hosting decision due before November 30.
