import { describe, test, expect } from 'vitest';
import {
  CAL_VIEWS, AGENDA_DAYS, PANEL_DAYS, MAX_DOTS,
  isDayKey, isMonthKey, monthOf, daysInMonth, monthMatrix, shiftMonth, weekdayHeaders, cellText,
  itemsByDay, moveKey, capacityFor, capacityForGrid, chipsFor, moreLabel, chipKind, dotsFor, dayLabel, dateWords, shortDay,
  agendaGroups, resolveState, countInMonth, inGrid,
} from '../../portal/js/calendar-model.js';
import { deriveItems } from '../../portal/js/buckets.js';
import { zonedIso, weekday } from '../../portal/js/dates.js';

// Wednesday, October 14, 2026 at 12:00 pm Pacific
const NOW = new Date('2026-10-14T19:00:00Z');
const TODAY = '2026-10-14';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

const task = (id, extra = {}) => ({
  id, student_id: 's1', kind: 'assignment', title: `Task ${id}`, details: '',
  due_at: null, completed_at: null, created_at: '2026-09-01T00:00:00Z', ...extra,
});
const due = (key, time = '23:59') => zonedIso(key, time);
const sub = (id, taskId, extra = {}) => ({
  id, task_id: taskId, student_id: 's1', status: 'pending', error: null, created_at: ago(HOUR), grade: null, ...extra,
});
const released = (score = 90, at = ago(DAY)) => ({ score, feedback: 'ok', reviewed_at: at, released_at: at });

const items = (tasks, subs = [], audience = 'family') => deriveItems(tasks, subs, NOW, { audience });
const item = (t, subs = [], audience = 'family') => items([t], subs, audience)[0];

describe('constants and key checks', () => {
  test('match the spec', () => {
    expect(CAL_VIEWS).toEqual(['month', 'list']);
    expect([AGENDA_DAYS, PANEL_DAYS, MAX_DOTS]).toEqual([30, 7, 3]);
  });

  test('isDayKey accepts only real calendar days', () => {
    expect(isDayKey('2026-10-14')).toBe(true);
    expect(isDayKey('2028-02-29')).toBe(true);
    expect(isDayKey('2026-02-29')).toBe(false);
    expect(isDayKey('2026-13-01')).toBe(false);
    expect(isDayKey('2026-10-14T00:00:00Z')).toBe(false);
    expect(isDayKey('')).toBe(false);
    expect(isDayKey(null)).toBe(false);
  });

  test('isMonthKey', () => {
    expect(isMonthKey('2026-10')).toBe(true);
    expect(isMonthKey('2026-00')).toBe(false);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-1')).toBe(false);
    expect(isMonthKey(undefined)).toBe(false);
  });

  test('monthOf and daysInMonth', () => {
    expect(monthOf('2026-10-14')).toBe('2026-10');
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-04')).toBe(30);
    expect(daysInMonth('2026-12')).toBe(31);
  });
});

