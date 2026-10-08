// Pure logic for the staff workspace (spec 5.4, 5.8, 5.9): the review queue,
// its groups and filters, waiting times, attempt numbers, the review page
// pager, recent releases and the Today copy. No DOM, no network.

import { one, byDue } from './format.js';
import { staffStatus } from './labels.js';
import { MAX_SUBMISSIONS, sortSubs } from './buckets.js';
import { todayKey, dayKey, addDays, businessTime, parseKey, viewerIsInBusinessZone } from './dates.js';
import { RESULTS, checkExtension } from './results.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WAIT_WARNING_HOURS = 48;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));
const gradeOf = (sub) => one(sub?.grade);
const idOf = (v) => (v !== null && typeof v === 'object' ? v.id : v);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// Filters and groups

export const FILTERS = Object.freeze(['all', 'draft', 'failed', 'edited']);
export const FILTER_LABELS = Object.freeze({ all: 'All', draft: 'Draft ready', failed: 'Could not grade', edited: 'Edited' });

// Queue groups in their display order (spec 5.8)
export const GROUPS = Object.freeze([
  Object.freeze({ key: 'failed', label: 'Could not grade' }),
  Object.freeze({ key: 'draft', label: 'Draft ready' }),
  Object.freeze({ key: 'edited', label: 'Edited, not released' }),
]);

export function normalizeFilter(filter) {
  return FILTERS.includes(filter) ? filter : 'all';
}

// AI-graded or failed work with no released grade (unchanged from staff.js;
// the same rule as the nav badge in app-model.js)
export function needsReview(sub) {
  return (sub?.status === 'ai_graded' || sub?.status === 'failed') && !gradeOf(sub)?.released_at;
}

// The newest attempt for each task. A newer attempt replaces the older ones,
// so only the newest attempt goes in the queue and its counts.
export function latestAttempts(subs) {
  const latest = new Map();
  for (const sub of sortSubs(subs)) {
    const key = String(sub.task_id);
    if (!latest.has(key)) latest.set(key, sub);
  }
  return [...latest.values()];
}

// Which queue group a submission is in, by staffStatus; null when it is not queued
const GROUP_OF_STATUS = { 'Could not grade': 'failed', 'AI draft': 'draft', 'Edited, not released': 'edited' };
export function reviewGroupOf(sub) {
  if (!needsReview(sub)) return null;
  return GROUP_OF_STATUS[staffStatus(sub, gradeOf(sub)).text] ?? null;
}

// Oldest submission first; on a tie the lower id first
function oldestFirst(a, b) {
  return (ms(a.created_at) - ms(b.created_at)) || (Number(a.id) - Number(b.id));
}

// [{ key, label, items }] in group order, oldest first, empty groups left out.
// A filter other than 'all' keeps only its own group.
export function queueGroups(subs, filter = 'all') {
  const f = normalizeFilter(filter);
  const byKey = new Map(GROUPS.map((g) => [g.key, []]));
  for (const sub of latestAttempts(subs)) {
    const key = reviewGroupOf(sub);
    if (key && (f === 'all' || f === key)) byKey.get(key).push(sub);
  }
  return GROUPS
    .map((g) => ({ key: g.key, label: g.label, items: byKey.get(g.key).sort(oldestFirst) }))
    .filter((g) => g.items.length);
}

// The queue as one ordered list (the review page pager walks this)
export function queueOrder(subs, filter = 'all') {
  return queueGroups(subs, filter).flatMap((g) => g.items);
}

// { all, draft, failed, edited } for the segmented filter
export function filterCounts(subs) {
  const counts = { all: 0, draft: 0, failed: 0, edited: 0 };
  for (const sub of latestAttempts(subs)) {
    const key = reviewGroupOf(sub);
    if (!key) continue;
    counts[key] += 1;
    counts.all += 1;
  }
  return counts;
}

// Submitted and grading work nobody can review yet, oldest first
export function stillGrading(subs) {
  return latestAttempts(subs)
    .filter((s) => (s.status === 'pending' || s.status === 'grading') && !gradeOf(s)?.released_at)
    .sort(oldestFirst);
}

// ---------------------------------------------------------------------------
// Labels

// "Oct 6 at 4:12 pm" in the business zone; ", 2025" when the year differs from
// now's; " PT" when the viewer's clock is in another zone
export function stampLabel(iso, now = new Date(), { viewerInZone } = {}) {
  if (!iso) return '';
  const wall = businessTime(iso);
  const { y, m, d } = parseKey(wall.key);
  const year = parseKey(todayKey(now)).y === y ? '' : `, ${y}`;
  const clock = `${wall.hour % 12 || 12}:${String(wall.minute).padStart(2, '0')} ${wall.hour < 12 ? 'am' : 'pm'}`;
  const inZone = viewerInZone ?? viewerIsInBusinessZone(new Date(ms(iso)));
  return `${MONTHS[m - 1]} ${d}${year} at ${clock}${inZone ? '' : ' PT'}`;
}

// "Oct 6" in the business zone, or "Dec 31, 2025" when the year differs from now's
export function dateLabel(iso, now = new Date()) {
  if (!iso) return '';
  const { y, m, d } = parseKey(businessTime(iso).key);
  const year = parseKey(todayKey(now)).y === y ? '' : `, ${y}`;
  return `${MONTHS[m - 1]} ${d}${year}`;
}

