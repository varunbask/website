// Pure wording and selection for the schedule surfaces outside the calendar:
// the Overview cards (families and staff), Today, the Students table and the
// People subject field. No DOM. Times are Pacific (dates.js), through
// sessions-model.js, with " PT" only when the viewer's clock differs.

import { dayKey, todayKey, daysBetween, weekday, longDate, parseKey, viewerIsInBusinessZone } from './dates.js';
import {
  clockText, timeRange, shortDayText, sessionTitle, sessionState, isCancelled, sortSessions,
  upcomingSessions, recentChanges, toneClass, canEditSession,
} from './sessions-model.js';
import { isNewSince } from './seen.js';

export const JOIN_LEAD_MINUTES = 15;   // the Join link shows this long before a session starts
export const NOTES_WINDOW_DAYS = 30;   // "Needs notes" and the Catch up list look back this far
export const CATCH_UP_ROWS = 8;        // the Catch up list shows this many before "Show all"
export const SUBJECT_MAX = 60;         // tutor_students.subject is at most 60 characters

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));
const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const same = (a, b) => String(a) === String(b);

// "tutoring session" reads fine mid-sentence; at the start it takes a capital
function whatText(session, { start = false } = {}) {
  if (!blank(session?.subject)) return session.subject.trim();
  return start ? 'Tutoring session' : 'tutoring session';
}

// "4:00 pm", plus " PT" when the viewer's clock is in another zone
export function clockLabel(iso, { viewerInZone } = {}) {
  const inZone = viewerInZone ?? viewerIsInBusinessZone(new Date(ms(iso)));
  return inZone ? clockText(iso) : `${clockText(iso)} PT`;
}

// ---------------------------------------------------------------------------
// Families: change notes, the Join link and the place

// "today", "tomorrow" or "Friday" for the days ahead that a weekday name is
// unambiguous for; null further out (or in the past)
function nearDay(key, today) {
  const diff = daysBetween(today, key);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff >= 2 && diff <= 6) return WEEKDAYS[weekday(key)];
  return null;
}

// "Thursday’s", "Today’s", "Tomorrow’s", "Yesterday’s", or null when the day is
// too far from today for a weekday name to be clear
function possessiveDay(key, today) {
  const diff = daysBetween(today, key);
  if (diff === -1) return 'Yesterday’s';
  const word = nearDay(key, today);
  return word ? `${word[0].toUpperCase()}${word.slice(1)}’s` : null;
}

// One moved or cancelled session, in words for a family:
//   "Thursday’s Algebra moved to Friday at 4:30 pm"
//   "Saturday’s SAT Reading is cancelled"
// Far-off days use a date instead: "Algebra on Thu, Oct 29 moved to Fri, Oct 30 at 4:30 pm".
// Returns null for a session that neither moved nor was cancelled.
export function changeNote(session, today, { viewerInZone } = {}) {
  if (!session) return null;
  if (isCancelled(session)) {
    const key = dayKey(session.starts_at);
    const owner = possessiveDay(key, today);
    return owner
      ? `${owner} ${whatText(session)} is cancelled`
      : `${whatText(session, { start: true })} on ${shortDayText(key, today)} is cancelled`;
  }
  if (!session.moved_from) return null;
  const from = dayKey(session.moved_from);
  const to = dayKey(session.starts_at);
  const clock = clockLabel(session.starts_at, { viewerInZone });
  const target = from === to ? clock : `${nearDay(to, today) ?? shortDayText(to, today)} at ${clock}`;
  const owner = possessiveDay(from, today);
  return owner
    ? `${owner} ${whatText(session)} moved to ${target}`
    : `${whatText(session, { start: true })} on ${shortDayText(from, today)} moved to ${target}`;
}

// The moves and cancellations a family has not seen yet, soonest first:
// [{ id, kind: 'moved' | 'cancelled', text }]. `seen` is what getSeen('schedule', ...)
// returned: an ISO time, null on a first visit (the last 7 days count, the same
// rule as the "New" marker in the nav), or undefined when storage is unavailable
// (nothing shows as new).
export function changeNotes(sessions, seen, now = new Date(), { viewerInZone } = {}) {
  if (seen === undefined) return [];
  const today = todayKey(now);
  return recentChanges(sessions, null, now)
    .filter((s) => isNewSince(s.changed_at, seen, now))
    .map((s) => ({
      id: s.id,
      kind: isCancelled(s) ? 'cancelled' : 'moved',
      text: changeNote(s, today, { viewerInZone }),
    }))
    .filter((n) => n.text);
}

// Online and starting within 15 minutes, or happening now. Never for a cancelled session.
export function canJoin(session, now = new Date(), { lead = JOIN_LEAD_MINUTES } = {}) {
  if (!session || blank(session.meeting_url) || isCancelled(session)) return false;
  const t = ms(now);
  return ms(session.starts_at) - lead * MIN_MS <= t && t < ms(session.ends_at);
}

