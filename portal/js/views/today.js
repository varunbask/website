// Staff Today, #/today (spec 5.4). Today's tutoring sessions first, then what
// needs review, what is due this week across every student, and what was
// released recently. Reads the workspace (getWorkspace), so its counts match
// the Review queue badge. A tutor sees their own sessions; an admin chooses
// Mine (the default) or Everyone.
//
// After a lesson: a finished session with no attendance gets Present, Late and
// Absent buttons that save in one tap, and a "Write notes" button that opens
// the notes form on its own (open=notes-s<id>). Earlier sessions from the last
// 30 days that still lack attendance or notes are listed under "Catch up".

import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import { sb } from '../supabase.js';
import { displayName } from '../format.js';
import { deriveItems } from '../buckets.js';
import { itemStatus } from '../status.js';
import { dayKey, dueLabel, todayKey } from '../dates.js';
import { avatar, button, drawerHref, emptyState, errorCallout, pill, rowList, segmented } from '../ui.js';
import { staffNames } from '../updates-feed.js';
import { ATTENDANCE, canEditSession, shortDayText, sessionTitle, timeRange, toneClass } from '../sessions-model.js';
import { GONE } from '../session-form-model.js';
import {
  todayPlan, todayPill, todayRowLabel, nextLine, placeText, canJoin, sessionGaps, gapsText, catchUpWindow,
  showAllLabel, sessionCount, attendanceSaved, attendanceErrorText, quickLabel, notesDrawerId, QUICK_ATTENDANCE,
  SCOPE_LABELS, normalizeScope, scopeTutorId, getTodayScope, setTodayScope,
} from '../schedule-summary.js';
import { queueRow, releasedRow } from '../review-row.js';
import {
  queueOrder, attemptInfo, subsByTask, recentlyReleased, todayLede, pendingLabel, dueThisWeek,
} from '../review-model.js';

const NEEDS_REVIEW_ROWS = 5;
const DUE_ROWS = 6;
const PEOPLE_PENDING = '/portal/people.html#/pending';
const SESSIONS_CALENDAR = '#/calendar?scope=all';
const SETTLE_MS = 4000;   // a saved row stays locked this long, until the refresh replaces it
const ATTENDANCE_ICONS = { present: 'check-circle', late: 'clock', absent: 'minus-circle' };

// One-tap saves in flight, by session id: a second tap on a row that is saving does nothing
const saving = new Set();
// "Show all" on the Catch up list. Kept through refresh renders (a save elsewhere),
// reset when the view is opened again.
let catchUpExpanded = false;

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

// The same for "Write notes": the notes form alone, in the drawer
function opensNotes(ctx, id) {
  return (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    ctx.open(notesDrawerId(id));
  };
}

// Locks or unlocks a row's three buttons. aria-disabled (not disabled) keeps
// keyboard focus where it is while the save runs.
function setBusy(group, on, chosen = null) {
  group.classList.toggle('is-busy', on);
  if (on) group.setAttribute('aria-busy', 'true');
  else group.removeAttribute('aria-busy');
  for (const b of group.querySelectorAll('button')) {
    if (on) b.setAttribute('aria-disabled', 'true');
    else b.removeAttribute('aria-disabled');
    b.classList.toggle('is-chosen', on && b.dataset.value === chosen);
  }
}

// Writes one session's attendance (null clears it): a single update by id that
// must return the row. Toasts the reason when it does not. Refreshes the
// workspace on success. Resolves whether it saved.
async function saveAttendance(ctx, session, value) {
  let result;
  try {
    result = await sb.from('sessions').update({ attendance: value }).eq('id', session.id).select('id');
  } catch (error) {
    result = { error };
  }
  if (result.error || !result.data?.length) {
    if (result.error) console.error(result.error);
    ctx.toast({ text: result.error ? attendanceErrorText(result.error) : GONE });
    return false;
  }
  ctx.store.invalidate(session.student_id);
  return true;
}

// One tap on Present, Late or Absent. The row stays locked after it saves: the
// refresh that follows replaces it, and focus moves on from there (to Write
// notes when notes are still missing, else the next row).
async function quickMark(ctx, session, value, { student, group }) {
  if (saving.has(session.id)) return;
  saving.add(session.id);
  setBusy(group, true, value);
  const ok = await saveAttendance(ctx, session, value);
  if (!ok) {
    saving.delete(session.id);
    if (group.isConnected) setBusy(group, false);
    return;
  }
  ctx.toast({
    text: attendanceSaved(student, value),
    action: {
      label: 'Undo',
      run: async () => {
        if (await saveAttendance(ctx, session, null)) ctx.toast({ text: attendanceSaved(student, null) });
      },
    },
  });
  setTimeout(() => saving.delete(session.id), SETTLE_MS);
}