// "Waiting 2 days" since the work was submitted; warning tone after 48 hours
export function waitingLabel(sub, now = new Date(), { viewerInZone } = {}) {
  const elapsed = Math.max(0, ms(now) - ms(sub?.created_at));
  let text;
  if (elapsed < HOUR) text = `Waiting ${plural(Math.max(1, Math.floor(elapsed / MIN)), 'minute')}`;
  else if (elapsed < DAY) text = `Waiting ${plural(Math.floor(elapsed / HOUR), 'hour')}`;
  else text = `Waiting ${plural(Math.floor(elapsed / DAY), 'day')}`;
  return {
    text,
    tone: elapsed > WAIT_WARNING_HOURS * HOUR ? 'warning' : null,
    full: sub?.created_at ? `Submitted ${stampLabel(sub.created_at, now, { viewerInZone })}` : '',
  };
}

// { n, total, newer }: which attempt this is (the oldest submission is 1), the
// cap, and whether a later submission exists for the same task
export function attemptInfo(sub, taskSubs) {
  const list = [...(taskSubs ?? [])].sort(oldestFirst);
  const index = list.findIndex((s) => String(s.id) === String(sub?.id));
  if (index === -1) return { n: list.length + 1, total: MAX_SUBMISSIONS, newer: false };
  return { n: index + 1, total: MAX_SUBMISSIONS, newer: index < list.length - 1 };
}

// Position of a submission in a queue (subs or ids): { index (0-based, -1
// when absent), total, prevId, nextId }. No wrapping at the ends.
export function neighbors(queue, id) {
  const ids = (queue ?? []).map(idOf);
  const index = ids.findIndex((x) => String(x) === String(id));
  return {
    index,
    total: ids.length,
    prevId: index > 0 ? ids[index - 1] : null,
    nextId: index !== -1 && index < ids.length - 1 ? ids[index + 1] : null,
  };
}

// Released within `days`, newest release first, at most `limit`
export function recentlyReleased(subs, now = new Date(), { days = 14, limit = 5 } = {}) {
  const t = ms(now);
  const released = (s) => gradeOf(s)?.released_at;
  return (subs ?? [])
    .filter((s) => released(s) && t - ms(released(s)) <= days * DAY)
    .sort((a, b) => ms(released(b)) - ms(released(a)))
    .slice(0, limit);
}

// Today's lede (spec 5.4)
export function todayLede(count, studentCount) {
  if (!count) return 'Nothing needs review right now.';
  if (count === 1) return '1 submission needs review.';
  if (studentCount === 1) return `${count} submissions from 1 student need review.`;
  return `${count} submissions need review across ${studentCount} students.`;
}

// Admin callout on Today
export function pendingLabel(n) {
  return n === 1 ? '1 person is waiting for approval' : `${n} people are waiting for approval`;
}

// '#/review/12?filter=draft'; the default filter stays out of the URL
export function reviewHref(id, filter) {
  const f = normalizeFilter(filter);
  return `#/review/${encodeURIComponent(id)}${f === 'all' ? '' : `?filter=${f}`}`;
}

// Map of task id -> its submissions, in input order
export function subsByTask(subs) {
  const map = new Map();
  for (const s of subs ?? []) {
    if (!map.has(s.task_id)) map.set(s.task_id, []);
    map.get(s.task_id).push(s);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Grade editor validation

export const RESULT_ERROR = 'Choose Completed, Missing or Extended.';
export const EMPTY_DRAFT_ERROR = 'Choose a result or write feedback before you save.';

// Raw form values -> { ok, values: { result, feedback }, dueAt, errors: { result?, dueDate? } }.
// A draft may leave one of result and feedback blank, but not both. A saved
// draft marks the grade as reviewed, and the grader does not write over a
// reviewed grade. Releasing (or saving a released grade) needs a result;
// feedback is optional. Extended also needs a new due date whose due time
// (the assignment's time of day, see results.js) is still ahead: dueAt is then
// the new due_at, else null. With keepDate, the assignment's current due day
// is accepted as it is (a released Extended whose date is not being changed).
//   options: release, dueAt (the assignment's due_at now), now, keepDate
export function validateGrade({ result, feedback, dueDate } = {}, {
  release = false, dueAt = null, now = new Date(), keepDate = false,
} = {}) {
  const picked = RESULTS.includes(result) ? result : null;
  const text = String(feedback ?? '').trim();
  const day = String(dueDate ?? '').trim();
  const errors = {};
  let newDue = null;
  if (release && !picked) errors.result = RESULT_ERROR;
  if (!release && !picked && !text) errors.result = EMPTY_DRAFT_ERROR;
  const unchanged = keepDate && dueAt && day === dayKey(dueAt);
  if (release && picked === 'extended' && !unchanged) {
    const check = checkExtension(day, dueAt, now);
    if (check.ok) newDue = check.dueAt;
    else errors.dueDate = check.error;
  }
  return {
    ok: Object.keys(errors).length === 0,
    values: { result: picked, feedback: text || null },
    dueAt: newDue,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Today

// Open work due today through today + 6 (business zone), soonest first
export function dueThisWeek(items, now = new Date()) {
  const today = todayKey(now);
  const last = addDays(today, 6);
  return (items ?? [])
    .filter((i) => i.task.due_at && i.dueState !== 'done' && (i.task.kind === 'task' || i.bucket === 'todo'))
    .filter((i) => {
      const k = dayKey(i.task.due_at);
      return k >= today && k <= last;
    })
    .sort((a, b) => byDue(a.task, b.task));
}
