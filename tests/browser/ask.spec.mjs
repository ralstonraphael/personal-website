import { test, expect } from '@playwright/test';

const API = 'http://127.0.0.1:4173/api/ask';
const PAGE = `/ask/?api=${API}`;
const EMAIL = 'ralstone2005@gmail.com';

const ok = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function ask(page, text) {
  await page.getByLabel('Your question').fill(text);
  await page.getByRole('button', { name: 'Ask' }).click();
}

test('answer and evidence chips render with profile names', async ({ page }, info) => {
  await page.route(API, (r) => r.fulfill(ok({
    answer: 'Stone Scraper turns web pages into structured data with local models.',
    evidence: ['stone-scraper', 'ramp', 'identity', 'notYet', 'learningGoals', 'mystery-id'],
    refused: false,
  })));
  await page.goto(PAGE);
  await ask(page, 'Has he built anything with RAG?');
  const answer = page.locator('#answer');
  await expect(answer).toContainText('Stone Scraper turns web pages into structured data with local models.');
  for (const name of ['Stone Scraper', 'Ramp', 'Profile', 'Not yet list', 'Learning goals', 'mystery-id']) {
    await expect(answer.locator('.chip', { hasText: name })).toHaveCount(1);
  }
  await expect(answer.getByText('Not in his profile')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/ask-desktop.png', fullPage: true });
});

test('answer is plain text, never HTML', async ({ page }) => {
  await page.route(API, (r) => r.fulfill(ok({ answer: '<img src=x onerror="window.__pwned=1"> <b>hi</b>', evidence: [], refused: false })));
  await page.goto(PAGE);
  await ask(page, 'x');
  await expect(page.locator('#answer')).toContainText('<b>hi</b>');
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

test('refused answer shows the tag', async ({ page }) => {
  await page.route(API, (r) => r.fulfill(ok({ answer: "That isn't in his profile.", evidence: [], refused: true })));
  await page.goto(PAGE);
  await ask(page, 'What is his salary?');
  await expect(page.locator('#answer')).toContainText("That isn't in his profile.");
  await expect(page.locator('#answer').getByText('Not in his profile')).toBeVisible();
});

const FALLBACK = "I can't answer that right now. Try again in a minute.";
const fail = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const MESSAGES = [
  [429, { error: 'rate_limited' }, 'Too many questions just now. Try again in a minute.'],
  [400, { error: 'bad_question' }, 'Questions need to be between 1 and 500 characters.'],
  [403, { error: 'origin_not_allowed' }, "This page can't reach the chat from here."],
];
for (const [status, body, text] of MESSAGES) {
  test(`${body.error} shows its own message, no tag`, async ({ page }) => {
    await page.route(API, (r) => r.fulfill(fail(status, body)));
    await page.goto(PAGE);
    await ask(page, 'hello');
    await expect(page.locator('#answer')).toContainText(text);
    await expect(page.locator('#answer').getByText('Not in his profile')).toHaveCount(0);
  });
}

const FALLBACKS = [
  [200, 'invalid_reply'], [200, 'ungrounded_number'], [200, 'held_claim'],
  [502, 'provider_error'], [503, 'not_configured'], [504, 'timeout'],
];
for (const [status, error] of FALLBACKS) {
  test(`${error} (${status}) shows the API fallback with no tag`, async ({ page }) => {
    await page.route(API, (r) => r.fulfill(fail(status, { error, answer: FALLBACK, evidence: [], refused: true })));
    await page.goto(PAGE);
    await ask(page, 'hello');
    await expect(page.locator('#answer')).toContainText(FALLBACK);
    await expect(page.locator('#answer').getByText('Not in his profile')).toHaveCount(0);
  });
}

test('an error body is checked before a refused flag or evidence is shown', async ({ page }) => {
  await page.route(API, (r) => r.fulfill(fail(429, { error: 'rate_limited', answer: 'sneaky', evidence: ['ramp'], refused: true })));
  await page.goto(PAGE);
  await ask(page, 'hello');
  await expect(page.locator('#answer')).toContainText('Too many questions just now.');
  await expect(page.locator('#answer')).not.toContainText('sneaky');
  await expect(page.locator('#answer .chip')).toHaveCount(0);
});

test('a non-2xx without an answer or known error shows the unavailable message', async ({ page }) => {
  await page.route(API, (r) => r.fulfill({ status: 500, contentType: 'text/html', body: 'oops' }));
  await page.goto(PAGE);
  await ask(page, 'hello');
  await expect(page.locator('#answer')).toContainText('The chat is unavailable right now. Email Ralston at');
});

test('focus returns to the textarea after an answer and after an error', async ({ page }) => {
  let n = 0;
  await page.route(API, (r) => (n++ === 0
    ? r.fulfill(ok({ answer: 'Fine.', evidence: [], refused: false }))
    : r.fulfill(fail(429, { error: 'rate_limited' }))));
  await page.goto(PAGE);
  const box = page.getByLabel('Your question');
  await box.fill('first');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.locator('#answer')).toContainText('Fine.');
  await expect(box).toBeFocused();
  await box.fill('second');
  await box.press('Enter');
  await expect(page.locator('#answer')).toContainText('Too many questions');
  await expect(box).toBeFocused();
});

test('apiUrlFor honours ?api= only on local hosts', async ({ page }) => {
  await page.goto(PAGE);
  const r = await page.evaluate(async () => {
    const { apiUrlFor } = await import('/ask/ask.js');
    const q = '?api=https://evil.example/api/ask';
    return [
      apiUrlFor({ hostname: 'localhost', search: q }, 'https://meta.example/ask'),
      apiUrlFor({ hostname: '127.0.0.1', search: q }, ''),
      apiUrlFor({ hostname: 'ralstonraphael.github.io', search: q }, ' https://meta.example/ask '),
      apiUrlFor({ hostname: 'ralstonraphael.github.io', search: q }, ''),
      apiUrlFor({ hostname: 'localhost', search: '' }, ''),
      apiUrlFor({ hostname: 'localhost', search: '' }, 'https://meta.example/ask'),
    ];
  });
  expect(r).toEqual([
    'https://evil.example/api/ask',
    'https://evil.example/api/ask',
    'https://meta.example/ask',
    '',
    '',
    'https://meta.example/ask',
  ]);
});

test('a network failure shows the unavailable message with the email', async ({ page }) => {
  await page.route(API, (r) => r.abort('failed'));
  await page.goto(PAGE);
  await ask(page, 'hello');
  const answer = page.locator('#answer');
  await expect(answer).toContainText('The chat is unavailable right now. Email Ralston at');
  await expect(answer).toContainText(EMAIL);
});

test('button is disabled while pending and a double submit sends one request', async ({ page }) => {
  let hits = 0;
  let release;
  const gate = new Promise((res) => { release = res; });
  await page.route(API, async (r) => {
    hits += 1;
    await gate;
    await r.fulfill(ok({ answer: 'Done.', evidence: [], refused: false }));
  });
  await page.goto(PAGE);
  const button = page.getByRole('button', { name: /Ask|Thinking/ });
  const box = page.getByLabel('Your question');
  await box.fill('one question');
  await box.press('Enter');
  await box.press('Enter');
  await expect(button).toBeDisabled();
  await expect(button).toHaveText('Thinking…');
  await button.click({ force: true });
  release();
  await expect(page.locator('#answer')).toContainText('Done.');
  await expect(button).toBeEnabled();
  expect(hits).toBe(1);
});

test('empty input sends nothing', async ({ page }) => {
  let hits = 0;
  await page.route(API, (r) => { hits += 1; return r.fulfill(ok({ answer: 'x', evidence: [], refused: false })); });
  await page.goto(PAGE);
  await page.getByRole('button', { name: 'Ask' }).click();
  await page.getByLabel('Your question').fill('   ');
  await page.getByLabel('Your question').press('Enter');
  await page.waitForTimeout(150);
  expect(hits).toBe(0);
});

test('Enter submits and Shift+Enter is a newline', async ({ page }) => {
  let body;
  let hits = 0;
  await page.route(API, (r) => {
    hits += 1;
    body = r.request().postDataJSON();
    return r.fulfill(ok({ answer: 'ok', evidence: [], refused: false }));
  });
  await page.goto(PAGE);
  const box = page.getByLabel('Your question');
  await box.fill('line one');
  await box.press('Shift+Enter');
  await box.type('line two');
  await page.waitForTimeout(150);
  expect(hits).toBe(0);
  expect(await box.inputValue()).toBe('line one\nline two');
  await box.press('Enter');
  await expect(page.locator('#answer')).toContainText('ok');
  expect(hits).toBe(1);
  expect(body).toEqual({ question: 'line one\nline two' });
});

test('character counter tracks the input', async ({ page }) => {
  await page.goto(PAGE);
  await page.getByLabel('Your question').fill('12345');
  await expect(page.locator('#count')).toContainText('5 / 500');
});

test('no API URL shows the disconnected message and disables Ask', async ({ page }) => {
  await page.goto('/ask/');
  await expect(page.getByRole('button', { name: 'Ask' })).toBeDisabled();
  await expect(page.locator('#answer')).toContainText("The chat isn't connected yet. Email Ralston at");
  await expect(page.locator('#answer')).toContainText(EMAIL);
});

test('375px wide has no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route(API, (r) => r.fulfill(ok({
    answer: 'A fairly long answer that should wrap cleanly on a phone, with a veryveryveryveryveryveryveryverylongunbrokenwordtotestwrapping included.',
    evidence: ['stone-scraper', 'flash-report-ai', 'diagram-check', 'receipt-reader', 'datagrid', 'learningGoals'],
    refused: true,
  })));
  await page.goto(PAGE);
  await ask(page, 'Tell me about everything.');
  await expect(page.locator('#answer')).toContainText('A fairly long answer');
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw).toBeLessThanOrEqual(iw);
  await page.screenshot({ path: 'test-results/ask-mobile.png', fullPage: true });
});

test('the homepage still loads and is unchanged', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Ralston Raphael | Founding FDE @ Gumloop');
});