// What a finished session still needs, as buttons under its row: Present, Late
// and Absent while attendance is empty, and Write notes while the recap is
// empty. Null when nothing is missing, or when the viewer may not change it.
function quickActions(ctx, s, { student, today, links }) {
  const gaps = sessionGaps(s, ctx.now);
  if ((!gaps.attendance && !gaps.notes) || !canEditSession(s, ctx.me, { links })) return null;
  const parts = [];
  if (gaps.attendance) {
    const group = h('div', { class: 'tdy-att', role: 'group', 'aria-label': 'Mark attendance' });
    for (const value of QUICK_ATTENDANCE) {
      const btn = button({
        label: ATTENDANCE[value],
        size: 'sm',
        icon: ATTENDANCE_ICONS[value],
        ariaLabel: quickLabel(value, s, { student, today }),
        focusKey: `qa-${value}-${s.id}`,
        onClick: () => quickMark(ctx, s, value, { student, group }),
      });
      btn.dataset.value = value;
      group.append(btn);
    }
    if (saving.has(s.id)) setBusy(group, true);
    parts.push(group);
  }
  if (gaps.notes) {
    parts.push(button({
      label: 'Write notes',
      size: 'sm',
      icon: 'note-pencil',
      href: drawerHref(typeof location === 'undefined' ? '' : location.hash, notesDrawerId(s.id)),
      ariaLabel: quickLabel('notes', s, { student, today }),
      focusKey: `row-${notesDrawerId(s.id)}`,
      onClick: opensNotes(ctx, s.id),
    }));
  }
  return h('div', { class: 'tdy-actions tdy-quick' }, parts);
}

// One session: time, student, subject (in its colour), the place and a pill.
// Opens the session drawer. In today's list the live one says "Now" and the
// next to start is shaded; an online session near its start gets a Join link
// under the row (a sibling, so the row stays one link). A finished one that
// lacks attendance or notes gets the one-tap buttons there instead. In the
// Catch up list (catchUp) the first column is the date and the pill says what
// is missing.
function sessionRow(ctx, s, { plan, studentNames, staff, showTutor, links, catchUp = false }) {
  const now = ctx.now;
  const today = todayKey(now);
  const upNext = !catchUp && plan.upNextId === s.id;
  const live = !catchUp && plan.liveIds.has(s.id);
  const gaps = sessionGaps(s, now);
  const state = catchUp ? { label: gapsText(gaps), tone: 'warning' } : todayPill(s, now, { upNext });
  const student = studentNames.get(s.student_id) ?? 'Student';
  const tutor = showTutor ? (staff.get(String(s.tutor_id)) ?? null) : null;
  const place = placeText(s);
  const subject = sessionTitle(s);
  const day = shortDayText(dayKey(s.starts_at), today);
  const spoken = todayRowLabel(s, { student, tutor, now, pill: state });

  const caret = icon('caret-right');
  caret.classList.add('tdy-caret');
  const link = h('a', {
    class: ['row', 'tdy-row', toneClass(s.subject)].join(' '),
    href: drawerHref(typeof location === 'undefined' ? '' : location.hash, `s${s.id}`),
    'aria-label': catchUp ? `${day}, ${spoken}` : spoken,
    dataset: { focusKey: `row-s${s.id}`, sessionId: String(s.id) },
    onClick: opensSession(ctx, s.id),
  },
  catchUp
    ? h('span', { class: 'tdy-time tdy-when num' }, h('span', { class: 'tdy-day' }, day), h('span', { class: 'tdy-clock' }, timeRange(s)))
    : h('span', { class: 'tdy-time num' }, timeRange(s)),
  h('span', { class: 'tdy-main' },
    h('span', { class: 'tdy-student' }, student),
    h('span', { class: 'tdy-meta' },
      h('span', { class: 'tdy-subject' }, subject),
      tutor ? h('span', { class: 'tdy-with' }, `with ${tutor}`) : null,
      place ? h('span', { class: 'tdy-place' }, place) : null)),
  h('span', { class: 'tdy-state' }, pill({ label: state.label, tone: state.tone })),
  caret);

  const join = !catchUp && canJoin(s, now)
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

  return h('li', { class: ['tdy-item', live ? 'is-live' : null, upNext ? 'is-next' : null].filter(Boolean).join(' ') },
    link, join, quickActions(ctx, s, { student, today, links }));
}

// Mine / Everyone for an admin, remembered per person. One element for the
// whole visit: the cards around it are rebuilt, it is moved into the new one.
function scopeControl(scope, onChange) {
  const group = segmented({
    label: 'Whose sessions',
    className: 'tdy-scope',
    options: Object.entries(SCOPE_LABELS).map(([value, label]) => ({ value, label })),
    value: scope,
    onChange,
  });
  // The same keys let a refresh render hand focus to the new control
  for (const b of group.querySelectorAll('button')) b.dataset.focusKey = `tdy-scope-${b.dataset.value}`;
  return group;
}

