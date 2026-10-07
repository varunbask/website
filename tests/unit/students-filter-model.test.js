import { describe, test, expect, vi } from 'vitest';
import {
  LESSON_WINDOW_DAYS, QUICK_FILTERS, SORTS, DEFAULT_VIEW, FILTER_LABELS, SORT_LABELS,
  waitingOnReview, hasOverdueWork, noLessonBooked, matchesFilter, teachesStudent, filterByTutor, searchSummaries,
  quickCounts, filterChips, nextFilter, tutorOptions, countLabel, comparator, sortSummaries, visibleStudents,
  narrowing, emptyMessage, clearLabel, clearedView, isDefaultView, normalizeView, viewKey, loadView, saveView,
} from '../../portal/js/students-filter-model.js';
import { zonedIso } from '../../portal/js/dates.js';

// The Students view imports the store chain, which builds a Supabase client
vi.mock('../../portal/js/supabase.js', () => ({ sb: {} }));
const { studentSummaries } = await import('../../portal/js/views/students.js');

// Wednesday, October 14, 2026 at 12:00 pm Pacific
const NOW = new Date('2026-10-14T19:00:00Z');
const at = (key, time = '16:00') => zonedIso(key, time);

// A summary as studentSummaries builds it; only the fields a test names matter
let n = 0;
const summary = (name, extra = {}) => {
  n += 1;
  return {
    student: { id: `s${n}`, full_name: name, email: `${name.split(' ')[0].toLowerCase()}@example.com` },
    name,
    email: `${name.split(' ')[0].toLowerCase()}@example.com`,
    review: 0,
    overdue: 0,
    next: null,
    nextSession: null,
    tutors: [],
    completion: null,
    ...extra,
  };
};
const session = (key, time = '16:00') => ({ id: 1, starts_at: at(key, time), ends_at: at(key, '17:00'), status: 'scheduled' });
const due = (key) => ({ task: { due_at: at(key, '23:59') } });
const tutor = (id, name) => ({ id, name, subject: null, tone: 'subj-0' });
const names = (list) => list.map((s) => s.name);

describe('quick filter predicates', () => {
  test('needs review: any submission waiting', () => {
    expect(waitingOnReview(summary('A', { review: 1 }))).toBe(true);
    expect(waitingOnReview(summary('A', { review: 0 }))).toBe(false);
    expect(waitingOnReview({})).toBe(false);
  });

  test('overdue work: any open item past due', () => {
    expect(hasOverdueWork(summary('A', { overdue: 2 }))).toBe(true);
    expect(hasOverdueWork(summary('A', { overdue: 0 }))).toBe(false);
    expect(hasOverdueWork({})).toBe(false);
  });

  describe('no lesson booked', () => {
    test('no upcoming session at all', () => {
      expect(noLessonBooked(summary('A'), NOW)).toBe(true);
    });

    test('a lesson today, or on day 13, is booked; day 14 and later is not', () => {
      expect(noLessonBooked(summary('A', { nextSession: session('2026-10-14') }), NOW)).toBe(false);
      expect(noLessonBooked(summary('A', { nextSession: session('2026-10-27') }), NOW)).toBe(false);
      expect(noLessonBooked(summary('A', { nextSession: session('2026-10-28') }), NOW)).toBe(true);
      expect(noLessonBooked(summary('A', { nextSession: session('2026-12-01') }), NOW)).toBe(true);
      expect(LESSON_WINDOW_DAYS).toBe(14);
    });

    test('days are Pacific days: a late evening ahead of UTC midnight still counts as that day', () => {
      // 11:30 pm Pacific on Oct 14 is already Oct 15 in UTC
      const late = new Date('2026-10-15T06:30:00Z');
      // 11:00 pm on the last day of the window (Oct 27 Pacific) is Oct 28 in UTC
      expect(noLessonBooked(summary('A', { nextSession: session('2026-10-27', '23:00') }), late)).toBe(false);
      expect(noLessonBooked(summary('A', { nextSession: session('2026-10-28', '00:30') }), late)).toBe(true);
    });

    test('the window follows the calendar across the end of daylight saving time (Nov 1)', () => {
      const now = new Date(zonedIso('2026-10-25', '12:00'));
      expect(noLessonBooked(summary('A', { nextSession: session('2026-11-07', '23:30') }), now)).toBe(false);
      expect(noLessonBooked(summary('A', { nextSession: session('2026-11-08', '00:30') }), now)).toBe(true);
    });

    test('a lesson under way today counts as booked', () => {
      const now = new Date(zonedIso('2026-10-14', '16:30'));
      expect(noLessonBooked(summary('A', { nextSession: session('2026-10-14', '16:00') }), now)).toBe(false);
    });

    test('an unreadable start time counts as no lesson', () => {
      expect(noLessonBooked(summary('A', { nextSession: { starts_at: 'soon' } }), NOW)).toBe(true);
    });
  });

  test('matchesFilter routes by key and lets everyone through for all or an unknown key', () => {
    const s = summary('A', { review: 1 });
    expect(matchesFilter(s, 'review', NOW)).toBe(true);
    expect(matchesFilter(s, 'overdue', NOW)).toBe(false);
    expect(matchesFilter(s, 'nolesson', NOW)).toBe(true);
    expect(matchesFilter(s, 'all', NOW)).toBe(true);
    expect(matchesFilter(s, 'bogus', NOW)).toBe(true);
  });
});

