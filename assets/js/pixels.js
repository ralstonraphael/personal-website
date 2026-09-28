// Pixel displays for project cards. Each one shows the project's job as a
// transformation: messy input on the left, structured output behind a scan
// line that sweeps across on hover (or when scrolled into view on touch).
//
// kinds: doc → report, web → table, wave → prompt, ticket → sheet

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
      for (let c = 1; c < cols - 1; c++) {
        const isSep = c % 12 === 0;
        if (isSep || R() < 0.82) set(clean, c, r);
      }
    }
  } else if (kind === 'wave') {
    // call audio → prompt text
    const mid = (rows - 1) / 2;
    for (let c = 1; c < cols - 1; c += 2) {
      const a = Math.abs(Math.sin(c * 0.21) * Math.sin(c * 0.057 + 1.3)) * mid * (0.35 + R() * 0.75);
      for (let r = Math.round(mid - a); r <= Math.round(mid + a); r++) set(messy, c, r);
    }
    for (let r = 2; r < rows - 1; r += 2) {
      const indent = r === 2 ? 1 : 3;
      const len = r === 2 ? 10 : 8 + ((R() * (cols - 16)) | 0);
      for (let c = indent; c < indent + len && c < cols - 1; c++) if (R() > 0.08) set(clean, c, r);
    }
  } else {
    // handwriting strokes → spreadsheet grid
    for (let s = 0; s < 7; s++) {
      let c = 1 + ((R() * (cols - 8)) | 0), r = 1 + ((R() * (rows - 2)) | 0);
      for (let k = 0; k < 18; k++) {
        set(messy, c, r);
        c += R() < 0.75 ? 1 : 0;
        r += R() < 0.33 ? -1 : R() < 0.5 ? 1 : 0;
        r = clamp(r, 1, rows - 2);
      }
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (r % 4 === 0 || c % 9 === 0) set(clean, c, r);
      else if (r % 4 === 2 && c % 9 > 1 && c % 9 < 2 + ((R() * 6) | 0)) set(clean, c, r);
    }
  }
  return { messy, clean };
}

export function initPixels(canvas) {
  const card = canvas.closest('[data-pixel-host]') || canvas.parentElement;
  const kind = canvas.dataset.kind || 'doc';
  const seed = parseInt(canvas.dataset.seed || '7', 10);
  const ctx = canvas.getContext('2d');
  const reduce = prefersReducedMotion();
  const hoverable = window.matchMedia('(hover: hover)').matches;

  let W = 0, H = 0, cols = 0, rows = 0, cell = 7, dot = 5, pat;
  let progress = 0, target = 0, raf = 0, visible = false, last = 0;
  let colors = null;
  const ptr = { x: -1e4, y: -1e4, on: false };
  const heat = { data: null };

  function palette() {
    const cs = getComputedStyle(canvas);
    colors = {
      off: readColor(cs.getPropertyValue('--heat-0').trim()),
      ink: readColor(cs.getPropertyValue('--ink').trim()),
      accent: readColor(cs.getPropertyValue('--accent').trim()),
    };
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
    heat.data = new Float32Array(cols * rows);
    if (reduce) progress = target = 0.5;
    draw();
  }

  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const ox = (W - cols * cell) / 2 + 1, oy = (H - rows * cell) / 2 + 1;
    const front = progress * (cols + 6) - 3; // scan column (fractional)
    let hot = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const done = c < front;
        const on = done ? pat.clean[i] : pat.messy[i];
        const d = Math.abs(c - front);
        const flash = d < 2.5 ? 1 - d / 2.5 : 0;
        // pointer heat
        if (ptr.on && !reduce) {
          const px = ox + c * cell + dot / 2, py = oy + r * cell + dot / 2;
          const dist = Math.hypot(px - ptr.x, py - ptr.y);
          if (dist < 48) heat.data[i] = Math.min(1, heat.data[i] + (1 - dist / 48) * 0.25);
        }
        const h = heat.data[i];
        if (h > 0.002) { heat.data[i] = h * 0.9; hot++; } else heat.data[i] = 0;

        let col, a;
        if (on) {
          col = flash ? mix(colors.ink, colors.accent, flash) : done ? colors.ink : colors.ink;
          a = done ? 0.9 : 0.42;
          if (h) { col = mix(col, colors.accent, h); a = Math.max(a, 0.5 + h * 0.5); }
        } else {
          col = flash > 0.6 ? mix(colors.off, colors.accent, (flash - 0.6) * 0.6) : colors.off;
          a = 1;
          if (h) { col = mix(colors.off, colors.accent, h * 0.5); }
        }
        ctx.fillStyle = rgb(col, a);
        ctx.fillRect(ox + c * cell, oy + r * cell, dot, dot);
      }
    }
    return hot > 0;
  }

  function loop(now) {
    raf = 0;
    if (!visible) return;
    const dt = Math.min(48, now - (last || now)) / 1000;
    last = now;
    const speed = 0.9; // full sweep ≈ 1.1s
    if (progress !== target) {
      const dir = Math.sign(target - progress);
      progress = clamp(progress + dir * speed * dt, 0, 1);
      if ((dir > 0 && progress >= target) || (dir < 0 && progress <= target)) progress = target;
    }
    const hot = draw();
    if (progress !== target || hot || ptr.on) raf = requestAnimationFrame(loop);
  }
  const wake = () => { if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(loop); } };

  if (!reduce) {
    if (hoverable) {
      card.addEventListener('pointerenter', () => { target = 1; wake(); });
      card.addEventListener('pointerleave', () => { target = 0; ptr.on = false; wake(); });
      card.addEventListener('focusin', () => { target = 1; wake(); });
      card.addEventListener('focusout', () => { target = 0; wake(); });
    }
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top; ptr.on = true; wake();
    });
    canvas.addEventListener('pointerleave', () => { ptr.on = false; });
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
