// Review queue, #/review?filter=all|draft|failed|edited (spec 5.8).
// Groups (Could not grade, Draft ready, Edited, not released), oldest first,
// then a collapsed "Still grading" list with "Try grading again".

import { h } from '../dom.js';
import { displayName } from '../format.js';
import { canRetry } from '../labels.js';
import { startGrading } from '../grading.js';
import {
  badge, button, busy, emptyState, errorCallout, groupHeader, rowList, segmented, skeletonRows,
} from '../ui.js';
import { queueRow } from '../review-row.js';
import {
  FILTERS, FILTER_LABELS, normalizeFilter, queueGroups, filterCounts, stillGrading, attemptInfo, subsByTask,
} from '../review-model.js';

const GROUP_ICON = { failed: 'x-circle', draft: 'pencil-simple-line', edited: 'note-pencil' };

const EMPTY = {
  all: 'No work waiting for review. Submissions appear here once the grader has a draft ready.',
  draft: 'No AI drafts are waiting for review.',
  failed: 'Nothing failed to grade.',
  edited: 'No edited drafts are waiting to be released.',
};

const submissions = (n) => `${n} submission${n === 1 ? '' : 's'}`;

// Whether "Still grading" is open, kept across refresh re-renders (a retry
// invalidates the store) and reset on a fresh visit
let gradingOpen = false;

export async function mount(ctx) {
  let filter = normalizeFilter(ctx.route.params.filter);
  if (!ctx.isRefresh) gradingOpen = false;
  const header = ctx.setHeader({
    title: 'Review queue',
    lede: 'Oldest first. Releasing a grade shows it to the student and their family.',
  });
  const body = h('div', { class: 'rvw-queue' }, skeletonRows(5));
  ctx.host.append(body);

  let ws;
  try {
    ws = await ctx.store.getWorkspace();
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    body.replaceChildren(errorCallout({
      title: 'We couldn’t load the review queue.',
      text: 'Check your connection and try again.',
      onRetry: () => ctx.store.invalidate(null),
    }));
    ctx.announce('Review queue, could not load');
    return;
  }
  if (!ctx.alive()) return;

  const names = new Map(ws.students.map((s) => [s.id, displayName(s)]));
  const tasks = new Map(ws.tasks.map((t) => [t.id, t]));
  const byTask = subsByTask(ws.submissions);
  const counts = filterCounts(ws.submissions);
  const grading = stillGrading(ws.submissions);

  // Count badge beside the title
  const count = badge({ n: counts.all, context: `${submissions(counts.all)} to review` });
  if (count && header) {
    count.classList.add('rvw-title-badge');
    header.querySelector('h1')?.append(count);
  }

  const rowFor = (sub, index) => {
    const info = attemptInfo(sub, byTask.get(sub.task_id));
    const li = queueRow(sub, {
      studentName: names.get(sub.student_id) ?? 'Student',
      taskTitle: tasks.get(sub.task_id)?.title ?? 'Assignment',
      attempt: info.n,
      total: info.total,
      newer: info.newer,
      now: ctx.now,
      filter,
    });
    if (!ctx.isRefresh && index < 8) {
      li.classList.add('enter');
      li.style.setProperty('--i', String(index));
    }
    return li;
  };

  function retryArea(sub) {
    if (!canRetry(sub, ctx.now)) return null;
    const message = h('p', { class: 'rvw-inline-error', role: 'alert', hidden: true });
    const btn = button({ label: 'Try grading again', size: 'sm', icon: 'arrow-counter-clockwise', focusKey: `retry-${sub.id}` });
    btn.addEventListener('click', () => {
      const hadFocus = document.activeElement === btn;
      return busy(btn, 'Starting…', async () => {
        message.hidden = true;
        const problem = await startGrading(sub.id);
        if (!ctx.alive()) return;
        if (problem) {
          message.textContent = problem;
          message.hidden = false;
          return;
        }
        ctx.toast({ text: 'Grading started.' });
        // The retry button goes away once grading restarts, so hand focus to the
        // row first; the refresh then restores it there
        // (busy() disables the button, so focus may already have fallen to <body>)
        const active = document.activeElement;
        if (hadFocus && (!active || active === document.body || active === btn)) {
          btn.closest('li')?.querySelector(`[data-focus-key="sub-${sub.id}"]`)?.focus({ preventScroll: true });
        }
        ctx.store.invalidate(sub.student_id);
      });
    });
    return h('div', { class: 'rvw-retry' },
      h('span', { class: 'rvw-retry-text' }, 'Grading hasn’t finished.'), btn, message);
  }

  function renderList() {
    const groups = queueGroups(ws.submissions, filter);
    const nodes = [];
    let index = 0;
    for (const group of groups) {
      nodes.push(h('div', { class: 'rvw-group' },
        groupHeader({
          label: group.label,
          count: group.items.length,
          icon: GROUP_ICON[group.key],
          tone: group.key === 'failed' ? 'danger' : undefined,
        }),
        rowList(group.items.map((sub) => rowFor(sub, index++)), { lead: 32, label: group.label })));
    }
    if (!groups.length) {
      nodes.push(emptyState({
        icon: filter === 'all' ? 'tray' : 'check-circle',
        text: EMPTY[filter],
        action: filter === 'all' || !counts.all ? null : {
          label: 'Show all',
          onClick: () => select('all'),
        },
      }));
    }
    if (grading.length && filter === 'all') {
      const details = groupHeader({
        label: 'Still grading', count: grading.length, icon: 'hourglass-medium', collapsible: true, open: gradingOpen,
      });
      details.classList.add('rvw-grading');
      details.addEventListener('toggle', () => { gradingOpen = details.open; });
      details.append(rowList(grading.map((sub) => {
        const li = rowFor(sub, 99);
        const retry = retryArea(sub);
        if (retry) li.append(retry);
        return li;
      }), { lead: 32, label: 'Still grading' }));
      nodes.push(details);
    }
    list.replaceChildren(...nodes);
  }

  const control = segmented({
    label: 'Show submissions',
    value: filter,
    options: FILTERS.map((f) => ({ value: f, label: FILTER_LABELS[f] })),
    onChange: (value) => select(value, { fromControl: true }),
  });
  for (const btn of control.querySelectorAll('button[data-value]')) {
    const n = counts[btn.dataset.value] ?? 0;
    btn.append(h('span', { class: 'rvw-seg-count num', 'aria-hidden': 'true' }, String(n)));
    btn.setAttribute('aria-label', `${FILTER_LABELS[btn.dataset.value]}, ${n}`);
  }

  function select(value, { fromControl = false } = {}) {
    filter = normalizeFilter(value);
    if (!fromControl) {
      for (const btn of control.querySelectorAll('button[data-value]')) {
        btn.setAttribute('aria-pressed', btn.dataset.value === filter ? 'true' : 'false');
      }
    }
    ctx.setParams({ filter: filter === 'all' ? null : filter }, { replace: true });
    renderList();
    if (!fromControl) control.querySelector(`button[data-value="${filter}"]`)?.focus();
  }

  const list = h('div', { class: 'rvw-queue-list' });
  const toolbar = h('div', { class: 'rvw-toolbar' }, h('div', { class: 'rvw-filter-scroll' }, control));
  renderList();
  body.replaceChildren(toolbar, list);
  ctx.announce(`Review queue, ${submissions(counts.all)}`);
}
