import { describe, test, expect } from 'vitest';
import { zonedIso } from '../../portal/js/dates.js';
import {
  PERIODS, DEFAULT_PERIOD, normalizePeriod, schoolYearStart, dayText, rangeText, reportPeriod, inPeriod,
  sessionSummary, homeworkOutcome, homeworkSummary, resultSummary,
  unreleasedCount, reportPeople, sessionNotes, buildReport,
} from '../../portal/js/report-model.js';

// Tue Oct 6, 2026, 12:00 Pacific (PDT, UTC-7)
const NOW = new Date('2026-10-06T19:00:00Z');
const at = (day, time = '16:00') => zonedIso(day, time);

const P30 = reportPeriod('30d', NOW);   // Sep 7 to Oct 6

let seq = 0;
const session = (day, extra = {}) => ({
  id: ++seq, student_id: 's1', tutor_id: 't1', subject: 'Algebra', status: 'scheduled', attendance: 'present', recap: null,
  starts_at: at(day, '16:00'), ends_at: at(day, '17:00'), ...extra,
});
const task = (extra = {}) => ({
  id: ++seq, student_id: 's1', kind: 'assignment', title: 'Worksheet', due_at: at('2026-09-20', '23:59'), completed_at: null,
  created_at: at('2026-09-10', '09:00'), ...extra,
});
const sub = (taskId, extra = {}) => ({
  id: ++seq, task_id: taskId, student_id: 's1', created_at: at('2026-09-19', '18:00'), grade: null, ...extra,
});
const grade = (result, releasedDay, extra = {}) => ({ result, released_at: releasedDay ? at(releasedDay, '12:00') : null, ...extra });