describe('tutor filter', () => {
  const maya = summary('Maya', { tutors: [tutor('t1', 'Daniel Ortiz'), tutor('t2', 'Priya Shah')] });
  const leo = summary('Leo', { tutors: [tutor('t1', 'Daniel Ortiz')] });
  const ava = summary('Ava', { tutors: [tutor('t2', 'Priya Shah')] });
  const nobody = summary('Zed');
  const all = [maya, leo, ava, nobody];

  test('teachesStudent compares ids as text', () => {
    expect(teachesStudent(maya, 't2')).toBe(true);
    expect(teachesStudent(leo, 't2')).toBe(false);
    expect(teachesStudent(summary('N', { tutors: [tutor(7, 'Seven')] }), '7')).toBe(true);
    expect(teachesStudent({}, 't1')).toBe(false);
  });

  test('all tutors keeps everyone, a tutor keeps their students', () => {
    expect(names(filterByTutor(all, 'all'))).toEqual(['Maya', 'Leo', 'Ava', 'Zed']);
    expect(names(filterByTutor(all, 't1'))).toEqual(['Maya', 'Leo']);
    expect(names(filterByTutor(all, 't2'))).toEqual(['Maya', 'Ava']);
    expect(filterByTutor(all, 'gone')).toEqual([]);
    expect(filterByTutor(null, 't1')).toEqual([]);
  });

  test('all tutors returns a copy, never the input array', () => {
    expect(filterByTutor(all)).not.toBe(all);
  });

  test('tutorOptions lists each tutor once, by name', () => {
    expect(tutorOptions(all)).toEqual([
      { value: 't1', label: 'Daniel Ortiz' },
      { value: 't2', label: 'Priya Shah' },
    ]);
    expect(tutorOptions([])).toEqual([]);
    expect(tutorOptions(null)).toEqual([]);
  });

  test('tutorOptions orders by name, then id, and names an unnamed tutor', () => {
    const list = [
      summary('A', { tutors: [tutor('b', 'Sam'), tutor('a', 'Sam'), tutor('c', 'Alex'), tutor('d', '')] }),
    ];
    expect(tutorOptions(list).map((o) => o.value)).toEqual(['c', 'a', 'b', 'd']);
    expect(tutorOptions(list).at(-1).label).toBe('Tutor');
  });
});

