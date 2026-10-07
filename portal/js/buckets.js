// Pure assignment and task derivation: which list an item belongs to, its due
// state, and the groups and counts every list, badge and overview reads.
// Elapsed thresholds are durations in ms; day grouping uses business-zone keys.

import { byDue, one } from './format.js';
import { DUE_SOON_HOURS, dayKey, todayKey, addDays, monthTitle } from './dates.js';
import { staffStatus } from './labels.js';
import { resultOf } from './results.js';

export { DUE_SOON_HOURS };
export const ARCHIVE_GRADED_AFTER_DAYS = 21;
export const ARCHIVE_MISSED_AFTER_DAYS = 30;
export const MAX_SUBMISSIONS = 5;
export const DONE_RECENT_DAYS = 14;
export const GRADED_RECENT_DAYS = 7;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));

// Newest first by created_at; on a tie the higher id first. Returns a new array.
export function sortSubs(subs) {
  return [...(subs ?? [])].sort((a, b) =>
    (ms(b.created_at) - ms(a.created_at)) || (Number(b.id) - Number(a.id)));
}

const gradeOf = (sub) => one(sub?.grade);
const releasedAt = (sub) => gradeOf(sub)?.released_at ?? null;

// The attempt was released as Extended: the assignment is open again, due on
// its new date, as if nothing had been handed in yet
const extendedOpen = (sub) => Boolean(sub && releasedAt(sub) && resultOf(gradeOf(sub)) === 'extended');

// Nothing (or only an extended attempt) and more than 30 days past due
const missedLongAgo = (task, t) => Boolean(task.due_at) && t - ms(task.due_at) > ARCHIVE_MISSED_AFTER_DAYS * DAY;

// 'todo' | 'in-review' | 'graded' | 'archived' for assignments, 'task' for tasks.
// completed_at is ignored for assignments. A released Extended puts the
// assignment back in To do until the student hands in again.
export function bucketOf(task, subs, now) {
  if (task.kind === 'task') return 'task';
  const t = ms(now);
  const latest = sortSubs(subs)[0];
  if (!latest || extendedOpen(latest)) return missedLongAgo(task, t) ? 'archived' : 'todo';
  const released = releasedAt(latest);
  if (!released) return 'in-review';
  return t - ms(released) > ARCHIVE_GRADED_AFTER_DAYS * DAY ? 'archived' : 'graded';
}

// 'missed' | 'graded' for archived assignments, otherwise null
export function archiveReason(task, subs, now) {
  if (bucketOf(task, subs, now) !== 'archived') return null;
  const latest = sortSubs(subs)[0];
  return latest && !extendedOpen(latest) ? 'graded' : 'missed';
}

// Whether an assignment is on an extension: its latest attempt was released as
// Extended, or (nothing handed in yet) staff moved its due date with Extend
export function isExtended(task, subs) {
  if (task.kind === 'task') return false;
  const latest = sortSubs(subs)[0];
  return latest ? extendedOpen(latest) : Boolean(task.extended_from);
}

// 'done' | 'undated' | 'overdue' | 'soon' | 'upcoming'
export function dueState(task, subs, now) {
  const done = task.kind === 'task'
    ? Boolean(task.completed_at)
    : (subs ?? []).length > 0 && !extendedOpen(sortSubs(subs)[0]);
  if (done) return 'done';
  if (!task.due_at) return 'undated';
  const left = ms(task.due_at) - ms(now);
  if (left < 0) return 'overdue';
  if (left <= DUE_SOON_HOURS * HOUR) return 'soon';
  return 'upcoming';
}

// Copies each submission with its grade normalized; families never keep an
// unreleased grade, even if one slipped past RLS.
function cleanSubs(subs, audience) {
  return sortSubs(subs).map((sub) => {
    const grade = gradeOf(sub);
    const keep = audience === 'family' ? (grade?.released_at ? grade : null) : grade;
    return { ...sub, grade: keep };
  });
}

// One Item per task: { task, subs, latest, grade, previousResult, bucket,
// archiveReason, dueState, extended, attempts, canSubmit }. previousResult is
// the result of an earlier released attempt while the latest one waits for
// review. `canSubmit` says whether the viewer may submit at all (students);
// items then allow it under the cap.
export function deriveItems(tasks, subs, now, { audience = 'family', canSubmit = false } = {}) {
  const byTask = new Map();
  for (const sub of subs ?? []) {
    if (!byTask.has(sub.task_id)) byTask.set(sub.task_id, []);
    byTask.get(sub.task_id).push(sub);
  }
  return (tasks ?? []).map((task) => {
    const own = cleanSubs(byTask.get(task.id), audience);
    const latest = own[0] ?? null;
    const grade = latest?.grade ?? null;
    const earlierReleased = grade?.released_at ? null : own.slice(1).find((s) => s.grade?.released_at);
    const isAssignment = task.kind !== 'task';
    return {
      task,
      subs: own,
      latest,
      grade,
      previousResult: earlierReleased ? resultOf(earlierReleased.grade) : null,
      bucket: bucketOf(task, own, now),
      archiveReason: archiveReason(task, own, now),
      dueState: dueState(task, own, now),
      extended: isExtended(task, own),
      attempts: own.length,
      canSubmit: Boolean(canSubmit) && isAssignment && own.length < MAX_SUBMISSIONS,
    };
  });
}

const byTaskDue = (a, b) => byDue(a.task, b.task);
const omitEmpty = (groups) => groups.filter((g) => g.items.length);

