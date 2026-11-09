import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { approvedSlice } from "../lib/profile.mjs";
import { voiceCore, spokenText, FORMATS } from "../api/voice.ts";

const slice = approvedSlice(JSON.parse(readFileSync(new URL("../profile.json", import.meta.url), "utf8")));
const realId = slice.projects[0].id;
const FALLBACK = "I can't answer that reliably right now. You can email Ralston at ralstone2005@gmail.com.";
const KEY = "sk-test-secret";
const AUDIO = new Uint8Array(4000).fill(7);
const MP3 = new Uint8Array(3000).fill(0xff);

let ipCounter = 0;
const freshIp = () => `10.9.0.${++ipCounter}`;

const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
const heard = (text) => json({ text, usage: { seconds: 4.2, cost: 0.000014 } });
const answered = (o) =>
  json({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { prompt_tokens: 1200, completion_tokens: 60, cost: 0.0004 } });
const spoken = () => new Response(MP3, { status: 200, headers: { "Content-Type": "audio/mpeg", "X-Generation-Id": "gen-1" } });

// Routes each provider URL to a handler and records every call with its parsed body.
function provider({ stt = () => heard("What did Ralston build?"), chat = () => answered({ answer: "He built this site.", evidence: [realId], refused: false }), tts = spoken } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    const kind = url.endsWith("/audio/transcriptions") ? "stt" : url.endsWith("/chat/completions") ? "chat" : url.endsWith("/audio/speech") ? "tts" : "other";
    calls.push({ kind, url, body: init?.body ? JSON.parse(init.body) : undefined });
    return { stt, chat, tts }[kind]?.() ?? new Response("no", { status: 404 });
  };
  fn.calls = calls;
  fn.kinds = () => calls.map((c) => c.kind);
  return fn;
}
const turn = ({ fetch = provider(), contentType = "audio/webm", audio = AUDIO, env = { OPENROUTER_API_KEY: KEY }, origin } = {}) =>
  voiceCore({ audio, contentType, origin, ip: freshIp() }, { fetch, env });

// --- spec behavior 1: the empty transcript ----------------------------------

test("an empty transcript is a failed transcript: no chat call, no speech call, no crash", async () => {
  for (const text of ["", "   ", null]) {
    const fetch = provider({ stt: () => heard(text) });
    const r = await turn({ fetch });
    assert.equal(r.status, 200);
    assert.equal(r.body.error, "empty_transcript");
    assert.equal(r.body.transcript, "");
    assert.equal(r.body.answer, "I didn't catch that.");
    assert.equal(r.body.audio_b64, null);
    assert.deepEqual(fetch.kinds(), ["stt"]);
  }
});

// --- spec behavior 2: a speech reply that is not audio ----------------------

test("a non-audio speech reply is an error, never returned as audio; transcript and answer still come back", async () => {
  const fetch = provider({ tts: () => json({ error: { message: "voice not found" } }) });
  const r = await turn({ fetch });
  assert.equal(r.status, 200);
  assert.equal(r.body.audio_b64, null);
  assert.equal(r.body.tts_error, "speech_not_audio");
  assert.equal(r.body.transcript, "What did Ralston build?");
  assert.equal(r.body.answer, "He built this site.");
});

test("a failed speech call (HTTP error) is reported the same way", async () => {
  const fetch = provider({ tts: () => new Response("busy", { status: 503, headers: { "Content-Type": "text/plain" } }) });
  const r = await turn({ fetch });
  assert.equal(r.body.audio_b64, null);
  assert.equal(r.body.tts_error, "speech_failed");
});

// --- spec behavior 5: at most three sentences, no markdown -------------------

