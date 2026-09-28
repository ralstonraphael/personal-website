import { $, $$, prefersReducedMotion, sound, toast, copyText, clamp } from './util.js';
import { initField } from './field.js';
import { scramble, bindScramble } from './scramble.js';
import { initHeatmap } from './heatmap.js';
import { initPalette } from './palette.js';
import { initPixels } from './pixels.js';

const EMAIL = 'ralstone2005@gmail.com';
const reduce = prefersReducedMotion();
const root = document.documentElement;
root.classList.add('js');

/* ---------- theme ---------- */
const repaints = [];
function setTheme(t, announce) {
  root.dataset.theme = t;
  try { localStorage.setItem('rr:theme', t); } catch {}
  $('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0c0c0b' : '#f6f5f1');
  requestAnimationFrame(() => repaints.forEach((fn) => fn()));
  if (announce) toast(t === 'dark' ? 'Lights off' : 'Lights on');
}
const toggleTheme = () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);

/* ---------- hero field ---------- */
const hero = $('#top');
const fieldCanvas = $('#field');
if (fieldCanvas) {
  const readout = {
    x: $('[data-readout="x"]'), y: $('[data-readout="y"]'), t: $('[data-readout="temp"]'), bar: $('[data-readout="bar"]'),
  };
  const field = initField(fieldCanvas, {
    host: hero,
    onStats({ temp, x, y }) {
      if (!readout.t) return;
      readout.x.textContent = x == null ? '---' : String(Math.round(x)).padStart(4, '0');
      readout.y.textContent = y == null ? '---' : String(Math.round(y)).padStart(4, '0');
      readout.t.textContent = temp.toFixed(2);
      readout.bar.style.transform = `scaleX(${clamp(temp * 1.4, 0.02, 1)})`;
    },
  });
  repaints.push(field.repaint);
}

/* ---------- agent log: oldest run re-executes at the bottom ---------- */
const log = $('[data-log]');
if (log && !reduce) {
  const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  let logVisible = true;
  new IntersectionObserver(([e]) => { logVisible = e.isIntersecting; }).observe(log);
  const runNext = () => {
    if (!logVisible || document.hidden) return;
    const items = $$('li', log);
    const first = items[0];
    const before = new Map(items.map((li) => [li, li.getBoundingClientRect().top]));
    log.appendChild(first);
    // FLIP the survivors up one line; the re-run slides in from below
    $$('li', log).forEach((li) => {
      const dy = before.get(li) - li.getBoundingClientRect().top;
      if (li === first) li.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.23,1,.32,1)' });
      else if (dy) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.23,1,.32,1)' });
    });
    const ok = $('.log-ok', first);
    const done = ok.dataset.text || (ok.dataset.text = ok.textContent);
    first.classList.add('is-running');
    scramble($('.log-name', first), { duration: 500 });
    let k = 0;
    const spin = setInterval(() => { ok.textContent = SPIN[k++ % SPIN.length] + ' run'; }, 80);
    setTimeout(() => {
      clearInterval(spin);
      ok.textContent = done;
      first.classList.remove('is-running');
      first.classList.add('is-done');
      setTimeout(() => first.classList.remove('is-done'), 900);
    }, 1100);
  };
  setTimeout(() => setInterval(runNext, 2600), 1800);
}

/* ---------- intro: decode the mono lines, lift the rest ---------- */
function intro() {
  $$('[data-decode]').forEach((el, i) => setTimeout(() => scramble(el, { duration: 900 }), 120 + i * 90));
  requestAnimationFrame(() => root.classList.add('is-loaded'));
}
if (document.fonts?.ready) document.fonts.ready.then(intro); else intro();
bindScramble();

/* ---------- reveal on scroll ---------- */
const revealIO = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('is-in');
    revealIO.unobserve(e.target);
  }
}, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
$$('[data-reveal]').forEach((el) => {
  // stagger children marked [data-stagger]
  $$('[data-stagger] > *', el).forEach((child, i) => child.style.setProperty('--i', i));
  revealIO.observe(el);
});

