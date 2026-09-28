import { $, $$, prefersReducedMotion, motion, sound, toast, copyText, clamp, isMac } from './util.js';
import { initField } from './field.js';
import { scramble, bindScramble } from './scramble.js';
import { initHeatmap } from './heatmap.js';
import { initPalette } from './palette.js';
import { initPixels } from './pixels.js';

const EMAIL = 'ralstone2005@gmail.com';
const reduce = prefersReducedMotion();
const root = document.documentElement;
root.classList.add('js');

// One broken feature must never leave the page invisible: every feature boots
// in isolation, and content is revealed first.
const safe = (name, fn) => { try { return fn(); } catch (err) { console.warn(`[${name}]`, err); } };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

/* ---------- reveal first ---------- */
safe('reveal', () => {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  $$('[data-reveal]').forEach((el) => {
    $$('[data-stagger] > *', el).forEach((child, i) => child.style.setProperty('--i', i));
    io.observe(el);
  });
});

function intro() {
  if (root.classList.contains('is-loaded')) return;
  $$('[data-decode]').forEach((el, i) => setTimeout(() => scramble(el, { duration: 900 }), 120 + i * 90));
  requestAnimationFrame(() => root.classList.add('is-loaded'));
}
// don't hold the first paint hostage to web fonts
Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 300))]).then(intro, intro);

/* ---------- theme ---------- */
const repaints = [];
const themeBtn = $('[data-theme-toggle]');
function setTheme(t, announce) {
  root.dataset.theme = t;
  store.set('rr:theme', t);
  $('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0c0c0b' : '#f6f5f1');
  themeBtn?.setAttribute('aria-pressed', String(t === 'dark'));
  requestAnimationFrame(() => repaints.forEach((fn) => safe('repaint', fn)));
  if (announce) toast(t === 'dark' ? 'Dark mode' : 'Light mode');
}
const toggleTheme = () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
themeBtn?.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
themeBtn?.addEventListener('click', toggleTheme);

/* ---------- thermal fields ---------- */
safe('field', () => {
  const readout = { x: $('[data-readout="x"]'), y: $('[data-readout="y"]'), t: $('[data-readout="temp"]'), bar: $('[data-readout="bar"]') };
  const field = initField($('#field'), {
    host: $('#top'),
    preset: 'hero',
    avoid: '.eyebrow, .hero-name .line > span, .hero-lede, .hero-actions, .meta-grid dd, .meta-grid dt, .logo-strip-label',
    avoidBoxes: '.logo-chip, .impact-grid .stat',
    onStats({ temp, x, y }) {
      if (!readout.t || !readout.t.offsetParent) return;
      const nx = x == null ? '0000' : String(Math.round(x)).padStart(4, '0');
      const ny = y == null ? '0000' : String(Math.round(y)).padStart(4, '0');
      const nt = temp.toFixed(2);
      if (nx === readout.x.textContent && ny === readout.y.textContent && nt === readout.t.textContent) return;
      readout.x.textContent = nx; readout.y.textContent = ny; readout.t.textContent = nt;
      readout.bar.style.transform = `scaleX(${clamp(temp * 1.4, 0.02, 1)})`;
    },
  });
  repaints.push(field.repaint);
});
safe('field-contact', () => {
  const c = $('#field-contact');
  if (c) repaints.push(initField(c, { host: $('#contact'), preset: 'calm', avoid: '.section-aside, .contact-line, .contact-actions' }).repaint);
});

