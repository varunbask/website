import { describe, test, expect } from 'vitest';
import {
  QUICK_DURATIONS, DEFAULT_WEEKS, createDefaults, editDefaults, minutesBetween, studentChoices,
  tutorChoices, subjectsFor, defaultSubject, rawFromState, checkSessionForm, plannedTimes,
  buildInsertRows, buildUpdates, changedUpdates, mergeSessions, scheduleLabel, sessionsToast, repeatSummary,
  followingSummary, seriesLeftText, whenText, icsFileName, clashLine, clashReport, saveErrorText,
} from '../../portal/js/session-form-model.js';
import { zonedIso } from '../../portal/js/dates.js';

// Wednesday, October 14, 2026 at 12:00 pm Pacific
const NOW = new Date('2026-10-14T19:00:00Z');
const at = (key, time) => zonedIso(key, time);
let nextId = 1;
const session = (key, start, end, extra = {}) => ({
  id: nextId++, student_id: 's1', tutor_id: 't1', series_id: null, subject: 'Algebra',
  starts_at: at(key, start), ends_at: at(key, end), location: null, meeting_url: null, notes: null,
  status: 'scheduled', attendance: null, recap: null, moved_from: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...extra,
});
const state = (extra = {}) => ({
  date: '2026-10-20', start: '16:00', end: '17:00', subject: 'Algebra', where: 'in-person',
  location: 'Library', meeting_url: '', notes: '', repeat: false, weeks: '8', ...extra,
});

const names = new Map([['t1', 'Daniel Ortiz'], ['t2', 'Priya Shah']]);
const studentNames = new Map([['s1', 'Maya Lin'], ['s2', 'Leo Park']]);

describe('starting values', () => {
  test('create: today, 4 pm and an hour long', () => {
    expect(createDefaults({ now: NOW })).toMatchObject({
      date: '2026-10-14', start: '16:00', end: '17:00', where: 'in-person', repeat: false, weeks: DEFAULT_WEEKS,
    });
  });

  test('create: prefilled from the drawer params', () => {
    const v = createDefaults({ params: { due: '2026-10-21', at: '10:30' }, now: NOW, subject: 'SAT Reading' });
    expect(v).toMatchObject({ date: '2026-10-21', start: '10:30', end: '11:30', subject: 'SAT Reading' });
  });

  test('create: bad params fall back', () => {
    const v = createDefaults({ params: { due: 'tomorrow', at: '25:00' }, now: NOW });
    expect(v).toMatchObject({ date: '2026-10-14', start: '16:00' });
  });

  test('create: a late start clamps the end to 23:59', () => {
    expect(createDefaults({ params: { at: '23:30' }, now: NOW }).end).toBe('23:59');
  });

  test('edit: the stored values, in Pacific time', () => {
    const s = session('2026-10-15', '16:30', '17:15', { location: 'Library', notes: 'Fractions' });
    expect(editDefaults(s)).toMatchObject({
      date: '2026-10-15', start: '16:30', end: '17:15', subject: 'Algebra', where: 'in-person', location: 'Library', notes: 'Fractions',
    });
    const online = session('2026-10-15', '10:00', '11:00', { meeting_url: 'https://meet.example.com/x' });
    expect(editDefaults(online)).toMatchObject({ where: 'online', meeting_url: 'https://meet.example.com/x' });
  });

  test('minutes between two times', () => {
    expect(minutesBetween('16:00', '17:30')).toBe(90);
    expect(minutesBetween('16:00', '16:00')).toBeNull();
    expect(minutesBetween('17:00', '16:00')).toBeNull();
    expect(minutesBetween('', '16:00')).toBeNull();
  });

  test('the quick lengths', () => {
    expect([...QUICK_DURATIONS]).toEqual([30, 45, 60, 90, 120]);
  });
});

