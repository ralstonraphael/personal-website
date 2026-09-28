// Text decode: characters cycle through glyphs, then settle left-to-right.
// Built for monospace labels (fixed width = zero layout shift).

import { prefersReducedMotion } from './util.js';

const GLYPHS = '01<>/\\[]{}=+*#%&_-:;.';
const running = new WeakMap();

export function scramble(el, { duration = 700, text = el.dataset.text || el.textContent } = {}) {
  if (!el.dataset.text) el.dataset.text = text;
  if (prefersReducedMotion()) { el.textContent = text; return; }
  cancelAnimationFrame(running.get(el));

  const chars = [...text];
  const n = chars.length;
  // each character resolves at a staggered time with a little jitter
  const settle = chars.map((_, i) => (i / Math.max(1, n - 1)) * 0.7 + Math.random() * 0.3);
  const start = performance.now();

  const frame = (now) => {
    const p = Math.min(1, (now - start) / duration);
    let out = '';
    for (let i = 0; i < n; i++) {
      const c = chars[i];
      if (c === ' ' || p >= settle[i]) out += c;
      else out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    el.textContent = out;
    if (p < 1) running.set(el, requestAnimationFrame(frame));
    else el.textContent = text;
  };
  running.set(el, requestAnimationFrame(frame));
}

// Scramble on hover/focus for anything marked [data-scramble]
export function bindScramble(root = document) {
  root.querySelectorAll('[data-scramble]').forEach((el) => {
    const target = el.querySelector('[data-scramble-text]') || el;
    target.dataset.text = target.textContent;
    // keep the accessible name stable while the visible glyphs churn
    if (!el.hasAttribute('aria-label') && el.matches('a, button')) el.setAttribute('aria-label', el.textContent.trim().replace(/\s+/g, ' '));
    const go = () => scramble(target, { duration: 420 });
    el.addEventListener('pointerenter', go);
    el.addEventListener('focus', go);
  });
}