/* ---------- agent log: oldest run re-executes at the bottom ---------- */
safe('log', () => {
  const log = $('[data-log]');
  if (!log || reduce) return;
  const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  let inView = true, hovered = false;
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; }).observe(log);
  const card = log.closest('.agent-log');
  card.addEventListener('pointerenter', () => { hovered = true; });
  card.addEventListener('pointerleave', () => { hovered = false; });
  const runNext = () => {
    if (!inView || hovered || document.hidden || !motion.on) return;
    const items = $$('li', log);
    const first = items[0];
    const before = new Map(items.map((li) => [li, li.offsetTop]));
    log.appendChild(first);
    $$('li', log).forEach((li) => {
      const dy = before.get(li) - li.offsetTop;
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
  setTimeout(() => setInterval(runNext, 2800), 2200);
});

bindScramble();

/* ---------- nav: scroll state + sliding pill (follows hover, rests on the active section) ---------- */
safe('nav', () => {
  const nav = $('.nav');
  const linksBox = $('.nav-links');
  const pill = $('.nav-pill');
  const links = $$('.nav-links a');
  let current = null;
  function movePill(a) {
    if (!pill) return;
    if (!a) { pill.style.opacity = '0'; return; }
    pill.style.opacity = '1';
    pill.style.width = `${a.offsetWidth}px`;
    pill.style.transform = `translateX(${a.offsetLeft}px)`;
    // first placement snaps; later ones slide
    if (!linksBox.classList.contains('is-ready')) requestAnimationFrame(() => linksBox.classList.add('is-ready'));
  }
  links.forEach((a) => a.addEventListener('pointerenter', () => movePill(a)));
  linksBox?.addEventListener('pointerleave', () => movePill(current));

  const sections = links.map((a) => $(a.getAttribute('href'))).filter(Boolean);
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((e) => { e.target.dataset.visible = e.isIntersecting ? '1' : ''; });
    const vis = sections.find((s) => s.dataset.visible === '1');
    const a = vis ? links.find((l) => l.getAttribute('href') === '#' + vis.id) : null;
    if (a !== current) {
      links.forEach((l) => l.removeAttribute('aria-current'));
      if (a) a.setAttribute('aria-current', 'true');
      current = a;
      if (!linksBox.matches(':hover')) movePill(a);
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => spy.observe(s));
  window.addEventListener('resize', () => movePill(current));

  const progress = $('.scroll-progress');
  let max = 1;
  const measure = () => { max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight); };
  new ResizeObserver(measure).observe(document.body);
  measure();
  const onScroll = () => {
    const y = window.scrollY;
    nav?.classList.toggle('is-scrolled', y > 24);
    if (progress) progress.style.transform = `scaleX(${clamp(y / max, 0, 1)})`;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
});

/* ---------- clocks ---------- */
safe('clocks', () => {
  const clocks = $$('[data-clock]').map((el) => ({
    el,
    fmt: new Intl.DateTimeFormat('en-US', { timeZone: el.dataset.clock, hour: '2-digit', minute: '2-digit', second: el.dataset.seconds ? '2-digit' : undefined, hour12: false }),
  }));
  const tick = () => {
    const now = new Date();
    clocks.forEach(({ el, fmt }) => { el.textContent = fmt.format(now); });
    setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  };
  tick();
});

/* ---------- copy email (inline "copied" state; toast when there's no button to show it) ---------- */
async function copyEmail(e) {
  e?.preventDefault?.();
  const ok = await copyText(EMAIL);
  sound.tick(1.4);
  const btn = e?.currentTarget;
  const label = btn?.querySelector?.('[data-copy-label]');
  if (btn && label) {
    label.dataset.idle ??= label.textContent;
    btn.classList.add('is-copied');
    label.textContent = ok ? label.dataset.done || 'Copied' : EMAIL;
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.classList.remove('is-copied'); label.textContent = label.dataset.idle; }, 1600);
    const status = $('#copy-status');
    if (status) status.textContent = ok ? `Copied ${EMAIL}` : EMAIL;
  } else toast(ok ? `Copied ${EMAIL}` : EMAIL);
}
$$('[data-copy-email]').forEach((b) => b.addEventListener('click', copyEmail));
$$('[data-copy-sr]').forEach((s) => { s.textContent = ' (copies the address)'; });

/* ---------- experience accordion (animated <details>, interruptible) ---------- */
const accordions = new Map();
safe('accordion', () => {
  $$('.xp-item').forEach((det) => {
    const summary = $('summary', det);
    const body = $('.xp-body', det);
    let anim = null;
    det.classList.toggle('is-open', det.open);
    det.addEventListener('toggle', () => { if (!anim) det.classList.toggle('is-open', det.open); });
    const set = (open) => {
      if (open === det.classList.contains('is-open') && !anim) return;
      sound.tick(open ? 1.1 : 0.8);
      if (reduce) { det.open = open; return; }
      const from = det.open ? body.getBoundingClientRect().height : 0;
      anim?.cancel();
      det.classList.toggle('is-open', open);
      if (open) det.open = true;
      const to = open ? body.scrollHeight : 0;
      anim = body.animate([{ height: `${from}px`, opacity: open ? 0.4 : 1 }, { height: `${to}px`, opacity: open ? 1 : 0 }],
        { duration: open ? 380 : 260, easing: 'cubic-bezier(.32,.72,0,1)' });
      anim.onfinish = () => { anim = null; if (!det.classList.contains('is-open')) det.open = false; };
    };
    summary.addEventListener('click', (e) => { e.preventDefault(); set(!det.classList.contains('is-open')); });
    accordions.set(det, set);
  });
});

