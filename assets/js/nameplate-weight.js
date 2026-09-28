// Weight wave nameplate: Geist's wght axis as a physical material.
//  - hover (fine pointer): letters near the cursor swell towards `peak`, each on
//    its own under-damped spring, so a sweep leaves a soft wake
//  - click / tap: a swell travels through the letters at the field ripple's speed
//  - intro: hairline letters (wght 100) inflate into the name, left to right
// Width is compensated per letter so the line barely breathes: the caret and the
// field's text-avoid rects stay put. Idle = no rAF.

import { prefersReducedMotion, motion } from './util.js';

export function initWeightWave(h1, {
  stage = h1.closest('.stage') || document.body,
  peak = 780,            // wght at the cursor
  hairline = 120,        // intro start weight
  spread = 0.55,         // gaussian sigma in em (x); y uses 0.8 of it
  keep = 0.72,           // how much of the extra width is cancelled (1 = rigid slots)
  intro = true,
  hover = true,          // false: intro only (e.g. when the thermal lens owns hover)
  pulse = true,
} = {}) {
  const reduce = prefersReducedMotion();
  if (reduce) return null; // static name; nothing to do
  const still = () => !motion.on;

  // split into letters, keep the accessible name in one piece
  const label = h1.textContent.replace(/\s+/g, ' ').trim();
  const sr = document.createElement('span');
  sr.className = 'sr-only'; sr.textContent = label;
  h1.prepend(sr);
  const chars = [];
  for (const line of h1.querySelectorAll('.line')) {
    line.setAttribute('aria-hidden', 'true');
    const span = line.firstElementChild;
    for (const node of [...span.childNodes]) {
      if (node.nodeType !== 3) continue;
      const frag = document.createDocumentFragment();
      for (const ch of node.data) {
        const el = document.createElement('span');
        el.className = 'ch'; el.textContent = ch;
        frag.append(el); chars.push(el);
      }
      node.replaceWith(frag);
    }
  }
  const N = chars.length;
  const w = new Float32Array(N), v = new Float32Array(N), target = new Float32Array(N);
  const cx = new Float32Array(N), cy = new Float32Array(N), grow = new Float32Array(N), shrink = new Float32Array(N);
  const kickAt = new Float64Array(N).fill(-1), kickAmt = new Float32Array(N);
  const written = new Float32Array(N).fill(-1);
  let base = 560, fs = 144, rect = null, hx = -1e4, hy = -1e4, over = false;
  let raf = 0, last = 0, introAt = -1;
  let resolveDone; const done = new Promise((r) => { resolveDone = r; });
  const STAG = 48, HOLD = 260; // intro: per-letter stagger, time spent as a hairline before inflating
  const caret = h1.querySelector('.caret');
  const stats = { frames: 0, ms: 0, max: 0, log: [] };

  function measure() {
    const cs = getComputedStyle(h1);
    base = parseFloat(cs.fontWeight) || 560;
    fs = parseFloat(cs.fontSize);
    h1.classList.add('np-measure');
    for (const el of chars) { el.style.fontWeight = ''; el.style.marginInline = ''; }
    const hr = h1.getBoundingClientRect();
    const wb = chars.map((el) => el.getBoundingClientRect());
    chars.forEach((el) => { el.style.fontWeight = peak; });
    const wp = chars.map((el) => el.getBoundingClientRect().width);
    chars.forEach((el) => { el.style.fontWeight = hairline; });
    const wh = chars.map((el) => el.getBoundingClientRect().width);
    chars.forEach((el) => { el.style.fontWeight = ''; });
    for (let i = 0; i < N; i++) {
      cx[i] = wb[i].left + wb[i].width / 2 - hr.left;
      cy[i] = wb[i].top + wb[i].height * 0.55 - hr.top;
      grow[i] = (wp[i] - wb[i].width) / (peak - base);       // px per wght unit above base
      shrink[i] = (wb[i].width - wh[i]) / (base - hairline);  // px per wght unit below base
    }
    h1.classList.remove('np-measure');
    written.fill(-1);
    rect = null;
  }

  function write(i) {
    const x = w[i];
    if (Math.abs(x - written[i]) < 0.25) return;
    written[i] = x;
    const el = chars[i];
    if (Math.abs(x - base) < 0.25) { el.style.fontWeight = ''; el.style.marginInline = ''; return; }
    // cancel the width change: symmetric negative margins keep the letter centred in its slot
    const dW = x > base ? (x - base) * grow[i] * keep : (x - base) * shrink[i];
    el.style.fontWeight = x.toFixed(1);
    el.style.marginInline = `${(-dW / 2).toFixed(2)}px`;
  }

  function frame(now) {
    raf = 0;
    const t0 = performance.now();
    const dt = Math.max(0, Math.min(0.034, (now - (last || now)) / 1000)); last = Math.max(last, now);
    const sx = spread * fs, sy = spread * fs * 0.8;
    const inIntro = introAt >= 0;
    // hover: under-damped (ζ≈0.61), settles in ~0.45s. intro: softer and bouncier (ζ≈0.5)
    const k = inIntro ? 120 : 240, c = inIntro ? 11 : 19;
    let busy = false;
    for (let i = 0; i < N; i++) {
      let tg = base;
      if (inIntro && now < introAt + i * STAG + HOLD) tg = hairline; // still a hairline
      if (over && !still()) {
        const dx = (cx[i] - hx) / sx, dy = (cy[i] - hy) / sy;
        tg += (peak - base) * Math.exp(-0.5 * (dx * dx + dy * dy));
      }
      if (kickAt[i] >= 0 && now >= kickAt[i]) { v[i] += kickAmt[i]; kickAt[i] = -1; }
      if (kickAt[i] >= 0) busy = true;
      // semi-implicit Euler, sub-stepped for stability at low frame rates
      for (let s = 0; s < 2; s++) {
        const h = dt / 2;
        v[i] += (k * (tg - w[i]) - c * v[i]) * h;
        w[i] += v[i] * h;
      }
      if (w[i] > 900) { w[i] = 900; v[i] = Math.min(0, v[i]); }
      if (w[i] < 100) { w[i] = 100; v[i] = Math.max(0, v[i]); }
      if (Math.abs(tg - w[i]) > 0.3 || Math.abs(v[i]) > 0.3) busy = true;
      else if (tg === base) { w[i] = base; v[i] = 0; }
      write(i);
    }
    if (inIntro && now > introAt + N * STAG + HOLD + 1100) { introAt = -1; h1.classList.remove('np-intro'); resolveDone(); }
    const ms = performance.now() - t0;
    stats.frames++; stats.ms += ms; stats.max = Math.max(stats.max, ms);
    if (busy || introAt >= 0 || over) raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  function local(e) { rect ||= h1.getBoundingClientRect(); return [e.clientX - rect.left, e.clientY - rect.top]; }
  function onMove(e) {
    if (e.pointerType !== 'mouse' || !hover) return;
    const [x, y] = local(e);
    const m = fs * 0.9;
    const inside = x > -m && y > -m * 0.6 && x < rect.width + m && y < rect.height + m * 0.6;
    if (!inside && !over) return;
    // only the text's own extent counts, not the h1's full-width block box
    over = inside && x < Math.max(...cx) + m;
    hx = x; hy = y;
    wake();
  }
  function onLeave() { over = false; wake(); }
  function onDown(e) {
    if (still() || !pulse) return;
    const [x, y] = local(e);
    const now = performance.now();
    for (let i = 0; i < N; i++) {
      const d = Math.hypot(cx[i] - x, cy[i] - y);
      if (d > 900) continue;
      kickAt[i] = now + (d / 540) * 1000;            // field ripple speed: 540px/s
      kickAmt[i] = 2600 * Math.max(0.35, 1 - d / 900); // velocity impulse in wght/s
    }
    wake();
  }
  stage.addEventListener('pointermove', onMove, { passive: true });
  stage.addEventListener('pointerleave', onLeave, { passive: true });
  stage.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('scroll', () => { rect = null; }, { passive: true });
  let rz = 0;
  new ResizeObserver(() => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (introAt < 0) measure(); }); }).observe(h1);

  const doIntro = intro && !still();
  if (doIntro) h1.classList.add('np-intro');
  const fontReady = Promise.race([document.fonts.load(`${base} 1em ${getComputedStyle(h1).fontFamily}`), new Promise((r) => setTimeout(r, 900))]);
  // hide letters until the font is in, so the intro starts from hairlines
  if (doIntro) chars.forEach((el) => { el.style.opacity = '0'; });
  fontReady.then(() => {
    measure();
    w.fill(base);
    if (doIntro) {
      w.fill(hairline);
      for (let i = 0; i < N; i++) write(i);
      introAt = performance.now() + 60;
      chars.forEach((el, i) => {
        el.style.transition = `opacity 360ms cubic-bezier(.23,1,.32,1) ${60 + i * STAG}ms`;
        requestAnimationFrame(() => { el.style.opacity = ''; });
      });
      if (caret) caret.animate([{ opacity: 0, transform: 'scaleY(0.2)' }, { opacity: 1, transform: 'none' }],
        { duration: 500, delay: 60 + N * STAG + HOLD, easing: 'cubic-bezier(.23,1,.32,1)', fill: 'backwards' });
      wake();
    } else resolveDone();
  });

  return { stats, done, get state() { return { over, raf: !!raf, w: Array.from(w).map((x) => Math.round(x)) }; }, pulse: (x, y) => onDown({ clientX: x, clientY: y }) };
}
