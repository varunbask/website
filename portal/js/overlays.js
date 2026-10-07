// Overlays: the confirm dialog, toasts, action menus and tooltips (spec 6).
// Markup follows the COMPONENT CLASS API comment in portal/css/app.css.
//
// Pure pieces (toastDuration, menuIndex, MAX_TOASTS) are exported for tests.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, iconButton } from './ui.js';

// ---------------------------------------------------------------------------
// Pure logic

export const MAX_TOASTS = 3;
export const TOAST_MS = 6000;
export const TOAST_ACTION_MS = 10000;

// 6 seconds, or 10 with an action; an explicit duration wins
export function toastDuration({ duration, action } = {}) {
  if (Number.isFinite(duration) && duration > 0) return duration;
  return action ? TOAST_ACTION_MS : TOAST_MS;
}

// Next focused index in a menu of `count` items for a key, or null when the
// key does not move focus. Arrows wrap; Home and End jump.
export function menuIndex(current, key, count) {
  if (!count) return null;
  switch (key) {
    case 'ArrowDown': return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp': return current < 0 ? count - 1 : (current - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Confirm dialog

let activeConfirm = null;

function settleConfirm(value) {
  if (!activeConfirm) return;
  const { resolve, cleanup } = activeConfirm;
  activeConfirm = null;
  cleanup();
  resolve(value);
}

// confirmDialog({ title, body, details, requireText, confirmLabel, cancelLabel, tone = 'danger' }) -> Promise<boolean>.
// Cancel is focused first. Only the action resolves true; Cancel, Escape and a
// backdrop click resolve false. Focus returns to the control that opened it.
// Optional extras, for a decision that cannot be undone:
//   details       lines listed under the body (what would be lost)
//   requireText   { label, match(typed) }: the action stays off until the typed
//                 text matches (the person's name); the field is focused first
//   confirmLabel: null   no action at all, only a Close button (the reason it cannot be done)
export function confirmDialog({
  title, body, details = [], requireText = null, confirmLabel = 'Confirm', cancelLabel, tone = 'danger',
} = {}) {
  let dialog = document.getElementById('confirm');
  if (!dialog) {
    dialog = h('dialog', { class: 'confirm', id: 'confirm' });
    document.body.append(dialog);
  }
  // A second confirm replaces the first (which resolves false) and keeps its opener
  const opener = dialog.open && activeConfirm ? activeConfirm.opener : document.activeElement;
  settleConfirm(false);

  const titleId = uid('confirm-title');
  const bodyId = uid('confirm-body');
  const finish = (value) => {
    if (dialog.open) dialog.close();
    settleConfirm(value);
    restoreFocus(opener);
  };
  const decides = confirmLabel !== null;
  const cancel = button({ label: cancelLabel ?? (decides ? 'Cancel' : 'Close'), variant: 'secondary', onClick: () => finish(false) });
  cancel.autofocus = true;
  const ok = decides
    ? button({
      label: confirmLabel,
      variant: tone === 'danger' ? 'danger' : 'primary',
      onClick: () => finish(true),
      disabled: Boolean(requireText),
    })
    : null;

  // Typing the name: the action wakes up when it matches (Enter then confirms)
  let typed = null;
  let typedField = null;
  if (requireText && ok) {
    const fieldId = uid('confirm-type');
    typedField = h('input', {
      class: 'input confirm-input', id: fieldId, type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    });
    typedField.addEventListener('input', () => { ok.disabled = !requireText.match(typedField.value); });
    typedField.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!ok.disabled) finish(true);
    });
    typed = h('div', { class: 'confirm-type' }, h('label', { class: 'confirm-type-label', for: fieldId }, requireText.label), typedField);
  }

  // A list under the body wraps both, so one description names them together
  const lines = (details ?? []).filter(Boolean);
  let described = null;
  if (lines.length) {
    described = h('div', { class: 'confirm-text', id: bodyId },
      body ? h('p', { class: 'confirm-body' }, body) : null,
      h('ul', { class: 'confirm-details' }, lines.map((line) => h('li', {}, line))));
  } else if (body) {
    described = h('p', { class: 'confirm-body', id: bodyId }, body);
  }

  dialog.replaceChildren(h('div', { class: 'confirm-inner' },
    h('h2', { class: 'confirm-title', id: titleId }, title),
    described,
    typed,
    h('div', { class: 'confirm-actions' }, cancel, ok)));
  prepareToastHost(dialog);
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-labelledby', titleId);
  if (described) dialog.setAttribute('aria-describedby', bodyId);
  else dialog.removeAttribute('aria-describedby');

  return new Promise((resolve) => {
    // A backdrop click is a click whose press and release both hit the dialog
    // itself (.confirm-inner fills it, so content clicks never do)
    let downOnDialog = false;
    const onDown = (e) => { downOnDialog = e.target === dialog; };
    const onClick = (e) => { if (e.target === dialog && downOnDialog) finish(false); };
    // Escape fires cancel, then close; any other close (a route change) is a no
    const onClose = () => { settleConfirm(false); restoreFocus(opener); };
    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('close', onClose);
    activeConfirm = {
      resolve,
      opener,
      cleanup: () => {
        dialog.removeEventListener('pointerdown', onDown);
        dialog.removeEventListener('click', onClick);
        dialog.removeEventListener('close', onClose);
      },
    };
    if (!dialog.open) dialog.showModal();
    (typedField ?? cancel).focus();
  });
}

