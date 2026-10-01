// The session drawer (spec "Session drawer"): details for one tutoring session
// and, for staff, create, edit, cancel, restore, delete and the notes written
// after it. The drawer host (drawer.js) owns the dialog; this file fills it.
// item-drawer.js dispatches here:
//
//   renderSessionDetail(dctx)  dctx.taskId 's<id>'
//   renderSessionCreate(dctx)  dctx.taskId 'new-session' (staff only; params due, at)
//
// Store changes re-render the detail in place (dctx.onRefresh) so focus and
// scroll survive; the create, edit and notes forms keep what was typed.

import { h } from './dom.js';
import { icon } from './icons.js';
import { pill, emptyState, errorCallout, button, avatar } from './ui.js';
import { menu } from './overlays.js';
import { todayKey } from './dates.js';
import { displayName, firstName } from './format.js';
import { staffNames } from './updates-feed.js';
import { sb } from './supabase.js';
import {
  ATTENDANCE, sessionState, sessionTitle, toneClass, movedNote, isCancelled, followingInSeries,
  canEditSession, toIcs,
} from './sessions-model.js';
import {
  GONE, studentChoices, seriesLeftText, whenText, icsFileName, sessionsToast,
} from './session-form-model.js';
import { sessionForm, sessionNotesForm, callout } from './session-form.js';

const MISSING = 'This session isn’t available. It may have been cancelled or removed.';
const sameId = (a, b) => String(a) === String(b);
const esc = (s) => (globalThis.CSS?.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));

const STATE_ICONS = {
  cancelled: 'x-circle',
  now: 'clock',
  moved: 'arrow-counter-clockwise',
  scheduled: 'calendar-blank',
  attended: 'check-circle',
  late: 'clock',
  missed: 'minus-circle',
  finished: 'check',
};

const ATTENDANCE_PILLS = {
  present: { tone: 'success', icon: 'check-circle', label: ATTENDANCE.present },
  late: { tone: 'warning', icon: 'clock', label: ATTENDANCE.late },
  absent: { tone: 'danger', icon: 'minus-circle', label: ATTENDANCE.absent },
};

function section(title, ...children) {
  return h('section', { class: 'drawer-section' }, h('h3', {}, title), ...children);
}

function statePill(status) {
  return pill({ tone: status.tone, label: status.label, icon: STATE_ICONS[status.key] });
}

// ---------------------------------------------------------------------------
// Shared states

function paintMissing(dctx, title = 'Not available') {
  dctx.header.replaceChildren();
  dctx.headerActions.replaceChildren();
  dctx.setFooter(null);
  dctx.body.replaceChildren(
    h('h2', { class: 'drawer-title', tabindex: '-1' }, title),
    emptyState({ icon: 'info', text: MISSING, action: { label: 'Close', onClick: () => dctx.close() } }),
  );
  dctx.setTitle(title);
}

function paintError(dctx, { onRetry, title = 'Details' }) {
  dctx.header.replaceChildren();
  dctx.headerActions.replaceChildren();
  dctx.setFooter(null);
  dctx.body.replaceChildren(
    h('h2', { class: 'drawer-title', tabindex: '-1' }, title),
    errorCallout({
      title: 'We couldn’t load this session.',
      text: 'Check your connection and try again.',
      onRetry,
    }),
  );
  dctx.setTitle(title);
}

// ---------------------------------------------------------------------------
// Create (open=new-session&due=...&at=...)

export async function renderSessionCreate(dctx) {
  if (dctx.audience !== 'staff' || dctx.readOnly) {
    paintMissing(dctx);
    return;
  }
  // Keep what the tutor typed through any store change
  dctx.onRefresh(() => {});
  let ws;
  let names;
  try {
    [ws, names] = await Promise.all([dctx.store.getWorkspace(), staffNames()]);
  } catch (error) {
    if (!dctx.alive()) return;
    console.error(error);
    paintError(dctx, { title: 'New session', onRetry: () => dctx.store.invalidate(null) });
    return;
  }
  if (!dctx.alive()) return;

  // The Student select shows on the all-students calendar and Today, and
  // whenever no student is selected
  const pick = !dctx.scope?.student || dctx.route?.params?.scope === 'all' || dctx.route?.view === 'today';
  let students = null;
  let student = dctx.scope?.student ?? null;
  if (pick) {
    students = studentChoices({ students: ws.students ?? [], links: ws.links ?? [], me: dctx.me });
    if (!students.length) {
      dctx.header.replaceChildren();
      dctx.headerActions.replaceChildren();
      dctx.setFooter(null);
      dctx.body.replaceChildren(
        h('h2', { class: 'drawer-title', tabindex: '-1' }, 'New session'),
        emptyState({
          icon: 'info',
          text: dctx.me?.role === 'admin'
            ? 'No student has a tutor yet. Assign a tutor on the People page first.'
            : 'You have no students to schedule yet.',
          action: { label: 'Close', onClick: () => dctx.close() },
        }),
      );
      dctx.setTitle('New session');
      return;
    }
  }

  const form = sessionForm(dctx, { ws, names, students, student, params: dctx.params });
  dctx.header.replaceChildren();
  dctx.headerActions.replaceChildren();
  dctx.body.replaceChildren(form);
  dctx.setTitle(form.dataset.title);
}

