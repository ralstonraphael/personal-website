// Thermal field: a pixel heat map that doubles as the page background.
// A few slow "plumes" drift across the grid; the pointer adds heat, pushes
// pixels around and leaves a cooling trail; clicks send a ripple through it.
// Low heat renders as a small grey dot, high heat as a full-size pixel coloured
// along a thermal ramp (ice → blue → violet → red → orange → yellow), so hot
// regions read as a pixelated gradient. Colours come from CSS custom props.

import { scroll } from './smooth.js';
import { prefersReducedMotion, motion, readColor, mix } from './util.js';

const LEVELS = 40; // heat buckets: one fillStyle per bucket per frame
const STOPS = ['--th-1', '--th-2', '--th-3', '--th-4', '--th-5', '--th-6', '--th-7', '--th-8', '--th-9'];

// Plume presets: positions/radii are fractions of the canvas, drift is slow.
const PRESETS = {
  // hero: one plume behind the agent log, one behind the stat cards, a faint third up top
  hero: [
    { x: 0.83, y: 0.42, r: 0.095, a: 0.98, fx: 0.11, fy: 0.07, ax: 0.035, ay: 0.03 },
    { x: 0.70, y: 0.86, r: 0.07, a: 0.8, fx: 0.08, fy: 0.13, ax: 0.05, ay: 0.02 },
    { x: 1.0, y: 0.17, r: 0.05, a: 0.55, fx: 0.14, fy: 0.09, ax: 0.015, ay: 0.02 },
  ],
  heroNarrow: [
    { x: 0.96, y: 0.19, r: 0.16, a: 0.9, fx: 0.10, fy: 0.08, ax: 0.04, ay: 0.015 },
    { x: 0.08, y: 0.95, r: 0.14, a: 0.6, fx: 0.08, fy: 0.12, ax: 0.05, ay: 0.01 },
  ],
  calm: [
    { x: 0.9, y: 0.55, r: 0.11, a: 0.9, fx: 0.07, fy: 0.09, ax: 0.03, ay: 0.08 },
    { x: 0.68, y: 0.98, r: 0.08, a: 0.6, fx: 0.1, fy: 0.06, ax: 0.05, ay: 0.02 },
  ],
};

