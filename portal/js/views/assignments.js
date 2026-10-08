// Assignment lists (spec 5.5): #/assignments/todo | in-review | graded | archived.
// Every list, count and tab reads the same derived items (store.itemsFor), so
// the numbers here always match the sidebar badges.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import {
  itemRow, rowList, groupHeader, emptyState, errorCallout, skeletonRows, button,
  newPill, visuallyHidden,
} from '../ui.js';
import {
  groupTodo, groupInReviewStaff, inReviewFamily, groupGraded, groupArchived, navCounts, MAX_SUBMISSIONS,
} from '../buckets.js';
import { displayName, firstName } from '../format.js';
import { getSeen, markSeen, isNewSince } from '../seen.js';
import { resultLabel } from '../results.js';

const LABELS = { todo: 'To do', 'in-review': 'In review', graded: 'Graded', archived: 'Archived' };
const DOC_TITLES = {
  todo: 'To do assignments',
  'in-review': 'Assignments in review',
  graded: 'Graded assignments',
  archived: 'Archived assignments',
};
const ARCHIVE_NOTE = 'Graded work moves here 3 weeks after it’s graded. Work that wasn’t turned in moves here 30 days after it was due.';
const ENTER_LIMIT = 8;

// What "seen" said when Graded was opened, per viewer and student, so a refresh
// re-render keeps the same "New" rows the view opened with
const gradedBaseline = new Map();

