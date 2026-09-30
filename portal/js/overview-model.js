// Pure logic for the Overview views (spec 5.2 to 5.4): greetings, ledes, the
// Due next pick, the rolling week strip, the 30-day score window, progress
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

export const WINDOW_DAYS = 30;
export const WEEK_DAYS = 7;

const DAY = 86_400_000;
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));
const counted = (n, one_, many) => `${n} ${n === 1 ? one_ : many}`;
const verb = (n) => (n === 1 ? 'is' : 'are');
const isScore = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

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
// assignments-only week keeps the short wording.
export function studentLede({
  overdue = 0, dueThisWeek = 0, overdueTasks = 0, tasksDueThisWeek = 0, newGrades = 0,
} = {}) {
  const lateTotal = overdue + overdueTasks;
  const dueTotal = dueThisWeek + tasksDueThisWeek;
  const late = kindList(overdue, overdueTasks);
  const due = kindList(dueThisWeek, tasksDueThisWeek);
  const plain = overdueTasks === 0 && tasksDueThisWeek === 0;
  let text;
  if (lateTotal > 0 && dueTotal > 0) {
    if (plain) text = `${late} ${verb(lateTotal)} overdue and ${dueTotal} ${verb(dueTotal)} due this week.`;
    // Both kinds on one side would stack two "and"s: two sentences instead
    else if (late.includes(' and ') || due.includes(' and ')) {
      text = `${late} ${verb(lateTotal)} overdue. ${due} ${verb(dueTotal)} due this week.`;
    } else text = `${late} ${verb(lateTotal)} overdue and ${due} ${verb(dueTotal)} due this week.`;
  } else if (lateTotal > 0) {
    text = `${late} ${verb(lateTotal)} overdue.`;
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

// Parent lede, worded by kind:
// "Maya has 2 assignments due this week and 1 overdue."
// "Maya has 2 assignments due this week and 1 overdue task."
export function parentSummary(firstName, {
  overdue = 0, dueThisWeek = 0, overdueTasks = 0, tasksDueThisWeek = 0,
} = {}) {
  const name = String(firstName ?? '').trim() || 'Your child';
  const plural = (n, one_, many) => (n === 1 ? one_ : many);
  if (overdueTasks === 0 && tasksDueThisWeek === 0) {
    if (overdue > 0 && dueThisWeek > 0) {
      return `${name} has ${counted(dueThisWeek, 'assignment', 'assignments')} due this week and ${overdue} overdue.`;
    }
    if (overdue > 0) return `${name} has ${overdue} overdue ${plural(overdue, 'assignment', 'assignments')}.`;
    if (dueThisWeek > 0) return `${name} has ${counted(dueThisWeek, 'assignment', 'assignments')} due this week.`;
    return `${name} is all caught up.`;
  }
  const late = [];
  if (overdue > 0) late.push(`${overdue} overdue ${plural(overdue, 'assignment', 'assignments')}`);
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

// Items whose latest attempt has a released grade, newest release first
export function gradedItems(items) {
  return (items ?? [])
    .filter((i) => isAssignment(i) && i.grade?.released_at && isScore(i.grade.score))
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
  todo: ['open', null],
  'not-turned-in': ['open', null],
  submitted: ['submitted', 'hourglass-medium'],
  grading: ['submitted', 'hourglass-medium'],
  'needs-attention': ['attention', 'x-circle'],
  failed: ['attention', 'x-circle'],
  draft: ['draft', 'pencil-simple-line'],
  edited: ['draft', 'pencil-simple-line'],
  graded: ['graded', 'check-circle'],
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
// Progress (only released grades ever count, for every role)

const mean = (list) => list.reduce((sum, g) => sum + Number(g.score), 0) / list.length;

// Released grades in the last 30 days against the 30 days before.
// avg and prevAvg are rounded; delta = avg - prevAvg (null without both);
// count is the grades in the current window; lastAt the newest release.
export function scoreWindow(grades, now = new Date(), { days = WINDOW_DAYS } = {}) {
  const t = ms(now);
  const span = days * DAY;
  const released = (grades ?? []).filter((g) => g?.released_at && isScore(g.score) && Number.isFinite(ms(g.released_at)));
  const age = (g) => t - ms(g.released_at);
  const current = released.filter((g) => age(g) <= span);
  const previous = released.filter((g) => age(g) > span && age(g) <= 2 * span);
  const avg = current.length ? Math.round(mean(current)) : null;
  const prevAvg = previous.length ? Math.round(mean(previous)) : null;
  const newest = released.reduce((best, g) => (!best || ms(g.released_at) > ms(best) ? g.released_at : best), null);
  return {
    avg,
    prevAvg,
    delta: avg !== null && prevAvg !== null ? avg - prevAvg : null,
    count: current.length,
    total: released.length,
    lastAt: newest,
  };
}

// "Up 4 from the 30 days before" / "Down 3 ..." / "Same as the 30 days before"
export function trendText(delta) {
  if (delta > 0) return `Up ${delta} from the 30 days before`;
  if (delta < 0) return `Down ${-delta} from the 30 days before`;
  return 'Same as the 30 days before';
}

// Metric wording. Each returns { value, suffix, isText, line, trend, danger }.

export function averageMetric(grades, now = new Date()) {
  const w = scoreWindow(grades, now);
  if (!w.total) return { value: 'No grades yet', suffix: null, isText: true, line: null, trend: null, danger: false };
  if (!w.count) {
    return { value: 'None this month', suffix: null, isText: true, line: `Last grade ${shortDay(w.lastAt, now)}`, trend: null, danger: false };
  }
  if (w.delta !== null) {
    const trend = w.delta > 0 ? 'up' : w.delta < 0 ? 'down' : null;
    return { value: String(w.avg), suffix: null, isText: false, line: trendText(w.delta), trend, danger: false };
  }
  return { value: String(w.avg), suffix: null, isText: false, line: `Based on ${counted(w.count, 'grade', 'grades')}`, trend: null, danger: false };
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
