// Staff Today, #/today (spec 5.4). Today's tutoring sessions first, then what
// needs review, what is due this week across every student, and what was
// released recently. Reads the workspace (getWorkspace), so its counts match
// the Review queue badge. A tutor sees their own sessions, an admin everyone's.

import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import { displayName } from '../format.js';
import { deriveItems } from '../buckets.js';
import { itemStatus } from '../status.js';
import { dueLabel, todayKey } from '../dates.js';
import { avatar, button, drawerHref, emptyState, errorCallout, pill, rowList, visuallyHidden } from '../ui.js';
import { staffNames } from '../updates-feed.js';
import { sessionTitle, timeRange, toneClass } from '../sessions-model.js';
import {
  todayPlan, todayPill, todayRowLabel, nextLine, needsNotesDetail, placeText, canJoin,
} from '../schedule-summary.js';
import { queueRow, releasedRow } from '../review-row.js';
import {
  queueOrder, attemptInfo, subsByTask, recentlyReleased, todayLede, pendingLabel, dueThisWeek,
} from '../review-model.js';

const NEEDS_REVIEW_ROWS = 5;
const DUE_ROWS = 6;
const PEOPLE_PENDING = '/portal/people.html#/pending';
const SESSIONS_CALENDAR = '#/calendar?scope=all';
const NOTES_CALENDAR = '#/calendar?scope=all&view=list';

function card({ title, meta, link, className }, ...content) {
  return h('section', { class: ['card', 'is-list', 'rvw-card', className].filter(Boolean).join(' ') },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, title),
      meta ? h('span', { class: 'card-meta num' }, meta) : null,
      link ? h('a', { class: 'link card-link', href: link.href }, link.label) : null),
    content);
}

// A quiet line inside a card when it has nothing to list (no nested boxes)
function quiet(iconName, text) {
  return h('p', { class: 'rvw-quiet' }, icon(iconName), h('span', {}, text));
}

function skeletonCard(rows, className) {
  return h('section', { class: ['card', 'is-list', 'rvw-card', className].filter(Boolean).join(' '), 'aria-hidden': 'true' },
    h('div', { class: 'card-head' }, h('span', { class: 'skeleton rvw-sk-title' })),
    Array.from({ length: rows }, () => h('div', { class: 'skeleton-row' },
      h('span', { class: 'skeleton rvw-sk-avatar' }),
      h('span', { class: 'sk-lines' }, h('span', { class: 'skeleton sk-line' }), h('span', { class: 'skeleton sk-line is-short' })),
      h('span', { class: 'skeleton sk-pill' }))));
}

function skeleton() {
  return h('div', { class: 'grid-12', 'aria-busy': 'true' },
    h('div', { class: 'span-12' }, skeletonCard(2)),
    h('div', { class: 'span-8' }, skeletonCard(4)),
    h('div', { class: 'span-4' }, skeletonCard(4, 'rvw-compact-card')),
    h('div', { class: 'span-12' }, skeletonCard(3)),
    h('span', { class: 'visually-hidden' }, 'Loading…'));
}

// Compact row for the narrow "Due this week" card: avatar, title, and the
// student's name with the due label under it; opens the item drawer
function dueRow(item, { studentName, now }) {
  const due = dueLabel(item.task.due_at, now);
  const status = itemStatus(item, { audience: 'staff' });
  const title = item.task.title || 'Untitled';
  const kind = item.task.kind === 'task' ? 'Task' : 'Assignment';
  const toneClass = due.tone === 'danger' ? 'is-danger' : due.tone === 'warning' ? 'is-warning' : null;
  const caret = icon('caret-right');
  caret.classList.add('row-caret');
  return h('li', {}, h('a', {
    class: 'row rvw-due-row',
    href: drawerHref(typeof location === 'undefined' ? '' : location.hash, item.task.id),
    'aria-label': [title, kind, studentName, due.text, status.label].filter(Boolean).join(', '),
    dataset: { focusKey: `row-${item.task.id}`, taskId: String(item.task.id) },
  },
  h('span', { class: 'row-lead' }, avatar(studentName, { size: 24 })),
  h('span', { class: 'row-main' },
    h('span', { class: 'row-title' }, title),
    h('span', { class: 'row-meta rvw-row-meta' },
      h('span', { class: 'rvw-row-task' }, studentName),
      h('span', { class: ['rvw-due-text', 'num', toneClass].filter(Boolean).join(' '), title: due.full }, due.text))),
  caret));
}