describe('who a tutor can book', () => {
  const links = [
    { tutor_id: 't1', student_id: 's1', subject: 'Algebra' },
    { tutor_id: 't2', student_id: 's1', subject: 'SAT Reading' },
    { tutor_id: 't1', student_id: 's2', subject: 'Math' },
    { tutor_id: 't2', student_id: 's3', subject: null },
  ];
  const students = [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }];

  test('a tutor books only students they are linked to', () => {
    const own = links.filter((l) => l.tutor_id === 't1');
    expect(studentChoices({ students, links: own, me: { id: 't1', role: 'tutor' } }).map((s) => s.id)).toEqual(['s1', 's2']);
  });

  test('an admin books students that have a tutor', () => {
    expect(studentChoices({ students, links, me: { id: 'a1', role: 'admin' } }).map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });

  test('tutor choices: an admin picks among the linked tutors by name', () => {
    const admin = { id: 'a1', role: 'admin' };
    expect(tutorChoices({ links, studentId: 's1', me: admin, names })).toEqual([
      { value: 't1', label: 'Daniel Ortiz' }, { value: 't2', label: 'Priya Shah' },
    ]);
    expect(tutorChoices({ links, studentId: 's4', me: admin, names })).toEqual([]);
    expect(tutorChoices({ links, studentId: '', me: admin, names })).toEqual([]);
  });

  test('tutor choices: an admin who teaches the student comes first, marked as them', () => {
    const admin = { id: 'a1', role: 'admin' };
    const withAdmin = [...links, { tutor_id: 'a1', student_id: 's1', subject: 'Algebra' }];
    const named = new Map([...names, ['a1', 'Varun Baskaran']]);
    expect(tutorChoices({ links: withAdmin, studentId: 's1', me: admin, names: named })).toEqual([
      { value: 'a1', label: 'Varun Baskaran (you)' },
      { value: 't1', label: 'Daniel Ortiz' }, { value: 't2', label: 'Priya Shah' },
    ]);
  });

  test('tutor choices: a tutor is only themselves, and only when linked', () => {
    const me = { id: 't1', role: 'tutor' };
    expect(tutorChoices({ links, studentId: 's1', me, names })).toEqual([{ value: 't1', label: 'Daniel Ortiz' }]);
    expect(tutorChoices({ links, studentId: 's3', me, names })).toEqual([]);
  });

  test('subjects of a student and the default for one tutor', () => {
    expect(subjectsFor(links, 's1')).toEqual(['Algebra', 'SAT Reading']);
    expect(subjectsFor(links, 's3')).toEqual([]);
    expect(defaultSubject(links, 't2', 's1')).toBe('SAT Reading');
    expect(defaultSubject(links, 't2', 's3')).toBe('');
    expect(defaultSubject(links, 't9', 's1')).toBe('');
  });
});