// choiceDialog({ title, body, warning, choices, cancelLabel }) -> Promise<value | null>.
// Like confirmDialog, but each of `choices` ([{ value, label, primary }]) is a
// button that resolves its value; Cancel, Escape and a backdrop click resolve
// null. warning: { title, lines } shown under the body (a clash, say).
export function choiceDialog({ title, body, warning = null, choices = [], cancelLabel = 'Cancel' } = {}) {
  let dialog = document.getElementById('confirm');
  if (!dialog) {
    dialog = h('dialog', { class: 'confirm', id: 'confirm' });
    document.body.append(dialog);
  }
  const opener = dialog.open && activeConfirm ? activeConfirm.opener : document.activeElement;
  settleConfirm(null);

  const titleId = uid('confirm-title');
  const bodyId = uid('confirm-body');
  const finish = (value) => {
    if (dialog.open) dialog.close();
    settleConfirm(value);
    restoreFocus(opener);
  };
  const cancel = button({ label: cancelLabel, variant: 'secondary', onClick: () => finish(null) });
  cancel.autofocus = true;
  const actions = choices.map((c) => button({
    label: c.label,
    variant: c.primary ? 'primary' : 'secondary',
    onClick: () => finish(c.value),
  }));

  const warn = warning?.title
    ? h('div', { class: 'confirm-warning', role: 'note' },
      icon('warning-circle', { size: 16 }),
      h('div', {},
        h('p', { class: 'confirm-warning-title' }, warning.title),
        warning.lines?.length ? h('ul', { class: 'confirm-warning-lines' }, warning.lines.map((line) => h('li', {}, line))) : null))
    : null;

  dialog.replaceChildren(h('div', { class: 'confirm-inner' },
    h('h2', { class: 'confirm-title', id: titleId }, title),
    body || warn ? h('div', { id: bodyId }, body ? h('p', { class: 'confirm-body' }, body) : null, warn) : null,
    h('div', { class: 'confirm-actions' }, cancel, actions)));
  prepareToastHost(dialog);
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-labelledby', titleId);
  if (body || warn) dialog.setAttribute('aria-describedby', bodyId);
  else dialog.removeAttribute('aria-describedby');

  return new Promise((resolve) => {
    let downOnDialog = false;
    const onDown = (e) => { downOnDialog = e.target === dialog; };
    const onClick = (e) => { if (e.target === dialog && downOnDialog) finish(null); };
    const onClose = () => { settleConfirm(null); restoreFocus(opener); };
    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('close', onClose);
    activeConfirm = {
      // a confirm that replaces this one settles it with false: that is a cancel too
      resolve: (value) => resolve(typeof value === 'string' ? value : null),
      opener,
      cleanup: () => {
        dialog.removeEventListener('pointerdown', onDown);
        dialog.removeEventListener('click', onClick);
        dialog.removeEventListener('close', onClose);
      },
    };
    if (!dialog.open) dialog.showModal();
    cancel.focus();
  });
}

function restoreFocus(el) {
  if (!el || !el.isConnected || typeof el.focus !== 'function') return;
  const active = document.activeElement;
  if (!active || active === document.body || active === el) return el.focus();
  // The native close already moved focus somewhere sensible; only fix it if it
  // landed inside a now-closed dialog
  if (active.closest?.('dialog:not([open])')) el.focus();
}

