// Heat field: a cursor-reactive dot grid that remembers where you've been.
// Dots warm up under the pointer, drift away from it, spring back, and cool
// off over ~1.5s. Clicks send a ripple through the grid. Colours are read
// from CSS custom properties so the canvas always matches the theme.

import { prefersReducedMotion, readColor, mix } from './util.js';

const LEVELS = 24; // heat buckets — one fillStyle per bucket per frame

export function initField(canvas, { host = canvas.parentElement, onStats } = {}) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const reduce = prefersReducedMotion();

  let W = 0, H = 0, dpr = 1, gap = 22, cols = 0, rows = 0, N = 0;
  let heat, spark, ox, oy, vx, vy, bucket, order;
  const counts = new Int32Array(LEVELS);
  const starts = new Int32Array(LEVELS);
  let styles = [], sizes = [];

  const pointer = { x: -1e4, y: -1e4, px: -1e4, py: -1e4, inside: false, speed: 0 };
  const ripples = [];
  let raf = 0, visible = true, last = 0, t0 = performance.now();
  let statsAt = 0, frame = 0;

  function palette() {
    const cs = getComputedStyle(canvas);
    const dot = readColor(cs.getPropertyValue('--field-dot').trim() || '#1a1a1a');
    const a1 = readColor(cs.getPropertyValue('--accent').trim() || '#ff5a1f');
    const a2 = readColor(cs.getPropertyValue('--accent-deep').trim() || '#c2410c');
    const restAlpha = parseFloat(cs.getPropertyValue('--field-dot-alpha')) || 0.18;
    styles = [];
    sizes = [];
    for (let i = 0; i < LEVELS; i++) {
      const h = i / (LEVELS - 1);
      // grey dot → accent at ~0.55 → deep accent at 1
      const c = h < 0.55 ? mix(dot, a1, h / 0.55) : mix(a1, a2, (h - 0.55) / 0.45);
      const alpha = restAlpha + (1 - restAlpha) * Math.min(1, h * 1.6);
      styles.push(`rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha.toFixed(3)})`);
      sizes.push(1.6 + h * 3.4); // px — reads as a dot at rest, a pixel when hot
    }
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gap = W < 640 ? 18 : 22;
    cols = Math.ceil(W / gap) + 1;
    rows = Math.ceil(H / gap) + 1;
    N = cols * rows;
    heat = new Float32Array(N);
    spark = new Float32Array(N);
    for (let i = 0; i < N; i++) if (((i * 2654435761) >>> 0) % 211 === 0) spark[i] = 0.32;
    ox = new Float32Array(N); oy = new Float32Array(N);
    vx = new Float32Array(N); vy = new Float32Array(N);
    bucket = new Uint8Array(N);
    order = new Int32Array(N);
    palette();
    draw(performance.now());
  }

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function onMove(e) {
    const [x, y] = local(e);
    if (!pointer.inside) { pointer.px = x; pointer.py = y; }
    pointer.x = x; pointer.y = y; pointer.inside = true;
    wake();
  }
  function onLeave() { pointer.inside = false; pointer.x = pointer.y = -1e4; }
  function onDown(e) {
    const [x, y] = local(e);
    ripples.push({ x, y, r: 0, life: 1 });
    if (ripples.length > 6) ripples.shift();
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

  function step(now) {
    const dt = Math.min(48, now - (last || now)) / 16.667; // frames @60fps
    last = now;
    frame++;

    // pointer: interpolate along the path so fast flicks leave a continuous trail
    if (pointer.inside) {
      const dx = pointer.x - pointer.px, dy = pointer.y - pointer.py;
      const dist = Math.hypot(dx, dy);
      pointer.speed = pointer.speed * 0.8 + dist * 0.2;
      const steps = Math.min(12, Math.ceil(dist / (gap * 0.75)) || 1);
      const energy = Math.min(1, 0.05 + pointer.speed / 40);
      for (let s = 1; s <= steps; s++) {
        const k = s / steps;
        stir(pointer.px + dx * k, pointer.py + dy * k, 110, (0.09 * energy) / steps * 4, (0.9 * energy) / steps * 2);
      }
      pointer.px = pointer.x; pointer.py = pointer.y;
    }

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
    let energy = 0;
    for (let i = 0; i < N; i++) {
      let h = heat[i];
      if (h > 0.0005) { h *= cool; heat[i] = h; energy += h; } else heat[i] = 0;
      if (ox[i] !== 0 || oy[i] !== 0 || vx[i] !== 0 || vy[i] !== 0) {
        vx[i] = (vx[i] - ox[i] * 0.07 * dt) * damp;
        vy[i] = (vy[i] - oy[i] * 0.07 * dt) * damp;
        ox[i] += vx[i] * dt; oy[i] += vy[i] * dt;
        if (Math.abs(ox[i]) < 0.02 && Math.abs(vx[i]) < 0.02) { ox[i] = 0; vx[i] = 0; }
        if (Math.abs(oy[i]) < 0.02 && Math.abs(vy[i]) < 0.02) { oy[i] = 0; vy[i] = 0; }
      }
    }
    return energy;
  }

  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    const t = (now - t0) / 1000;
    // ambient: a slow diagonal swell so the grid breathes when idle
    const amb = reduce ? 0 : 1;
    counts.fill(0);
    for (let r = 0, i = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, i++) {
        const wave = amb ? Math.max(0, Math.sin((c * 0.16 + r * 0.1) - t * 0.9)) : 0;
        const h = Math.min(1, Math.max(heat[i] + wave * wave * wave * 0.1, spark[i]));
        const b = Math.min(LEVELS - 1, (h * (LEVELS - 1) + 0.5) | 0);
        bucket[i] = b;
        counts[b]++;
      }
    }
    let acc = 0;
    for (let b = 0; b < LEVELS; b++) { starts[b] = acc; acc += counts[b]; }
    const fill = starts.slice();
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
    if (!visible) return;
    const energy = step(now);
    draw(now);
    if (onStats && now - statsAt > 120) {
      statsAt = now;
      onStats({ temp: Math.min(1, energy / 60), x: pointer.inside ? pointer.x : null, y: pointer.inside ? pointer.y : null, dots: N });
    }
    // Keep animating while anything is moving; ambient-only frames when idle.
    // With reduced motion we stop entirely once things settle.
    const busy = energy > 0.01 || ripples.length || pointer.inside;
    if (busy || !reduce) raf = requestAnimationFrame(loop);
  }
  function wake() { if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(loop); } }

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    if (visible) wake();
  });
  io.observe(canvas);
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    if (visible) wake();
  });

  host.addEventListener('pointermove', onMove, { passive: true });
  host.addEventListener('pointerdown', onDown, { passive: true });
  host.addEventListener('pointerleave', onLeave, { passive: true });

  resize();
  wake();

  return {
    repaint() { palette(); wake(); },
    pulse(x = W * 0.5, y = H * 0.5) { ripples.push({ x, y, r: 0, life: 1 }); wake(); },
  };
}
