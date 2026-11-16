# Intent: one real tool for the portfolio chatbot

## Goal

A visitor can ask the chatbot what Ralston has been working on lately and get an answer from live data, not from the profile. The chatbot gets one tool, `recent_commits(repo, count)`: the most recent commits in one of Ralston's public GitHub repositories, read from GitHub's REST API. The model can only ask for the tool. Our code validates the request, runs it or refuses it, and sends every result, including every problem, back to the model as a result it can read.

## Who it is for

The same recruiters and collaborators as the typed and spoken chatbot (`intent/ai-profile.md`, `intent/voice.md`). "What is he building right now?" is a question the profile cannot answer, because the profile is reviewed and fixed, and the commit history is not.

## Constraints

- The model never runs anything. Every tool request is parsed and checked in code against the schema the model was shown. A bad request (wrong argument name, wrong type, not JSON, a tool that does not exist) goes back to the model as an error result, never as an exception and never as a crash for the visitor.
- The owner is fixed in code: the tool reads `ralstonraphael/<repo>` only. The model names a repository, not an owner, so the chatbot cannot be used to read anyone else's GitHub.
- The tool is read-only. Nothing the model asks for can write, send, delete, or spend. The loop still has the rule for side-effect tools (recorded as pending, never run on the model's request alone) so a later tool cannot skip it.
- The loop stops after 4 steps. If the model is still asking for tools at the cap, the answer is the program's own sentence, not the model's.
- The chatbot must not claim anything the tool did not return. A repository, commit, or date in the answer that no tool result contains is caught by code, and the visitor gets the plain fallback instead.
- Real failures are expected and handled: a repository that does not exist (404), GitHub's rate limit (403, 60 requests an hour without a token), GitHub being unreachable. Each becomes a result the model reads and turns into a plain "I couldn't find that" answer.
- The typed path and the voice path both go through the same answer function, so both get the tool, the cap, and the claim check.
- The profile's rules still hold: held claims are never said, and the existing answer guard still runs. Commit messages are public, but they are not approved profile facts; the chatbot reports them as commits, not as achievements.
- Every tool call is billed: a question that uses the tool costs at least one extra chat call. The cost per question with and without the tool is measured, because it belongs in the hosting decision.

## Not in scope

- A second tool, or any tool with a side effect (introductions, email, an outbox).
- Private repositories or a GitHub token in the deployed function. Unauthenticated calls are enough for a portfolio's traffic; the rate limit is a handled failure.
- Deploying. The tool runs locally with the rest of the unreleased chatbot until the hosting decision (before November 30).

## How success is checked

No-key tests with a scripted fake model for the six misuse cases: a single tool call delivered back with the right `tool_call_id`, bad arguments, an unknown tool, a model that never stops asking (stopped by the cap), a side-effect tool held as pending, and an answer that claims something no tool returned. A billed eval of five questions on two models, recording the tools called, steps, pass or fail, cost, and seconds. Results in `tools/CHECKS.md`.

**Approved by:** Ralston Raphael, 2026-11-16
