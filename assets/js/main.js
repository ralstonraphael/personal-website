import { $, $$, prefersReducedMotion, motion, sound, toast, copyText, clamp, isMac, buzz } from './util.js';
import { initPress, burst, odometer, initMagnetic, initNudges } from './juice.js';
import { initField } from './field.js';
import { scramble, bindScramble } from './scramble.js';
import { initHeatmap } from './heatmap.js';
import { initPalette } from './palette.js';
import { initPixels } from './pixels.js';
import { initWeightWave } from './nameplate-weight.js';
import { initThermalName } from './nameplate-thermal.js';
import { enableSmooth, disableSmooth, getLenis, watchDialog, scrollToTarget, onScroll, progress } from './smooth.js';

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

/* ---------- smooth scroll: wheel glides, touch/keys stay native, motion off = native ---------- */
safe('smooth', () => {
  if (motion.on) enableSmooth();
  motion.subscribe((on) => (on ? enableSmooth() : disableSmooth()));
  watchDialog($('#cmdk'));
  $('pre.code')?.setAttribute('data-lenis-prevent-horizontal', '');
});

function intro() {
  if (root.classList.contains('is-loaded')) return;
  try { sessionStorage.setItem('rr:seen', '1'); } catch {}
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
  if (announce) toast(t === 'dark' ? 'Dark mode' : 'Light mode', { key: 'theme' });
}
function toggleTheme() {
  const t = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.classList.add('no-trans');
  const done = () => requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('no-trans')));
  buzz(8);
  if (!document.startViewTransition || reduce) { setTheme(t, true); return done(); }
  const r = (themeBtn?.offsetParent ? themeBtn : document.body).getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  root.classList.add('vt-theme');
  const vt = document.startViewTransition(() => { setTheme(t, true); repaints.forEach((fn) => safe('repaint', fn)); });
  vt.ready.then(() => root.animate(
    { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${R}px at ${x}px ${y}px)`] },
    { duration: 560, easing: 'cubic-bezier(.32,.72,0,1)', pseudoElement: '::view-transition-new(root)' },
  )).catch(() => {});
  vt.finished.finally(() => { root.classList.remove('vt-theme'); done(); });
}
themeBtn?.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
themeBtn?.addEventListener('click', toggleTheme);

/* ---------- thermal fields ---------- */
let heroField = null, contactField = null;
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
  heroField = field;
});
safe('field-contact', () => {
  const c = $('#field-contact');
  if (!c) return;
  const field = initField(c, { host: $('#contact'), preset: 'calm', avoid: '.section-aside, .contact-line, .contact-actions' });
  repaints.push(field.repaint);
  contactField = field;
});

/* ---------- scroll choreography: the hero cools and drifts as you leave it,
   the contact field warms back up as you arrive (hot → cool → hot) ---------- */
safe('scroll-fx', () => {
  const stage = $('#top'), contact = $('#contact');
  let H = 1, cTop = 0, cEnd = 1, lastExit = -1;
  const measure = () => {
    H = stage?.offsetHeight || innerHeight;
    cTop = contact ? contact.getBoundingClientRect().top + scrollY : 0;
    cEnd = Math.min(cTop - innerHeight * 0.35, document.documentElement.scrollHeight - innerHeight);
  };
  new ResizeObserver(measure).observe(document.body);
  measure();
  onScroll(({ y }) => {
    if (y <= H) {
      const p = progress(y, 0, H * 0.75);
      heroField?.setCool(p);
      const e = reduce || !motion.on ? 0 : Math.round(p * 1000) / 1000;
      if (e !== lastExit) { lastExit = e; stage.style.setProperty('--exit', e); }
    } else if (lastExit !== 1 && !reduce && motion.on) { lastExit = 1; stage.style.setProperty('--exit', 1); }
    if (contactField && y + innerHeight > cTop - 200) contactField.setCool(1 - progress(y, cTop - innerHeight, cEnd));
  });
  motion.subscribe((on) => { if (!on) { lastExit = 0; stage.style.setProperty('--exit', 0); } });
});

/* ---------- nameplate: typography first (hairlines inflate into the name), heat on
   interaction (a thermal lens follows the cursor; clicks send a heat ring) ---------- */
safe('nameplate', () => {
  const h1 = $('.hero-name');
  if (!h1) return;
  const ww = initWeightWave(h1, { hover: false, pulse: false, intro: !root.classList.contains('no-intro') });
  const np = initThermalName(h1, { intro: false, after: ww ? ww.done : null });
  if (np?.repaint) repaints.push(np.repaint);
  ww?.done.then(() => heroField?.remeasure());
  // failsafe: whatever happens, the name is fully visible after 3s
  setTimeout(() => {
    h1.classList.remove('np-intro');
    if (!h1.matches(':hover')) h1.style.maskImage = h1.style.webkitMaskImage = '';
    h1.querySelectorAll('.ch').forEach((c) => { c.style.opacity = ''; });
  }, 3000);
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
  let current = null, lastL = 0, grace = 0;
  function movePill(a) {
    if (!pill || !linksBox) return;
    if (!a) { pill.style.opacity = '0'; return; }
    const l = a.offsetLeft, r = l + a.offsetWidth;
    linksBox.classList.toggle('to-left', l < lastL);
    lastL = l;
    pill.style.opacity = '1';
    linksBox.style.setProperty('--l', `${l}px`);
    linksBox.style.setProperty('--r', `${r}px`);
    // first placement snaps; later ones stretch like an inchworm
    if (!linksBox.classList.contains('is-ready')) requestAnimationFrame(() => requestAnimationFrame(() => linksBox.classList.add('is-ready')));
  }
  links.forEach((a) => a.addEventListener('pointerenter', () => { clearTimeout(grace); movePill(a); }));
  linksBox?.addEventListener('pointerleave', () => { grace = setTimeout(() => movePill(current), 150); });

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

  const bar = $('.scroll-progress');
  let max = 1;
  const measure = () => { max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight); };
  new ResizeObserver(measure).observe(document.body);
  measure();
  let scrolled = null, lastP = -1;
  onScroll(({ y }) => {
    if ((y > 24) !== scrolled) { scrolled = y > 24; nav?.classList.toggle('is-scrolled', scrolled); }
    const p = Math.round(clamp(y / max, 0, 1) * 2000) / 2000;
    if (bar && p !== lastP) { lastP = p; bar.style.transform = `scaleX(${p})`; }
  });
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
  if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return; // let the mailto link through
  e?.preventDefault?.();
  const btn = e?.currentTarget;
  const ok = await copyText(EMAIL);
  if (!btn?.classList) { toast(ok ? `Copied ${EMAIL}` : EMAIL, { key: 'copy' }); sound.play('success'); return; }
  const again = btn.classList.contains('is-copied');
  btn.classList.add('is-copied');
  if (!again) {
    const ico = $('.morph', btn) || btn;
    const r = ico.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2);
    sound.play('success');
    buzz([10, 40, 14]);
  }
  clearTimeout(btn._t);
  btn._t = setTimeout(() => btn.classList.remove('is-copied'), 1800);
  const status = $('#copy-status');
  if (status) status.textContent = ok ? `Copied ${EMAIL}` : EMAIL;
  if (!ok) toast(EMAIL, { key: 'copy' });
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
      if (reduce) { det.open = open; return; }
      const from = det.open ? body.getBoundingClientRect().height : 0;
      anim?.cancel();
      det.classList.toggle('is-open', open);
      if (open) det.open = true;
      const to = open ? body.scrollHeight : 0;
      anim = body.animate([{ height: `${from}px`, opacity: open ? 0.4 : 1 }, { height: `${to}px`, opacity: open ? 1 : 0 }],
        { duration: open ? 380 : 260, easing: 'cubic-bezier(.32,.72,0,1)' });
      anim.onfinish = () => { anim = null; if (!det.classList.contains('is-open')) det.open = false; getLenis()?.resize(); };
      if (open) $$('.xp-steps li, .xp-points li, .chips', body).forEach((el, i) => el.animate(
        [{ opacity: 0, transform: 'translateY(6px)', filter: 'blur(2px)' }, { opacity: 1, transform: 'none', filter: 'none' }],
        { duration: 420, delay: 50 + Math.min(i, 6) * 35, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' },
      ));
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
  focusTarget(el);
  const arrive = () => {
    if (!open || !accordions.has(el)) return;
    accordions.get(el)(true);
    el.classList.remove('is-arrived'); void el.offsetWidth; el.classList.add('is-arrived'); // one thermal wash: "you are here"
    setTimeout(() => el.classList.remove('is-arrived'), 1000);
  };
  // open a touch before the glide lands so the two motions overlap into one gesture
  let fired = false;
  const once = () => { if (!fired) { fired = true; arrive(); } };
  scrollToTarget(el, { focus: false, onComplete: once });
  if (open && !reduce) setTimeout(once, 520);
};
$$('[data-jump]').forEach((a) => a.addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // keep "open in new tab"
  e.preventDefault();
  go(a.dataset.jump, true)();
}));

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

/* ---------- the tactile layer: press physics, magnetism, arrow nudges ---------- */
safe('press', initPress);
safe('magnetic', initMagnetic);
safe('nudges', initNudges);
const soundBtn = $('[data-sound]');
const syncSound = () => soundBtn?.setAttribute('aria-pressed', String(sound.on));
soundBtn?.addEventListener('click', () => { sound.on = !sound.on; syncSound(); sound.play('success'); toast(sound.on ? 'Sound on' : 'Sound off', { key: 'sound' }); });
syncSound();

/* ---------- motion switch (footer + palette) ---------- */
const motionBtns = $$('[data-motion-toggle]');
const syncMotion = () => motionBtns.forEach((b) => {
  b.setAttribute('aria-pressed', String(!motion.on)); // pressed = paused
  const v = b.querySelector('[data-motion-state]');
  if (v) v.textContent = motion.on ? 'on' : 'off';
});
const toggleMotion = () => { motion.on = !motion.on; syncMotion(); toast(motion.on ? 'Motion on' : 'Motion paused', { key: 'motion' }); };
motionBtns.forEach((b) => b.addEventListener('click', toggleMotion));
syncMotion();

/* ---------- stats: odometer digits roll in once the card is actually on screen ---------- */
safe('odometer', () => {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      // on first load the cards arrive with the intro; wait for them to be visible
      const wait = Math.max(0, 1000 - performance.now());
      odometer(e.target, { delay: wait + 120 });
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
    { group: 'Actions', label: () => (keysOn ? 'Turn off single-key shortcuts' : 'Turn on single-key shortcuts'), icon: '⌨', keywords: 'keyboard a e p c t', run: () => { keysOn = !keysOn; store.set('rr:keys', keysOn ? 'on' : 'off'); syncKeysTip(); toast(keysOn ? 'Shortcuts on' : 'Shortcuts off', { key: 'keys' }); } },
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
