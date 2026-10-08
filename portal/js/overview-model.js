// Pure logic for the Overview views (spec 5.2 to 5.4): greetings, ledes, the
// Due next pick, the rolling week strip, the 30-day completion window, progress
// metric wording and the staff review order for one student. No DOM, no network.
//
// "This week" is always rolling: today plus the next 6 days, keyed in the
// business zone (dates.js). Ledes and the "Due this week" metric count open
// assignments and open tasks, the same items the Overdue and Coming up cards
// list.

import { todayKey, dayKey, addDays, parseKey, weekday, relativeTime, longDate, dayHeading } from './dates.js';
import { byDue } from './format.js';
import { itemStatus } from './status.js';
import { queueOrder, attemptInfo } from './review-model.js';
import { completionStats } from './progress.js';
import { resultOf, completionCounts } from './results.js';

export const WINDOW_DAYS = 30;
export const WEEK_DAYS = 7;

const DAY = 86_400_000;
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));
const counted = (n, one_, many) => `${n} ${n === 1 ? one_ : many}`;
const verb = (n) => (n === 1 ? 'is' : 'are');

// An item still waiting on the student: a To do assignment or an open task
export function isOpen(item) {
  if (item.task.kind === 'task') return !item.task.completed_at;
  return item.bucket === 'todo';
}

const isAssignment = (item) => item.task.kind !== 'task';

// ---------------------------------------------------------------------------
// Header copy

// "Good afternoon, Maya" by the viewer's local hour: morning 5:00 to 11:59,
// afternoon 12:00 to 16:59, evening otherwise
export function greeting(now = new Date(), name = '') {
  const hour = new Date(now).getHours();
  let part = 'evening';
  if (hour >= 5 && hour < 12) part = 'morning';
  else if (hour >= 12 && hour < 17) part = 'afternoon';
  const clean = String(name ?? '').trim();
  return clean ? `Good ${part}, ${clean}` : `Good ${part}`;
}

// "2 assignments and 1 task", "1 task", "3 assignments"
function kindList(assignments, tasks) {
  const parts = [];
  if (assignments > 0) parts.push(counted(assignments, 'assignment', 'assignments'));
  if (tasks > 0) parts.push(counted(tasks, 'task', 'tasks'));
  return parts.join(' and ');
}