/* ---------- logo strip + anything with [data-jump]: scroll to a role and open it ---------- */
function focusTarget(el) {
  const h = el.matches('summary, h2, h3') ? el : $('summary, h2', el) || el;
  if (!h.matches('summary, a, button')) h.setAttribute('tabindex', '-1');
  h.focus({ preventScroll: true });
}
const go = (id, open = false) => () => {
  const el = $(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  if (open && accordions.has(el)) setTimeout(() => accordions.get(el)(true), reduce ? 0 : 420);
  focusTarget(el);
};
$$('[data-jump]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.jump, true)(); }));

/* ---------- print: the page becomes a résumé ---------- */
safe('print', () => {
  let saved = null;
  addEventListener('beforeprint', () => {
    saved = $$('.xp-item').map((d) => d.open);
    $$('.xp-item').forEach((d) => { d.open = true; });
  });
  addEventListener('afterprint', () => {
    if (saved) $$('.xp-item').forEach((d, i) => { d.open = saved[i]; });
    saved = null;
  });
  $$('[data-print]').forEach((b) => b.addEventListener('click', () => window.print()));
});

/* ---------- spotlight: cursor-follow glow on cards (one style write per frame) ---------- */
safe('spotlight', () => {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let pending = null, raf = 0;
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('[data-spotlight]');
    if (!el) return;
    pending = { el, x: e.clientX, y: e.clientY };
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const { el: t, x, y } = pending;
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', `${x - r.left}px`);
      t.style.setProperty('--my', `${y - r.top}px`);
    });
  }, { passive: true });
});

/* ---------- magnetic buttons ---------- */
safe('magnetic', () => {
  if (reduce || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  $$('[data-magnetic]').forEach((el) => {
    let r = null;
    el.addEventListener('pointerenter', () => { r = el.getBoundingClientRect(); });
    el.addEventListener('pointermove', (e) => {
      r ||= el.getBoundingClientRect();
      const x = clamp((e.clientX - r.left - r.width / 2) * 0.22, -8, 8);
      const y = clamp((e.clientY - r.top - r.height / 2) * 0.22, -6, 6);
      el.style.setProperty('--tx', `${x}px`);
      el.style.setProperty('--ty', `${y}px`);
    });
    el.addEventListener('pointerleave', () => { r = null; el.style.setProperty('--tx', '0px'); el.style.setProperty('--ty', '0px'); });
  });
});

/* ---------- clicky: sound on press; iOS needs a touch listener for :active ---------- */
document.addEventListener('touchstart', () => {}, { passive: true });
document.addEventListener('pointerdown', (e) => { if (e.target.closest('a, button, summary')) sound.tick(); });
const soundBtn = $('[data-sound]');
const syncSound = () => soundBtn?.setAttribute('aria-pressed', String(sound.on));
soundBtn?.addEventListener('click', () => { sound.on = !sound.on; syncSound(); sound.tick(1.3); toast(sound.on ? 'Sound on' : 'Sound off'); });
syncSound();

/* ---------- motion switch (footer + palette) ---------- */
const motionBtns = $$('[data-motion-toggle]');
const syncMotion = () => motionBtns.forEach((b) => {
  b.setAttribute('aria-pressed', String(!motion.on)); // pressed = paused
  const v = b.querySelector('[data-motion-state]');
  if (v) v.textContent = motion.on ? 'on' : 'off';
});
const toggleMotion = () => { motion.on = !motion.on; syncMotion(); toast(motion.on ? 'Motion on' : 'Motion paused'); };
motionBtns.forEach((b) => b.addEventListener('click', toggleMotion));
syncMotion();

/* ---------- number tickers (width locked so units don't slide) ---------- */
safe('tickers', () => {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const el = e.target;
      const end = parseFloat(el.dataset.count);
      const final = end.toLocaleString();
      el.textContent = final;
      if (reduce) return;
      el.style.display = 'inline-block';
      el.style.minWidth = `${el.getBoundingClientRect().width}px`;
      const start = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - start) / 1400);
        el.textContent = Math.round(end * (1 - Math.pow(1 - p, 4))).toLocaleString();
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, { threshold: 0.6 });
  $$('[data-count]').forEach((el) => io.observe(el));
});

/* ---------- heatmap + pixel displays ---------- */
safe('heatmap', () => { const h = $('[data-heatmap]'); if (h) repaints.push(initHeatmap(h).repaint); });
$$('canvas[data-kind]').forEach((c) => safe('pixels', () => repaints.push(initPixels(c).repaint)));