// ---------------------------------------------------------------------------
// Data

// { session, sessions, studentId, student, ws } or null when unknown. The
// student's own sessions are the fresh copy; staff outside the student's scope
// (Today, the all-students calendar) find the student in the workspace first.
async function locate(dctx) {
  const { store } = dctx;
  const id = dctx.taskId.slice(1);
  const staff = dctx.audience === 'staff';
  const scoped = dctx.scope?.student ?? null;
  const pick = (list) => (list ?? []).find((s) => sameId(s.id, id)) ?? null;

  const [ws, scopedList] = await Promise.all([
    staff ? store.getWorkspace() : null,
    scoped ? store.getSessions(scoped.id) : null,
  ]);
  if (scoped) {
    const session = pick(scopedList);
    if (session) return { session, sessions: scopedList, studentId: scoped.id, student: scoped, ws };
  }
  if (!staff) return null;

  const summary = pick(ws.sessions);
  if (!summary) return null;
  const sessions = await store.getSessions(summary.student_id);
  const session = pick(sessions);
  if (!session) return null;
  const student = (ws.students ?? []).find((s) => sameId(s.id, summary.student_id)) ?? null;
  return { session, sessions, studentId: summary.student_id, student, ws };
}

// Hands a calendar app an .ics file without leaving the page. The temporary
// link goes inside `host` (the drawer body): an open modal dialog makes the
// rest of the page inert.
function downloadIcs(list, { names, fileName, host }) {
  const text = toIcs(list, { names, now: new Date() });
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const link = h('a', { href: url, download: fileName, hidden: true });
  host.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Detail

export function renderSessionDetail(dctx) {
  // focusTitle: a paint still owes the title focus (survives a superseded paint)
  const state = { mode: 'detail', seq: 0, focusTitle: false, found: null, names: new Map() };
  let working = false;

  async function paint({ refresh = false, focusTitle = false } = {}) {
    const my = ++state.seq;
    const current = () => dctx.alive() && my === state.seq && state.mode === 'detail';
    let found;
    let names;
    try {
      [found, names] = await Promise.all([locate(dctx), staffNames()]);
    } catch (error) {
      if (!current()) return;
      console.error(error);
      paintError(dctx, { onRetry: () => dctx.store.invalidate(dctx.scope?.student?.id ?? null) });
      return;
    }
    if (!current()) return;
    if (!found) {
      state.found = null;
      paintMissing(dctx);
      return;
    }

    // Where focus was, so a refresh can put it back
    const active = document.activeElement;
    const inBody = Boolean(active && dctx.body.contains(active));
    const inMenu = Boolean(active && dctx.headerActions.contains(active));
    const keepKey = refresh && inBody ? active.dataset?.focusKey ?? null : null;
    const wantTitle = focusTitle || state.focusTitle;
    state.focusTitle = false;

    const now = new Date();
    state.found = found;
    state.names = names;
    const view = buildDetail(dctx, found, {
      now,
      names,
      actions: {
        enterEdit, enterNotes, cancel: cancelSession, restore: restoreSession, remove, calendar,
      },
    });
    dctx.header.replaceChildren(...view.status);
    dctx.headerActions.replaceChildren(...view.actions);
    dctx.setFooter(null);
    dctx.body.replaceChildren(...view.nodes);
    dctx.setTitle(sessionTitle(found.session));

    const title = dctx.body.querySelector('h2.drawer-title');
    const focusLost = () => !document.activeElement || document.activeElement === document.body;
    if (wantTitle) {
      title?.focus();
    } else if (refresh) {
      const again = keepKey ? dctx.body.querySelector(`[data-focus-key="${esc(keepKey)}"]`) : null;
      const trigger = dctx.headerActions.querySelector('button');
      if (again) again.focus({ preventScroll: true });
      else if (inMenu && trigger) trigger.focus();
      else if ((inBody || inMenu || focusLost()) && !dctx.body.contains(document.activeElement)) title?.focus({ preventScroll: true });
    }
  }

  // Staff actions ---------------------------------------------------------

  function showActionError(text) {
    const slot = dctx.body.querySelector('.ses-action-error');
    if (!slot) return;
    slot.replaceChildren(callout({ tone: 'danger', icon: 'warning-circle', title: text, role: 'alert' }));
  }

  function enterEdit() {
    const found = state.found;
    if (!found) return;
    state.mode = 'edit';
    state.seq += 1;
    dctx.header.replaceChildren(statePill(sessionState(found.session, new Date())));
    dctx.headerActions.replaceChildren();
    const form = sessionForm(dctx, {
      session: found.session,
      ws: found.ws,
      names: state.names,
      siblings: found.sessions,
      student: found.student,
      onCancel: backToDetail,
      onSaved: backToDetail,
    });
    dctx.body.replaceChildren(form);
    dctx.body.scrollTop = 0;
    dctx.setTitle(form.dataset.title);
    form.querySelector('input[name="subject"]')?.focus();
  }

  function enterNotes() {
    const found = state.found;
    if (!found) return;
    state.mode = 'notes';
    state.seq += 1;
    dctx.header.replaceChildren(statePill(sessionState(found.session, new Date())));
    dctx.headerActions.replaceChildren();
    const form = sessionNotesForm(dctx, { session: found.session, onCancel: backToDetail, onSaved: backToDetail });
    dctx.body.replaceChildren(form);
    dctx.body.scrollTop = 0;
    dctx.setTitle(form.dataset.title);
    form.querySelector('.segmented button')?.focus();
  }

  function backToDetail() {
    state.mode = 'detail';
    // Kept on state: the store change a save causes supersedes this paint
    state.focusTitle = true;
    dctx.setFooter(null);
    paint();
  }

  // Runs one write. The result must hold the rows it changed (.select('id')):
  // none means the session was changed or removed since the page loaded.
  async function write({ run, failed, done, close = false }) {
    const found = state.found;
    if (!found || working) return;
    working = true;
    let result;
    try {
      result = await run(found);
    } finally {
      working = false;
    }
    if (result.error) {
      console.error(result.error);
      if (dctx.alive()) showActionError(failed);
      return;
    }
    if (!result.data?.length) {
      if (dctx.alive()) showActionError(GONE);
      return;
    }
    if (close) {
      // Ignore the refresh this causes: the drawer is on its way out
      state.mode = 'deleted';
      state.seq += 1;
      dctx.close();
    }
    dctx.store.invalidate(found.studentId);
    dctx.toast({ text: done(result.data.length) });
  }

  // Cancelling keeps the session on the calendar, struck through, so families
  // see what happened. scope: 'this' or 'following' (the rest of a series).
  function cancelSession(scope = 'this') {
    const found = state.found;
    if (!found) return;
    const targets = scope === 'following'
      ? followingInSeries(found.sessions, found.session).filter((s) => !isCancelled(s))
      : [found.session];
    if (!targets.length) {
      dctx.toast({ text: 'Those sessions are already cancelled' });
      return;
    }
    const patch = { status: 'cancelled' };
    return write({
      run: () => (targets.length === 1
        ? sb.from('sessions').update(patch).eq('id', targets[0].id).select('id')
        : sb.from('sessions').update(patch).in('id', targets.map((s) => s.id)).select('id')),
      failed: 'We couldn’t cancel that session. Try again.',
      done: (n) => sessionsToast(n, 'cancelled'),
    });
  }

  function restoreSession() {
    const found = state.found;
    if (!found) return;
    return write({
      run: () => sb.from('sessions').update({ status: 'scheduled' }).eq('id', found.session.id).select('id'),
      failed: 'We couldn’t restore that session. Try again.',
      done: () => 'Session restored',
    });
  }

  async function remove(scope = 'this') {
    const found = state.found;
    if (!found || working) return;
    const targets = scope === 'following' ? followingInSeries(found.sessions, found.session) : [found.session];
    const n = targets.length;
    const who = found.student ? `${firstName(displayName(found.student))}’s` : 'the student’s';
    const ok = await dctx.confirm({
      title: n > 1 ? `Delete ${n} sessions?` : 'Delete this session?',
      body: n > 1
        ? `They will be removed from ${who} calendar. This can’t be undone. Cancel them instead to keep a record.`
        : `It will be removed from ${who} calendar. This can’t be undone. Cancel it instead to keep a record.`,
      confirmLabel: n > 1 ? `Delete ${n} sessions` : 'Delete',
      tone: 'danger',
    });
    if (!ok || !dctx.alive()) return;
    await write({
      run: () => (n === 1
        ? sb.from('sessions').delete().eq('id', targets[0].id).select('id')
        : sb.from('sessions').delete().in('id', targets.map((s) => s.id)).select('id')),
      failed: 'We couldn’t delete that session. Try again.',
      done: (count) => sessionsToast(count, 'deleted'),
      close: true,
    });
  }

  // Add to calendar: one session, or the rest of its series
  function calendar(series) {
    const found = state.found;
    if (!found) return;
    const list = series ? followingInSeries(found.sessions, found.session) : [found.session];
    downloadIcs(list, { names: state.names, fileName: icsFileName(found.session, { series }), host: dctx.body });
    dctx.toast({ text: 'Calendar file downloaded' });
  }

  // Store changes re-render the detail in place; the forms keep their input
  dctx.onRefresh(() => {
    if (state.mode === 'detail') paint({ refresh: true });
  });

  return paint();
}

// Builds the detail content. Returns { status, actions, nodes }.
function buildDetail(dctx, found, { now, names, actions }) {
  const { session, student, sessions } = found;
  const staff = dctx.audience === 'staff';
  // A tutor no longer assigned to the student can read but not change it
  const editable = staff && !dctx.readOnly && canEditSession(session, dctx.me, { links: found.ws?.links ?? null });
  const status = sessionState(session, now);
  const cancelled = isCancelled(session);
  const started = Date.parse(session.starts_at) <= now.getTime();
  const tutorName = names?.get?.(String(session.tutor_id)) || null;
  const title = sessionTitle(session);
  const following = followingInSeries(sessions, session);
  const inSeries = Boolean(session.series_id) && following.length > 1;

  // Bar: state pill; the staff menu
  const actionNodes = [];
  if (editable) {
    const menuEl = menu({
      label: `More actions for ${title}`,
      items: [
        { label: 'Edit session', icon: 'pencil-simple', onSelect: actions.enterEdit },
        started && !cancelled ? { label: 'Write session notes', icon: 'note-pencil', onSelect: actions.enterNotes } : null,
        { separator: true },
        cancelled
          ? { label: 'Restore session', icon: 'arrow-counter-clockwise', onSelect: actions.restore }
          : { label: 'Cancel session', icon: 'x-circle', onSelect: () => actions.cancel('this') },
        inSeries ? { label: 'Cancel this and following', icon: 'x-circle', onSelect: () => actions.cancel('following') } : null,
        { separator: true },
        { label: 'Delete session', icon: 'trash', tone: 'danger', onSelect: () => actions.remove('this') },
        inSeries ? { label: 'Delete this and following', icon: 'trash', tone: 'danger', onSelect: () => actions.remove('following') } : null,
      ],
    });
    const trigger = menuEl.querySelector('[aria-haspopup="menu"]');
    if (trigger) trigger.dataset.focusKey = 'ses-menu';
    actionNodes.push(menuEl);
  }

  // Facts: when, who, where
  const facts = h('dl', { class: 'ses-facts' });
  const fact = (label, ...value) => facts.append(h('div', { class: 'ses-fact' }, h('dt', {}, label), h('dd', {}, ...value)));
  const person = (name, fallback, { staffTint = false } = {}) => (name
    ? h('span', { class: 'ses-person' }, avatar(name, { size: 24, staff: staffTint }), h('span', {}, name))
    : h('span', { class: 'ses-muted' }, fallback));

  const when = whenText(session, { now });
  fact('When', h('span', { class: 'ses-when-date' }, when.date), h('span', { class: 'ses-when-time' }, when.time));
  fact('Tutor', person(tutorName, staff ? 'A tutor' : 'Your tutor', { staffTint: true }));
  if (staff) fact('Student', person(student ? displayName(student) : null, 'Student'));

  const where = [];
  if (session.location) where.push(h('span', { class: 'ses-place' }, session.location));
  if (/^https:\/\//i.test(session.meeting_url ?? '')) {
    const join = button({
      label: 'Join online',
      variant: 'secondary',
      iconEnd: 'arrow-square-out',
      href: session.meeting_url,
      ariaLabel: 'Join online, opens in a new tab',
      focusKey: 'ses-join',
      className: 'ses-join',
    });
    join.setAttribute('target', '_blank');
    join.setAttribute('rel', 'noopener noreferrer');
    where.push(join);
  }
  if (!where.length) where.push(h('span', { class: 'ses-muted' }, 'Not set yet'));
  fact('Where', ...where);

  const series = seriesLeftText(sessions, session);
  if (series) fact('Series', series);

  const head = h('div', { class: cancelled ? 'ses-head is-cancelled' : 'ses-head' },
    h('p', { class: 'drawer-kind' }, 'Tutoring session'),
    h('div', { class: `ses-titlerow ${toneClass(session.subject)}` },
      h('span', { class: 'ses-dot', 'aria-hidden': 'true' }),
      h('h2', { class: 'drawer-title', tabindex: '-1' }, title)),
    facts);

  const nodes = [head, h('div', { class: 'ses-action-error' })];

  // What changed
  if (cancelled) {
    nodes.push(callout({
      tone: 'neutral',
      icon: 'x-circle',
      title: 'This session was cancelled.',
      text: editable ? 'Restore it from the menu at the top if it is back on.' : null,
    }));
  } else {
    const moved = movedNote(session, todayKey(now));
    if (moved) nodes.push(callout({ tone: 'warning', icon: 'arrow-counter-clockwise', title: moved }));
  }
  if (staff && !editable) {
    nodes.push(h('p', { class: 'note ses-readonly' }, icon('info'),
      h('span', {}, `Only ${tutorName || 'the tutor'} or an admin can change this session.`)));
  }

  // Plan
  if (session.notes) {
    nodes.push(section('Plan', h('p', { class: 'read is-pre ses-plan' }, session.notes)));
  } else if (editable && !cancelled && !started) {
    nodes.push(section('Plan', h('p', { class: 'ses-muted' }, 'No plan yet. Add one with Edit session.')));
  }

  // After it starts: attendance and the recap. Families see what the tutor
  // wrote; an empty section is only for the tutor, as a prompt.
  const hasNotes = Boolean(session.attendance || session.recap);
  if (started && (hasNotes || (editable && !cancelled))) {
    const body = [];
    if (session.attendance && ATTENDANCE_PILLS[session.attendance]) {
      body.push(h('p', { class: 'ses-attendance' },
        h('span', { class: 'ses-attendance-label' }, 'Attendance'),
        pill(ATTENDANCE_PILLS[session.attendance])));
    }
    if (session.recap) body.push(h('p', { class: 'read is-pre ses-recap' }, session.recap));
    if (!hasNotes) {
      body.push(h('p', { class: 'ses-muted' }, 'No notes yet. Add attendance and a short recap so the family can see how it went.'));
    }
    if (editable && !cancelled) {
      body.push(button({
        label: hasNotes ? 'Edit session notes' : 'Write session notes',
        size: 'sm',
        variant: 'secondary',
        icon: 'note-pencil',
        onClick: actions.enterNotes,
        focusKey: 'ses-write-notes',
      }));
    }
    nodes.push(section('Session notes', h('div', { class: 'well ses-notes' }, body)));
  }

  // Add to calendar
  const calendarButtons = [button({
    label: 'Add to calendar',
    icon: 'calendar-blank',
    onClick: () => actions.calendar(false),
    focusKey: 'ses-ics',
  })];
  if (inSeries) {
    calendarButtons.push(button({
      label: 'Add the rest of the series',
      icon: 'calendar-blank',
      onClick: () => actions.calendar(true),
      focusKey: 'ses-ics-series',
    }));
  }
  nodes.push(h('section', { class: 'drawer-section ses-calendar' },
    h('h3', { class: 'visually-hidden' }, 'Calendar'),
    h('div', { class: 'ses-actions' }, calendarButtons)));

  return { status: [statePill(status)], actions: actionNodes, nodes };
}