describe('periods', () => {
  test('three choices, 30 days by default', () => {
    expect(PERIODS.map((p) => p.key)).toEqual(['30d', '90d', 'year']);
    expect(PERIODS.map((p) => p.label)).toEqual(['Last 30 days', 'Last 90 days', 'This school year']);
    expect(DEFAULT_PERIOD).toBe('30d');
  });

  test('normalizePeriod falls back to the default', () => {
    expect(normalizePeriod('90d')).toBe('90d');
    expect(normalizePeriod('year')).toBe('year');
    expect(normalizePeriod('7d')).toBe('30d');
    expect(normalizePeriod('')).toBe('30d');
    expect(normalizePeriod(null)).toBe('30d');
    expect(normalizePeriod(undefined)).toBe('30d');
    expect(normalizePeriod(['90d'])).toBe('30d');
  });

  test('schoolYearStart: August 1 of this year from August on, last year before', () => {
    expect(schoolYearStart('2026-10-06')).toBe('2026-08-01');
    expect(schoolYearStart('2026-12-31')).toBe('2026-08-01');
    expect(schoolYearStart('2027-01-01')).toBe('2026-08-01');
    expect(schoolYearStart('2027-07-31')).toBe('2026-08-01');
    expect(schoolYearStart('2026-08-01')).toBe('2026-08-01');
    expect(schoolYearStart('2026-07-31')).toBe('2025-08-01');
  });

  test('last 30 days is today and the 29 days before it', () => {
    expect(P30).toMatchObject({ key: '30d', label: 'Last 30 days', start: '2026-09-07', end: '2026-10-06', days: 30 });
    expect(P30.text).toBe('Sep 7 to Oct 6, 2026');
  });

  test('last 90 days and this school year', () => {
    const p90 = reportPeriod('90d', NOW);
    expect(p90).toMatchObject({ key: '90d', start: '2026-07-09', end: '2026-10-06', days: 90 });
    expect(p90.text).toBe('Jul 9 to Oct 6, 2026');
    const year = reportPeriod('year', NOW);
    expect(year).toMatchObject({ key: 'year', label: 'This school year', start: '2026-08-01', end: '2026-10-06', days: 67 });
    expect(year.text).toBe('Aug 1 to Oct 6, 2026');
  });

  test('the school year before August started last year', () => {
    const year = reportPeriod('year', new Date('2027-03-15T20:00:00Z'));
    expect(year).toMatchObject({ start: '2026-08-01', end: '2027-03-15' });
    expect(year.text).toBe('Aug 1, 2026 to Mar 15, 2027');
  });

  test('an unknown key gives the default period', () => {
    expect(reportPeriod('nope', NOW).key).toBe('30d');
    expect(reportPeriod(undefined, NOW).key).toBe('30d');
  });

  test('today is the business-zone day, not the viewer\'s', () => {
    // 22:00 Pacific on Oct 6 is already Oct 7 in UTC
    expect(reportPeriod('30d', new Date('2026-10-07T05:00:00Z')).end).toBe('2026-10-06');
    // 01:00 Pacific on Oct 7
    expect(reportPeriod('30d', new Date('2026-10-07T08:00:00Z')).end).toBe('2026-10-07');
  });

  test('30 days across a year boundary', () => {
    const p = reportPeriod('30d', new Date('2027-01-10T20:00:00Z'));
    expect(p.start).toBe('2026-12-12');
    expect(p.text).toBe('Dec 12, 2026 to Jan 10, 2027');
  });

  test('dayText and rangeText', () => {
    expect(dayText('2026-10-06')).toBe('Oct 6, 2026');
    expect(rangeText('2026-10-06', '2026-10-06')).toBe('Oct 6, 2026');
    expect(rangeText('2026-09-07', '2026-10-06')).toBe('Sep 7 to Oct 6, 2026');
    expect(rangeText('2025-12-30', '2026-01-02')).toBe('Dec 30, 2025 to Jan 2, 2026');
  });

  test('inPeriod keeps both end days and works in the business zone', () => {
    expect(inPeriod(at('2026-09-07', '00:00'), P30)).toBe(true);
    expect(inPeriod(at('2026-09-06', '23:59'), P30)).toBe(false);
    expect(inPeriod(at('2026-10-06', '23:59'), P30)).toBe(true);
    expect(inPeriod(at('2026-10-07', '00:00'), P30)).toBe(false);
    // 9 pm Pacific on Sep 6 is Sep 7 in UTC: still outside
    expect(inPeriod('2026-09-07T04:00:00Z', P30)).toBe(false);
    expect(inPeriod(null, P30)).toBe(false);
    expect(inPeriod('', P30)).toBe(false);
    expect(inPeriod('not a date', P30)).toBe(false);
  });
});