// The in-person place, "Online" for a session with only a link, or ''
export function placeText(session) {
  if (!blank(session?.location)) return session.location.trim();
  return blank(session?.meeting_url) ? '' : 'Online';
}

// "Today, 4:00 to 5:00 pm", "Tomorrow, ...", "Thu, ..." (the card's date block
// carries the month and day)
export function whenText(session, today, { viewerInZone } = {}) {
  const key = dayKey(session.starts_at);
  const diff = daysBetween(today, key);
  let day;
  if (diff === 0) day = 'Today';
  else if (diff === 1) day = 'Tomorrow';
  else day = WEEKDAYS[weekday(key)].slice(0, 3);
  return `${day}, ${timeRange(session, { viewerInZone })}`;
}

// The spoken name of an upcoming-session row:
// "Algebra with Daniel Ortiz, Thursday, October 15, 4:00 to 5:00 pm, moved, Room 3"
export function sessionRowLabel(session, { who = null, now = new Date(), viewerInZone } = {}) {
  const today = todayKey(now);
  const key = dayKey(session.starts_at);
  const year = parseKey(key).y === parseKey(today).y ? '' : `, ${parseKey(key).y}`;
  const state = sessionState(session, now);
  const parts = [
    `${sessionTitle(session)}${who ? ` with ${who}` : ''}`,
    `${longDate(key)}${year}`,
    timeRange(session, { viewerInZone }),
  ];
  if (state.key !== 'scheduled') parts.push(state.label.toLowerCase());
  const place = placeText(session);
  if (place) parts.push(place);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Tutors

// Tutors with their subject, by name: [{ id, name, subject, tone }]. rows are
// getTutors() rows ({ tutor_id, full_name, subject }) or tutor_students rows
// ({ tutor_id, student_id, subject }); names (a Map of ids to names, from
// staffNames) fills in a missing full_name.
export function tutorEntries(rows, names = new Map()) {
  return (rows ?? [])
    .map((row) => {
      const own = blank(row.full_name) ? null : row.full_name.trim();
      const subject = blank(row.subject) ? null : row.subject.trim();
      return {
        id: row.tutor_id,
        name: own ?? names.get?.(String(row.tutor_id)) ?? 'Tutor',
        subject,
        tone: toneClass(subject),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || (a.subject ?? '').localeCompare(b.subject ?? ''));
}

// "Maya’s tutors" for a parent; the student's own card says "Your tutors"
export function tutorsTitle(firstName) {
  const name = String(firstName ?? '').trim();
  return name ? `${name}’s tutors` : 'Tutors';
}

// "Daniel Ortiz, Algebra", or just the name when there is no subject
export function tutorText({ name, subject }) {
  return blank(subject) ? name : `${name}, ${subject}`;
}

// A tutor's subject in a set of tutor_students rows, or null
export function linkSubject(links, tutorId, studentId) {
  const row = (links ?? []).find((l) => same(l.tutor_id, tutorId) && same(l.student_id, studentId));
  return blank(row?.subject) ? null : row.subject.trim();
}

// The value of a subject input -> { ok, subject, error }. Blank clears it (null).
export function normalizeSubject(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return { ok: true, subject: null, error: null };
  if (text.length > SUBJECT_MAX) return { ok: false, subject: null, error: `Use at most ${SUBJECT_MAX} characters.` };
  return { ok: true, subject: text, error: null };
}

// ---------------------------------------------------------------------------
// Today (tutor and admin)

const hasAttendance = (s) => s?.attendance !== null && s?.attendance !== undefined && s?.attendance !== '';

// What a session that has ended still lacks: { attendance, notes }. Both are
// false before it ends and for a cancelled session (nothing to write up).
export function sessionGaps(session, now = new Date()) {
  if (!session || isCancelled(session) || !(ms(session.ends_at) <= ms(now))) return { attendance: false, notes: false };
  return { attendance: !hasAttendance(session), notes: blank(session.recap) };
}

// "Needs attendance and notes", "Needs attendance", "Needs notes", or '' when nothing is missing
export function gapsText(gaps) {
  if (gaps?.attendance && gaps?.notes) return 'Needs attendance and notes';
  if (gaps?.attendance) return 'Needs attendance';
  if (gaps?.notes) return 'Needs notes';
  return '';
}

// Sessions that ended in the last 30 days, were not cancelled and still lack
// attendance or a recap, newest first. tutorId limits it to one tutor; links
// (the tutor's own tutor_students rows) drops sessions with a student the
// tutor no longer teaches, which they cannot write up.
export function catchUpSessions(sessions, now = new Date(), { days = NOTES_WINDOW_DAYS, tutorId = null, links = null } = {}) {
  const t = ms(now);
  const from = t - days * DAY_MS;
  return (sessions ?? [])
    .filter((s) => (tutorId === null || same(s.tutor_id, tutorId))
      && (!links || links.some((l) => same(l.tutor_id, s.tutor_id) && same(l.student_id, s.student_id)))
      && ms(s.ends_at) > from
      && (() => { const g = sessionGaps(s, now); return g.attendance || g.notes; })())
    .sort((a, b) => (ms(b.ends_at) - ms(a.ends_at)) || (Number(b.id) - Number(a.id)));
}

// How many sessions need attendance or notes (see catchUpSessions)
export function needsNotesCount(sessions, now = new Date(), options = {}) {
  return catchUpSessions(sessions, now, options).length;
}

// The first CATCH_UP_ROWS of a list unless expanded: { shown, hidden }
export function catchUpWindow(list, { expanded = false, limit = CATCH_UP_ROWS } = {}) {
  const all = list ?? [];
  if (expanded || all.length <= limit) return { shown: all, hidden: 0 };
  return { shown: all.slice(0, limit), hidden: all.length - limit };
}

// "Show all 12", for the button under a trimmed Catch up list
export function showAllLabel(total) {
  return `Show all ${total}`;
}

// "3 sessions", "1 session"
export function sessionCount(n) {
  return `${n} ${n === 1 ? 'session' : 'sessions'}`;
}

// ---------------------------------------------------------------------------
// One tap attendance and notes on Today

// 'present' | 'late' | 'absent' for the three one-tap buttons
export const QUICK_ATTENDANCE = Object.freeze(['present', 'late', 'absent']);

// "Marked Leo Park present"; clearing it (undo) says "Attendance cleared for Leo Park"
export function attendanceSaved(student, value) {
  const who = blank(student) ? 'the student' : student;
  return value ? `Marked ${who} ${String(value).toLowerCase()}` : `Attendance cleared for ${who}`;
}

// Why a one-tap attendance save failed. The billing guard (a session that
// already happened, a paid period) explains itself; a refused write is the
// database's row security; anything else is the connection.
export function attendanceErrorText(error) {
  if (error?.code === 'VP002') return `${String(error.message ?? '').replace(/\.?$/, '.')}`;
  if (error?.code === '42501') return 'You can only change attendance on sessions you tutor.';
  return 'Attendance didn’t save. Check your connection and try again.';
}

// The accessible name of one of a row's buttons. They repeat down a list, so
// each starts with its visible words and then says whose session it is:
//   "Present, Leo Park, Math, Mon, Oct 12"   "Write notes, Leo Park, Math, Mon, Oct 12"
export function quickLabel(action, session, { student = null, today } = {}) {
  const words = { present: 'Present', late: 'Late', absent: 'Absent', notes: 'Write notes' }[action] ?? String(action);
  return [words, student, sessionTitle(session), shortDayText(dayKey(session.starts_at), today)].filter(Boolean).join(', ');
}

// The drawer that holds one session's notes form opens on open=notes-s<id>
export const notesDrawerId = (sessionId) => `notes-s${sessionId}`;

// The session id in a notes drawer id ('notes-s12' -> '12'), or null for any other drawer id
export function notesDrawerSession(taskId) {
  const m = /^notes-s(\d+)$/.exec(String(taskId ?? ''));
  return m ? m[1] : null;
}

// Why the notes form cannot be used for a session, in words, or null when it can:
// the session has to have started, not be cancelled, and be the viewer's to change
export function notesBlockedText(session, me, { links = null, now = new Date() } = {}) {
  if (!session) return 'This session isn’t available. It may have been cancelled or removed.';
  if (isCancelled(session)) return 'This session was cancelled, so there are no notes to write.';
  if (ms(session.starts_at) > ms(now)) return 'This session hasn’t started yet. Notes can be written once it begins.';
  if (!canEditSession(session, me, { links })) return 'Only the session’s tutor or an admin can write these notes.';
  return null;
}

// Which of Mine and Everyone a stored or typed value means (Mine unless 'all')
export function normalizeScope(value) {
  return value === 'all' ? 'all' : 'mine';
}

export const SCOPE_LABELS = Object.freeze({ mine: 'Mine', all: 'Everyone' });

// Whose sessions Today lists: a tutor sees their own; an admin their own
// (Mine, the default) or everyone's. null means everyone.
export function scopeTutorId(role, scope, meId) {
  return role === 'admin' && normalizeScope(scope) === 'all' ? null : meId;
}

const scopeKey = (meId) => `vb-today-scope-${meId}`;

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

// The admin's saved choice ('mine' | 'all'); Mine when nothing is saved or storage is unavailable
export function getTodayScope(meId, storage = defaultStorage()) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return 'mine';
    return normalizeScope(storage.getItem(scopeKey(meId)));
  } catch {
    return 'mine';
  }
}

// Remembers the choice; returns whether it was saved
export function setTodayScope(meId, scope, storage = defaultStorage()) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false;
    storage.setItem(scopeKey(meId), normalizeScope(scope));
    return true;
  } catch {
    return false;
  }
}

