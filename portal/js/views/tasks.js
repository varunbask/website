// Tasks view (#/tasks, spec 5.11). Open tasks in the To do groups (Overdue,
// Today, Next 7 days, Later, No due date), then "Done" (the last 14 days, a
// collapsed <details> with its count) and "Show older (N)", which reveals the
// rest in place. Students and staff tick tasks with taskCheck; parents see a
// glyph. Titles open the drawer. Staff get "New task" in the header.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import {
  button, itemRow, rowList, groupHeader, emptyState, errorCallout, skeletonRows,
} from '../ui.js';
import { groupTasks, countsNow } from '../buckets.js';
import { firstName, displayName } from '../format.js';
import { taskCheck } from '../task-check.js';
import { detailsSummary } from '../homework-doc.js';

const STAFF = new Set(['tutor', 'admin']);
const ENTER_ROWS = 8;

// Disclosure state per page and student, kept for the session so a refresh
// (after a tick, or returning to the tab) never closes what the person opened
const memory = new Map();
function remembered(key) {
  if (!memory.has(key)) memory.set(key, { doneOpen: false, showOlder: false, undatedOpen: null });
  return memory.get(key);
}

// The first line of a task's instructions, for the row's meta line
export function firstLine(text) {
  const line = String(text ?? '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return line ?? '';
}

// "3 tasks to do, 1 overdue." or null when nothing is open. Copies of a
// repeating task due more than a week ahead are counted apart: "Plus 20
// later repeats."
export function tasksLede(openItems, now = new Date()) {
  const current = openItems.filter((i) => countsNow(i, now));
  const later = openItems.length - current.length;
  const laterText = later ? ` Plus ${later} later ${later === 1 ? 'repeat' : 'repeats'}.` : '';
  const n = current.length;
  if (!n) return later ? laterText.trim() : null;
  const overdue = current.filter((i) => i.dueState === 'overdue').length;
  const head = `${n} ${n === 1 ? 'task' : 'tasks'} to do`;
  return `${overdue ? `${head}, ${overdue} overdue.` : `${head}.`}${laterText}`;
}

export async function mount(ctx) {
  const { host, scope } = ctx;
  const staff = STAFF.has(ctx.role);
  const student = scope?.student ?? null;
  const studentId = student?.id ?? null;
  const name = student ? firstName(displayName(student)) : '';
  const state = remembered(`${ctx.page}:${studentId ?? ''}`);

  const newTask = staff
    ? button({ label: 'New task', variant: 'primary', icon: 'plus', onClick: () => ctx.openNew({ kind: 'task' }) })
    : null;

  const header = ctx.setHeader({ title: 'Tasks', actions: newTask });

  const body = h('div', { class: 'tsk-view' }, skeletonRows(4));
  host.append(body);

  if (!studentId) {
    body.replaceChildren(emptyState({ icon: 'check-square', text: 'Choose a student to see their tasks.' }));
    ctx.announce('Tasks');
    return;
  }

  let data;
  try {
    data = await ctx.store.getStudentData(studentId);
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    body.replaceChildren(errorCallout({
      title: 'We couldn’t load tasks.',
      text: 'Check your connection and try again.',
      onRetry: () => ctx.store.invalidate(studentId),
    }));
    ctx.announce('Tasks, could not load');
    return;
  }
  if (!ctx.alive()) return;

  const items = ctx.store.itemsFor(data, { now: ctx.now, audience: ctx.audience, viewerId: ctx.me?.id });
  const { open, doneRecent, doneOlder } = groupTasks(items, ctx.now);
  const openItems = open.flatMap((g) => g.items);
  const doneCount = doneRecent.length + doneOlder.length;

  // A toggle moves the task on the next refresh. Keep the group it lands in
  // open, so the box that has focus stays reachable there: Done on a tick,
  // "No due date" when an undated task is unticked
  host.addEventListener('taskcheck', (e) => {
    if (e.detail?.done) {
      state.doneOpen = true;
      return;
    }
    const id = String(e.detail?.taskId ?? '');
    const item = items.find((i) => String(i.task?.id ?? '') === id);
    if (item && !item.task.due_at) state.undatedOpen = true;
  }, { signal: ctx.signal });

  // The lede joins the header in place, so a focused h1 keeps its focus
  const lede = tasksLede(openItems);
  if (lede) header?.querySelector('.view-heading')?.append(h('p', { class: 'view-lede' }, lede));

  const rowFor = (item) => taskRow(item, ctx);
  const sections = [];

  if (!openItems.length && !doneCount) {
    body.replaceChildren(emptyState({
      icon: 'check-square',
      text: staff
        ? `No tasks for ${name || 'this student'} right now. Add reading or practice with New task.`
        : 'No tasks right now. Tasks from your tutor, like reading or practice, show up here.',
    }));
    ctx.announce('Tasks, none');
    return;
  }

  if (!openItems.length) {
    sections.push(h('div', { class: 'tsk-clear' },
      h('span', { class: 'tsk-clear-icon' }, icon('check-circle', { size: 20 })),
      h('p', { class: 'tsk-clear-text' }, staff
        ? `Every task for ${name || 'this student'} is done.`
        : 'Every task is done. New tasks from your tutor show up here.')));
  }

  for (const group of open) {
    const list = rowList(group.items.map(rowFor), { label: group.label });
    list.classList.add('tsk-list');
    if (group.collapsed) {
      // "No due date" starts collapsed, unless it is the only open group
      const startOpen = state.undatedOpen ?? open.length === 1;
      const details = groupHeader({ label: group.label, count: group.items.length, collapsible: true, open: startOpen });
      details.classList.add('tsk-group');
      // Remember only what the person chose: a <details> built open fires one
      // toggle of its own, which must not pin the group open for later
      details.addEventListener('toggle', () => {
        if (details.open !== startOpen || state.undatedOpen !== null) state.undatedOpen = details.open;
      });
      details.append(list);
      sections.push(details);
    } else {
      // A plain block, not a landmark: the h2 and the list's label name it
      sections.push(h('div', { class: 'tsk-group' },
        groupHeader({ label: group.label, count: group.items.length, tone: group.key === 'overdue' ? 'danger' : undefined }),
        list));
    }
  }

  if (doneCount) sections.push(doneGroup({ doneRecent, doneOlder, state, rowFor }));

  body.replaceChildren(...sections);

  if (!ctx.isRefresh) {
    // Only rows that are on screen: a closed <details> would play them later
    const shown = [...body.querySelectorAll('.tsk-list > li')].filter((li) => !li.closest('details:not([open])'));
    shown.slice(0, ENTER_ROWS).forEach((li, i) => {
      li.classList.add('enter');
      li.style.setProperty('--i', String(i));
    });
  }

  const parts = [`${openItems.length} open`];
  if (doneCount) parts.push(`${doneCount} done`);
  ctx.announce(`Tasks, ${parts.join(', ')}`);
}

// One task row: the shared item row, with the checkbox (or the parent glyph)
// in its leading cell
function taskRow(item, ctx) {
  const meta = detailsSummary(item.task.details);
  const li = itemRow(item, { audience: ctx.audience, meta: meta || null, now: ctx.now });
  li.classList.add('tsk-item');
  const link = li.querySelector(':scope > a.row');
  const lead = link?.querySelector('.row-lead');
  const control = taskCheck(item, ctx);
  if (control.matches('label')) {
    // An input cannot sit inside a link: the label is the row's sibling, laid
    // over the (emptied) leading cell
    lead?.replaceChildren();
    li.prepend(control);
    li.classList.add('has-check');
  } else if (lead) {
    lead.replaceChildren(control);
  }
  return li;
}

// "Done": the last 14 days in a collapsed <details>, then "Show older (N)"
function doneGroup({ doneRecent, doneOlder, state, rowFor }) {
  // The count is every done task, so older ones never read as "Done 0"
  const details = groupHeader({ label: 'Done', count: doneRecent.length + doneOlder.length, collapsible: true, open: state.doneOpen });
  details.classList.add('tsk-group', 'tsk-done');
  details.addEventListener('toggle', () => { state.doneOpen = details.open; });

  const list = rowList(doneRecent.map(rowFor), { label: 'Done' });
  list.classList.add('tsk-list');
  details.append(list);

  if (!doneRecent.length) {
    details.append(h('p', { class: 'tsk-quiet' }, 'Nothing done in the last 14 days.'));
  }

  const showOlder = () => {
    const rows = doneOlder.map(rowFor);
    list.append(...rows);
    details.querySelector('.tsk-quiet')?.remove();
  };

  if (doneOlder.length) {
    if (state.showOlder) {
      showOlder();
    } else {
      const more = button({
        label: `Show older (${doneOlder.length})`,
        variant: 'ghost',
        size: 'sm',
        icon: 'caret-down',
        focusKey: 'tasks-show-older',
        onClick: () => {
          state.showOlder = true;
          const before = list.children.length;
          showOlder();
          moreWrap.remove();
          list.children[before]?.querySelector('a.row')?.focus();
        },
      });
      const moreWrap = h('div', { class: 'tsk-more' }, more);
      details.append(moreWrap);
    }
  }
  return details;
}
