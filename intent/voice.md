# Intent: a spoken interface for the portfolio chatbot

## Goal

A visitor to the `/ask/` page can ask the chatbot a question out loud and hear the answer. The server transcribes the recording, the chatbot answers from the approved profile exactly as it does for a typed question, and the answer is spoken back. The visitor also sees the transcript and the answer as text, so a wrong transcript or a failed speech call is visible instead of hidden.

## Who it is for

The same recruiters and collaborators as the typed chatbot (`intent/ai-profile.md`), on a phone or in a hurry, who would rather talk than type.

## Constraints

- The spoken answer is the chatbot's answer. The refuse-to-fabricate rules, the answer guard, and the held claims apply to what is said aloud exactly as to what is typed. The voice path calls the same answer function; it does not get its own prompt.
- The transcript is model output and may be wrong, most dangerously in names and numbers ("Ralston Raphael", "CPSC 415", "1,200 laptops"). The program checks transcripts against text a person wrote first, in code, and the visitor sees what was heard.
- An empty transcript is a failed transcript, not a crash and not a question sent to the chatbot.
- A reply from the speech endpoint that is not audio is an error and is never saved or played as audio.
- The spoken answer is at most three sentences with no markdown.
- The OpenRouter key stays on the server. The browser sends only audio and receives only text and audio.
- Every model call is billed. One voice turn's three costs (transcription, answer, speech) are measured and recorded, because that number belongs in the hosting decision.

## Not in scope

- A second language. The interface is English only for now.
- Streaming or live transcription. One recording, one turn.
- Deploying the voice route. It runs locally with the rest of the unreleased chatbot until the hosting decision.

## How success is checked

No-key tests for the checker and the voice route (empty transcript, non-audio reply, three-sentence limit, key never in the response). A billed eval that transcribes the three course fixture clips and two clips of my own voice on two transcription models, with word error rate and missing words per clip, and speaks two answers. A browser check that uploads a clip through the page and confirms the browser never saw the key or the provider. Results in `voice/CHECKS.md`.

**Approved by:** Ralston Raphael, November 9, 2026
