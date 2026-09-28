// Activity heatmap with two sources:
//   github — the real contribution calendar for the last year
//   you    — an attention map of *this visit*: one row per page section, time
//            left → right. Cells warm with how long you lingered there and how
//            much you moved, scrolled and clicked. The first minute fills in;
//            after that the timeline compresses so the whole visit always fits.
// Rendered on canvas; cells near the cursor lift, and a tooltip names each cell.

import { prefersReducedMotion, readColor, clamp } from './util.js';

const GH_USER = 'ralstonraphael';
const GH_URL = `https://github-contributions-api.jogruber.de/v4/${GH_USER}?y=last`;
const ROWS = 7;
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SECTIONS = [
  ['top', 'intro', 'top'], ['about', 'about', 'abt'], ['work', 'experience', 'exp'], ['projects', 'projects', 'proj'],
  ['activity', 'this card', 'you'], ['education', 'education', 'edu'], ['contact', 'contact', 'hi'],
];
const TICK = 250; // ms per attention sample
const MIN_SPAN = 240; // samples the timeline covers before it starts compressing (60s)

export function initHeatmap(root) {
  const canvas = root.querySelector('canvas');
  const wrap = root.querySelector('.heat-canvas-wrap');
  const tip = root.querySelector('[data-heat-tip]');
  const summary = root.querySelector('[data-heat-summary]');
  const note = root.querySelector('[data-heat-note]');
  const announce = root.querySelector('[data-heat-announce]');
  const seg = root.querySelector('.segmented');
  const legend = [...root.querySelectorAll('.heat-legend i')];
  const buttons = [...root.querySelectorAll('[data-heat-mode]')];
  const ctx = canvas.getContext('2d');
  const reduce = prefersReducedMotion();

  let W = 0, H = 0, dpr = 1, cell = 11, gap = 3, cols = 53, top = 18, left = 28;
  let mode = 'github';
  let gh = null; // { weeks, total }
  let ghFailed = false;
  let rampCss = [];
  let ink = '#111', labelColor = '#777', monoFont = 'monospace';
  let data = []; // cached columns of cells
  let revealAt = 0;
  let raf = 0, visible = false;
  const pointer = { x: -1e4, y: -1e4, inside: false };
  let hoverKey = '', tipW = 160, tipH = 44, touchTimer = 0;

  // ---- attention recorder ----------------------------------------------
  const sRow = []; const sVal = [];
  let pending = 0, moveDist = 0, clicks = 0, scrollDist = 0;
  let lastX = null, lastY = null, lastScroll = window.scrollY;
  const secEls = SECTIONS.map(([id]) => document.getElementById(id));
  window.addEventListener('pointermove', (e) => {
    if (lastX !== null) { const d = Math.hypot(e.clientX - lastX, e.clientY - lastY); moveDist += d; pending += d; }
    lastX = e.clientX; lastY = e.clientY;
  }, { passive: true });
  window.addEventListener('scroll', () => {
    const d = Math.abs(window.scrollY - lastScroll);
    lastScroll = window.scrollY; scrollDist += d; pending += d * 0.6;
  }, { passive: true });
  window.addEventListener('pointerdown', () => { clicks++; pending += 400; }, { passive: true });
  window.addEventListener('keydown', () => { pending += 150; });

  function currentRow() {
    const mid = window.innerHeight * 0.5;
    for (let k = secEls.length - 1; k >= 0; k--) {
      const el = secEls[k];
      if (el && el.getBoundingClientRect().top <= mid) return k;
    }
    return 0;
  }
  let ticks = 0;
  setInterval(() => {
    if (document.hidden) return;
    sRow.push(currentRow());
    sVal.push(0.6 + Math.min(pending, 2000) / 200);
    pending = 0;
    if (++ticks % 4 === 0 && mode === 'you' && visible) { compute(); writeSummary(); wake(true); }
  }, TICK);

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
      const flat = Array(first.getDay()).fill(null).concat(days);
      const weeks = [];
      for (let i = 0; i < flat.length; i += ROWS) weeks.push(flat.slice(i, i + ROWS));
      const total = json.total?.lastYear ?? days.reduce((a, d) => a + d.count, 0);
      gh = { weeks, total, max: Math.max(1, ...days.map((d) => d.count)) };
    } catch {
      ghFailed = true;
      // No calendar to show: drop the switch and make this card about the visit.
      seg.hidden = true;
      const section = root.closest('section');
      const title = section?.querySelector('.section-title');
      const aside = section?.querySelector('.section-aside');
      if (title) (title.querySelector('.line > span') || title).textContent = 'Your visit';
      if (aside) aside.textContent = 'live · stays in your browser';
    }
    if (ghFailed) setMode('you', false);
    else if (mode === 'github') { compute(); writeSummary(); wake(true); }
  }

  // ---- geometry ----------------------------------------------------------
  function palette() {
    const cs = getComputedStyle(root);
    rampCss = ['--heat-0', '--th-2', '--th-4', '--th-6', '--th-8'].map((v) => cs.getPropertyValue(v).trim());
    legend.forEach((el, i) => { el.style.background = rampCss[i]; });
    ink = cs.getPropertyValue('--ink').trim();
    labelColor = cs.getPropertyValue('--muted').trim();
    monoFont = cs.getPropertyValue('--font-mono').trim() || 'monospace';
  }

  function layout() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width;
    const narrow = W < 520;
    left = mode === 'you' ? (narrow ? 34 : 78) : narrow ? 0 : 30;
    gap = narrow ? 2 : 3;
    cols = 53;
    cell = (W - left - gap * (cols - 1)) / cols;
    if (cell < 8) { // phones: show fewer, larger columns
      cols = Math.max(12, Math.floor((W - left + gap) / (8 + gap)));
      cell = (W - left - gap * (cols - 1)) / cols;
    }
    cell = Math.min(cell, 16);
    H = top + ROWS * (cell + gap) - gap + 2;
    canvas.style.height = H + 'px';
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    compute();
  }

  const fmtT = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // Build the visible grid as columns of cells.
  function compute() {
    if (mode === 'github') {
      if (!gh) { // loading skeleton
        data = Array.from({ length: cols }, () => Array.from({ length: ROWS }, () => ({ level: 0, skeleton: true })));
        return;
      }
      data = gh.weeks.slice(-cols).map((w) => w.map((d) => d && {
        level: d.level ?? (d.count ? clamp(Math.ceil((d.count / gh.max) * 4), 1, 4) : 0),
        label: `${d.count} contribution${d.count === 1 ? '' : 's'}`,
        sub: fmtDate(d.date),
        month: new Date(d.date + 'T00:00:00').getMonth(),
      }));
      return;
    }
    const n = sRow.length;
    const span = Math.max(n, MIN_SPAN);
    const sums = Array.from({ length: cols }, () => new Float32Array(ROWS));
    for (let i = 0; i < n; i++) sums[Math.min(cols - 1, Math.floor((i / span) * cols))][sRow[i]] += sVal[i];
    let max = 0;
    for (const col of sums) for (const v of col) if (v > max) max = v;
    const filled = Math.ceil((n / span) * cols);
    data = sums.map((col, c) => Array.from(col, (v, r) => {
      const future = c >= filled;
      return {
        level: v <= 0 ? 0 : clamp(Math.ceil(Math.sqrt(v / max) * 4), 1, 4),
        future,
        label: v > 0 ? `on ${SECTIONS[r][1]}` : `not on ${SECTIONS[r][1]}`,
        sub: `${fmtT((c / cols) * span * TICK)} – ${fmtT(((c + 1) / cols) * span * TICK)}`,
        minute: Math.floor(((c / cols) * span * TICK) / 60000),
      };
    }));
  }

  // ---- render --------------------------------------------------------------
  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    ctx.font = `10px ${monoFont}`;
    ctx.fillStyle = labelColor;
    ctx.textBaseline = 'alphabetic';

    // column labels: months (github) or minutes (visit); never overlapping
    let lastEnd = -Infinity, lastVal = null;
    data.forEach((col, c) => {
      const first = col.find((d) => d && !d.skeleton && !d.future);
      if (!first) return;
      const val = mode === 'github' ? first.month : first.minute;
      if (val === lastVal || val === undefined) return;
      const lab = mode === 'github' ? MON[val] : `${val}m`;
      const x = left + c * (cell + gap);
      if (x < lastEnd + 6 || (mode === 'github' && c === 0 && col.filter(Boolean).length < ROWS)) return;
      lastVal = val;
      ctx.fillText(lab, x, 10);
      lastEnd = x + ctx.measureText(lab).width;
    });
    if (left) {
      if (mode === 'github') ['Mon', 'Wed', 'Fri'].forEach((d, k) => ctx.fillText(d, 0, top + [1, 3, 5][k] * (cell + gap) + cell - 2));
      else SECTIONS.forEach(([, name, short], r) => ctx.fillText(left < 60 ? short : name, 0, top + r * (cell + gap) + cell / 2 + 3.5));
    }

    let busy = false;
    let hovered = null;
    const elapsed = revealAt ? now - revealAt : 0;
    for (let c = 0; c < data.length; c++) {
      for (let r = 0; r < ROWS; r++) {
        const d = data[c][r];
        if (!d) continue;
        const x = left + c * (cell + gap), y = top + r * (cell + gap);
        let a = 1;
        if (!reduce) {
          if (!revealAt) a = 0;
          else { a = clamp((elapsed - (c * 12 + r * 30)) / 380, 0, 1); if (a < 1) busy = true; }
        }
        if (a <= 0) continue;
        const cx = x + cell / 2, cy = y + cell / 2;
        const near = pointer.inside && !reduce ? clamp(1 - Math.hypot(cx - pointer.x, cy - pointer.y) / 70, 0, 1) : 0;
        const isHover = pointer.inside && Math.abs(cx - pointer.x) <= (cell + gap) / 2 && Math.abs(cy - pointer.y) <= (cell + gap) / 2;
        if (isHover && !d.future && !d.skeleton) hovered = { d, x, y };
        if (d.future) a *= 0.45;
        if (d.skeleton) a *= 0.6;
        ctx.globalAlpha = a;
        ctx.fillStyle = rampCss[d.level] || rampCss[0];
        const s = cell * (0.6 + 0.4 * easeOut(a)) + near * near * 0.28 * cell;
        const off = (cell - s) / 2;
        roundRect(ctx, x + off, y + off, s, s, Math.max(1.5, s * 0.22));
      }
    }
    ctx.globalAlpha = 1;
    if (pointer.inside) busy = true;

    if (hovered) {
      const { d, x, y } = hovered;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - 2, y - 2, cell + 4, cell + 4, 4); else ctx.rect(x - 2, y - 2, cell + 4, cell + 4);
      ctx.stroke();
      const key = d.label + d.sub;
      if (key !== hoverKey) {
        hoverKey = key;
        tip.querySelector('b').textContent = d.label;
        tip.querySelector('span').textContent = d.sub;
        tipW = tip.offsetWidth || 160; tipH = tip.offsetHeight || 44;
      }
      const tx = clamp(x + cell / 2 - tipW / 2, 0, W - tipW);
      const above = y - tipH - 8;
      const ty = above > -top - 6 ? above : y + cell + 8;
      tip.style.transform = `translate(${tx}px, ${ty}px)`;
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
    if (draw(now)) raf = requestAnimationFrame(loop);
  }
  function wake(once = false) {
    if (!visible) return;
    if (once && !raf) { draw(performance.now()); return; }
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function writeSummary() {
    let text;
    if (mode === 'github') {
      text = gh ? `${gh.total.toLocaleString()} contributions in the last year` : 'Loading contributions…';
      note.textContent = gh ? `github.com/${GH_USER}` : '';
    } else {
      const s = Math.floor((sRow.length * TICK) / 1000);
      const t = s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
      const totals = new Float32Array(ROWS);
      for (let i = 0; i < sRow.length; i++) totals[sRow[i]] += sVal[i];
      let best = 0;
      totals.forEach((v, i) => { if (v > totals[best]) best = i; });
      text = sRow.length > 8 ? `You've spent ${t} here, mostly on ${SECTIONS[best][1]}` : `You've spent ${t} here`;
      note.textContent = `where your attention went · ${Math.round(scrollDist).toLocaleString()}px scrolled · ${clicks} click${clicks === 1 ? '' : 's'}`;
    }
    summary.textContent = text;
    wrap.setAttribute('aria-label', text);
  }

  function setMode(m, announceIt = true) {
    mode = m;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.heatMode === m)));
    root.dataset.mode = m;
    revealAt = visible ? performance.now() : 0;
    layout();
    writeSummary();
    if (announceIt && announce) announce.textContent = m === 'you' ? 'Showing this visit' : 'Showing GitHub contributions';
    wake();
  }

  buttons.forEach((b) => b.addEventListener('click', () => { if (b.dataset.heatMode !== mode) setMode(b.dataset.heatMode); }));

  const setPointer = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.inside = true;
    wake();
  };
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') setPointer(e); });
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { pointer.inside = false; wake(); } });
  // touch/pen: a tap pins the tooltip to that cell for a moment
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    setPointer(e);
    clearTimeout(touchTimer);
    touchTimer = setTimeout(() => { pointer.inside = false; wake(); }, 2600);
  });

  new ResizeObserver(() => { layout(); wake(true); }).observe(canvas);
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !revealAt) revealAt = performance.now();
    if (visible) { compute(); writeSummary(); wake(); }
  }, { threshold: 0.25 }).observe(canvas);

  palette();
  layout();
  writeSummary();
  loadGithub();

  return { repaint() { palette(); wake(true); } };
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
