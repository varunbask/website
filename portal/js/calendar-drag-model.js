// Dragging on the calendar, the parts without a DOM: who may drag what, where
// a drop lands, the writes it makes and the words for it. Times are in the
// business zone (America/Los_Angeles), like the rest of the calendar.

import { dayKey, longDate, zonedIso, daysBetween } from './dates.js';
import {
  canEditSession, isCancelled, retimeRows, sessionTitle, timeInput, timeRange, durationMinutes,
} from './sessions-model.js';
import { changedUpdates } from './session-form-model.js';
import { dueDateToIso } from './format.js';

export const SNAP_MINUTES = 15;
export const DRAG_THRESHOLD_PX = 5;

const ms = (iso) => Date.parse(iso);
const DAY_END = 24 * 60;

export function toMinutes(time) {
  const [h, m] = String(time).split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Who may drag

// A session moves by drag for its own tutor (still linked) or an admin, while
// it is still ahead and not cancelled. links: tutor_students rows, or null
// when they are not known (the database still has the last word).
export function canDragSession(session, me, { links = null, now = new Date(), readOnly = false } = {}) {
  if (readOnly || !session || isCancelled(session)) return false;
  if (!(ms(session.starts_at) > new Date(now).getTime())) return false;
  return canEditSession(session, me, { links });
}

// A due date moves by drag for staff, unless the grade is out or the task is done
export function canDragDue(item, { staff = false, readOnly = false } = {}) {
  if (!staff || readOnly || !item?.task) return false;
  if (item.grade?.released_at) return false;
  if (item.task.kind === 'task' && item.task.completed_at) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Where a drop lands (the week grid)

// The start, in minutes after midnight, for a pointer at `fraction` (0 to 1)
// down a day column showing hours.start to hours.end. grabMinutes is how far
// into the session the pointer took hold, so the session keeps its place
// under the pointer. Snapped to SNAP_MINUTES and kept inside the hours.
export function dropStart({ fraction, hours, duration, grabMinutes = 0 }) {
  const top = hours.start * 60;
  const bottom = hours.end * 60;
  const raw = top + (Number.isFinite(fraction) ? fraction : 0) * (bottom - top) - grabMinutes;
  const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.min(Math.max(snapped, top), Math.max(top, bottom - duration));
}

// The minutes into a session at `fraction` of the column, for grabMinutes
export function grabOffset({ fraction, hours, session }) {
  const at = hours.start * 60 + fraction * (hours.end - hours.start) * 60;
  return Math.min(Math.max(at - toMinutes(timeInput(session.starts_at)), 0), durationMinutes(session));
}

// ---------------------------------------------------------------------------
// The move

// { starts_at, ends_at } for the session on `date` at `start` (HH:MM), the
// same length; null when it would run past midnight
export function movedTimes(session, { date, start }) {
  const begin = toMinutes(start);
  const end = begin + durationMinutes(session);
  if (end > DAY_END - 1) return null;
  return { starts_at: zonedIso(date, minutesToTime(begin)), ends_at: zonedIso(date, minutesToTime(end)) };
}

// Why a drop cannot be saved, or null: 'same' (nowhere new), 'overnight'
// (it would end after midnight) or 'past' (it would start before now)
export function moveProblem(session, { date, start }, now = new Date()) {
  const times = movedTimes(session, { date, start });
  if (!times) return 'overnight';
  if (ms(times.starts_at) === ms(session.starts_at)) return 'same';
  if (!(ms(times.starts_at) > new Date(now).getTime())) return 'past';
  return null;
}

// The writes for a move, [{ id, fields: { starts_at, ends_at } }]. 'this'
// moves the session; 'following' moves every row of `rows` (the session and
// the later ones in its series) by the same change. Only times are written,
// and rows that would not change are left out.
export function moveUpdates({ session, rows = null, apply = 'this', date, start }) {
  const times = movedTimes(session, { date, start });
  if (!times) return [];
  const updates = apply === 'following' && rows?.length
    ? retimeRows(rows, session, { date, start: timeInput(times.starts_at), end: timeInput(times.ends_at) })
      .map((t) => ({ id: t.id, fields: { starts_at: t.starts_at, ends_at: t.ends_at } }))
    : [{ id: session.id, fields: times }];
  return changedUpdates(updates, [session, ...(rows ?? [])]);
}

// The arguments of edit_following_sessions for a drop with "This and
// following": the days and minutes the session (and every later one in its
// series, and the rule that makes new ones) moves by. null when it would not move.
export function followingMove({ session, date, start }) {
  const times = movedTimes(session, { date, start });
  if (!times) return null;
  const p_shift = daysBetween(dayKey(session.starts_at), dayKey(times.starts_at));
  const delta = toMinutes(timeInput(times.starts_at)) - toMinutes(timeInput(session.starts_at));
  if (!p_shift && !delta) return null;
  return { p_session: session.id, p_shift, p_start_delta: delta, p_end_delta: delta, p_fields: {} };
}

// Whether "This and following" can move every row of `rows` by the change
// that takes `session` to `date` at `start`: false when a later session would
// start before midnight or run past it (those rows would be cut short, and
// the database refuses a session that ends before it starts)
export function followingFits({ session, rows, date, start }) {
  const times = movedTimes(session, { date, start });
  if (!times) return false;
  const delta = toMinutes(timeInput(times.starts_at)) - toMinutes(timeInput(session.starts_at));
  return (rows ?? []).every((row) => {
    const begin = toMinutes(timeInput(row.starts_at)) + delta;
    const end = begin + durationMinutes(row);
    return begin >= 0 && end <= DAY_END - 1 && end > begin;
  });
}

// "Algebra with Maya Lin moves to Wednesday, September 30, 4:00 to 5:00 pm."
export function moveSummary(session, times, { who = null, viewerInZone } = {}) {
  const what = who ? `${sessionTitle(session)} with ${who}` : sessionTitle(session);
  return `${what} moves to ${longDate(dayKey(times.starts_at))}, ${timeRange(times, { viewerInZone })}.`;
}

export function moveToast(count) {
  return count > 1 ? `${count} sessions moved` : 'Session moved';
}

// What a refused drop says
export const MOVE_PROBLEMS = Object.freeze({
  past: 'Sessions can only move to a time that hasn’t passed.',
  overnight: 'A session can’t run past midnight. Pick an earlier time.',
});

// ---------------------------------------------------------------------------
// Due dates

// Why a due date cannot move to dateKey, or null: 'same' or 'past' (a day before today)
export function dueMoveProblem(item, dateKey, today) {
  if (item?.task?.due_at && dayKey(item.task.due_at) === dateKey) return 'same';
  if (dateKey < today) return 'past';
  return null;
}

// The due_at for a day: 11:59 pm Pacific, as everywhere else
export function dueAtFor(dateKey) {
  return dueDateToIso(dateKey);
}

export function dueToast(dateKey) {
  return `Due date moved to ${longDate(dateKey)}`;
}

export const DUE_PAST = 'Due dates can only move to today or later.';