// What the Today card shows for a viewer. tutorId limits it to one tutor's
// sessions (a tutor); leave it null for everyone's (an admin).
//   today       sessions starting today (Pacific), in time order, cancelled ones included
//   liveIds     Set of ids happening now
//   upNextId    the first session today that has not started (never a cancelled one), or null
//   later       with nothing left to start today, the next upcoming session on a later day
//   catchUp     earlier sessions still missing attendance or a recap, newest first
//               (not the ones already listed under today)
//   needsNotes  how many sessions in all, today's included, still need attendance or notes
// links: the tutor's own tutor_students rows; past sessions with a student
// they no longer teach cannot take notes, so they do not count as needing them
export function todayPlan(sessions, now = new Date(), { tutorId = null, links = null } = {}) {
  const mine = (sessions ?? []).filter((s) => tutorId === null || same(s.tutor_id, tutorId));
  const key = todayKey(now);
  const t = ms(now);
  const today = sortSessions(mine).filter((s) => dayKey(s.starts_at) === key);
  const liveIds = new Set(today.filter((s) => sessionState(s, now).key === 'now').map((s) => s.id));
  const upNext = today.find((s) => !isCancelled(s) && ms(s.starts_at) > t) ?? null;
  const later = upNext ? null : upcomingSessions(mine, now).find((s) => dayKey(s.starts_at) > key) ?? null;
  const needing = catchUpSessions(mine, now, { links });
  const listed = new Set(today.map((s) => s.id));
  return {
    today,
    liveIds,
    upNextId: upNext ? upNext.id : null,
    later,
    catchUp: needing.filter((s) => !listed.has(s.id)),
    needsNotes: needing.length,
  };
}

