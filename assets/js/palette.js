// ⌘K command palette. Native <dialog> gives us focus trapping + Esc for free.
// ARIA: combobox input + listbox with grouped options (APG combobox pattern).

import { sound } from './util.js';

export function initPalette(dialog, commands, { shortcutsOn = () => true } = {}) {
  const input = dialog.querySelector('input');
  const list = dialog.querySelector('[role="listbox"]');
  let items = [];
  let active = 0;

  const labelOf = (cmd) => (typeof cmd.label === 'function' ? cmd.label() : cmd.label);
  const fold = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // Label hits outrank keyword hits, so "gh" finds GitHub before "light".
  const score = (cmd, q) => {
    if (!q) return 1;
    const label = fold(labelOf(cmd));
    const words = label.split(/[^a-z0-9]+/).filter(Boolean);
    const keys = fold(cmd.keywords || '').split(/\s+/).filter(Boolean);
    if (label.startsWith(q)) return 7;
    if (words.some((w) => w.startsWith(q))) return 6;
    if (label.includes(q)) return 5;
    if (keys.some((k) => k.startsWith(q))) return 4.5;
    // initials / word-start subsequence: "gh" → GitHub, "ce" → copy email
    let i = 0;
    for (const w of words) for (const ch of w) { if (ch === q[i]) i++; else break; }
    if (i === q.length) return 3;
    if (keys.some((k) => k.includes(q))) return 2;
    return 0;
  };

  function option(cmd, i) {
    const li = document.createElement('li');
    li.id = `cmd-${i}`;
    li.className = 'cmdk-item';
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === active));
    const hint = cmd.hint && shortcutsOn();
    li.innerHTML = `<span class="cmdk-icon" aria-hidden="true"></span><span class="cmdk-label"></span>${hint ? '<kbd class="cmdk-hint" aria-hidden="true"></kbd>' : ''}`;
    li.querySelector('.cmdk-icon').textContent = cmd.icon || '→';
    li.querySelector('.cmdk-label').textContent = labelOf(cmd);
    if (hint) li.querySelector('.cmdk-hint').textContent = cmd.hint;
    li.addEventListener('pointermove', () => { if (active !== i) { active = i; sync(); } });
    li.addEventListener('click', () => run(i));
    return li;
  }

  function render() {
    const q = fold(input.value.trim());
    items = commands.filter((c) => !c.when || c.when())
      .map((c) => ({ c, s: score(c, q) })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s).map((x) => x.c);
    active = Math.min(active, Math.max(0, items.length - 1));
    list.innerHTML = '';
    if (q) {
      items.forEach((cmd, i) => list.appendChild(option(cmd, i)));
    } else {
      // grouped: <li role="group" aria-labelledby> > <ul role="none"> > options
      let groupEl = null, group = '';
      items.forEach((cmd, i) => {
        if (cmd.group !== group) {
          group = cmd.group;
          const gid = `cmdg-${group.toLowerCase()}`;
          const li = document.createElement('li');
          li.setAttribute('role', 'presentation');
          li.innerHTML = `<ul role="group" aria-labelledby="${gid}" class="cmdk-sub"><li class="cmdk-group" id="${gid}" role="presentation"></li></ul>`;
          li.querySelector('.cmdk-group').textContent = group;
          list.appendChild(li);
          groupEl = li.firstChild;
        }
        groupEl.appendChild(option(cmd, i));
      });
    }
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'cmdk-empty';
      li.setAttribute('role', 'presentation');
      li.textContent = 'No results. Try “email” or “github”.';
      list.appendChild(li);
    }
    sync();
  }

  function sync() {
    list.querySelectorAll('.cmdk-item').forEach((el) => el.setAttribute('aria-selected', String(el.id === `cmd-${active}`)));
    const el = list.querySelector(`#cmd-${active}`);
    if (el) {
      input.setAttribute('aria-activedescendant', el.id);
      el.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function run(i) {
    const cmd = items[i];
    if (!cmd) return;
    sound.tick(1.2);
    // run once the dialog has closed (and handed focus back), so the command's
    // own focus/scroll wins
    close(() => requestAnimationFrame(() => cmd.run()));
  }

  // Keyboard-invoked = frequent = instant. Pointer-invoked gets the soft entrance.
  function open(viaKeyboard = false) {
    if (dialog.open) return;
    dialog.classList.toggle('no-anim', viaKeyboard === true);
    input.value = '';
    active = 0;
    render();
    dialog.showModal();
    dialog.classList.add('is-open');
    input.focus();
    sound.tick(0.9);
  }
  // Pointer-opened palettes fade out (150ms); keyboard-opened ones vanish instantly.
  let closing = 0;
  function close(then) {
    if (!dialog.open) return;
    const instant = dialog.classList.contains('no-anim') || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (closing) return;
    const finish = () => { closing = 0; dialog.classList.remove('is-open', 'is-closing'); dialog.close(); then?.(); };
    if (instant) return finish();
    dialog.classList.add('is-closing');
    dialog.classList.remove('is-open');
    closing = setTimeout(finish, 150);
  }

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    const n = Math.max(1, items.length);
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % n; sync(); sound.tick(1.6); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + n) % n; sync(); sound.tick(1.6); }
    else if (e.key === 'Home') { e.preventDefault(); active = 0; sync(); }
    else if (e.key === 'End') { e.preventDefault(); active = n - 1; sync(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
  });
  // click on the backdrop closes
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('close', () => { clearTimeout(closing); closing = 0; dialog.classList.remove('is-open', 'is-closing'); });
  // Escape: animate out like every other close
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); dialog.open ? close() : open(true); }
    else if (e.key === '/' && !typing && !dialog.open && !e.metaKey && !e.ctrlKey && !e.altKey && shortcutsOn()) { e.preventDefault(); open(true); }
  });

  return { open, close };
}
