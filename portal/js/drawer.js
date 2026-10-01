// Drawer host (spec 5.6 container, 4.1 history rule, 4.8 focus). Owns
// dialog#drawer: its lifecycle, close paths and focus. What goes inside is the
// page's renderer (renderItemDrawer), which receives a dctx:
//
//   dctx = {
//     taskId,            the open= value: a task id, or 'new' (create)
//     params,            the route params (focus, kind, due, and view params)
//     me, role, audience, readOnly, scope, now, store, toast, confirm, go,
//     reveal(taskId),    after a create: open the new item's group and focus
//                        its row once the drawer closes and the list has it
//     route,             a copy of the page route ({ view, sub, id, params })
//     isRefresh,         true when re-rendered after a store change
//     body,              div.drawer-body content (write into it)
//     header,            div.drawer-bar-status (pill, draft chip)
//     headerActions,     slot before Close in the bar (the staff dots-three menu)
//     signal, alive(),   aborted when the drawer closes, shows another item, or
//                        a refresh render replaces this one on screen
//     setTitle(text),    creates or updates h2.drawer-title[tabindex=-1] in the
//                        body (appended if missing) and names the dialog; returns it
//     setFooter(nodes),  pinned div.drawer-footer (create/edit buttons); null clears
//     close(),           closes through the history rule
//     onRefresh(fn),     handle store changes yourself (keeps form input); without
//                        it the drawer re-renders on every change
//   }
//
// The renderer may return a promise; focus moves to the title (or the file input
// when focus=submit) once it resolves. A refresh renders into fresh containers
// and swaps them in when ready, so nothing flashes.

import { h, uid } from './dom.js';
import { iconButton, skeletonRows } from './ui.js';
import { prepareToastHost } from './overlays.js';

const SWAP_TIMEOUT_MS = 4000;

let dialog = null;
let bar = null;
let slots = null;         // { status, actions, body, footer } currently in the dialog
let renderFn = null;
let requestClose = () => hideDrawer();
let current = null;       // { key, taskId, controller, refresh }: the latest render
let shown = null;         // the entry whose content is in the dialog (differs from
                          // current while a refresh renders off screen)
let opener = null;        // focused before the drawer opened
let closingByHost = false;

const cssEscape = (s) => (globalThis.CSS?.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));

function makeSlots() {
  return {
    status: h('div', { class: 'drawer-bar-status' }),
    actions: h('span', { class: 'drawer-bar-slot' }),
    body: h('div', { class: 'drawer-body' }),
    footer: h('div', { class: 'drawer-footer', hidden: true }),
  };
}

function place(next) {
  const closeBtn = bar.querySelector('.drawer-close');
  bar.replaceChildren(next.status, h('div', { class: 'drawer-bar-actions' }, next.actions, closeBtn));
  const inner = dialog.querySelector('.drawer-inner');
  if (slots) {
    slots.body.replaceWith(next.body);
    slots.footer.replaceWith(next.footer);
  } else {
    inner.append(next.body, next.footer);
  }
  next.body.addEventListener('scroll', () => {
    bar.classList.toggle('is-scrolled', next.body.scrollTop > 0);
  }, { passive: true });
  bar.classList.remove('is-scrolled');
  slots = next;
}