describe('checking and writing', () => {
  test('only the chosen place is sent', () => {
    expect(rawFromState(state({ where: 'online', meeting_url: 'https://m.example.com/a' })))
      .toMatchObject({ location: '', meeting_url: 'https://m.example.com/a' });
    expect(rawFromState(state({ where: 'in-person', meeting_url: 'https://m.example.com/a' })))
      .toMatchObject({ location: 'Library', meeting_url: '' });
  });

  test('valid values come back trimmed, with blanks as null', () => {
    const r = checkSessionForm(state({ subject: ' Algebra ', location: ' ', notes: '' }));
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ subject: 'Algebra', location: null, notes: null, weeks: 1, repeat: false });
  });

  test('errors per field', () => {
    const r = checkSessionForm(state({ date: '', start: '17:00', end: '16:00', where: 'online', meeting_url: 'http://x.com' }));
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(['date', 'end', 'meeting_url']);
  });

  test('repeat needs 2 to 26 weeks', () => {
    expect(checkSessionForm(state({ repeat: true, weeks: '1' })).errors.weeks).toBe('Repeat for 2 to 26 weeks.');
    expect(checkSessionForm(state({ repeat: true, weeks: '27' })).errors.weeks).toBe('Repeat for 2 to 26 weeks.');
    expect(checkSessionForm(state({ repeat: true, weeks: 'many' })).errors.weeks).toBe('Repeat for 2 to 26 weeks.');
    const ok = checkSessionForm(state({ repeat: true, weeks: '8' }));
    expect(ok.ok).toBe(true);
    expect(ok.values).toMatchObject({ repeat: true, weeks: 8 });
    // a hidden weeks box does not matter when not repeating
    expect(checkSessionForm(state({ repeat: false, weeks: 'many' })).ok).toBe(true);
  });

  test('editing never repeats', () => {
    const r = checkSessionForm(state({ repeat: true, weeks: '1' }), { creating: false });
    expect(r.ok).toBe(true);
    expect(r.values.repeat).toBe(false);
  });

  test('one session inserts one row with no series', () => {
    const { values } = checkSessionForm(state());
    const rows = buildInsertRows({ studentId: 's1', tutorId: 't1', values });
    expect(rows).toEqual([{
      student_id: 's1', tutor_id: 't1', subject: 'Algebra', starts_at: at('2026-10-20', '16:00'),
      ends_at: at('2026-10-20', '17:00'), location: 'Library', meeting_url: null, notes: null, series_id: null,
    }]);
  });

  test('a weekly repeat inserts one row per week, sharing a series id, same wall time across DST', () => {
    const { values } = checkSessionForm(state({ date: '2026-10-27', repeat: true, weeks: '8' }));
    const rows = buildInsertRows({ studentId: 's1', tutorId: 't1', values, seriesId: 'series-1' });
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((r) => r.series_id))).toEqual(new Set(['series-1']));
    expect(rows[0].starts_at).toBe(at('2026-10-27', '16:00'));
    // Nov 3 is the first Tuesday after the clocks went back on Nov 1
    expect(rows[1].starts_at).toBe(at('2026-11-03', '16:00'));
    expect(rows[7].starts_at).toBe(at('2026-12-15', '16:00'));
    for (const r of rows) expect(Object.keys(r).sort()).toEqual([
      'ends_at', 'location', 'meeting_url', 'notes', 'series_id', 'starts_at', 'student_id', 'subject', 'tutor_id',
    ]);
  });

  test('a new series gets a fresh id when none is given', () => {
    const { values } = checkSessionForm(state({ repeat: true, weeks: '3' }));
    const rows = buildInsertRows({ studentId: 's1', tutorId: 't1', values });
    expect(rows[0].series_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(rows.map((r) => r.series_id)).size).toBe(1);
  });

  test('planned times for an edit of this session or this and following', () => {
    const a = session('2026-10-13', '16:00', '17:00', { series_id: 'x' });
    const b = session('2026-10-20', '16:00', '17:00', { series_id: 'x' });
    const c = session('2026-10-27', '16:00', '17:00', { series_id: 'x' });
    const { values } = checkSessionForm(state({ date: '2026-10-21', start: '16:30', end: '17:30' }), { creating: false });

    expect(plannedTimes(values, { session: b, rows: [b, c], apply: 'this' }))
      .toEqual([{ id: b.id, starts_at: at('2026-10-21', '16:30'), ends_at: at('2026-10-21', '17:30') }]);
    // moved one day later: every following row keeps its own day, shifted by the same day
    expect(plannedTimes(values, { session: b, rows: [b, c], apply: 'following' })).toEqual([
      { id: b.id, starts_at: at('2026-10-21', '16:30'), ends_at: at('2026-10-21', '17:30') },
      { id: c.id, starts_at: at('2026-10-28', '16:30'), ends_at: at('2026-10-28', '17:30') },
    ]);
    expect(a.id).not.toBe(b.id);
  });

  test('following rows get only what changed on the edited session', () => {
    const b = session('2026-10-20', '16:00', '17:00', { series_id: 'x' });
    const c = session('2026-10-27', '16:00', '17:00', { series_id: 'x' });
    const { values } = checkSessionForm(
      state({ subject: 'Geometry', where: 'online', meeting_url: 'https://m.example.com/a', notes: 'Proofs' }),
      { creating: false },
    );
    const updates = buildUpdates({ values, session: b, rows: [b, c], apply: 'following' });
    expect(updates.map((u) => u.id)).toEqual([b.id, c.id]);
    // The time did not change, so c keeps its own; location was blank and stays so
    expect(updates[1].fields).toEqual({ subject: 'Geometry', meeting_url: 'https://m.example.com/a', notes: 'Proofs' });
    expect(Object.keys(updates[0].fields).sort()).toEqual(['ends_at', 'location', 'meeting_url', 'notes', 'starts_at', 'subject']);
    expect(buildUpdates({ values, session: b, rows: [b, c], apply: 'this' })).toHaveLength(1);
  });

  test('a session moved on its own keeps its time and plan when the series changes place', () => {
    const b = session('2026-10-20', '16:00', '17:00', { series_id: 'x', location: 'Library', notes: 'Weekly plan' });
    const moved = session('2026-10-27', '16:30', '17:30', { series_id: 'x', location: 'Library', notes: 'Bring the quiz' });
    const { values } = checkSessionForm(state({ location: 'Room 4', notes: 'Weekly plan' }), { creating: false });
    const updates = buildUpdates({ values, session: b, rows: [b, moved], apply: 'following' });
    expect(updates[1].fields).toEqual({ location: 'Room 4' });
    // Moving the series an hour later moves the odd one an hour too
    const later = checkSessionForm(state({ location: 'Library', notes: 'Weekly plan', start: '17:00', end: '18:00' }), { creating: false });
    const shifted = buildUpdates({ values: later.values, session: b, rows: [b, moved], apply: 'following' });
    expect(shifted[1].fields).toEqual({ starts_at: at('2026-10-27', '17:30'), ends_at: at('2026-10-27', '18:30') });
  });

  test('an update that writes what the row already holds is dropped', () => {
    const b = session('2026-10-20', '16:00', '17:00', { series_id: 'x', location: 'Library', notes: ' Fractions ' });
    const c = session('2026-10-27', '16:00', '17:00', { series_id: 'x', location: 'Library', notes: null });
    const { values } = checkSessionForm(state({ location: 'Library', notes: 'Fractions' }), { creating: false });
    const updates = buildUpdates({ values, session: b, rows: [b, c], apply: 'following' });
    // b is the same as saved (the notes differ only by spaces), so nothing
    // changed and c is left alone too
    expect(changedUpdates(updates, [b, c]).map((u) => u.id)).toEqual([]);
    // A new plan on b reaches c
    const planned = checkSessionForm(state({ location: 'Library', notes: 'Decimals' }), { creating: false });
    expect(changedUpdates(buildUpdates({ values: planned.values, session: b, rows: [b, c], apply: 'following' }), [b, c])
      .map((u) => u.id)).toEqual([b.id, c.id]);
    // a new time counts as a change
    const moved = checkSessionForm(state({ location: 'Library', notes: 'Fractions', start: '16:30', end: '17:30' }), { creating: false });
    expect(changedUpdates(buildUpdates({ values: moved.values, session: b }), [b, c]).map((u) => u.id)).toEqual([b.id]);
    // an unknown row is kept
    expect(changedUpdates([{ id: 99, fields: {} }], [b])).toHaveLength(1);
  });

  test('lists merge by id, the first list winning', () => {
    const a = { id: 1, v: 'first' };
    const merged = mergeSessions([a, { id: 2 }], [{ id: 1, v: 'second' }, { id: 3 }], null);
    expect(merged.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(merged[0]).toBe(a);
  });

  test('error text by database code', () => {
    expect(saveErrorText({ code: '42501' })).toBe('You can only schedule sessions for students you tutor.');
    expect(saveErrorText({ code: '23514' })).toBe('Check the times and details, then try again.');
    expect(saveErrorText({ message: 'Failed to fetch' })).toBe('Check your connection and try again.');
    expect(saveErrorText(null)).toBe('Check your connection and try again.');
  });
});

