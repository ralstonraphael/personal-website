// The /ask/ page: send one question to the API, show the answer as text and the
// evidence as chips. The API URL comes from ?api= (local testing) or <meta name="ask-api">.
const EMAIL = 'ralstone2005@gmail.com';
const FIXED = { identity: 'Profile', notYet: 'Not yet list', learningGoals: 'Learning goals' };

const form = document.getElementById('ask-form');
const box = document.getElementById('question');
const button = document.getElementById('ask-btn');
const count = document.getElementById('count');
const out = document.getElementById('answer');

const api =
  new URLSearchParams(location.search).get('api') ||
  document.querySelector('meta[name="ask-api"]')?.content.trim() ||
  '';

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
    if (res.ok && typeof body.answer === 'string') await show(body);
    else if (typeof body.answer === 'string' && body.answer) await show({ answer: body.answer });
    else unavailable();
  } catch {
    unavailable();
  } finally {
    pending = false;
    button.disabled = false;
    button.textContent = 'Ask';
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