/* ---------- nav: scroll state + sliding active pill ---------- */
const nav = $('.nav');
const pill = $('.nav-pill');
const links = $$('.nav-links a');
function movePill(a) {
  if (!pill) return;
  if (!a) { pill.style.opacity = '0'; return; }
  const box = a.getBoundingClientRect();
  const parent = a.parentElement.parentElement.getBoundingClientRect();
  pill.style.opacity = '1';
  pill.style.width = `${box.width}px`;
  pill.style.transform = `translateX(${box.left - parent.left}px)`;
}
let current = null;
const sections = links.map((a) => $(a.getAttribute('href'))).filter(Boolean);
const spy = new IntersectionObserver((entries) => {
  entries.forEach((e) => { e.target.dataset.visible = e.isIntersecting ? '1' : ''; });
  // pick the first visible section in document order
  const vis = sections.find((s) => s.dataset.visible === '1');
  const a = vis ? links.find((l) => l.getAttribute('href') === '#' + vis.id) : null;
  if (a !== current) {
    links.forEach((l) => l.removeAttribute('aria-current'));
    if (a) a.setAttribute('aria-current', 'true');
    current = a;
    movePill(a);
  }
}, { rootMargin: '-45% 0px -50% 0px' });
sections.forEach((s) => spy.observe(s));
window.addEventListener('resize', () => movePill(current));

let lastY = window.scrollY;
const progress = $('.scroll-progress');
function onScroll() {
  const y = window.scrollY;
  nav?.classList.toggle('is-scrolled', y > 24);
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (progress) progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
  lastY = y;
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------- clocks ---------- */
const clocks = $$('[data-clock]');
function tick() {
  const now = new Date();
  clocks.forEach((el) => {
    const tz = el.dataset.clock;
    el.textContent = now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: el.dataset.seconds ? '2-digit' : undefined, hour12: false });
  });
}
tick();
setInterval(tick, 1000);

/* ---------- copy email ---------- */
async function copyEmail() {
  const ok = await copyText(EMAIL);
  sound.tick(1.4);
  toast(ok ? `Copied ${EMAIL}` : EMAIL);
}
$$('[data-copy-email]').forEach((b) => b.addEventListener('click', copyEmail));

/* ---------- print / resume ---------- */
$$('[data-print]').forEach((b) => b.addEventListener('click', () => {
  $$('.xp-item').forEach((d) => d.setAttribute('open', '')); // expand everything for paper
  window.print();
}));

/* ---------- experience accordion (animated <details>) ---------- */
$$('.xp-item').forEach((det) => {
  const summary = $('summary', det);
  const body = $('.xp-body', det);
  summary.addEventListener('click', (e) => {
    if (reduce) return; // native toggle
    e.preventDefault();
    sound.tick(det.open ? 0.8 : 1.1);
    if (det.open) {
      const h = body.offsetHeight;
      body.animate([{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 260, easing: 'cubic-bezier(.32,.72,0,1)' })
        .onfinish = () => det.removeAttribute('open');
      det.classList.remove('is-open');
    } else {
      det.setAttribute('open', '');
      det.classList.add('is-open');
      const h = body.offsetHeight;
      body.animate([{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.32,.72,0,1)' });
    }
  });
  if (det.open) det.classList.add('is-open');
});

/* ---------- spotlight: cursor-follow glow on cards ---------- */
$$('[data-spotlight]').forEach((el) => {
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
});

/* ---------- magnetic buttons ---------- */
if (!reduce && window.matchMedia('(hover: hover)').matches) {
  $$('[data-magnetic]').forEach((el) => {
    const strength = 0.22;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * strength;
      const y = (e.clientY - r.top - r.height / 2) * strength;
      el.style.setProperty('--tx', `${x}px`);
      el.style.setProperty('--ty', `${y}px`);
    });
    el.addEventListener('pointerleave', () => { el.style.setProperty('--tx', '0px'); el.style.setProperty('--ty', '0px'); });
  });
}

/* ---------- clicky: sound on press for anything pressable ---------- */
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('a, button, summary')) sound.tick();
});
const soundBtn = $('[data-sound]');
function syncSound() {
  soundBtn?.setAttribute('aria-pressed', String(sound.on));
  soundBtn?.setAttribute('aria-label', sound.on ? 'Mute interface sounds' : 'Turn on interface sounds');
}
soundBtn?.addEventListener('click', () => { sound.on = !sound.on; syncSound(); sound.tick(1.3); toast(sound.on ? 'Sound on' : 'Sound off'); });
syncSound();

