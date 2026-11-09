# Week 7 checks: spoken interface

Run November 9, 2026, on the OpenRouter key from Team Project 1 (`.env`, never committed). Everything billed on this page together cost **under $0.04**.

## My clips

I recorded both questions in one QuickTime take (25 s, `.m4a`). The text in `clips/expected.json` was written before the recording existed. ffmpeg's `silencedetect` (-35 dB, 0.4 s) found speech from 1.6 s to 16.0 s, and the longest pause (10.02–11.11 s) falls between the two sentences. I cut there at 10.56 s and converted each half to 16-bit mono WAV, so no MP3 header can mislead the transcriber:

- `clips/my-clip-a.wav`, 1.3–10.56 s (9.26 s): "Hi, my name is Ralston Raphael. What did you build for CPSC 415 this semester?"
- `clips/my-clip-b.wav`, 10.56–16.4 s (5.84 s): "How many laptops did Ralston manage at Ramp, and what did he automate at Datagrid?"

Each half came back as exactly one of the two sentences, which confirms the cut.

## Transcription, per clip per model

Word error rate from `check.py` against `clips/expected.json`; tolerance 0.15 unless the clip states its own. Audio seconds and cost come from the reply's `usage`; call s = wall clock for the call. This is the `--set` run of all five clips (`transcripts-whisper.json`, `transcripts-scribe.json`).

| Clip | Model | WER | Missing words | Audio s | Cost | Call s | Verdict |
|---|---|---|---|---|---|---|---|
| clip-01 (fixture) | whisper-large-v3-turbo | 0.0 | none | 6.38 | $0.000021 | 0.7 | ok |
| clip-01 (fixture) | scribe-v2 | 0.0 | none | 6.38 | $0.000390 | 0.8 | ok |
| clip-02 (fixture) | whisper-large-v3-turbo | 0.0 | none | 8.06 | $0.000027 | 1.1 | ok |
| clip-02 (fixture) | scribe-v2 | 0.125 | none | 8.06 | $0.000493 | 0.6 | ok (clip tolerance 0.2) |
| clip-03 (fixture) | whisper-large-v3-turbo | 0.0 | none | 7.71 | $0.000026 | 0.9 | ok |
| clip-03 (fixture) | scribe-v2 | 0.0 | none | 7.71 | $0.000471 | 0.8 | ok |
| **my-clip-a** | whisper-large-v3-turbo | 0.133 | none | 9.26 | $0.000031 | 2.1 | ok |
| **my-clip-a** | scribe-v2 | 0.133 | none | 9.26 | $0.000566 | 0.9 | ok |
| **my-clip-b** | whisper-large-v3-turbo | 0.0 | none | 5.84 | $0.000019 | 1.7 | ok |
| **my-clip-b** | scribe-v2 | 0.0 | none | 5.84 | $0.000357 | 1.4 | ok |

What the transcripts say:

- **my-clip-a:** both models heard "Hey, hi, my name is Ralston Raphael. What **do** you build for CPSC 415 this semester?" That is 2 edits in 15 words (an added "Hey" and "do" for "did"). Two different models agree on both edits, so I most likely said them: there is a short sound at 1.6–1.9 s, before the sentence starts. `expected.json` is left as written, because it is the answer key.
- **my-clip-b:** both exact. Whisper wrote "RAMP" and Scribe wrote "DataGrid"; the checker ignores case, so both count.
- **Which model got my name right:** both. "Ralston Raphael" survived on every run of both clips, on both models.
- **Not deterministic:** the same fixtures earlier today gave the opposite result on clip-02. Whisper split "boot camp" and added "Music" to the trailing silence (WER 0.188), and Scribe was exact. In this run Whisper was exact and Scribe split "boot camp". One run per clip is a sample, not a verdict.
- **The course number on a live turn:** when the voice route sent my-clip-a through Whisper in the real turn below, it came back "CPSC **for 15**". Run through the checker, that gives `{'ok': False, 'wer': 0.267, 'missing': ['CPSC 415']}`. The batch run of the same clip on the same model, a minute earlier, heard "CPSC 415". This is the failure the must-survive words exist for, and the word error rate alone (0.267) does not show that it is the number that broke. The chatbot still answered about CPSC 415, because the question made sense without the number. A transcript that broke "Ralston" would not.

**What I heard myself:** I played both clips and all four spoken answers back on November 9: they sound good, and I like them.

## Spoken answers