describe('monthMatrix', () => {
  const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);

  test.each(months)('%s has 42 consecutive cells starting on Sunday', (ym) => {
    const cells = monthMatrix(ym);
    expect(cells).toHaveLength(42);
    expect(cells[0].weekday).toBe(0);
    expect(cells.filter((c) => c.inMonth)).toHaveLength(daysInMonth(ym));
    for (let i = 0; i < cells.length; i += 1) {
      expect(cells[i].weekday).toBe(i % 7);
      expect(cells[i].weekday).toBe(weekday(cells[i].key));
      expect(cells[i].isWeekend).toBe(i % 7 === 0 || i % 7 === 6);
      if (i > 0) expect(cells[i].key > cells[i - 1].key).toBe(true);
    }
    const first = cells.findIndex((c) => c.inMonth);
    expect(first).toBeLessThan(7);
    expect(cells[first].key).toBe(`${ym}-01`);
  });

  test('February 2026 starts on Sunday, so it opens with the 1st', () => {
    const cells = monthMatrix('2026-02');
    expect(cells[0]).toEqual({ key: '2026-02-01', inMonth: true, weekday: 0, isWeekend: true });
    expect(cells[27].key).toBe('2026-02-28');
    expect(cells[28]).toMatchObject({ key: '2026-03-01', inMonth: false });
    expect(cells[41].key).toBe('2026-03-14');
  });

  test('May and August 2026 need all six rows', () => {
    const may = monthMatrix('2026-05');
    expect(may[0].key).toBe('2026-04-26');
    expect(may.findLastIndex((c) => c.inMonth)).toBeGreaterThanOrEqual(35);
    const aug = monthMatrix('2026-08');
    expect(aug[0].key).toBe('2026-07-26');
    expect(aug[36]).toMatchObject({ key: '2026-08-31', inMonth: true });
  });

  test('crosses the November 1, 2026 DST change without skipping or repeating a day', () => {
    const cells = monthMatrix('2026-11');
    const keys = cells.map((c) => c.key);
    expect(new Set(keys).size).toBe(42);
    expect(keys.slice(0, 3)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    const oct = monthMatrix('2026-10').map((c) => c.key);
    expect(oct.slice(-7)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
  });

  test('a Monday week start shifts the columns', () => {
    const cells = monthMatrix('2026-02', 1);
    expect(cells[0]).toMatchObject({ key: '2026-01-26', weekday: 1 });
    expect(cells[6]).toMatchObject({ key: '2026-02-01', weekday: 0, isWeekend: true });
  });
});

describe('shiftMonth', () => {
  test('steps across years both ways', () => {
    expect(shiftMonth('2026-10', 1)).toBe('2026-11');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-10', -22)).toBe('2024-12');
    expect(shiftMonth('2026-10', 12)).toBe('2027-10');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
  });
});

describe('weekdayHeaders and cellText', () => {
  test('Sunday first with short and long names', () => {
    const heads = weekdayHeaders();
    expect(heads.map((h) => h.short)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(heads[0].long).toBe('Sunday');
    expect(weekdayHeaders(1)[0].short).toBe('Mon');
  });

  test('the 1st of an adjacent month carries its month', () => {
    expect(cellText({ key: '2026-11-01', inMonth: false })).toBe('Nov 1');
    expect(cellText({ key: '2026-11-01', inMonth: true })).toBe('1');
    expect(cellText({ key: '2026-09-28', inMonth: false })).toBe('28');
    expect(cellText({ key: '2026-10-14', inMonth: true })).toBe('14');
  });
});

describe('itemsByDay', () => {
  test('keys by the Pacific day of the due date and collects undated items', () => {
    const list = items([
      task(1, { due_at: due('2026-10-14') }),
      task(2, { due_at: due('2026-10-14', '09:00') }),
      task(3, { due_at: due('2026-10-15') }),
      task(4),
    ]);
    const { byDay, undated } = itemsByDay(list);
    expect([...byDay.keys()].sort()).toEqual(['2026-10-14', '2026-10-15']);
    expect(byDay.get('2026-10-14').map((i) => i.task.id)).toEqual([2, 1]);
    expect(undated.map((i) => i.task.id)).toEqual([4]);
  });

  test('11:59 pm Pacific stays on its own day across the DST change', () => {
    // 2026-10-31 23:59 PDT is 2026-11-01T06:59Z; 2026-11-01 23:59 PST is 2026-11-02T07:59Z
    const list = items([
      task(1, { due_at: '2026-11-01T06:59:00.000Z' }),
      task(2, { due_at: '2026-11-02T07:59:00.000Z' }),
    ]);
    const { byDay } = itemsByDay(list);
    expect(byDay.get('2026-10-31').map((i) => i.task.id)).toEqual([1]);
    expect(byDay.get('2026-11-01').map((i) => i.task.id)).toEqual([2]);
  });

  test('open work comes before finished work within a day', () => {
    const d = due('2026-10-20');
    const list = items([
      task(1, { due_at: d, kind: 'task', completed_at: ago(HOUR) }),
      task(2, { due_at: d }),
      task(3, { due_at: d }),
    ], [sub(10, 3)]);
    const { byDay } = itemsByDay(list);
    expect(byDay.get('2026-10-20').map((i) => i.task.id)).toEqual([2, 3, 1]);
  });
});

describe('moveKey', () => {
  const K = '2026-10-14'; // Wednesday

  test('arrows move one day or one week', () => {
    expect(moveKey(K, 'ArrowLeft')).toBe('2026-10-13');
    expect(moveKey(K, 'ArrowRight')).toBe('2026-10-15');
    expect(moveKey(K, 'ArrowUp')).toBe('2026-10-07');
    expect(moveKey(K, 'ArrowDown')).toBe('2026-10-21');
    expect(moveKey('2026-10-31', 'ArrowRight')).toBe('2026-11-01');
    expect(moveKey('2026-11-01', 'ArrowLeft')).toBe('2026-10-31');
    expect(moveKey('2026-12-29', 'ArrowDown')).toBe('2027-01-05');
  });

  test('Home and End go to the start and end of the week', () => {
    expect(moveKey(K, 'Home')).toBe('2026-10-11');
    expect(moveKey(K, 'End')).toBe('2026-10-17');
    expect(moveKey('2026-10-11', 'Home')).toBe('2026-10-11');
    expect(moveKey('2026-10-17', 'End')).toBe('2026-10-17');
    expect(moveKey('2026-11-01', 'Home')).toBe('2026-11-01');
    expect(moveKey('2026-10-29', 'End')).toBe('2026-10-31');
    expect(moveKey(K, 'Home', { weekStart: 1 })).toBe('2026-10-12');
  });

  test('PageUp and PageDown keep the day, clamped to the month length', () => {
    expect(moveKey(K, 'PageDown')).toBe('2026-11-14');
    expect(moveKey(K, 'PageUp')).toBe('2026-09-14');
    expect(moveKey('2026-01-31', 'PageDown')).toBe('2026-02-28');
    expect(moveKey('2026-03-31', 'PageUp')).toBe('2026-02-28');
    expect(moveKey('2026-05-31', 'PageDown')).toBe('2026-06-30');
    expect(moveKey('2026-12-15', 'PageDown')).toBe('2027-01-15');
    expect(moveKey('2026-01-15', 'PageUp')).toBe('2025-12-15');
  });

  test('Shift with PageUp and PageDown moves a year', () => {
    expect(moveKey(K, 'PageDown', { shift: true })).toBe('2027-10-14');
    expect(moveKey(K, 'PageUp', { shift: true })).toBe('2025-10-14');
    expect(moveKey('2028-02-29', 'PageDown', { shift: true })).toBe('2029-02-28');
    expect(moveKey('2028-02-29', 'PageUp', { shift: true })).toBe('2027-02-28');
  });

  test('other keys return null', () => {
    expect(moveKey(K, 'Enter')).toBeNull();
    expect(moveKey(K, ' ')).toBeNull();
    expect(moveKey(K, 'a')).toBeNull();
  });
});

describe('capacityFor, chipsFor and moreLabel', () => {
  test('capacity by width', () => {
    expect(capacityFor(1440)).toBe(3);
    expect(capacityFor(1280)).toBe(3);
    expect(capacityFor(1279)).toBe(2);
    expect(capacityFor(1024)).toBe(2);
    expect(capacityFor(1023)).toBe(1);
    expect(capacityFor(768)).toBe(1);
    expect(capacityFor(767)).toBe(0);
    expect(capacityFor(320)).toBe(0);
  });

  test('capacity by the cell width the grid really gets', () => {
    // No measurement yet: the viewport decides
    expect(capacityForGrid(0, 1440)).toBe(3);
    expect(capacityForGrid(undefined, 900)).toBe(1);
    // Wide cells never go past the viewport capacity
    expect(capacityForGrid(7 * 140, 1100)).toBe(2);
    expect(capacityForGrid(7 * 140, 900)).toBe(1);
    // 1440 with the day panel and an expanded sidebar (108px cells)
    expect(capacityForGrid(757, 1440)).toBe(2);
    expect(capacityForGrid(7 * 112, 1440)).toBe(3);
    // 1280 with the day panel and an expanded sidebar (85px cells)
    expect(capacityForGrid(597, 1280)).toBe(1);
    expect(capacityForGrid(7 * 96, 1280)).toBe(2);
    // Too narrow for a title: dots
    expect(capacityForGrid(7 * 79, 1280)).toBe(0);
    // Phones always get dots
    expect(capacityForGrid(7 * 120, 700)).toBe(0);
  });

  const five = [1, 2, 3, 4, 5];

  test('everything fits up to the capacity', () => {
    expect(chipsFor([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(chipsFor([1, 2], 2)).toEqual({ shown: [1, 2], more: 0 });
    expect(chipsFor([1], 1)).toEqual({ shown: [1], more: 0 });
    expect(chipsFor([], 3)).toEqual({ shown: [], more: 0 });
  });

  test('overflow keeps a line for "+N more"', () => {
    expect(chipsFor(five, 3)).toEqual({ shown: [1, 2], more: 3 });
    expect(chipsFor([1, 2, 3, 4], 3)).toEqual({ shown: [1, 2], more: 2 });
    expect(chipsFor(five, 2)).toEqual({ shown: [1], more: 4 });
    expect(chipsFor([1, 2, 3], 2)).toEqual({ shown: [1], more: 2 });
  });

  test('one chip plus "+N" at capacity 1, nothing at 0', () => {
    expect(chipsFor(five, 1)).toEqual({ shown: [1], more: 4 });
    expect(chipsFor(five, 0)).toEqual({ shown: [], more: 5 });
  });

  test('moreLabel is short at capacity 1', () => {
    expect(moreLabel(3, 3)).toBe('+3 more');
    expect(moreLabel(4, 1)).toBe('+4');
  });
});

describe('chipKind and dotsFor', () => {
  const soon = due('2026-10-15');
  const later = due('2026-10-30');
  const past = due('2026-10-10');

  test('open work by due state, with the kind icon', () => {
    expect(chipKind(item(task(1, { due_at: later })), 'family')).toEqual({ kind: 'open', icon: 'clipboard-text' });
    expect(chipKind(item(task(1, { due_at: later, kind: 'task' })), 'family')).toEqual({ kind: 'open', icon: 'check-square' });
    expect(chipKind(item(task(1, { due_at: soon })), 'family')).toEqual({ kind: 'soon', icon: 'clipboard-text' });
    expect(chipKind(item(task(1, { due_at: past })), 'family')).toEqual({ kind: 'overdue', icon: 'warning-circle' });
    expect(chipKind(item(task(1, { due_at: past, kind: 'task' })), 'family').kind).toBe('overdue');
  });

  test('finished work', () => {
    const doneTask = task(1, { kind: 'task', due_at: past, completed_at: ago(HOUR) });
    expect(chipKind(item(doneTask), 'family')).toEqual({ kind: 'done', icon: 'check-square' });
    const graded = [task(1, { due_at: past }), [sub(9, 1, { status: 'ai_graded', grade: released() })]];
    expect(chipKind(item(...graded), 'family')).toEqual({ kind: 'graded', icon: 'check-circle' });
    const missed = task(1, { due_at: ago(40 * DAY) });
    expect(chipKind(item(missed), 'family')).toEqual({ kind: 'missed', icon: 'minus-circle' });
  });

  test('in review: families see submitted; staff see drafts and failures', () => {
    const t = task(1, { due_at: past });
    const draftSub = sub(9, 1, { status: 'ai_graded', grade: { score: 80, feedback: 'x', reviewed_at: null, released_at: null } });
    const failed = sub(9, 1, { status: 'failed', error: 'Unreadable' });
    const pending = sub(9, 1, { status: 'pending' });
    expect(chipKind(item(t, [pending]), 'family')).toEqual({ kind: 'submitted', icon: 'hourglass-medium' });
    expect(chipKind(item(t, [draftSub]), 'family')).toEqual({ kind: 'submitted', icon: 'hourglass-medium' });
    expect(chipKind(item(t, [draftSub], 'staff'), 'staff')).toEqual({ kind: 'draft', icon: 'pencil-simple-line' });
    const editedSub = sub(9, 1, { status: 'ai_graded', grade: { score: 80, feedback: 'x', reviewed_at: ago(HOUR), released_at: null } });
    expect(chipKind(item(t, [editedSub], 'staff'), 'staff')).toEqual({ kind: 'draft', icon: 'pencil-simple-line' });
    expect(chipKind(item(t, [failed], 'staff'), 'staff')).toEqual({ kind: 'failed', icon: 'x-circle' });
    expect(chipKind(item(t, [failed]), 'family')).toEqual({ kind: 'failed', icon: 'x-circle' });
    expect(chipKind(item(t, [pending], 'staff'), 'staff')).toEqual({ kind: 'submitted', icon: 'hourglass-medium' });
  });

  test('dots: one per item, most urgent first, at most three', () => {
    const list = items([
      task(1, { due_at: past, kind: 'task', completed_at: ago(HOUR) }),
      task(2, { due_at: later }),
      task(3, { due_at: past }),
      task(4, { due_at: soon }),
      task(5, { due_at: past }),
    ], [sub(9, 5)]);
    expect(dotsFor(list, 'family')).toEqual(['overdue', 'soon', 'open']);
    expect(dotsFor(list.slice(0, 1), 'family')).toEqual(['done']);
    expect(dotsFor([], 'family')).toEqual([]);
  });
});

describe('dayLabel', () => {
  test('today with items', () => {
    const list = items([
      task(1, { title: 'Algebra worksheet', due_at: due('2026-10-14', '09:00') }),
      task(2, { title: 'Read chapter 3', kind: 'task', due_at: due('2026-10-14'), completed_at: ago(HOUR) }),
    ]);
    expect(dayLabel(TODAY, list, TODAY, 'family'))
      .toBe('Wednesday, October 14, today. 2 items: Algebra worksheet, overdue; Read chapter 3, done');
  });

  test('an empty day', () => {
    expect(dayLabel('2026-10-15', [], TODAY, 'family')).toBe('Thursday, October 15. Nothing due.');
    expect(dayLabel(TODAY, [], TODAY, 'family')).toBe('Wednesday, October 14, today. Nothing due.');
  });

  test('one item, another year, staff wording and student names', () => {
    const t = task(1, { title: 'Essay', due_at: due('2027-01-05') });
    expect(dayLabel('2027-01-05', [item(t)], TODAY, 'family')).toBe('Tuesday, January 5, 2027. 1 item: Essay, to do');
    const draftSub = sub(9, 1, { status: 'ai_graded', grade: { score: 80, feedback: 'x', reviewed_at: null, released_at: null } });
    const staffItem = { ...item(task(1, { title: 'Essay', due_at: due('2026-10-10') }), [draftSub], 'staff'), studentName: 'Maya Chen' };
    expect(dayLabel('2026-10-10', [staffItem], TODAY, 'staff')).toBe('Saturday, October 10. 1 item: Essay for Maya Chen, AI draft');
    const famItem = item(task(1, { title: 'Essay', due_at: due('2026-10-10') }), [draftSub]);
    expect(dayLabel('2026-10-10', [famItem], TODAY, 'family')).toBe('Saturday, October 10. 1 item: Essay, submitted');
  });

  test('an untitled item still reads', () => {
    const t = task(1, { title: '', due_at: due('2026-10-20') });
    expect(dayLabel('2026-10-20', [item(t)], TODAY, 'family')).toBe('Tuesday, October 20. 1 item: Untitled, to do');
  });
});

describe('dateWords and shortDay', () => {
  test('add the year only when it differs from today', () => {
    expect(dateWords('2026-10-14', TODAY)).toBe('Wednesday, October 14');
    expect(dateWords('2027-01-05', TODAY)).toBe('Tuesday, January 5, 2027');
    expect(shortDay('2026-10-14', TODAY)).toBe('Oct 14');
    expect(shortDay('2027-01-05', TODAY)).toBe('Jan 5, 2027');
  });
});

describe('agendaGroups', () => {
  const list = items([
    task(1, { due_at: due('2026-10-10') }),                       // overdue
    task(2, { due_at: due('2026-09-20') }),                       // overdue, older
    task(3, { due_at: due('2026-08-01') }),                       // missed, archived
    task(4, { due_at: due('2026-10-14') }),                       // today
    task(5, { due_at: due('2026-10-14', '08:00') }),              // earlier today: overdue
    task(6, { due_at: due('2026-11-12') }),                       // last day of 30 (Oct 14 + 29)
    task(7, { due_at: due('2026-11-13') }),                       // day 31: later
    task(8),                                                      // undated, open
    task(9, { kind: 'task', completed_at: ago(DAY) }),            // undated, done
    task(10, { due_at: due('2026-10-20') }),                      // submitted
    task(11, { due_at: due('2026-10-01'), kind: 'task', completed_at: ago(DAY) }), // done, past
  ], [sub(20, 10)]);

  test('overdue first, oldest first, never archived work', () => {
    const g = agendaGroups(list, TODAY);
    expect(g.overdue.map((i) => i.task.id)).toEqual([2, 1, 5]);
  });

  test('day groups cover 30 days from today and count what lies beyond', () => {
    const g = agendaGroups(list, TODAY);
    expect(g.days.map((d) => d.key)).toEqual(['2026-10-14', '2026-10-20', '2026-11-12']);
    expect(g.days[0].items.map((i) => i.task.id)).toEqual([4]);
    expect(g.days[1].items.map((i) => i.task.id)).toEqual([10]);
    expect(g.end).toBe('2026-11-12');
    expect(g.later).toBe(1);
  });

  test('extending the range pulls later work in', () => {
    const g = agendaGroups(list, TODAY, { days: 60 });
    expect(g.days.map((d) => d.key)).toContain('2026-11-13');
    expect(g.later).toBe(0);
  });

  test('"No due date" holds open undated work only', () => {
    expect(agendaGroups(list, TODAY).undated.map((i) => i.task.id)).toEqual([8]);
  });

  test('the 7-day panel range', () => {
    const g = agendaGroups(list, TODAY, { days: PANEL_DAYS });
    expect(g.end).toBe('2026-10-20');
    expect(g.days.map((d) => d.key)).toEqual(['2026-10-14', '2026-10-20']);
    expect(g.later).toBe(2);
  });

  test('nothing at all', () => {
    expect(agendaGroups([], TODAY)).toEqual({ overdue: [], days: [], undated: [], later: 0, end: '2026-11-12' });
  });
});

describe('inGrid', () => {
  test('covers the 42 cells, adjacent-month days included', () => {
    // October 2026 starts on a Thursday: the grid runs Sep 27 to Nov 7
    expect(inGrid('2026-10', '2026-10-14')).toBe(true);
    expect(inGrid('2026-10', '2026-09-27')).toBe(true);
    expect(inGrid('2026-10', '2026-11-07')).toBe(true);
    expect(inGrid('2026-10', '2026-09-26')).toBe(false);
    expect(inGrid('2026-10', '2026-11-08')).toBe(false);
  });

  test('rejects malformed keys', () => {
    expect(inGrid('2026-10', null)).toBe(false);
    expect(inGrid('bogus', '2026-10-14')).toBe(false);
  });
});

describe('resolveState', () => {
  test('drops a selected day the month grid does not show', () => {
    expect(resolveState({ m: '2026-11', d: '2026-10-14' }, { today: TODAY, wide: true }))
      .toEqual({ view: 'month', month: '2026-11', selected: null });
    // December 2026 starts on a Tuesday: Nov 29 and 30 lead the grid
    expect(resolveState({ m: '2026-12', d: '2026-11-30' }, { today: TODAY, wide: true }).selected)
      .toBe('2026-11-30');
  });

  test('reads view, month and day from the hash params', () => {
    expect(resolveState({ view: 'list', m: '2026-12', d: '2026-12-03' }, { today: TODAY, wide: true }))
      .toEqual({ view: 'list', month: '2026-12', selected: '2026-12-03' });
  });

  test('the month follows the selected day, then today', () => {
    expect(resolveState({ d: '2027-02-10' }, { today: TODAY, wide: true }))
      .toEqual({ view: 'month', month: '2027-02', selected: '2027-02-10' });
    expect(resolveState({}, { today: TODAY, wide: true }))
      .toEqual({ view: 'month', month: '2026-10', selected: null });
  });

  test('the stored view is used only when the hash has none; then the width decides', () => {
    expect(resolveState({}, { today: TODAY, wide: true, stored: 'list' }).view).toBe('list');
    expect(resolveState({ view: 'month' }, { today: TODAY, wide: false, stored: 'list' }).view).toBe('month');
    expect(resolveState({}, { today: TODAY, wide: false }).view).toBe('list');
    expect(resolveState({}, { today: TODAY, wide: false, stored: 'bogus' }).view).toBe('list');
  });

  test('bad values fall back', () => {
    expect(resolveState({ view: 'week', m: '2026-13', d: '2026-02-30' }, { today: TODAY, wide: true }))
      .toEqual({ view: 'month', month: '2026-10', selected: null });
  });
});

describe('countInMonth', () => {
  test('counts dated items in one month', () => {
    const { byDay } = itemsByDay(items([
      task(1, { due_at: due('2026-10-01') }),
      task(2, { due_at: due('2026-10-31') }),
      task(3, { due_at: due('2026-11-01') }),
    ]));
    expect(countInMonth(byDay, '2026-10')).toBe(2);
    expect(countInMonth(byDay, '2026-12')).toBe(0);
  });
});
