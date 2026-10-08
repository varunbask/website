// Command palette: Cmd+K (Mac) or Ctrl+K (elsewhere), or "/" outside a text
// field, or the search button in the top bar. A modal dialog with a search box
// and a list of places to jump to: pages, students, assignments and tasks,
// upcoming sessions and a few actions. Matching and ranking live in
// palette-model.js, what can be found in palette-items.js; this file is the
// dialog, the keyboard and the data loading.
//
// mountPalette({ me, page, store, context, go, openDrawer, switchScope }) -> { open, close, isOpen }
//   context()      -> { scope: { student } | null, route, options } now
//   go(url)        router.go: a hash, ?student=.. or another page
//   openDrawer(id, extra)   router.openDrawer
//   switchScope(id)         change the child on screen (parents)
//
// Data comes from the store when the palette first opens and is kept; a store
// change drops it and the next open (or the open palette) loads it again.
//
// Markup follows the pattern in palette.css: dialog.palette > div.palette-inner >
// div.palette-search (input[role=combobox] + close) + div.palette-body >
// div[role=listbox] > div[role=group] > div[role=option], and aria-activedescendant
// on the input names the option Enter will run.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { iconButton } from './ui.js';
import { personAvatar } from './photos.js';
import { menuIndex } from './overlays.js';
import {
  rank, browse, group, remember, parseRecent, resolveRecent, prepareQuery,
  isApple, shortcutHint, shortcutAction, listKey,
} from './palette-model.js';
import { staticItems, staffDataItems, familyDataItems } from './palette-items.js';

const STAFF = new Set(['tutor', 'admin']);
const DIALOG_ID = 'palette';
const RECENT_MAX = 8;
const RECENT_SHOWN = 5;
const DATA_MAX_AGE_MS = 5 * 60 * 1000;
const SEARCH_LIMITS = { perGroup: 8, total: 30 };
const BROWSE_LIMITS = { perGroup: 12, total: 30 };

function platformName() {
  const nav = globalThis.navigator;
  return nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || '';
}