describe('sessionSummary', () => {
  test('counts held, attended, late, absent, unrecorded and cancelled', () => {
    const sessions = [
      session('2026-09-08'),                                          // present
      session('2026-09-15', { attendance: 'late' }),                  // late
      session('2026-09-22', { attendance: 'absent' }),                // absent
      session('2026-09-29', { attendance: null }),                    // over, no attendance
      session('2026-10-01', { status: 'cancelled', attendance: null }),
      session('2026-10-03', { status: 'cancelled', attendance: null }),
    ];
    expect(sessionSummary(sessions, P30, NOW)).toMatchObject({
      held: 4, attended: 2, late: 1, absent: 1, unrecorded: 1, cancelled: 2, total: 6,
    });
  });

  test('hours add up the attended sessions only', () => {
    const sessions = [
      session('2026-09-08'),                                                                 // 1 h present
      session('2026-09-15', { attendance: 'late', ends_at: at('2026-09-15', '17:30') }),     // 1.5 h late
      session('2026-09-22', { attendance: 'absent' }),                                       // not counted
      session('2026-09-29', { attendance: null }),                                           // not counted
    ];
    const s = sessionSummary(sessions, P30, NOW);
    expect(s.minutes).toBe(150);
    expect(s.hours).toBe(2.5);
  });

  test('hours round to a tenth', () => {
    const sessions = [session('2026-09-08', { ends_at: at('2026-09-08', '16:50') })];   // 50 minutes
    expect(sessionSummary(sessions, P30, NOW).hours).toBe(0.8);
  });

  test('attendance percent is attended out of the sessions with attendance recorded', () => {
    const sessions = [
      session('2026-09-08'), session('2026-09-09'), session('2026-09-10'),
      session('2026-09-11', { attendance: 'absent' }),
      session('2026-09-12', { attendance: null }),
    ];
    expect(sessionSummary(sessions, P30, NOW).attendancePercent).toBe(75);
    expect(sessionSummary([session('2026-09-12', { attendance: null })], P30, NOW).attendancePercent).toBeNull();
    expect(sessionSummary([], P30, NOW).attendancePercent).toBeNull();
  });

  test('sessions outside the period are not counted', () => {
    const sessions = [session('2026-09-06'), session('2026-09-07'), session('2026-10-06', { starts_at: at('2026-10-06', '08:00'), ends_at: at('2026-10-06', '09:00') })];
    expect(sessionSummary(sessions, P30, NOW).held).toBe(2);
  });

  test('a session that has not ended yet is neither held nor attended', () => {
    const later = session('2026-10-06', { starts_at: at('2026-10-06', '14:00'), ends_at: at('2026-10-06', '15:00'), attendance: null });
    const underway = session('2026-10-06', { starts_at: at('2026-10-06', '11:30'), ends_at: at('2026-10-06', '12:30'), attendance: null });
    expect(sessionSummary([later, underway], P30, NOW)).toMatchObject({ held: 0, unrecorded: 0, total: 0 });
  });

  test('a cancelled session counts as cancelled even if attendance was marked, and never as held', () => {
    const s = sessionSummary([session('2026-09-08', { status: 'cancelled', attendance: 'present' })], P30, NOW);
    expect(s).toMatchObject({ held: 0, attended: 0, cancelled: 1, total: 1, minutes: 0 });
  });

  test('a cancelled session later today still counts as cancelled', () => {
    const later = session('2026-10-06', { status: 'cancelled', starts_at: at('2026-10-06', '16:00'), ends_at: at('2026-10-06', '17:00'), attendance: null });
    expect(sessionSummary([later], P30, NOW).cancelled).toBe(1);
  });

  test('empty, null and malformed input', () => {
    expect(sessionSummary([], P30, NOW)).toMatchObject({ held: 0, cancelled: 0, total: 0, hours: 0 });
    expect(sessionSummary(null, P30, NOW).total).toBe(0);
    const bad = [{ id: 1, starts_at: 'nope', ends_at: 'nope' }, null, { id: 2, starts_at: at('2026-09-08') }];
    expect(sessionSummary(bad, P30, NOW).total).toBe(0);
  });

  test('a longer period includes older sessions', () => {
    const sessions = [session('2026-08-12'), session('2026-09-08')];
    expect(sessionSummary(sessions, P30, NOW).held).toBe(1);
    expect(sessionSummary(sessions, reportPeriod('90d', NOW), NOW).held).toBe(2);
    expect(sessionSummary(sessions, reportPeriod('year', NOW), NOW).held).toBe(2);
  });
});

