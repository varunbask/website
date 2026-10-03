// Pure logic behind the session drawer and its forms (session-drawer.js,
// session-form.js). No DOM. Times are Pacific wall times (dates.js), with the
// rules in sessions-model.js (validateSessionForm, weeklyTimes, retimeRows).
//
// A form "state" is the raw field values:
//   { date, start, end, subject, where ('in-person' | 'online'), location,
//     meeting_url, notes, repeat, weeks }

import {
  MAX_REPEAT_WEEKS, addMinutesToTime, validateSessionForm, weeklyTimes, retimeRows, newSeriesId,
  findClashes, timeRange, shortDayText, timeInput, isCancelled, durationMinutes, durationText,
} from './sessions-model.js';
import { dayKey, todayKey, parseKey, addDays, longDate } from './dates.js';

export const QUICK_DURATIONS = Object.freeze([30, 45, 60, 90, 120]);
export const DEFAULT_START = '16:00';
export const DEFAULT_MINUTES = 60;
export const DEFAULT_WEEKS = 8;
export const MIN_REPEAT_WEEKS = 2;
export const MAX_RECAP_LENGTH = 4000;
export const GONE = 'This item was changed or removed. Refresh the page and try again.';

const KEY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MAX_CLASH_LINES = 4;

const ms = (iso) => Date.parse(iso);
const sameId = (a, b) => String(a) === String(b);

// ---------------------------------------------------------------------------
// Starting values

// The create form: Date from ?due=, Start from ?at=, End an hour later
export function createDefaults({ params = {}, now = new Date(), subject = '' } = {}) {
  const date = KEY_RE.test(params?.due ?? '') ? params.due : todayKey(now);
  const start = TIME_RE.test(params?.at ?? '') ? params.at : DEFAULT_START;
  return {
    date,
    start,
    end: addMinutesToTime(start, DEFAULT_MINUTES),
    subject,
    where: 'in-person',
    location: '',
    meeting_url: '',
    notes: '',
    repeat: false,
    weeks: DEFAULT_WEEKS,
  };
}

// The edit form, from the session as stored
export function editDefaults(session) {
  return {
    date: dayKey(session.starts_at),
    start: timeInput(session.starts_at),
    end: timeInput(session.ends_at),
    subject: session.subject ?? '',
    where: session.meeting_url && !session.location ? 'online' : 'in-person',
    location: session.location ?? '',
    meeting_url: session.meeting_url ?? '',
    notes: session.notes ?? '',
    repeat: false,
    weeks: DEFAULT_WEEKS,
  };
}

// Whole minutes from 'HH:MM' to 'HH:MM', or null when either is blank or the
// end is not after the start
export function minutesBetween(start, end) {
  if (!TIME_RE.test(start ?? '') || !TIME_RE.test(end ?? '')) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const minutes = (eh * 60 + em) - (sh * 60 + sm);
  return minutes > 0 ? minutes : null;
}

// ---------------------------------------------------------------------------
// Who and what a tutor can pick

const byLabel = (a, b) => a.label.localeCompare(b.label);

// The students a form may book. A tutor books only students they are linked
// to; an admin only students that have at least one tutor.
export function studentChoices({ students = [], links = [], me }) {
  const linked = new Set(links
    .filter((l) => me?.role === 'admin' || sameId(l.tutor_id, me?.id))
    .map((l) => String(l.student_id)));
  return students.filter((s) => linked.has(String(s.id)));
}

// [{ value, label }] of the tutors who can teach a student: for an admin every
// linked tutor (by name), themselves first when they teach the student, for a
// tutor only themselves, and only when linked
export function tutorChoices({ links = [], studentId, me, names = new Map() }) {
  if (!studentId) return [];
  const ids = [...new Set(links.filter((l) => sameId(l.student_id, studentId)).map((l) => String(l.tutor_id)))];
  const label = (id) => names.get(String(id)) || 'Tutor';
  const mine = ids.includes(String(me?.id));
  if (me?.role === 'admin') {
    const others = ids.filter((id) => id !== String(me.id)).map((id) => ({ value: id, label: label(id) })).sort(byLabel);
    return mine ? [{ value: String(me.id), label: `${label(me.id)} (you)` }, ...others] : others;
  }
  return mine ? [{ value: String(me.id), label: label(me.id) }] : [];
}

// The subjects on a student's tutor links, for the datalist
export function subjectsFor(links = [], studentId) {
  const seen = new Map();
  for (const l of links) {
    const subject = String(l.subject ?? '').trim();
    if (subject && sameId(l.student_id, studentId) && !seen.has(subject.toLowerCase())) seen.set(subject.toLowerCase(), subject);
  }
  return [...seen.values()];
}

// What this tutor teaches this student, or ''
export function defaultSubject(links = [], tutorId, studentId) {
  const link = links.find((l) => sameId(l.tutor_id, tutorId) && sameId(l.student_id, studentId));
  return String(link?.subject ?? '').trim();
}