// A plain click opens the drawer through ctx.openSession; a modified click
// (new tab) falls back to the link's own href
function opensSession(ctx, id) {
  return (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    ctx.openSession(id);
  };
}

// One of today's sessions: time, student, subject (in its colour), the place and
// a pill. Opens the session drawer. The live one says "Now"; the next to start
// is shaded. An online session near its start gets a Join link under the row
// (a sibling, so the row stays one link).
function sessionRow(ctx, s, { plan, studentNames, staff, admin }) {
  const now = ctx.now;
  const upNext = plan.upNextId === s.id;
  const live = plan.liveIds.has(s.id);
  const state = todayPill(s, now, { upNext });
  const student = studentNames.get(s.student_id) ?? 'Student';
  const tutor = admin ? (staff.get(String(s.tutor_id)) ?? null) : null;
  const place = placeText(s);
  const subject = sessionTitle(s);
  const label = todayRowLabel(s, { student, tutor, now, pill: state });

  const caret = icon('caret-right');
  caret.classList.add('tdy-caret');
  const link = h('a', {
    class: ['row', 'tdy-row', toneClass(s.subject)].join(' '),
    href: drawerHref(typeof location === 'undefined' ? '' : location.hash, `s${s.id}`),
    'aria-label': label,
    dataset: { focusKey: `row-s${s.id}`, sessionId: String(s.id) },
    onClick: opensSession(ctx, s.id),
  },
  h('span', { class: 'tdy-time num' }, timeRange(s)),
  h('span', { class: 'tdy-main' },
    h('span', { class: 'tdy-student' }, student),
    h('span', { class: 'tdy-meta' },
      h('span', { class: 'tdy-subject' }, subject),
      tutor ? h('span', { class: 'tdy-with' }, `with ${tutor}`) : null,
      place ? h('span', { class: 'tdy-place' }, place) : null)),
  h('span', { class: 'tdy-state' }, pill({ label: state.label, tone: state.tone })),
  caret);

  const join = canJoin(s, now)
    ? h('div', { class: 'tdy-actions' },
      button({
        label: 'Join',
        size: 'sm',
        icon: 'arrow-square-out',
        href: s.meeting_url,
        ariaLabel: `Join ${subject} with ${student} online, opens in a new tab`,
      }))
    : null;
  join?.firstElementChild.setAttribute('target', '_blank');
  join?.firstElementChild.setAttribute('rel', 'noopener noreferrer');

  return h('li', { class: ['tdy-item', live ? 'is-live' : null, upNext ? 'is-next' : null].filter(Boolean).join(' ') }, link, join);
}

