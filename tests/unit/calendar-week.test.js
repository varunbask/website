import { describe, test, expect } from 'vitest';
import {
  AGENDA_DAYS, MAX_DOTS, NOTES_DAYS,
  dayLabel, itemAria, chipTime, dayEntries, dotsForDay, chipsFor,
  agendaGroups, agendaWithSessions, needsNotes,
  deriveWeek, monthOfWeek, weekDays, hourLabel, hourMarks, nowFraction, slotTime, sessionsInRange, viewRange,
  resolveSessionFilter, filterSessions, tutorOptions, sessionWho,
} from '../../portal/js/calendar-model.js';
import { deriveItems } from '../../portal/js/buckets.js';
import { hourRange, layoutDay } from '../../portal/js/sessions-model.js';
import { zonedIso } from '../../portal/js/dates.js';

// Wednesday, October 14, 2026 at 12:00 pm Pacific
const NOW = new Date('2026-10-14T19:00:00Z');
const TODAY = '2026-10-14';
const DAY = 24 * 3_600_000;

let nextId = 1;
const session = (key, start, end, extra = {}) => ({
  id: nextId++,
  student_id: 's1',
  tutor_id: 't1',
  series_id: null,
  subject: 'Algebra',
  starts_at: zonedIso(key, start),
  ends_at: zonedIso(key, end),
  location: null,
  meeting_url: null,
  notes: null,
  status: 'scheduled',
  attendance: null,
  recap: null,
  moved_from: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...extra,
});

const task = (id, extra = {}) => ({
  id, student_id: 's1', kind: 'assignment', title: `Task ${id}`, details: '',
  due_at: null, completed_at: null, created_at: '2026-09-01T00:00:00Z', ...extra,
});
const items = (tasks) => deriveItems(tasks, [], NOW, { audience: 'family' });