// initDrawer({ render, onRequestClose }): render is the page's renderer;
// onRequestClose runs for Escape, Close and a backdrop click (the app applies
// the history rule there, which ends in hideDrawer()).
export function initDrawer({ render, onRequestClose } = {}) {
  renderFn = render;
  if (onRequestClose) requestClose = onRequestClose;
  dialog = document.getElementById('drawer');
  if (!dialog) {
    dialog = h('dialog', { class: 'drawer', id: 'drawer' });
    document.body.append(dialog);
  }
  dialog.setAttribute('aria-label', 'Details');
  const closeBtn = iconButton({ icon: 'x', label: 'Close', tip: 'end', className: 'drawer-close', onClick: () => requestClose() });
  bar = h('div', { class: 'drawer-bar' });
  bar.append(closeBtn);
  dialog.replaceChildren(h('div', { class: 'drawer-inner' }, bar));
  place(makeSlots());
  // The live region for toasts shown while the drawer is open exists up front
  prepareToastHost(dialog);

  // Escape: route it through the app. If the browser closes anyway (a second
  // Escape without user activation cannot be cancelled), fix the history after.
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    requestClose();
  });
  // The close event is queued, so the host's own close is recognised by a flag
  // that this handler resets
  dialog.addEventListener('close', () => {
    if (closingByHost) {
      closingByHost = false;
      return;
    }
    finishClose({ restore: true });
    requestClose();
  });
  // A backdrop click is a click whose press and release both hit the dialog box
  // itself; .drawer-inner fills it, so clicks on content never do
  let downOnDialog = false;
  dialog.addEventListener('pointerdown', (e) => { downOnDialog = e.target === dialog; });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && downOnDialog) requestClose();
  });
  // A file dropped anywhere in the drawer that no drop target handled (the bar,
  // a near miss) must not open in the tab and lose the drawer
  const guardDrop = (e) => {
    if (e.defaultPrevented || ![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
    if (e.type === 'dragover' && e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  };
  dialog.addEventListener('dragover', guardDrop);
  dialog.addEventListener('drop', guardDrop);
}

export function drawerOpen() {
  return Boolean(dialog?.open);
}

// The row whose drawer is open gets aria-current="true" (spec 5.1)
export function syncDrawerRow() {
  for (const row of document.querySelectorAll('#view a.row[aria-current="true"]')) row.removeAttribute('aria-current');
  if (!dialog?.open || !current || current.taskId === 'new') return;
  const row = document.querySelector(`#view [data-focus-key="row-${cssEscape(current.taskId)}"]`);
  if (row?.matches('a.row')) row.setAttribute('aria-current', 'true');
}

function focusInside(params) {
  if (!dialog.open) return;
  if (params?.focus === 'submit') {
    const input = slots.body.querySelector('input[type="file"]');
    if (input) {
      input.focus();
      return;
    }
  }
  const title = slots.body.querySelector('h2.drawer-title');
  if (title) title.focus();
}

function focusKeyInside() {
  const active = document.activeElement;
  return active && dialog.contains(active) ? active.dataset?.focusKey ?? null : null;
}

// showDrawer(base): opens the drawer (or switches it to another item, or
// re-renders it with base.isRefresh) and runs the renderer.
// base = { taskId, params, me, role, audience, readOnly, scope, now, store, toast, confirm, go, isRefresh }
export function showDrawer(base) {
  if (!dialog) throw new Error('initDrawer() first');
  const taskId = String(base.taskId);
  const key = `${taskId}|${base.params?.focus ?? ''}|${base.params?.kind ?? ''}|${base.params?.due ?? ''}`;
  // Same item already open and nothing changed (a re-sync): leave it alone
  if (!base.isRefresh && dialog.open && current?.key === key) return;
  const isRefresh = Boolean(base.isRefresh) && dialog.open && current?.key === key;

  if (isRefresh && current.refresh) {
    try {
      current.refresh();
    } catch (error) {
      console.error(error);
    }
    return;
  }

  // A refresh keeps the visible content alive until its replacement is swapped
  // in; only a stale off-screen render is dropped. Anything else replaces both.
  if (current && current !== shown) current.controller.abort();
  if (!isRefresh) {
    shown?.controller.abort();
    shown = null;
  }
  if (!dialog.open) {
    const active = document.activeElement;
    opener = active && active !== document.body ? active : null;
  }
  const controller = new AbortController();
  const entry = { key, taskId, controller, refresh: null };
  current = entry;

  const next = makeSlots();
  let title = null;
  const titleId = uid('drawer-title');
  const dctx = {
    ...base,
    taskId: taskId === 'new' ? 'new' : taskId,
    params: { ...(base.params ?? {}) },
    isRefresh,
    body: next.body,
    header: next.status,
    headerActions: next.actions,
    signal: controller.signal,
    alive: () => !controller.signal.aborted,
    setTitle(text) {
      title = next.body.querySelector('h2.drawer-title');
      if (!title) {
        title = h('h2', { class: 'drawer-title', tabindex: '-1' });
        next.body.append(title);
      }
      if (!title.id) title.id = titleId;
      title.textContent = text ?? '';
      if (slots === next) nameDialog(title.id);
      return title;
    },
    setFooter(nodes) {
      const list = nodes === null || nodes === undefined ? [] : [].concat(nodes).filter(Boolean);
      next.footer.replaceChildren(...list);
      next.footer.hidden = list.length === 0;
    },
    close: () => requestClose(),
    onRefresh(fn) {
      entry.refresh = typeof fn === 'function' ? fn : null;
    },
  };

  const swap = () => {
    if (current !== entry || slots === next) return;
    // Read focus now: the person may have moved while the refresh loaded
    const keepKey = focusKeyInside();
    if (shown && shown !== entry) shown.controller.abort();
    shown = entry;
    place(next);
    const t = next.body.querySelector('h2.drawer-title');
    if (t?.id) nameDialog(t.id);
    else unnameDialog();
    if (isRefresh) {
      const el = keepKey ? next.body.querySelector(`[data-focus-key="${cssEscape(keepKey)}"]`) : null;
      if (el) el.focus({ preventScroll: true });
      else if (!dialog.contains(document.activeElement)) focusInside(dctx.params);
    }
  };

  if (!isRefresh) {
    next.body.append(skeletonRows(3));
    place(next);
    shown = entry;
    unnameDialog();
    if (!dialog.open) dialog.showModal();
  }
  syncDrawerRow();

  let result;
  try {
    result = renderFn?.(dctx);
  } catch (error) {
    console.error(error);
  }
  const settle = () => {
    if (current !== entry || controller.signal.aborted) return;
    if (isRefresh) swap();
    else {
      const t = next.body.querySelector('h2.drawer-title');
      if (t?.id) nameDialog(t.id);
      // Leave focus alone if the person already moved into the content
      if (!next.body.contains(document.activeElement)) focusInside(dctx.params);
    }
  };
  if (result && typeof result.then === 'function') {
    if (isRefresh) setTimeout(() => { if (current === entry) swap(); }, SWAP_TIMEOUT_MS);
    result.then(settle, (error) => {
      console.error(error);
      settle();
    });
  } else {
    settle();
  }
}

function nameDialog(id) {
  dialog.setAttribute('aria-labelledby', id);
  dialog.removeAttribute('aria-label');
}

function unnameDialog() {
  dialog.removeAttribute('aria-labelledby');
  dialog.setAttribute('aria-label', 'Details');
}

function finishClose({ restore }) {
  const closed = current;
  current?.controller.abort();
  shown?.controller.abort();
  current = null;
  shown = null;
  syncDrawerRow();
  if (!restore) {
    opener = null;
    return;
  }
  // Focus: the row for this item, else what was focused before, else the h1.
  // A row inside a closed <details> (a Done or No due date group) or otherwise
  // hidden cannot take focus, so the next candidate gets it instead of <body>.
  const row = closed && closed.taskId !== 'new'
    ? document.querySelector(`#view [data-focus-key="row-${cssEscape(closed.taskId)}"]`)
    : null;
  const candidates = [
    row,
    opener?.isConnected && !dialog.contains(opener) ? opener : null,
    document.querySelector('#view h1'),
  ];
  opener = null;
  focusFirst(candidates);
}

function canFocus(el) {
  if (!el?.isConnected || el.closest('details:not([open])')) return false;
  if (typeof el.checkVisibility === 'function') return el.checkVisibility();
  return true;
}

// Focuses the first element that can take focus and actually does
function focusFirst(list) {
  for (const el of list) {
    if (!canFocus(el)) continue;
    el.focus?.();
    if (document.activeElement === el) return true;
  }
  return false;
}

// hideDrawer({ restoreFocus = true }): closes the dialog with no history change.
// A view change passes restoreFocus: false (the new view focuses its h1).
export function hideDrawer({ restoreFocus = true } = {}) {
  if (!dialog) return;
  if (!dialog.open) {
    if (current) finishClose({ restore: false });
    return;
  }
  closingByHost = true;
  dialog.close();
  finishClose({ restore: restoreFocus });
}
