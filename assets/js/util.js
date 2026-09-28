// Small shared helpers.

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform || '');

const probe = document.createElement('canvas').getContext('2d');

// Any CSS colour string -> [r, g, b]
export function readColor(str) {
  probe.fillStyle = '#000';
  probe.fillStyle = str;
  const v = probe.fillStyle;
  if (v[0] === '#') {
    const n = parseInt(v.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = v.match(/[\d.]+/g) || [0, 0, 0];
  return [+m[0], +m[1], +m[2]];
}

export const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// Site-wide motion switch (WCAG 2.2.2): pauses ambient loops and CSS loops.
const motionListeners = new Set();
let motionOn = store.get('rr:motion') !== 'off';
export const motion = {
  get on() { return motionOn; },
  set on(v) {
    motionOn = !!v;
    store.set('rr:motion', motionOn ? 'on' : 'off');
    document.documentElement.dataset.motion = motionOn ? 'on' : 'off';
    motionListeners.forEach((fn) => fn(motionOn));
  },
  subscribe(fn) { motionListeners.add(fn); },
};
document.documentElement.dataset.motion = motionOn ? 'on' : 'off';

// Synthesized UI sounds. Off by default; the visitor opts in. One cached noise
// buffer, band-passed per voice, with ±4% pitch jitter so repeats never sound
// mechanical. Exactly one sound per interaction phase.
let ac = null, bus = null, noise = null;
let soundOn = store.get('rr:sound') === '1';
function audioCtx() {
  if (ac) return ac;
  ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  bus = ac.createGain();
  bus.gain.value = 0.6;
  bus.connect(ac.destination);
  const n = (ac.sampleRate * 0.06) | 0;
  noise = ac.createBuffer(1, n, ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return ac;
}
function voice(a, { hp = 2600, q = 0.9, len = 0.012, gain = 0.3, body = 0, bodyGain = 0.5, at = 0 } = {}) {
  const t = a.currentTime + 0.002 + at, j = 1 + (Math.random() - 0.5) * 0.08;
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = hp * j; f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f).connect(g).connect(bus);
  src.start(t, Math.random() * 0.04);
  src.stop(t + len + 0.01);
  if (body) { // pitched "thock": starts an octave up, drops in 25ms
    const o = a.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(body * 2 * j, t);
    o.frequency.exponentialRampToValueAtTime(body * j, t + 0.025);
    const og = a.createGain();
    og.gain.setValueAtTime(gain * bodyGain, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(og).connect(bus);
    o.start(t); o.stop(t + 0.08);
  }
}
const VOICES = {
  press: { hp: 2400, q: 0.9, len: 0.014, gain: 0.32, body: 170, bodyGain: 0.55 },
  release: { hp: 4200, q: 1.2, len: 0.008, gain: 0.14 },
  tick: { hp: 5200, q: 1.5, len: 0.006, gain: 0.07 },
  success: [{ hp: 3000, len: 0.01, gain: 0.2, body: 660, bodyGain: 0.35 }, { hp: 3600, len: 0.01, gain: 0.2, body: 990, bodyGain: 0.35, at: 0.075 }],
};
export const sound = {
  get on() { return soundOn; },
  set on(v) { soundOn = !!v; store.set('rr:sound', soundOn ? '1' : '0'); },
  play(name) {
    if (!soundOn) return;
    try {
      const a = audioCtx();
      if (a.state === 'suspended') a.resume();
      [].concat(VOICES[name] || VOICES.tick).forEach((v) => voice(a, v));
    } catch {}
  },
  tick() { this.play('tick'); },
};

// Haptics: Android only, meaningful moments only.
export const buzz = (p) => {
  try { if (!prefersReducedMotion() && navigator.vibrate && matchMedia('(pointer: coarse)').matches) navigator.vibrate(p); } catch {}
};

// Stacked toasts (newest in front). Same-key toasts roll their text in place
// with a small bump instead of piling up, so mashing a toggle feels like a switch.
const MAX_TOASTS = 3, TOAST_GAP = 8, TOAST_LIFE = 2400;
function toastStack() { return document.getElementById('toasts'); }
const liveToasts = (st) => Array.from(st.querySelectorAll(':scope > li:not([data-removed])'));
function layoutToasts(st) {
  let off = 0;
  liveToasts(st).forEach((li, i) => {
    li.style.setProperty('--i', Math.min(i, MAX_TOASTS));
    li.style.setProperty('--offset', off + 'px');
    li.toggleAttribute('data-front', i === 0);
    li.toggleAttribute('data-hidden', i >= MAX_TOASTS);
    off += li.offsetHeight + TOAST_GAP;
  });
}
function dismissToast(st, li) { li.setAttribute('data-removed', ''); layoutToasts(st); setTimeout(() => li.remove(), 260); }
function armToast(st, li, ms = TOAST_LIFE) {
  clearTimeout(li._t);
  li._t = setTimeout(() => (st.matches(':hover') ? armToast(st, li, 800) : dismissToast(st, li)), ms);
}
export function toast(msg, { key } = {}) {
  const st = toastStack();
  if (!st) return;
  const live = liveToasts(st);
  const same = key && live.find((li) => li.dataset.key === key);
  if (same && same === live[0]) {
    same.querySelector('[data-msg]').textContent = msg;
    same.classList.remove('bump'); void same.offsetWidth; same.classList.add('bump');
    return armToast(st, same);
  }
  if (same) dismissToast(st, same);
  const li = document.createElement('li');
  if (key) li.dataset.key = key;
  li.innerHTML = '<span class="toast-dot" aria-hidden="true"></span><span data-msg></span>';
  li.querySelector('[data-msg]').textContent = msg;
  st.prepend(li);
  layoutToasts(st);
  requestAnimationFrame(() => requestAnimationFrame(() => li.setAttribute('data-mounted', '')));
  armToast(st, li);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const prev = document.activeElement;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    prev?.focus?.({ preventScroll: true });
    return ok;
  }
}