/* ---------- number tickers ---------- */
const tickIO = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    tickIO.unobserve(e.target);
    const el = e.target;
    const end = parseFloat(el.dataset.count);
    const dec = (el.dataset.count.split('.')[1] || '').length;
    if (reduce) { el.textContent = end.toLocaleString(undefined, { minimumFractionDigits: dec }); return; }
    const start = performance.now();
    const dur = 1400;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 4);
      el.textContent = (end * eased).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}, { threshold: 0.6 });
$$('[data-count]').forEach((el) => tickIO.observe(el));

/* ---------- heatmap + pixel displays ---------- */
const heatRoot = $('[data-heatmap]');
if (heatRoot) repaints.push(initHeatmap(heatRoot).repaint);
$$('canvas[data-kind]').forEach((c) => repaints.push(initPixels(c).repaint));

/* ---------- command palette ---------- */
const go = (id) => () => {
  const el = $(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
};
const palette = initPalette($('#cmdk'), [
  { group: 'Navigate', label: 'About', icon: '§', hint: 'A', run: go('#about') },
  { group: 'Navigate', label: 'Experience', icon: '§', hint: 'E', keywords: 'work jobs resume', run: go('#work') },
  { group: 'Navigate', label: 'Projects', icon: '§', hint: 'P', run: go('#projects') },
  { group: 'Navigate', label: 'Activity heatmap', icon: '§', keywords: 'github contributions', run: go('#activity') },
  { group: 'Navigate', label: 'Contact', icon: '§', hint: 'C', run: go('#contact') },
  { group: 'Actions', label: 'Copy email address', icon: '@', keywords: 'mail contact', run: copyEmail },
  { group: 'Actions', label: 'Print / save résumé as PDF', icon: '⎙', keywords: 'resume cv pdf download', run: () => $('[data-print]')?.click() },
  { group: 'Actions', label: 'Toggle dark mode', icon: '◐', hint: 'T', keywords: 'theme light dark', run: toggleTheme },
  { group: 'Actions', label: 'Toggle interface sounds', icon: '♪', keywords: 'audio click', run: () => soundBtn?.click() },
  { group: 'Links', label: 'GitHub — ralstonraphael', icon: '↗', keywords: 'code repos', run: () => window.open('https://github.com/ralstonraphael', '_blank', 'noopener') },
  { group: 'Links', label: 'LinkedIn — ralston-raphael', icon: '↗', run: () => window.open('https://www.linkedin.com/in/ralston-raphael/', '_blank', 'noopener') },
  { group: 'Links', label: 'Email — ' + EMAIL, icon: '↗', run: () => { window.location.href = 'mailto:' + EMAIL; } },
]);
$$('[data-cmdk]').forEach((b) => b.addEventListener('click', (e) => palette.open(e.detail === 0)));

// single-key shortcuts (when not typing, no modifiers)
const keymap = { a: '#about', e: '#work', p: '#projects', c: '#contact' };
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || $('#cmdk')?.open) return;
  const k = e.key.toLowerCase();
  if (keymap[k]) go(keymap[k])();
  else if (k === 't') toggleTheme();
});

/* ---------- theme init (after repaint hooks exist) ---------- */
let saved = null;
try { saved = localStorage.getItem('rr:theme'); } catch {}
if (saved === 'dark') setTheme('dark');
$$('[data-theme-toggle]').forEach((b) => b.addEventListener('click', toggleTheme));

/* ---------- footer: last updated ---------- */
const updated = $('[data-updated]');
if (updated) {
  const d = new Date(document.lastModified);
  if (!isNaN(d)) updated.textContent = d.toISOString().slice(0, 10);
}
