import { describe, test, expect } from 'vitest';
import {
  FIRST_VISIT_DAYS, seenKey, getSeen, markSeen, isNewSince, hasNewSince,
} from '../../portal/js/seen.js';

const NOW = new Date('2026-10-14T19:00:00Z');
const DAY = 86_400_000;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

// A tiny in-memory stand-in for localStorage
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    map,
  };
}
const broken = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
};

describe('seenKey', () => {
  test('per kind, viewer and student', () => {
    expect(seenKey('graded', 'v1', 's1')).toBe('vb-seen-graded-v1-s1');
    expect(seenKey('updates', 'p9', 's2')).toBe('vb-seen-updates-p9-s2');
  });
});

describe('storage', () => {
  test('markSeen stores now; getSeen reads it back', () => {
    const storage = memoryStorage();
    expect(getSeen('graded', 'v1', 's1', storage)).toBeNull();
    expect(markSeen('graded', 'v1', 's1', NOW, storage)).toBe(true);
    expect(storage.map.get('vb-seen-graded-v1-s1')).toBe('2026-10-14T19:00:00.000Z');
    expect(getSeen('graded', 'v1', 's1', storage)).toBe('2026-10-14T19:00:00.000Z');
    expect(getSeen('graded', 'v1', 's2', storage)).toBeNull();
    expect(getSeen('updates', 'v1', 's1', storage)).toBeNull();
  });

  test('a parent with two children keeps separate states', () => {
    const storage = memoryStorage();
    markSeen('updates', 'p1', 'kid-a', NOW, storage);
    expect(getSeen('updates', 'p1', 'kid-a', storage)).not.toBeNull();
    expect(getSeen('updates', 'p1', 'kid-b', storage)).toBeNull();
  });

  test('failing or missing storage reads as unavailable and never throws', () => {
    expect(getSeen('graded', 'v1', 's1', broken)).toBeUndefined();
    expect(markSeen('graded', 'v1', 's1', NOW, broken)).toBe(false);
    expect(getSeen('graded', 'v1', 's1', null)).toBeUndefined();
    expect(markSeen('graded', 'v1', 's1', NOW, null)).toBe(false);
  });

  test('defaults to the global localStorage, which may be missing in node', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    try {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
      expect(getSeen('graded', 'v1', 's1')).toBeUndefined();
      expect(markSeen('graded', 'v1', 's1', NOW)).toBe(false);
      const storage = memoryStorage();
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
      expect(markSeen('graded', 'v1', 's1', NOW)).toBe(true);
      expect(getSeen('graded', 'v1', 's1')).toBe(NOW.toISOString());
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete globalThis.localStorage;
    }
  });

  test('a junk stored value counts as never seen', () => {
    const storage = memoryStorage();
    storage.setItem(seenKey('graded', 'v1', 's1'), 'not a date');
    expect(getSeen('graded', 'v1', 's1', storage)).toBeNull();
  });
});

describe('isNewSince and hasNewSince', () => {
  test('after a visit: newer than the stored time', () => {
    const seen = ago(DAY);
    expect(isNewSince(ago(DAY / 2), seen, NOW)).toBe(true);
    expect(isNewSince(ago(DAY), seen, NOW)).toBe(false);
    expect(isNewSince(ago(2 * DAY), seen, NOW)).toBe(false);
  });

  test('first visit: only the last 7 days', () => {
    expect(FIRST_VISIT_DAYS).toBe(7);
    expect(isNewSince(ago(7 * DAY), null, NOW)).toBe(true);
    expect(isNewSince(ago(7 * DAY + 1), null, NOW)).toBe(false);
  });

  test('storage unavailable: never new', () => {
    expect(isNewSince(ago(1000), undefined, NOW)).toBe(false);
  });

  test('missing timestamps are never new', () => {
    expect(isNewSince(null, null, NOW)).toBe(false);
  });

  test('hasNewSince checks a list', () => {
    expect(hasNewSince([ago(30 * DAY), ago(DAY)], null, NOW)).toBe(true);
    expect(hasNewSince([ago(30 * DAY)], null, NOW)).toBe(false);
    expect(hasNewSince([], null, NOW)).toBe(false);
    expect(hasNewSince([ago(DAY)], undefined, NOW)).toBe(false);
  });
});