describe('homeworkOutcome', () => {
  const due = at('2026-09-20', '23:59');

  test('an assignment: first submission before the due time is on time, after is late', () => {
    const a = task({ due_at: due });
    expect(homeworkOutcome(a, [sub(a.id, { created_at: at('2026-09-20', '23:00') })], NOW)).toBe('on-time');
    expect(homeworkOutcome(a, [sub(a.id, { created_at: at('2026-09-21', '08:00') })], NOW)).toBe('late');
    expect(homeworkOutcome(a, [sub(a.id, { created_at: due })], NOW)).toBe('on-time');
  });

  test('an assignment is judged by its FIRST submission', () => {
    const a = task({ due_at: due });
    const subs = [
      sub(a.id, { created_at: at('2026-09-25', '10:00') }),
      sub(a.id, { created_at: at('2026-09-19', '10:00') }),
    ];
    expect(homeworkOutcome(a, subs, NOW)).toBe('on-time');
  });

  test('an assignment ignores completed_at', () => {
    const a = task({ due_at: due, completed_at: at('2026-09-18', '10:00') });
    expect(homeworkOutcome(a, [], NOW)).toBe('missing');
  });

  test('a task is judged by its tick', () => {
    const early = task({ kind: 'task', due_at: due, completed_at: at('2026-09-19', '10:00') });
    const lateTick = task({ kind: 'task', due_at: due, completed_at: at('2026-09-22', '10:00') });
    expect(homeworkOutcome(early, [], NOW)).toBe('on-time');
    expect(homeworkOutcome(lateTick, [], NOW)).toBe('late');
  });

  test('not finished: missing once past due, open before', () => {
    expect(homeworkOutcome(task({ due_at: at('2026-10-05', '23:59') }), [], NOW)).toBe('missing');
    expect(homeworkOutcome(task({ due_at: at('2026-10-06', '23:59') }), [], NOW)).toBe('open');
    expect(homeworkOutcome(task({ kind: 'task', due_at: at('2026-10-06', '08:00') }), [], NOW)).toBe('missing');
    expect(homeworkOutcome(task({ kind: 'task', due_at: at('2026-10-20', '08:00') }), [], NOW)).toBe('open');
  });

  test('no due date: finished is on time, otherwise open, never missing', () => {
    expect(homeworkOutcome(task({ kind: 'task', due_at: null, completed_at: at('2026-09-10') }), [], NOW)).toBe('on-time');
    expect(homeworkOutcome(task({ kind: 'task', due_at: null }), [], NOW)).toBe('open');
    const a = task({ due_at: null });
    expect(homeworkOutcome(a, [sub(a.id)], NOW)).toBe('on-time');
    expect(homeworkOutcome(a, [], NOW)).toBe('open');
  });

  test('a submission with no usable time does not finish an assignment', () => {
    const a = task({ due_at: due });
    expect(homeworkOutcome(a, [sub(a.id, { created_at: null })], NOW)).toBe('missing');
  });
});

describe('homeworkSummary', () => {
  test('counts on time, late, missing and open for work due in the period', () => {
    const onTime = task({ due_at: at('2026-09-20') });
    const lateOne = task({ due_at: at('2026-09-21') });
    const missing = task({ due_at: at('2026-09-22') });
    const open = task({ due_at: at('2026-10-06', '23:59') });
    const tick = task({ kind: 'task', due_at: at('2026-09-23'), completed_at: at('2026-09-23', '10:00') });
    const subs = [
      sub(onTime.id, { created_at: at('2026-09-20', '10:00') }),
      sub(lateOne.id, { created_at: at('2026-09-25', '10:00') }),
    ];
    const out = homeworkSummary([onTime, lateOne, missing, open, tick], subs, P30, NOW);
    expect(out).toEqual({ assigned: 5, onTime: 2, late: 1, missing: 1, open: 1, completed: 3 });
  });

  test('assigned = on time + late + missing + open', () => {
    const tasks = Array.from({ length: 9 }, (_, i) => task({ due_at: at(`2026-09-${String(10 + i).padStart(2, '0')}`) }));
    const subs = [sub(tasks[0].id, { created_at: at('2026-09-10', '10:00') }), sub(tasks[1].id, { created_at: at('2026-09-25', '10:00') })];
    const o = homeworkSummary(tasks, subs, P30, NOW);
    expect(o.onTime + o.late + o.missing + o.open).toBe(o.assigned);
    expect(o.assigned).toBe(9);
  });

  test('work due outside the period is not counted, even if created inside it', () => {
    const before = task({ due_at: at('2026-09-05'), created_at: at('2026-09-08') });
    const after = task({ due_at: at('2026-10-20'), created_at: at('2026-09-20') });
    expect(homeworkSummary([before, after], [], P30, NOW).assigned).toBe(0);
  });

  test('a repeating task with far-off copies only counts the ones due in the period', () => {
    const copies = Array.from({ length: 20 }, (_, i) => task({ kind: 'task', due_at: at(`2026-10-${String(1 + i).padStart(2, '0')}`) }));
    const out = homeworkSummary(copies, [], P30, NOW);
    expect(out.assigned).toBe(6);   // Oct 1 to Oct 6
    expect(out.missing).toBe(5);    // Oct 1 to 5 are past
    expect(out.open).toBe(1);       // Oct 6 evening
  });

  test('undated work counts in the period it was created in', () => {
    const doneUndated = task({ kind: 'task', due_at: null, created_at: at('2026-09-15'), completed_at: at('2026-09-16') });
    const openUndated = task({ kind: 'task', due_at: null, created_at: at('2026-09-15') });
    const oldUndated = task({ kind: 'task', due_at: null, created_at: at('2026-08-15') });
    expect(homeworkSummary([doneUndated, openUndated, oldUndated], [], P30, NOW)).toEqual({
      assigned: 2, onTime: 1, late: 0, missing: 0, open: 1, completed: 1,
    });
  });

  test('a longer period brings in older work', () => {
    const old = task({ due_at: at('2026-08-20') });
    expect(homeworkSummary([old], [], P30, NOW).assigned).toBe(0);
    expect(homeworkSummary([old], [], reportPeriod('90d', NOW), NOW).missing).toBe(1);
  });

  test('empty and null input', () => {
    expect(homeworkSummary([], [], P30, NOW)).toEqual({ assigned: 0, onTime: 0, late: 0, missing: 0, open: 0, completed: 0 });
    expect(homeworkSummary(null, null, P30, NOW).assigned).toBe(0);
  });

  test('submissions of other tasks do not finish this one', () => {
    const a = task({ due_at: at('2026-09-20') });
    const b = task({ due_at: at('2026-09-21') });
    const out = homeworkSummary([a, b], [sub(b.id, { created_at: at('2026-09-21', '10:00') })], P30, NOW);
    expect(out).toMatchObject({ onTime: 1, missing: 1 });
  });
});

