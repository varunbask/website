// Pure helpers for the app runtime (app.js): route normalization, titles,
// breadcrumbs, review counts, switcher links and the refresh clock. No DOM.
//
// A page route table maps a view name to an entry:
//   mount(ctx)                  the view (spec 11: views export mount(ctx))
//   title(route) -> string      view title for document.title (spec 4.3)
//   label(route) -> string      short name for the breadcrumb and phone top bar
//                               (defaults to title)
//   subs, defaultSub            allowed second segments ('#/assignments/todo')
//   id: true                    the second segment is an id ('#/review/481')
//   scoped: bool | fn(route)    needs a student scope (?student / ?child)
//   named: bool | fn(route)     titles and crumbs carry the student's name
//                               (defaults to scoped)
//   crumbs(route)               breadcrumb path without the scope prefix
//   wide: bool | fn(route)      full panel width (calendar)
//   hideTabbar(route)           hide the phone tab bar (review page)
//   back(route) -> { href, label } | null
//                               phones: a back button in place of the brand mark
//                               (the review page, which has no tab bar)

import { buildHash, withoutDrawer, DRAWER_PARAMS } from './router.js';
import { one } from './format.js';
import { todayKey } from './dates.js';
import { needsReview, latestAttempts } from './review-model.js';

export const SITE = 'VP Education Group';

const call = (v, ...args) => (typeof v === 'function' ? v(...args) : v);
const blank = (v) => v === null || v === undefined || v === '';

export function isScoped(entry, route) {
  return Boolean(call(entry?.scoped, route));
}

export function isNamed(entry, route) {
  return entry && entry.named !== undefined ? Boolean(call(entry.named, route)) : isScoped(entry, route);
}

export function viewTitle(entry, route) {
  return String(call(entry?.title, route) ?? '');
}

export function viewLabel(entry, route) {
  return String(call(entry?.label, route) ?? viewTitle(entry, route));
}

// The hash to replace the current one with, or null when the route is fine.
//   hasScope     a student is selected (or the page is the student's own)
//   audience     'family' | 'staff'; only staff may open the create drawer
//   staff        student-scoped routes without a student go to #/students
//   defaultHash  the page default for this scope
export function normalizeRoute(route, { table, hasScope = false, audience = 'family', staff = false, defaultHash = '#/' } = {}) {
  const entry = route?.view ? table?.[route.view] : null;
  if (!entry) return defaultHash;

  if (entry.subs) {
    if (!route.sub) return buildHash({ ...route, sub: entry.defaultSub ?? entry.subs[0], id: null });
    if (!entry.subs.includes(route.sub)) return defaultHash;
    if (!blank(route.id)) return buildHash({ ...route, id: null });
  } else if (!entry.id && (!blank(route.sub) || !blank(route.id))) {
    return buildHash({ view: route.view, params: route.params });
  }

  if (isScoped(entry, route) && !hasScope) return staff ? '#/students' : defaultHash;

  // Drawer params: create is staff only; focus, kind and due need open
  const p = route.params ?? {};
  const strayDrawer = DRAWER_PARAMS.some((k) => k !== 'open' && !blank(p[k])) && blank(p.open);
  if ((p.open === 'new' && audience !== 'staff') || strayDrawer) {
    return buildHash(withoutDrawer(route));
  }
  return null;
}

// "Graded assignments, Maya Chen | VP Education Group"
export function documentTitle(title, scopeName) {
  const parts = [title, scopeName].filter((s) => !blank(s));
  return parts.length ? `${parts.join(', ')} | ${SITE}` : SITE;
}

// Breadcrumbs: [{ label, href }] with the last one current (no href).
// Parents and staff see the student's name first on student-scoped routes.
export function defaultCrumbs(entry, route, { scopeName = null } = {}) {
  const path = (call(entry?.crumbs, route) ?? [{ label: viewLabel(entry, route) }])
    .map((c) => ({ label: c.label, href: c.href ?? null }));
  if (path.length) path[path.length - 1] = { label: path[path.length - 1].label, href: null };
  if (scopeName && isNamed(entry, route)) path.unshift({ label: scopeName, href: '#/overview' });
  return path;
}

// The staff review queue (spec 5.8): AI-graded or failed work with no released
// grade, newest attempt only. One rule, owned by review-model.js, so the badge
// matches the queue.
export { needsReview };

// Submissions to review per student id
export function reviewCounts(submissions) {
  const counts = new Map();
  for (const sub of latestAttempts(submissions)) {
    if (!needsReview(sub)) continue;
    counts.set(sub.student_id, (counts.get(sub.student_id) ?? 0) + 1);
  }
  return counts;
}

// A switcher link: staff keep a student-scoped hash (else #/overview); parents
// keep the current hash. Drawer params are never carried over.
export function switcherHref({ kind, id, route, studentScoped = false }) {
  const param = kind === 'child' ? 'child' : 'student';
  const keep = kind === 'child' || studentScoped;
  const hash = keep && route?.view ? buildHash(withoutDrawer(route)) : '#/overview';
  return `?${param}=${encodeURIComponent(id)}${hash}`;
}

// Filters switcher entries by name and email, case-insensitively
export function filterPeople(people, term) {
  const q = String(term ?? '').trim().toLowerCase();
  if (!q) return [...(people ?? [])];
  return (people ?? []).filter((p) => `${p.full_name ?? ''} ${p.email ?? ''}`.toLowerCase().includes(q));
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));

// Did any due state, bucket or business day change between two clock readings?
// Used when a tab becomes visible again with cached data (spec 4.4).
export function clockCrossed(tasks, submissions, from, to) {
  const a = ms(from);
  const b = ms(to);
  if (!(b > a)) return false;
  if (todayKey(new Date(a)) !== todayKey(new Date(b))) return true;
  const crossed = (t) => Number.isFinite(t) && t > a && t <= b;
  for (const task of tasks ?? []) {
    if (!task.due_at) continue;
    const due = ms(task.due_at);
    // overdue, due soon (48 hours) and archived as missed (30 days)
    if (crossed(due) || crossed(due - 48 * HOUR) || crossed(due + 30 * DAY)) return true;
  }
  for (const sub of submissions ?? []) {
    const released = one(sub.grade)?.released_at;
    // graded work moves to Archived 21 days after release; This week ends at 7
    if (released && (crossed(ms(released) + 21 * DAY) || crossed(ms(released) + 7 * DAY))) return true;
  }
  return false;
}
