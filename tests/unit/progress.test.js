import { describe, test, expect } from 'vitest';
import { completionStats, scoreSeries, average, percent, chartModel } from '../../portal/js/progress.js';

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

describe('scores', () => {
  test('scoreSeries keeps released numeric scores, oldest first', () => {
    const grades = [
      { score: '88.50', released_at: day(9) },
      { score: 70, released_at: day(2) },
      { score: 95, released_at: null },
      { score: null, released_at: day(3) },
    ];
    expect(scoreSeries(grades)).toEqual([{ date: day(2), score: 70 }, { date: day(9), score: 88.5 }]);
  });

  test('average and percent', () => {
    expect(average([{ score: 70 }, { score: 90 }])).toBe(80);
    expect(average([])).toBeNull();
    expect(percent(0.666)).toBe('67%');
    expect(percent(null)).toBeNull();
  });
});

describe('chartModel', () => {
  test('is null with no scores', () => {
    expect(chartModel([])).toBeNull();
  });

  test('centres a single score', () => {
    const model = chartModel([{ date: day(1), score: 100 }], { width: 600, height: 200, padX: 40, padY: 20 });
    expect(model.points[0]).toMatchObject({ x: 300, y: 20 });
    expect(model.path).toBe('M300 20');
  });

  test('spreads scores across the width, 100 at the top and 0 at the bottom', () => {
    const model = chartModel([{ date: day(1), score: 0 }, { date: day(2), score: 50 }, { date: day(3), score: 100 }],
      { width: 600, height: 200, padX: 40, padY: 20 });
    expect(model.points.map((p) => [p.x, p.y])).toEqual([[40, 180], [300, 100], [560, 20]]);
    expect(model.path).toBe('M40 180 L300 100 L560 20');
    expect(model.gridlines).toEqual([{ score: 0, y: 180 }, { score: 50, y: 100 }, { score: 100, y: 20 }]);
  });
});
