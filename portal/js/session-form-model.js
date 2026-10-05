// Pure logic behind the session drawer and its forms (session-drawer.js,
// session-form.js). No DOM. Times are Pacific wall times (dates.js), with the
// rules in sessions-model.js (validateSessionForm, weeklyTimes, retimeRows).
//
// A form "state" is the raw field values:
//   { date, start, end, subject, where ('in-person' | 'online'), location,
//     meeting_url, notes, repeat, ends ('never' | 'on' | 'after'), until, count }
//
// A weekly repeat works like Google Calendar's: by default it never ends (a
// tutor or admin ends it with "this and following"), or it ends on a date or
// after a number of sessions. The database keeps it filled a year ahead
// (supabase/migrations/20261009120000_session_series.sql).

import {
  addMinutesToTime, validateSessionForm, weeklyTimes, retimeRows, newSeriesId,
  findClashes, timeRange, shortDayText, timeInput, isCancelled, durationMinutes, durationText,
} from './sessions-model.js';
import { dayKey, todayKey, parseKey, addDays, longDate, daysBetween } from './dates.js';

export const QUICK_DURATIONS = Object.freeze([30, 45, 60, 90, 120]);
export const DEFAULT_START = '16:00';
export const DEFAULT_MINUTES = 60;
export const DEFAULT_COUNT = 8;
export const MIN_REPEAT_COUNT = 2;
export const MAX_REPEAT_COUNT = 520;  // ten years of weeks
export const ENDS = Object.freeze(['never', 'on', 'after']);
// How many weeks of a new repeat the clash check looks at
export const CLASH_WEEKS = 26;
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
    ends: 'never',
    until: '',
    count: String(DEFAULT_COUNT),
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
    ends: 'never',
    until: '',
    count: String(DEFAULT_COUNT),
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
    const myName = names.get(String(me.id)) || String(me.full_name ?? '').trim();
    return mine ? [{ value: String(me.id), label: myName ? `${myName} (you)` : 'You' }, ...others] : others;
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
  };
}