test("spokenText keeps at most three sentences and strips markdown, list markers and URLs", () => {
  const md = "**Yes.** He built [this site](https://ralstonraphael.github.io/personal-website/).\n- One `RAG` index.\n- A chatbot. See https://example.com for more. A fifth one.";
  const s = spokenText(md);
  assert.equal(s, "Yes. He built this site. One RAG index.");
  assert.doesNotMatch(s, /[*_`#\[\]]|https?:/);
});

test("spokenText keeps a short answer whole and does not split on decimals", () => {
  assert.equal(spokenText("It cost $0.05 per turn. That is all."), "It cost $0.05 per turn. That is all.");
});

test("spokenText reads an email address as words, so the speech model doesn't mangle 2005", () => {
  const s = spokenText("For clarification, email him at ralstone2005@gmail.com.");
  assert.equal(s, "For clarification, email him at ralstone 2005 at gmail dot com.");
  assert.equal(spokenText("Write to first.last99@my-school.edu today."), "Write to first dot last 99 at my-school dot edu today.");
});

test("the speech call speaks the trimmed answer, not the raw one", async () => {
  const long = "First. Second. Third. Fourth.";
  const fetch = provider({ chat: () => answered({ answer: long, evidence: [realId], refused: false }) });
  const r = await turn({ fetch });
  const tts = fetch.calls.find((c) => c.kind === "tts");
  assert.equal(tts.body.input, "First. Second. Third.");
  assert.equal(r.body.spoken, "First. Second. Third.");
  assert.equal(r.body.answer, long);                       // the page still shows the whole text answer
  assert.equal(tts.body.model, "microsoft/mai-voice-2.1-flash");
  assert.equal(tts.body.voice, "en-US-Harper:MAI-Voice-2.1-Flash");
});

// --- spec behavior 6: same answer function as the typed path -----------------

test("the voice path goes through askCore: the answer guard replaces an ungrounded number with the fallback", async () => {
  const fetch = provider({ chat: () => answered({ answer: "He managed 98765 laptops.", evidence: [realId], refused: false }) });
  const r = await turn({ fetch });
  assert.equal(r.body.answer, FALLBACK);
  assert.equal(fetch.calls.find((c) => c.kind === "tts").body.input, spokenText(FALLBACK));
  const chat = fetch.calls.find((c) => c.kind === "chat");
  assert.equal(chat.body.messages.at(-1).content, "What did Ralston build?");
});

test("a turn records the three costs, the transcription model and the audio seconds", async () => {
  const fetch = provider();
  const r = await turn({ fetch });
  assert.deepEqual(fetch.kinds(), ["stt", "chat", "tts"]);
  const stt = fetch.calls[0].body;
  assert.equal(stt.model, "openai/whisper-large-v3-turbo");
  assert.equal(stt.input_audio.format, "webm");
  assert.equal(stt.input_audio.data, Buffer.from(AUDIO).toString("base64"));
  assert.equal(r.body.cost.stt, 0.000014);
  assert.equal(r.body.cost.chat, 0.0004);
  assert.equal(r.body.cost.tts, +(0.000015 * r.body.spoken.length).toFixed(6));
  assert.equal(r.body.cost.tts_is_estimate, true);
  assert.equal(r.body.audio_seconds, 4.2);
  assert.equal(Buffer.from(r.body.audio_b64, "base64").length, MP3.length);
  assert.equal(r.body.audio_type, "audio/mpeg");
});

// --- spec behavior 7: the key stays on the server ---------------------------

test("the response never contains the key or the provider", async () => {
  for (const fetch of [provider(), provider({ tts: () => json({ error: KEY }) }), provider({ stt: () => { throw new Error(`boom ${KEY}`); } })]) {
    const r = await turn({ fetch });
    const text = JSON.stringify(r.body);
    assert.doesNotMatch(text, new RegExp(KEY));
    assert.doesNotMatch(text, /openrouter/i);
  }
});

test("a transcription failure returns 502 provider_error and makes no other call", async () => {
  const fetch = provider({ stt: () => new Response("bad", { status: 400 }) });
  const r = await turn({ fetch });
  assert.equal(r.status, 502);
  assert.equal(r.body.error, "provider_error");
  assert.deepEqual(fetch.kinds(), ["stt"]);
});

// --- spec behavior 8 and config: refused before any model call ---------------

test("an unsupported audio type gets 415 before any call", async () => {
  const fetch = provider();
  const r = await turn({ fetch, contentType: "text/plain" });
  assert.equal(r.status, 415);
  assert.equal(r.body.error, "unsupported_audio");
  assert.equal(fetch.calls.length, 0);
});

test("the recorder's and upload content types map to formats", () => {
  assert.equal(FORMATS["audio/webm"], "webm");
  assert.equal(FORMATS["audio/mp4"], "m4a");
  assert.equal(FORMATS["audio/wav"], "wav");
  assert.equal(FORMATS["audio/mpeg"], "mp3");
});

test("a recording over 10 MB or an empty body is refused before any call", async () => {
  for (const [audio, status] of [[new Uint8Array(10_000_001), 413], [new Uint8Array(0), 400]]) {
    const fetch = provider();
    const r = await turn({ fetch, audio });
    assert.equal(r.status, status);
    assert.equal(fetch.calls.length, 0);
  }
});

test("a missing key returns 503 not_configured and never calls fetch", async () => {
  const fetch = provider();
  const r = await turn({ fetch, env: {} });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "not_configured");
  assert.equal(fetch.calls.length, 0);
});

test("a disallowed origin gets 403 before any call", async () => {
  const fetch = provider();
  const r = await turn({ fetch, origin: "https://evil.example" });
  assert.equal(r.status, 403);
  assert.equal(fetch.calls.length, 0);
});