// "a", "a and b", "a, b and c"
function joinAnd(parts) {
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// Student lede: the work sentence, then the new-grades sentence. Counts come
// from weekCounts; tasks are named only when there are some, so an
// assignments-only week keeps the short wording. An assignment past due with
// nothing handed in is missing; a task past due is overdue.
export function studentLede({
  overdue = 0, dueThisWeek = 0, overdueTasks = 0, tasksDueThisWeek = 0, newGrades = 0,
} = {}) {
  const lateParts = [];
  if (overdue > 0) lateParts.push(`${counted(overdue, 'assignment', 'assignments')} ${verb(overdue)} missing`);
  if (overdueTasks > 0) lateParts.push(`${counted(overdueTasks, 'task', 'tasks')} ${verb(overdueTasks)} overdue`);
  const late = lateParts.join(' and ');
  const dueTotal = dueThisWeek + tasksDueThisWeek;
  const due = kindList(dueThisWeek, tasksDueThisWeek);
  const plain = overdueTasks === 0 && tasksDueThisWeek === 0;
  let text;
  if (late && dueTotal > 0) {
    if (plain) text = `${late} and ${dueTotal} ${verb(dueTotal)} due this week.`;
    // Two "and"s in one sentence read badly: two sentences instead
    else if (lateParts.length > 1 || due.includes(' and ')) text = `${late}. ${due} ${verb(dueTotal)} due this week.`;
    else text = `${late} and ${due} ${verb(dueTotal)} due this week.`;
  } else if (late) {
    text = `${late}.`;
  } else if (dueTotal > 0) {
    text = `${due} ${verb(dueTotal)} due this week.`;
  } else {
    text = 'Nothing is due this week.';
  }
  if (newGrades > 0) {
    text += newGrades === 1 ? ' 1 new grade is ready.' : ` ${newGrades} new grades are ready.`;
  }
  return text;
}

// Parent lede, worded by kind (an assignment past due is missing, a task overdue):
// "Maya has 2 assignments due this week and 1 missing."
// "Maya has 2 assignments due this week and 1 overdue task."
export function parentSummary(firstName, {
  overdue = 0, dueThisWeek = 0, overdueTasks = 0, tasksDueThisWeek = 0,
} = {}) {
  const name = String(firstName ?? '').trim() || 'Your child';
  const plural = (n, one_, many) => (n === 1 ? one_ : many);
  if (overdueTasks === 0 && tasksDueThisWeek === 0) {
    if (overdue > 0 && dueThisWeek > 0) {
      return `${name} has ${counted(dueThisWeek, 'assignment', 'assignments')} due this week and ${overdue} missing.`;
    }
    if (overdue > 0) return `${name} has ${overdue} missing ${plural(overdue, 'assignment', 'assignments')}.`;
    if (dueThisWeek > 0) return `${name} has ${counted(dueThisWeek, 'assignment', 'assignments')} due this week.`;
    return `${name} is all caught up.`;
  }
  const late = [];
  if (overdue > 0) late.push(`${overdue} missing ${plural(overdue, 'assignment', 'assignments')}`);
  if (overdueTasks > 0) late.push(`${overdueTasks} overdue ${plural(overdueTasks, 'task', 'tasks')}`);
  const due = kindList(dueThisWeek, tasksDueThisWeek);
  if (!due) return `${name} has ${joinAnd(late)}.`;
  if (!late.length) return `${name} has ${due} due this week.`;
  // "2 assignments and 1 task due this week" already has an "and"
  if (due.includes(' and ')) return `${name} has ${due} due this week, plus ${joinAnd(late)}.`;
  return `${name} has ${joinAnd([`${due} due this week`, ...late])}.`;
}

// "Maya’s week"
export function parentTitle(firstName) {
  const name = String(firstName ?? '').trim();
  return name ? `${name}’s week` : 'This week';
}

// ---------------------------------------------------------------------------
// Counts and lists

// Open work, split by kind: overdue now, and due from today through
// today + 6 (business zone) but not overdue yet. The same sets the Overdue
// card (overdueItems with tasks) and Coming up (comingUp) list, so the lede,
// the "Due this week" metric and those cards always agree.
// { overdue, dueThisWeek } count assignments; overdueTasks and
// tasksDueThisWeek count tasks.
export function weekCounts(items, now = new Date()) {
  const today = todayKey(now);
  const last = addDays(today, WEEK_DAYS - 1);
  const counts = { overdue: 0, dueThisWeek: 0, overdueTasks: 0, tasksDueThisWeek: 0 };
  for (const item of items ?? []) {
    if (!isOpen(item)) continue;
    const task = !isAssignment(item);
    if (item.dueState === 'overdue') {
      counts[task ? 'overdueTasks' : 'overdue'] += 1;
    } else if (item.task.due_at) {
      const key = dayKey(item.task.due_at);
      if (key >= today && key <= last) counts[task ? 'tasksDueThisWeek' : 'dueThisWeek'] += 1;
    }
  }
  return counts;
}

// The Due next card: the first To do assignment by due date (oldest overdue
// first, then soonest, undated last) and up to two after it
export function dueNext(items) {
  const todo = (items ?? [])
    .filter((i) => isAssignment(i) && i.bucket === 'todo')
    .sort((a, b) => byDue(a.task, b.task));
  return { next: todo[0] ?? null, after: todo.slice(1, 3) };
}

// Open items that are overdue, oldest first. Assignments only unless tasks: true.
export function overdueItems(items, { tasks = false } = {}) {
  return (items ?? [])
    .filter((i) => isOpen(i) && i.dueState === 'overdue' && (tasks || isAssignment(i)))
    .sort((a, b) => byDue(a.task, b.task));
}

// Open items due from today through today + 6 that are not overdue yet,
// grouped by business-zone day: [{ key, heading, items }]
export function comingUp(items, now = new Date(), { days = WEEK_DAYS } = {}) {
  const today = todayKey(now);
  const last = addDays(today, days - 1);
  const groups = new Map();
  const open = (items ?? [])
    .filter((i) => isOpen(i) && i.task.due_at && i.dueState !== 'overdue')
    .sort((a, b) => byDue(a.task, b.task));
  for (const item of open) {
    const key = dayKey(item.task.due_at);
    if (key < today || key > last) continue;
    if (!groups.has(key)) groups.set(key, { key, heading: dayHeading(key, today), items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

// Open tasks, soonest first, undated last
export function openTasks(items, limit = 5) {
  return (items ?? [])
    .filter((i) => i.task.kind === 'task' && !i.task.completed_at)
    .sort((a, b) => byDue(a.task, b.task))
    .slice(0, limit);
}

// Items whose latest attempt was released as Completed or Missing, newest
// release first (a released Extended is back in To do instead)
export function gradedItems(items) {
  return (items ?? [])
    .filter((i) => isAssignment(i) && i.grade?.released_at && ['completed', 'missing'].includes(resultOf(i.grade)))
    .sort((a, b) => ms(b.grade.released_at) - ms(a.grade.released_at));
}

// The seven days of the week strip, starting today:
// [{ key, ym, weekday, day, month, isToday, items }]. Items are every
// non-archived item due that day; open work first, then by due time.
export function weekStrip(items, today) {
  const keys = Array.from({ length: WEEK_DAYS }, (_, i) => addDays(today, i));
  const byDay = new Map(keys.map((k) => [k, []]));
  for (const item of items ?? []) {
    if (!item.task.due_at || item.bucket === 'archived') continue;
    byDay.get(dayKey(item.task.due_at))?.push(item);
  }
  return keys.map((key) => {
    const { m, d } = parseKey(key);
    const list = byDay.get(key).sort((a, b) =>
      ((a.dueState === 'done') - (b.dueState === 'done')) || byDue(a.task, b.task));
    return {
      key,
      ym: key.slice(0, 7),
      weekday: WEEKDAYS_SHORT[weekday(key)],
      day: d,
      month: MONTHS_SHORT[m - 1],
      isToday: key === today,
      items: list,
    };
  });
}

// Accessible label for a strip day, worded like the calendar's day label:
// "Wednesday, October 14, today. 2 items: Algebra worksheet, overdue; Read chapter 3, done"
export function stripLabel(day, { audience = 'family' } = {}) {
  const head = `${longDate(day.key)}${day.isToday ? ', today' : ''}`;
  if (!day.items.length) return `${head}. Nothing due.`;
  const parts = day.items.map((i) => `${i.task.title || 'Untitled'}, ${itemStatus(i, { audience }).label.toLowerCase()}`);
  return `${head}. ${counted(day.items.length, 'item', 'items')}: ${parts.join('; ')}`;
}

// Chip look for an item on the week strip: { variant, icon }
const CHIP = {
  overdue: ['overdue', 'warning-circle'],
  soon: ['soon', null],
  extended: ['soon', 'clock'],
  todo: ['open', null],
  missing: ['attention', 'minus-circle'],
  submitted: ['submitted', 'hourglass-medium'],
  grading: ['submitted', 'hourglass-medium'],
  failed: ['attention', 'x-circle'],
  draft: ['draft', 'pencil-simple-line'],
  edited: ['draft', 'pencil-simple-line'],
  graded: ['graded', 'check-circle'],
  completed: ['graded', 'check-circle'],
  done: ['done', null],
};

export function chipStyle(item, { audience = 'family' } = {}) {
  const { key } = itemStatus(item, { audience });
  const [variant, glyph] = CHIP[key] ?? ['open', null];
  return { variant, icon: glyph ?? (item.task.kind === 'task' ? 'check-square' : 'clipboard-text') };
}

// ---------------------------------------------------------------------------
// Dates and text

// "Oct 5", or "Oct 5, 2025" when the year differs from now's (business zone)
export function shortDay(iso, now = new Date()) {
  if (!iso) return '';
  const key = dayKey(iso);
  const { y, m, d } = parseKey(key);
  const year = parseKey(todayKey(now)).y === y ? '' : `, ${y}`;
  return `${MONTHS_SHORT[m - 1]} ${d}${year}`;
}

// The first non-empty line of a block of text, trimmed
export function firstLine(text) {
  return String(text ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
}

// "Last update 2 days ago" for the newest update: { text, full, iso } or null
export function lastUpdateLabel(updates, now = new Date()) {
  const newest = (updates ?? [])
    .map((u) => u?.created_at)
    .filter((v) => v && Number.isFinite(ms(v)))
    .sort((a, b) => ms(b) - ms(a))[0];
  if (!newest) return null;
  const rel = relativeTime(newest, now);
  const when = rel.text === 'Just now' || rel.text === 'Yesterday' ? rel.text.toLowerCase() : rel.text;
  return { text: `Last update ${when}`, full: rel.full, iso: newest };
}

// ---------------------------------------------------------------------------
// Progress (only released results count, for every role, plus work never
// handed in; the rules are completionCounts in results.js)

// Completion over the last 30 days: the results decided in that window
// (released, or a due date that passed with nothing handed in).
// { completed, missing, total, rate, extended }
export function completionWindow(tasks, submissions, now = new Date(), { days = WINDOW_DAYS } = {}) {
  const t = ms(now);
  const span = days * DAY;
  return completionCounts(tasks, submissions, now, { within: (at) => t - ms(at) <= span });
}

// "2 missing", "Nothing missing", "2 missing, 1 extended"
function missingLine(missing, extended) {
  const head = missing > 0 ? `${missing} missing` : 'Nothing missing';
  return extended > 0 ? `${head}, ${extended} extended` : head;
}

// Metric wording. Each returns { value, suffix, isText, line, trend, danger }.

// "Completed, last 30 days": 8 of 10, "2 missing"
export function completionMetric(tasks, submissions, now = new Date()) {
  const all = completionCounts(tasks, submissions, now);
  const w = completionWindow(tasks, submissions, now);
  if (!all.total) {
    return {
      value: 'No results yet', suffix: null, isText: true,
      line: w.extended ? `${w.extended} extended` : null, trend: null, danger: false,
    };
  }
  if (!w.total) {
    return { value: 'None this month', suffix: null, isText: true, line: missingLine(0, w.extended), trend: null, danger: false };
  }
  return {
    value: String(w.completed), suffix: `of ${w.total}`, isText: false, line: missingLine(w.missing, w.extended), trend: null, danger: false,
  };
}

// tasks: raw task rows (due_at, completed_at); a first submission sets
// completed_at on an assignment, so this covers both kinds
export function onTimeMetric(tasks, now = new Date()) {
  const stats = completionStats(tasks ?? [], new Date(now));
  if (!stats.judged) return { value: 'Nothing due yet', suffix: null, isText: true, line: null, trend: null, danger: false };
  return { value: String(stats.onTime), suffix: `of ${stats.judged}`, isText: false, line: 'finished by the due date', trend: null, danger: false };
}

// Counts every open item (assignments and tasks), the same items Coming up
// and the Overdue card list
export function dueMetric({ overdue = 0, dueThisWeek = 0, overdueTasks = 0, tasksDueThisWeek = 0 } = {}) {
  const late = overdue + overdueTasks;
  return {
    value: String(dueThisWeek + tasksDueThisWeek),
    suffix: null,
    isText: false,
    line: late > 0 ? `${late} overdue` : 'Nothing overdue',
    trend: null,
    danger: late > 0,
  };
}

// ---------------------------------------------------------------------------
// Staff: one student's review queue (spec 5.8 order)

// The same order and attempt numbers as the Review queue and the review pager
// (review-model.js): Could not grade, then AI drafts, then edited but not
// released; oldest first within a group.
// [{ sub, attempt, total, newer }] where attempt counts the task's submissions
// oldest first and newer says a later submission exists for the task.
export function reviewEntries(subs) {
  const all = subs ?? [];
  return queueOrder(all).map((sub) => {
    const { n, total, newer } = attemptInfo(sub, all.filter((s) => String(s.task_id) === String(sub.task_id)));
    return { sub, attempt: n, total, newer };
  });
}
