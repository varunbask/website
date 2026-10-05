import { describe, test, expect } from 'vitest';
import {
  REPEATS, MIN_REPEAT_COUNT, repeatDueKeys, checkRepeat, repeatSummary, repeatRows, seriesOf,
  followingInTaskSeries, seriesPosition, seriesText, shiftedDueAt, followingText, seriesUpdates, groupUpdates,
} from '../../portal/js/task-repeat-model.js';
import { dueDateToIso } from '../../portal/js/format.js';
import { dayKey } from '../../portal/js/dates.js';

const due = (key) => dueDateToIso(key);

describe('due days', () => {
  test('daily and weekly copies, across a month end and the end of daylight time', () => {
    expect(repeatDueKeys('2026-10-30', 'daily', 4)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(repeatDueKeys('2026-10-27', 'weekly', 3)).toEqual(['2026-10-27', '2026-11-03', '2026-11-10']);
    // every copy is still due at 11:59 pm Pacific after the clocks change
    for (const key of repeatDueKeys('2026-10-27', 'weekly', 3)) {
      expect(dayKey(due(key))).toBe(key);
    }
  });

  test('nothing without a first day or a known pattern', () => {
    expect(repeatDueKeys('', 'weekly', 3)).toEqual([]);
    expect(repeatDueKeys('2026-10-27', 'monthly', 3)).toEqual([]);
  });
});

describe('checking the repeat fields', () => {
  test('off: nothing to check', () => {
    expect(checkRepeat({ repeat: false, count: 'x' }).errors).toEqual({});
  });

  test('a first due date and a count in range are needed', () => {
    expect(checkRepeat({ repeat: true, every: 'weekly', count: '4', due: '' }).errors.due).toMatch(/first due date/);
    expect(checkRepeat({ repeat: true, every: 'weekly', count: '1', due: '2026-10-06' }).errors.count).toBe(`Repeat ${MIN_REPEAT_COUNT} to 26 times.`);
    expect(checkRepeat({ repeat: true, every: 'weekly', count: '27', due: '2026-10-06' }).errors.count).toBeDefined();
    expect(checkRepeat({ repeat: true, every: 'daily', count: '60', due: '2026-10-06' }).errors).toEqual({});
    expect(checkRepeat({ repeat: true, every: 'daily', count: '61', due: '2026-10-06' }).errors.count).toBe('Repeat 2 to 60 times.');
    expect(checkRepeat({ repeat: true, every: 'daily', count: '2.5', due: '2026-10-06' }).errors.count).toBeDefined();
    expect(checkRepeat({ repeat: true, every: 'weekly', count: ' 8 ', due: '2026-10-06' }).values)
      .toEqual({ repeat: true, every: 'weekly', count: 8, due: '2026-10-06' });
  });

  test('an unknown pattern is read as weekly', () => {
    expect(checkRepeat({ repeat: true, every: 'hourly', count: '3', due: '2026-10-06' }).values.every).toBe('weekly');
  });

  test('defaults sit inside the limits', () => {
    for (const p of Object.values(REPEATS)) {
      expect(p.start).toBeGreaterThanOrEqual(MIN_REPEAT_COUNT);
      expect(p.start).toBeLessThanOrEqual(p.max);
    }
  });
});

describe('summary', () => {
  test('names the count, the pattern and the last due day', () => {
    expect(repeatSummary({ every: 'weekly', count: '8', due: '2026-10-06' }, 'assignment'))
      .toBe('8 weekly assignments, the last due Tue, Nov 24');
    expect(repeatSummary({ every: 'daily', count: '5', due: '2026-10-06' }, 'task'))
      .toBe('5 daily tasks, the last due Sat, Oct 10');
    expect(repeatSummary({ every: 'weekly', count: '26', due: '2026-12-01' }, 'task'))
      .toBe('26 weekly tasks, the last due Tue, May 25, 2027');
  });

  test('empty while the fields are not usable', () => {
    expect(repeatSummary({ every: 'weekly', count: '8', due: '' })).toBe('');
    expect(repeatSummary({ every: 'weekly', count: '', due: '2026-10-06' })).toBe('');
  });
});

describe('rows to create', () => {
  test('every copy gets the values, its own due date and the series', () => {
    const rows = repeatRows({ kind: 'task', title: 'Read', details: null, student_id: 's1' },
      { every: 'daily', count: 3, due: '2026-10-06', seriesId: 'abc' });
    expect(rows).toEqual(['2026-10-06', '2026-10-07', '2026-10-08'].map((key) => ({
      kind: 'task', title: 'Read', details: null, student_id: 's1', due_at: due(key), series_id: 'abc',
    })));
  });
});

const T = (id, key, extra = {}) => ({ id, student_id: 's1', series_id: 'abc', kind: 'assignment', title: 'Sheet', details: null, due_at: key ? due(key) : null, ...extra });

describe('a series', () => {
  const tasks = [
    T(3, '2026-10-20'), T(1, '2026-10-06'), T(2, '2026-10-13'),
    T(9, '2026-10-13', { series_id: 'other' }),
    T(8, '2026-10-27', { student_id: 's2' }),
    T(7, null, { series_id: null }),
  ];

  test('in due order, same series and same student only', () => {
    expect(seriesOf(tasks, tasks[0]).map((t) => t.id)).toEqual([1, 2, 3]);
    expect(seriesOf(tasks, tasks[5]).map((t) => t.id)).toEqual([7]);
  });

  test('this and following', () => {
    expect(followingInTaskSeries(tasks, tasks[2]).map((t) => t.id)).toEqual([2, 3]);
    expect(followingInTaskSeries(tasks, tasks[0]).map((t) => t.id)).toEqual([3]);
    expect(followingInTaskSeries(tasks, tasks[5]).map((t) => t.id)).toEqual([7]);
  });

  test('position', () => {
    expect(seriesPosition(tasks, tasks[2])).toEqual({ n: 2, total: 3 });
    expect(seriesText(seriesPosition(tasks, tasks[2]))).toBe('2 of 3');
    expect(seriesPosition(tasks, tasks[5])).toBeNull();
    // the only copy left of a series is not shown as one
    expect(seriesPosition([T(4, '2026-10-06', { series_id: 'solo' })], T(4, '2026-10-06', { series_id: 'solo' }))).toBeNull();
    expect(seriesText(null)).toBe('');
  });

  test('applies-to text', () => {
    expect(followingText([tasks[2], tasks[0]], tasks[2])).toBe('Applies to 2 assignments, from Tue, Oct 13 on');
    expect(followingText([T(7, null, { kind: 'task' })], T(7, null, { kind: 'task' }))).toBe('Applies to 1 task');
  });
});

describe('shifting due dates', () => {
  test('whole days, still due at 11:59 pm Pacific across the clock change', () => {
    expect(shiftedDueAt(due('2026-10-27'), 7)).toBe(due('2026-11-03'));
    expect(shiftedDueAt(due('2026-11-03'), -7)).toBe(due('2026-10-27'));
    expect(shiftedDueAt(null, 3)).toBeNull();
  });
});

describe('saving an edit', () => {
  const rows = [T(2, '2026-10-13'), T(3, '2026-10-20'), T(4, null)];
  const task = rows[0];

  test('this one only', () => {
    const values = { title: 'New', details: 'd', due_at: due('2026-10-14') };
    expect(seriesUpdates({ task, rows, values, apply: 'this' })).toEqual([{ id: 2, values }]);
  });

  test('following: new title and instructions, due dates moved by the same days', () => {
    const values = { title: 'New', details: 'd', due_at: due('2026-10-15') };
    expect(seriesUpdates({ task, rows, values, apply: 'following' })).toEqual([
      { id: 2, values },
      { id: 3, values: { title: 'New', details: 'd', due_at: due('2026-10-22') } },
      { id: 4, values: { title: 'New', details: 'd' } },
    ]);
  });

  test('following, same due date: the others keep theirs and share one update', () => {
    const values = { title: 'New', details: null, due_at: due('2026-10-13') };
    const updates = seriesUpdates({ task, rows, values, apply: 'following' });
    expect(updates[1].values).toEqual({ title: 'New', details: null });
    expect(groupUpdates(updates)).toEqual([
      { ids: [2], values },
      { ids: [3, 4], values: { title: 'New', details: null } },
    ]);
  });

  test('following, due date cleared: theirs are cleared too', () => {
    const values = { title: 'New', details: null, due_at: null };
    expect(seriesUpdates({ task, rows, values, apply: 'following' }).map((u) => u.values.due_at)).toEqual([null, null, undefined]);
  });

  test('following, this one had no due date: the others keep theirs', () => {
    const undated = T(5, null);
    const list = [undated, T(6, '2026-10-20')];
    for (const dueAt of [null, due('2026-10-09')]) {
      const values = { title: 'New', details: null, due_at: dueAt };
      expect(seriesUpdates({ task: undated, rows: list, values, apply: 'following' })[1].values).toEqual({ title: 'New', details: null });
    }
  });
});