export function initField(canvas, { host = canvas.parentElement, preset = 'hero', avoid = '', avoidBoxes = '', onStats } = {}) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const reduce = prefersReducedMotion();

  let W = 0, H = 0, dpr = 1, gap = 22, cols = 0, rows = 0, N = 0, maxS = 20;
  let heat, amb, damp, ox, oy, vx, vy, bucket, order;
  const counts = new Int32Array(LEVELS);
  const starts = new Int32Array(LEVELS);
  const fill = new Int32Array(LEVELS);
  let styles = [], sizes = [];
  let plumes = PRESETS[preset];

  const pointer = { x: -1e4, y: -1e4, px: -1e4, py: -1e4, inside: false, speed: 0 };
  const ripples = [];
  let raf = 0, inView = false, pageVisible = !document.hidden, last = 0, t0 = performance.now();
  let statsAt = 0, frame = 0, lastInput = performance.now();
  let rect = null; // cached canvas rect; invalidated on scroll/resize
  let floor = 0.12; // how much heat survives behind text (0..1)
  let chill = 0; // 0 = full ambient heat, 1 = mostly cooled (scrolled away)

  const still = () => reduce || !motion.on;
  const visible = () => inView && pageVisible;

  function palette() {
    const cs = getComputedStyle(canvas);
    const dot = readColor(cs.getPropertyValue('--field-dot').trim() || '#1a1a1a');
    const restAlpha = parseFloat(cs.getPropertyValue('--field-dot-alpha')) || 0.17;
    const maxAlpha = parseFloat(cs.getPropertyValue('--field-max-alpha')) || 1;
    floor = parseFloat(cs.getPropertyValue('--field-text-floor')) || 0.12;
    const ramp = STOPS.map((v) => readColor(cs.getPropertyValue(v).trim() || '#ff4f1a'));
    styles = []; sizes = [];
    for (let i = 0; i < LEVELS; i++) {
      const h = i / (LEVELS - 1);
      let c, alpha;
      if (h < 0.1) { // resting dot fades into the first thermal stop
        c = mix(dot, ramp[0], h / 0.1);
        alpha = restAlpha + (0.5 - restAlpha) * (h / 0.1);
      } else {
        const p = ((h - 0.1) / 0.9) * (ramp.length - 1);
        const k = Math.min(ramp.length - 2, Math.floor(p));
        c = mix(ramp[k], ramp[k + 1], p - k);
        alpha = Math.min(maxAlpha, 0.5 + (h - 0.1) * 1.2);
      }
      styles.push(`rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha.toFixed(3)})`);
      // dot at rest → full pixel when hot (smoothstep 0.12..0.8)
      const s = Math.min(1, Math.max(0, (h - 0.12) / 0.68));
      sizes.push(1.6 + (maxS - 1.6) * s * s * (3 - 2 * s));
    }
  }

  function resize() {
    rect = null;
    const r = canvas.getBoundingClientRect();
    // chunky pixels don't need retina resolution; capping keeps fill cost down
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gap = W < 640 ? 18 : 22;
    maxS = gap - 7;
    if (preset === 'hero') plumes = W < 900 ? PRESETS.heroNarrow : PRESETS.hero;
    cols = Math.ceil(W / gap) + 1;
    rows = Math.ceil(H / gap) + 1;
    N = cols * rows;
    heat = new Float32Array(N); amb = new Float32Array(N); damp = new Float32Array(N).fill(1);
    ox = new Float32Array(N); oy = new Float32Array(N);
    vx = new Float32Array(N); vy = new Float32Array(N);
    bucket = new Uint8Array(N);
    order = new Int32Array(N);
    palette();
    measureText();
    ambient(performance.now());
    draw();
  }

  // Keep text legible: find every line of text we must not heat, and make the
  // cells behind it "cold". Heat flows around the words instead of under them.
  function measureText() {
    if (!damp) return;
    damp.fill(1);
    if (!avoid && !avoidBoxes) return;
    const cr = canvas.getBoundingClientRect();
    const boxes = [];
    // whole boxes (cards, chips): heat shouldn't smear through their glass
    if (avoidBoxes) host.querySelectorAll(avoidBoxes).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) boxes.push([r.left - cr.left, r.top - cr.top, r.right - cr.left, r.bottom - cr.top]);
    });
    if (avoid) host.querySelectorAll(avoid).forEach((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const r of range.getClientRects()) {
        if (r.width > 1 && r.height > 1) boxes.push([r.left - cr.left, r.top - cr.top, r.right - cr.left, r.bottom - cr.top]);
      }
    });
    const pad = 6, feather = 30, reach = pad + feather;
    for (const [x0, y0, x1, y1] of boxes) {
      const c0 = Math.max(0, Math.floor((x0 - reach) / gap)), c1 = Math.min(cols - 1, Math.ceil((x1 + reach) / gap));
      const r0 = Math.max(0, Math.floor((y0 - reach) / gap)), r1 = Math.min(rows - 1, Math.ceil((y1 + reach) / gap));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const x = c * gap, y = r * gap;
          const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
          const d = Math.max(0, Math.hypot(dx, dy) - pad) / feather;
          const t = Math.min(1, d);
          const f = floor + (1 - floor) * t * t * (3 - 2 * t);
          const i = r * cols + c;
          if (f < damp[i]) damp[i] = f;
        }
      }
    }
  }

  function local(e) {
    rect ||= canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onMove(e) {
    const [x, y] = local(e);
    if (!pointer.inside) { pointer.px = x; pointer.py = y; }
    pointer.x = x; pointer.y = y; pointer.inside = true;
    lastInput = performance.now();
    wake();
  }
  function onLeave() { pointer.inside = false; pointer.x = pointer.y = -1e4; }
  function onDown(e) {
    const [x, y] = local(e);
    ripples.push({ x, y, r: 0, life: 1 });
    if (ripples.length > 6) ripples.shift();
    lastInput = performance.now();
    wake();
  }

  // Heat + push dots around a point, only touching cells within radius.
  function stir(x, y, radius, heatAmt, push) {
    const c0 = Math.max(0, Math.floor((x - radius) / gap));
    const c1 = Math.min(cols - 1, Math.ceil((x + radius) / gap));
    const r0 = Math.max(0, Math.floor((y - radius) / gap));
    const r1 = Math.min(rows - 1, Math.ceil((y + radius) / gap));
    const r2 = radius * radius;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        const dx = c * gap + ox[i] - x, dy = r * gap + oy[i] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2) || 1;
        const f = 1 - d / radius;
        const ff = f * f;
        heat[i] = Math.min(1, heat[i] + heatAmt * ff);
        if (push && !reduce) { vx[i] += (dx / d) * push * ff; vy[i] += (dy / d) * push * ff; }
      }
    }
  }

  // Ambient plumes: sum of drifting gaussians, written into amb[].
  function ambient(now) {
    const t = still() ? 0 : (now - t0) / 1000;
    const S = Math.min(Math.max(W, H), W * 1.4);
    const P = plumes.map((p) => ({
      x: (p.x + Math.sin(t * p.fx + p.x * 9) * p.ax) * W,
      y: (p.y + Math.cos(t * p.fy + p.y * 7) * p.ay) * H,
      k: 1 / (2 * (p.r * S) ** 2),
      a: p.a * (0.9 + 0.1 * Math.sin(t * 0.5 + p.x * 5)),
    }));
    for (let r = 0, i = 0; r < rows; r++) {
      const y = r * gap;
      for (let c = 0; c < cols; c++, i++) {
        const x = c * gap;
        let v = 0;
        for (let k = 0; k < P.length; k++) {
          const dx = x - P[k].x, dy = y - P[k].y;
          v += P[k].a * Math.exp(-(dx * dx + dy * dy) * P[k].k);
        }
        amb[i] = v;
      }
    }
  }

  function step(now) {
    const dt = Math.min(48, now - (last || now)) / 16.667; // frames @60fps
    last = now;
    frame++;

    // pointer: interpolate along the path so fast flicks leave a continuous trail
    if (pointer.inside) {
      const dx = pointer.x - pointer.px, dy = pointer.y - pointer.py;
      const dist = Math.hypot(dx, dy);
      pointer.speed = pointer.speed * 0.8 + dist * 0.2;
      if (dist > 0.1) {
        const steps = Math.min(12, Math.ceil(dist / (gap * 0.75)) || 1);
        const energy = Math.min(1, 0.05 + pointer.speed / 40);
        for (let s = 1; s <= steps; s++) {
          const k = s / steps;
          stir(pointer.px + dx * k, pointer.py + dy * k, 120, (0.1 * energy) / steps * 4, (0.9 * energy) / steps * 2);
        }
      }
      pointer.px = pointer.x; pointer.py = pointer.y;
    } else pointer.speed *= 0.8;

    // ripples: an expanding ring that heats and shoves what it passes
    for (let k = ripples.length - 1; k >= 0; k--) {
      const rp = ripples[k];
      rp.r += 9 * dt;
      rp.life -= 0.012 * dt;
      if (rp.life <= 0 || rp.r > Math.max(W, H) * 1.2) { ripples.splice(k, 1); continue; }
      const band = 26;
      const outer = rp.r + band, inner = Math.max(0, rp.r - band);
      const c0 = Math.max(0, Math.floor((rp.x - outer) / gap)), c1 = Math.min(cols - 1, Math.ceil((rp.x + outer) / gap));
      const r0 = Math.max(0, Math.floor((rp.y - outer) / gap)), r1 = Math.min(rows - 1, Math.ceil((rp.y + outer) / gap));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * cols + c;
          const dx = c * gap - rp.x, dy = r * gap - rp.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < inner || d > outer) continue;
          const f = (1 - Math.abs(d - rp.r) / band) * rp.life;
          heat[i] = Math.min(1, heat[i] + 0.12 * f * dt);
          if (!reduce) { vx[i] += (dx / d) * 0.55 * f * dt; vy[i] += (dy / d) * 0.55 * f * dt; }
        }
      }
    }

    // integrate: springs, damping, cooling
    const cool = Math.pow(0.972, dt);
    const damp = Math.pow(0.84, dt);
    let energy = 0, moving = 0;
    for (let i = 0; i < N; i++) {
      let h = heat[i];
      if (h > 0.0005) { h *= cool; heat[i] = h; energy += h; } else heat[i] = 0;
      if (ox[i] !== 0 || oy[i] !== 0 || vx[i] !== 0 || vy[i] !== 0) {
        vx[i] = (vx[i] - ox[i] * 0.07 * dt) * damp;
        vy[i] = (vy[i] - oy[i] * 0.07 * dt) * damp;
        ox[i] += vx[i] * dt; oy[i] += vy[i] * dt;
        if (Math.abs(ox[i]) < 0.02 && Math.abs(vx[i]) < 0.02) { ox[i] = 0; vx[i] = 0; }
        if (Math.abs(oy[i]) < 0.02 && Math.abs(vy[i]) < 0.02) { oy[i] = 0; vy[i] = 0; }
        moving++;
      }
    }
    return { energy, moving };
  }

  function draw() {
    const ambK = 1 - 0.75 * chill;
    ctx.clearRect(0, 0, W, H);
    counts.fill(0);
    for (let i = 0; i < N; i++) {
      const h = Math.min(1, (heat[i] + amb[i] * ambK) * damp[i]);
      const b = Math.min(LEVELS - 1, (h * (LEVELS - 1) + 0.5) | 0);
      bucket[i] = b;
      counts[b]++;
    }
    let acc = 0;
    for (let b = 0; b < LEVELS; b++) { starts[b] = acc; acc += counts[b]; }
    fill.set(starts);
    for (let i = 0; i < N; i++) order[fill[bucket[i]]++] = i;
    for (let b = 0; b < LEVELS; b++) {
      const n = counts[b];
      if (!n) continue;
      ctx.fillStyle = styles[b];
      const s = sizes[b], hs = s / 2;
      const end = starts[b] + n;
      for (let k = starts[b]; k < end; k++) {
        const i = order[k];
        const c = i % cols, r = (i / cols) | 0;
        ctx.fillRect(c * gap + ox[i] - hs, r * gap + oy[i] - hs, s, s);
      }
    }
  }

  function loop(now) {
    raf = 0;
    if (!visible()) return;
    const { energy, moving } = step(now);
    const interacting = pointer.speed > 0.05 || ripples.length > 0 || energy > 0.01 || moving > 0;
    // mid-fling the field is a blur anyway: skip ambient frames so the glass above
    // it doesn't have to re-blur while the page flies past
    if (!interacting && scroll.smooth && Math.abs(scroll.v) > 12) { raf = requestAnimationFrame(loop); return; }
    // Plumes drift slowly, so ambient-only frames run at 30fps, dropping to
    // ~15fps after 12s without input. Interaction always gets full rate.
    const idleFor = now - lastInput;
    const skip = interacting ? 1 : idleFor > 12000 ? 4 : 2;
    if (!still() && frame % skip === 0) ambient(now);
    if (interacting || frame % skip === 0) draw();
    if (onStats && now - statsAt > 120) {
      statsAt = now;
      onStats({ temp: Math.min(1, energy / 60), x: pointer.inside ? pointer.x : null, y: pointer.inside ? pointer.y : null });
    }
    if (interacting || !still()) raf = requestAnimationFrame(loop);
  }
  function wake() { if (!raf && visible()) { last = performance.now(); raf = requestAnimationFrame(loop); } }

  new ResizeObserver(() => resize()).observe(canvas);
  if (avoid || avoidBoxes) {
    const remeasure = () => { measureText(); draw(); };
    document.fonts?.ready.then(remeasure);
    setTimeout(remeasure, 2300); // after the intro choreography lands
    new ResizeObserver(remeasure).observe(host);
  }
  new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; wake(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => { pageVisible = !document.hidden; wake(); });
  window.addEventListener('scroll', () => { rect = null; }, { passive: true });
  motion.subscribe(() => { ambient(performance.now()); draw(); wake(); });

  host.addEventListener('pointermove', onMove, { passive: true });
  host.addEventListener('pointerdown', onDown, { passive: true });
  host.addEventListener('pointerleave', onLeave, { passive: true });

  resize();
  wake();

  return {
    repaint() { palette(); measureText(); draw(); wake(); },
    remeasure() { measureText(); draw(); },
    // scroll-linked: the plumes cool toward blue as the section leaves view
    setCool(k) {
      if (Math.abs(k - chill) < 0.005) return;
      chill = k;
      if (!raf && visible()) draw();
    },
  };
}
