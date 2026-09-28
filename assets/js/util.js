// Small shared helpers.

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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

// Tiny synthesized UI "tick". Off by default; the visitor opts in.
let audio = null;
let soundOn = false;
try { soundOn = localStorage.getItem('rr:sound') === '1'; } catch {}
export const sound = {
  get on() { return soundOn; },
  set on(v) {
    soundOn = !!v;
    try { localStorage.setItem('rr:sound', soundOn ? '1' : '0'); } catch {}
  },
  tick(pitch = 1) {
    if (!soundOn) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime;
      const len = Math.floor(audio.sampleRate * 0.03);
      const buf = audio.createBuffer(1, len, audio.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
      const src = audio.createBufferSource();
      src.buffer = buf;
      const bp = audio.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400 * pitch;
      bp.Q.value = 2.2;
      const g = audio.createGain();
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      src.connect(bp).connect(g).connect(audio.destination);
      src.start(t);
    } catch {}
  },
};

// Toast for small confirmations ("copied").
let toastTimer = 0;
export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) return;
  el.querySelector('[data-toast-msg]').textContent = msg;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 1800);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
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
    return ok;
  }
}