// ---------------------------------------------------------------------------
// Toasts

function safeMatches(el, selector) {
  try { return el.matches(selector); } catch { return false; }
}

// Toasts go in #toasts, outside the view host, so they survive navigation. A
// modal dialog makes everything outside it inert, so while one is open the toast
// goes in a toast host inside that dialog instead; when the dialog closes, its
// toasts move back to #toasts and keep their timers.
//
// Screen readers often skip a live region that appears and fills in the same
// moment, so dialogs that can show toasts prepare their host ahead of time
// (prepareToastHost), and a host made on demand gets its first toast a moment
// after it is inserted.
export function prepareToastHost(dialog) {
  if (!dialog) return null;
  let inner = dialog.querySelector(':scope > .toasts');
  if (inner) return inner;
  inner = h('div', { class: 'toasts is-in-dialog', 'aria-live': 'polite' });
  dialog.append(inner);
  if (!dialog.vbToastClose) {
    dialog.vbToastClose = true;
    dialog.addEventListener('close', () => {
      const own = dialog.querySelector(':scope > .toasts');
      if (!own) return;
      const main = mainToastHost();
      for (const t of [...own.children]) if (!t.classList.contains('is-leaving')) main.append(t);
      trim(main);
    });
  }
  return inner;
}

// -> { host, fresh }: fresh is true when the host was created just now
function toastHost() {
  const open = [...document.querySelectorAll('dialog[open]')].filter((d) => safeMatches(d, ':modal'));
  const top = open[open.length - 1];
  if (top) {
    const existing = top.querySelector(':scope > .toasts');
    if (existing) return { host: existing, fresh: false };
    return { host: prepareToastHost(top), fresh: true };
  }
  const existing = document.getElementById('toasts');
  return { host: mainToastHost(), fresh: !existing };
}

function mainToastHost() {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { class: 'toasts', id: 'toasts', 'aria-live': 'polite' });
    document.body.append(host);
  }
  return host;
}

function trim(host) {
  const live = [...host.children].filter((t) => t.classList.contains('toast') && !t.classList.contains('is-leaving'));
  for (const old of live.slice(0, Math.max(0, live.length - MAX_TOASTS))) old.vbDismiss?.();
}

// toast({ text, action: { label, run }, duration }) -> { dismiss }.
// 6 seconds (10 with an action), paused while hovered or focused, at most 3.
export function toast({ text, action, duration } = {}) {
  const { host, fresh } = toastHost();
  let remaining = toastDuration({ duration, action });
  let timer = null;
  let startedAt = 0;
  let hovered = false;
  let focused = false;
  let gone = false;

  const el = h('div', { class: 'toast' }, h('p', { class: 'toast-text' }, text));

  const dismiss = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    el.classList.add('is-leaving');
    const hadFocus = el.contains(document.activeElement);
    const remove = () => { el.remove(); };
    el.addEventListener('animationend', remove, { once: true });
    // Reduced motion turns the exit animation off, so animationend never fires
    setTimeout(remove, 400);
    if (hadFocus) document.getElementById('main')?.focus({ preventScroll: true });
  };
  el.vbDismiss = dismiss;

  if (action?.label) {
    el.append(h('button', {
      type: 'button',
      class: 'toast-action',
      onClick: async () => {
        dismiss();
        await action.run?.();
      },
    }, action.label));
  }
  el.append(h('button', {
    type: 'button',
    class: 'toast-close',
    'aria-label': 'Dismiss',
    onClick: dismiss,
  }, icon('x')));

  const start = () => {
    if (gone || hovered || focused) return;
    clearTimeout(timer);
    startedAt = Date.now();
    timer = setTimeout(dismiss, remaining);
  };
  const pause = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    remaining = Math.max(1000, remaining - (Date.now() - startedAt));
  };
  el.addEventListener('mouseenter', () => { hovered = true; pause(); });
  el.addEventListener('mouseleave', () => { hovered = false; start(); });
  el.addEventListener('focusin', () => { focused = true; pause(); });
  el.addEventListener('focusout', (e) => {
    if (el.contains(e.relatedTarget)) return;
    focused = false;
    start();
  });

  const show = () => {
    if (gone) return;
    // The dialog may have closed in the meantime; its toasts belong in #toasts
    const into = host.isConnected && host.closest('dialog')?.open !== false ? host : mainToastHost();
    into.append(el);
    trim(into);
    start();
  };
  if (fresh) setTimeout(show, 50);
  else show();
  return { dismiss, el };
}

