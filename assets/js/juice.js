// Juice: the tactile layer. A physical press model for everything clickable,
// thermal pixel bursts, rolling odometer digits, tuned magnetism and arrow
// nudges. Everything is idle unless touched, and stands down for reduced motion.

import { $$, prefersReducedMotion, sound, clamp } from './util.js';

const reduce = prefersReducedMotion();
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ---------- press model: min press time, touch-scroll guard, keyboard parity ---------- */
const PRESSABLE = '.btn, .icon-btn, .logo-chip, .cmdk-trigger, .status-btn, .segmented button, .xp-item summary, .proj-link';
const MIN_PRESS = 90;
const TOUCH_DELAY = 50;
const isOff = (el) => el.matches(':disabled, [aria-disabled="true"], [aria-busy="true"]');

function press(el) {
  clearTimeout(el._rt);
  el.classList.add('is-pressed');
  el._pt = performance.now();
  sound.play('press');
}
function release(el) {
  if (!el.classList.contains('is-pressed')) return;
  const wait = Math.max(0, MIN_PRESS - (performance.now() - el._pt));
  el._rt = setTimeout(() => { el.classList.remove('is-pressed'); sound.play('release'); }, wait);
}

export function initPress() {
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest?.(PRESSABLE);
    if (!el || isOff(el)) return;
    // touch: wait a beat so a scroll that starts on a button doesn't flash it
    let timer = e.pointerType === 'touch' ? setTimeout(() => { timer = 0; press(el); }, TOUCH_DELAY) : (press(el), 0);
    const end = (ev) => {
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      if (timer) { clearTimeout(timer); if (ev.type === 'pointerup') press(el); else return; }
      release(el);
    };
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  }, { passive: true });

  let kbEl = null;
  document.addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat) return;
    const el = document.activeElement?.closest?.(PRESSABLE);
    if (el && !isOff(el)) { kbEl = el; press(el); }
  });
  document.addEventListener('keyup', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && kbEl) { release(kbEl); kbEl = null; }
  });
  addEventListener('blur', () => { if (kbEl) { release(kbEl); kbEl = null; } });
  document.addEventListener('touchstart', () => {}, { passive: true }); // iOS: enables :active
}

/* ---------- pixel burst: thermal pixels that cool as they fall ---------- */
const RAMP = ['--th-9', '--th-8', '--th-7', '--th-6', '--th-5', '--th-4', '--th-3', '--th-2']; // hot → cool
let cv, cx, parts = [], raf = 0, last = 0, colors = [], dpr = 1;

export function burst(x, y, { count = 16, spread = 55 } = {}) {
  if (reduce) return;
  if (!cv) {
    cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:96';
    document.body.append(cv);
    cx = cv.getContext('2d');
  }
  dpr = Math.min(2, devicePixelRatio || 1);
  if (cv.width !== Math.round(innerWidth * dpr) || cv.height !== Math.round(innerHeight * dpr)) {
    cv.width = Math.round(innerWidth * dpr);
    cv.height = Math.round(innerHeight * dpr);
  }
  const cs = getComputedStyle(document.documentElement);
  colors = RAMP.map((v) => cs.getPropertyValue(v).trim());
  for (let i = 0; i < count; i++) {
    const a = (-90 + (Math.random() * 2 - 1) * spread) * (Math.PI / 180);
    const sp = 360 + Math.random() * 280;
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: Math.random() < 0.3 ? 4 : 3, t: 0, ttl: 0.55 + Math.random() * 0.35 });
  }
  if (parts.length > 96) parts.splice(0, parts.length - 96);
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
}
function step(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => (p.t += dt) < p.ttl);
  const drag = Math.pow(0.08, dt);
  for (const p of parts) {
    p.vx *= drag;
    p.vy = p.vy * drag + 1100 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const k = p.t / p.ttl;
    cx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    cx.fillStyle = colors[Math.min(colors.length - 1, (k * colors.length) | 0)];
    cx.fillRect(Math.round(p.x / 3) * 3, Math.round(p.y / 3) * 3, p.s, p.s); // 3px grid = the site's pixel language
  }
  if (parts.length) raf = requestAnimationFrame(step);
  else { raf = 0; cx.clearRect(0, 0, innerWidth, innerHeight); }
}

/* ---------- odometer: digits roll into place, landing left → right ---------- */
export function odometer(el, { delay = 0 } = {}) {
  const final = Number(el.dataset.count).toLocaleString('en-US');
  el.textContent = '';
  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = final;
  const odo = document.createElement('span');
  odo.className = 'odo';
  odo.setAttribute('aria-hidden', 'true');
  el.append(sr, odo);
  let di = 0;
  for (const ch of final) {
    if (!/\d/.test(ch)) { const s = document.createElement('span'); s.textContent = ch; odo.append(s); continue; }
    const steps = (di + 1) * 10 + +ch; // leftmost rolls least, rightmost most
    const col = document.createElement('span');
    col.className = 'odo-col';
    const strip = document.createElement('span');
    strip.className = 'odo-strip';
    strip.innerHTML = Array.from({ length: steps + 1 }, (_, k) => `<span>${k % 10}</span>`).join('');
    col.append(strip);
    odo.append(col);
    if (reduce) strip.style.transform = `translateY(${-steps}em)`;
    else strip.animate([
      { transform: 'translateY(0)', filter: 'blur(0)', easing: 'cubic-bezier(.45,0,.2,1)' },
      { filter: 'blur(1.2px)', offset: 0.35 },
      { transform: `translateY(${-(steps + 0.16)}em)`, filter: 'blur(0)', offset: 0.9, easing: 'cubic-bezier(.3,0,.3,1)' },
      { transform: `translateY(${-steps}em)`, filter: 'blur(0)' },
    ], { duration: 1050 + di * 110, delay, fill: 'both' });
    di++;
  }
}

/* ---------- magnetic: gentle pull, capped, spring return ---------- */
export function initMagnetic() {
  if (reduce || !fine) return;
  $$('[data-magnetic]').forEach((el) => {
    let r = null, raf2 = 0, px = 0, py = 0;
    const apply = () => {
      raf2 = 0;
      if (!r) return;
      const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2);
      el.style.setProperty('--tx', `${clamp(dx * 0.16, -6, 6)}px`);
      el.style.setProperty('--ty', `${clamp(dy * 0.16, -4, 4)}px`);
    };
    el.addEventListener('pointerenter', () => { r = el.getBoundingClientRect(); el.classList.add('is-magnet'); });
    el.addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; r ||= el.getBoundingClientRect(); raf2 ||= requestAnimationFrame(apply); });
    el.addEventListener('pointerleave', () => {
      cancelAnimationFrame(raf2); raf2 = 0; r = null;
      el.classList.remove('is-magnet');
      el.style.setProperty('--tx', '0px');
      el.style.setProperty('--ty', '0px');
    });
  });
}

/* ---------- arrows that slide out and a twin slides back in ---------- */
export function initNudges() {
  $$('.nudge').forEach((n) => { if (n.children.length === 1) n.append(n.firstElementChild.cloneNode(true)); });
}
