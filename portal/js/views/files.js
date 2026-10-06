// Files view (#/files). Every worksheet, PDF and link a tutor attached to the
// student's assignments and tasks, in one place: grouped by month of the
// assignment's due date (its created date when it has none), newest first.
// Search (file name, link title, assignment title) and the type chips All,
// PDFs, Images, Links and Other combine, in memory, and the chips carry counts.
//
// Each row names the file, its type and size, and the assignment it belongs
// to (a link that opens the assignment drawer, like every other list); the
// primary action opens the file from a signed link (materials-ui.js signs it
// the way the drawer does) or follows the link. Student submissions are not
// here: only what a tutor provided. Grouping, search and counts live in
// files-model.js.
//
// The search text and the chip survive a refresh (a change elsewhere, coming
// back to the tab) but start fresh whenever the view is opened again.

import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import {
  button, segmented, setSegmented, groupHeader, emptyState, errorCallout, skeletonRows, visuallyHidden, drawerHref,
} from '../ui.js';
import { firstName, displayName } from '../format.js';
import { materialIcon } from '../materials-model.js';
import { wireFileOpen } from '../materials-ui.js';
import {
  KINDS, fileEntries, collapseRepeats, libraryView, countText, fileWhen, fromLabel, repeatsText,
} from '../files-model.js';

const STAFF = new Set(['tutor', 'admin']);
const ENTER_ROWS = 8;
const NOUNS = { all: 'files', pdf: 'PDFs', image: 'images', link: 'links', other: 'other files' };

// What was typed and chosen, per page and student, for the life of one visit
const kept = new Map();
function remembered(key, fresh) {
  if (fresh || !kept.has(key)) kept.set(key, { query: '', kind: 'all' });
  return kept.get(key);
}

