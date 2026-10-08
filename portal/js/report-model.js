// Pure logic for the Progress report (#/report): the reporting period, session
// attendance, homework outcomes, released results, session notes, and the
// tutors and subjects named in the header. No DOM, no network.
//
// Days are business-zone day keys (dates.js), the same zone every other date in
// the portal uses. A period always ends today and its start day is included, so
// "Last 30 days" is today and the 29 days before it.
//
// What the report counts (the view words these, see views/report.js):
//   Sessions   starting in the period. Cancelled ones are counted as cancelled.
//              Held means not cancelled and already over. Attended is held with
//              attendance present or late, absent is held with attendance absent,
//              unrecorded is held with no attendance yet. Hours add up the
//              attended sessions only.
//   Homework   assignments and tasks DUE in the period (an item with no due
//              date counts when it was created in the period). On time: finished
//              by the due date. Late: finished after it. Missing: past due and
//              not finished. Open: not finished and not due yet (later today).
//              An assignment is finished by its first submission; a task by its
//              tick (tasks.completed_at).
//   Results    Completed and Missing per assignment, by completionCounts in
//              results.js (the same rule as the Overview and Students): the
//              latest released result, or missing once past due with nothing
//              handed in, counted when that was decided in the period. Only
//              released results count, for every viewer. Extended work is
//              counted apart until its new due date passes.
//   Notes      the recap of each finished, not cancelled session in the period.

import { dayKey, todayKey, addDays, parseKey, daysBetween } from './dates.js';
import { one } from './format.js';
import { resultOf, completionCounts } from './results.js';
import { sessionTitle, durationMinutes, shortDayText, isCancelled } from './sessions-model.js';
import { sortSubs } from './buckets.js';

export const PERIODS = Object.freeze([
  Object.freeze({ key: '30d', label: 'Last 30 days', days: 30 }),
  Object.freeze({ key: '90d', label: 'Last 90 days', days: 90 }),
  Object.freeze({ key: 'year', label: 'This school year', days: null }),
]);
export const DEFAULT_PERIOD = '30d';
// The school year starts on August 1
export const SCHOOL_YEAR_START_MONTH = 8;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));
const validTime = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(ms(v));
const blank = (v) => v === null || v === undefined || String(v).trim() === '';

// The business-zone day of a timestamp, or null when it is missing or not a date
function dayOf(value) {
  return validTime(value) ? dayKey(value) : null;
}

// ---------------------------------------------------------------------------
// Period

// An unknown or missing value falls back to the default period
export function normalizePeriod(value) {
  return typeof value === 'string' && PERIODS.some((p) => p.key === value) ? value : DEFAULT_PERIOD;
}

// The August 1 that began the school year containing the day key
export function schoolYearStart(today) {
  const { y, m } = parseKey(today);
  const year = m >= SCHOOL_YEAR_START_MONTH ? y : y - 1;
  return `${String(year).padStart(4, '0')}-${String(SCHOOL_YEAR_START_MONTH).padStart(2, '0')}-01`;
}

