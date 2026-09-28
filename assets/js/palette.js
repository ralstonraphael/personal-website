// ⌘K command palette. Native <dialog> gives us focus trapping + Esc for free.
// ARIA: combobox input + listbox with grouped options (APG combobox pattern).

import { sound } from './util.js';

export function initPalette(dialog, commands, { shortcutsOn = () => true } = {}) {
  const input = dialog.querySelector('input');
  const list = dialog.querySelector('[role="listbox"]');
  let items = [];
  let active = 0;

  const labelOf = (cmd) => (typeof cmd.label === 'function' ? cmd.label() : cmd.label);

  // Label hits outrank keyword hits, so "gh" finds GitHub before "light".
  const score = (cmd, q) => {
    if (!q) return 1;
    const label = labelOf(cmd).toLowerCase();
    if (label.startsWith(q)) return 6;
    if (label.includes(q)) return 5;
    let i = 0;
    for (const ch of label) if (ch === q[i]) i++;
    if (i === q.length) return 4;
    if ((cmd.keywords || '').toLowerCase().includes(q)) return 2;
    return 0;
  };

  function option(cmd, i) {
    const li = document.createElement('li');
    li.id = `cmd-${i}`;
    li.className = 'cmdk-item';
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === active));
    li.innerHTML = `<span class="cmdk-icon" aria-hidden="true"></span><span class="cmdk-label"></span>${cmd.hint ? '<kbd class="cmdk-hint" aria-hidden="true"></kbd>' : ''}`;
    li.querySelector('.cmdk-icon').textContent = cmd.icon || '→';
    li.querySelector('.cmdk-label').textContent = labelOf(cmd);
    if (cmd.hint) li.querySelector('.cmdk-hint').textContent = cmd.hint;
    li.addEventListener('pointermove', () => { if (active !== i) { active = i; sync(); } });
    li.addEventListener('click', () => run(i));
    return li;
  }

  function render() {
    const q = input.value.trim().toLowerCase();
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
          li.setAttribute('role', 'group');
          li.setAttribute('aria-labelledby', gid);
          li.innerHTML = `<div class="cmdk-group" id="${gid}" role="presentation"></div><ul role="none" class="cmdk-sub"></ul>`;
          li.firstChild.textContent = group;
          list.appendChild(li);
          groupEl = li.lastChild;
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
    const n = Math.max(1, items.length);
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % n; sync(); sound.tick(1.6); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + n) % n; sync(); sound.tick(1.6); }
    else if (e.key === 'Home') { e.preventDefault(); active = 0; sync(); }
    else if (e.key === 'End') { e.preventDefault(); active = n - 1; sync(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
  });
  // click on the backdrop closes
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('close', () => dialog.classList.remove('is-open'));

  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); dialog.open ? close() : open(true); }
    else if (e.key === '/' && !typing && !dialog.open && !e.metaKey && !e.ctrlKey && !e.altKey && shortcutsOn()) { e.preventDefault(); open(true); }
  });

  return { open, close };
}