export function mountPalette({ me, page, store, context, go, openDrawer, switchScope }) {
  const staff = STAFF.has(me.role);
  const apple = isApple(platformName());
  const recentKey = `vb-palette-recent-${me.id}`;
  const vv = globalThis.visualViewport ?? null;

  let statics = [];          // pages, actions, children: rebuilt on every open
  let data = { key: null, items: [], state: 'idle', at: 0 };   // idle | loading | ready | error
  let loadSeq = 0;
  let recent = [];
  let visible = [];          // the items on screen, in order
  let active = 0;
  let opener = null;
  let lastPointer = null;

  // -------------------------------------------------------------------------
  // Storage (recent picks)

  function readRecent() {
    try {
      return parseRecent(globalThis.localStorage?.getItem(recentKey), RECENT_MAX);
    } catch {
      return [];
    }
  }

  function writeRecent() {
    try {
      globalThis.localStorage?.setItem(recentKey, JSON.stringify(recent));
    } catch {
      // storage blocked: recent picks last for this page only
    }
  }

  // -------------------------------------------------------------------------
  // Markup

  const titleId = uid('palette-title');
  const listId = uid('palette-list');
  const statusId = uid('palette-status');
  const optionBase = uid('palette-option');
  const groupBase = uid('palette-group');

  const prompt = staff ? 'Search students, work, sessions and pages' : 'Search work, sessions and pages';
  const placeholder = staff ? 'Search students, work and pages' : 'Search work, sessions and pages';

  const input = h('input', {
    class: 'palette-input',
    type: 'text',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    'aria-label': prompt,
    placeholder,
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
  });
  const list = h('div', { class: 'palette-list', role: 'listbox', id: listId, 'aria-label': 'Results' });
  const empty = h('p', { class: 'palette-empty', hidden: true });
  const note = h('p', { class: 'palette-note', hidden: true });
  const body = h('div', { class: 'palette-body' }, list, empty, note);
  const status = h('p', { class: 'visually-hidden', id: statusId, role: 'status', 'aria-live': 'polite' });
  const closeButton = iconButton({ icon: 'x', label: 'Close search', tip: false, className: 'palette-close', onClick: () => close() });
  const hints = h('div', { class: 'palette-foot', 'aria-hidden': 'true' },
    h('span', {}, h('kbd', { class: 'palette-kbd' }, '↑'), h('kbd', { class: 'palette-kbd' }, '↓'), ' Move'),
    h('span', {}, h('kbd', { class: 'palette-kbd' }, '↵'), ' Open'),
    h('span', {}, h('kbd', { class: 'palette-kbd' }, 'Esc'), ' Close'));

  const dialog = h('dialog', {
    class: 'palette',
    id: DIALOG_ID,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
  },
  h('div', { class: 'palette-inner' },
    h('h2', { class: 'visually-hidden', id: titleId }, 'Search and jump to'),
    h('div', { class: 'palette-search' }, icon('magnifying-glass', { size: 20 }), input, closeButton),
    body,
    status,
    hints));
  document.body.append(dialog);

  // The top bar button: a search field look with the shortcut chip at 768px and
  // up with a mouse, an icon alone on phones and touch screens
  const trigger = h('button', {
    type: 'button',
    class: 'palette-trigger',
    'aria-label': 'Search',
    'aria-haspopup': 'dialog',
    'aria-controls': DIALOG_ID,
    'aria-expanded': 'false',
    'aria-keyshortcuts': apple ? 'Meta+K' : 'Control+K',
    onClick: () => open(),
  },
  icon('magnifying-glass'),
  h('span', { class: 'palette-trigger-label' }, 'Search'),
  h('kbd', { class: 'palette-kbd', 'aria-hidden': 'true' }, shortcutHint(apple)));
  const topbar = document.querySelector('.topbar');
  const actions = document.getElementById('topbar-actions');
  if (topbar) topbar.insertBefore(trigger, actions?.parentElement === topbar ? actions : null);

  // -------------------------------------------------------------------------
  // Data

  const allItems = () => [...statics, ...data.items];

  function dataKey(ctx) {
    return staff ? `staff:${me.id}` : `${me.id}:${ctx.scope?.student?.id ?? ''}`;
  }

  // Starts a load unless fresh data for this scope is already here or on its way
  function ensureData() {
    const ctx = context();
    const key = dataKey(ctx);
    const fresh = data.state === 'ready' && Date.now() - data.at < DATA_MAX_AGE_MS;
    if (data.key === key && (fresh || data.state === 'loading')) return;
    load(ctx, key);
  }

  async function load(ctx, key) {
    const mine = ++loadSeq;
    // Same scope: keep showing what we had while the new data comes in
    data = { key, items: data.key === key ? data.items : [], state: 'loading', at: 0 };
    let next;
    try {
      const now = new Date();
      let items = [];
      if (staff) {
        items = staffDataItems({ me, workspace: await store.getWorkspace(), page, now });
      } else if (ctx.scope?.student) {
        const id = ctx.scope.student.id;
        const [studentData, sessions] = await Promise.all([store.getStudentData(id), store.getSessions(id).catch(() => [])]);
        items = familyDataItems({ data: studentData, sessions, now });
      }
      next = { key, items, state: 'ready', at: Date.now() };
    } catch (error) {
      console.error(error);
      next = { key, items: [], state: 'error', at: 0 };
    }
    if (mine !== loadSeq) return;
    data = next;
    if (dialog.open) render({ keep: true });
  }

  store.onChange(() => {
    loadSeq += 1;
    data = { ...data, state: 'idle', at: 0 };
    if (dialog.open) {
      ensureData();
      render({ keep: true });
    }
  });

  // -------------------------------------------------------------------------
  // Rendering

  function optionEl(item, position) {
    const lead = item.avatar
      ? personAvatar(item.avatarId, item.avatar, { size: 24 })
      : h('span', { class: 'palette-glyph' }, icon(item.icon ?? 'magnifying-glass'));
    return h('div', {
      class: 'palette-option',
      role: 'option',
      id: `${optionBase}-${position}`,
      'aria-selected': 'false',
      'aria-label': item.meta ? `${item.title}, ${item.meta}` : item.title,
      dataset: { index: String(position) },
    },
    lead,
    h('span', { class: 'palette-text' },
      h('span', { class: 'palette-title' }, item.title),
      item.meta ? h('span', { class: 'palette-meta' }, item.meta) : null));
  }

  function loadingText() {
    return staff ? 'Loading students, work and sessions…' : 'Loading work and sessions…';
  }

  function render({ keep = false } = {}) {
    const query = input.value;
    const typing = prepareQuery(query).tokens.length > 0;
    const items = allItems();
    const entries = typing ? rank(items, query) : browse(items, { recent: resolveRecent(recent, items), maxRecent: RECENT_SHOWN });
    const { groups, count, hidden } = group(entries, typing ? SEARCH_LIMITS : BROWSE_LIMITS);

    const previous = keep ? visible[active]?.key : null;
    visible = groups.flatMap((g) => g.entries.map((e) => e.item));
    active = previous ? Math.max(0, visible.findIndex((i) => i.key === previous)) : 0;

    list.replaceChildren(...groups.map((g, gi) => h('div', {
      class: 'palette-group', role: 'group', 'aria-labelledby': `${groupBase}-${gi}`,
    },
    h('div', { class: 'palette-group-label', id: `${groupBase}-${gi}` }, g.label),
    g.entries.map((e) => optionEl(e.item, e.position)))));

    const loading = data.state === 'loading' && data.items.length === 0;
    const none = typing && visible.length === 0;
    empty.hidden = !none || loading;
    if (!empty.hidden) {
      empty.replaceChildren(
        h('span', { class: 'palette-empty-title' }, `No results for “${query.trim()}”`),
        h('span', { class: 'palette-empty-hint' }, staff ? 'Try a student, an assignment or a page.' : 'Try an assignment, a session or a page.'));
    }
    note.hidden = !(loading || data.state === 'error');
    if (!note.hidden) note.textContent = loading ? loadingText() : 'Some results could not load. Pages and actions still work.';
    list.hidden = visible.length === 0;
    input.setAttribute('aria-expanded', visible.length ? 'true' : 'false');

    setActive(active, { scroll: keep });
    if (!keep) body.scrollTop = 0;
    announce({ typing, count, hidden, none, loading });
  }

  function announce({ typing, count, hidden, none, loading }) {
    if (none) status.textContent = loading ? loadingText() : 'No results';
    else if (!typing) status.textContent = `${count} ${count === 1 ? 'suggestion' : 'suggestions'}`;
    else status.textContent = `${count} ${count === 1 ? 'result' : 'results'}${hidden ? `, showing the best ${count}` : ''}`;
  }

  function setActive(index, { scroll = true } = {}) {
    const options = list.querySelectorAll('[role="option"]');
    options[active]?.setAttribute('aria-selected', 'false');
    active = options.length ? Math.min(Math.max(index, 0), options.length - 1) : 0;
    const el = options[active];
    if (!el) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    el.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', el.id);
    if (!scroll) return;
    // The first row shows its group label too
    if (active === 0) body.scrollTop = 0;
    else el.scrollIntoView?.({ block: 'nearest' });
  }

  // -------------------------------------------------------------------------
  // Choosing

  function run(target) {
    if (!target) return;
    if (target.href) go(target.href);
    else if (target.drawer) openDrawer(target.drawer.id, target.drawer.extra);
    else if (target.switchTo !== undefined) switchScope(target.switchTo);
  }

  // Closes first (focus goes back where it was, and a drawer opening next
  // remembers that), then goes
  function choose(item) {
    if (!item) return;
    recent = remember(recent, item.key, RECENT_MAX);
    writeRecent();
    close();
    run(item.target);
  }

  // -------------------------------------------------------------------------
  // Open and close

  // Phones: the sheet follows the visible area, so the on-screen keyboard never covers the list
  function fit() {
    if (vv) dialog.style.setProperty('--palette-vh', `${Math.round(vv.height)}px`);
  }

  function open() {
    if (dialog.open) return;
    const ctx = context();
    statics = staticItems({ me, page, scope: ctx.scope, route: ctx.route, options: ctx.options });
    recent = readRecent();
    const focused = document.activeElement;
    opener = focused && focused !== document.body ? focused : null;
    input.value = '';
    active = 0;
    ensureData();
    render();
    trigger.setAttribute('aria-expanded', 'true');
    dialog.showModal();
    fit();
    vv?.addEventListener('resize', fit);
    input.focus();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    vv?.removeEventListener('resize', fit);
    // The browser already put focus back on the opener; this covers an opener
    // that was replaced meanwhile (a view that redrew)
    const el = opener;
    opener = null;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (!lost) return;
    if (el?.isConnected) el.focus({ preventScroll: true });
    else document.getElementById('main')?.focus({ preventScroll: true });
  });

  // A click on the backdrop: press and release both on the dialog itself
  // (.palette-inner fills it, so content clicks never hit it)
  let downOnDialog = false;
  dialog.addEventListener('pointerdown', (e) => { downOnDialog = e.target === dialog; });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && downOnDialog) close();
  });

  // -------------------------------------------------------------------------
  // Input

  input.addEventListener('input', () => {
    active = 0;
    render();
  });

  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'Enter') {
      e.preventDefault();
      choose(visible[active]);
      return;
    }
    if (!plain || !visible.length || !listKey(e.key, input.value)) return;
    const next = menuIndex(active, e.key, visible.length);
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  });

  // Hover chooses the row, but only when the pointer really moved: a list that
  // scrolls or redraws under a still mouse must not steal the highlight
  list.addEventListener('pointermove', (e) => {
    if (lastPointer && lastPointer.x === e.clientX && lastPointer.y === e.clientY) return;
    lastPointer = { x: e.clientX, y: e.clientY };
    const row = e.target.closest?.('[role="option"]');
    if (row && Number(row.dataset.index) !== active) setActive(Number(row.dataset.index), { scroll: false });
  });
  // Keep focus in the search box when a row is pressed
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const row = e.target.closest?.('[role="option"]');
    if (row) choose(visible[Number(row.dataset.index)]);
  });

  // -------------------------------------------------------------------------
  // The shortcut

  // The confirm dialog, the menu sheet and popovers come first; the drawer does not
  const otherDialogOpen = () => [...document.querySelectorAll('dialog[open]')].some((d) => d !== dialog && d.id !== 'drawer');

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.repeat || shortcutAction(e, { apple }) !== 'open') return;
    if (dialog.open) {
      // The same chord again closes it; "/" only ever reaches here from a button
      if (e.key !== '/') {
        e.preventDefault();
        close();
      }
      return;
    }
    if (otherDialogOpen()) return;
    e.preventDefault();
    open();
  });

  return { open, close, isOpen: () => dialog.open, trigger };
}