describe('week days and hours', () => {
  test('deriveWeek: the hash week, the selected day, today, or the month', () => {
    expect(deriveWeek({ week: '2026-10-20', selected: null, month: '2026-10', today: TODAY })).toBe('2026-10-18');
    expect(deriveWeek({ week: null, selected: '2026-10-28', month: '2026-10', today: TODAY })).toBe('2026-10-25');
    expect(deriveWeek({ week: null, selected: null, month: '2026-10', today: TODAY })).toBe('2026-10-11');
    expect(deriveWeek({ week: null, selected: null, month: '2026-12', today: TODAY })).toBe('2026-11-29');
    expect(deriveWeek({ week: 'nope', selected: 'nope', month: undefined, today: TODAY })).toBe('2026-10-11');
  });

  test('monthOfWeek follows the Wednesday', () => {
    expect(monthOfWeek('2026-10-25')).toBe('2026-10');
    expect(monthOfWeek('2026-11-01')).toBe('2026-11');
    expect(monthOfWeek('2026-09-27')).toBe('2026-09');
    expect(monthOfWeek('2026-12-27')).toBe('2026-12');
  });

  test('weekDays lists seven days with today and the weekend marked', () => {
    const days = weekDays('2026-10-11', TODAY);
    expect(days.map((d) => d.key)).toEqual([
      '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17',
    ]);
    expect(days.map((d) => d.short)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(days[2]).toMatchObject({ long: 'Tuesday', num: 13, isToday: false, isWeekend: false });
    expect(days[3].isToday).toBe(true);
    expect(days.filter((d) => d.isWeekend).map((d) => d.short)).toEqual(['Sun', 'Sat']);
  });

  test('a week across the DST change keeps seven distinct days', () => {
    const keys = weekDays('2026-11-01', TODAY).map((d) => d.key);
    expect(new Set(keys).size).toBe(7);
    expect(keys[0]).toBe('2026-11-01');
    expect(keys[6]).toBe('2026-11-07');
  });

  test('hour labels read like the clock', () => {
    expect(hourLabel(0)).toBe('12 am');
    expect(hourLabel(7)).toBe('7 am');
    expect(hourLabel(12)).toBe('12 pm');
    expect(hourLabel(16)).toBe('4 pm');
    expect(hourLabel(23)).toBe('11 pm');
  });

  test('hourMarks lists the hours a range shows', () => {
    expect(hourMarks({ start: 7, end: 10 })).toEqual([7, 8, 9]);
    expect(hourMarks({ start: 7, end: 7 })).toEqual([]);
    expect(hourMarks(hourRange([]))).toHaveLength(14);
  });

  test('nowFraction places now over the shown hours, or null outside them', () => {
    // 12:00 pm Pacific over 7 am to 9 pm: 5 hours in of 14
    expect(nowFraction(NOW, { start: 7, end: 21 })).toBeCloseTo(5 / 14);
    expect(nowFraction(NOW, { start: 12, end: 14 })).toBe(0);
    expect(nowFraction(NOW, { start: 13, end: 21 })).toBeNull();
    expect(nowFraction(NOW, { start: 7, end: 12 })).toBeNull();
    // 11:30 pm Pacific is outside the default range
    expect(nowFraction(new Date('2026-10-15T06:30:00Z'), { start: 7, end: 21 })).toBeNull();
  });

  test('slotTime turns how far down a column a click was into an hour', () => {
    const range = { start: 7, end: 21 };
    expect(slotTime(0, range)).toBe('07:00');
    expect(slotTime(0.5, range)).toBe('14:00');
    expect(slotTime(9.5 / 14, range)).toBe('16:00');
    expect(slotTime(10 / 14, range)).toBe('17:00');
    expect(slotTime(1, range)).toBe('20:00');
    expect(slotTime(1.4, range)).toBe('20:00');
    expect(slotTime(-0.2, range)).toBe('07:00');
    expect(slotTime(Number.NaN, range)).toBe('07:00');
  });

  test('sessionsInRange keeps sessions that start on the days given', () => {
    const list = [
      session('2026-10-10', '16:00', '17:00'),
      session('2026-10-11', '09:00', '10:00'),
      session('2026-10-17', '16:00', '17:00'),
      session('2026-10-18', '09:00', '10:00'),
    ];
    expect(sessionsInRange(list, '2026-10-11', '2026-10-17').map((s) => s.id)).toEqual([list[1].id, list[2].id]);
    expect(sessionsInRange(null, '2026-10-11', '2026-10-17')).toEqual([]);
  });

  test('a late session at the edge of the week stays on its own Pacific day', () => {
    // 11:30 pm Pacific on Saturday is already Sunday in UTC
    const late = session('2026-10-17', '23:00', '23:45');
    expect(sessionsInRange([late], '2026-10-11', '2026-10-17')).toHaveLength(1);
    expect(sessionsInRange([late], '2026-10-18', '2026-10-24')).toHaveLength(0);
  });

  test('viewRange: the week, the 42-day month grid, or the list days', () => {
    expect(viewRange('week', { week: '2026-10-11' }, TODAY)).toEqual({ start: '2026-10-11', end: '2026-10-17' });
    expect(viewRange('month', { month: '2026-10' }, TODAY)).toEqual({ start: '2026-09-27', end: '2026-11-07' });
    expect(viewRange('list', { range: 30 }, TODAY)).toEqual({ start: '2026-10-14', end: '2026-11-12' });
    expect(viewRange('list', {}, TODAY).end).toBe('2026-11-12');
  });

  test('the week grid gets blocks for each day from the shared layout', () => {
    const week = [
      session('2026-10-12', '16:00', '17:00'),
      session('2026-10-12', '16:30', '17:30'),
      session('2026-10-14', '07:00', '08:00'),
    ];
    const range = hourRange(week);
    expect(range).toEqual({ start: 7, end: 21 });
    const monday = layoutDay(week.slice(0, 2), { startHour: range.start, endHour: range.end });
    expect(monday.map((b) => [b.col, b.cols])).toEqual([[0, 2], [1, 2]]);
    // the click position of its top edge maps back to its start hour
    expect(slotTime(monday[0].top, range)).toBe('16:00');
  });
});

describe('sessions on the month', () => {
  const morning = session('2026-10-14', '09:00', '10:00', { subject: 'SAT Reading' });
  const afternoon = session('2026-10-14', '16:00', '17:00');

  test('chipTime is short on the hour', () => {
    expect(chipTime(afternoon.starts_at)).toBe('4 pm');
    expect(chipTime(morning.starts_at)).toBe('9 am');
    expect(chipTime(zonedIso('2026-10-14', '16:30'))).toBe('4:30 pm');
    expect(chipTime(zonedIso('2026-10-14', '12:00'))).toBe('12 pm');
    expect(chipTime(zonedIso('2026-10-14', '00:15'))).toBe('12:15 am');
  });

  test('dayEntries puts sessions before due items, and they share the chip capacity', () => {
    const due = items([task(1, { due_at: zonedIso(TODAY, '23:59') }), task(2, { due_at: zonedIso(TODAY, '09:00') })]);
    const entries = dayEntries([morning, afternoon], due);
    expect(entries.map((e) => e.type)).toEqual(['session', 'session', 'due', 'due']);
    expect(entries[0].session).toBe(morning);
    expect(entries[2].item).toBe(due[0]);
    const { shown, more } = chipsFor(entries, 3);
    expect(shown.map((e) => e.type)).toEqual(['session', 'session']);
    expect(more).toBe(2);
    expect(chipsFor(entries, 0)).toEqual({ shown: [], more: 4 });
    expect(dayEntries(undefined, undefined)).toEqual([]);
  });

  test('dots: sessions first, one dot kept for due work', () => {
    const due = items([task(1, { due_at: zonedIso('2026-10-10', '23:59') }), task(2, { due_at: zonedIso('2026-10-30', '23:59') })]);
    expect(dotsForDay([morning], [], 'family').map((d) => d.kind)).toEqual(['session']);
    expect(dotsForDay([morning], due, 'family').map((d) => d.kind)).toEqual(['session', 'overdue', 'open']);
    expect(dotsForDay([morning, afternoon, morning], [], 'family')).toHaveLength(MAX_DOTS);
    expect(dotsForDay([morning, afternoon, morning], due, 'family').map((d) => d.kind)).toEqual(['session', 'session', 'overdue']);
    expect(dotsForDay([], due, 'family').map((d) => d.kind)).toEqual(['overdue', 'open']);
    expect(dotsForDay([], [], 'family')).toEqual([]);
    expect(dotsForDay([morning], [], 'family')[0].session).toBe(morning);
  });

  test('dayLabel speaks the sessions, then the items', () => {
    const due = items([task(1, { title: 'Algebra worksheet', due_at: zonedIso(TODAY, '09:00') })]);
    const whoFor = () => 'Daniel Ortiz';
    expect(dayLabel(TODAY, due, TODAY, 'family', { sessions: [afternoon], whoFor, now: NOW }))
      .toBe('Wednesday, October 14, today. 1 session: Algebra with Daniel Ortiz, 4:00 to 5:00 pm. 1 item: Algebra worksheet, overdue');
    const tomorrow = [
      session('2026-10-15', '09:00', '10:00', { subject: 'SAT Reading' }),
      session('2026-10-15', '16:00', '17:00'),
    ];
    expect(dayLabel('2026-10-15', [], TODAY, 'family', { sessions: tomorrow, whoFor: () => null, now: NOW }))
      .toBe('Thursday, October 15. 2 sessions: SAT Reading, 9:00 to 10:00 am; Algebra, 4:00 to 5:00 pm');
    expect(dayLabel(TODAY, [], TODAY, 'family', { sessions: [], now: NOW }))
      .toBe('Wednesday, October 14, today. Nothing scheduled or due.');
  });

  test('dayLabel says when a session moved or was cancelled', () => {
    const moved = session('2026-10-16', '16:30', '17:30', { moved_from: zonedIso('2026-10-15', '16:00') });
    const cancelled = session('2026-10-17', '10:00', '11:30', { status: 'cancelled', subject: 'SAT Reading' });
    expect(dayLabel('2026-10-16', [], TODAY, 'family', { sessions: [moved], whoFor: () => 'Daniel Ortiz', now: NOW }))
      .toBe('Friday, October 16. 1 session: Algebra with Daniel Ortiz, 4:30 to 5:30 pm, moved');
    expect(dayLabel('2026-10-17', [], TODAY, 'family', { sessions: [cancelled], whoFor: () => 'Priya Shah', now: NOW }))
      .toBe('Saturday, October 17. 1 session: SAT Reading with Priya Shah, 10:00 to 11:30 am, cancelled');
  });

  test('itemAria is what a due chip says', () => {
    const [item] = items([task(1, { title: 'Essay', due_at: zonedIso('2026-10-30', '23:59') })]);
    expect(itemAria(item, 'family')).toBe('Essay, to do');
    expect(itemAria({ ...item, studentName: 'Maya Lin' }, 'staff')).toBe('Essay for Maya Lin, to do');
    expect(itemAria({ ...item, task: { ...item.task, title: '' } }, 'family')).toBe('Untitled, to do');
  });
});

describe('agendaWithSessions', () => {
  const dueItems = items([
    task(1, { due_at: zonedIso('2026-10-14', '23:59') }),
    task(2, { due_at: zonedIso('2026-10-20', '23:59') }),
  ]);
  const groups = agendaGroups(dueItems, TODAY);

  test('days with only sessions get a group, and sessions come sorted before the due items', () => {
    const late = session('2026-10-14', '18:00', '19:00');
    const early = session('2026-10-14', '09:00', '10:00');
    const only = session('2026-10-16', '16:00', '17:00');
    const merged = agendaWithSessions(groups, [late, only, early], TODAY);
    expect(merged.days.map((d) => d.key)).toEqual(['2026-10-14', '2026-10-16', '2026-10-20']);
    expect(merged.days[0].sessions.map((s) => s.id)).toEqual([early.id, late.id]);
    expect(merged.days[0].items.map((i) => i.task.id)).toEqual([1]);
    expect(merged.days[1].items).toEqual([]);
    expect(merged.days[2].sessions).toEqual([]);
    expect(merged.days[2].items.map((i) => i.task.id)).toEqual([2]);
    expect(merged.end).toBe(groups.end);
  });

  test('sessions before today are left out; ones past the range count as later', () => {
    const past = session('2026-10-13', '16:00', '17:00');
    const beyond = session('2026-11-20', '16:00', '17:00');
    const edge = session('2026-11-12', '16:00', '17:00');
    const merged = agendaWithSessions(groups, [past, beyond, edge], TODAY);
    expect(merged.days.map((d) => d.key)).toEqual(['2026-10-14', '2026-10-20', '2026-11-12']);
    expect(merged.later).toBe(1);
    const longer = agendaWithSessions(agendaGroups(dueItems, TODAY, { days: 60 }), [beyond], TODAY, { days: 60 });
    expect(longer.days.map((d) => d.key)).toContain('2026-11-20');
    expect(longer.later).toBe(0);
  });

  test('no sessions leaves the item groups as they were', () => {
    const merged = agendaWithSessions(groups, [], TODAY, { days: AGENDA_DAYS });
    expect(merged.days.map((d) => [d.key, d.items.length, d.sessions.length])).toEqual([
      ['2026-10-14', 1, 0], ['2026-10-20', 1, 0],
    ]);
    expect(merged.overdue).toBe(groups.overdue);
    expect(merged.undated).toBe(groups.undated);
  });
});

describe('needsNotes', () => {
  const tutor = { id: 't1', role: 'tutor' };
  const admin = { id: 'a1', role: 'admin' };
  const over = (key, extra = {}) => session(key, '16:00', '17:00', extra);

  test('past sessions of the last week with no attendance, that the viewer may write up', () => {
    const yesterday = over('2026-10-13');
    const lastWeek = over('2026-10-08');
    const tooOld = over('2026-10-06');
    const marked = over('2026-10-12', { attendance: 'present' });
    const cancelled = over('2026-10-11', { status: 'cancelled' });
    const upcoming = over('2026-10-15');
    const others = over('2026-10-12', { tutor_id: 't2' });
    const list = [upcoming, yesterday, tooOld, marked, cancelled, lastWeek, others];
    expect(needsNotes(list, NOW, tutor).map((s) => s.id)).toEqual([lastWeek.id, yesterday.id]);
    expect(needsNotes(list, NOW, admin).map((s) => s.id)).toEqual([lastWeek.id, others.id, yesterday.id]);
    expect(NOTES_DAYS).toBe(7);
  });

  test('a session that ends later today does not count until it ends', () => {
    const later = session(TODAY, '13:00', '14:00');
    const done = session(TODAY, '10:00', '11:00');
    expect(needsNotes([later, done], NOW, tutor).map((s) => s.id)).toEqual([done.id]);
    expect(needsNotes([done], NOW, null)).toEqual([]);
    expect(needsNotes([done], new Date(NOW.getTime() + 7 * DAY), tutor)).toEqual([]);
  });
});

describe('whose sessions', () => {
  const mine = session('2026-10-14', '16:00', '17:00', { tutor_id: 't1' });
  const theirs = session('2026-10-15', '16:00', '17:00', { tutor_id: 't2' });
  const list = [mine, theirs];

  test('a tutor starts on their own sessions, an admin on everyone, families on all', () => {
    expect(resolveSessionFilter({}, 'tutor')).toEqual({ who: 'mine', tutor: null });
    expect(resolveSessionFilter({ who: 'all' }, 'tutor')).toEqual({ who: 'all', tutor: null });
    expect(resolveSessionFilter({ who: 'bogus', tutor: 't2' }, 'tutor')).toEqual({ who: 'mine', tutor: null });
    expect(resolveSessionFilter({}, 'admin')).toEqual({ who: 'all', tutor: null });
    expect(resolveSessionFilter({ tutor: 't2' }, 'admin')).toEqual({ who: 'all', tutor: 't2' });
    expect(resolveSessionFilter({ who: 'mine', tutor: 't2' }, 'student')).toEqual({ who: 'all', tutor: null });
    expect(resolveSessionFilter(undefined, null)).toEqual({ who: 'all', tutor: null });
  });

  test('filterSessions', () => {
    expect(filterSessions(list, { who: 'mine', tutor: null }, { id: 't1' })).toEqual([mine]);
    expect(filterSessions(list, { who: 'all', tutor: null }, { id: 't1' })).toEqual(list);
    expect(filterSessions(list, { who: 'all', tutor: 't2' }, { id: 'a1' })).toEqual([theirs]);
    expect(filterSessions(list, { who: 'mine', tutor: null }, null)).toEqual(list);
    expect(filterSessions(list, undefined, { id: 't1' })).toEqual(list);
    expect(filterSessions(undefined, { who: 'all' }, { id: 't1' })).toEqual([]);
  });

  test('tutorOptions: tutors from links and sessions, by name, with a fallback', () => {
    const names = new Map([['t1', 'Daniel Ortiz'], ['t2', 'Priya Shah']]);
    const links = [{ tutor_id: 't2', student_id: 's1', subject: 'SAT' }, { tutor_id: 't3', student_id: 's2', subject: null }];
    expect(tutorOptions({ links, sessions: list, names })).toEqual([
      { value: 't1', label: 'Daniel Ortiz' },
      { value: 't2', label: 'Priya Shah' },
      { value: 't3', label: 'Unknown tutor' },
    ]);
    expect(tutorOptions()).toEqual([]);
  });

  test('tutorOptions: an admin who teaches comes first as "My sessions"', () => {
    const names = new Map([['t1', 'Daniel Ortiz'], ['a1', 'Varun Baskaran']]);
    const links = [{ tutor_id: 'a1', student_id: 's1', subject: 'Algebra' }, { tutor_id: 't1', student_id: 's2', subject: null }];
    expect(tutorOptions({ links, names, meId: 'a1' })).toEqual([
      { value: 'a1', label: 'My sessions' },
      { value: 't1', label: 'Daniel Ortiz' },
    ]);
    // an admin who teaches nobody gets the plain list
    expect(tutorOptions({ links: [links[1]], names, meId: 'a1' })).toEqual([{ value: 't1', label: 'Daniel Ortiz' }]);
  });

  test('sessionWho names the tutor on one student, the student on the all-students calendar', () => {
    const tutorNames = new Map([['t1', 'Daniel Ortiz'], ['t2', 'Priya Shah']]);
    const studentNames = new Map([['s1', 'Maya Lin']]);
    expect(sessionWho(mine, { tutorNames })).toBe('Daniel Ortiz');
    expect(sessionWho(mine, { tutorNames: new Map() })).toBeNull();
    const all = { allScope: true, tutorNames, studentNames };
    expect(sessionWho(mine, { ...all, role: 'tutor', viewerId: 't1' })).toBe('Maya Lin');
    expect(sessionWho(theirs, { ...all, role: 'tutor', viewerId: 't1' })).toBe('Maya Lin, taught by Priya Shah');
    expect(sessionWho(mine, { ...all, role: 'admin', viewerId: 'a1' })).toBe('Maya Lin, taught by Daniel Ortiz');
    expect(sessionWho(mine, { ...all, role: 'admin', viewerId: 'a1', short: true })).toBe('Maya Lin');
    expect(sessionWho({ ...mine, student_id: 's9' }, { ...all, role: 'tutor', viewerId: 't1' })).toBeNull();
  });
});