// The first non-empty line of a block of text
function firstLine(text) {
  return String(text ?? '').split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? '';
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function mount(ctx) {
  const sub = LABELS[ctx.route.sub] ? ctx.route.sub : 'todo';
  const staff = ctx.audience === 'staff';
  const parent = ctx.role === 'parent';
  const student = ctx.scope?.student ?? null;
  const name = firstName(displayName(student));

  const header = (counts) => ctx.setHeader({
    title: LABELS[sub],
    lede: sub === 'in-review' && !staff
      ? (parent
        ? `Work ${name} has submitted waits here until the tutor grades it.`
        : 'Work you’ve submitted waits here until your tutor grades it.')
      : null,
    actions: staff
      ? button({
        label: 'New assignment',
        variant: 'primary',
        icon: 'plus',
        focusKey: 'new-assignment',
        onClick: () => ctx.openNew({ kind: 'assignment' }),
      })
      : null,
    subnav: true,
    tabsLabel: 'Assignments',
    tabs: Object.entries(LABELS).map(([key, label]) => ({
      label,
      href: `#/assignments/${key}`,
      current: key === sub,
      count: counts ? (key === 'todo' ? counts.todo : key === 'in-review' ? counts.inReview : 0) : 0,
      context: counts && key === 'todo'
        ? `${counts.todo} to do${counts.todoOverdue ? `, ${counts.todoOverdue} missing` : ''}`
        : counts && key === 'in-review' ? `${counts.inReview} in review` : undefined,
    })),
  });

  header(null);
  const content = h('div', { class: 'asg-list' }, skeletonRows(5));
  ctx.host.append(content);

  if (!student) {
    content.replaceChildren(emptyState({ icon: 'users-three', text: 'Choose a student to see their assignments.' }));
    return null;
  }

  return (async () => {
    let data;
    try {
      data = await ctx.store.getStudentData(student.id);
    } catch (error) {
      if (!ctx.alive()) return;
      console.error(error);
      content.replaceChildren(errorCallout({
        title: 'We couldn’t load assignments.',
        text: 'Check your connection and try again.',
        onRetry: () => ctx.store.invalidate(student.id),
      }));
      return;
    }
    if (!ctx.alive()) return;

    const items = ctx.store.itemsFor(data, { now: ctx.now, audience: ctx.audience, viewerId: ctx.me.id });
    const counts = navCounts(items, { audience: ctx.audience });
    // setHeader updates in place, so the h1 keeps focus while the tab counts land
    header(counts);

    const opts = { staff, parent, name, now: ctx.now, ctx, studentId: student.id };
    let body;
    let total;
    if (sub === 'todo') [body, total] = todoList(items, opts);
    else if (sub === 'in-review') [body, total] = inReviewList(items, opts);
    else if (sub === 'graded') [body, total] = gradedList(items, opts);
    else [body, total] = archivedList(items, opts);

    content.replaceChildren(...[].concat(body));
    if (!ctx.isRefresh) animateRows(content);
    ctx.announce(`${DOC_TITLES[sub]}, ${plural(total, 'item', 'items')}`);
  })();
}

// ---------------------------------------------------------------------------
// Lists

// A group as a sticky header and its rows; collapsed groups become <details>
function groupBlock(group, renderRow) {
  const list = rowList(group.items.map(renderRow), { label: group.label });
  if (group.collapsed) {
    const details = groupHeader({ label: group.label, count: group.items.length, collapsible: true });
    details.classList.add('asg-group');
    details.append(list);
    return [details];
  }
  const head = groupHeader({
    label: group.label,
    count: group.items.length,
    tone: group.key === 'overdue' ? 'danger' : undefined,
  });
  return [head, list];
}

function rowFor(item, { now, staff }, extra = {}) {
  return itemRow(item, { audience: staff ? 'staff' : 'family', now, ...extra });
}

function todoList(items, opts) {
  const groups = groupTodo(items, opts.now);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (!total) {
    let text = 'Nothing to do right now. New assignments from your tutor will show up here.';
    let action;
    if (opts.staff) {
      text = `Nothing to do right now. Add an assignment for ${opts.name} with New assignment.`;
      action = { label: 'New assignment', icon: 'plus', onClick: () => opts.ctx.openNew({ kind: 'assignment' }) };
    } else if (opts.parent) {
      text = `Nothing to do right now. New assignments for ${opts.name} will show up here.`;
    }
    return [emptyState({ icon: 'check-circle', text, action }), 0];
  }
  const render = (item) => rowFor(item, opts, { meta: firstLine(item.task.details) || 'No instructions' });
  return [groups.flatMap((g) => groupBlock(g, render)), total];
}

// "Attempt 2 of 5, previous result Missing"
function attemptMeta(item) {
  const parts = [`Attempt ${Math.max(1, item.attempts)} of ${MAX_SUBMISSIONS}`];
  if (resultLabel(item.previousResult)) parts.push(`previous result ${resultLabel(item.previousResult)}`);
  return parts.join(', ');
}

function inReviewList(items, opts) {
  const render = (item) => rowFor(item, opts, { meta: attemptMeta(item) });
  if (opts.staff) {
    const groups = groupInReviewStaff(items);
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    if (!total) return [emptyState({ icon: 'tray', text: `Nothing in review for ${opts.name}.` }), 0];
    return [groups.flatMap((g) => groupBlock(g, render)), total];
  }
  const list = inReviewFamily(items);
  if (!list.length) {
    const text = opts.parent
      ? `Nothing waiting for review. Work ${opts.name} submits stays here until the tutor grades it.`
      : 'Nothing waiting for review. Work you submit stays here until your tutor grades it.';
    return [emptyState({ icon: 'hourglass-medium', text }), 0];
  }
  return [[rowList(list.map(render), { label: 'In review' })], list.length];
}

function gradedList(items, opts) {
  const { ctx, staff, studentId } = opts;
  const groups = groupGraded(items, opts.now);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  // "New" rows for students and parents: read what was seen before this visit,
  // then record the visit (spec 4.9)
  let seen;
  if (!staff) {
    const key = `${ctx.me.id}|${studentId}`;
    if (!ctx.isRefresh || !gradedBaseline.has(key)) {
      gradedBaseline.set(key, getSeen('graded', ctx.me.id, studentId));
      if (markSeen('graded', ctx.me.id, studentId, ctx.now)) ctx.refreshNav?.();
    }
    seen = gradedBaseline.get(key);
  }

  if (!total) {
    let text = 'No graded work yet. Grades appear here after your tutor reviews your submission.';
    if (staff) text = `No graded work yet. Grades you release for ${opts.name} appear here.`;
    else if (opts.parent) text = `No graded work yet. Grades appear here after the tutor reviews ${opts.name}’s work.`;
    return [emptyState({ icon: 'check-circle', text }), 0];
  }

  const render = (item) => {
    const feedback = firstLine(item.grade?.feedback);
    const isNew = !staff && isNewSince(item.grade?.released_at, seen, opts.now);
    const meta = isNew
      ? h('span', { class: 'asg-meta' }, newPill(), visuallyHidden(', '), feedback)
      : feedback;
    // Every row shows its result (Completed or Missing) from itemRow
    return rowFor(item, opts, { meta });
  };
  return [groups.flatMap((g) => groupBlock(g, render)), total];
}

function archivedList(items, opts) {
  const noteIcon = icon('info');
  const note = h('p', { class: 'note asg-note' }, noteIcon, h('span', {}, ARCHIVE_NOTE));
  const groups = groupArchived(items);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (!total) return [[note, emptyState({ icon: 'archive', text: 'Nothing archived yet.' })], 0];

  const render = (item) => {
    const meta = item.archiveReason === 'graded' ? firstLine(item.grade?.feedback) : '';
    const li = rowFor(item, opts, { meta });
    li.firstElementChild?.classList.add('is-muted');
    return li;
  };
  return [[note, ...groups.flatMap((g) => groupBlock(g, render))], total];
}

// The first rows fade up on a view change (never on a refresh re-render)
function animateRows(container) {
  const rows = [...container.querySelectorAll('.row-list > li, .empty-state')].slice(0, ENTER_LIMIT);
  rows.forEach((el, i) => {
    el.classList.add('enter');
    el.style.setProperty('--i', String(i));
  });
}