// "Oct 6, 2026"
export function dayText(key) {
  const { y, m, d } = parseKey(key);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// "Sep 7 to Oct 6, 2026", or with both years when they differ
export function rangeText(start, end) {
  const a = parseKey(start);
  const b = parseKey(end);
  if (start === end) return dayText(start);
  if (a.y !== b.y) return `${dayText(start)} to ${dayText(end)}`;
  return `${MONTHS[a.m - 1]} ${a.d} to ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
}

// { key, label, start, end, days, text } with start and end as day keys
export function reportPeriod(value, now = new Date()) {
  const key = normalizePeriod(value);
  const def = PERIODS.find((p) => p.key === key);
  const end = todayKey(now);
  const start = def.days ? addDays(end, -(def.days - 1)) : schoolYearStart(end);
  return { key, label: def.label, start, end, days: daysBetween(start, end) + 1, text: rangeText(start, end) };
}

// Is the timestamp's business-zone day inside the period (both ends included)?
export function inPeriod(value, period) {
  const key = dayOf(value);
  return key !== null && key >= period.start && key <= period.end;
}

// ---------------------------------------------------------------------------
// Sessions

const attended = (s) => s.attendance === 'present' || s.attendance === 'late';

// Counts and hours for the sessions that start in the period. A session that has
// not ended yet (later today, or under way) is neither held nor cancelled.
// attendancePercent is attended out of the sessions with attendance recorded
// (attended plus absent), or null when none were recorded.
export function sessionSummary(sessions, period, now = new Date()) {
  const t = ms(now);
  const out = {
    held: 0, attended: 0, late: 0, absent: 0, unrecorded: 0, cancelled: 0, total: 0, minutes: 0, hours: 0, attendancePercent: null,
  };
  for (const s of sessions ?? []) {
    if (!s || !validTime(s.starts_at) || !validTime(s.ends_at) || !inPeriod(s.starts_at, period)) continue;
    if (isCancelled(s)) {
      out.cancelled += 1;
      continue;
    }
    if (ms(s.ends_at) > t) continue;
    out.held += 1;
    if (attended(s)) {
      out.attended += 1;
      if (s.attendance === 'late') out.late += 1;
      out.minutes += Math.max(0, durationMinutes(s));
    } else if (s.attendance === 'absent') {
      out.absent += 1;
    } else {
      out.unrecorded += 1;
    }
  }
  out.total = out.held + out.cancelled;
  out.hours = Math.round(out.minutes / 6) / 10;
  const recorded = out.attended + out.absent;
  out.attendancePercent = recorded ? Math.round((out.attended / recorded) * 100) : null;
  return out;
}

// ---------------------------------------------------------------------------
// Homework

// When the work was finished (ms), or null. An assignment is finished by its
// first submission (the database stamps tasks.completed_at with that time, but
// the app never reads it for assignments); a task by its tick. An assignment
// whose latest attempt was released as Extended is back in To do: not finished.
function finishedAt(task, subs) {
  if (task.kind === 'task') return validTime(task.completed_at) ? ms(task.completed_at) : null;
  const latest = sortSubs(subs)[0];
  if (latest && one(latest.grade)?.released_at && resultOf(latest.grade) === 'extended') return null;
  let first = null;
  for (const sub of subs ?? []) {
    if (!validTime(sub.created_at)) continue;
    const t = ms(sub.created_at);
    if (first === null || t < first) first = t;
  }
  return first;
}

// The timestamp that puts a task in a period: dated work belongs to the period
// it was due in, undated work to the one it was created in
function homeworkAnchor(task) {
  return validTime(task.due_at) ? task.due_at : task.created_at;
}

// 'on-time' | 'late' | 'missing' | 'open' for one task and its submissions.
// Without a due date nothing can be late or missing: finished work is on time.
export function homeworkOutcome(task, subs, now = new Date()) {
  const done = finishedAt(task, subs);
  if (!validTime(task.due_at)) return done !== null ? 'on-time' : 'open';
  const due = ms(task.due_at);
  if (done !== null) return done <= due ? 'on-time' : 'late';
  return due < ms(now) ? 'missing' : 'open';
}

// { assigned, onTime, late, missing, open, completed } for the items in the period
export function homeworkSummary(tasks, submissions, period, now = new Date()) {
  const byTask = new Map();
  for (const sub of submissions ?? []) {
    const key = String(sub.task_id);
    if (!byTask.has(key)) byTask.set(key, []);
    byTask.get(key).push(sub);
  }
  const out = { assigned: 0, onTime: 0, late: 0, missing: 0, open: 0, completed: 0 };
  for (const task of tasks ?? []) {
    if (!task) continue;
    if (!inPeriod(homeworkAnchor(task), period)) continue;
    out.assigned += 1;
    const outcome = homeworkOutcome(task, byTask.get(String(task.id)), now);
    if (outcome === 'on-time') out.onTime += 1;
    else if (outcome === 'late') out.late += 1;
    else if (outcome === 'missing') out.missing += 1;
    else out.open += 1;
  }
  out.completed = out.onTime + out.late;
  return out;
}

// ---------------------------------------------------------------------------
// Results (released ones only, for families and staff alike)

// { completed, missing, total, rate, extended } for results decided in the period
export function resultSummary(tasks, submissions, period, now = new Date()) {
  return completionCounts(tasks, submissions, now, { within: (at) => inPeriod(at, period) });
}

// Assignments in the period whose latest attempt has a result that is not
// released yet (an assignment belongs to the period as in homeworkSummary: by
// its due day, or its created day without a due date). Only staff ever load
// these (the database hides them from families), so the view can tell them what
// this report leaves out.
export function unreleasedCount(tasks, submissions, period) {
  const byTask = new Map();
  for (const sub of submissions ?? []) {
    const key = String(sub.task_id);
    if (!byTask.has(key)) byTask.set(key, []);
    byTask.get(key).push(sub);
  }
  let n = 0;
  for (const task of tasks ?? []) {
    if (!task || !inPeriod(homeworkAnchor(task), period)) continue;
    const latest = sortSubs(byTask.get(String(task.id)))[0];
    const grade = one(latest?.grade);
    if (grade && resultOf(grade) && !grade.released_at) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Tutors, subjects and session notes

// Names of tutors by id from the student's tutor rows ({ tutor_id, full_name }),
// then the staff names map (staffNames()), then null
function nameFinder(tutors, names) {
  const own = new Map();
  for (const row of tutors ?? []) {
    if (!blank(row?.full_name)) own.set(String(row.tutor_id), row.full_name.trim());
  }
  return (id) => {
    const key = String(id);
    if (own.has(key)) return own.get(key);
    const fromNames = names?.get?.(key);
    return blank(fromNames) ? null : String(fromNames).trim();
  };
}

// Unique non-blank strings, case-insensitive, first spelling kept, in order
function uniqueText(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (blank(value)) continue;
    const text = String(value).trim();
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

const byText = (a, b) => a.localeCompare(b);

// The student's tutors and subjects for the header: the tutors linked now plus
// anyone who taught a session in the period. { tutors: [name], subjects: [name] },
// both sorted. A tutor whose name is unknown is left out.
export function reportPeople({ tutors = [], sessions = [], period, names = new Map() } = {}) {
  const nameOf = nameFinder(tutors, names);
  const taught = (sessions ?? []).filter((s) => s && !isCancelled(s) && inPeriod(s.starts_at, period));
  const ids = new Map();
  for (const row of tutors ?? []) ids.set(String(row.tutor_id), true);
  for (const s of taught) ids.set(String(s.tutor_id), true);
  return {
    tutors: uniqueText([...ids.keys()].map((id) => nameOf(id))).sort(byText),
    subjects: uniqueText([...(tutors ?? []).map((r) => r.subject), ...taught.map((s) => s.subject)]).sort(byText),
  };
}

// Recaps of the finished, not cancelled sessions in the period, oldest first:
// [{ id, day, dateText, subject, tutor, recap }]. subject falls back to
// "Tutoring session"; tutor is null when the name is unknown.
export function sessionNotes(sessions, period, { now = new Date(), tutors = [], names = new Map() } = {}) {
  const nameOf = nameFinder(tutors, names);
  const t = ms(now);
  const today = todayKey(now);
  return (sessions ?? [])
    .filter((s) => s && validTime(s.starts_at) && validTime(s.ends_at) && !isCancelled(s)
      && ms(s.ends_at) <= t && inPeriod(s.starts_at, period) && !blank(s.recap))
    .sort((a, b) => (ms(a.starts_at) - ms(b.starts_at)) || (Number(a.id) - Number(b.id)))
    .map((s) => {
      const day = dayKey(s.starts_at);
      return {
        id: s.id,
        day,
        dateText: shortDayText(day, today),
        subject: sessionTitle(s),
        tutor: nameOf(s.tutor_id),
        recap: String(s.recap).trim(),
      };
    });
}

// ---------------------------------------------------------------------------
// The whole report

// Everything the view draws, for one student and one period.
//   studentName   the name for the header
//   sessions      store.getSessions rows (null when they did not load)
//   tasks, submissions   store.getStudentData
//   tutors        store.getTutors rows ({ tutor_id, full_name, subject })
//   names         Map of staff ids to names (staffNames())
export function buildReport({
  studentName = '', sessions = [], tasks = [], submissions = [], tutors = [], names = new Map(), periodKey = DEFAULT_PERIOD, now = new Date(),
} = {}) {
  const period = reportPeriod(periodKey, now);
  return {
    studentName: String(studentName ?? '').trim(),
    period,
    preparedText: dayText(todayKey(now)),
    people: reportPeople({ tutors, sessions, period, names }),
    sessions: sessionSummary(sessions, period, now),
    homework: homeworkSummary(tasks, submissions, period, now),
    results: resultSummary(tasks, submissions, period, now),
    notes: sessionNotes(sessions, period, { now, tutors, names }),
    unreleased: unreleasedCount(tasks, submissions, period),
  };
}
