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
    answer: 'Yes. He built a scraper that pulls stone prices.',
    evidence: ['stone-scraper', 'ramp', 'identity', 'notYet', 'learningGoals', 'mystery-id'],
    refused: false,
  })));
  await page.goto(PAGE);
  await ask(page, 'Has he built anything with RAG?');
  const answer = page.locator('#answer');
  await expect(answer).toContainText('Yes. He built a scraper that pulls stone prices.');
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

test('a 502 shows the fallback answer from the body', async ({ page }) => {
  await page.route(API, (r) => r.fulfill({
    status: 502, contentType: 'application/json',
    body: JSON.stringify({ error: 'upstream', answer: 'Something broke upstream. Try again in a minute.' }),
  }));
  await page.goto(PAGE);
  await ask(page, 'hello');
  await expect(page.locator('#answer')).toContainText('Something broke upstream. Try again in a minute.');
});

test('a non-2xx without an answer shows the unavailable message', async ({ page }) => {
  await page.route(API, (r) => r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'rate' }) }));
  await page.goto(PAGE);
  await ask(page, 'hello');
  await expect(page.locator('#answer')).toContainText("The chat is unavailable right now. Email Ralston at");
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
