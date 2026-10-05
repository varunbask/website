import { describe, test, expect } from 'vitest';
import {
  SNAP_MINUTES, toMinutes, minutesToTime, canDragSession, canDragDue, dropStart, grabOffset,
  movedTimes, moveProblem, moveUpdates, moveSummary, moveToast, MOVE_PROBLEMS, followingFits, followingMove,
  dueMoveProblem, dueAtFor, dueToast, DUE_PAST,
} from '../../portal/js/calendar-drag-model.js';
import { zonedIso } from '../../portal/js/dates.js';

// Tuesday 29 September 2026, 4:00 to 5:00 pm Pacific
const NOW = new Date(zonedIso('2026-09-28', '12:00'));
const session = (over = {}) => ({
  id: 's1', student_id: 'st1', tutor_id: 't1', series_id: null, status: 'scheduled', subject: 'Algebra',
  starts_at: zonedIso('2026-09-29', '16:00'), ends_at: zonedIso('2026-09-29', '17:00'), ...over,
});
const tutor = { id: 't1', role: 'tutor' };
const admin = { id: 'a1', role: 'admin' };

describe('times', () => {
  test('minutes and HH:MM both ways', () => {
    expect(toMinutes('16:15')).toBe(975);
    expect(minutesToTime(975)).toBe('16:15');
    expect(minutesToTime(0)).toBe('00:00');
    expect(SNAP_MINUTES).toBe(15);
  });
});

describe('who may drag', () => {
  test('a session: its tutor or an admin, while it is ahead and not cancelled', () => {
    expect(canDragSession(session(), tutor, { now: NOW })).toBe(true);
    expect(canDragSession(session(), admin, { now: NOW })).toBe(true);
    expect(canDragSession(session(), { id: 't2', role: 'tutor' }, { now: NOW })).toBe(false);
    expect(canDragSession(session(), { id: 'st1', role: 'student' }, { now: NOW })).toBe(false);
    expect(canDragSession(session({ status: 'cancelled' }), tutor, { now: NOW })).toBe(false);
    expect(canDragSession(session(), tutor, { now: new Date(zonedIso('2026-09-29', '16:30')) })).toBe(false);
    expect(canDragSession(session(), admin, { now: NOW, readOnly: true })).toBe(false);
  });

  test('a session: a tutor no longer linked to the student cannot', () => {
    expect(canDragSession(session(), tutor, { now: NOW, links: [{ tutor_id: 't1', student_id: 'other' }] })).toBe(false);
    expect(canDragSession(session(), tutor, { now: NOW, links: [{ tutor_id: 't1', student_id: 'st1' }] })).toBe(true);
  });

  test('a due date: staff, unless graded or a finished task', () => {
    const item = (task, grade = null) => ({ task: { id: 1, kind: 'assignment', due_at: zonedIso('2026-10-01'), ...task }, grade });
    expect(canDragDue(item({}), { staff: true })).toBe(true);
    expect(canDragDue(item({}), { staff: false })).toBe(false);
    expect(canDragDue(item({}), { staff: true, readOnly: true })).toBe(false);
    expect(canDragDue(item({}, { released_at: '2026-09-27T00:00:00Z' }), { staff: true })).toBe(false);
    expect(canDragDue(item({}, { released_at: null }), { staff: true })).toBe(true);
    expect(canDragDue(item({ kind: 'task', completed_at: '2026-09-27T00:00:00Z' }), { staff: true })).toBe(false);
    expect(canDragDue(item({ kind: 'task', completed_at: null }), { staff: true })).toBe(true);
  });
});