describe('words', () => {
  test('button and toast text', () => {
    expect(scheduleLabel(1)).toBe('Schedule session');
    expect(scheduleLabel(8)).toBe('Schedule 8 sessions');
    expect(sessionsToast(1, 'cancelled')).toBe('Session cancelled');
    expect(sessionsToast(4, 'cancelled')).toBe('4 sessions cancelled');
    expect(sessionsToast(1, 'deleted')).toBe('Session deleted');
  });

  test('repeat summary names the last day', () => {
    expect(repeatSummary('2026-10-20', 8)).toBe('8 weekly sessions, the last on Tue, Dec 8');
    expect(repeatSummary('2026-10-20', '2')).toBe('2 weekly sessions, the last on Tue, Oct 27');
    expect(repeatSummary('2026-10-20', 1)).toBe('');
    expect(repeatSummary('2026-10-20', 'x')).toBe('');
    expect(repeatSummary('', 8)).toBe('');
  });

  test('following summary counts the rows', () => {
    const b = session('2026-10-15', '16:00', '17:00', { series_id: 'x' });
    expect(followingSummary([b, session('2026-10-22', '16:00', '17:00')], b)).toBe('Applies to 2 sessions, from Thu, Oct 15 on');
    expect(followingSummary([b], b)).toBe('Applies to 1 session, from Thu, Oct 15 on');
  });

  test('series line counts the scheduled sessions after this one', () => {
    const mk = (key, extra = {}) => session(key, '16:00', '17:00', { series_id: 'x', ...extra });
    const a = mk('2026-10-13');
    const b = mk('2026-10-20');
    const c = mk('2026-10-27', { status: 'cancelled' });
    const d = mk('2026-11-03');
    const other = session('2026-11-10', '16:00', '17:00', { series_id: 'y' });
    expect(seriesLeftText([a, b, c, d, other], a)).toBe('Repeats weekly, 2 more sessions');
    expect(seriesLeftText([a, b, c, d, other], b)).toBe('Repeats weekly, 1 more session');
    expect(seriesLeftText([a, b, c, d, other], d)).toBe('Repeats weekly, this is the last session');
    expect(seriesLeftText([other], session('2026-10-13', '16:00', '17:00'))).toBeNull();
  });

  test('when text: long date, range and length', () => {
    const s = session('2026-10-06', '16:00', '17:30');
    expect(whenText(s, { now: NOW, viewerInZone: true })).toEqual({
      date: 'Tuesday, October 6', time: '4:00 to 5:30 pm, 1 hour 30 minutes',
    });
    expect(whenText(session('2027-01-05', '10:00', '11:00'), { now: NOW, viewerInZone: false }))
      .toEqual({ date: 'Tuesday, January 5, 2027', time: '10:00 to 11:00 am PT, 1 hour' });
  });

  test('calendar file names', () => {
    expect(icsFileName(session('2026-10-15', '16:00', '17:00'))).toBe('algebra-oct-15.ics');
    expect(icsFileName(session('2026-10-15', '16:00', '17:00', { subject: 'SAT Reading!' }))).toBe('sat-reading-oct-15.ics');
    expect(icsFileName(session('2026-10-15', '16:00', '17:00'), { series: true })).toBe('algebra-weekly-oct-15.ics');
    expect(icsFileName(session('2026-12-01', '16:00', '17:00', { subject: null }))).toBe('session-dec-1.ics');
    expect(icsFileName(session('2026-12-01', '16:00', '17:00', { subject: '  ' }))).toBe('session-dec-1.ics');
    const long = icsFileName(session('2026-12-01', '16:00', '17:00', { subject: 'A'.repeat(60) }));
    expect(long).toBe(`${'a'.repeat(40)}-dec-1.ics`);
  });
});

