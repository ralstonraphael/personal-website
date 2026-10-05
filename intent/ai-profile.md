# Intent: grounded portfolio assistant

## Goal

Extend my existing personal website into an AI-enabled profile that helps a visitor decide whether we should work together. The assistant should answer from a profile I can inspect and correct, and say when the profile does not support an answer.

## Who it is for

Recruiters, potential collaborators, and teams considering me for applied AI or forward deployed engineering work. Today they read the site and follow its links themselves; there is no way to ask a focused question about my documented work.

## Constraints

- Reuse `personal-website` and its existing deployment. Keep the current homepage UI and visual design intact for this assignment. The October 5 milestone adds documentation only.
- The profile distinguishes shipped work, current roles, and learning goals. It must not turn an interest or an unverified claim into professional experience.
- The eventual chatbot answers only from approved profile data. It cannot invent projects, metrics, skills, or personal details.
- Keep API keys out of the public repository and browser code. Use a server-side secret store for any hosted model call.
- Keep recurring model spending small and compare a lower-cost model with a stronger model on the same adversarial questions before choosing the deployed default.
- Submit the October 5 intent/spec milestone and the December 14 final portfolio milestone described in the [course project sheet](https://github.com/kousen/ai-integration-course/blob/main/assignments/portfolio.md).

## Not in scope

- Redesigning or rewriting the current homepage.
- A general-purpose chatbot, web search, or answers about facts outside the approved profile.
- Building or deploying the chatbot as part of the October 5 intent/spec milestone.

## Success looks like

1. The current website looks and works as it did before these assignment documents were added.
2. A reviewer can identify the profile schema, honest "not yet" inventory, component choices, and refusal behavior in `spec.md`.
3. At the final milestone, a visitor can ask about documented work and get a grounded answer or an explicit statement that the information is not documented.

## Open questions

The exact claims and project annotations to put into the chatbot's approved profile will be checked against evidence before implementation. This does not block the schema and design decisions in the first milestone.

**Scope approved by:** Ralston Raphael, October 5, 2026 (reuse this website and do not change its UI for the assignment). The agent drafted the remaining design details for review.
