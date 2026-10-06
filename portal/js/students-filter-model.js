// Pure logic for the Students page filters and sorting (#/students). No DOM.
//
// It works on the page's student summaries (studentSummaries in
// views/students.js): { student, name, email, review, overdue, next,
// nextSession, tutors, avg, ... }. A view is { filter, tutor, sort }:
//   filter  'all' | 'review' | 'overdue' | 'nolesson'   one quick filter at a time
//   tutor   'all' or a tutor's id (the admin's Tutor select)
//   sort    'name' | 'review' | 'lesson' | 'due' | 'average'
// Search text is separate: it is never stored. Search, filter, tutor and sort
// all combine in visibleStudents(). "The next 14 days" is read on the Pacific
// calendar (dates.js), the way every other day count in the portal is.

import { addDays, dayKey, todayKey } from './dates.js';
import { filterPeople } from './app-model.js';

export const LESSON_WINDOW_DAYS = 14;   // "No lesson booked": nothing from today through today + 13
export const ALL = 'all';
export const QUICK_FILTERS = Object.freeze(['review', 'overdue', 'nolesson']);
export const FILTER_LABELS = Object.freeze({
  all: 'All',
  review: 'Needs review',
  overdue: 'Overdue work',
  nolesson: 'No lesson booked',
});
export const SORTS = Object.freeze(['name', 'review', 'lesson', 'due', 'average']);
export const SORT_LABELS = Object.freeze({
  name: 'Name (A to Z)',
  review: 'Needs review first',
  lesson: 'Next lesson soonest',
  due: 'Next due soonest',
  average: 'Recent average (low to high)',
});
export const DEFAULT_VIEW = Object.freeze({ filter: ALL, tutor: ALL, sort: 'name' });
export const STORAGE_PREFIX = 'vb-students-view-';
const TUTOR_ID_MAX = 64;

const text = (v) => String(v ?? '');
const time = (iso) => (iso ? Date.parse(iso) : NaN);
const number = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

// ---------------------------------------------------------------------------
// Predicates (one student summary each)

// Submissions waiting for the tutor to review
export const waitingOnReview = (s) => Number(s?.review) > 0;

// Open work (an assignment still to do or an open task) past its due time
export const hasOverdueWork = (s) => Number(s?.overdue) > 0;

// No upcoming, non-cancelled session starting from today through today + 13
// (Pacific days). A session under way today counts as booked. s.nextSession is
// the student's next upcoming session with any tutor, so only it needs a look.
export function noLessonBooked(s, now = new Date()) {
  const start = s?.nextSession?.starts_at;
  if (!Number.isFinite(time(start))) return true;
  return dayKey(start) > addDays(todayKey(now), LESSON_WINDOW_DAYS - 1);
}

export function matchesFilter(s, filter, now = new Date()) {
  switch (filter) {
    case 'review': return waitingOnReview(s);
    case 'overdue': return hasOverdueWork(s);
    case 'nolesson': return noLessonBooked(s, now);
    default: return true;
  }
}

export function teachesStudent(s, tutorId) {
  return (s?.tutors ?? []).some((t) => String(t.id) === String(tutorId));
}

// Everyone, or one tutor's students
export function filterByTutor(summaries, tutorId = ALL) {
  const list = summaries ?? [];
  return tutorId === ALL || tutorId === null || tutorId === undefined
    ? [...list]
    : list.filter((s) => teachesStudent(s, tutorId));
}

// Name and email, case-insensitive: the same rule as the switcher's search
export function searchSummaries(summaries, term) {
  return filterPeople((summaries ?? []).map((s) => ({ full_name: s.student?.full_name, email: s.email, summary: s })), term)
    .map((p) => p.summary);
}

// ---------------------------------------------------------------------------
// Counts, chips and the tutor options

// { all, review, overdue, nolesson } over the summaries given
export function quickCounts(summaries, now = new Date()) {
  const counts = { all: 0, review: 0, overdue: 0, nolesson: 0 };
  for (const s of summaries ?? []) {
    counts.all += 1;
    for (const key of QUICK_FILTERS) if (matchesFilter(s, key, now)) counts[key] += 1;
  }
  return counts;
}

// The chips to draw: All always, then each quick filter that has students, and
// the one in use even when it has none (so it can be switched off).
// [{ key, label, count, pressed }]. `filters` limits which quick filters exist.
export function filterChips(counts, view, { filters = QUICK_FILTERS } = {}) {
  const active = view?.filter ?? ALL;
  return [ALL, ...filters]
    .filter((key) => key === ALL || Number(counts?.[key]) > 0 || key === active)
    .map((key) => ({ key, label: FILTER_LABELS[key], count: Number(counts?.[key]) || 0, pressed: key === active }));
}

// What a chip press does: the pressed one turns off (back to All), another turns on
export function nextFilter(current, pressed) {
  return pressed === ALL || pressed === current ? ALL : pressed;
}