// The pill on a Today row: { key, label, tone }. The live session says "Now",
// a finished one with no notes says "Needs notes", the first one still to come
// says "Up next"; the rest use the session's own state.
export function todayPill(session, now = new Date(), { upNext = false } = {}) {
  const state = sessionState(session, now);
  if (state.key === 'now') return { key: 'now', label: 'Now', tone: 'accent' };
  if (state.key === 'finished') return { key: 'notes', label: 'Needs notes', tone: 'warning' };
  if (upNext && state.key === 'scheduled') return { key: 'next', label: 'Up next', tone: 'info' };
  return { key: state.key, label: state.label, tone: state.tone };
}

// "Next: Tue, Oct 6 at 4:00 pm with Leo Park" for a tutor; an admin also gets
// the tutor: "Next: Tue, Oct 6 at 4:00 pm, Daniel Ortiz with Leo Park"
export function nextLine(session, { student = null, tutor = null, today, admin = false, viewerInZone } = {}) {
  const when = `${shortDayText(dayKey(session.starts_at), today)} at ${clockLabel(session.starts_at, { viewerInZone })}`;
  const who = student ? ` with ${student}` : '';
  if (admin && tutor) return `Next: ${when}, ${tutor}${who}`;
  return `Next: ${when}${who}`;
}

// The spoken name of a Today row: "4:00 to 5:00 pm, Leo Park, Algebra with Daniel Ortiz, Room 3, now"
export function todayRowLabel(session, { student = null, tutor = null, now = new Date(), viewerInZone, pill } = {}) {
  const parts = [
    timeRange(session, { viewerInZone }),
    student,
    `${sessionTitle(session)}${tutor ? ` with ${tutor}` : ''}`,
  ];
  const place = placeText(session);
  if (place) parts.push(place);
  const label = (pill ?? todayPill(session, now)).label;
  parts.push(label.toLowerCase());
  return parts.filter(Boolean).join(', ');
}

// ---------------------------------------------------------------------------
// Students table

// The next upcoming session in a list (one student's, any tutor's), or null
export function nextSessionOf(sessions, now = new Date()) {
  return upcomingSessions(sessions, now, { limit: 1 })[0] ?? null;
}

// { day: 'Thu, Oct 8', time: '4:00 pm', text: 'Thu, Oct 8 at 4:00 pm' }
export function nextSessionParts(session, today, { viewerInZone } = {}) {
  const day = shortDayText(dayKey(session.starts_at), today);
  const time = clockLabel(session.starts_at, { viewerInZone });
  return { day, time, text: `${day} at ${time}` };
}