describe('resultSummary', () => {
  test('completed over completed plus missing, by the latest released result', () => {
    const tasks = [task(), task(), task(), task()];
    const subs = [
      sub(tasks[0].id, { grade: grade('completed', '2026-09-21') }),
      sub(tasks[1].id, { grade: grade('missing', '2026-09-22') }),
      sub(tasks[2].id, { grade: grade('completed', null) }),                     // a draft: not released
      sub(tasks[3].id, { created_at: at('2026-09-12'), grade: grade('missing', '2026-09-13') }),
      sub(tasks[3].id, { created_at: at('2026-09-20'), grade: grade('completed', '2026-09-23') }),  // redone
    ];
    expect(resultSummary(tasks, subs, P30, NOW)).toEqual({ completed: 2, missing: 1, total: 3, rate: 2 / 3, extended: 0 });
  });

  test('work never handed in counts as missing once past due, in the period it was due', () => {
    const late = task({ due_at: at('2026-09-20') });
    const early = task({ due_at: at('2026-08-20') });
    const ahead = task({ due_at: at('2026-10-20') });
    expect(resultSummary([late, early, ahead], [], P30, NOW)).toMatchObject({ completed: 0, missing: 1, total: 1, rate: 0 });
    expect(resultSummary([late, early, ahead], [], reportPeriod('90d', NOW), NOW)).toMatchObject({ missing: 2 });
  });

  test('results released outside the period are left out', () => {
    const tasks = [task(), task()];
    const subs = [
      sub(tasks[0].id, { grade: grade('completed', '2026-09-06') }),
      sub(tasks[1].id, { grade: grade('completed', '2026-09-07') }),
    ];
    expect(resultSummary(tasks, subs, P30, NOW)).toMatchObject({ completed: 1, total: 1 });
    expect(resultSummary(tasks, subs, reportPeriod('90d', NOW), NOW)).toMatchObject({ completed: 2 });
  });

  test('extended work is counted apart until its new due date passes', () => {
    const open = task({ due_at: at('2026-10-09'), extended_from: at('2026-09-30') });
    const ranOut = task({ due_at: at('2026-10-02'), extended_from: at('2026-09-25') });
    const subs = [
      sub(open.id, { grade: grade('extended', '2026-10-01') }),
      sub(ranOut.id, { grade: grade('extended', '2026-09-26') }),
    ];
    expect(resultSummary([open, ranOut], subs, P30, NOW)).toEqual({ completed: 0, missing: 1, total: 1, rate: 0, extended: 1 });
  });

  test('a grade row that comes back as an array still works; tasks never count', () => {
    const a = task();
    const chore = task({ kind: 'task', due_at: at('2026-09-20') });
    expect(resultSummary([a, chore], [sub(a.id, { grade: [grade('completed', '2026-09-20')] })], P30, NOW))
      .toMatchObject({ completed: 1, missing: 0, total: 1, rate: 1 });
  });

  test('nothing decided', () => {
    expect(resultSummary([], [], P30, NOW)).toEqual({ completed: 0, missing: 0, total: 0, rate: null, extended: 0 });
    expect(resultSummary(null, null, P30, NOW).total).toBe(0);
  });
});

