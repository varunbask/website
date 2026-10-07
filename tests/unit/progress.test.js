import { describe, test, expect } from 'vitest';
import { completionStats, percent } from '../../portal/js/progress.js';

const NOW = new Date('2026-10-10T12:00:00Z');
const day = (d) => `2026-10-${String(d).padStart(2, '0')}T12:00:00Z`;

describe('completionStats', () => {
  test('counts completion, on-time work, and overdue work', () => {
    const items = [
      { due_at: day(5), completed_at: day(4) },   // on time
      { due_at: day(6), completed_at: day(8) },   // late
      { due_at: day(7), completed_at: null },     // overdue, counts as late
      { due_at: day(20), completed_at: null },    // not due yet: not judged
      { due_at: day(20), completed_at: day(9) },  // done early: on time
      { due_at: null, completed_at: day(3) },     // no due date: done but not judged
    ];
    expect(completionStats(items, NOW)).toEqual({
      total: 6, done: 4, completionRate: 4 / 6, judged: 4, onTime: 2, onTimeRate: 0.5, overdue: 1,
    });
  });

  test('rates are null when there is nothing to measure', () => {
    expect(completionStats([], NOW)).toMatchObject({ total: 0, completionRate: null, onTimeRate: null, overdue: 0 });
  });
});

describe('percent', () => {
  test('rounds a rate to a whole percent', () => {
    expect(percent(0.666)).toBe('67%');
    expect(percent(null)).toBeNull();
  });
});
