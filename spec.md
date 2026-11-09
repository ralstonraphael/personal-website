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
- **Language:** TypeScript in a Vercel serverless function (`api/ask.ts`) plus minimal browser JavaScript on the separate page. **Why:** It shares the site's JavaScript ecosystem and keeps the model key server-side. The homepage and `/ask/` page stay on GitHub Pages, and the function allows only that origin. Alternatives: Python/FastAPI would need a separately managed server; moving the whole site to Cloudflare Pages Functions, as the reference site does, would change the existing deployment. *(Host chosen October 26, approved by Ralston.)*
- **Model:** Candidate default `openai/gpt-5.6-luna`; comparator `openai/gpt-5.6-sol`, both called through **OpenRouter** with a separate, monthly-capped portfolio key. *(Provider changed from OpenAI direct on October 26, approved by Ralston: same models at the same list prices on OpenRouter's model list, and no second account.)* **Why:** The lower-cost model may be enough for a small, well-scoped profile; the stronger model is a check on refusal and grounding quality. Run both on the same ten-plus adversarial questions before final selection. This comparison is planned, not claimed as already completed. [Current model list](https://openrouter.ai/models).
- **Interfaces:** Proposed `POST /api/ask` accepting a short question and returning an answer, evidence IDs, and a refusal flag. The API loads a fixed, reviewed profile version; visitors cannot modify it.
- **Dependencies:** Vercel (function + environment-variable secret store), an OpenRouter key, origin restriction to `https://ralstonraphael.github.io`, input length and request-rate limits.

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

Design estimate: at most 2,000 input tokens and 250 output tokens per question. At the published October 2026 list prices of $0.20/$1.20 per million input/output tokens for `gpt-5.6-luna`, 1,000 questions would cost about **$0.70** in model tokens. The same traffic at $4/$20 for `gpt-5.6-sol` would cost about **$13**. Hosting, retries, and future price changes are separate. Start with a small monthly usage cap and recheck [OpenRouter's model list](https://openrouter.ai/models) for prices before deployment.

## Out of scope for this milestone

No chatbot code, API credentials, new homepage controls, visual redesign, or unreviewed biographical claims are part of the `intent-spec` tag. The repository already had a website before these artifacts; this spec does not pretend the prior code was written after the intent.

## Week 7: spoken interface

Intent: `intent/voice.md`. Two components, both called from the server only.

### Transcriber

- **What it does:** Turns a visitor's recording into the question text, and records the text, the audio seconds, and the cost from the reply for each clip.
- **Language:** Python 3 with the `openrouter` SDK for the eval tools in `voice/` (`voice/transcribe.py`, the checker, the tests). **Why:** it is the course's example path, the SDK carries both audio endpoints, and the checker is reused rather than rewritten. The live route is TypeScript in `api/voice.ts` with plain `fetch`, next to `api/ask.ts`, because the server is a Vercel Node function and must call the same `askCore` answer function as the typed path. Both send the same request shape to `POST /api/v1/audio/transcriptions`.
- **Model:** default `openai/whisper-large-v3-turbo` (priced per audio second, cheapest serious transcriber); comparison `elevenlabs/scribe-v2` (about 18x the price; read every course fixture correctly). Both run on every clip in the eval.

### Speaker

- **What it does:** Speaks the chatbot's answer, and records characters, bytes, and the estimated cost (the reply is audio bytes with no usage object, so cost = catalog price x characters, marked estimated).
- **Language:** same split as the transcriber: `voice/speak.py` for the eval, `fetch` in `api/voice.ts` for the route, both to `POST /api/v1/audio/speech`.
- **Model:** default `microsoft/mai-voice-2.1-flash` with voice `en-US-Harper:MAI-Voice-2.1-Flash`; comparison: the same model with voice `en-US-Jasper:MAI-Voice-2.1-Flash`. **Why:** priced per character, under a second per call in the course rehearsal, and MP3 that transcribers read back correctly. A second voice, not a second model, keeps the comparison on what a visitor hears without tripling the speech cost.

### Dependencies

- `openrouter` (Python SDK, in `voice/requirements.txt`): the transcription and speech calls in the eval tools. **Why:** it wraps both audio endpoints and returns the usage object; no other audio library is needed.
- No new Node dependency: `api/voice.ts` uses the runtime's `fetch`.

### Behavior to verify (Week 7)

1. An empty or whitespace-only transcript is a failed transcript: the route returns "I didn't catch that." with no chat call and no speech call, and the checker reports `empty: true`, `ok: false`. Neither crashes.
2. A speech reply whose content type is not `audio/*` is an error. It is never saved to a file or returned as audio; the visitor still gets the transcript and the answer as text, plus the error.
3. The checker compares a transcript with text a person wrote before the model heard the clip, by word error rate, ignoring case, punctuation, and spacing. Default tolerance 0.15; a clip may state its own tolerance in `expected.json` with a note saying why.
4. Named words must survive: each clip's `must_contain` (my name, "CPSC 415", "Ramp", "Datagrid") must appear in the transcript, or the clip fails whatever its word error rate.
5. The spoken answer is at most three sentences, with markdown, list markers, and URLs removed in code before the speech call.
6. The voice path answers through `askCore`, the same function as the typed path, so the answer guard and held claims apply unchanged.
7. The key stays on the server: the route's response never contains the key or the provider's URL, and the browser sends only audio (`Content-Type: audio/*`).
8. Unsupported audio types get a 415, and recordings over 10 MB are refused before any model call.