describe('search', () => {
  const list = [summary('Maya Lin'), summary('Leo Park'), summary('Mateo Diaz')];

  test('matches name and email, case-insensitively', () => {
    expect(names(searchSummaries(list, 'ma'))).toEqual(['Maya Lin', 'Mateo Diaz']);
    expect(names(searchSummaries(list, 'LEO@EXAMPLE'))).toEqual(['Leo Park']);
  });

  test('a blank term keeps everyone', () => {
    expect(searchSummaries(list, '  ')).toHaveLength(3);
    expect(searchSummaries(list, '')).toHaveLength(3);
  });

  test('searches the email the summary shows, not the raw student row', () => {
    const hidden = summary('Rosa Diaz');
    hidden.student.email = 'no-login+rosa@people.example.com';
    hidden.email = '';
    expect(searchSummaries([hidden], 'no-login')).toEqual([]);
    expect(searchSummaries([hidden], 'rosa')).toHaveLength(1);
  });
});

describe('counts and chips', () => {
  const list = [
    summary('A', { review: 2, overdue: 1, nextSession: session('2026-10-15') }),
    summary('B', { review: 1 }),
    summary('C', { overdue: 3, nextSession: session('2026-11-30') }),
    summary('D', { nextSession: session('2026-10-20') }),
  ];

  test('quickCounts tallies each filter and everyone', () => {
    expect(quickCounts(list, NOW)).toEqual({ all: 4, review: 2, overdue: 2, nolesson: 2 });
    expect(quickCounts([], NOW)).toEqual({ all: 0, review: 0, overdue: 0, nolesson: 0 });
    expect(quickCounts(null, NOW).all).toBe(0);
  });

  test('chips show All plus each filter with students, in order, with labels and counts', () => {
    const chips = filterChips(quickCounts(list, NOW), DEFAULT_VIEW);
    expect(chips.map((c) => [c.key, c.label, c.count, c.pressed])).toEqual([
      ['all', 'All', 4, true],
      ['review', 'Needs review', 2, false],
      ['overdue', 'Overdue work', 2, false],
      ['nolesson', 'No lesson booked', 2, false],
    ]);
  });

  test('a filter with no students has no chip, All always stays', () => {
    const chips = filterChips({ all: 3, review: 0, overdue: 1, nolesson: 0 }, DEFAULT_VIEW);
    expect(chips.map((c) => c.key)).toEqual(['all', 'overdue']);
    expect(filterChips({ all: 0, review: 0, overdue: 0, nolesson: 0 }, DEFAULT_VIEW).map((c) => c.key)).toEqual(['all']);
  });

  test('the filter in use keeps its chip even at zero, and is the pressed one', () => {
    const chips = filterChips({ all: 3, review: 0, overdue: 1, nolesson: 0 }, { ...DEFAULT_VIEW, filter: 'review' });
    expect(chips.map((c) => [c.key, c.count, c.pressed])).toEqual([['all', 3, false], ['review', 0, true], ['overdue', 1, false]]);
  });

  test('filters can be limited (no schedule, no "No lesson booked")', () => {
    const chips = filterChips({ all: 3, review: 1, overdue: 1, nolesson: 3 }, DEFAULT_VIEW, { filters: ['review', 'overdue'] });
    expect(chips.map((c) => c.key)).toEqual(['all', 'review', 'overdue']);
  });

  test('pressing a chip: a new one turns on, the pressed one and All turn to All', () => {
    expect(nextFilter('all', 'review')).toBe('review');
    expect(nextFilter('review', 'overdue')).toBe('overdue');
    expect(nextFilter('review', 'review')).toBe('all');
    expect(nextFilter('review', 'all')).toBe('all');
    expect(nextFilter('all', 'all')).toBe('all');
  });

  test('every quick filter and sort has a label, with no dashes', () => {
    for (const key of ['all', ...QUICK_FILTERS]) expect(FILTER_LABELS[key]).toBeTruthy();
    for (const key of SORTS) expect(SORT_LABELS[key]).toBeTruthy();
    expect(JSON.stringify([FILTER_LABELS, SORT_LABELS])).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('countLabel', () => {
  test('all shown, one student, or a filtered count', () => {
    expect(countLabel(12, 12)).toBe('12 students');
    expect(countLabel(1, 1)).toBe('1 student');
    expect(countLabel(3, 12)).toBe('Showing 3 of 12 students');
    expect(countLabel(0, 12)).toBe('Showing 0 of 12 students');
    expect(countLabel(1, 2)).toBe('Showing 1 of 2 students');
  });
});

describe('sorting', () => {
  test('name: A to Z, case-insensitive, ties by id', () => {
    const list = [summary('maya'), summary('Ava'), summary('Zoe'), summary('Ava')];
    const sorted = sortSummaries(list, 'name');
    expect(names(sorted)).toEqual(['Ava', 'Ava', 'maya', 'Zoe']);
    const twins = sorted.slice(0, 2).map((s) => s.student.id);
    expect(twins).toEqual([...twins].sort());
  });

  test('name is the default and the fallback for an unknown sort', () => {
    const list = [summary('B'), summary('A')];
    expect(names(sortSummaries(list))).toEqual(['A', 'B']);
    expect(names(sortSummaries(list, 'bogus'))).toEqual(['A', 'B']);
    expect(comparator('bogus')).toBe(comparator('name'));
  });

  test('needs review first: most waiting first, then name', () => {
    const list = [summary('Bo', { review: 1 }), summary('Al'), summary('Cy', { review: 3 }), summary('Di', { review: 1 })];
    expect(names(sortSummaries(list, 'review'))).toEqual(['Cy', 'Bo', 'Di', 'Al']);
  });

  test('next lesson soonest: earliest first, no lesson last, ties by name', () => {
    const list = [
      summary('Bo', { nextSession: session('2026-10-20') }),
      summary('Al'),
      summary('Cy', { nextSession: session('2026-10-15', '09:00') }),
      summary('Di', { nextSession: session('2026-10-20') }),
      summary('Ed', { nextSession: session('2026-10-15', '08:00') }),
      summary('Fy'),
    ];
    expect(names(sortSummaries(list, 'lesson'))).toEqual(['Ed', 'Cy', 'Bo', 'Di', 'Al', 'Fy']);
  });

  test('next due soonest: overdue first, nothing due last, ties by name', () => {
    const list = [
      summary('Bo', { next: due('2026-10-20') }),
      summary('Al'),
      summary('Cy', { next: due('2026-10-10') }),
      summary('Di', { next: due('2026-10-20') }),
      summary('Ed', { next: due('2026-10-16') }),
    ];
    expect(names(sortSummaries(list, 'due'))).toEqual(['Cy', 'Ed', 'Bo', 'Di', 'Al']);
  });

  test('completion: lowest rate first, no results last, ties by name', () => {
    const done = (rate) => ({ completion: { completed: 0, missing: 0, total: rate === null ? 0 : 10, rate, extended: 0 } });
    const list = [
      summary('Bo', done(0.9)),
      summary('Al'),
      summary('Cy', done(0.6)),
      summary('Di', done(0.9)),
      summary('Ed', done(0)),
      summary('Fy', done(null)),
    ];
    expect(names(sortSummaries(list, 'completion'))).toEqual(['Ed', 'Cy', 'Bo', 'Di', 'Al', 'Fy']);
  });

  test('sorting returns a new array and leaves the input alone', () => {
    const list = [summary('B'), summary('A')];
    const sorted = sortSummaries(list, 'name');
    expect(sorted).not.toBe(list);
    expect(names(list)).toEqual(['B', 'A']);
    expect(sortSummaries(null)).toEqual([]);
  });
});

describe('visibleStudents', () => {
  const list = [
    summary('Maya Lin', { review: 2, overdue: 1, tutors: [tutor('t1', 'Daniel')], completion: { rate: 0.9 }, nextSession: session('2026-10-15') }),
    summary('Leo Park', { review: 0, overdue: 2, tutors: [tutor('t1', 'Daniel')], completion: { rate: 0.5 }, next: due('2026-10-10') }),
    summary('Ava Chen', { review: 1, tutors: [tutor('t2', 'Priya')], completion: { rate: 0.75 }, nextSession: session('2026-10-16') }),
    summary('Mateo Diaz', { tutors: [tutor('t2', 'Priya')], overdue: 1 }),
  ];
  const view = (extra = {}) => ({ ...DEFAULT_VIEW, ...extra });

  test('the default view shows everyone by name', () => {
    expect(names(visibleStudents(list, DEFAULT_VIEW, { now: NOW }))).toEqual(['Ava Chen', 'Leo Park', 'Mateo Diaz', 'Maya Lin']);
  });

  test('a quick filter narrows the list', () => {
    expect(names(visibleStudents(list, view({ filter: 'review' }), { now: NOW }))).toEqual(['Ava Chen', 'Maya Lin']);
    expect(names(visibleStudents(list, view({ filter: 'overdue' }), { now: NOW }))).toEqual(['Leo Park', 'Mateo Diaz', 'Maya Lin']);
    expect(names(visibleStudents(list, view({ filter: 'nolesson' }), { now: NOW }))).toEqual(['Leo Park', 'Mateo Diaz']);
  });

  test('tutor, filter, search and sort combine', () => {
    expect(names(visibleStudents(list, view({ tutor: 't2' }), { now: NOW }))).toEqual(['Ava Chen', 'Mateo Diaz']);
    expect(names(visibleStudents(list, view({ tutor: 't2', filter: 'overdue' }), { now: NOW }))).toEqual(['Mateo Diaz']);
    expect(names(visibleStudents(list, view({ filter: 'overdue' }), { now: NOW, term: 'ma' }))).toEqual(['Mateo Diaz', 'Maya Lin']);
    expect(names(visibleStudents(list, view({ filter: 'overdue', sort: 'completion' }), { now: NOW }))).toEqual(['Leo Park', 'Maya Lin', 'Mateo Diaz']);
    expect(names(visibleStudents(list, view({ tutor: 't1', filter: 'review', sort: 'due' }), { now: NOW, term: 'lin' }))).toEqual(['Maya Lin']);
  });

  test('a combination with no match is empty', () => {
    expect(visibleStudents(list, view({ tutor: 't2', filter: 'review' }), { now: NOW, term: 'zzz' })).toEqual([]);
  });

  test('sort picks the order after filtering', () => {
    expect(names(visibleStudents(list, view({ sort: 'review' }), { now: NOW }))).toEqual(['Maya Lin', 'Ava Chen', 'Leo Park', 'Mateo Diaz']);
    expect(names(visibleStudents(list, view({ sort: 'lesson' }), { now: NOW }))).toEqual(['Maya Lin', 'Ava Chen', 'Leo Park', 'Mateo Diaz']);
    expect(names(visibleStudents(list, view({ sort: 'completion' }), { now: NOW }))).toEqual(['Leo Park', 'Ava Chen', 'Maya Lin', 'Mateo Diaz']);
  });

  test('a junk view falls back to the default instead of throwing', () => {
    expect(visibleStudents(list, { filter: 'x', sort: 'y', tutor: {} }, { now: NOW })).toHaveLength(4);
    expect(visibleStudents(list, null, { now: NOW })).toHaveLength(4);
  });

  test('does not change the input', () => {
    const before = names(list);
    visibleStudents(list, view({ sort: 'completion' }), { now: NOW });
    expect(names(list)).toEqual(before);
  });
});

describe('what narrows the list', () => {
  test('narrowing names the cause', () => {
    expect(narrowing(DEFAULT_VIEW, '')).toEqual({ filter: false, tutor: false, search: false, any: false });
    expect(narrowing(DEFAULT_VIEW, '  ')).toMatchObject({ search: false, any: false });
    expect(narrowing(DEFAULT_VIEW, 'ma')).toMatchObject({ search: true, any: true });
    expect(narrowing({ ...DEFAULT_VIEW, filter: 'review' })).toMatchObject({ filter: true, tutor: false, any: true });
    expect(narrowing({ ...DEFAULT_VIEW, tutor: 't1' })).toMatchObject({ filter: false, tutor: true, any: true });
    expect(narrowing({ ...DEFAULT_VIEW, sort: 'completion' }).any).toBe(false);
  });

  test('the empty result words follow the cause', () => {
    expect(emptyMessage(narrowing(DEFAULT_VIEW, 'zz'))).toBe('No student matches that search.');
    expect(clearLabel(narrowing(DEFAULT_VIEW, 'zz'))).toBe('Clear search');
    const filtered = narrowing({ ...DEFAULT_VIEW, filter: 'overdue' }, 'zz');
    expect(emptyMessage(filtered)).toBe('No students match these filters.');
    expect(clearLabel(filtered)).toBe('Clear filters');
    expect(clearLabel(narrowing({ ...DEFAULT_VIEW, tutor: 't1' }))).toBe('Clear filters');
  });

  test('clearing resets the filter and tutor and keeps the sort', () => {
    expect(clearedView({ filter: 'review', tutor: 't1', sort: 'completion' })).toEqual({ filter: 'all', tutor: 'all', sort: 'completion' });
    expect(clearedView(null)).toEqual(DEFAULT_VIEW);
  });

  test('isDefaultView', () => {
    expect(isDefaultView(DEFAULT_VIEW)).toBe(true);
    expect(isDefaultView(null)).toBe(true);
    expect(isDefaultView({ ...DEFAULT_VIEW, sort: 'due' })).toBe(false);
    expect(isDefaultView({ ...DEFAULT_VIEW, tutor: 't1' })).toBe(false);
    expect(isDefaultView({ ...DEFAULT_VIEW, filter: 'review' })).toBe(false);
  });
});

describe('normalizeView', () => {
  test('a valid view passes through', () => {
    expect(normalizeView({ filter: 'overdue', tutor: 't1', sort: 'lesson' })).toEqual({ filter: 'overdue', tutor: 't1', sort: 'lesson' });
  });

  test('a stored JSON string is read', () => {
    expect(normalizeView('{"filter":"review","tutor":"all","sort":"completion"}')).toEqual({ filter: 'review', tutor: 'all', sort: 'completion' });
  });

  test('the old sort by average score becomes the sort by completion', () => {
    expect(normalizeView('{"filter":"all","tutor":"all","sort":"average"}')).toEqual({ filter: 'all', tutor: 'all', sort: 'completion' });
  });

  test('junk gives the default view', () => {
    for (const raw of [null, undefined, '', 'not json', '{bad', '[]', '"x"', '5', 5, true, [], ['review']]) {
      expect(normalizeView(raw)).toEqual(DEFAULT_VIEW);
    }
  });

  test('an unknown filter or sort falls back, field by field', () => {
    expect(normalizeView({ filter: 'bogus', tutor: 't1', sort: 'lesson' })).toEqual({ filter: 'all', tutor: 't1', sort: 'lesson' });
    expect(normalizeView({ filter: 'review', tutor: 't1', sort: 'bogus' })).toEqual({ filter: 'review', tutor: 't1', sort: 'name' });
    expect(normalizeView({ filter: 7, sort: {} , tutor: {} })).toEqual(DEFAULT_VIEW);
    expect(normalizeView({})).toEqual(DEFAULT_VIEW);
  });

  test('a tutor id is trimmed, numbers become text, blank or huge ids mean all', () => {
    expect(normalizeView({ tutor: ' t1 ' }).tutor).toBe('t1');
    expect(normalizeView({ tutor: 42 }).tutor).toBe('42');
    expect(normalizeView({ tutor: '   ' }).tutor).toBe('all');
    expect(normalizeView({ tutor: 'x'.repeat(65) }).tutor).toBe('all');
    expect(normalizeView({ tutor: null }).tutor).toBe('all');
  });

  test('a tutor who no longer exists falls back to all when the tutors are known', () => {
    expect(normalizeView({ tutor: 't9' }, { tutorIds: ['t1', 't2'] }).tutor).toBe('all');
    expect(normalizeView({ tutor: 't2' }, { tutorIds: ['t1', 't2'] }).tutor).toBe('t2');
    expect(normalizeView({ tutor: 't2' }, { tutorIds: [] }).tutor).toBe('all');
    expect(normalizeView({ tutor: 't9' }, { tutorIds: null }).tutor).toBe('t9');
  });

  test('a quick filter that is not on offer falls back to all', () => {
    const filters = ['review', 'overdue'];
    expect(normalizeView({ filter: 'nolesson' }, { filters }).filter).toBe('all');
    expect(normalizeView({ filter: 'overdue' }, { filters }).filter).toBe('overdue');
  });

  test('never returns the shared default object', () => {
    expect(normalizeView(null)).not.toBe(DEFAULT_VIEW);
    expect(Object.isFrozen(DEFAULT_VIEW)).toBe(true);
  });
});

describe('keeping the view per user', () => {
  const store = (initial = {}) => {
    const data = { ...initial };
    return {
      data,
      getItem: (k) => (k in data ? data[k] : null),
      setItem: (k, v) => { data[k] = String(v); },
      removeItem: (k) => { delete data[k]; },
    };
  };

  test('the key names the user', () => {
    expect(viewKey('u-admin')).toBe('vb-students-view-u-admin');
  });

  test('saves and loads a view', () => {
    const storage = store();
    const view = { filter: 'review', tutor: 't1', sort: 'completion' };
    expect(saveView('u1', view, storage)).toBe(true);
    expect(JSON.parse(storage.data['vb-students-view-u1'])).toEqual(view);
    expect(loadView('u1', storage)).toEqual(view);
  });

  test('each user keeps their own', () => {
    const storage = store();
    saveView('u1', { filter: 'review', tutor: 'all', sort: 'name' }, storage);
    saveView('u2', { filter: 'all', tutor: 't3', sort: 'due' }, storage);
    expect(loadView('u1', storage).filter).toBe('review');
    expect(loadView('u2', storage)).toEqual({ filter: 'all', tutor: 't3', sort: 'due' });
    expect(loadView('u3', storage)).toEqual(DEFAULT_VIEW);
  });

  test('saving the default view clears the entry', () => {
    const storage = store();
    saveView('u1', { filter: 'review', tutor: 'all', sort: 'name' }, storage);
    expect(saveView('u1', DEFAULT_VIEW, storage)).toBe(true);
    expect(storage.data).toEqual({});
  });

  test('saving cleans a bad view first', () => {
    const storage = store();
    saveView('u1', { filter: 'bogus', tutor: 't1', sort: 'due' }, storage);
    expect(JSON.parse(storage.data['vb-students-view-u1'])).toEqual({ filter: 'all', tutor: 't1', sort: 'due' });
  });

  test('a damaged stored value loads as the default', () => {
    expect(loadView('u1', store({ 'vb-students-view-u1': '{not json' }))).toEqual(DEFAULT_VIEW);
    expect(loadView('u1', store({ 'vb-students-view-u1': '{"filter":"zzz","sort":"zzz"}' }))).toEqual(DEFAULT_VIEW);
  });

  test('blocked or missing storage never throws', () => {
    const blocked = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(loadView('u1', blocked)).toEqual(DEFAULT_VIEW);
    expect(saveView('u1', { filter: 'review', tutor: 'all', sort: 'name' }, blocked)).toBe(false);
    expect(saveView('u1', DEFAULT_VIEW, blocked)).toBe(false);
    expect(loadView('u1', undefined)).toEqual(DEFAULT_VIEW);
    expect(saveView('u1', DEFAULT_VIEW, undefined)).toBe(false);
    expect(loadView('u1', {})).toEqual(DEFAULT_VIEW);
  });

  test('without a user id nothing is read or written', () => {
    const storage = store({ 'vb-students-view-undefined': '{"filter":"review"}', 'vb-students-view-': '{"filter":"review"}' });
    for (const id of [null, undefined, '']) {
      expect(loadView(id, storage)).toEqual(DEFAULT_VIEW);
      expect(saveView(id, { filter: 'review', tutor: 'all', sort: 'name' }, storage)).toBe(false);
    }
    expect(Object.keys(storage.data)).toHaveLength(2);
  });
});

describe('studentSummaries feeds the filters', () => {
  const ws = {
    students: [
      { id: 's1', full_name: 'Maya Lin', email: 'maya@example.com' },
      { id: 's2', full_name: 'Leo Park', email: 'leo@example.com' },
      { id: 's3', full_name: 'Ava Ruiz', email: 'ava@example.com' },
    ],
    tasks: [
      { id: 1, student_id: 's1', kind: 'assignment', title: 'Late essay', due_at: at('2026-10-10', '23:59'), completed_at: null, created_at: '2026-10-01T00:00:00Z' },
      { id: 2, student_id: 's1', kind: 'task', title: 'Bring calculator', due_at: at('2026-10-12', '23:59'), completed_at: null, created_at: '2026-10-01T00:00:00Z' },
      { id: 3, student_id: 's1', kind: 'task', title: 'Done task', due_at: at('2026-10-11', '23:59'), completed_at: '2026-10-11T18:00:00Z', created_at: '2026-10-01T00:00:00Z' },
      { id: 4, student_id: 's2', kind: 'assignment', title: 'Future set', due_at: at('2026-10-20', '23:59'), completed_at: null, created_at: '2026-10-01T00:00:00Z' },
      { id: 5, student_id: 's3', kind: 'assignment', title: 'Handed in late', due_at: at('2026-10-09', '23:59'), completed_at: null, created_at: '2026-10-01T00:00:00Z' },
      { id: 6, student_id: 's3', kind: 'assignment', title: 'Undated', due_at: null, completed_at: null, created_at: '2026-10-01T00:00:00Z' },
    ],
    submissions: [
      { id: 90, task_id: 5, student_id: 's3', status: 'ai_graded', attempts: 1, created_at: '2026-10-12T00:00:00Z', grade: null },
    ],
    sessions: [],
    links: [],
  };

  test('overdue counts open assignments and tasks past due, not done, handed in or undated work', () => {
    const [maya, leo, ava] = studentSummaries(ws, NOW);
    expect(maya.overdue).toBe(2);
    expect(leo.overdue).toBe(0);
    expect(ava.overdue).toBe(0);
  });

  test('30-day completion: released results and work never handed in, from the same helper as the Overview', () => {
    const [maya, leo, ava] = studentSummaries(ws, NOW);
    // Maya's late essay was never handed in: missing. Tasks never count.
    expect(maya.completion).toEqual({ completed: 0, missing: 1, total: 1, rate: 0, extended: 0 });
    expect(leo.completion).toMatchObject({ total: 0, rate: null });
    // Ava's work waits for review: nothing decided yet
    expect(ava.completion).toMatchObject({ total: 0, rate: null });
    const graded = {
      ...ws,
      submissions: [{ ...ws.submissions[0], grade: { result: 'completed', released_at: '2026-10-13T00:00:00Z' } }],
    };
    expect(studentSummaries(graded, NOW)[2].completion).toMatchObject({ completed: 1, total: 1, rate: 1 });
    expect(names(sortSummaries(studentSummaries(graded, NOW), 'completion'))).toEqual(['Maya Lin', 'Ava Ruiz', 'Leo Park']);
  });

  test('the filters read those summaries', () => {
    const summaries = studentSummaries(ws, NOW);
    expect(names(visibleStudents(summaries, { ...DEFAULT_VIEW, filter: 'overdue' }, { now: NOW }))).toEqual(['Maya Lin']);
    expect(names(visibleStudents(summaries, { ...DEFAULT_VIEW, filter: 'review' }, { now: NOW }))).toEqual(['Ava Ruiz']);
    expect(names(visibleStudents(summaries, { ...DEFAULT_VIEW, filter: 'nolesson' }, { now: NOW }))).toEqual(['Ava Ruiz', 'Leo Park', 'Maya Lin']);
  });
});
