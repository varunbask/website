// Repeating tasks and assignments: the rules behind the Repeat option in the
// item form and the series actions in the item drawer. No DOM here.
//
// A repeat makes every copy at once, each due on its own day (11:59 pm
// Pacific, like any due date), and the copies share tasks.series_id.
//
//   REPEATS                   the patterns: daily and weekly
//   repeatDueKeys(first, every, count)    the copies' due days
//   checkRepeat(raw)          { values, errors } for the form's repeat fields
//   repeatSummary(raw, kind)  "8 weekly assignments, the last due Tue, Dec 1"
//   seriesOf(tasks, task)     the task's series, in due order
//   followingInTaskSeries(tasks, task)  this copy and the ones after it
//   seriesPosition(tasks, task)         { n, total } or null
//   shiftedDueAt(iso, days)   a due date moved by whole days
//   seriesUpdates(...)        what "this and following" saves to each copy
//   groupUpdates(updates)     those updates as one request per distinct change

import { addDays, dayKey, daysBetween } from './dates.js';
import { dueDateToIso } from './format.js';
import { shortDayText } from './sessions-model.js';

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const REPEATS = Object.freeze({
  daily: Object.freeze({ days: 1, label: 'Every day', word: 'daily', max: 60, start: 7 }),
  weekly: Object.freeze({ days: 7, label: 'Every week', word: 'weekly', max: 26, start: 4 }),
});
export const MIN_REPEAT_COUNT = 2;

const nounFor = (kind, n) => `${kind === 'task' ? 'task' : 'assignment'}${n === 1 ? '' : 's'}`;
export const itemNoun = nounFor;

// The due days of every copy, the first one first
export function repeatDueKeys(firstKey, every, count) {
  const pattern = REPEATS[every];
  if (!pattern || !KEY_RE.test(firstKey ?? '')) return [];
  return Array.from({ length: count }, (_, i) => addDays(firstKey, i * pattern.days));
}

// raw: { repeat, every, count, due } as read from the form (count is the
// input's text). values.count is a whole number when there is no error.
export function checkRepeat({ repeat = false, every = 'weekly', count = '', due = '' } = {}) {
  const pattern = REPEATS[every] ? every : 'weekly';
  const values = { repeat: Boolean(repeat), every: pattern, count: null, due: KEY_RE.test(due ?? '') ? due : '' };
  const errors = {};
  if (!values.repeat) return { values, errors };
  if (!values.due) errors.due = 'Pick the first due date. Each copy is due on its own day after it.';
  const text = String(count ?? '').trim();
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  const max = REPEATS[pattern].max;
  if (!Number.isInteger(n) || n < MIN_REPEAT_COUNT || n > max) errors.count = `Repeat ${MIN_REPEAT_COUNT} to ${max} times.`;
  else values.count = n;
  return { values, errors };
}

// "8 weekly assignments, the last due Tue, Dec 1", or '' while the fields
// are not usable yet
export function repeatSummary(raw, kind = 'assignment') {
  const { values, errors } = checkRepeat({ ...raw, repeat: true });
  if (errors.due || errors.count) return '';
  const keys = repeatDueKeys(values.due, values.every, values.count);
  const last = keys[keys.length - 1];
  return `${values.count} ${REPEATS[values.every].word} ${nounFor(kind, values.count)}, the last due ${shortDayText(last, values.due)}`;
}

// The rows one insert creates: the item's values with each copy's due date
export function repeatRows(base, { every, count, due, seriesId }) {
  return repeatDueKeys(due, every, count).map((key) => ({ ...base, due_at: dueDateToIso(key), series_id: seriesId }));
}

const time = (iso) => (iso ? Date.parse(iso) : Infinity);

// The task's series, by due date (then id). The student must match too:
// series_id comes from the browser. A task outside a series is alone.
export function seriesOf(tasks, task) {
  if (!task?.series_id) return task ? [task] : [];
  return (tasks ?? [])
    .filter((t) => t.series_id === task.series_id && String(t.student_id) === String(task.student_id))
    .sort((a, b) => time(a.due_at) - time(b.due_at) || Number(a.id) - Number(b.id));
}

// This copy and the ones after it in the series
export function followingInTaskSeries(tasks, task) {
  const list = seriesOf(tasks, task);
  const at = list.findIndex((t) => String(t.id) === String(task?.id));
  return at === -1 ? (task ? [task] : []) : list.slice(at);
}

// Where the copy sits: { n: 3, total: 8 }, or null outside a series of two or more
export function seriesPosition(tasks, task) {
  const list = seriesOf(tasks, task);
  if (list.length < 2) return null;
  const at = list.findIndex((t) => String(t.id) === String(task.id));
  return at === -1 ? null : { n: at + 1, total: list.length };
}

// "3 of 8"
export function seriesText(position) {
  return position ? `${position.n} of ${position.total}` : '';
}

// A due date moved by whole days, still due at 11:59 pm Pacific
export function shiftedDueAt(iso, days) {
  if (!iso) return null;
  return dueDateToIso(addDays(dayKey(iso), days));
}

// "Applies to 5 assignments, from Thu, Oct 15 on"
export function followingText(rows, task) {
  const n = rows.length;
  const from = task?.due_at ? `, from ${shortDayText(dayKey(task.due_at))} on` : '';
  return `Applies to ${n} ${nounFor(task?.kind, n)}${from}`;
}

// What saving an edit writes, as [{ id, values }]. apply 'this' changes only
// this copy. 'following' gives every copy from this one on the new title and
// instructions, and moves their due dates by as many days as this one moved
// (clearing this one's due date clears theirs; giving this one its first due
// date moves no others). A copy's due_at is sent only when it changes, so the
// copies that keep theirs share one update.
export function seriesUpdates({ task, rows, values, apply = 'this' }) {
  if (apply !== 'following' || !rows?.length) return [{ id: task.id, values }];
  const before = task.due_at ? dayKey(task.due_at) : null;
  const after = values.due_at ? dayKey(values.due_at) : null;
  const moved = before && after ? daysBetween(before, after) : 0;
  return rows.map((row) => {
    if (String(row.id) === String(task.id)) return { id: row.id, values };
    const next = { title: values.title, details: values.details };
    if (before && !after && row.due_at) next.due_at = null;
    else if (moved && row.due_at) next.due_at = shiftedDueAt(row.due_at, moved);
    return { id: row.id, values: next };
  });
}

// The updates grouped by what they write: [{ ids, values }], one request each
export function groupUpdates(updates) {
  const groups = new Map();
  for (const u of updates) {
    const key = JSON.stringify(u.values);
    if (!groups.has(key)) groups.set(key, { ids: [], values: u.values });
    groups.get(key).ids.push(u.id);
  }
  return [...groups.values()];
}
