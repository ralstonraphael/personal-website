// Activity heatmap with two sources:
//   github — the real contribution calendar for the last year
//   you    — a live heatmap of *this visit*: every cell is one second, and it
//            glows with how much you moved, scrolled, clicked and typed.
// Rendered on canvas; cells near the cursor lift, and a tooltip names each cell.

import { prefersReducedMotion, readColor, mix, clamp } from './util.js';

const GH_USER = 'ralstonraphael';
const GH_URL = `https://github-contributions-api.jogruber.de/v4/${GH_USER}?y=last`;
const ROWS = 7;
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function initHeatmap(root) {
  const canvas = root.querySelector('canvas');
  const tip = root.querySelector('[data-heat-tip]');
  const summary = root.querySelector('[data-heat-summary]');
  const note = root.querySelector('[data-heat-note]');
  const buttons = [...root.querySelectorAll('[data-heat-mode]')];
  const ctx = canvas.getContext('2d');
  const reduce = prefersReducedMotion();

  let W = 0, H = 0, dpr = 1, cell = 11, gap = 3, cols = 53, top = 18, left = 28;
  let mode = 'github';
  let gh = null; // { weeks: [[{date,count,level}|null x7]], total }
  let ghFailed = false;
  let ramp = [];
  let ink = '#111', labelColor = '#777', monoFont = 'monospace';
  let revealAt = 0; // ms timestamp the wave started; 0 = not yet
  let raf = 0, visible = false;
  const pointer = { x: -1e4, y: -1e4, inside: false };
  let hoverKey = '';

  // ---- live session recorder -------------------------------------------
  const t0 = performance.now();
  const secs = []; // activity per second
  let moveDist = 0, clicks = 0, keys = 0, scrollDist = 0;
  let lastX = null, lastY = null, lastScroll = window.scrollY;
  const bump = (v) => {
    const s = Math.floor((performance.now() - t0) / 1000);
    while (secs.length <= s) secs.push(0);
    secs[s] += v;
  };
  window.addEventListener('pointermove', (e) => {
    if (lastX !== null) {
      const d = Math.hypot(e.clientX - lastX, e.clientY - lastY);
      moveDist += d; bump(d);
    }
    lastX = e.clientX; lastY = e.clientY;
  }, { passive: true });
  window.addEventListener('scroll', () => {
    const d = Math.abs(window.scrollY - lastScroll);
    lastScroll = window.scrollY; scrollDist += d; bump(d * 0.6);
  }, { passive: true });
  window.addEventListener('pointerdown', () => { clicks++; bump(400); }, { passive: true });
  window.addEventListener('keydown', () => { keys++; bump(150); });
  setInterval(() => { bump(0); if (mode === 'you') { writeSummary(); wake(); } }, 1000);

  // ---- data ------------------------------------------------------------
  async function loadGithub() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(GH_URL, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      const days = json.contributions || [];
      if (!days.length) throw new Error('empty');
      const first = new Date(days[0].date + 'T00:00:00');
      const pad = first.getDay();
      const flat = Array(pad).fill(null).concat(days);
      const weeks = [];
      for (let i = 0; i < flat.length; i += ROWS) weeks.push(flat.slice(i, i + ROWS));
      const total = json.total?.lastYear ?? days.reduce((a, d) => a + d.count, 0);
      gh = { weeks, total, max: Math.max(1, ...days.map((d) => d.count)) };
    } catch {
      ghFailed = true;
    }
    if (mode === 'github' && ghFailed) setMode('you', true);
    else { writeSummary(); layout(); wake(); }
  }

  // ---- geometry ----------------------------------------------------------
  function palette() {
    const cs = getComputedStyle(root);
    const empty = cs.getPropertyValue('--heat-0').trim();
    const a = readColor(cs.getPropertyValue('--accent').trim());
    const deep = readColor(cs.getPropertyValue('--accent-deep').trim());
    const e = readColor(empty);
    ramp = [e, mix(e, a, 0.35), mix(e, a, 0.65), a, deep];
    ink = cs.getPropertyValue('--ink').trim();
    labelColor = cs.getPropertyValue('--muted').trim();
    monoFont = cs.getPropertyValue('--font-mono').trim() || 'monospace';
  }

  function layout() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width;
    left = W < 520 ? 0 : 28;
    gap = W < 520 ? 2 : 3;
    const want = 53;
    cell = Math.floor((W - left - gap * (want - 1)) / want);
    cols = want;
    if (cell < 8) { // phones: show fewer, larger weeks
      cell = 8;
      cols = Math.max(12, Math.floor((W - left + gap) / (cell + gap)));
    }
    cell = Math.min(cell, 14);
    H = top + ROWS * (cell + gap) - gap + 2;
    canvas.style.height = H + 'px';
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Returns the visible grid as columns of cells: {level, label, sub}
  function grid() {
    if (mode === 'github' && gh) {
      const weeks = gh.weeks.slice(-cols);
      return weeks.map((w) => w.map((d) => d && {
        level: d.level ?? (d.count ? clamp(Math.ceil((d.count / gh.max) * 4), 1, 4) : 0),
        label: `${d.count} contribution${d.count === 1 ? '' : 's'}`,
        sub: fmtDate(d.date),
        date: d.date,
      }));
    }
    // session: newest second at the end; fill column-major like the calendar
    const cap = cols * ROWS;
    const now = Math.floor((performance.now() - t0) / 1000);
    const startSec = Math.max(0, now + 1 - cap);
    const max = Math.max(60, ...secs.slice(startSec));
    const out = [];
    for (let c = 0; c < cols; c++) {
      const col = [];
      for (let r = 0; r < ROWS; r++) {
        const s = startSec + c * ROWS + r;
        if (s > now) { col.push({ level: 0, future: true }); continue; }
        const v = secs[s] || 0;
        const level = v <= 0 ? 0 : clamp(Math.ceil(Math.sqrt(v / max) * 4), 1, 4);
        col.push({ level, label: v ? `${Math.round(v)} units of activity` : 'idle', sub: `second ${s + 1}`, live: s === now });
      }
      out.push(col);
    }
    return out;
  }

  // ---- render --------------------------------------------------------------
  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    const data = grid();
    ctx.font = `10px ${monoFont}`;
    ctx.fillStyle = labelColor;
    ctx.textBaseline = 'alphabetic';

    // month / minute labels
    let lastLabel = '';
    data.forEach((col, c) => {
      const first = col.find((d) => d && !d.future);
      if (!first) return;
      let lab = '';
      if (mode === 'github' && first.date) lab = MON[new Date(first.date + 'T00:00:00').getMonth()];
      else if (mode === 'you') { const s = parseInt(first.sub.split(' ')[1], 10) - 1; lab = s % 60 < ROWS ? `${Math.floor(s / 60)}m` : ''; }
      if (lab && lab !== lastLabel && c < data.length - 2) {
        ctx.fillText(lab, left + c * (cell + gap), 10);
        lastLabel = lab;
      }
    });
    if (left && mode === 'github') ['Mon', 'Wed', 'Fri'].forEach((d, k) => {
      const r = [1, 3, 5][k];
      ctx.fillText(d, 0, top + r * (cell + gap) + cell - 2);
    });

    let busy = false;
    let hovered = null;
    const elapsed = revealAt ? now - revealAt : 0;
    for (let c = 0; c < data.length; c++) {
      for (let r = 0; r < ROWS; r++) {
        const d = data[c][r];
        if (!d) continue;
        const x = left + c * (cell + gap), y = top + r * (cell + gap);
        // diagonal reveal wave
        let a = 1;
        if (!reduce) {
          if (!revealAt) a = 0;
          else {
            a = clamp((elapsed - (c * 12 + r * 30)) / 380, 0, 1);
            if (a < 1) busy = true;
          }
        }
        if (a <= 0) continue;
        // lift near the pointer
        const cx = x + cell / 2, cy = y + cell / 2;
        const dist = Math.hypot(cx - pointer.x, cy - pointer.y);
        const near = pointer.inside && !reduce ? clamp(1 - dist / 70, 0, 1) : 0;
        const isHover = pointer.inside && Math.abs(cx - pointer.x) <= (cell + gap) / 2 && Math.abs(cy - pointer.y) <= (cell + gap) / 2;
        if (isHover && !d.future) hovered = { d, x, y };
        if (d.future) a *= 0.5;
        const grow = (near * near * 0.28 + (d.live ? 0.08 * Math.sin(now / 180) : 0)) * cell;
        const col = ramp[d.level] || ramp[0];
        const boost = near * 0.18;
        const rc = d.level === 0 ? col : mix(col, [255, 255, 255], -boost); // deepen near cursor
        ctx.globalAlpha = a;
        ctx.fillStyle = `rgb(${rc[0] | 0},${rc[1] | 0},${rc[2] | 0})`;
        const s = cell * (0.6 + 0.4 * easeOut(a)) + grow;
        const off = (cell - s) / 2;
        roundRect(ctx, x + off, y + off, s, s, Math.max(1.5, s * 0.22));
        if (d.live) busy = true;
      }
    }
    ctx.globalAlpha = 1;
    if (pointer.inside) busy = true;

    if (hovered) {
      const { d, x, y } = hovered;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x - 2, y - 2, cell + 4, cell + 4, 4) : ctx.rect(x - 2, y - 2, cell + 4, cell + 4);
      ctx.stroke();
      const key = d.label + d.sub;
      if (key !== hoverKey) {
        hoverKey = key;
        tip.querySelector('b').textContent = d.label;
        tip.querySelector('span').textContent = d.sub;
      }
      const tipW = tip.offsetWidth || 160;
      const tx = clamp(x + cell / 2 - tipW / 2, 0, W - tipW);
      tip.style.transform = `translate(${tx}px, ${y - 44}px)`;
      tip.classList.add('is-on');
    } else {
      tip.classList.remove('is-on');
      hoverKey = '';
    }
    return busy;
  }

  function loop(now) {
    raf = 0;
    if (!visible) return;
    const busy = draw(now);
    if (busy) raf = requestAnimationFrame(loop);
  }
  function wake() { if (!raf && visible) raf = requestAnimationFrame(loop); }

  function writeSummary() {
    if (mode === 'github') {
      if (gh) {
        summary.textContent = `${gh.total.toLocaleString()} contributions in the last year`;
        note.textContent = `github.com/${GH_USER}`;
      } else {
        summary.textContent = 'Loading contributions…';
        note.textContent = '';
      }
    } else {
      const s = Math.floor((performance.now() - t0) / 1000);
      const t = s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
      summary.textContent = `You've been here ${t}`;
      note.textContent = `${Math.round(moveDist).toLocaleString()}px moved · ${Math.round(scrollDist).toLocaleString()}px scrolled · ${clicks} click${clicks === 1 ? '' : 's'}`;
    }
  }

  function setMode(m, fromFailure = false) {
    mode = m;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.heatMode === m)));
    root.dataset.mode = m;
    if (fromFailure) buttons.find((b) => b.dataset.heatMode === 'github')?.setAttribute('disabled', '');
    revealAt = visible ? performance.now() : 0;
    writeSummary();
    layout();
    wake();
  }

  buttons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.heatMode)));

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.inside = true;
    wake();
  });
  canvas.addEventListener('pointerleave', () => { pointer.inside = false; pointer.x = pointer.y = -1e4; wake(); });

  new ResizeObserver(() => { layout(); wake(); }).observe(canvas);
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !revealAt) revealAt = performance.now();
    if (visible) wake();
  }, { threshold: 0.25 }).observe(canvas);

  palette();
  layout();
  writeSummary();
  loadGithub();

  return { repaint() { palette(); wake(); } };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return `${DAY[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