// The tutors of these students, by name: [{ value, label }]
export function tutorOptions(summaries) {
  const byId = new Map();
  for (const s of summaries ?? []) {
    for (const t of s.tutors ?? []) {
      if (t.id !== null && t.id !== undefined && !byId.has(String(t.id))) byId.set(String(t.id), text(t.name) || 'Tutor');
    }
  }
  return [...byId].map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

// "12 students", "1 student", "Showing 3 of 12 students"
export function countLabel(shown, total) {
  const noun = total === 1 ? 'student' : 'students';
  return shown === total ? `${total} ${noun}` : `Showing ${shown} of ${total} ${noun}`;
}

// ---------------------------------------------------------------------------
// Sorting: every order falls back to the name, then the id, so ties never shuffle

const byName = (a, b) => text(a.name).localeCompare(text(b.name))
  || text(a.student?.id).localeCompare(text(b.student?.id));

// Finite numbers ascending, anything else (no value) after them
function ascending(a, b) {
  const known = [Number.isFinite(a), Number.isFinite(b)];
  if (known[0] && known[1]) return a - b;
  if (known[0]) return -1;
  if (known[1]) return 1;
  return 0;
}

const COMPARATORS = {
  name: byName,
  // most waiting first
  review: (a, b) => (Number(b.review) || 0) - (Number(a.review) || 0) || byName(a, b),
  // soonest first, no lesson last
  lesson: (a, b) => ascending(time(a.nextSession?.starts_at), time(b.nextSession?.starts_at)) || byName(a, b),
  // overdue work leads (it is the earliest), nothing due last
  due: (a, b) => ascending(time(a.next?.task?.due_at), time(b.next?.task?.due_at)) || byName(a, b),
  // lowest average first, so students who need help come first; no grades last
  average: (a, b) => ascending(number(a.avg), number(b.avg)) || byName(a, b),
};

export function comparator(sort) {
  return COMPARATORS[sort] ?? byName;
}

// A new array in the chosen order
export function sortSummaries(summaries, sort = 'name') {
  return [...(summaries ?? [])].sort(comparator(sort));
}

// ---------------------------------------------------------------------------
// The whole pipeline

// Tutor, then quick filter, then search, then sort
export function visibleStudents(summaries, view, { now = new Date(), term = '' } = {}) {
  const v = normalizeView(view, { tutorIds: null });
  const scoped = filterByTutor(summaries, v.tutor).filter((s) => matchesFilter(s, v.filter, now));
  return sortSummaries(searchSummaries(scoped, term), v.sort);
}

// ---------------------------------------------------------------------------
// What narrows the list, for the empty result

// { filter, tutor, search, any }
export function narrowing(view, term = '') {
  const filter = Boolean(view?.filter) && view.filter !== ALL;
  const tutor = Boolean(view?.tutor) && view.tutor !== ALL;
  const search = text(term).trim() !== '';
  return { filter, tutor, search, any: filter || tutor || search };
}

export function emptyMessage(n) {
  return n.filter || n.tutor ? 'No students match these filters.' : 'No student matches that search.';
}

export function clearLabel(n) {
  return n.filter || n.tutor ? 'Clear filters' : 'Clear search';
}

// Filters and tutor back to All (the sort stays: it is not a filter)
export function clearedView(view) {
  return { ...normalizeView(view), filter: ALL, tutor: ALL };
}

export const isDefaultView = (view) => {
  const v = normalizeView(view);
  return v.filter === DEFAULT_VIEW.filter && v.tutor === DEFAULT_VIEW.tutor && v.sort === DEFAULT_VIEW.sort;
};

// ---------------------------------------------------------------------------
// Keeping the view

// Anything (a stored string, a parsed object, junk) -> a valid view. `filters`
// limits the quick filters on offer; `tutorIds`, when given, are the tutors
// that exist (a tutor who is gone falls back to All).
export function normalizeView(raw, { filters = QUICK_FILTERS, tutorIds = null } = {}) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ...DEFAULT_VIEW };

  const filter = filters.includes(data.filter) ? data.filter : ALL;
  const sort = SORTS.includes(data.sort) ? data.sort : DEFAULT_VIEW.sort;
  let tutor = typeof data.tutor === 'string' || typeof data.tutor === 'number' ? String(data.tutor).trim() : ALL;
  if (!tutor || tutor.length > TUTOR_ID_MAX) tutor = ALL;
  if (tutorIds && tutor !== ALL && !tutorIds.some((id) => String(id) === tutor)) tutor = ALL;
  return { filter, tutor, sort };
}

export const viewKey = (userId) => `${STORAGE_PREFIX}${userId}`;

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

const hasUser = (userId) => userId !== null && userId !== undefined && String(userId) !== '';

// The user's saved view, or the default when nothing usable is stored
export function loadView(userId, storage = defaultStorage()) {
  try {
    if (!hasUser(userId) || !storage || typeof storage.getItem !== 'function') return { ...DEFAULT_VIEW };
    return normalizeView(storage.getItem(viewKey(userId)));
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

// Saves the view (the default view clears the entry); returns whether storage took it
export function saveView(userId, view, storage = defaultStorage()) {
  try {
    if (!hasUser(userId) || !storage || typeof storage.setItem !== 'function') return false;
    if (isDefaultView(view)) storage.removeItem(viewKey(userId));
    else storage.setItem(viewKey(userId), JSON.stringify(normalizeView(view)));
    return true;
  } catch {
    return false;
  }
}
