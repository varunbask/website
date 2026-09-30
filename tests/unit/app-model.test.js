import { describe, test, expect } from 'vitest';
import {
  normalizeRoute, documentTitle, defaultCrumbs, needsReview, reviewCounts, switcherHref,
  filterPeople, clockCrossed, isScoped, isNamed, viewTitle, viewLabel,
} from '../../portal/js/app-model.js';
import { parseHash } from '../../portal/js/router.js';

// A table shaped like routes.js, without the view modules
const SUB_LABELS = { todo: 'To do', 'in-review': 'In review', graded: 'Graded', archived: 'Archived' };
const STAFF = {
  today: { title: () => 'Today' },
  review: {
    id: true,
    title: (r) => (r.id ? 'Review' : 'Review queue'),
    crumbs: (r) => (r.id ? [{ label: 'Review queue', href: '#/review' }, { label: 'Review' }] : [{ label: 'Review queue' }]),
  },
  students: { title: () => 'Students' },
  overview: { title: () => 'Overview', scoped: true, named: true },
  assignments: {
    subs: ['todo', 'in-review', 'graded', 'archived'],
    defaultSub: 'todo',
    scoped: true,
    title: (r) => ({ graded: 'Graded assignments' })[r.sub] ?? 'To do assignments',
    label: (r) => SUB_LABELS[r.sub],
    crumbs: (r) => [{ label: 'Assignments', href: '#/assignments/todo' }, { label: SUB_LABELS[r.sub] }],
  },
  tasks: { title: () => 'Tasks', scoped: true },
  calendar: { title: () => 'Calendar', scoped: (r) => r.params?.scope !== 'all', wide: true },
};
const FAMILY = {
  overview: { title: () => 'Overview', scoped: false, named: true },
  assignments: STAFF.assignments,
  tasks: STAFF.tasks,
};

const route = (hash, table = STAFF) => parseHash(hash, table);
const staffOpts = (hasScope) => ({ table: STAFF, hasScope, audience: 'staff', staff: true, defaultHash: hasScope ? '#/overview' : '#/today' });
const familyOpts = (hasScope = true) => ({ table: FAMILY, hasScope, audience: 'family', staff: false, defaultHash: '#/overview' });

describe('normalizeRoute', () => {
  test('a good route needs no change', () => {
    expect(normalizeRoute(route('#/assignments/graded?open=12'), staffOpts(true))).toBeNull();
    expect(normalizeRoute(route('#/review/481?filter=draft'), staffOpts(false))).toBeNull();
    expect(normalizeRoute(route('#/calendar?scope=all&m=2026-10'), staffOpts(false))).toBeNull();
  });

  test('no hash or an unknown view goes to the page default', () => {
    expect(normalizeRoute(route(''), staffOpts(false))).toBe('#/today');
    expect(normalizeRoute(route('#/nope'), staffOpts(true))).toBe('#/overview');
    expect(normalizeRoute(route('#/today', FAMILY), familyOpts())).toBe('#/overview');
  });

  test('a missing sub gets the default sub; a bad sub goes to the default', () => {
    expect(normalizeRoute(route('#/assignments?open=3'), staffOpts(true))).toBe('#/assignments/todo?open=3');
    expect(normalizeRoute(route('#/assignments/done'), staffOpts(true))).toBe('#/overview');
    expect(normalizeRoute(route('#/assignments/graded/9'), staffOpts(true))).toBe('#/assignments/graded');
  });

  test('extra segments on a plain view are dropped', () => {
    expect(normalizeRoute(route('#/tasks/7?open=2'), staffOpts(true))).toBe('#/tasks?open=2');
  });

  test('staff student-scoped routes without a student go to Students', () => {
    expect(normalizeRoute(route('#/assignments/todo'), staffOpts(false))).toBe('#/students');
    expect(normalizeRoute(route('#/calendar'), staffOpts(false))).toBe('#/students');
    expect(normalizeRoute(route('#/overview'), staffOpts(false))).toBe('#/students');
  });

  test('a parent with no child only keeps Overview', () => {
    expect(normalizeRoute(route('#/overview', FAMILY), familyOpts(false))).toBeNull();
    expect(normalizeRoute(route('#/tasks', FAMILY), familyOpts(false))).toBe('#/overview');
  });

  test('create is staff only; stray drawer params are removed', () => {
    expect(normalizeRoute(route('#/tasks?kind=task&open=new', FAMILY), familyOpts())).toBe('#/tasks');
    expect(normalizeRoute(route('#/tasks?kind=task&open=new'), staffOpts(true))).toBeNull();
    expect(normalizeRoute(route('#/tasks?focus=submit'), staffOpts(true))).toBe('#/tasks');
    expect(normalizeRoute(route('#/calendar?due=2026-10-14&scope=all'), staffOpts(false))).toBe('#/calendar?scope=all');
  });
});

