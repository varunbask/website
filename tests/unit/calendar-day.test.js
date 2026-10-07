import { describe, test, expect } from 'vitest';
import {
  CAL_VIEWS, dayTitle, dayColumn, weekDays, deriveDay, navLabels, dayHref, viewRange, resolveState,
  sessionsInRange, hourMarks, slotTime, nowFraction,
} from '../../portal/js/calendar-model.js';
import { hourRange, layoutDay } from '../../portal/js/sessions-model.js';
import { parseHash } from '../../portal/js/router.js';
import { zonedIso } from '../../portal/js/dates.js';

// Wednesday, October 14, 2026
const TODAY = '2026-10-14';

let nextId = 1;
const session = (key, start, end, extra = {}) => ({
  id: nextId++, student_id: 's1', tutor_id: 't1', subject: 'Algebra',
  starts_at: zonedIso(key, start), ends_at: zonedIso(key, end), status: 'scheduled', ...extra,
});

describe('the Day view is one of the calendar views', () => {
  test('it is listed with the others', () => {
    expect(CAL_VIEWS).toContain('day');
  });

  test('dayTitle spells the weekday, month, day and year', () => {
    expect(dayTitle('2026-10-06')).toBe('Tuesday, October 6, 2026');
    expect(dayTitle('2026-10-14')).toBe('Wednesday, October 14, 2026');
    expect(dayTitle('2027-01-01')).toBe('Friday, January 1, 2027');
    expect(dayTitle('2028-02-29')).toBe('Tuesday, February 29, 2028');
  });

  test('the title carries the year even in the current year', () => {
    expect(dayTitle(TODAY)).toMatch(/, 2026$/);
  });
});

describe('dayColumn and weekDays', () => {
  test('a day column names its weekday, number and flags', () => {
    expect(dayColumn('2026-10-06', TODAY)).toEqual({
      key: '2026-10-06', short: 'Tue', long: 'Tuesday', num: 6, isToday: false, isWeekend: false,
    });
    expect(dayColumn(TODAY, TODAY)).toMatchObject({ short: 'Wed', isToday: true, isWeekend: false });
    expect(dayColumn('2026-10-17', TODAY)).toMatchObject({ short: 'Sat', isWeekend: true });
    expect(dayColumn('2026-10-18', TODAY)).toMatchObject({ short: 'Sun', isWeekend: true });
  });

  test('a week is seven day columns', () => {
    const days = weekDays('2026-10-11', TODAY);
    expect(days).toHaveLength(7);
    expect(days).toEqual(days.map((d) => dayColumn(d.key, TODAY)));
    expect(days[3].isToday).toBe(true);
  });
});

describe('deriveDay', () => {
  test('the hash day wins when it is a real day', () => {
    expect(deriveDay({ day: '2026-12-25', selected: '2026-10-20', today: TODAY })).toBe('2026-12-25');
    expect(deriveDay({ day: '2026-02-30', today: TODAY })).toBe(TODAY);
  });

  test('from the Month view: the selected day, today in this month, or the 1st', () => {
    expect(deriveDay({ selected: '2026-10-20', month: '2026-10', today: TODAY })).toBe('2026-10-20');
    expect(deriveDay({ month: '2026-10', today: TODAY })).toBe(TODAY);
    expect(deriveDay({ month: '2026-12', today: TODAY })).toBe('2026-12-01');
  });

  test('from the Week view: today when it is in the week, otherwise the week\'s first day', () => {
    expect(deriveDay({ week: '2026-10-11', today: TODAY })).toBe(TODAY);
    expect(deriveDay({ week: '2026-10-18', today: TODAY })).toBe('2026-10-18');
    expect(deriveDay({ week: '2026-10-04', today: TODAY })).toBe('2026-10-04');
    // the week's own edges count as in the week
    expect(deriveDay({ week: '2026-10-14', today: TODAY })).toBe(TODAY);
    expect(deriveDay({ week: '2026-10-08', today: TODAY })).toBe(TODAY);
  });

  test('with nothing to go on it is today', () => {
    expect(deriveDay({ today: TODAY })).toBe(TODAY);
    expect(deriveDay({ week: 'nope', month: 'nope', today: TODAY })).toBe(TODAY);
  });
});

