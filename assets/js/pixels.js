// Pixel displays for project cards. Each one shows the project's job as a
// transformation: messy input (grey) on the left, structured output (thermal
// gradient) behind a scan line that sweeps across on hover / focus, or when
// scrolled into view on touch devices.
//
// kinds: doc → report, web → table, trace → prompt diff, sms → answers

import { prefersReducedMotion, readColor, mix, clamp } from './util.js';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function patterns(kind, cols, rows, seed) {
  const R = rng(seed);
  const messy = new Uint8Array(cols * rows);
  const clean = new Uint8Array(cols * rows);
  const set = (arr, c, r) => { if (c >= 0 && c < cols && r >= 0 && r < rows) arr[r * cols + c] = 1; };

  if (kind === 'doc') {
    // dense paragraphs → bar chart summary
    for (let r = 1; r < rows - 1; r += 2) {
      let c = 1;
      const end = cols - 1 - ((R() * 8) | 0);
      while (c < end) {
        const w = 2 + ((R() * 6) | 0);
        for (let k = 0; k < w && c + k < end; k++) set(messy, c + k, r);
        c += w + 1;
      }
    }
    for (let c = 2; c < cols - 2; c += 4) {
      const h = 2 + ((R() * (rows - 4)) | 0);
      for (let r = rows - 2; r > rows - 2 - h; r--) { set(clean, c, r); set(clean, c + 1, r); set(clean, c + 2, r); }
    }
  } else if (kind === 'web') {
    // html soup → table
    for (let i = 0; i < cols * rows; i++) if (R() < 0.3) messy[i] = 1;
    for (let r = 1; r < rows; r += 3) {
      for (let c = 1; c < cols - 1; c++) if (c % 12 === 0 || R() < 0.82) set(clean, c, r);
    }
  } else if (kind === 'trace') {
    // agent trace spans (a waterfall) → a tidy prompt diff (+/- lines)
    let start = 1;
    for (let r = 1; r < rows - 1; r += 2) {
      const len = 3 + ((R() * (cols * 0.45)) | 0);
      for (let c = start; c < Math.min(cols - 1, start + len); c++) set(messy, c, r);
      start = clamp(start + ((R() * 8) | 0) - 1, 1, cols - 8);
    }
    for (let r = 2; r < rows - 1; r += 2) {
      set(clean, 1, r); set(clean, 2, r); // gutter marker
      const len = 6 + ((R() * (cols - 14)) | 0);
      for (let c = 5; c < 5 + len && c < cols - 1; c++) if (R() > 0.1) set(clean, c, r);
    }
  } else {
    // sms bubbles (scattered, uneven) → aligned answer cards
    for (let b = 0; b < 6; b++) {
      const w = 6 + ((R() * 14) | 0), h = 2 + ((R() * 2) | 0);
      const c0 = R() < 0.5 ? 1 + ((R() * 6) | 0) : cols - w - 1 - ((R() * 6) | 0);
      const r0 = 1 + ((R() * (rows - h - 2)) | 0);
      for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) if (R() > 0.2) set(messy, c, r);
    }
    for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
      const cardRow = (r - 1) % 5;
      if (cardRow === 0 || cardRow === 3) { if (c % 16 !== 0) set(clean, c, r); }
      else if (cardRow === 1 && c % 16 === 1) set(clean, c, r);
      else if (cardRow === 2 && c % 16 > 2 && c % 16 < 4 + ((R() * 10) | 0)) set(clean, c, r);
    }
  }
  return { messy, clean };
}

const HQ = 8; // heat quantization
const CB = 16; // colour buckets across the width

