import { describe, test, expect } from 'vitest';
import { parseHash, buildHash, sameView, withoutDrawer, DRAWER_PARAMS } from '../../portal/js/router.js';

// A page route table: `id: true` means the second segment is an id, not a sub
const TABLE = {
  overview: {},
  assignments: { subs: ['todo', 'in-review', 'graded', 'archived'] },
  review: { id: true },
  calendar: {},
};

describe('parseHash', () => {
  test('view, sub and params', () => {
    expect(parseHash('#/assignments/graded?open=12', TABLE))
      .toEqual({ view: 'assignments', sub: 'graded', id: null, params: { open: '12' } });
  });

  test('a second segment declared as an id', () => {
    expect(parseHash('#/review/481', TABLE)).toEqual({ view: 'review', sub: null, id: '481', params: {} });
    expect(parseHash('#/review?filter=draft', TABLE)).toEqual({ view: 'review', sub: null, id: null, params: { filter: 'draft' } });
  });

  test('view, sub and id together', () => {
    expect(parseHash('#/assignments/graded/9', TABLE)).toEqual({ view: 'assignments', sub: 'graded', id: '9', params: {} });
  });

  test('without a table the second segment is a sub', () => {
    expect(parseHash('#/review/481')).toEqual({ view: 'review', sub: '481', id: null, params: {} });
  });

  test('empty and odd hashes', () => {
    const empty = { view: null, sub: null, id: null, params: {} };
    expect(parseHash('', TABLE)).toEqual(empty);
    expect(parseHash('#', TABLE)).toEqual(empty);
    expect(parseHash('#/', TABLE)).toEqual(empty);
    expect(parseHash(undefined, TABLE)).toEqual(empty);
    expect(parseHash('#/overview/', TABLE)).toEqual({ view: 'overview', sub: null, id: null, params: {} });
    expect(parseHash('/overview', TABLE)).toEqual({ view: 'overview', sub: null, id: null, params: {} });
  });

  test('decodes params', () => {
    expect(parseHash('#/calendar?view=month&m=2026-10&d=2026-10-14&scope=all', TABLE).params)
      .toEqual({ view: 'month', m: '2026-10', d: '2026-10-14', scope: 'all' });
    expect(parseHash('#/overview?x=a%20b', TABLE).params).toEqual({ x: 'a b' });
  });
});

describe('buildHash', () => {
  test('is the inverse of parseHash, with sorted params', () => {
    expect(buildHash({ view: 'assignments', sub: 'graded', id: null, params: { open: '12' } })).toBe('#/assignments/graded?open=12');
    expect(buildHash({ view: 'review', id: '481' })).toBe('#/review/481');
    expect(buildHash({ view: 'calendar', params: { view: 'month', d: '2026-10-14', m: '2026-10' } }))
      .toBe('#/calendar?d=2026-10-14&m=2026-10&view=month');
  });

  test('drops empty params and stringifies numbers', () => {
    expect(buildHash({ view: 'assignments', sub: 'todo', params: { open: 12, focus: null, kind: undefined, due: '' } }))
      .toBe('#/assignments/todo?open=12');
  });

  test('round trips', () => {
    for (const hash of ['#/assignments/graded?open=12', '#/review/481?filter=draft', '#/calendar?m=2026-10&scope=all', '#/overview']) {
      expect(buildHash(parseHash(hash, TABLE))).toBe(hash);
    }
  });
});

describe('sameView', () => {
  const r = (hash) => parseHash(hash, TABLE);

  test('ignores drawer params only', () => {
    expect(DRAWER_PARAMS).toEqual(['open', 'focus', 'kind', 'due']);
    expect(sameView(r('#/assignments/todo'), r('#/assignments/todo?open=5'))).toBe(true);
    expect(sameView(r('#/assignments/todo?open=5&focus=submit'), r('#/assignments/todo?open=6'))).toBe(true);
    expect(sameView(r('#/calendar?open=new&kind=task&due=2026-10-14'), r('#/calendar'))).toBe(true);
  });

  test('differs on view, sub, id or any other param', () => {
    expect(sameView(r('#/assignments/todo'), r('#/assignments/graded'))).toBe(false);
    expect(sameView(r('#/assignments/todo'), r('#/tasks'))).toBe(false);
    expect(sameView(r('#/review/1'), r('#/review/2'))).toBe(false);
    expect(sameView(r('#/calendar'), r('#/calendar?scope=all'))).toBe(false);
    expect(sameView(r('#/calendar?m=2026-10'), r('#/calendar?m=2026-11'))).toBe(false);
  });

  test('treats missing and empty values alike, and tolerates null', () => {
    expect(sameView({ view: 'tasks' }, { view: 'tasks', sub: null, id: null, params: {} })).toBe(true);
    expect(sameView({ view: 'tasks', params: { x: '' } }, { view: 'tasks' })).toBe(true);
    expect(sameView(null, { view: 'tasks' })).toBe(false);
    expect(sameView(null, null)).toBe(true);
  });
});

describe('withoutDrawer', () => {
  test('removes only drawer params', () => {
    expect(withoutDrawer(parseHash('#/calendar?m=2026-10&open=4&focus=submit', TABLE)))
      .toEqual({ view: 'calendar', sub: null, id: null, params: { m: '2026-10' } });
  });
});