export async function mount(ctx) {
  const { host, scope } = ctx;
  const staff = STAFF.has(ctx.role);
  const student = scope?.student ?? null;
  const studentId = student?.id ?? null;
  const name = student ? firstName(displayName(student)) : '';
  const state = remembered(`${ctx.page}:${studentId ?? ''}`, !ctx.isRefresh);

  ctx.setHeader({ title: 'Files' });

  const body = h('div', { class: 'fil-view' }, skeletonRows(4));
  host.append(body);

  if (!studentId) {
    body.replaceChildren(emptyState({ icon: 'paperclip', text: 'Choose a student to see their files.' }));
    ctx.announce('Files');
    return;
  }

  let entries;
  try {
    entries = collapseRepeats(fileEntries(await ctx.store.getFiles(studentId)), ctx.now);
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    body.replaceChildren(errorCallout({
      title: 'We couldn’t load files.',
      text: 'Check your connection and try again.',
      onRetry: () => ctx.store.invalidate(studentId),
    }));
    ctx.announce('Files, could not load');
    return;
  }
  if (!ctx.alive()) return;

  if (!entries.length) {
    body.replaceChildren(emptyState({
      icon: 'paperclip',
      text: staff
        ? `No files yet for ${name || 'this student'}. Files you attach to their assignments and tasks show up here.`
        : 'No files yet. Files your tutor attaches to assignments show up here.',
    }));
    ctx.announce('Files, none');
    return;
  }

  // ---- Controls ------------------------------------------------------------

  const inputId = uid('fil-search');
  const input = h('input', {
    class: 'input',
    id: inputId,
    type: 'text',
    role: 'searchbox',
    inputmode: 'search',
    enterkeyhint: 'search',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'Search files',
    dataset: { focusKey: 'fil-search' },
  });
  input.value = state.query;

  // The hidden comma keeps the name "PDFs, 5" rather than "PDFs5"
  const countSpans = {};
  const chips = segmented({
    label: 'Filter by type',
    className: 'fil-filter',
    value: state.kind,
    options: KINDS.map((k) => {
      countSpans[k.key] = h('span', { class: 'num' });
      return { value: k.key, label: [k.label, h('span', { class: 'fil-seg-count' }, visuallyHidden(', '), countSpans[k.key])] };
    }),
    onChange: (value) => {
      state.kind = value;
      fill(false);
    },
  });
  for (const btn of chips.querySelectorAll('button[data-value]')) btn.dataset.focusKey = `fil-kind-${btn.dataset.value}`;

  const status = h('p', { class: 'fil-count num', role: 'status' });
  const results = h('div', { class: 'fil-results' });

  function clearAll() {
    state.query = '';
    state.kind = 'all';
    input.value = '';
    setSegmented(chips, 'all');
    fill(false);
    input.focus();
  }

  input.addEventListener('input', () => {
    state.query = input.value;
    fill(false);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      input.value = '';
      state.query = '';
      fill(false);
    }
  });

  // ---- Rows ----------------------------------------------------------------

  function row(e) {
    const { task } = e;
    const label = `${fromLabel(e)} ${task.title}`;
    const from = h('span', { class: 'fil-from' },
      h('a', {
        class: 'fil-from-link',
        href: drawerHref(location.hash, task.id),
        'aria-label': `Open ${label}`,
        dataset: { focusKey: `fil-from-${e.id}` },
      }, icon(task.kind === 'task' ? 'check-square' : 'clipboard-text'), h('span', { class: 'fil-from-title' }, task.title)),
      h('span', { class: 'fil-when' }, fileWhen(e, ctx.now)),
      repeatsText(e) ? h('span', { class: 'fil-repeats num' }, repeatsText(e)) : null);

    let open;
    if (e.isLink) {
      open = button({
        label: 'Open', variant: 'secondary', size: 'sm', iconEnd: 'arrow-square-out', href: e.url,
        ariaLabel: `Open link ${e.title}`, focusKey: `fil-open-${e.id}`, className: 'fil-open',
      });
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
    } else {
      open = button({
        label: 'Open', variant: 'secondary', size: 'sm', iconEnd: 'arrow-square-out',
        ariaLabel: `Open ${e.title}`, focusKey: `fil-open-${e.id}`, className: 'fil-open',
      });
      wireFileOpen(open, e.material, {
        lazy: true,
        onError: () => ctx.toast({ text: 'This file could not be opened. Try again.' }),
      });
    }

    return h('li', { class: 'fil-item' },
      h('span', { class: 'fil-icon', 'aria-hidden': 'true' }, icon(materialIcon(e.material), { size: 20 })),
      h('div', { class: 'fil-main' },
        h('span', { class: 'fil-title' }, e.title),
        h('span', { class: 'fil-meta' }, e.meta),
        from),
      h('div', { class: 'fil-action' }, open));
  }

  function group(g) {
    return h('div', { class: 'fil-group' },
      groupHeader({ label: g.label, count: g.entries.length }),
      h('ul', { class: 'fil-list', 'aria-label': `Files from ${g.label}` }, g.entries.map(row)));
  }

  // ---- Fill ------------------------------------------------------------------

  function fill(animate) {
    const view = libraryView(entries, state);
    status.textContent = countText(view.shown, view.total);
    for (const k of KINDS) {
      countSpans[k.key].textContent = String(view.counts[k.key]);
      // A chip with nothing behind it cannot be pressed, unless it is the one chosen
      const btn = chips.querySelector(`button[data-value="${k.key}"]`);
      btn.disabled = view.counts[k.key] === 0 && state.kind !== k.key;
    }
    if (!view.shown) {
      results.replaceChildren(emptyState({
        icon: 'magnifying-glass',
        text: state.query.trim() ? `No ${NOUNS[state.kind]} match that search.` : `No ${NOUNS[state.kind]} to show.`,
        action: button({ label: 'Show all files', variant: 'secondary', size: 'sm', focusKey: 'fil-clear', onClick: clearAll }),
      }));
      return;
    }
    results.replaceChildren(...view.groups.map(group));
    if (animate) {
      results.querySelectorAll('.fil-item').forEach((li, i) => {
        if (i >= ENTER_ROWS) return;
        li.classList.add('enter');
        li.style.setProperty('--i', String(i));
      });
    }
  }

  body.replaceChildren(
    h('div', { class: 'fil-toolbar' },
      h('div', { class: 'fil-search' },
        h('label', { class: 'visually-hidden', for: inputId }, 'Search files'),
        h('span', { class: 'input-icon' }, icon('magnifying-glass'), input)),
      h('div', { class: 'fil-filter-wrap' }, chips)),
    status,
    results);
  fill(!ctx.isRefresh);

  ctx.announce(`Files, ${countText(entries.length, entries.length)}`);
}