// validateSessionForm, plus how a repeat ends. values gain ends and until
// (the last day it may repeat on, or null for never): "after 8 sessions" is
// the day of the 8th. Errors for the end go under `until` or `count`.
export function checkSessionForm(state, { creating = true } = {}) {
  const result = validateSessionForm(rawFromState(state), { creating });
  const errors = { ...result.errors };
  const values = { ...result.values, ends: 'never', until: null };
  if (values.repeat) {
    const ends = ENDS.includes(state.ends) ? state.ends : 'never';
    values.ends = ends;
    if (ends === 'on') {
      const until = String(state.until ?? '').trim();
      if (!KEY_RE.test(until)) errors.until = 'Choose the last day.';
      else if (KEY_RE.test(values.date) && until <= values.date) errors.until = 'Choose a day after the first session.';
      else values.until = until;
    } else if (ends === 'after') {
      const n = Number(String(state.count ?? '').trim());
      if (!Number.isInteger(n) || n < MIN_REPEAT_COUNT || n > MAX_REPEAT_COUNT) {
        errors.count = `Enter ${MIN_REPEAT_COUNT} to ${MAX_REPEAT_COUNT} sessions.`;
      } else if (KEY_RE.test(values.date)) {
        values.until = addDays(values.date, (n - 1) * 7);
      }
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, values };
}

// The weekly dates a repeat makes, from values.date through values.until (or
// `limit` weeks when it never ends, or ends later), as day keys
export function repeatDates(values, limit = CLASH_WEEKS) {
  if (!KEY_RE.test(values?.date ?? '')) return [];
  const weeks = values.until && KEY_RE.test(values.until)
    ? Math.min(Math.floor(daysBetween(values.date, values.until) / 7) + 1, limit)
    : limit;
  return Array.from({ length: Math.max(weeks, 1) }, (_, i) => addDays(values.date, i * 7));
}

// The sessions a form would write, as [{ id?, starts_at, ends_at }]:
//   create          the one session, or the first CLASH_WEEKS of a repeat
//   edit, 'this'    the session
//   edit, following every row of `rows`, moved by the same number of days
export function plannedTimes(values, { session = null, rows = null, apply = 'this' } = {}) {
  if (!session) {
    const weeks = values.repeat ? repeatDates(values).length : 1;
    return weeklyTimes({ date: values.date, start: values.start, end: values.end, weeks });
  }
  if (apply === 'following' && rows?.length) return retimeRows(rows, session, values);
  const [t] = weeklyTimes({ date: values.date, start: values.start, end: values.end, weeks: 1 });
  return [{ id: session.id, ...t }];
}

// The row for one new session (not repeating)
export function buildInsertRow({ studentId, tutorId, values }) {
  const [t] = weeklyTimes({ date: values.date, start: values.start, end: values.end, weeks: 1 });
  return {
    student_id: studentId,
    tutor_id: tutorId,
    subject: values.subject,
    starts_at: t.starts_at,
    ends_at: t.ends_at,
    location: values.location,
    meeting_url: values.meeting_url,
    notes: values.notes,
    series_id: null,
  };
}

// The session_series row for a weekly repeat; the database makes its sessions
export function buildSeriesRow({ studentId, tutorId, values, id }) {
  return {
    id: id ?? newSeriesId(),
    student_id: studentId,
    tutor_id: tutorId,
    subject: values.subject,
    location: values.location,
    meeting_url: values.meeting_url,
    notes: values.notes,
    start_time: values.start,
    end_time: values.end,
    first_date: values.date,
    until: values.until ?? null,
  };
}

// The arguments of edit_following_sessions for an edit of `session` with
// "this and following": the days and minutes everything moves by, and the
// details that changed (only those, so a session planned on its own keeps its
// plan). null when nothing changed.
export function followingChange({ values, session }) {
  const p_shift = daysBetween(dayKey(session.starts_at), values.date);
  const p_start_delta = minutesOf(values.start) - minutesOf(timeInput(session.starts_at));
  const p_end_delta = minutesOf(values.end) - minutesOf(timeInput(session.ends_at));
  const p_fields = {};
  for (const k of TEXT_FIELDS) if (textOf(values[k]) !== textOf(session[k])) p_fields[k] = textOf(values[k]);
  if (!p_shift && !p_start_delta && !p_end_delta && !Object.keys(p_fields).length) return null;
  return { p_session: session.id, p_shift, p_start_delta, p_end_delta, p_fields };
}

function minutesOf(time) {
  const [h, m] = String(time).split(':').map(Number);
  return h * 60 + m;
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

// "Schedule session", "Schedule weekly sessions"
export function scheduleLabel(repeat = false) {
  return repeat ? 'Schedule weekly sessions' : 'Schedule session';
}

// "Tuesday" for a day key, or ''
export function weekdayName(key) {
  return KEY_RE.test(key ?? '') ? longDate(key).split(',')[0] : '';
}

// The Repeat select, Google Calendar's way: [{ value, label }]
export function repeatChoices(date) {
  const day = weekdayName(date);
  return [
    { value: 'none', label: 'Does not repeat' },
    { value: 'weekly', label: day ? `Weekly on ${day}` : 'Weekly' },
  ];
}

// What to tell a tutor when a write fails. Row security (42501) means the
// tutor is not linked to the student; a check violation (23514) is a bad time.
export function saveErrorText(error) {
  // The billing guard (sessions_guard) explains itself
  if (error?.code === 'VP002') return `${String(error.message ?? '').replace(/\.?$/, '.')}`;
  if (error?.code === '42501') return 'You can only schedule sessions for students you tutor.';
  if (error?.code === '23514') return 'Check the times and details, then try again.';
  return 'Check your connection and try again.';
}

// "Session cancelled", "4 sessions cancelled"
export function sessionsToast(n, verb) {
  return n === 1 ? `Session ${verb}` : `${n} sessions ${verb}`;
}

// What a repeat will do, or '' when the form is not usable yet:
//   never  "Every Tuesday, with no end date"
//   on     "Every Tuesday through Tue, Dec 1, 7 sessions"
//   after  "8 weekly sessions, the last on Tue, Dec 8"
export function repeatSummary(state) {
  const check = checkSessionForm({ ...state, repeat: true });
  const { date, ends, until } = check.values;
  if (!KEY_RE.test(date ?? '') || check.errors.until || check.errors.count) return '';
  const day = weekdayName(date);
  if (ends === 'never' || !until) return `Every ${day}, with no end date`;
  const n = Math.floor(daysBetween(date, until) / 7) + 1;
  const last = addDays(date, (n - 1) * 7);
  if (ends === 'after') return `${n} weekly sessions, the last on ${shortDayText(last, date)}`;
  return `Every ${day} through ${shortDayText(until, date)}, ${n} ${n === 1 ? 'session' : 'sessions'}`;
}

// "Applies to 4 sessions, from Thu, Oct 15 on"
export function followingSummary(rows, session) {
  const n = rows.length;
  return `Applies to ${n} ${n === 1 ? 'session' : 'sessions'}, from ${shortDayText(dayKey(session.starts_at))} on`;
}

// "Repeats weekly, 4 more sessions": the series' scheduled sessions after this.
// rule: its session_series row when there is one; one with no end says so.
export function seriesLeftText(list, session, rule = null) {
  if (!session?.series_id) return null;
  const day = weekdayName(dayKey(session.starts_at));
  if (rule && !rule.until) return `Repeats every ${day}, with no end date`;
  // An end beyond what is made so far: name the day instead of counting
  if (rule?.until && (!rule.last_date || rule.last_date < rule.until)) return `Repeats every ${day} through ${shortDayText(rule.until, dayKey(session.starts_at))}`;
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

function clashTitle(count, total, partial) {
  if (partial) return `${count} ${count === 1 ? 'date' : 'dates'} in the next 6 months ${count === 1 ? 'clashes' : 'clash'}`;
  return total > 1 ? `${count} of ${total} dates clash` : 'This time overlaps another session';
}

// Whether a new repeat runs past the CLASH_WEEKS the clash check looks at
// (it never ends, or ends later)
export function clashCheckIsPartial(values) {
  if (!values?.repeat || !KEY_RE.test(values.date ?? '')) return false;
  if (!values.until) return true;
  return Math.floor(daysBetween(values.date, values.until) / 7) + 1 > CLASH_WEEKS;
}

// What to tell a tutor about overlaps, never blocking:
//   { total, count, title, lines }  title is null when nothing clashes.
// planned: [{ id?, starts_at, ends_at }] (plannedTimes); list: the student's
// sessions plus the tutor's; ignoreIds: the rows an edit replaces.
// partial: planned is only the first CLASH_WEEKS of a longer repeat
// (clashCheckIsPartial), so the title speaks of the next six months instead
// of "of 26", which would read as if only 26 sessions were made.
export function clashReport({
  planned, studentId, tutorId, list, ignoreIds = [], tutorNames, studentNames, viewerInZone, partial = false,
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
    title: clashTitle(per.length, total, partial),
    lines,
  };
}