export function initPixels(canvas) {
  const card = canvas.closest('[data-pixel-host]') || canvas.parentElement;
  const kind = canvas.dataset.kind || 'doc';
  const seed = parseInt(canvas.dataset.seed || '7', 10);
  const ctx = canvas.getContext('2d');
  const reduce = prefersReducedMotion();
  const hoverable = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  let W = 0, H = 0, cols = 0, rows = 0, cell = 7, dot = 5, pat, heat;
  let progress = 0, target = 0, raf = 0, visible = false, last = 0;
  let L = null; // style lookup tables
  const ptr = { x: -1e4, y: -1e4, fresh: false };

  function palette() {
    const cs = getComputedStyle(canvas);
    const get = (v) => readColor(cs.getPropertyValue(v).trim());
    const ink = get('--ink');
    const offCss = cs.getPropertyValue('--pixel-off').trim();
    const th = ['--th-2', '--th-3', '--th-4', '--th-5', '--th-6', '--th-7', '--th-8'].map(get);
    const hot = get('--th-9');
    const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
    const along = (t) => { const p = t * (th.length - 1), k = Math.min(th.length - 2, Math.floor(p)); return mix(th[k], th[k + 1], p - k); };
    L = { off: [], messy: [], clean: [], front: [] };
    for (let h = 0; h <= HQ; h++) {
      const t = h / HQ, c = along(0.35 + t * 0.65);
      L.off.push(h ? rgba(c, 0.25 + t * 0.55) : offCss);
      L.messy.push(h ? rgba(c, 0.55 + t * 0.45) : rgba(ink, 0.3));
    }
    for (let b = 0; b < CB; b++) L.clean.push(rgba(along(b / (CB - 1)), 0.92));
    for (let f = 1; f <= 4; f++) L.front.push(rgba(mix(th[5], hot, f / 4), 0.35 + f * 0.15));
  }

  function layout() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell = W < 420 ? 6 : 7;
    dot = cell - 2;
    cols = Math.floor(W / cell); rows = Math.floor(H / cell);
    pat = patterns(kind, cols, rows, seed);
    heat = new Float32Array(cols * rows);
    if (reduce) progress = target = 0.5;
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const ox = (W - cols * cell) / 2 + 1, oy = (H - rows * cell) / 2 + 1;
    const front = progress * (cols + 6) - 3; // scan column (fractional)
    let hot = 0;
    const fresh = ptr.fresh && !reduce;
    ptr.fresh = false;
    for (let r = 0; r < rows; r++) {
      const py = oy + r * cell;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const px = ox + c * cell;
        if (fresh) {
          const dist = Math.hypot(px + dot / 2 - ptr.x, py + dot / 2 - ptr.y);
          if (dist < 48) heat[i] = Math.min(1, heat[i] + (1 - dist / 48) * 0.35);
        }
        let h = heat[i];
        if (h > 0.01) { heat[i] = h *= 0.9; hot++; } else h = heat[i] = 0;
        const done = c < front;
        const on = done ? pat.clean[i] : pat.messy[i];
        const d = Math.abs(c - front);
        const fq = d < 2.5 ? Math.ceil((1 - d / 2.5) * 4) : 0;
        const hq = Math.round(h * HQ);
        let style;
        if (fq && (on || fq > 2)) style = L.front[fq - 1];
        else if (on) style = done ? L.clean[Math.min(CB - 1, ((c / cols) * CB) | 0)] : L.messy[hq];
        else style = L.off[hq];
        ctx.fillStyle = style;
        ctx.fillRect(px, py, dot, dot);
      }
    }
    return hot > 0;
  }

  function loop(now) {
    raf = 0;
    if (!visible) return;
    const dt = Math.min(48, now - (last || now)) / 1000;
    last = now;
    if (progress !== target) {
      const dir = Math.sign(target - progress);
      progress = clamp(progress + dir * 0.9 * dt, 0, 1); // full sweep ≈ 1.1s
      if ((dir > 0 && progress >= target) || (dir < 0 && progress <= target)) progress = target;
    }
    const hot = draw();
    if (progress !== target || hot) raf = requestAnimationFrame(loop);
  }
  const wake = () => { if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(loop); } };

  if (!reduce) {
    if (hoverable) {
      card.addEventListener('pointerenter', () => { target = 1; wake(); });
      card.addEventListener('pointerleave', () => { target = 0; wake(); });
    }
    card.addEventListener('focusin', () => { target = 1; wake(); });
    card.addEventListener('focusout', (e) => { if (!card.contains(e.relatedTarget)) { target = 0; wake(); } });
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top; ptr.fresh = true; wake();
    });
  }

  new ResizeObserver(() => layout()).observe(canvas);
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    // touch devices: play the transformation once it's comfortably in view
    if (!hoverable && !reduce) target = e.intersectionRatio > 0.6 ? 1 : 0;
    if (visible) wake();
  }, { threshold: [0, 0.6] }).observe(canvas);

  palette();
  layout();
  return { repaint() { palette(); draw(); } };
}