/* ---------- keyboard: ⌘K palette + optional single-key shortcuts ---------- */
let keysOn = store.get('rr:keys') !== 'off';
const syncKeysTip = () => $$('[data-keys-tip]').forEach((t) => { t.hidden = !keysOn; });
syncKeysTip();
$$('[data-mod]').forEach((k) => { k.textContent = isMac ? '⌘' : 'Ctrl'; });
safe('palette', () => {
  const palette = initPalette($('#cmdk'), [
    { group: 'Navigate', label: 'About', icon: '§', hint: 'A', run: go('#about') },
    { group: 'Navigate', label: 'Experience', icon: '§', hint: 'E', keywords: 'work jobs resume ramp datagrid', run: go('#work') },
    { group: 'Navigate', label: 'Projects', icon: '§', hint: 'P', run: go('#projects') },
    { group: 'Navigate', label: 'Activity heatmap', icon: '§', keywords: 'github contributions attention', run: go('#activity') },
    { group: 'Navigate', label: 'Education', icon: '§', keywords: 'trinity school college', run: go('#education') },
    { group: 'Navigate', label: 'Contact', icon: '§', hint: 'C', run: go('#contact') },
    { group: 'Experience', label: 'Ramp: AI Product', icon: '→', keywords: 'glass internal ai', run: go('#xp-ramp', true) },
    { group: 'Experience', label: 'Datagrid → Procore', icon: '→', keywords: 'forward deployed engineer solutions architect agents', run: go('#xp-datagrid', true) },
    { group: 'Experience', label: 'Universal Music Group', icon: '→', keywords: 'umg republic records data engineering', run: go('#xp-umg', true) },
    { group: 'Experience', label: 'SoFi', icon: '→', keywords: 'extern fintech', run: go('#xp-sofi', true) },
    { group: 'Experience', label: 'Norstella', icon: '→', keywords: 'strategy rag flash report', run: go('#xp-norstella', true) },
    { group: 'Experience', label: 'DxD HealthTech × Stanford Biodesign', icon: '→', keywords: 'biodesign healthtech', run: go('#xp-dxd', true) },
    { group: 'Experience', label: 'Longitude Capital', icon: '→', keywords: 'venture capital vc', run: go('#xp-longitude', true) },
    { group: 'Actions', label: 'Copy email address', icon: '@', keywords: 'mail contact', run: () => copyEmail() },
    { group: 'Actions', label: 'Print / save résumé as PDF', icon: '⎙', keywords: 'resume cv pdf download', run: () => window.print() },
    { group: 'Actions', label: () => (root.dataset.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'), icon: '◐', hint: 'T', keywords: 'theme light dark toggle', run: toggleTheme },
    { group: 'Actions', label: () => (motion.on ? 'Pause motion' : 'Resume motion'), icon: '‖', keywords: 'animation reduce stop', run: toggleMotion },
    { group: 'Actions', label: () => (sound.on ? 'Turn off interface sounds' : 'Turn on interface sounds'), icon: '♪', keywords: 'audio click', run: () => soundBtn?.click() },
    { group: 'Actions', label: () => (keysOn ? 'Turn off single-key shortcuts' : 'Turn on single-key shortcuts'), icon: '⌨', keywords: 'keyboard a e p c t', run: () => { keysOn = !keysOn; store.set('rr:keys', keysOn ? 'on' : 'off'); syncKeysTip(); toast(keysOn ? 'Shortcuts on' : 'Shortcuts off'); } },
    { group: 'Links', label: 'GitHub: ralstonraphael', icon: '↗', keywords: 'gh code repos', run: () => window.open('https://github.com/ralstonraphael', '_blank', 'noopener') },
    { group: 'Links', label: 'LinkedIn: ralston-raphael', icon: '↗', keywords: 'li', run: () => window.open('https://www.linkedin.com/in/ralston-raphael/', '_blank', 'noopener') },
    { group: 'Links', label: `Email: ${EMAIL}`, icon: '↗', run: () => { window.location.href = 'mailto:' + EMAIL; } },
  ], { shortcutsOn: () => keysOn });
  $$('[data-cmdk]').forEach((b) => b.addEventListener('click', (e) => palette.open(e.detail === 0)));
});

const keymap = { a: '#about', e: '#work', p: '#projects', c: '#contact' };
document.addEventListener('keydown', (e) => {
  if (!keysOn || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || $('#cmdk')?.open) return;
  const k = e.key.toLowerCase();
  if (keymap[k]) go(keymap[k])();
  else if (k === 't') toggleTheme();
});
