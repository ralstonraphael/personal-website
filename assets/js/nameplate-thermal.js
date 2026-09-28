// Thermal nameplate: the hero name seen through a thermal sensor.
//  - intro: the name "develops" from hot pixels that cool down into ink
//  - hover (fine pointer): a lens follows the cursor; inside it the crisp glyphs
//    are masked away and the same glyphs are shown as hot pixels, leaving a
//    short trail that cools back to ink colour
//  - click / tap: a heat ring travels through the letters (in sync with the
//    field's own ripple, same speed)
// The DOM text is never replaced: it stays selectable/accessible and the field's
// text-avoid system keeps measuring `.hero-name .line > span` as before.
// Idle = zero work: the rAF loop stops as soon as nothing is warm.

import { prefersReducedMotion, motion, readColor, mix } from './util.js';

const RAMP = ['--th-3', '--th-4', '--th-5', '--th-6', '--th-7', '--th-8', '--th-9']; // T=0 is ink
const LEVELS = 40;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (i) => { let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function initThermalName(h1, {
  stage = h1.closest('.stage') || document.body,
  lattice = () => (innerWidth < 640 ? 18 : 22), // field.js grid gap; lens pixels sit on a 1/3 sub-grid of it
  intro = true,
  hotEnd = null, // light mode: cap the ramp before yellow (poor contrast on paper)
  after = null,  // promise: wait for another intro (e.g. the weight inflate) to settle before rasterising
} = {}) {
  const reduce = prefersReducedMotion();
  const still = () => reduce || !motion.on;

  const canvas = document.createElement('canvas');
  canvas.className = 'name-heat';
  canvas.setAttribute('aria-hidden', 'true');
  h1.insertAdjacentElement('afterend', canvas);
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, dpr = 1, P = 0, s = 7, fill = 6, cols = 0, rows = 0, fs = 144, R = 130;
  let offX = 0, offY = 0;               // canvas origin relative to the h1 border box
  let bounds = [0, 0, 0, 0];            // text bounds in canvas coords (hover zone)
  let cov, cx, cy, heat, seed, base, glyph = new Int32Array(0);
  let caretBox = null, stopCount = 7;
  let outI = new Int32Array(0), outL = new Uint8Array(0), outS = new Float32Array(0), order = new Int32Array(0);
  const counts = new Int32Array(LEVELS), starts = new Int32Array(LEVELS), fillAt = new Int32Array(LEVELS);
  let styles = [];
  let ready = false, rect = null, lastMask = '', warm = 0;
  const L = { x: 0, y: 0, r: 0, tx: 0, ty: 0, tr: 0, on: false, speed: 0 };
  const rings = [];
  let introAt = -1;
  const INTRO = { sweep: 600, hold: 520 }; // ms
  INTRO.gone = INTRO.hold + 0.28 * INTRO.sweep + 90; // a cell leaves only once the crisp front has passed it
  let raf = 0, last = 0, tick = 0, noiseAt = 0, noiseSeed = 0;
  const stats = { frames: 0, ms: 0, max: 0, cells: 0, log: [] };

  // ---------- palette: ink → blue → violet → magenta → red → orange → amber (→ yellow)
  function palette() {
    const cs = getComputedStyle(h1);
    const ink = readColor(cs.color);
    const dark = document.documentElement.dataset.theme === 'dark';
    const ramp = (hotEnd ?? (dark ? RAMP : RAMP.slice(0, -1))).map((v) => readColor(cs.getPropertyValue(v).trim() || '#f50'));
    const stops = [ink, ...ramp];
    stopCount = stops.length;
    styles = [];
    for (let l = 0; l < LEVELS; l++) {
      const p = (l / (LEVELS - 1)) * (stops.length - 1);
      const k = Math.min(stops.length - 2, Math.floor(p));
      const c = mix(stops[k], stops[k + 1], p - k);
      styles.push(`rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`);
    }
  }

  // ---------- rasterise the name where the browser laid it out, then bin it into cells
  function measure() {
    const spans = [...h1.querySelectorAll('.line > span')];
    if (!spans.length) return;
    h1.classList.add('np-measure'); // measure the resting layout, not the slide-up transform
    const hr = h1.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const cs = getComputedStyle(h1);
    fs = parseFloat(cs.fontSize);
    P = Math.round(fs * 0.3);
    R = Math.max(64, Math.min(170, fs * 0.95));
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    for (const sp of spans) {
      const r = sp.getBoundingClientRect();
      bx0 = Math.min(bx0, r.left); by0 = Math.min(by0, r.top); bx1 = Math.max(bx1, r.right); by1 = Math.max(by1, r.bottom);
    }
    const left = bx0 - P, top = by0 - P;
    W = Math.ceil(bx1 - bx0 + 2 * P); H = Math.ceil(by1 - by0 + 2 * P);
    offX = left - hr.left; offY = top - hr.top;
    bounds = [P - fs * 0.12, P - fs * 0.08, W - P + fs * 0.12, H - P + fs * 0.08];
    canvas.style.left = `${h1.offsetLeft + offX}px`;
    canvas.style.top = `${h1.offsetTop + offY}px`;
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);

    // cells: a third of the field's lattice, phase-locked to it (every 3rd lens
    // pixel lands exactly on a field dot)
    s = lattice() / 3;
    fill = Math.max(2, s - Math.max(1, s * 0.16));
    const ox = left - sr.left, oy = top - sr.top;
    const x0 = (((-ox) % s) + s) % s, y0 = (((-oy) % s) + s) % s;
    cols = Math.floor((W - x0) / s) + 1; rows = Math.floor((H - y0) / s) + 1;

    const m = document.createElement('canvas'); m.width = W; m.height = H;
    const mc = m.getContext('2d', { willReadFrequently: true });
    mc.font = `${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
    mc.fillStyle = '#000';
    const fm = mc.measureText('Rh');
    const asc = fm.fontBoundingBoxAscent, desc = fm.fontBoundingBoxDescent;
    const range = document.createRange();
    for (const sp of spans) {
      const walker = document.createTreeWalker(sp, NodeFilter.SHOW_TEXT);
      for (let n; (n = walker.nextNode());) {
        for (let i = 0; i < n.data.length; i++) {
          const ch = n.data[i];
          if (ch === ' ') continue;
          range.setStart(n, i); range.setEnd(n, i + 1);
          const r = range.getBoundingClientRect();
          mc.fillText(ch, r.left - left, r.top - top + (r.height * asc) / (asc + desc));
        }
      }
      const caret = sp.querySelector('.caret');
      if (caret) {
        const r = caret.getBoundingClientRect();
        caretBox = [r.left - left, r.top - top, r.right - left, r.bottom - top];
        mc.fillRect(caretBox[0], caretBox[1], r.width, r.height);
      }
    }
    h1.classList.remove('np-measure');
    const img = mc.getImageData(0, 0, W, H).data;
    const N = cols * rows;
    cov = new Float32Array(N); cx = new Float32Array(N); cy = new Float32Array(N);
    heat = new Float32Array(N); seed = new Float32Array(N); base = new Float32Array(N);
    const list = [];
    const half = s / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c, px = x0 + c * s, py = y0 + r * s;
        cx[i] = px; cy[i] = py; seed[i] = hash(i);
        const xa = Math.max(0, Math.round(px - half)), xb = Math.min(W, Math.round(px + half));
        const ya = Math.max(0, Math.round(py - half)), yb = Math.min(H, Math.round(py + half));
        let sum = 0, k = 0;
        for (let y = ya; y < yb; y++) for (let x = xa, o = (y * W + xa) * 4 + 3; x < xb; x++, o += 4) { sum += img[o]; k++; }
        const v = k ? sum / (k * 255) : 0;
        cov[i] = v;
        if (v > 0.12) list.push(i);
        // caret cells rest at the caret's own gradient (--th-8 → --th-6 → --th-4), not at ink
        if (caretBox && px > caretBox[0] - half && px < caretBox[2] + half && py > caretBox[1] - half && py < caretBox[3] + half) base[i] = -1 - (py - caretBox[1]) / (caretBox[3] - caretBox[1]);
      }
    }
    glyph = Int32Array.from(list);
    const n = glyph.length;
    outI = new Int32Array(n); outL = new Uint8Array(n); outS = new Float32Array(n); order = new Int32Array(n);
    rect = null;
    ready = true;
  }

  // ---------- frame
  function frame(now) {
    raf = 0;
    if (!ready) return;
    const t0 = performance.now();
    const dt = Math.max(0, Math.min(0.05, (now - (last || now)) / 1000)); last = Math.max(now, last);
    tick++;
    const calm = still();

    // lens follows with a short, critically-damped lag; radius springs open/closed
    const px = L.x, py = L.y;
    const kf = calm ? 1 : 1 - Math.exp(-dt * 16);
    L.x += (L.tx - L.x) * kf; L.y += (L.ty - L.y) * kf;
    const kr = calm ? 1 : 1 - Math.exp(-dt * (L.on ? 9 : 6));
    L.r += (L.tr - L.r) * kr;
    if (!L.on && L.r < 1) L.r = 0;
    const moved = Math.hypot(L.x - px, L.y - py);
    L.speed = L.speed * 0.85 + moved * 0.15;

    // sensor noise refreshes at ~12Hz (a real microbolometer runs at 9–30Hz)
    if (!calm && now - noiseAt > 83) { noiseAt = now; noiseSeed = (noiseSeed + 1) % 997; }

    // ripples, same speed as field.js (9px per 60fps frame)
    for (let k = rings.length - 1; k >= 0; k--) {
      const g = rings[k];
      g.r += 540 * dt; g.life -= 0.72 * dt;
      if (g.life <= 0) rings.splice(k, 1);
    }

    const tIntro = introAt < 0 ? -1 : now - introAt;
    if (tIntro > INTRO.sweep + INTRO.gone + 40) { introAt = -1; h1.classList.remove('np-intro'); }

    const cool = calm ? 0 : Math.pow(0.9, dt * 60);
    const R2 = L.r * L.r, heatBoost = Math.min(0.25, L.speed * 0.02);
    const noise = calm ? 0 : 0.09;
    let n = 0; warm = 0;
    counts.fill(0);
    for (let g = 0; g < glyph.length; g++) {
      const i = glyph[g];
      let v = 0, T = 0;
      const x = cx[i], y = cy[i];

      // lens
      let inLens = false;
      if (L.r > 0) {
        const dx = x - L.x, dy = y - L.y, d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          // rim: glyphs pixelate in ink colour; heat rises towards the centre
          const t = Math.sqrt(d2) / L.r;
          const open = smooth(0.15, 0.7, L.r / R);
          const lv = 1 - smooth(0.9, 1, t);
          const lt = (1 - smooth(0.12, 0.86, t)) * (0.78 + heatBoost) * open;
          if (lv > v) v = lv;
          if (lt > T) T = lt;
          inLens = t < 0.9;
          if (!calm && lt * 0.9 > heat[i]) heat[i] = lt * 0.9; // deposit for the trail
        }
      }
      // trail: cools back to ink colour (invisible over the crisp glyph), then drops out
      let h = heat[i];
      if (h > 0.02) {
        h *= cool; heat[i] = h;
        if (!inLens) warm++; // only cells left behind by the lens keep the loop at 60fps
        if (v < 1) v = 1;
        if (h > T) T = h;
      } else heat[i] = 0;
      // rings
      for (let k = 0; k < rings.length; k++) {
        const rg = rings[k];
        const b = Math.abs(Math.hypot(x - rg.x, y - rg.y) - rg.r) / rg.band;
        if (b < 1) {
          const e = (1 - smooth(0.08, 0.8, b)) * Math.min(1, rg.life * 1.5);
          if (v < 1) v = 1;
          if (e > T) T = e;
          if (!calm && e * 0.8 > heat[i]) heat[i] = e * 0.8;
        }
      }
      // intro: cells ignite on a jittered left→right sweep, cool through the
      // ramp, then hand over to the crisp glyphs (revealed by a matching mask)
      if (tIntro >= 0) {
        const at = (0.72 * (x / W) + 0.28 * seed[i]) * INTRO.sweep;
        const age = tIntro - at;
        if (age >= 0 && age < INTRO.gone) {
          const iv = smooth(0, 70, age);
          const it = Math.exp(-age / 300) * (1 - smooth(INTRO.hold * 0.5, INTRO.hold, age));
          if (iv > v) v = iv;
          if (it > T) T = it;
        }
      }
      if (v < 0.03) continue;
      if (base[i] < 0) { const k = -base[i] - 1; const rest = (6 - 4 * k) / (stopCount - 1); if (T < rest) T = rest; }
      if (noise && T > 0.05) T += (hash(i * 31 + noiseSeed) - 0.5) * noise * T;
      const lv = Math.max(0, Math.min(LEVELS - 1, (T * (LEVELS - 1) + 0.5) | 0));
      outI[n] = i; outL[n] = lv; outS[n] = fill * smooth(0.1, 0.62, cov[i]) * v;
      counts[lv]++; n++;
    }

    // draw, one fillStyle per heat level
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let acc = 0;
    for (let b = 0; b < LEVELS; b++) { starts[b] = acc; acc += counts[b]; }
    fillAt.set(starts);
    for (let k = 0; k < n; k++) order[fillAt[outL[k]]++] = k;
    for (let b = 0; b < LEVELS; b++) {
      const c = counts[b];
      if (!c) continue;
      ctx.fillStyle = styles[b];
      for (let k = starts[b], end = starts[b] + c; k < end; k++) {
        const o = order[k], i = outI[o], sz = outS[o];
        // snap to device pixels: crisp squares, no shimmer
        const x0 = Math.round((cx[i] - sz / 2) * dpr), y0 = Math.round((cy[i] - sz / 2) * dpr);
        const w = Math.max(1, Math.round(sz * dpr));
        ctx.fillRect(x0, y0, w, w);
      }
    }
    stats.cells = n;

    // mask the crisp glyphs wherever pixels are standing in for them
    const layers = [];
    if (L.r > 0.5) layers.push(`radial-gradient(circle at ${(L.x + offX).toFixed(1)}px ${(L.y + offY).toFixed(1)}px, transparent ${(L.r * 0.83).toFixed(1)}px, #000 ${(L.r * 0.9).toFixed(1)}px)`);
    for (const rg of rings) {
      const a = rg.r, cxm = (rg.x + offX).toFixed(1), cym = (rg.y + offY).toFixed(1), bd = rg.band * Math.min(1, rg.life * 1.5);
      if (bd < 2) continue;
      layers.push(`radial-gradient(circle at ${cxm}px ${cym}px, #000 ${Math.max(0, a - bd * 0.8)}px, transparent ${Math.max(0, a - bd * 0.7)}px, transparent ${a + bd * 0.7}px, #000 ${a + bd * 0.8}px)`);
    }
    if (tIntro >= 0) {
      // crisp front trails the *latest* cell at each x by `hold`, so every pixel
      // under it is already ink-coloured
      const f = (((tIntro - INTRO.hold) / INTRO.sweep - 0.28) / 0.72) * W + offX;
      layers.push(`linear-gradient(90deg, #000 ${(f - fs * 0.12).toFixed(1)}px, transparent ${f.toFixed(1)}px)`);
    }
    const mask = layers.join(',');
    if (mask !== lastMask) {
      lastMask = mask;
      h1.style.webkitMaskImage = h1.style.maskImage = mask;
      const comp = layers.length > 1;
      h1.style.maskComposite = comp ? 'intersect' : '';
      h1.style.webkitMaskComposite = comp ? 'source-in' : '';
    }

    const dtMs = performance.now() - t0;
    stats.frames++; stats.ms += dtMs; stats.max = Math.max(stats.max, dtMs);

    const lensMoving = Math.abs(L.tr - L.r) > 0.5 || (L.r > 0 && (moved > 0.05 || Math.hypot(L.tx - L.x, L.ty - L.y) > 0.3));
    const active = lensMoving || rings.length || warm || introAt >= 0;
    if (active) raf = requestAnimationFrame(frame);
    else if (L.r > 0 && !calm) setTimeout(wake, 83); // hovered but still: sensor refresh at 12fps
  }
  function wake() { if (!raf && ready) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  // ---------- input
  function local(e) {
    rect ||= canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }
  const inside = (x, y) => x > bounds[0] && x < bounds[2] && y > bounds[1] && y < bounds[3];
  function onMove(e) {
    if (e.pointerType !== 'mouse' || !ready) return;
    const [x, y] = local(e);
    const on = inside(x, y);
    if (on && !L.on && L.r < 2) { L.x = x; L.y = y; } // open from the pointer, don't fly in
    L.on = on; L.tx = x; L.ty = y; L.tr = on ? R : 0;
    if (on || L.r > 0) wake();
  }
  function onLeave() { L.on = false; L.tr = 0; wake(); }
  function onDown(e) {
    if (!ready || still()) return;
    const [x, y] = local(e);
    // only if the ring will actually cross the name
    const dx = Math.max(bounds[0] - x, 0, x - bounds[2]), dy = Math.max(bounds[1] - y, 0, y - bounds[3]);
    if (Math.hypot(dx, dy) > 700) return;
    rings.push({ x, y, r: 0, band: fs * 0.32, life: 1 });
    if (rings.length > 3) rings.shift();
    wake();
  }
  stage.addEventListener('pointermove', onMove, { passive: true });
  stage.addEventListener('pointerleave', onLeave, { passive: true });
  stage.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('scroll', () => { rect = null; }, { passive: true });

  let rz = 0;
  new ResizeObserver(() => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (introAt < 0) { measure(); wake(); } }); }).observe(h1);
  new MutationObserver(() => requestAnimationFrame(() => { palette(); wake(); })).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- boot: needs the real font before rasterising, or the pixels won't register
  const fontReady = Promise.race([
    document.fonts.load(`${getComputedStyle(h1).fontWeight} 1em ${getComputedStyle(h1).fontFamily}`).then(() => true),
    new Promise((r) => setTimeout(() => r(false), 900)),
  ]);
  const startIntro = intro && !still();
  if (startIntro) h1.classList.add('np-intro'); // CSS: no slide-up; masked until the sweep
  if (startIntro) h1.style.webkitMaskImage = h1.style.maskImage = 'linear-gradient(transparent, transparent)';
  Promise.all([fontReady, after]).then(([ok]) => {
    palette();
    measure();
    if (startIntro) {
      if (ok) { introAt = performance.now(); wake(); }
      else { h1.classList.remove('np-intro'); h1.style.maskImage = h1.style.webkitMaskImage = ''; } // fall back to the CSS slide-up
    }
  });

  return {
    stats,
    replay() { if (!still()) { h1.classList.add('np-intro'); introAt = performance.now(); wake(); } },
    remeasure() { measure(); },
    pulse(x, y) { rings.push({ x, y, r: 0, band: fs * 0.32, life: 1 }); wake(); },
    get state() { return { L: { ...L }, rings: rings.length, warm, raf: !!raf, introAt, n: glyph.length, cols, rows, s, W, H }; },
  };
}