The cost is estimated as catalog price ($0.000015 per character, checked November 9) times characters, because the speech reply has no usage object.

| File | Answer to | Voice (mai-voice-2.1-flash) | Characters | Bytes | Est. cost | Call s |
|---|---|---|---|---|---|---|
| `answers/answer-cpsc415-harper.mp3` | my-clip-a | en-US-Harper | 295 | 382,560 | $0.004425 | 1.1 |
| `answers/answer-cpsc415-jasper.mp3` | my-clip-a | en-US-Jasper | 295 | 391,680 | $0.004425 | 1.6 |
| `answers/answer-harper.mp3` | clip-02 (Kubernetes) | en-US-Harper | 223 | 338,880 | $0.003345 | 1.4 |
| `answers/answer-jasper.mp3` | clip-02 (Kubernetes) | en-US-Jasper | 223 | 284,640 | $0.003345 | 1.2 |

What they did with my name and the course number:

- **CPSC 415 answer** (`turn-cpsc415.json`): "For CPSC 415, Ralston built two shipped projects: a team web app that generates labeled science diagrams and checks them with vision models against a handwritten checklist, and a command-line receipt reader…". It names me, says "CPSC 415" correctly even though the transcript said "for 15", and cites `diagram-check` and `receipt-reader`. It is one long sentence, so the three-sentence limit did not trim it. I listened to both voices on November 9 (see "What I heard myself" above).
- **Kubernetes answer** (`turn-kubernetes.json`): "Ralston's profile documents no Kubernetes work…". It names me and refuses the comparison with a boot-camp graduate. That question has no course number.
- **My email, read aloud (found by ear, fixed):** when I listened, both voices read `ralstone2005@gmail.com` as "ralstone twenty zero five". `spokenText` now rewrites an email address as words before the speech call ("ralstone 2005 at gmail dot com"), tests first (`tests/voice.test.mjs`). The page still shows the address as written. I re-spoke both Kubernetes answers (the table above has the new sizes; `turn-kubernetes.json` keeps the original turn) and transcribed them with scribe-v2 as an independent check: both came back as "email him at ralstone2005@gmail.com" exactly, $0.0019 for the two. This is a speech-side version of the transcript lesson: no code could have caught it without someone listening.

## Language experiment

Not done. The intent keeps the interface English only.

## Linter

`ruff check voice` (with `voice/ruff.toml` setting `src = ["."]`): all checks passed. Run from the repo root without that file, ruff flagged I001 in `transcribe.py`, because it treated `check` as a third-party import. The config fixes that, and CI runs the same command.

## Tests

- No key: `node --test` passes 106 tests (15 of them for `/api/voice`: empty transcript, non-audio reply, HTTP speech failure, three sentences without markdown, the trimmed text is what gets spoken, the answer guard through `askCore`, the three costs, key and provider never in the response, 502, 415, 10 MB and empty body, 503, 403). `pytest voice/tests` passes the 8 checker tests and skips the billed ones without a key.
- Browser (`npx playwright test`): 26 passed, plus 1 skipped without a key. That includes the two mocked voice checks: an uploaded clip goes to `/api/voice` as `audio/wav`, and an empty transcript says so.
- **Browser check, real turn** (`VOICE_LIVE=1`, against `scripts/voice-dev-server.mjs`): passed in 8.1 s. The last three assertions passed: (1) the player appeared with the spoken answer, (2) the page made no request to the provider, (3) no response the page received contained the key.

## One turn

Two real turns through `/api/voice` on the local voice server (audio removed from the saved JSON):

| Step | Model | clip-02 (`turn-kubernetes.json`) | my-clip-a (`turn-cpsc415.json`) |
|---|---|---|---|
| Transcription | openai/whisper-large-v3-turbo | $0.0000268, 1.6 s | $0.0000308, 2.7 s |
| Answer (`askCore`) | openai/gpt-5.6-luna | $0.0012334, 3.4 s | $0.0011651, 2.3 s |
| Speech | mai-voice-2.1-flash / Harper | $0.003225 (est.), 0.9 s | $0.004425 (est.), 1.1 s |
| **Total** | | **$0.004485**, 5.9 s | **$0.005621**, 6.2 s |

Speech is 72–79% of a turn and transcription under 1%. So 1,000 voice turns would cost about $4.50–$5.60, against about $1.20 for the same questions typed. Speech is priced per character, so a longer answer costs more: the cap on spoken length is also a cost control. That per-turn number goes into the hosting decision.
