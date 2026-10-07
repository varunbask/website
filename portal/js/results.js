// Grade results. A tutor marks each piece of homework with a result instead of
// a score out of 100:
//   completed  the work was done
//   missing    nothing usable was handed in
//   extended   more time: the assignment goes back to To do with a new due
//              date, and the student may hand it in again
// This file names the results, reads one off a grade, works out an
// extension's new due date, and counts completion for every progress figure
// (Overview, Students, the Progress report, a parent's child summary), so
// they all agree. Pure: no DOM, no network.

import { one } from './format.js';
import { businessTime, zonedIso, parseKey } from './dates.js';

export const RESULTS = Object.freeze(['completed', 'missing', 'extended']);
export const RESULT_LABELS = Object.freeze({ completed: 'Completed', missing: 'Missing', extended: 'Extended' });

const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));
const validTime = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(ms(v));
const pad = (n) => String(n).padStart(2, '0');
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// 'completed' | 'missing' | 'extended' from a grade row (or its embed), else null
export function resultOf(grade) {
  const r = one(grade)?.result;
  return RESULTS.includes(r) ? r : null;
}

// "Completed", or null for anything that is not a result
export function resultLabel(result) {
  return RESULT_LABELS[result] ?? null;
}

// ---------------------------------------------------------------------------
// Extensions

export const EXTEND_DATE_ERROR = 'Choose the new due date.';
export const EXTEND_PAST_ERROR = 'Choose a new due date that is still ahead.';

// A real calendar day 'YYYY-MM-DD' (not Feb 30)
function isDayKey(key) {
  if (!KEY_RE.test(key)) return false;
  const { y, m, d } = parseKey(key);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// The due_at for an extension to a day: the assignment's own due time of day
// (Pacific) is kept; without one it is 11:59 pm Pacific, as everywhere else.
// null when the day is not a date.
export function extendedDueAt(dateKey, currentDueAt = null) {
  const key = String(dateKey ?? '').trim();
  if (!isDayKey(key)) return null;
  let time = '23:59';
  if (validTime(currentDueAt)) {
    const { hour, minute } = businessTime(currentDueAt);
    time = `${pad(hour)}:${pad(minute)}`;
  }
  return zonedIso(key, time);
}

// "11:59 pm": the Pacific time of day an extension keeps
export function extensionTimeText(currentDueAt = null) {
  const { hour, minute } = validTime(currentDueAt) ? businessTime(currentDueAt) : { hour: 23, minute: 59 };
  return `${hour % 12 || 12}:${pad(minute)} ${hour < 12 ? 'am' : 'pm'}`;
}

// Checks a new due date for an extension: { ok, dueAt, error }. It must be a
// date, and the new due time on it must still be ahead of now.
export function checkExtension(dateKey, currentDueAt = null, now = new Date()) {
  const key = String(dateKey ?? '').trim();
  const dueAt = key ? extendedDueAt(key, currentDueAt) : null;
  if (!dueAt) return { ok: false, dueAt: null, error: EXTEND_DATE_ERROR };
  if (ms(dueAt) <= ms(now)) return { ok: false, dueAt: null, error: EXTEND_PAST_ERROR };
  return { ok: true, dueAt, error: null };
}

// The task columns an extension writes: the new due_at, and extended_from,
// which keeps the original due date from the first extension on
export function extensionChanges(task, dueAt) {
  return { due_at: dueAt, extended_from: task?.extended_from ?? task?.due_at ?? null };
}

// ---------------------------------------------------------------------------
// Completion

// Newest attempt first; on a tie the higher id first
const newestFirst = (subs) => [...(subs ?? [])].sort((a, b) =>
  (ms(b.created_at) - ms(a.created_at)) || (Number(b.id) - Number(a.id)));

// How one assignment counts: { result, at, extended }.
//   result 'completed' | 'missing', decided at `at` (the release, or the due
//          date for work that never came in), or null while undecided: not
//          due yet, waiting for review, or on an extension
//   extended  true while an extension is still running
// The latest released result on the assignment decides. A released Extended
// waits: if nothing newer comes in by the new due date, it counts as missing
// then. An assignment past due with nothing handed in counts as missing.
export function assignmentOutcome(task, subs, now = new Date()) {
  const undecided = { result: null, at: null, extended: false };
  if (!task || task.kind === 'task') return undecided;
  const list = newestFirst(subs);
  const pastDue = validTime(task.due_at) && ms(task.due_at) < ms(now);
  const decided = list.findIndex((s) => one(s.grade)?.released_at && resultOf(s.grade));
  if (decided !== -1) {
    const grade = one(list[decided].grade);
    const result = resultOf(grade);
    if (result !== 'extended') return { result, at: grade.released_at, extended: false };
    if (decided > 0) return undecided;               // handed in again since
    return pastDue ? { result: 'missing', at: task.due_at, extended: false } : { ...undecided, extended: true };
  }
  if (list.length) return undecided;                 // waiting for review
  if (pastDue) return { result: 'missing', at: task.due_at, extended: false };
  return { ...undecided, extended: Boolean(task.extended_from) };
}

// Completion over a student's assignments (tasks are left out):
//   { completed, missing, total, rate, extended }
//   total     completed + missing: the base. Extended and undecided work wait.
//   rate      completed / total, or null when total is 0
//   extended  assignments on an extension right now (not counted yet)
// within(at), when given, keeps only results decided at those times (a
// 30-day window, a report period); it never limits `extended`.
export function completionCounts(tasks, submissions, now = new Date(), { within = null } = {}) {
  const byTask = new Map();
  for (const sub of submissions ?? []) {
    if (!sub) continue;
    const key = String(sub.task_id);
    if (!byTask.has(key)) byTask.set(key, []);
    byTask.get(key).push(sub);
  }
  const out = { completed: 0, missing: 0, total: 0, rate: null, extended: 0 };
  for (const task of tasks ?? []) {
    if (!task || task.kind === 'task') continue;
    const o = assignmentOutcome(task, byTask.get(String(task.id)), now);
    if (o.extended) out.extended += 1;
    if (!o.result || (within && !within(o.at))) continue;
    out[o.result] += 1;
  }
  out.total = out.completed + out.missing;
  out.rate = out.total ? out.completed / out.total : null;
  return out;
}

// "8 of 10"
export function completionText({ completed = 0, total = 0 } = {}) {
  return `${completed} of ${total}`;
}

// "80%", or null without a rate
export function rateText(rate) {
  return rate === null || rate === undefined ? null : `${Math.round(rate * 100)}%`;
}