// Overdue, Today, Next 7 days, Later, No due date (shared by To do and open
// tasks). An assignment past due with nothing handed in is Missing, so To do
// names its first group that.
function groupByDue(items, now, { overdueLabel = 'Overdue' } = {}) {
  const today = todayKey(now);
  const lastWeekDay = addDays(today, 6);
  const groups = {
    overdue: { key: 'overdue', label: overdueLabel, items: [], collapsed: false },
    today: { key: 'today', label: 'Today', items: [], collapsed: false },
    next7: { key: 'next7', label: 'Next 7 days', items: [], collapsed: false },
    later: { key: 'later', label: 'Later', items: [], collapsed: false },
    undated: { key: 'undated', label: 'No due date', items: [], collapsed: true },
  };
  for (const item of [...items].sort(byTaskDue)) {
    const due = item.task.due_at;
    let key;
    if (!due) key = 'undated';
    else if (ms(due) < ms(now)) key = 'overdue';
    else {
      const k = dayKey(due);
      if (k === today) key = 'today';
      else if (k <= lastWeekDay) key = 'next7';
      else key = 'later';
    }
    groups[key].items.push(item);
  }
  return omitEmpty(Object.values(groups));
}

export function groupTodo(items, now) {
  return groupByDue(items.filter((i) => i.bucket === 'todo'), now, { overdueLabel: 'Missing' });
}

// Staff partition of in-review work, keyed by staffStatus of the latest attempt
const STAFF_GROUP = { 'Could not grade': 'failed', 'AI draft': 'draft', 'Edited, not released': 'edited', Submitted: 'grading', Grading: 'grading' };
const ACTIONABLE = new Set(['failed', 'draft', 'edited']);
const staffGroupOf = (item) => STAFF_GROUP[staffStatus(item.latest, item.grade).text] ?? null;
const subTime = (item) => ms(item.latest?.created_at);

// Could not grade, Ready for review, Edited not released, Grading now; oldest first
export function groupInReviewStaff(items) {
  const groups = [
    { key: 'failed', label: 'Could not grade', items: [], collapsed: false },
    { key: 'draft', label: 'Ready for review', items: [], collapsed: false },
    { key: 'edited', label: 'Edited, not released', items: [], collapsed: false },
    { key: 'grading', label: 'Grading now', items: [], collapsed: true },
  ];
  const inReview = items.filter((i) => i.bucket === 'in-review').sort((a, b) => subTime(a) - subTime(b));
  for (const item of inReview) groups.find((g) => g.key === staffGroupOf(item))?.items.push(item);
  return omitEmpty(groups);
}

// Families see one flat list, newest submission first
export function inReviewFamily(items) {
  return items.filter((i) => i.bucket === 'in-review').sort((a, b) => subTime(b) - subTime(a));
}

const releaseTime = (item) => ms(item.grade?.released_at);

// This week (released within 7 days), Earlier; newest release first
export function groupGraded(items, now) {
  const t = ms(now);
  const graded = items.filter((i) => i.bucket === 'graded').sort((a, b) => releaseTime(b) - releaseTime(a));
  const recent = (i) => t - releaseTime(i) <= GRADED_RECENT_DAYS * DAY;
  return omitEmpty([
    { key: 'week', label: 'This week', items: graded.filter(recent), collapsed: false },
    { key: 'earlier', label: 'Earlier', items: graded.filter((i) => !recent(i)), collapsed: false },
  ]);
}

// Grouped by the business-zone month of release (graded) or due date (missed), newest first
export function groupArchived(items) {
  const when = (i) => (i.archiveReason === 'graded' ? i.grade?.released_at : i.task.due_at);
  const archived = items.filter((i) => i.bucket === 'archived').sort((a, b) => ms(when(b)) - ms(when(a)));
  const groups = new Map();
  for (const item of archived) {
    const ym = dayKey(when(item)).slice(0, 7);
    if (!groups.has(ym)) groups.set(ym, { key: ym, label: monthTitle(ym), items: [], collapsed: false });
    groups.get(ym).items.push(item);
  }
  return [...groups.values()];
}

// Tasks: open ones in due groups, then done within 14 days and older, newest first
export function groupTasks(items, now) {
  const t = ms(now);
  const tasks = items.filter((i) => i.task.kind === 'task');
  const done = tasks.filter((i) => i.task.completed_at)
    .sort((a, b) => ms(b.task.completed_at) - ms(a.task.completed_at));
  const recent = (i) => t - ms(i.task.completed_at) <= DONE_RECENT_DAYS * DAY;
  return {
    open: groupByDue(tasks.filter((i) => !i.task.completed_at), now),
    doneRecent: done.filter(recent),
    doneOlder: done.filter((i) => !recent(i)),
  };
}

// Whether an item counts as work to do now: a copy of a repeating item counts
// once it is due within the next 7 days (or overdue), so a long series does
// not fill the badges. The lists still show every copy.
export function countsNow(item, now = new Date()) {
  const due = item.task?.due_at;
  if (!item.task?.series_id || !due) return true;
  return dayKey(due) <= addDays(todayKey(now), 6);
}

// Badge counts, derived from the same items the lists show
export function navCounts(items, { audience = 'family', now = new Date() } = {}) {
  const todo = items.filter((i) => i.bucket === 'todo' && countsNow(i, now));
  const inReview = items.filter((i) => i.bucket === 'in-review');
  return {
    todo: todo.length,
    todoOverdue: todo.filter((i) => i.dueState === 'overdue').length,
    inReview: audience === 'staff' ? inReview.filter((i) => ACTIONABLE.has(staffGroupOf(i))).length : inReview.length,
    tasksOpen: items.filter((i) => i.task.kind === 'task' && !i.task.completed_at && countsNow(i, now)).length,
  };
}