// Today's sessions, then the line for the next one when nothing is left today
function sessionsCard(ctx, plan, { studentNames, staff, showTutor, links, scopeEl, emptyText, onRetry, error }) {
  const now = ctx.now;
  const today = todayKey(now);
  const titleId = uid('tdy-title');

  const rows = plan.today.map((s, i) => {
    const li = sessionRow(ctx, s, { plan, studentNames, staff, showTutor, links });
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
        admin: showTutor,
      }))));
  }

  const count = plan.today.length;
  return h('section', { class: 'card is-list tdy-card', 'aria-labelledby': titleId },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title', id: titleId }, 'Today’s sessions'),
      count ? h('span', { class: 'card-meta num' }, String(count)) : null,
      scopeEl,
      h('a', { class: 'link card-link', href: SESSIONS_CALENDAR }, 'Open calendar')),
    error
      ? errorCallout({ title: 'We couldn’t load sessions.', text: 'Try again in a moment.', onRetry })
      : rows.length
        ? h('ul', { class: 'tdy-list', 'aria-label': 'Today’s sessions' }, rows)
        : quiet('calendar-blank', emptyText),
    foot.length ? h('div', { class: 'card-foot tdy-foot' }, foot) : null);
}

// Finished sessions from the last 30 days that still need attendance or notes,
// newest first. Eight show; "Show all" opens the rest.
function catchUpCard(ctx, list, { studentNames, staff, showTutor, links, scopeNote, onShowAll }) {
  const titleId = uid('tdy-catchup');
  const { shown, hidden } = catchUpWindow(list, { expanded: catchUpExpanded });
  const rows = shown.map((s) => sessionRow(ctx, s, { plan: null, studentNames, staff, showTutor, links, catchUp: true }));
  return h('section', { class: 'card is-list tdy-card tdy-catchup', 'aria-labelledby': titleId },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title', id: titleId }, 'Catch up'),
      h('span', { class: 'card-meta num' }, `${sessionCount(list.length)}${scopeNote}`)),
    h('ul', { class: 'tdy-list', 'aria-label': 'Sessions to catch up on' }, rows),
    hidden
      ? h('div', { class: 'card-foot tdy-foot' },
        button({
          label: showAllLabel(list.length),
          variant: 'secondary',
          size: 'sm',
          icon: 'caret-down',
          focusKey: 'cu-show-all',
          onClick: () => onShowAll(shown.length),
        }))
      : null);
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
  if (!ctx.isRefresh) catchUpExpanded = false;
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

  // Today's tutoring sessions and the Catch up list, above everything else. An
  // admin who also tutors starts on Mine and can switch to Everyone (remembered);
  // a tutor only ever has their own. Switching rebuilds just these two cards.
  let scope = admin ? getTodayScope(ctx.me.id) : 'mine';
  const sessionLinks = admin ? null : ws.links;
  const area = h('div', { class: 'tdy-area' });
  const scopeEl = admin ? scopeControl(scope, (value) => {
    scope = normalizeScope(value);
    setTodayScope(ctx.me.id, scope);
    paintSessions();
  }) : null;
  let listed = { today: 0, catchUp: [] };

  function paintSessions() {
    // Moving the control into the new card would drop its focus
    const scopeHadFocus = Boolean(scopeEl?.contains(document.activeElement));
    const showTutor = admin && scope === 'all';
    const plan = todayPlan(ws.sessions ?? [], now, { tutorId: scopeTutorId(ctx.role, scope, ctx.me.id), links: sessionLinks });
    const shared = { studentNames: names, staff, showTutor, links: sessionLinks };
    const cards = [sessionsCard(ctx, plan, {
      ...shared,
      scopeEl,
      emptyText: admin && scope === 'mine' ? 'No sessions of yours today.' : 'No sessions today.',
      error: Boolean(ws.sessionsError),
      onRetry: () => ctx.store.invalidate(null),
    })];
    if (plan.catchUp.length && !ws.sessionsError) {
      cards.push(catchUpCard(ctx, plan.catchUp, {
        ...shared,
        scopeNote: admin ? (scope === 'all' ? ', everyone’s' : ', yours') : '',
        onShowAll: (firstHidden) => {
          catchUpExpanded = true;
          paintSessions();
          // The button that was pressed is gone: land on the first row it revealed
          const next = listed.catchUp[firstHidden];
          if (next) area.querySelector(`[data-focus-key="row-s${next.id}"]`)?.focus({ preventScroll: true });
        },
      }));
    }
    listed = { today: plan.today.length, catchUp: plan.catchUp };
    area.replaceChildren(...cards);
    if (scopeHadFocus) scopeEl.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }
  paintSessions();
  nodes.push(area);

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
  const sessionsSaid = listed.today ? `${sessionCount(listed.today)}. ` : '';
  const catchUpSaid = listed.catchUp.length ? `${sessionCount(listed.catchUp.length)} to catch up. ` : '';
  ctx.announce(`Today, ${sessionsSaid}${catchUpSaid}${ledeText}`);
}
