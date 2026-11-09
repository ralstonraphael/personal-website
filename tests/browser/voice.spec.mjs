import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const CLIP = fileURLToPath(new URL('../../voice/clips/clip-02.wav', import.meta.url));
const MP3 = Buffer.alloc(3000, 0xff).toString('base64');

test('an uploaded clip is sent as audio to /api/voice; the transcript, answer and player appear', async ({ page }) => {
  const API = 'http://127.0.0.1:4173/api/ask';
  const sent = [];
  await page.route('http://127.0.0.1:4173/api/voice', (r) => {
    sent.push({ type: r.request().headers()['content-type'], size: r.request().postDataBuffer()?.length });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      transcript: 'Have you ever deployed anything with Kubernetes?', answer: "That isn't in his profile.",
      evidence: [], refused: true, audio_b64: MP3, audio_type: 'audio/mpeg' }) });
  });
  await page.goto(`/ask/?api=${API}`);
  await page.setInputFiles('#clip', CLIP);
  await expect(page.locator('#heard')).toContainText('Heard: “Have you ever deployed anything with Kubernetes?”');
  await expect(page.locator('#answer')).toContainText("That isn't in his profile.");
  await expect(page.locator('#player')).toBeVisible();
  expect(sent).toEqual([{ type: 'audio/wav', size: 387020 }]);
});

test('an empty transcript says so instead of answering', async ({ page }) => {
  await page.route('http://127.0.0.1:4173/api/voice', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ error: 'empty_transcript', transcript: '', answer: "I didn't catch that.", audio_b64: null }) }));
  await page.goto('/ask/?api=http://127.0.0.1:4173/api/ask');
  await page.setInputFiles('#clip', CLIP);
  await expect(page.locator('#answer')).toContainText("I didn't catch that.");
  await expect(page.locator('#player')).toBeHidden();
});

// The real loop, billed (three calls, about half a cent). Run by hand with the voice dev server up:
//   OPENROUTER_API_KEY=... ALLOWED_ORIGINS=http://127.0.0.1:4174 node scripts/voice-dev-server.mjs &
//   VOICE_LIVE=1 npx playwright test tests/browser/voice.spec.mjs -g "real turn"
test('real turn: upload, spoken answer, and the browser never saw the key or the provider', async ({ page }) => {
  test.skip(!process.env.VOICE_LIVE, 'VOICE_LIVE not set: the billed browser check is skipped');
  test.setTimeout(60_000);
  const BASE = 'http://127.0.0.1:4174';
  const urls = [];
  const bodies = [];
  page.on('request', (r) => urls.push(r.url()));
  page.on('response', async (r) => { try { bodies.push(await r.text()); } catch {} });
  await page.goto(`${BASE}/ask/?api=${BASE}/api/ask`);
  await page.setInputFiles('#clip', CLIP);
  await expect(page.locator('#heard')).toContainText('Kubernetes', { timeout: 45_000 });
  await expect(page.locator('#player')).toBeVisible();                                    // 1. the answer was spoken
  expect(urls.some((u) => /openrouter/i.test(u))).toBe(false);                             // 2. no request to the provider
  const key = process.env.OPENROUTER_API_KEY;
  expect(!key || bodies.every((b) => !b.includes(key))).toBe(true);                        // 3. the key never reached the page
});