// ---------------------------------------------------------------------------
// Checking, planning and saving

// Raw field values for validateSessionForm: only the chosen place is sent
export function rawFromState(state) {
  return {
    date: state.date,
    start: state.start,
    end: state.end,
    subject: state.subject,
    location: state.where === 'online' ? '' : state.location,
    meeting_url: state.where === 'online' ? state.meeting_url : '',
    notes: state.notes,
    repeat: state.repeat,
    weeks: state.weeks,
  };
}

// validateSessionForm, with the repeat count held to 2 to 26 (one session
// is just not repeating)
export function checkSessionForm(state, { creating = true } = {}) {
  const result = validateSessionForm(rawFromState(state), { creating });
  const errors = { ...result.errors };
  if (creating && state.repeat) {
    const weeks = Number(String(state.weeks ?? '').trim());
    if (!Number.isInteger(weeks) || weeks < MIN_REPEAT_WEEKS || weeks > MAX_REPEAT_WEEKS) {
      errors.weeks = `Repeat for ${MIN_REPEAT_WEEKS} to ${MAX_REPEAT_WEEKS} weeks.`;
    } else {
      delete errors.weeks;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, values: result.values };
}

// The sessions a form would write, as [{ id?, starts_at, ends_at }]:
//   create          one per week (values.weeks), no ids
//   edit, 'this'    the session
//   edit, following every row of `rows`, moved by the same number of days
export function plannedTimes(values, { session = null, rows = null, apply = 'this' } = {}) {
  if (!session) return weeklyTimes({ date: values.date, start: values.start, end: values.end, weeks: values.repeat ? values.weeks : 1 });
  if (apply === 'following' && rows?.length) return retimeRows(rows, session, values);
  const [t] = weeklyTimes({ date: values.date, start: values.start, end: values.end, weeks: 1 });
  return [{ id: session.id, ...t }];
}

// Rows for one insert of a new session or a weekly series
export function buildInsertRows({ studentId, tutorId, values, seriesId }) {
  const weeks = values.repeat ? values.weeks : 1;
  const series = weeks > 1 ? (seriesId ?? newSeriesId()) : null;
  return plannedTimes(values).map((t) => ({
    student_id: studentId,
    tutor_id: tutorId,
    subject: values.subject,
    starts_at: t.starts_at,
    ends_at: t.ends_at,
    location: values.location,
    meeting_url: values.meeting_url,
    notes: values.notes,
    series_id: series,
  }));
}

const textOf = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
const TEXT_FIELDS = ['subject', 'location', 'meeting_url', 'notes'];

// One update per row for an edit: [{ id, fields }]. The edited session gets
// every field. With "this and following", the later rows get only what the
// tutor changed on the edited one (so a session moved or planned on its own
// keeps that), and new times only when the time changed.
export function buildUpdates({ values, session, rows = null, apply = 'this' }) {
  const timed = plannedTimes(values, { session, rows, apply });
  const changedText = TEXT_FIELDS.filter((k) => textOf(values[k]) !== textOf(session[k]));
  const timeChanged = timed.some((t) => String(t.id) === String(session.id)
    && (ms(t.starts_at) !== ms(session.starts_at) || ms(t.ends_at) !== ms(session.ends_at)));
  return timed.map((t) => {
    const own = String(t.id) === String(session.id);
    const fields = {};
    for (const k of (own ? TEXT_FIELDS : changedText)) fields[k] = values[k];
    if (own || timeChanged) Object.assign(fields, { starts_at: t.starts_at, ends_at: t.ends_at });
    return { id: t.id, fields };
  });
}

// Drops the updates that would write what a row already holds, so a save with
// nothing new leaves updated_at (and a family's "New" marker) alone.
// current: the rows as they are now (the first with an id wins).
export function changedUpdates(updates, current) {
  const byId = new Map();
  for (const row of current ?? []) if (!byId.has(String(row.id))) byId.set(String(row.id), row);
  const text = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
  return updates.filter((u) => {
    const row = byId.get(String(u.id));
    if (!row) return true;
    const f = u.fields;
    // Only the fields this update carries count
    return Object.keys(f).some((k) => (k === 'starts_at' || k === 'ends_at'
      ? ms(row[k]) !== ms(f[k])
      : text(row[k]) !== text(f[k])));
  });
}

// Merges session lists by id, the first list winning
export function mergeSessions(...lists) {
  const byId = new Map();
  for (const list of lists) for (const s of list ?? []) if (!byId.has(String(s.id))) byId.set(String(s.id), s);
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// Words

// "Schedule session", "Schedule 8 sessions"
export function scheduleLabel(weeks = 1) {
  return weeks > 1 ? `Schedule ${weeks} sessions` : 'Schedule session';
}

// What to tell a tutor when a write fails. Row security (42501) means the
// tutor is not linked to the student; a check violation (23514) is a bad time.
export function saveErrorText(error) {
  if (error?.code === '42501') return 'You can only schedule sessions for students you tutor.';
  if (error?.code === '23514') return 'Check the times and details, then try again.';
  return 'Check your connection and try again.';
}

// "Session cancelled", "4 sessions cancelled"
export function sessionsToast(n, verb) {
  return n === 1 ? `Session ${verb}` : `${n} sessions ${verb}`;
}

// "8 weekly sessions, the last on Tue, Dec 1", or '' when the date or the
// count is not usable yet
export function repeatSummary(date, weeks) {
  const n = Number(String(weeks ?? '').trim());
  if (!KEY_RE.test(date ?? '') || !Number.isInteger(n) || n < MIN_REPEAT_WEEKS || n > MAX_REPEAT_WEEKS) return '';
  return `${n} weekly sessions, the last on ${shortDayText(addDays(date, (n - 1) * 7), date)}`;
}

// "Applies to 4 sessions, from Thu, Oct 15 on"
export function followingSummary(rows, session) {
  const n = rows.length;
  return `Applies to ${n} ${n === 1 ? 'session' : 'sessions'}, from ${shortDayText(dayKey(session.starts_at))} on`;
}

// "Repeats weekly, 4 more sessions": the series' scheduled sessions after this
export function seriesLeftText(list, session) {
  if (!session?.series_id) return null;
  const more = (list ?? []).filter((s) => s.series_id === session.series_id
    && ms(s.starts_at) > ms(session.starts_at) && !isCancelled(s)).length;
  if (more === 0) return 'Repeats weekly, this is the last session';
  return `Repeats weekly, ${more} more ${more === 1 ? 'session' : 'sessions'}`;
}

// { date: 'Tuesday, October 6', time: '4:00 to 5:00 pm, 1 hour' }; the year
// shows when it is not the reference day's
export function whenText(session, { now = new Date(), viewerInZone } = {}) {
  const key = dayKey(session.starts_at);
  const sameYear = parseKey(key).y === parseKey(todayKey(now)).y;
  return {
    date: `${longDate(key)}${sameYear ? '' : `, ${parseKey(key).y}`}`,
    time: `${timeRange(session, { viewerInZone })}, ${durationText(durationMinutes(session))}`,
  };
}

// 'algebra-oct-15.ics'; for the rest of a series 'algebra-weekly-oct-15.ics'
export function icsFileName(session, { series = false } = {}) {
  const slug = String(session?.subject ?? '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '') || 'session';
  const { m, d } = parseKey(dayKey(session.starts_at));
  return `${slug}${series ? '-weekly' : ''}-${MONTHS[m - 1]}-${d}.ics`;
}

// ---------------------------------------------------------------------------
// Clash warning

// One line for a clash: "Daniel Ortiz already has Leo Park at 4:00 to 5:00 pm."
// or "Maya Lin has SAT Reading with Priya Shah then."
export function clashLine(clash, { tutorNames = new Map(), studentNames = new Map(), viewerInZone } = {}) {
  const s = clash.session;
  const tutor = tutorNames.get(String(s.tutor_id)) || 'This tutor';
  const student = studentNames.get(String(s.student_id)) || 'The student';
  if (clash.who === 'student') {
    const subject = String(s.subject ?? '').trim() || 'a tutoring session';
    return `${student} has ${subject} with ${tutor} then.`;
  }
  return `${tutor} already has ${student} at ${timeRange(s, { viewerInZone })}.`;
}

// What to tell a tutor about overlaps, never blocking:
//   { total, count, title, lines }  title is null when nothing clashes.
// planned: [{ id?, starts_at, ends_at }] (plannedTimes); list: the student's
// sessions plus the tutor's; ignoreIds: the rows an edit replaces.
export function clashReport({
  planned, studentId, tutorId, list, ignoreIds = [], tutorNames, studentNames, viewerInZone,
}) {
  const per = (planned ?? []).map((p) => ({
    p,
    clashes: findClashes(
      { student_id: studentId, tutor_id: tutorId, starts_at: p.starts_at, ends_at: p.ends_at },
      list ?? [],
      { ignoreIds },
    ),
  })).filter((x) => x.clashes.length);

  const total = planned?.length ?? 0;
  if (!per.length) return { total, count: 0, title: null, lines: [] };

  const many = total > 1;
  const refDay = dayKey(planned[0].starts_at);
  const all = [];
  for (const { p, clashes } of per) {
    for (const c of clashes) {
      const line = clashLine(c, { tutorNames, studentNames, viewerInZone });
      all.push(many ? `${shortDayText(dayKey(p.starts_at), refDay)}: ${line}` : line);
    }
  }
  const lines = all.slice(0, MAX_CLASH_LINES);
  if (all.length > lines.length) lines.push(`And ${all.length - lines.length} more.`);
  return {
    total,
    count: per.length,
    title: many ? `${per.length} of ${total} dates clash` : 'This time overlaps another session',
    lines,
  };
}