describe('unreleasedCount', () => {
  test('counts assignments whose latest attempt has a result that is not released', () => {
    const a = task();
    const b = task();
    const c = task();
    const d = task();
    const subs = [
      sub(a.id, { grade: grade('completed', null) }),                       // draft
      sub(b.id, { grade: grade('completed', '2026-09-20') }),               // released
      sub(c.id, { grade: grade(null, null) }),                              // not graded yet
      sub(d.id, { created_at: at('2026-09-10'), grade: grade('missing', '2026-09-11') }),
      sub(d.id, { created_at: at('2026-09-20'), grade: grade('extended', null) }),   // newer draft
    ];
    expect(unreleasedCount([a, b, c, d], subs, P30)).toBe(2);
    expect(unreleasedCount([], [], P30)).toBe(0);
    expect(unreleasedCount(null, null, P30)).toBe(0);
  });

  test('only assignments due in the period count, not older drafts', () => {
    const inside = task({ due_at: at('2026-09-20') });
    const spring = task({ due_at: at('2026-04-10') });
    const later = task({ due_at: at('2026-10-20') });
    const subs = [
      sub(inside.id, { grade: grade('completed', null) }),
      sub(spring.id, { grade: grade('completed', null) }),
      sub(later.id, { grade: grade('completed', null) }),
    ];
    expect(unreleasedCount([inside, spring, later], subs, P30)).toBe(1);
    // the same drafts, seen from other days: April's draft is counted in a period that covers April
    const inSpring = reportPeriod('90d', new Date('2026-05-01T19:00:00Z'));
    expect(unreleasedCount([inside, spring, later], subs, inSpring)).toBe(1);
    // this school year, seen next May, covers September and the October due date
    const nextMay = reportPeriod('year', new Date('2027-05-01T19:00:00Z'));
    expect(unreleasedCount([inside, spring, later], subs, nextMay)).toBe(2);
  });

  test('undated work counts by the day it was created', () => {
    const fresh = task({ due_at: null, created_at: at('2026-09-15') });
    const stale = task({ due_at: null, created_at: at('2026-03-15') });
    const subs = [sub(fresh.id, { grade: grade('missing', null) }), sub(stale.id, { grade: grade('missing', null) })];
    expect(unreleasedCount([fresh, stale], subs, P30)).toBe(1);
  });

  test('a task with no submissions is never counted', () => {
    expect(unreleasedCount([task()], [], P30)).toBe(0);
  });
});

