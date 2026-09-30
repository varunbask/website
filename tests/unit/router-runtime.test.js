import { describe, test, expect } from 'vitest';
import { nextDepth, withParams, parseHash, isRouteHash } from '../../portal/js/router.js';

const TABLE = { assignments: { subs: ['todo', 'graded'] }, review: { id: true } };
const r = (hash) => parseHash(hash, TABLE);

describe('nextDepth (the drawer history rule)', () => {
  test('no drawer is always 0', () => {
    expect(nextDepth('push', r('#/assignments/todo?open=1'), r('#/assignments/todo'), 1)).toBe(0);
    expect(nextDepth('pop', null, r('#/assignments/todo'), 3, { vb: true, depth: 2 })).toBe(0);
  });

  test('opening the drawer over the same view pushes one entry', () => {
    expect(nextDepth('push', r('#/assignments/todo'), r('#/assignments/todo?open=1'), 0)).toBe(1);
  });

  test('switching items inside the drawer grows the chain', () => {
    expect(nextDepth('push', r('#/assignments/todo?open=1'), r('#/assignments/todo?open=2'), 1)).toBe(2);
  });

  test('a drawer that opened on load or by replace is not a pushed chain', () => {
    expect(nextDepth('initial', null, r('#/assignments/todo?open=1'), 0, null)).toBe(0);
    expect(nextDepth('push', r('#/assignments/todo?open=1'), r('#/assignments/todo?open=2'), 0)).toBe(0);
    expect(nextDepth('replace', r('#/assignments/todo'), r('#/assignments/todo?open=2'), 0)).toBe(0);
  });

  test('replace keeps the chain when a drawer entry is swapped', () => {
    expect(nextDepth('replace', r('#/assignments/todo?open=1'), r('#/assignments/todo?focus=submit&open=1'), 2)).toBe(2);
  });

  test('a drawer on another view is never closed by going back', () => {
    expect(nextDepth('push', r('#/assignments/todo'), r('#/assignments/graded?open=1'), 0)).toBe(0);
  });

  test('back and forward read the depth stored on the entry', () => {
    expect(nextDepth('pop', null, r('#/assignments/todo?open=1'), 0, { vb: true, depth: 1 })).toBe(1);
    expect(nextDepth('pop', null, r('#/assignments/todo?open=1'), 0, null)).toBe(0);
    expect(nextDepth('initial', null, r('#/assignments/todo?open=1'), 0, { vb: true, depth: 2 })).toBe(2);
  });
});

describe('withParams', () => {
  test('sets and removes params without touching the rest', () => {
    const next = withParams(r('#/assignments/todo?m=2026-10&open=3'), { m: '2026-11', open: null, d: '' });
    expect(next).toEqual({ view: 'assignments', sub: 'todo', id: null, params: { m: '2026-11' } });
  });
});

describe('isRouteHash', () => {
  test('app routes and an empty hash are routes', () => {
    expect(isRouteHash('#/tasks')).toBe(true);
    expect(isRouteHash('#/assignments/todo?open=1')).toBe(true);
    expect(isRouteHash('')).toBe(true);
    expect(isRouteHash('#')).toBe(true);
  });

  test('an in-page anchor such as the skip link is not a route', () => {
    expect(isRouteHash('#main')).toBe(false);
    expect(isRouteHash('#people-message')).toBe(false);
  });
});
