import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { STALE_MS, isStale, oldestStamp } from '../../portal/js/freshness.js';

// The store builds a Supabase client from the page's global; give it a fake
// that answers every query with no rows and counts the queries
const queries = vi.hoisted(() => []);
vi.mock('../../portal/js/supabase.js', () => {
  const fake = (table) => {
    queries.push(table);
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, range: () => q,
      then: (ok, bad) => Promise.resolve({ data: [], error: null }).then(ok, bad),
    };
    return q;
  };
  return { sb: { from: fake, rpc: (name) => { queries.push(name); return Promise.resolve({ data: [], error: null }); } } };
});
const store = await import('../../portal/js/store.js');

const MIN = 60_000;
const T0 = Date.parse('2026-10-14T19:00:00Z');
const count = (table) => queries.filter((t) => t === table).length;
const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('isStale', () => {
  test('the window is the app refresh window, 5 minutes', () => {
    expect(STALE_MS).toBe(5 * MIN);
  });

  test('older than the window is stale, up to it is not', () => {
    expect(isStale(T0, T0 + 4 * MIN)).toBe(false);
    expect(isStale(T0, T0 + 5 * MIN)).toBe(false);
    expect(isStale(T0, T0 + 5 * MIN + 1)).toBe(true);
    expect(isStale(T0, T0 + 9 * 3_600_000)).toBe(true);
  });

  test('a different window can be given', () => {
    expect(isStale(T0, T0 + 2 * MIN, MIN)).toBe(true);
    expect(isStale(T0, T0 + 2 * MIN, 3 * MIN)).toBe(false);
  });

  test('takes Dates as well as milliseconds', () => {
    expect(isStale(new Date(T0), new Date(T0 + 6 * MIN))).toBe(true);
    expect(isStale(new Date(T0), T0 + MIN)).toBe(false);
  });

  test('nothing cached is not stale: there is nothing to refresh', () => {
    expect(isStale(null, T0)).toBe(false);
    expect(isStale(undefined, T0)).toBe(false);
    expect(isStale('', T0)).toBe(false);
    expect(isStale(Number.NaN, T0)).toBe(false);
    expect(isStale('soon', T0)).toBe(false);
  });

  test('a clock that went backwards is not stale', () => {
    expect(isStale(T0, T0 - 10 * MIN)).toBe(false);
  });
});

describe('oldestStamp', () => {
  test('the earliest known load time', () => {
    expect(oldestStamp([T0 + 3 * MIN, T0, T0 + MIN])).toBe(T0);
    expect(oldestStamp([new Date(T0 + MIN), T0 + 2 * MIN])).toBe(T0 + MIN);
  });

  test('pieces still loading or unusable are ignored', () => {
    expect(oldestStamp([undefined, T0 + MIN, null, Number.NaN])).toBe(T0 + MIN);
  });

  test('nothing known is null', () => {
    expect(oldestStamp([])).toBeNull();
    expect(oldestStamp(null)).toBeNull();
    expect(oldestStamp([undefined, null])).toBeNull();
  });
});

describe('store.dropIfStale', () => {
  let changes;
  let unsubscribe;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    queries.length = 0;
    store.invalidateAll();
    changes = vi.fn();
    unsubscribe = store.onChange(changes);
    return tick().then(() => { changes.mockClear(); });
  });
  afterEach(() => {
    unsubscribe();
    vi.useRealTimers();
  });

  test('a cache inside the window is kept and served again without a query', async () => {
    await store.getStudentData('b');
    await store.getSessions('b');
    expect(count('tasks')).toBe(1);
    vi.setSystemTime(T0 + 4 * MIN);
    expect(store.dropIfStale('b')).toBe(false);
    await store.getStudentData('b');
    await store.getSessions('b');
    expect(count('tasks')).toBe(1);
    expect(count('sessions')).toBe(1);
  });

  test('a sibling left overnight is dropped and its next read loads again', async () => {
    await store.getStudentData('b');
    await store.getSessions('b');
    vi.setSystemTime(T0 + 9 * 3_600_000);
    expect(store.dropIfStale('b')).toBe(true);
    await store.getStudentData('b');
    await store.getSessions('b');
    expect(count('tasks')).toBe(2);
    expect(count('submissions')).toBe(2);
    expect(count('sessions')).toBe(2);
  });

  test('dropping is quiet: no change event, so no view remounts', async () => {
    await store.getStudentData('b');
    vi.setSystemTime(T0 + 20 * MIN);
    expect(store.dropIfStale('b')).toBe(true);
    await tick();
    expect(changes).not.toHaveBeenCalled();
  });

  test('only that student is dropped', async () => {
    await store.getStudentData('a');
    vi.setSystemTime(T0 + 10 * MIN);
    await store.getStudentData('b');
    expect(store.dropIfStale('b')).toBe(false);
    expect(store.dropIfStale('a')).toBe(true);
    await store.getStudentData('b');
    expect(count('tasks')).toBe(2);   // a once, b once; b was not reloaded
    await store.getStudentData('a');
    expect(count('tasks')).toBe(3);
  });

  test('the cache is as old as its oldest piece', async () => {
    await store.getSessions('b');
    vi.setSystemTime(T0 + 6 * MIN);
    await store.getStudentData('b');
    expect(store.cachedSince('b')).toBe(T0);
    expect(store.dropIfStale('b')).toBe(true);
    expect(store.cachedSince('b')).toBeNull();
  });

  test('nothing cached, or a load still running, is never dropped', async () => {
    expect(store.dropIfStale('nobody')).toBe(false);
    expect(store.dropIfStale(null)).toBe(false);
    const pending = store.getStudentData('c');
    vi.setSystemTime(T0 + 30 * MIN);
    expect(store.cachedSince('c')).toBeNull();
    expect(store.dropIfStale('c')).toBe(false);
    await pending;
  });

  test('a window can be passed', async () => {
    await store.getStudentData('b');
    vi.setSystemTime(T0 + 2 * MIN);
    expect(store.dropIfStale('b', { maxAge: MIN })).toBe(true);
  });
});