describe('reportPeople', () => {
  const tutors = [
    { tutor_id: 't1', full_name: 'Daniel Ortiz', subject: 'Algebra' },
    { tutor_id: 't2', full_name: 'Priya Shah', subject: 'Writing' },
  ];

  test('current tutors and subjects, sorted', () => {
    expect(reportPeople({ tutors, sessions: [], period: P30 })).toEqual({
      tutors: ['Daniel Ortiz', 'Priya Shah'], subjects: ['Algebra', 'Writing'],
    });
  });

  test('adds a tutor and subject from a session in the period, once', () => {
    const sessions = [
      session('2026-09-10', { tutor_id: 't9', subject: 'Geometry' }),
      session('2026-09-11', { tutor_id: 't9', subject: 'geometry' }),
      session('2026-09-12', { tutor_id: 't1', subject: 'Algebra' }),
    ];
    const names = new Map([['t9', 'Sam Former']]);
    expect(reportPeople({ tutors, sessions, period: P30, names })).toEqual({
      tutors: ['Daniel Ortiz', 'Priya Shah', 'Sam Former'], subjects: ['Algebra', 'Geometry', 'Writing'],
    });
  });

  test('ignores cancelled sessions and sessions outside the period', () => {
    const sessions = [
      session('2026-09-10', { tutor_id: 't9', subject: 'Geometry', status: 'cancelled' }),
      session('2026-08-10', { tutor_id: 't8', subject: 'Biology' }),
    ];
    const names = new Map([['t9', 'Sam Former'], ['t8', 'Old Tutor']]);
    expect(reportPeople({ tutors: [], sessions, period: P30, names })).toEqual({ tutors: [], subjects: [] });
  });

  test('a tutor with an unknown name is left out; blank subjects too', () => {
    const sessions = [session('2026-09-10', { tutor_id: 'ghost', subject: '  ' })];
    expect(reportPeople({ tutors: [{ tutor_id: 't1', full_name: null, subject: null }], sessions, period: P30 })).toEqual({ tutors: [], subjects: [] });
  });

  test('missing input', () => {
    expect(reportPeople({ period: P30 })).toEqual({ tutors: [], subjects: [] });
  });
});

describe('sessionNotes', () => {
  const tutors = [{ tutor_id: 't1', full_name: 'Daniel Ortiz', subject: 'Algebra' }];

  test('recaps in date order with date, subject, tutor and text', () => {
    const sessions = [
      session('2026-09-22', { recap: 'Factoring.' }),
      session('2026-09-08', { recap: 'Linear equations.', subject: 'Math', tutor_id: 't2' }),
      session('2026-09-15', { recap: '  Quadratics.  ' }),
    ];
    const names = new Map([['t2', 'Priya Shah']]);
    const notes = sessionNotes(sessions, P30, { now: NOW, tutors, names });
    expect(notes.map((n) => n.day)).toEqual(['2026-09-08', '2026-09-15', '2026-09-22']);
    expect(notes[0]).toMatchObject({ dateText: 'Tue, Sep 8', subject: 'Math', tutor: 'Priya Shah', recap: 'Linear equations.' });
    expect(notes[1]).toMatchObject({ subject: 'Algebra', tutor: 'Daniel Ortiz', recap: 'Quadratics.' });
  });

  test('skips sessions with no recap, cancelled ones, ones outside the period and ones not over yet', () => {
    const sessions = [
      session('2026-09-10', { recap: null }),
      session('2026-09-11', { recap: '   ' }),
      session('2026-09-12', { recap: 'Cancelled but written', status: 'cancelled' }),
      session('2026-09-05', { recap: 'Too early' }),
      session('2026-10-06', { recap: 'Later today', starts_at: at('2026-10-06', '14:00'), ends_at: at('2026-10-06', '15:00') }),
      session('2026-09-14', { recap: 'Kept' }),
    ];
    expect(sessionNotes(sessions, P30, { now: NOW, tutors }).map((n) => n.recap)).toEqual(['Kept']);
  });

  test('a blank subject reads "Tutoring session"; an unknown tutor is null', () => {
    const notes = sessionNotes([session('2026-09-14', { recap: 'Kept', subject: null, tutor_id: 'ghost' })], P30, { now: NOW });
    expect(notes[0]).toMatchObject({ subject: 'Tutoring session', tutor: null });
  });

  test('the year shows when the note is not from this year', () => {
    const period = reportPeriod('year', new Date('2027-01-10T20:00:00Z'));
    const notes = sessionNotes([session('2026-12-20', { recap: 'Winter.' })], period, { now: new Date('2027-01-10T20:00:00Z') });
    expect(notes[0].dateText).toBe('Sun, Dec 20, 2026');
  });

  test('same start time sorts by id', () => {
    const a = session('2026-09-14', { recap: 'A' });
    const b = session('2026-09-14', { recap: 'B' });
    expect(sessionNotes([b, a], P30, { now: NOW }).map((n) => n.recap)).toEqual(['A', 'B']);
  });

  test('no sessions', () => {
    expect(sessionNotes([], P30, { now: NOW })).toEqual([]);
    expect(sessionNotes(null, P30, { now: NOW })).toEqual([]);
  });
});