describe('moving by one day', () => {
  test('the buttons name the day they would show', () => {
    expect(navLabels('day', { day: '2026-10-06' })).toEqual({
      prev: 'Previous day, Monday, October 5, 2026',
      next: 'Next day, Wednesday, October 7, 2026',
    });
  });

  test('a step crosses a month, a year and the clock change', () => {
    expect(navLabels('day', { day: '2026-10-31' }).next).toBe('Next day, Sunday, November 1, 2026');
    expect(navLabels('day', { day: '2026-12-31' }).next).toBe('Next day, Friday, January 1, 2027');
    expect(navLabels('day', { day: '2027-01-01' }).prev).toBe('Previous day, Thursday, December 31, 2026');
    // the clocks go back on Sunday, November 1, 2026: still one calendar day each way
    expect(navLabels('day', { day: '2026-11-01' })).toEqual({
      prev: 'Previous day, Saturday, October 31, 2026',
      next: 'Next day, Monday, November 2, 2026',
    });
    expect(navLabels('day', { day: '2028-02-28' }).next).toBe('Next day, Tuesday, February 29, 2028');
  });

  test('week and month buttons keep their wording', () => {
    expect(navLabels('week', { week: '2026-10-11' })).toEqual({
      prev: 'Previous week, Oct 4 to 10, 2026',
      next: 'Next week, Oct 18 to 24, 2026',
    });
    expect(navLabels('month', { month: '2026-10' })).toEqual({
      prev: 'Previous month, September 2026',
      next: 'Next month, November 2026',
    });
    expect(navLabels('month', { month: '2026-12' }).next).toBe('Next month, January 2027');
  });
});

describe('the Day view\'s range', () => {
  test('viewRange is the one day', () => {
    expect(viewRange('day', { day: '2026-10-06' }, TODAY)).toEqual({ start: '2026-10-06', end: '2026-10-06' });
    expect(viewRange('day', {}, TODAY)).toEqual({ start: TODAY, end: TODAY });
  });

  test('only sessions that start that day are in it', () => {
    const list = [
      session('2026-10-05', '16:00', '17:00'),
      session('2026-10-06', '09:00', '10:00'),
      session('2026-10-06', '23:00', '23:45'),
      session('2026-10-07', '07:00', '08:00'),
    ];
    const { start, end } = viewRange('day', { day: '2026-10-06' }, TODAY);
    expect(sessionsInRange(list, start, end).map((s) => s.id)).toEqual([list[1].id, list[2].id]);
  });

  test('a day grid lays overlapping lessons side by side, like a week column', () => {
    const day = [
      session('2026-10-06', '16:00', '17:00'),
      session('2026-10-06', '16:30', '17:30'),
      session('2026-10-06', '19:00', '20:00'),
    ];
    const range = hourRange(day);
    expect(range).toEqual({ start: 7, end: 21 });
    expect(hourMarks(range)).toHaveLength(14);
    const blocks = layoutDay(day, { startHour: range.start, endHour: range.end });
    expect(blocks.map((b) => [b.col, b.cols])).toEqual([[0, 2], [1, 2], [0, 1]]);
    // a click 9.5 hours down the shown hours is 4:00 pm, as in the week grid
    expect(slotTime(9.5 / 14, range)).toBe('16:00');
  });

  test('the grid widens for a late lesson and the now line follows the hours', () => {
    const late = session('2026-10-06', '21:30', '22:30');
    const range = hourRange([late]);
    expect(range.end).toBeGreaterThanOrEqual(23);
    expect(nowFraction(new Date('2026-10-06T19:00:00Z'), { start: 7, end: 21 })).toBeCloseTo(5 / 14);
  });
});