describe('where a drop lands', () => {
  const hours = { start: 8, end: 20 }; // 12 hours shown

  test('snaps to 15 minutes', () => {
    // halfway down is 2:00 pm
    expect(dropStart({ fraction: 0.5, hours, duration: 60 })).toBe(14 * 60);
    // 2:07 rounds to 2:00, 2:08 to 2:15
    expect(dropStart({ fraction: (14 * 60 + 7 - 480) / 720, hours, duration: 60 })).toBe(14 * 60);
    expect(dropStart({ fraction: (14 * 60 + 8 - 480) / 720, hours, duration: 60 })).toBe(14 * 60 + 15);
  });

  test('keeps the grab point under the pointer', () => {
    expect(dropStart({ fraction: 0.5, hours, duration: 60, grabMinutes: 30 })).toBe(13 * 60 + 30);
  });

  test('stays inside the hours shown', () => {
    expect(dropStart({ fraction: -0.2, hours, duration: 60 })).toBe(8 * 60);
    expect(dropStart({ fraction: 1.3, hours, duration: 90 })).toBe(18 * 60 + 30);
    expect(dropStart({ fraction: Number.NaN, hours, duration: 60 })).toBe(8 * 60);
  });

  test('the grab offset is measured from the session start', () => {
    // 4:00 pm session, pointer at 4:30
    expect(grabOffset({ fraction: (16 * 60 + 30 - 480) / 720, hours, session: session() })).toBe(30);
    expect(grabOffset({ fraction: 0, hours, session: session() })).toBe(0);
    expect(grabOffset({ fraction: 1, hours, session: session() })).toBe(60);
  });
});

describe('the move', () => {
  test('keeps the length on the new day and time', () => {
    expect(movedTimes(session(), { date: '2026-09-30', start: '15:30' })).toEqual({
      starts_at: zonedIso('2026-09-30', '15:30'), ends_at: zonedIso('2026-09-30', '16:30'),
    });
    expect(movedTimes(session(), { date: '2026-09-30', start: '23:30' })).toBeNull();
  });

  test('problems: nowhere new, overnight, past', () => {
    expect(moveProblem(session(), { date: '2026-09-29', start: '16:00' }, NOW)).toBe('same');
    expect(moveProblem(session(), { date: '2026-09-29', start: '23:30' }, NOW)).toBe('overnight');
    expect(moveProblem(session(), { date: '2026-09-27', start: '16:00' }, NOW)).toBe('past');
    expect(moveProblem(session(), { date: '2026-09-28', start: '11:45' }, NOW)).toBe('past');
    expect(moveProblem(session(), { date: '2026-09-28', start: '12:15' }, NOW)).toBeNull();
    expect(MOVE_PROBLEMS.past).toMatch(/hasn’t passed/);
  });

  test('this session: only its times are written', () => {
    expect(moveUpdates({ session: session(), date: '2026-09-30', start: '15:00' })).toEqual([
      { id: 's1', fields: { starts_at: zonedIso('2026-09-30', '15:00'), ends_at: zonedIso('2026-09-30', '16:00') } },
    ]);
    expect(moveUpdates({ session: session(), date: '2026-09-29', start: '16:00' })).toEqual([]);
    expect(moveUpdates({ session: session(), date: '2026-09-29', start: '23:30' })).toEqual([]);
  });

  test('this and following: each later session moves by the same change', () => {
    const first = session({ series_id: 'x' });
    const later = session({ id: 's2', series_id: 'x', starts_at: zonedIso('2026-10-06', '16:00'), ends_at: zonedIso('2026-10-06', '17:00') });
    // a week-two session the tutor had already moved to 4:30 keeps its half hour
    const moved = session({ id: 's3', series_id: 'x', starts_at: zonedIso('2026-10-13', '16:30'), ends_at: zonedIso('2026-10-13', '17:30') });
    const updates = moveUpdates({ session: first, rows: [first, later, moved], apply: 'following', date: '2026-09-30', start: '15:00' });
    expect(updates).toEqual([
      { id: 's1', fields: { starts_at: zonedIso('2026-09-30', '15:00'), ends_at: zonedIso('2026-09-30', '16:00') } },
      { id: 's2', fields: { starts_at: zonedIso('2026-10-07', '15:00'), ends_at: zonedIso('2026-10-07', '16:00') } },
      { id: 's3', fields: { starts_at: zonedIso('2026-10-14', '15:30'), ends_at: zonedIso('2026-10-14', '16:30') } },
    ]);
  });

  test('this and following must fit every later session inside its day', () => {
    const first = session({ series_id: 'x' });
    const late = session({ id: 's2', series_id: 'x', starts_at: zonedIso('2026-10-06', '21:30'), ends_at: zonedIso('2026-10-06', '22:30') });
    // +4 hours would push the 9:30 pm session past midnight
    expect(followingFits({ session: first, rows: [first, late], date: '2026-09-29', start: '20:00' })).toBe(false);
    // +1 hour fits (10:30 to 11:30 pm)
    expect(followingFits({ session: first, rows: [first, late], date: '2026-09-29', start: '17:00' })).toBe(true);
    // an earlier move that would start a session before midnight the day before
    const early = session({ id: 's3', series_id: 'x', starts_at: zonedIso('2026-10-13', '01:00'), ends_at: zonedIso('2026-10-13', '02:00') });
    expect(followingFits({ session: first, rows: [first, early], date: '2026-09-29', start: '14:00' })).toBe(false);
    expect(followingFits({ session: first, rows: [first], date: '2026-09-29', start: '23:30' })).toBe(false);
  });

  test('following with no rows moves just the session', () => {
    expect(moveUpdates({ session: session(), rows: [], apply: 'following', date: '2026-09-30', start: '15:00' })).toHaveLength(1);
    expect(moveUpdates({ session: session(), rows: null, apply: 'following', date: '2026-09-30', start: '15:00' })).toHaveLength(1);
  });

  test('a series across the November time change keeps its wall time', () => {
    const first = session({ series_id: 'x', starts_at: zonedIso('2026-10-27', '16:00'), ends_at: zonedIso('2026-10-27', '17:00') });
    const after = session({ id: 's2', series_id: 'x', starts_at: zonedIso('2026-11-03', '16:00'), ends_at: zonedIso('2026-11-03', '17:00') });
    const updates = moveUpdates({ session: first, rows: [first, after], apply: 'following', date: '2026-10-28', start: '15:00' });
    expect(updates[1].fields).toEqual({ starts_at: zonedIso('2026-11-04', '15:00'), ends_at: zonedIso('2026-11-04', '16:00') });
  });

  test('a Month drop keeps the start time', () => {
    const start = '16:00';
    expect(moveProblem(session(), { date: '2026-10-02', start }, NOW)).toBeNull();
    expect(moveUpdates({ session: session(), date: '2026-10-02', start })[0].fields.starts_at).toBe(zonedIso('2026-10-02', '16:00'));
  });

  test('words', () => {
    const times = movedTimes(session(), { date: '2026-09-30', start: '16:00' });
    expect(moveSummary(session(), times, { who: 'Maya Lin', viewerInZone: true }))
      .toBe('Algebra with Maya Lin moves to Wednesday, September 30, 4:00 to 5:00 pm.');
    expect(moveSummary(session(), times, { viewerInZone: false })).toBe('Algebra moves to Wednesday, September 30, 4:00 to 5:00 pm PT.');
    expect(moveToast(1)).toBe('Session moved');
    expect(moveToast(4)).toBe('4 sessions moved');
  });
});

