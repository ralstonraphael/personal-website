// The /ask/ page: send one question to the API, show the answer as text and the
// evidence as chips. The API URL comes from ?api= (local testing) or <meta name="ask-api">.
const EMAIL = 'ralstone2005@gmail.com';
const FIXED = { identity: 'Profile', notYet: 'Not yet list', learningGoals: 'Learning goals' };

const form = document.getElementById('ask-form');
const box = document.getElementById('question');
const button = document.getElementById('ask-btn');
const count = document.getElementById('count');
const out = document.getElementById('answer');

// ?api= works only on local hosts, so a link on the live site can't redirect questions elsewhere
export function apiUrlFor(loc, metaContent) {
  const local = loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
  const override = local ? new URLSearchParams(loc.search).get('api') : '';
  return override || (metaContent ?? '').trim();
}

const api = apiUrlFor(location, document.querySelector('meta[name="ask-api"]')?.content);

const MESSAGES = {
  rate_limited: 'Too many questions just now. Try again in a minute.',
  bad_question: 'Questions need to be between 1 and 500 characters.',
  origin_not_allowed: "This page can't reach the chat from here.",
};
const FALLBACK_ERRORS = new Set(['invalid_reply', 'ungrounded_number', 'held_claim', 'provider_error', 'not_configured', 'timeout']);

// plain message, no email link (the API said what went wrong)
function note(text) {
  out.replaceChildren();
  const p = document.createElement('p');
  p.className = 'ask-text';
  p.textContent = text;
  out.append(p);
}

// profile.json gives evidence ids their names; if it can't load, chips show the raw id
const names = fetch('../profile.json')
  .then((r) => (r.ok ? r.json() : {}))
  .then((p) => {
    const map = { ...FIXED };
    for (const x of p.projects ?? []) map[x.id] = x.name;
    for (const x of p.roles ?? []) map[x.id] = x.org;
    return map;
  })
  .catch(() => ({ ...FIXED }));

// message text followed by the email as a link
function say(text) {
  out.replaceChildren();
  const p = document.createElement('p');
  p.className = 'ask-text';
  p.append(text + ' ');
  const a = document.createElement('a');
  a.href = `mailto:${EMAIL}`;
  a.textContent = EMAIL;
  p.append(a, '.');
  out.append(p);
}
const unavailable = () => say('The chat is unavailable right now. Email Ralston at');

async function show({ answer, evidence = [], refused = false }) {
  const map = await names;
  out.replaceChildren();
  if (refused) {
    const tag = document.createElement('span');
    tag.className = 'ask-tag mono';
    tag.textContent = 'Not in his profile';
    out.append(tag);
  }
  const text = document.createElement('p');
  text.className = 'ask-text';
  text.textContent = answer;
  out.append(text);
  if (evidence.length) {
    const list = document.createElement('ul');
    list.className = 'ask-chips';
    list.setAttribute('aria-label', 'Where this came from');
    for (const id of evidence) {
      const li = document.createElement('li');
      li.className = 'chip mono';
      li.textContent = map[id] ?? id;
      list.append(li);
    }
    out.append(list);
  }
}

let pending = false;

async function submit() {
  const question = box.value.trim();
  if (pending || !question || !api) return;
  pending = true;
  button.disabled = true;
  button.textContent = 'Thinking…';
  try {
    const res = await fetch(api, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const body = await res.json().catch(() => ({}));
    const hasAnswer = typeof body.answer === 'string' && body.answer;
    if (MESSAGES[body.error]) note(MESSAGES[body.error]);
    else if (FALLBACK_ERRORS.has(body.error) && hasAnswer) await show({ answer: body.answer });
    else if (!body.error && res.ok && hasAnswer) await show(body);
    else if (hasAnswer) await show({ answer: body.answer });
    else unavailable();
  } catch {
    unavailable();
  } finally {
    pending = false;
    button.disabled = false;
    button.textContent = 'Ask';
    box.focus();
  }
}

form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
box.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
});
box.addEventListener('input', () => { count.textContent = `${box.value.length} / ${box.maxLength}`; });

if (!api) {
  button.disabled = true;
  say("The chat isn't connected yet. Email Ralston at");
}
