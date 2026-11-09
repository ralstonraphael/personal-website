# Working rules

- Tests first: a red commit, then the green one. CI (`npm test`, `npm run validate`, the browser job) stays green.
- The chatbot answers only from the approved slice of `profile.json`; held claims in `pendingClaims` are never said.
- Week 7: the spoken interface lives in voice/. Stages assigned: intent, spec,
  plan, tests. Commit to main.
- Transcription and speech calls are billed. One transcription per clip, one
  speech call per answer, never a model call inside a loop of tests. Fixture
  clips are WAV; expected.json is written by a person before the model hears it.
- The spoken answer is the chatbot's answer: the refuse-to-fabricate rule
  applies to what is said aloud exactly as to what is typed.
