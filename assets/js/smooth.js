// smooth.js: one Lenis instance and one scroll bus for the whole page.
// - wheel is smoothed (lerp, frame-rate independent); touch, keyboard,
//   scrollbar drag and find-in-page stay native (Lenis just syncs to them)
// - in-page anchors / [data-jump] / palette commands go through scrollToTarget()
// - a modal <dialog> stops Lenis while open (MutationObserver on [open])
// - reduced motion or the site's motion switch => no Lenis at all (pure native)
import Lenis from './vendor/lenis.min.mjs';
import { motion } from './util.js';

const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const inOutQuart = (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2);

let lenis = null;
const subs = new Set();
// the bus: y = scroll offset, v = px/frame velocity (0 when native), smooth = Lenis animating
export const scroll = { y: window.scrollY, v: 0, smooth: false };

function emit(y, v, smooth) {
  scroll.y = y; scroll.v = v; scroll.smooth = smooth;
  for (const fn of subs) fn(scroll);
}
/** Subscribe to scroll. Callback runs inside the frame that paints the new offset. */
export function onScroll(fn) { subs.add(fn); fn(scroll); return () => subs.delete(fn); }

// native path (no Lenis, or events Lenis doesn't own): still one callback per scroll event
addEventListener('scroll', () => { if (!lenis) emit(window.scrollY, 0, false); }, { passive: true });

export function enableSmooth() {
  if (lenis || mqReduce.matches) return null;
  lenis = new Lenis({
    lerp: 0.1,            // time constant ~165ms; 0.08 = floatier, 0.14 = tighter
    wheelMultiplier: 1,   // keep 1: users' wheel/trackpad distance is sacred
    smoothWheel: true,
    syncTouch: false,     // native momentum on touch devices (iOS/Android)
    autoRaf: true,        // Lenis owns one rAF; canvases keep their own sleepy loops
    anchors: false,       // we handle anchors ourselves (see click handler below)
  });
  lenis.on('scroll', (l) => emit(l.scroll, l.velocity, l.isScrolling === 'smooth'));
  if (dialogOpen()) lenis.stop();
  return lenis;
}
export function disableSmooth() {
  lenis?.destroy();
  lenis = null;
  emit(window.scrollY, 0, false);
}
export const getLenis = () => lenis;
mqReduce.addEventListener?.('change', () => (mqReduce.matches || !motion.on ? disableSmooth() : enableSmooth()));

/* ---------- programmatic scrolling (anchors, [data-jump], ⌘K) ---------- */
function scrollPad() { return parseFloat(getComputedStyle(root).scrollPaddingTop) || 0; }

function focusTarget(el) {
  const f = el.matches('a, button, summary, input, [tabindex]') ? el : el.querySelector('h1, h2, h3, summary') || el;
  if (!f.matches('a, button, summary, input, [tabindex]')) f.setAttribute('tabindex', '-1');
  f.focus({ preventScroll: true });
}

/**
 * Scroll to an element honouring scroll-padding-top (fixed nav), then focus it.
 * Distance-scaled duration: short hops feel snappy, long jumps don't crawl.
 */
export function scrollToTarget(el, { instant = false, focus = true, onComplete } = {}) {
  if (typeof el === 'string') el = document.querySelector(el);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - scrollPad();
  if (focus) focusTarget(el); // preventScroll: true, so it's safe before scrolling
  if (!lenis || instant || mqReduce.matches) {
    window.scrollTo({ top, behavior: 'instant' });
    onComplete?.();
    return;
  }
  const dist = Math.abs(top - lenis.scroll);
  const long = dist > innerHeight * 1.5;
  lenis.scrollTo(el, {           // Lenis subtracts scroll-padding-top itself
    // short hops: expo-out (instant response). long jumps: in-out so peak speed is
    // ~3x lower than expo-out and the eye can track the travel instead of a "teleport"
    duration: long ? clamp(0.6 + dist / 8000, 0.8, 1.2) : clamp(0.5 + dist / 3000, 0.5, 0.8),
    easing: long ? inOutQuart : expoOut,
    force: true,                  // don't silently no-op if stopped (e.g. dialog just closing)
    onComplete,
  });
}

// one delegated handler for every same-page anchor (nav, skip link, brand → #top)
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest?.('a[href^="#"]');
  if (!a || a.hasAttribute('data-jump')) return;
  const id = decodeURIComponent(a.getAttribute('href').slice(1));
  const el = id ? document.getElementById(id) : null;
  if (!el) return;
  e.preventDefault();
  if (location.hash !== '#' + id) history.pushState(null, '', '#' + id);
  scrollToTarget(el, { instant: a.classList.contains('skip-link') });
});

/* ---------- modal dialogs: stop smooth scroll while any is open ---------- */
function dialogOpen() { return !!document.querySelector('dialog[open]:modal'); }
export function watchDialog(dlg) {
  if (!dlg) return;
  dlg.setAttribute('data-lenis-prevent', ''); // wheel inside (list, backdrop) stays native
  new MutationObserver(() => {
    if (!lenis) return;
    dlg.open ? lenis.stop() : lenis.start();
  }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
}

/* ---------- helpers for scroll-linked effects ---------- */
/** 0..1 progress of y between a and b (clamped). */
export const progress = (y, a, b) => clamp((y - a) / (b - a || 1), 0, 1);