describe('buildReport', () => {
  test('puts every section together for one student', () => {
    const hw = task({ due_at: at('2026-09-20'), title: 'Worksheet' });
    const sessions = [
      session('2026-09-08', { recap: 'Linear equations.' }),
      session('2026-09-15', { attendance: 'absent' }),
      session('2026-09-22', { status: 'cancelled', attendance: null }),
    ];
    const submissions = [sub(hw.id, { created_at: at('2026-09-19'), grade: grade('completed', '2026-09-21') })];
    const r = buildReport({
      studentName: ' Maya Lin ',
      sessions,
      tasks: [hw],
      submissions,
      tutors: [{ tutor_id: 't1', full_name: 'Daniel Ortiz', subject: 'Algebra' }],
      periodKey: '30d',
      now: NOW,
    });
    expect(r.studentName).toBe('Maya Lin');
    expect(r.period.text).toBe('Sep 7 to Oct 6, 2026');
    expect(r.preparedText).toBe('Oct 6, 2026');
    expect(r.people).toEqual({ tutors: ['Daniel Ortiz'], subjects: ['Algebra'] });
    expect(r.sessions).toMatchObject({ held: 2, attended: 1, absent: 1, cancelled: 1, hours: 1 });
    expect(r.homework).toMatchObject({ assigned: 1, onTime: 1 });
    expect(r.results).toEqual({ completed: 1, missing: 0, total: 1, rate: 1, extended: 0 });
    expect(r.notes).toHaveLength(1);
    expect(r.unreleased).toBe(0);
  });

  test('a brand new student with nothing yet', () => {
    const r = buildReport({ studentName: 'New Student', now: NOW });
    expect(r.sessions.total).toBe(0);
    expect(r.homework.assigned).toBe(0);
    expect(r.results.total).toBe(0);
    expect(r.notes).toEqual([]);
    expect(r.people).toEqual({ tutors: [], subjects: [] });
    expect(r.period.key).toBe('30d');
  });

  test('the period changes what is counted, not the data', () => {
    const sessions = [session('2026-08-12'), session('2026-09-08')];
    expect(buildReport({ sessions, periodKey: '30d', now: NOW }).sessions.held).toBe(1);
    expect(buildReport({ sessions, periodKey: '90d', now: NOW }).sessions.held).toBe(2);
    expect(buildReport({ sessions, periodKey: 'year', now: NOW }).sessions.held).toBe(2);
    expect(buildReport({ sessions, periodKey: 'junk', now: NOW }).period.key).toBe('30d');
  });

  test('staff see drafts counted apart, never in the results', () => {
    const a = task();
    const r = buildReport({ tasks: [a], submissions: [sub(a.id, { grade: grade('completed', null) })], now: NOW });
    expect(r.results.total).toBe(0);
    expect(r.unreleased).toBe(1);
  });

  test('drafts from before the period are not mentioned', () => {
    const old = task({ due_at: at('2026-04-10') });
    const r = buildReport({ tasks: [old], submissions: [sub(old.id, { grade: grade('completed', null) })], periodKey: '30d', now: NOW });
    expect(r.unreleased).toBe(0);
  });
});