describe('dayHref', () => {
  test('opens the Day view on that day', () => {
    expect(dayHref('#/calendar', '2026-10-06')).toBe('#/calendar?date=2026-10-06&view=day');
    expect(dayHref('', '2026-10-06')).toBe('#/calendar?date=2026-10-06&view=day');
    expect(dayHref('#/calendar?view=week&w=2026-10-04&m=2026-10', '2026-10-06')).toBe('#/calendar?date=2026-10-06&view=day');
  });

  test('keeps the calendar\'s own filters and leaves the drawer and the old place behind', () => {
    const href = dayHref('#/calendar?scope=all&who=all&tutor=t2&view=month&m=2026-10&d=2026-10-20&open=s12&due=2026-10-21', '2026-10-06');
    const { view, params } = parseHash(href);
    expect(view).toBe('calendar');
    expect(params).toEqual({ scope: 'all', who: 'all', tutor: 't2', view: 'day', date: '2026-10-06' });
  });

  test('the link reads back as the Day view on that day', () => {
    const { params } = parseHash(dayHref('#/calendar?scope=all', '2026-12-31'));
    expect(resolveState(params, { today: TODAY, wide: false })).toMatchObject({ view: 'day', day: '2026-12-31' });
  });
});

describe('resolveState for the Day view', () => {
  test('reads view=day and date from the hash', () => {
    expect(resolveState({ view: 'day', date: '2026-10-06' }, { today: TODAY, wide: true }))
      .toEqual({ view: 'day', month: '2026-10', selected: null, week: '2026-10-04', day: '2026-10-06' });
  });

  test('its week and month come from the day, whatever else the hash says', () => {
    expect(resolveState({ view: 'day', date: '2026-11-01', w: '2026-10-04', m: '2026-10', d: '2026-10-06' }, { today: TODAY }))
      .toEqual({ view: 'day', month: '2026-11', selected: null, week: '2026-11-01', day: '2026-11-01' });
  });

  test('no date, or a bad one, is today', () => {
    expect(resolveState({ view: 'day' }, { today: TODAY }).day).toBe(TODAY);
    expect(resolveState({ view: 'day', date: '2026-02-30' }, { today: TODAY }).day).toBe(TODAY);
    expect(resolveState({ view: 'day', date: 'tomorrow' }, { today: TODAY }).day).toBe(TODAY);
    expect(resolveState({ view: 'day', date: '2026-10-14T00:00:00Z' }, { today: TODAY }).day).toBe(TODAY);
  });

  test('the chosen view beats the width, and the stored view counts only without one', () => {
    expect(resolveState({ view: 'day', date: '2026-10-06' }, { today: TODAY, wide: false }).view).toBe('day');
    expect(resolveState({}, { today: TODAY, wide: false, stored: 'day' }).view).toBe('day');
    expect(resolveState({}, { today: TODAY, wide: true, stored: 'day' }).day).toBe(TODAY);
    expect(resolveState({ view: 'week' }, { today: TODAY, wide: true, stored: 'day' }).view).toBe('week');
  });

  test('other views ignore date', () => {
    const week = resolveState({ view: 'week', date: '2027-03-03' }, { today: TODAY });
    expect(week).toMatchObject({ view: 'week', week: '2026-10-11', month: '2026-10' });
    expect(resolveState({ view: 'list', date: '2027-03-03' }, { today: TODAY }).month).toBe('2026-10');
  });

  test('in the other views day is where the Day view would open', () => {
    expect(resolveState({ view: 'week', w: '2026-10-18' }, { today: TODAY }).day).toBe('2026-10-18');
    expect(resolveState({ view: 'week' }, { today: TODAY }).day).toBe(TODAY);
    expect(resolveState({ view: 'month', m: '2026-12', d: '2026-12-09' }, { today: TODAY }).day).toBe('2026-12-09');
    expect(resolveState({ view: 'month', m: '2026-12' }, { today: TODAY }).day).toBe('2026-12-01');
  });
});