describe('due dates', () => {
  const item = { task: { id: 7, due_at: zonedIso('2026-10-01') } };

  test('problems: the same day, or a day before today', () => {
    expect(dueMoveProblem(item, '2026-10-01', '2026-09-28')).toBe('same');
    expect(dueMoveProblem(item, '2026-09-27', '2026-09-28')).toBe('past');
    expect(dueMoveProblem(item, '2026-09-28', '2026-09-28')).toBeNull();
    expect(dueMoveProblem({ task: { id: 8, due_at: null } }, '2026-10-02', '2026-09-28')).toBeNull();
    expect(DUE_PAST).toMatch(/today or later/);
  });

  test('due at 11:59 pm Pacific, and the toast', () => {
    expect(dueAtFor('2026-10-08')).toBe(zonedIso('2026-10-08', '23:59'));
    expect(dueToast('2026-10-08')).toBe('Due date moved to Thursday, October 8');
  });
});

describe('this and following on a drop', () => {
  test('moves the series by the days and minutes of the drop, keeping its length', () => {
    const s = session({ series_id: 'x' });
    expect(followingMove({ session: s, date: '2026-10-01', start: '16:30' })).toEqual({
      p_session: 's1', p_shift: 2, p_start_delta: 30, p_end_delta: 30, p_fields: {},
    });
    expect(followingMove({ session: s, date: '2026-09-29', start: '15:00' })).toMatchObject({ p_shift: 0, p_start_delta: -60, p_end_delta: -60 });
  });

  test('nothing to do when it lands where it was', () => {
    expect(followingMove({ session: session({ series_id: 'x' }), date: '2026-09-29', start: '16:00' })).toBeNull();
  });
});
