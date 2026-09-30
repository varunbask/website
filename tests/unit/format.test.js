import { describe, test, expect } from 'vitest';
import {
  formatDate, dueDateToIso, isoToDateInput, firstName, displayName, one, isOverdue, byDue,
} from '../../portal/js/format.js';

describe('format helpers', () => {
  test('formatDate gives a short US date, or nothing', () => {
    expect(formatDate('2026-10-03T12:00:00Z')).toBe('Oct 3, 2026');
    expect(formatDate(null)).toBe('');
  });

  test('a due date round-trips through the date input', () => {
    expect(isoToDateInput(dueDateToIso('2026-10-03'))).toBe('2026-10-03');
    expect(dueDateToIso('')).toBeNull();
    expect(isoToDateInput(null)).toBe('');
  });

  test('names', () => {
    expect(firstName('Jerry  Chen')).toBe('Jerry');
    expect(firstName('')).toBe('there');
    expect(displayName({ full_name: ' ', email: 'a@b.co' })).toBe('a@b.co');
    expect(displayName({ full_name: 'Ana Ruiz', email: 'a@b.co' })).toBe('Ana Ruiz');
  });

  test('one() accepts an object, an array, or nothing', () => {
    expect(one({ a: 1 })).toEqual({ a: 1 });
    expect(one([{ a: 1 }])).toEqual({ a: 1 });
    expect(one([])).toBeNull();
    expect(one(undefined)).toBeNull();
  });

  test('isOverdue only for open items past their due date', () => {
    const now = new Date('2026-10-05T00:00:00Z');
    expect(isOverdue({ due_at: '2026-10-04T00:00:00Z', completed_at: null }, now)).toBe(true);
    expect(isOverdue({ due_at: '2026-10-04T00:00:00Z', completed_at: '2026-10-03T00:00:00Z' }, now)).toBe(false);
    expect(isOverdue({ due_at: null, completed_at: null }, now)).toBe(false);
  });

  test('byDue sorts by due date with undated items last', () => {
    const items = [
      { id: 1, due_at: null, created_at: '2026-10-01T00:00:00Z' },
      { id: 2, due_at: '2026-10-09T00:00:00Z', created_at: '2026-10-01T00:00:00Z' },
      { id: 3, due_at: '2026-10-02T00:00:00Z', created_at: '2026-10-01T00:00:00Z' },
    ];
    expect(items.sort(byDue).map((t) => t.id)).toEqual([3, 2, 1]);
  });
});