// Today's sessions, then the line for the next one when nothing is left today,
// then the "Needs notes" count
function sessionsCard(ctx, ws, { studentNames, staff, admin }) {
  const now = ctx.now;
  const plan = todayPlan(ws.sessions ?? [], now, { tutorId: admin ? null : ctx.me.id, links: admin ? null : ws.links });
  const today = todayKey(now);
  const titleId = uid('tdy-title');

  const rows = plan.today.map((s, i) => {
    const li = sessionRow(ctx, s, { plan, studentNames, staff, admin });
    if (!ctx.isRefresh && i < 8) {
      li.classList.add('enter');
      li.style.setProperty('--i', String(i));
    }
    return li;
  });

  const foot = [];
  if (plan.later) {
    const s = plan.later;
    foot.push(h('p', { class: 'tdy-next' },
      h('a', {
        class: 'link',
        href: drawerHref(typeof location === 'undefined' ? '' : location.hash, `s${s.id}`),
        dataset: { focusKey: `row-s${s.id}` },
        onClick: opensSession(ctx, s.id),
      }, nextLine(s, {
        student: studentNames.get(s.student_id) ?? 'Student',
        tutor: staff.get(String(s.tutor_id)) ?? null,
        today,
        admin,
      }))));
  }
  if (plan.needsNotes > 0) {
    const caret = icon('caret-right');
    caret.classList.add('tdy-notes-caret');
    foot.push(h('a', { class: 'tdy-notes', href: NOTES_CALENDAR },
      icon('note-pencil'),
      h('span', { class: 'tdy-notes-text' },
        h('strong', {}, 'Needs notes'),
        visuallyHidden(': '),
        h('span', { class: 'tdy-notes-count' }, needsNotesDetail(plan.needsNotes))),
      caret));
  }

  const count = plan.today.length;
  const card = h('section', { class: 'card is-list tdy-card', 'aria-labelledby': titleId },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title', id: titleId }, 'Today’s sessions'),
      count ? h('span', { class: 'card-meta num' }, String(count)) : null,
      h('a', { class: 'link card-link', href: SESSIONS_CALENDAR }, 'Open calendar')),
    ws.sessionsError
      ? errorCallout({ title: 'We couldn’t load sessions.', text: 'Try again in a moment.', onRetry: () => ctx.store.invalidate(null) })
      : rows.length
        ? h('ul', { class: 'tdy-list', 'aria-label': 'Today’s sessions' }, rows)
        : quiet('calendar-blank', 'No sessions today.'),
    foot.length ? h('div', { class: 'card-foot tdy-foot' }, foot) : null);
  return { card, count };
}

function enter(li, index, ctx) {
  if (!ctx.isRefresh && index < 8) {
    li.classList.add('enter');
    li.style.setProperty('--i', String(index));
  }
  return li;
}