describe('clash warning', () => {
  const opts = { tutorNames: names, studentNames, viewerInZone: true };

  test('the tutor is busy with another student', () => {
    const clash = { who: 'tutor', session: session('2026-10-20', '16:00', '17:00', { student_id: 's2' }) };
    expect(clashLine(clash, opts)).toBe('Daniel Ortiz already has Leo Park at 4:00 to 5:00 pm.');
  });

  test('the student has another tutor then', () => {
    const clash = { who: 'student', session: session('2026-10-20', '16:00', '17:00', { tutor_id: 't2', subject: 'SAT Reading' }) };
    expect(clashLine(clash, opts)).toBe('Maya Lin has SAT Reading with Priya Shah then.');
  });

  test('the same tutor and student read as the tutor being busy', () => {
    const clash = { who: 'both', session: session('2026-10-20', '16:30', '17:30') };
    expect(clashLine(clash, opts)).toBe('Daniel Ortiz already has Maya Lin at 4:30 to 5:30 pm.');
  });

  test('missing names and subjects fall back to plain words', () => {
    const clash = { who: 'student', session: session('2026-10-20', '16:00', '17:00', { tutor_id: 't9', subject: null }) };
    expect(clashLine(clash, { viewerInZone: true })).toBe('The student has a tutoring session with This tutor then.');
  });

  const candidate = { studentId: 's1', tutorId: 't1', tutorNames: names, studentNames, viewerInZone: true };

  test('one date: no prefix, the spec wording', () => {
    const list = [
      session('2026-10-20', '16:30', '17:30', { student_id: 's2' }),
      session('2026-10-20', '16:00', '17:00', { tutor_id: 't2', subject: 'SAT Reading' }),
    ];
    const planned = [{ starts_at: at('2026-10-20', '16:00'), ends_at: at('2026-10-20', '17:00') }];
    const r = clashReport({ ...candidate, planned, list });
    expect(r).toMatchObject({ total: 1, count: 1, title: 'This time overlaps another session' });
    // earliest first
    expect(r.lines).toEqual([
      'Maya Lin has SAT Reading with Priya Shah then.',
      'Daniel Ortiz already has Leo Park at 4:30 to 5:30 pm.',
    ]);
  });

  test('no clash gives no title', () => {
    const list = [session('2026-10-20', '17:00', '18:00', { student_id: 's2' })];
    const planned = [{ starts_at: at('2026-10-20', '16:00'), ends_at: at('2026-10-20', '17:00') }];
    expect(clashReport({ ...candidate, planned, list })).toEqual({ total: 1, count: 0, title: null, lines: [] });
  });

  test('a cancelled session does not clash', () => {
    const list = [session('2026-10-20', '16:00', '17:00', { student_id: 's2', status: 'cancelled' })];
    const planned = [{ starts_at: at('2026-10-20', '16:00'), ends_at: at('2026-10-20', '17:00') }];
    expect(clashReport({ ...candidate, planned, list }).title).toBeNull();
  });

  test('every date of a repeat is checked and summarised', () => {
    const { values } = checkSessionForm(state({ date: '2026-10-20', repeat: true, weeks: '8' }));
    const planned = plannedTimes(values);
    const list = [
      session('2026-10-27', '16:00', '17:00', { student_id: 's2' }),
      session('2026-11-10', '15:30', '16:30', { student_id: 's2' }),
      session('2026-11-17', '16:00', '17:00', { tutor_id: 't2' }),
    ];
    const r = clashReport({ ...candidate, planned, list });
    expect(r.title).toBe('3 of 8 dates clash');
    expect(r.lines).toEqual([
      'Tue, Oct 27: Daniel Ortiz already has Leo Park at 4:00 to 5:00 pm.',
      'Tue, Nov 10: Daniel Ortiz already has Leo Park at 3:30 to 4:30 pm.',
      'Tue, Nov 17: Maya Lin has Algebra with Priya Shah then.',
    ]);
  });

  test('long lists are cut short', () => {
    const planned = [{ starts_at: at('2026-10-20', '16:00'), ends_at: at('2026-10-20', '17:00') }];
    const list = Array.from({ length: 6 }, (_, i) => session('2026-10-20', '16:00', '17:00', { student_id: `x${i}` }));
    const r = clashReport({ ...candidate, planned, list });
    expect(r.lines).toHaveLength(5);
    expect(r.lines.at(-1)).toBe('And 2 more.');
  });

  test('an edit ignores the rows it replaces', () => {
    const own = session('2026-10-20', '16:00', '17:00');
    const sibling = session('2026-10-27', '16:00', '17:00');
    const planned = [
      { id: own.id, starts_at: own.starts_at, ends_at: own.ends_at },
      { id: sibling.id, starts_at: sibling.starts_at, ends_at: sibling.ends_at },
    ];
    expect(clashReport({ ...candidate, planned, list: [own, sibling], ignoreIds: planned.map((p) => p.id) }).title).toBeNull();
    expect(clashReport({ ...candidate, planned, list: [own, sibling] }).title).toBe('2 of 2 dates clash');
  });
});
