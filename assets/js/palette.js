// ⌘K command palette. Native <dialog> gives us focus trapping + Esc for free.

import { sound } from './util.js';

export function initPalette(dialog, commands) {
  const input = dialog.querySelector('input');
  const list = dialog.querySelector('[role="listbox"]');
  let items = [];
  let active = 0;

  const score = (cmd, q) => {
    if (!q) return 1;
    const hay = (cmd.label + ' ' + (cmd.keywords || '') + ' ' + cmd.group).toLowerCase();
    if (hay.includes(q)) return 2 + (cmd.label.toLowerCase().startsWith(q) ? 1 : 0);
    // loose subsequence match on the label only: "gh" → "GitHub"
    let i = 0;
    for (const ch of cmd.label.toLowerCase()) if (ch === q[i]) i++;
    return i === q.length ? 1 : 0;
  };

  function render() {
    const q = input.value.trim().toLowerCase();
    items = commands.map((c) => ({ c, s: score(c, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c);
    active = Math.min(active, Math.max(0, items.length - 1));
    list.innerHTML = '';
    let group = '';
    items.forEach((cmd, i) => {
      if (!q && cmd.group !== group) {
        group = cmd.group;
        const h = document.createElement('li');
        h.className = 'cmdk-group';
        h.setAttribute('role', 'presentation');
        h.textContent = group;
        list.appendChild(h);
      }
      const li = document.createElement('li');
      li.id = `cmd-${i}`;
      li.className = 'cmdk-item';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      li.innerHTML = `<span class="cmdk-icon" aria-hidden="true">${cmd.icon || '→'}</span><span class="cmdk-label"></span>${cmd.hint ? `<kbd class="cmdk-hint"></kbd>` : ''}`;
      li.querySelector('.cmdk-label').textContent = cmd.label;
      if (cmd.hint) li.querySelector('.cmdk-hint').textContent = cmd.hint;
      li.addEventListener('pointermove', () => { if (active !== i) { active = i; sync(); } });
      li.addEventListener('click', () => run(i));
      list.appendChild(li);
    });
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
    list.querySelectorAll('.cmdk-item').forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
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
    close();
    // let the dialog finish closing before navigating / scrolling
    requestAnimationFrame(() => cmd.run());
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
  function close() {
    if (!dialog.open) return;
    dialog.classList.remove('is-open');
    dialog.close();
  }

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, items.length); sync(); sound.tick(1.6); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % Math.max(1, items.length); sync(); sound.tick(1.6); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
  });
  // click on the backdrop closes
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('close', () => dialog.classList.remove('is-open'));

  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); dialog.open ? close() : open(true); }
    else if (e.key === '/' && !typing && !dialog.open) { e.preventDefault(); open(true); }
  });

  return { open, close };
}