export async function mount(ctx) {
  const admin = ctx.role === 'admin';
  const header = ctx.setHeader({ title: 'Today', display: true });
  const body = h('div', { class: 'rvw-today' }, skeleton());
  ctx.host.append(body);

  let ws;
  let pending = 0;
  let staff = new Map();
  try {
    // staffNames never rejects; it names each session's tutor for an admin
    [ws, pending, staff] = await Promise.all([
      ctx.store.getWorkspace(),
      admin ? ctx.store.getPendingCount().catch(() => 0) : 0,
      admin ? staffNames() : new Map(),
    ]);
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    body.replaceChildren(errorCallout({
      title: 'We couldn’t load your workspace.',
      text: 'Check your connection and try again.',
      onRetry: () => ctx.store.invalidate(null),
    }));
    ctx.announce('Today, could not load');
    return;
  }
  if (!ctx.alive()) return;

  const now = ctx.now;
  const names = new Map(ws.students.map((s) => [s.id, displayName(s)]));
  const tasks = new Map(ws.tasks.map((t) => [t.id, t]));
  const byTask = subsByTask(ws.submissions);
  const queue = queueOrder(ws.submissions, 'all');
  const queueStudents = new Set(queue.map((s) => s.student_id)).size;

  const nodes = [];

  // Admin: people waiting for approval
  if (admin && pending > 0) {
    const i = icon('identification-badge', { size: 20 });
    i.classList.add('callout-icon');
    nodes.push(h('div', { class: 'callout tone-neutral rvw-signups' }, i,
      h('div', { class: 'callout-body' }, h('p', { class: 'callout-title' }, pendingLabel(pending))),
      button({ label: 'Review sign-ups', size: 'sm', href: PEOPLE_PENDING, iconEnd: 'caret-right' })));
  }

  if (!ws.students.length) {
    nodes.push(emptyState({
      icon: 'users-three',
      text: admin ? 'No students yet. Approve one on the People page.' : 'No students are assigned to you yet.',
      action: admin ? { label: 'Open People', href: PEOPLE_PENDING } : null,
    }));
    body.replaceChildren(...nodes);
    ctx.announce('Today, no students yet');
    return;
  }

  // Lede (added now that the counts are known; the h1 keeps its focus)
  const ledeText = todayLede(queue.length, queueStudents);
  header?.querySelector('.view-heading')?.append(h('p', { class: 'view-lede' }, ledeText));

  // Today's tutoring sessions, above everything else
  const sessions = sessionsCard(ctx, ws, { studentNames: names, staff, admin });
  nodes.push(sessions.card);

  let index = 0;

  // Needs review: the first rows of the queue, in queue order
  const reviewRows = queue.slice(0, NEEDS_REVIEW_ROWS).map((sub) => {
    const info = attemptInfo(sub, byTask.get(sub.task_id));
    return enter(queueRow(sub, {
      studentName: names.get(sub.student_id) ?? 'Student',
      taskTitle: tasks.get(sub.task_id)?.title ?? 'Assignment',
      attempt: info.n,
      total: info.total,
      newer: info.newer,
      now,
    }), index++, ctx);
  });
  const needsReview = card({
    title: 'Needs review',
    meta: queue.length > NEEDS_REVIEW_ROWS ? `First ${NEEDS_REVIEW_ROWS} of ${queue.length}` : null,
    className: 'rvw-review-card',
  },
    reviewRows.length
      ? rowList(reviewRows, { lead: 32, label: 'Needs review' })
      : quiet('check-circle', 'Nothing needs review right now.'),
    queue.length
      ? h('div', { class: 'card-foot rvw-card-foot' },
        button({ label: `Open review queue (${queue.length})`, variant: 'secondary', size: 'sm', href: '#/review', iconEnd: 'caret-right' }))
      : null);

  // Due this week, across every student
  const items = deriveItems(ws.tasks, ws.submissions, now, { audience: 'staff' });
  const due = dueThisWeek(items, now);
  const dueRows = due.slice(0, DUE_ROWS).map((item) => enter(dueRow(item, {
    studentName: names.get(item.task.student_id) ?? 'Student',
    now,
  }), index++, ctx));
  const dueCard = card({
    title: 'Due this week',
    meta: due.length ? `${due.length} open` : null,
    className: 'rvw-compact-card',
  },
  dueRows.length
    ? rowList(dueRows, { lead: 24, label: 'Due this week' })
    : quiet('calendar-blank', 'Nothing due in the next 7 days.'),
  h('div', { class: 'card-foot rvw-card-foot' },
    h('a', { class: 'link rvw-foot-link', href: '#/calendar?scope=all' },
      due.length > DUE_ROWS ? `See all ${due.length} in the calendar` : 'Open the calendar')));

  // Recently released
  const released = recentlyReleased(ws.submissions, now);
  const releasedRows = released.map((sub) => enter(releasedRow(sub, {
    studentName: names.get(sub.student_id) ?? 'Student',
    taskTitle: tasks.get(sub.task_id)?.title ?? 'Assignment',
    now,
  }), index++, ctx));
  const releasedCard = card({ title: 'Recently released', meta: 'Last 14 days' },
    releasedRows.length
      ? rowList(releasedRows, { lead: 32, label: 'Recently released' })
      : quiet('check-circle', 'No grades released in the last 14 days.'));

  nodes.push(h('div', { class: 'grid-12 rvw-grid' },
    h('div', { class: 'span-8' }, needsReview),
    h('div', { class: 'span-4' }, dueCard),
    h('div', { class: 'span-12' }, releasedCard)));

  body.replaceChildren(...nodes);
  const sessionsSaid = sessions.count
    ? `${sessions.count} ${sessions.count === 1 ? 'session' : 'sessions'}. `
    : '';
  ctx.announce(`Today, ${sessionsSaid}${ledeText}`);
}