describe('titles and crumbs', () => {
  test('document titles carry the scope name when given', () => {
    expect(documentTitle('Graded assignments', 'Maya Chen')).toBe('Graded assignments, Maya Chen | VP Education Group');
    expect(documentTitle('Today', null)).toBe('Today | VP Education Group');
    expect(documentTitle('', null)).toBe('VP Education Group');
  });

  test('view titles and labels', () => {
    const r = route('#/assignments/graded');
    expect(viewTitle(STAFF.assignments, r)).toBe('Graded assignments');
    expect(viewLabel(STAFF.assignments, r)).toBe('Graded');
    expect(viewLabel(STAFF.today, route('#/today'))).toBe('Today');
  });

  test('scoped and named', () => {
    expect(isScoped(STAFF.calendar, route('#/calendar?scope=all'))).toBe(false);
    expect(isScoped(STAFF.calendar, route('#/calendar'))).toBe(true);
    expect(isNamed(FAMILY.overview, route('#/overview', FAMILY))).toBe(true);
    expect(isScoped(FAMILY.overview, route('#/overview', FAMILY))).toBe(false);
    expect(isNamed(STAFF.today, route('#/today'))).toBe(false);
  });

  test('crumbs: student, parent or staff scope, workspace', () => {
    const r = route('#/assignments/in-review');
    expect(defaultCrumbs(STAFF.assignments, r)).toEqual([
      { label: 'Assignments', href: '#/assignments/todo' }, { label: 'In review', href: null }]);
    expect(defaultCrumbs(STAFF.assignments, r, { scopeName: 'Maya Chen' })).toEqual([
      { label: 'Maya Chen', href: '#/overview' },
      { label: 'Assignments', href: '#/assignments/todo' },
      { label: 'In review', href: null }]);
    expect(defaultCrumbs(STAFF.today, route('#/today'), { scopeName: 'Maya Chen' })).toEqual([{ label: 'Today', href: null }]);
    expect(defaultCrumbs(STAFF.review, route('#/review/481'))).toEqual([
      { label: 'Review queue', href: '#/review' }, { label: 'Review', href: null }]);
    expect(defaultCrumbs(STAFF.calendar, route('#/calendar?scope=all'), { scopeName: 'Maya Chen' })).toEqual([
      { label: 'Calendar', href: null }]);
  });
});

describe('review counts', () => {
  const sub = (id, studentId, status, grade = null) => ({ id, student_id: studentId, status, grade });

  test('needsReview: AI-graded or failed, and not released', () => {
    expect(needsReview(sub(1, 'a', 'ai_graded'))).toBe(true);
    expect(needsReview(sub(1, 'a', 'failed'))).toBe(true);
    expect(needsReview(sub(1, 'a', 'ai_graded', { reviewed_at: '2026-10-01T00:00:00Z', released_at: null }))).toBe(true);
    expect(needsReview(sub(1, 'a', 'ai_graded', [{ released_at: '2026-10-01T00:00:00Z' }]))).toBe(false);
    expect(needsReview(sub(1, 'a', 'pending'))).toBe(false);
    expect(needsReview(sub(1, 'a', 'grading'))).toBe(false);
  });

  test('counts per student', () => {
    const counts = reviewCounts([
      sub(1, 'a', 'ai_graded'), sub(2, 'a', 'failed'), sub(3, 'b', 'ai_graded'),
      sub(4, 'b', 'ai_graded', { released_at: '2026-10-01T00:00:00Z' }), sub(5, 'c', 'pending'),
    ]);
    expect(Object.fromEntries(counts)).toEqual({ a: 2, b: 1 });
  });
});

describe('switcher links', () => {
  test('staff keep a student-scoped hash, else go to Overview; drawer params never carry over', () => {
    expect(switcherHref({ kind: 'student', id: 'u2', route: route('#/assignments/graded?open=4'), studentScoped: true }))
      .toBe('?student=u2#/assignments/graded');
    expect(switcherHref({ kind: 'student', id: 'u2', route: route('#/review'), studentScoped: false }))
      .toBe('?student=u2#/overview');
  });

  test('parents keep the current hash', () => {
    expect(switcherHref({ kind: 'child', id: 'k1', route: route('#/tasks?open=9', FAMILY) })).toBe('?child=k1#/tasks');
  });

  test('filterPeople matches name and email, any case', () => {
    const people = [{ full_name: 'Maya Chen', email: 'maya@x.org' }, { full_name: 'Leo Park', email: 'LP@y.org' }];
    expect(filterPeople(people, 'maya')).toHaveLength(1);
    expect(filterPeople(people, 'lp@')).toEqual([people[1]]);
    expect(filterPeople(people, '  ')).toHaveLength(2);
  });
});

describe('clockCrossed', () => {
  const at = (iso) => new Date(iso);

  test('a due time, the 48-hour line or a business day passing counts', () => {
    const task = { due_at: '2026-10-15T06:59:00.000Z' };  // Oct 14, 11:59 pm Pacific
    expect(clockCrossed([task], [], at('2026-10-15T06:50:00Z'), at('2026-10-15T07:05:00Z'))).toBe(true);
    expect(clockCrossed([task], [], at('2026-10-13T06:50:00Z'), at('2026-10-13T07:05:00Z'))).toBe(true);
    expect(clockCrossed([], [], at('2026-10-14T06:50:00Z'), at('2026-10-14T07:10:00Z'))).toBe(true);
  });

  test('nothing crossed', () => {
    const task = { due_at: '2026-10-20T06:59:00.000Z' };
    expect(clockCrossed([task], [], at('2026-10-14T17:00:00Z'), at('2026-10-14T18:00:00Z'))).toBe(false);
    expect(clockCrossed([task], [], at('2026-10-14T18:00:00Z'), at('2026-10-14T17:00:00Z'))).toBe(false);
  });

  test('graded work reaching the archive line counts', () => {
    const sub = { grade: { released_at: '2026-10-01T12:00:00Z' } };
    expect(clockCrossed([], [sub], at('2026-10-22T11:30:00Z'), at('2026-10-22T12:30:00Z'))).toBe(true);
  });
});