// ---------------------------------------------------------------------------
// Menu

// menu({ label, items: [{ label, icon, onSelect, tone, disabled } | { separator: true }] })
// A trigger button (icon-only by default, or a text button with `text`) and a
// ul[role=menu]. Arrows, Home and End move; Escape and Tab close; focus returns
// to the button; a click outside closes.
// Options: icon (default 'dots-three'), text, align ('end' | 'start'), up, variant.
export function menu({ label, items = [], icon: iconName = 'dots-three', text, align = 'end', up = false, variant = 'ghost', size = 'sm' } = {}) {
  const listId = uid('menu');
  const trigger = text
    ? button({ label: text, variant, size, iconEnd: 'caret-down', ariaLabel: label && label !== text ? label : undefined })
    : iconButton({ icon: iconName, label, tip: false });
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', listId);

  const list = h('ul', {
    class: ['menu-list', align === 'start' ? 'align-start' : null, up ? 'is-up' : null].filter(Boolean).join(' '),
    id: listId,
    role: 'menu',
    'aria-label': label || text,
    hidden: true,
  });
  const root = h('div', { class: 'menu' }, trigger, list);

  const entries = [];
  for (const it of items) {
    if (!it) continue;
    if (it.separator) {
      list.append(h('li', { class: 'menu-sep', role: 'separator' }));
      continue;
    }
    const btn = h('button', {
      type: 'button',
      class: it.tone === 'danger' ? 'menu-item is-danger' : 'menu-item',
      role: 'menuitem',
      tabindex: '-1',
      disabled: it.disabled,
      onClick: () => {
        close(true);
        it.onSelect?.();
      },
    }, it.icon ? icon(it.icon) : null, h('span', {}, it.label));
    entries.push(btn);
    list.append(h('li', { role: 'none' }, btn));
  }

  const enabled = () => entries.filter((b) => !b.disabled);
  const isOpen = () => !list.hidden;

  const onOutside = (e) => { if (!root.contains(e.target)) close(false); };

  function open(index = 0) {
    if (!isOpen()) {
      list.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', onOutside, true);
    }
    const list2 = enabled();
    if (list2.length) list2[index < 0 ? list2.length - 1 : Math.min(index, list2.length - 1)].focus();
  }

  function close(refocus) {
    if (!isOpen()) return;
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    if (refocus) trigger.focus();
  }

  trigger.addEventListener('click', () => (isOpen() ? close(false) : open(0)));
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); open(0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); open(-1); }
  });
  list.addEventListener('keydown', (e) => {
    const all = enabled();
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // do not also close a drawer the menu sits in
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      // Focus the trigger first so the browser's Tab moves on from there
      close(true);
      return;
    }
    const next = menuIndex(all.indexOf(document.activeElement), e.key, all.length);
    if (next !== null) {
      e.preventDefault();
      all[next].focus();
    }
  });
  root.addEventListener('focusout', (e) => {
    if (isOpen() && e.relatedTarget && !root.contains(e.relatedTarget)) close(false);
  });

  root.close = () => close(false);
  return root;
}

// ---------------------------------------------------------------------------
// Tooltip

// Adds (or updates) a CSS tooltip: span.tip[aria-hidden] shown on hover and
// focus after 400ms. Gives the element an aria-label when it has no name.
// placement: 'bottom' (default) | 'top' | 'right' | 'left' | 'end'
export function tooltip(el, text, { placement = 'bottom' } = {}) {
  el.classList.add('has-tip');
  let tip = el.querySelector(':scope > .tip');
  if (!tip) {
    tip = h('span', { class: 'tip', 'aria-hidden': 'true' });
    el.append(tip);
  }
  tip.className = placement && placement !== 'bottom' ? `tip tip-${placement}` : 'tip';
  tip.textContent = text;
  const hasName = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
    || [...el.childNodes].some((n) => n !== tip && n.textContent?.trim() && n.getAttribute?.('aria-hidden') !== 'true');
  if (!hasName) el.setAttribute('aria-label', text);
  return el;
}
