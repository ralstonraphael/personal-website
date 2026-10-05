# Spec: AI-enabled profile site

## Intent

Implements [`intent/ai-profile.md`](intent/ai-profile.md). The existing personal website remains the public homepage. This milestone adds only `intent/` and this specification; it makes no UI or runtime changes.

## Grounded profile

The future machine-readable profile will be a versioned `profile.json` with this shape:

| Field | Required content | Grounding rule |
| --- | --- | --- |
| `identity` | Name, current headline, public links | Confirm against the owner's site or profile. |
| `roles[]` | Organization, title, dates, short scope, source URL | A title or date must have a source; metrics need separate evidence or owner approval. |
| `projects[]` | Name, status (`shipped` or `learning`), evidence URL, and the four-question annotation | "What is this?", "Why this choice?", "What breaks?", and "What did I learn?" are separate fields. |
| `skills[]` | Skill, status (`used_in_shipped_work` or `learning`), supporting project IDs | A topic of interest is not a shipped skill. |
| `notYet[]` | Skill or tool, reason it was not prioritized, evidence status | The assistant must not present it as expertise. |

Initial facts that can be grounded now: the owner is Ralston Raphael; the public site is [this repository's deployed website](https://ralstonraphael.github.io/personal-website/); his [LinkedIn profile](https://www.linkedin.com/in/ralston-raphael/) and the site list Gumloop as his current role. The site itself is an existing web project. Detailed impact claims already written on the homepage are **candidates for owner review**, not automatically approved chatbot facts. The first project annotation will cover this website; later project entries require evidence and owner review.

### Initial "not yet" inventory

These are intentionally conservative entries chosen for this assignment at the owner's request. They are not claims that the owner could never do this work; they record what this portfolio will not present as shipped expertise without evidence.

| Area | Why not prioritized in this portfolio |
| --- | --- |
| Training foundation models from scratch | The portfolio focuses on applying and deploying existing AI systems to real workflows, not pretraining models. |
| Native iOS/Android app development | The documented portfolio work centers on web experiences and AI automation; no shipped native mobile app is being claimed. |
| GPU kernel optimization | Low-level accelerator performance work is outside the documented product and deployment scope. |

If asked about any of these, the assistant says the profile does not document shipped work in that area. The owner can edit this list before the chatbot uses it.

## Components and choices

### Existing homepage

- **What it does:** Presents the current portfolio and experience without an assignment-specific redesign.
- **Language:** HTML, CSS, and browser JavaScript. **Why:** This is the existing stack; replacing it with React or another framework would add migration work and change the site without helping the grounding task.
- **Model:** None. Static content and visual behavior do not need an LLM.
- **Interfaces:** `index.html`, `assets/`, and the existing GitHub Pages URL.
- **Dependencies:** Existing browser features and the site's current assets.

### Structured profile and grounding instructions

- **What it does:** Stores reviewed facts, project annotations, learning goals, and the "not yet" inventory. A separate grounding prompt tells the assistant which facts it may use and when it must decline.
- **Language:** JSON for the profile, Markdown for the prompt. **Why:** JSON is easy to validate and load from both JavaScript and TypeScript; YAML is more pleasant to edit but adds parsing ambiguity. Markdown keeps the rules inspectable.
- **Model:** None for storage and validation. The hosted assistant consumes this data.
- **Interfaces:** Planned `profile.json` and `grounding.md`; each answer should point to the profile entry it used.
- **Dependencies:** A JSON schema or equivalent deterministic validation before deploy.

### Chatbot and API (future milestone)

- **What it does:** Answers the visitor's question, "Should we work together?", using only the approved profile. A separate `/ask/` page can host the chat without changing the current homepage UI.
- **Language:** TypeScript in a serverless endpoint plus minimal browser JavaScript on the separate page. **Why:** It shares the site's JavaScript ecosystem and can keep a model key server-side. Python/FastAPI is viable, but would require a separately managed server for this static site.
- **Model:** Candidate default `gpt-5.6-luna`; comparator `gpt-5.6-sol`. **Why:** The lower-cost model may be enough for a small, well-scoped profile; the stronger model is a check on refusal and grounding quality. Run both on the same ten-plus adversarial questions before final selection. This comparison is planned, not claimed as already completed. [Current model list](https://platform.openai.com/docs/models).
- **Interfaces:** Proposed `POST /api/ask` accepting a short question and returning an answer, evidence IDs, and a refusal flag. The API loads a fixed, reviewed profile version; visitors cannot modify it.
- **Dependencies:** A serverless host, provider API access, server-side secret storage, origin restrictions, input length and request-rate limits.

## Behavior to verify

1. The current homepage HTML, styles, scripts, and assets are unchanged by the October 5 milestone.
2. A response about experience cites one or more approved profile entries and distinguishes a current role from completed, shipped work.
3. A question about an unlisted skill, unsupported metric, false premise, personal life, or comparison to another applicant receives a candid limit or refusal. The assistant does not fill gaps with plausible-sounding claims.
4. A `learning` or `notYet` entry never becomes a claim of shipped expertise.
5. The eventual adversarial test set has at least ten questions, includes the categories in the [project sheet](https://github.com/kousen/ai-integration-course/blob/main/assignments/portfolio.md), and records both models' answers and failures.
6. The deployed site and chat work with keyboard navigation and on a narrow screen; the existing homepage design stays intact.

## Failure handling

Invalid or oversized questions receive a clear input error. If the model key is missing, the provider times out, a rate limit is reached, or the answer cannot be grounded in the profile, the service returns a plain explanation and no invented answer. The public page never exposes the model key or a private profile draft.

## Cost estimate

Design estimate: at most 2,000 input tokens and 250 output tokens per question. At the published October 2026 list prices of $0.20/$1.20 per million input/output tokens for `gpt-5.6-luna`, 1,000 questions would cost about **$0.70** in model tokens. The same traffic at $4/$20 for `gpt-5.6-sol` would cost about **$13**. Hosting, retries, and future price changes are separate. Start with a small monthly usage cap and recheck [provider pricing](https://platform.openai.com/pricing) before deployment.

## Out of scope for this milestone

No chatbot code, API credentials, new homepage controls, visual redesign, or unreviewed biographical claims are part of the `intent-spec` tag. The repository already had a website before these artifacts; this spec does not pretend the prior code was written after the intent.
