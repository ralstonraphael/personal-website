# Week 7 checks: spoken interface

Run November 9, 2026, on the OpenRouter key from Team Project 1 (`.env`, never committed). Everything billed on this page together cost **under $0.02**.

**Not done at this tag: my own two clips.** `clips/expected.json` already holds what I will say in `my-clip-a.wav` and `my-clip-b.wav`, written before any recording existed. The recordings, their transcripts on both models, and the "which model got my name right" row are added in a follow-up commit. Every row marked *pending* below is waiting on those clips.

## Transcription, per clip per model

Word error rate from `check.py` against the text in `clips/expected.json`; tolerance 0.15 unless the clip states its own. Audio seconds and cost come from the reply's `usage`; seconds = wall clock for the call.

| Clip | Model | WER | Missing words | Audio s | Cost | Call s | Verdict |
|---|---|---|---|---|---|---|---|
| clip-01 (fixture) | whisper-large-v3-turbo | 0.0 | none | 6.38 | $0.000021 | 0.9 | ok |
| clip-01 (fixture) | scribe-v2 | 0.0 | none | 6.38 | $0.000390 | 0.6 | ok |
| clip-02 (fixture) | whisper-large-v3-turbo | 0.188 | none | 8.06 | $0.000027 | 0.5 | ok (clip tolerance 0.2) |
| clip-02 (fixture) | scribe-v2 | 0.0 | none | 8.06 | $0.000493 | 0.9 | ok |
| clip-03 (fixture) | whisper-large-v3-turbo | 0.0 | none | 7.71 | $0.000026 | 0.9 | ok |
| clip-03 (fixture) | scribe-v2 | 0.0 | none | 7.71 | $0.000471 | 0.8 | ok |
| my-clip-a | whisper-large-v3-turbo | *pending* | | | | | |
| my-clip-a | scribe-v2 | *pending* | | | | | |
| my-clip-b | whisper-large-v3-turbo | *pending* | | | | | |
| my-clip-b | scribe-v2 | *pending* | | | | | |

Transcripts: `transcripts-whisper.json`, `transcripts-scribe.json`.

What the fixtures showed: Whisper reproduced the course rehearsal exactly on clip-02. It split "bootcamp" into "boot camp" and added "Music" to the trailing silence (3 edits in 16 words). That "Music" then went into the chatbot as part of the question in the real turn below. Scribe read all three fixtures exactly, at about 18 times Whisper's price per clip. Both kept "CPSC 415".

**Which model got my name right:** *pending* (my-clip-a and my-clip-b). **What I heard myself:** *pending*: I will listen to both clips and both spoken answers and note anything the checker cannot see.

## Spoken answers

Both speak the same answer: the chatbot's real reply to the Kubernetes fixture question (the `spoken` field of `turn-kubernetes.json`). The cost is estimated as catalog price ($0.000015 per character, checked November 9) times characters, because the speech reply has no usage object.

| File | Model / voice | Characters | Bytes | Est. cost | Call s |
|---|---|---|---|---|---|
| `answers/answer-harper.mp3` | mai-voice-2.1-flash / en-US-Harper | 215 | 307,200 | $0.003225 | 1.4 |
| `answers/answer-jasper.mp3` | mai-voice-2.1-flash / en-US-Jasper | 215 | 281,760 | $0.003225 | 1.3 |

What they did with my name and the course number: the answer says "Ralston's profile documents no Kubernetes work". It names me and refuses the comparison, which matches the typed path's rules. That question has no course number in it. How each voice pronounces "Ralston" and the email address is *pending* until I listen. A second answer to my-clip-a ("What did you build for CPSC 415") will test the course number once that clip exists.

## Language experiment

Not done. The intent keeps the interface English only.

## Linter

`ruff check voice` (with `voice/ruff.toml` setting `src = ["."]`): all checks passed. Run from the repo root without that file, ruff flagged I001 in `transcribe.py`, because it treated `check` as a third-party import. The config fixes that, and CI runs the same command.

## Tests

- No key: `node --test` passes 106 tests (15 of them for `/api/voice`: empty transcript, non-audio reply, HTTP speech failure, three sentences without markdown, the trimmed text is what gets spoken, the answer guard through `askCore`, the three costs, key and provider never in the response, 502, 415, 10 MB and empty body, 503, 403). `pytest voice/tests` passes the 8 checker tests and skips the billed ones without a key.
- Browser (`npx playwright test`): 26 passed, plus 1 skipped without a key. That includes the two mocked voice checks: an uploaded clip goes to `/api/voice` as `audio/wav`, and an empty transcript says so.
- **Browser check, real turn** (`VOICE_LIVE=1`, against `scripts/voice-dev-server.mjs`): passed in 8.1 s. The last three assertions passed: (1) the player appeared with the spoken answer, (2) the page made no request to the provider, (3) no response the page received contained the key.

## One turn

`clip-02.wav` POSTed to `/api/voice` on the local voice server (`turn-kubernetes.json`, audio removed):

| Step | Model | Cost | Seconds |
|---|---|---|---|
| Transcription | openai/whisper-large-v3-turbo | $0.0000268 | 1.6 |
| Answer (`askCore`) | openai/gpt-5.6-luna | $0.0012334 | 3.4 |
| Speech | microsoft/mai-voice-2.1-flash / Harper | $0.003225 (estimated) | 0.9 |
| **Total** | | **$0.004485** | 5.9 |

Speech is 72% of the turn and transcription under 1%. So 1,000 voice turns would cost about $4.50, against about $1.20 for the same questions typed. That per-turn number goes into the hosting decision.
