import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  QUICK_DURATIONS, DEFAULT_COUNT, CLASH_WEEKS, createDefaults, editDefaults, minutesBetween, studentChoices,
  tutorChoices, subjectsFor, defaultSubject, rawFromState, checkSessionForm, plannedTimes, repeatDates,
  buildInsertRow, buildSeriesRow, followingChange, repeatChoices, weekdayName, clashCheckIsPartial,
  buildUpdates, changedUpdates, mergeSessions, scheduleLabel, sessionsToast, repeatSummary,
  followingSummary, seriesLeftText, whenText, icsFileName, clashLine, clashReport, saveErrorText,
  ratedSubjects, subjectChoices, subjectRateHint, trialChange, TRIAL_LABEL, TRIAL_HINT,
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
  location: 'Library', meeting_url: '', notes: '', repeat: false, ends: 'never', until: '', count: '8', ...extra,
});

const names = new Map([['t1', 'Daniel Ortiz'], ['t2', 'Priya Shah']]);
const studentNames = new Map([['s1', 'Maya Lin'], ['s2', 'Leo Park']]);

describe('starting values', () => {
  test('create: today, 4 pm and an hour long', () => {
    expect(createDefaults({ now: NOW })).toMatchObject({
      date: '2026-10-14', start: '16:00', end: '17:00', where: 'in-person', repeat: false, ends: 'never', until: '', count: String(DEFAULT_COUNT),
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
    // without a staff name it uses the admin's own name, or just "You"
    expect(tutorChoices({ links: withAdmin, studentId: 's1', me: { ...admin, full_name: 'Varun B' }, names })[0])
      .toEqual({ value: 'a1', label: 'Varun B (you)' });
    expect(tutorChoices({ links: withAdmin, studentId: 's1', me: admin, names })[0]).toEqual({ value: 'a1', label: 'You' });
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

describe('subjects the admin can price', () => {
  let rateId = 1;
  const rate = (extra = {}) => ({
    id: rateId++, student_id: 's1', tutor_id: null, subject: 'Math', rate_cents: 6000, effective_from: '2026-01-01', voided_at: null, ...extra,
  });
  const links = [
    { tutor_id: 't1', student_id: 's1', subject: 'Algebra' },
    { tutor_id: 't2', student_id: 's1', subject: 'Science' },
    { tutor_id: 't2', student_id: 's2', subject: 'Math' },
  ];
  const NO_RATE = (subject) => `No rate for ${subject} yet, so it will be priced at $0. Pick one of their subjects or add a rate on Account.`;
  const NO_RATE_NONE = (subject) => `No rate for ${subject} yet, so it will be priced at $0. Add a rate on Account.`;

  describe('ratedSubjects', () => {
    test('a student\'s live rated subjects, once each, by name', () => {
      const rates = [
        rate({ subject: 'Science' }),
        rate({ subject: 'Math' }),
        rate({ subject: 'math', effective_from: '2025-06-01' }),
        rate({ subject: ' MATH ' }),
        rate({ subject: 'Reading', student_id: 's2' }),
        rate({ subject: 'Essay', voided_at: '2026-03-01T00:00:00Z' }),
        rate({ subject: null }),
        rate({ subject: '   ' }),
      ];
      expect(ratedSubjects(rates, 's1')).toEqual(['Math', 'Science']);
      expect(ratedSubjects(rates, 's2')).toEqual(['Reading']);
      expect(ratedSubjects(rates, 's3')).toEqual([]);
      expect(ratedSubjects(null, 's1')).toEqual([]);
    });

    test('the wording of the newest rate wins, with spaces collapsed', () => {
      const rates = [
        rate({ subject: 'sat  reading', effective_from: '2026-01-01' }),
        rate({ subject: 'SAT Reading', effective_from: '2026-09-01' }),
      ];
      expect(ratedSubjects(rates, 's1')).toEqual(['SAT Reading']);
    });

    test('a rate for another tutor does not price this tutor', () => {
      const rates = [rate({ subject: 'Math', tutor_id: 't2' }), rate({ subject: 'Science', tutor_id: 't1' }), rate({ subject: 'Reading' })];
      expect(ratedSubjects(rates, 's1')).toEqual(['Math', 'Reading', 'Science']);
      expect(ratedSubjects(rates, 's1', { tutorId: 't1' })).toEqual(['Reading', 'Science']);
      expect(ratedSubjects(rates, 's1', { tutorId: 't2' })).toEqual(['Math', 'Reading']);
    });

    test('a rate that starts later does not price an earlier day', () => {
      const rates = [rate({ subject: 'Math' }), rate({ subject: 'Physics', effective_from: '2026-11-01' })];
      expect(ratedSubjects(rates, 's1', { day: '2026-10-31' })).toEqual(['Math']);
      expect(ratedSubjects(rates, 's1', { day: '2026-11-01' })).toEqual(['Math', 'Physics']);
    });
  });

  describe('subjectChoices', () => {
    test('without rates (a tutor) it is the link subjects, as before', () => {
      expect(subjectChoices({ links, studentId: 's1' })).toEqual(subjectsFor(links, 's1'));
      expect(subjectChoices({ links, studentId: 's1', rates: null })).toEqual(['Algebra', 'Science']);
      expect(subjectChoices({ links, studentId: 's3' })).toEqual([]);
    });

    test('with rates (the admin) the rated subjects come first, then the link subjects', () => {
      const rates = [rate({ subject: 'Math' }), rate({ subject: 'SAT Reading' })];
      expect(subjectChoices({ links, studentId: 's1', rates })).toEqual(['Math', 'SAT Reading', 'Algebra', 'Science']);
    });

    test('a link subject already rated is listed once, whatever its case', () => {
      const rates = [rate({ subject: 'science' }), rate({ subject: 'Math' })];
      expect(subjectChoices({ links, studentId: 's1', rates })).toEqual(['Math', 'science', 'Algebra']);
    });

    test('a student with no rates (an empty list) keeps the link subjects', () => {
      expect(subjectChoices({ links, studentId: 's1', rates: [] })).toEqual(['Algebra', 'Science']);
    });

    test('only the chosen tutor\'s and the student\'s own rates count', () => {
      const rates = [rate({ subject: 'Math', tutor_id: 't2' }), rate({ subject: 'Reading', student_id: 's2' }), rate({ subject: 'Writing' })];
      expect(subjectChoices({ links, studentId: 's1', rates, tutorId: 't1' })).toEqual(['Writing', 'Algebra', 'Science']);
      expect(subjectChoices({ links, studentId: 's1', rates, tutorId: 't2' })).toEqual(['Math', 'Writing', 'Algebra', 'Science']);
    });
  });

  describe('subjectRateHint', () => {
    const ask = (extra = {}) => subjectRateHint({
      subject: 'Math', rates: [rate({ subject: 'Math' })], studentId: 's1', tutorId: 't1', day: '2026-10-20', links, ...extra,
    });

    test('a subject the student is priced for says nothing, whatever its case or spacing', () => {
      expect(ask()).toBeNull();
      expect(ask({ subject: 'math' })).toBeNull();
      expect(ask({ subject: '  MATH ' })).toBeNull();
    });

    test('a subject with no rate says it will be priced at $0, in the spec wording', () => {
      expect(ask({ subject: 'Math/English' })).toBe(NO_RATE('Math/English'));
      expect(ask({ subject: ' Chemistry ' })).toBe(NO_RATE('Chemistry'));
    });

    test('with no rated subject to pick from it only says to add a rate', () => {
      expect(ask({ subject: 'Chemistry', rates: [] })).toBe(NO_RATE_NONE('Chemistry'));
    });

    test('nothing is said until there is something to check', () => {
      expect(ask({ subject: '' })).toBeNull();
      expect(ask({ subject: '   ' })).toBeNull();
      expect(ask({ subject: undefined })).toBeNull();
      expect(ask({ subject: 'Chemistry', rates: null })).toBeNull();
      expect(ask({ subject: 'Chemistry', studentId: '' })).toBeNull();
      expect(ask({ subject: 'Chemistry', tutorId: '' })).toBeNull();
    });

    test('a rate with no subject prices every subject', () => {
      expect(ask({ subject: 'Chemistry', rates: [rate({ subject: null })] })).toBeNull();
    });

    test('a rate for the chosen tutor prices their lessons, another tutor\'s does not', () => {
      expect(ask({ subject: 'Chemistry', rates: [rate({ subject: null, tutor_id: 't1' })] })).toBeNull();
      expect(ask({ subject: 'Chemistry', rates: [rate({ subject: 'Chemistry', tutor_id: 't1' })] })).toBeNull();
      expect(ask({ subject: 'Chemistry', rates: [rate({ subject: null, tutor_id: 't2' })], tutorId: 't1' })).toBe(NO_RATE_NONE('Chemistry'));
      expect(ask({ subject: 'Math', rates: [rate({ subject: 'Math', tutor_id: 't2' })], tutorId: 't1' })).toBe(NO_RATE_NONE('Math'));
    });

    test('a rate for another student does not price this one', () => {
      expect(ask({ subject: 'Math', rates: [rate({ subject: 'Math', student_id: 's2' })] })).toBe(NO_RATE_NONE('Math'));
    });

    test('a voided rate is not a rate', () => {
      expect(ask({ rates: [rate({ subject: 'Math', voided_at: '2026-09-01T00:00:00Z' })] })).toBe(NO_RATE_NONE('Math'));
    });

    test('a rate counts from the day it starts', () => {
      const rates = [rate({ subject: 'Math', effective_from: '2026-11-01' })];
      expect(ask({ rates, day: '2026-10-31' })).toBe(NO_RATE_NONE('Math'));
      expect(ask({ rates, day: '2026-11-01' })).toBeNull();
      // a missing or bad date is today
      expect(ask({ rates, day: '', now: new Date('2026-12-01T20:00:00Z') })).toBeNull();
      expect(ask({ rates, day: 'soon', now: new Date('2026-10-01T20:00:00Z') })).toContain('No rate for Math yet');
    });

    test('billing falls back to the tutor link\'s subject, so a lesson priced that way is quiet', () => {
      // Math/English is not rated, but the link's subject (Algebra) is
      const rates = [rate({ subject: 'Algebra' })];
      expect(ask({ subject: 'Math/English', rates })).toBeNull();
      // the other tutor's link says Science, which is not rated
      expect(ask({ subject: 'Math/English', rates, tutorId: 't2' })).toBe(NO_RATE('Math/English'));
    });
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
    expect(r.values).toMatchObject({ subject: 'Algebra', location: null, notes: null, repeat: false, ends: 'never', until: null });
  });

  test('errors per field', () => {
    const r = checkSessionForm(state({ date: '', start: '17:00', end: '16:00', where: 'online', meeting_url: 'http://x.com' }));
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(['date', 'end', 'meeting_url']);
  });

  test('a weekly repeat never ends by default', () => {
    const r = checkSessionForm(state({ repeat: true }));
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ repeat: true, ends: 'never', until: null });
    // an unknown choice is never too
    expect(checkSessionForm(state({ repeat: true, ends: 'sometimes' })).values.ends).toBe('never');
  });

  test('a repeat can end on a day after the first', () => {
    expect(checkSessionForm(state({ repeat: true, ends: 'on', until: '' })).errors.until).toBe('Choose the last day.');
    expect(checkSessionForm(state({ repeat: true, ends: 'on', until: '2026-10-20' })).errors.until).toBe('Choose a day after the first session.');
    const ok = checkSessionForm(state({ repeat: true, ends: 'on', until: '2026-12-01' }));
    expect(ok.ok).toBe(true);
    expect(ok.values).toMatchObject({ ends: 'on', until: '2026-12-01' });
  });

  test('a repeat can end after 2 to 520 sessions (the day of the last one)', () => {
    for (const bad of ['1', '521', 'many', '']) {
      expect(checkSessionForm(state({ repeat: true, ends: 'after', count: bad })).errors.count).toBe('Enter 2 to 520 sessions.');
    }
    const ok = checkSessionForm(state({ repeat: true, ends: 'after', count: '8' }));
    expect(ok.ok).toBe(true);
    expect(ok.values.until).toBe('2026-12-08');
    // hidden end fields do not matter when not repeating
    expect(checkSessionForm(state({ repeat: false, ends: 'after', count: 'many' })).ok).toBe(true);
  });

  test('editing never repeats', () => {
    const r = checkSessionForm(state({ repeat: true, ends: 'after', count: '1' }), { creating: false });
    expect(r.ok).toBe(true);
    expect(r.values.repeat).toBe(false);
  });

  test('one session inserts one row with no series', () => {
    const { values } = checkSessionForm(state());
    expect(buildInsertRow({ studentId: 's1', tutorId: 't1', values })).toEqual({
      student_id: 's1', tutor_id: 't1', subject: 'Algebra', starts_at: at('2026-10-20', '16:00'),
      ends_at: at('2026-10-20', '17:00'), location: 'Library', meeting_url: null, notes: null, series_id: null,
    });
  });

  test('a weekly repeat is one rule row, which the database fills', () => {
    const { values } = checkSessionForm(state({ date: '2026-10-27', repeat: true }));
    expect(buildSeriesRow({ studentId: 's1', tutorId: 't1', values, id: 'series-1' })).toEqual({
      id: 'series-1', student_id: 's1', tutor_id: 't1', subject: 'Algebra', location: 'Library', meeting_url: null,
      notes: null, start_time: '16:00', end_time: '17:00', first_date: '2026-10-27', until: null,
    });
    const ended = checkSessionForm(state({ repeat: true, ends: 'after', count: '3' })).values;
    const row = buildSeriesRow({ studentId: 's1', tutorId: 't1', values: ended });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.until).toBe('2026-11-03');
  });

  test('repeat dates: the clash check looks half a year ahead, or to the end', () => {
    const never = checkSessionForm(state({ date: '2026-10-27', repeat: true })).values;
    const dates = repeatDates(never);
    expect(dates).toHaveLength(CLASH_WEEKS);
    expect(dates.slice(0, 2)).toEqual(['2026-10-27', '2026-11-03']);
    const three = checkSessionForm(state({ date: '2026-10-27', repeat: true, ends: 'after', count: '3' })).values;
    expect(repeatDates(three)).toEqual(['2026-10-27', '2026-11-03', '2026-11-10']);
    // same wall time across the DST change on Nov 1
    const planned = plannedTimes(three);
    expect(planned.map((t) => t.starts_at)).toEqual([at('2026-10-27', '16:00'), at('2026-11-03', '16:00'), at('2026-11-10', '16:00')]);
  });

  test('this and following: days and minutes to move by, and only changed details', () => {
    const b = session('2026-10-20', '16:00', '17:00', { series_id: 'x', notes: 'Own plan', location: 'Library' });
    const same = checkSessionForm(state({ notes: 'Own plan' }), { creating: false }).values;
    expect(followingChange({ values: same, session: b })).toBeNull();
    const moved = checkSessionForm(state({ date: '2026-10-22', start: '16:30', end: '18:00', subject: 'Geometry', notes: 'Own plan' }), { creating: false }).values;
    expect(followingChange({ values: moved, session: b })).toEqual({
      p_session: b.id, p_shift: 2, p_start_delta: 30, p_end_delta: 60, p_fields: { subject: 'Geometry' },
    });
    const cleared = checkSessionForm(state({ location: '', notes: 'Own plan' }), { creating: false }).values;
    expect(followingChange({ values: cleared, session: { ...b, location: null } })).toBeNull();
    expect(followingChange({ values: cleared, session: { ...b, location: 'Home' } }).p_fields).toEqual({ location: null });
  });

  test('the Repeat select names the weekday', () => {
    expect(repeatChoices('2026-10-20')).toEqual([
      { value: 'none', label: 'Does not repeat' }, { value: 'weekly', label: 'Weekly on Tuesday' },
    ]);
    expect(repeatChoices('')[1].label).toBe('Weekly');
    expect(weekdayName('2026-10-22')).toBe('Thursday');
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
    expect(scheduleLabel(false)).toBe('Schedule session');
    expect(scheduleLabel(true)).toBe('Schedule weekly sessions');
    expect(sessionsToast(1, 'cancelled')).toBe('Session cancelled');
    expect(sessionsToast(4, 'cancelled')).toBe('4 sessions cancelled');
    expect(sessionsToast(1, 'deleted')).toBe('Session deleted');
  });

  test('repeat summary says how it ends', () => {
    expect(repeatSummary(state())).toBe('Every Tuesday, with no end date');
    expect(repeatSummary(state({ ends: 'after', count: '8' }))).toBe('8 weekly sessions, the last on Tue, Dec 8');
    expect(repeatSummary(state({ ends: 'after', count: '2' }))).toBe('2 weekly sessions, the last on Tue, Oct 27');
    expect(repeatSummary(state({ ends: 'on', until: '2026-12-03' }))).toBe('Every Tuesday through Thu, Dec 3, 7 sessions');
    expect(repeatSummary(state({ ends: 'after', count: '1' }))).toBe('');
    expect(repeatSummary(state({ ends: 'on', until: '' }))).toBe('');
    expect(repeatSummary(state({ date: '' }))).toBe('');
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
    // a rule with no end says so instead of counting what is made so far
    expect(seriesLeftText([a, b, c, d], a, { until: null, last_date: '2027-10-12' })).toBe('Repeats every Tuesday, with no end date');
    expect(seriesLeftText([a, b, c, d], a, { until: '2028-01-04', last_date: '2027-10-12' })).toBe('Repeats every Tuesday through Tue, Jan 4, 2028');
    // all made: count as before
    expect(seriesLeftText([a, b, c, d], a, { until: '2026-11-03', last_date: '2026-11-03' })).toBe('Repeats weekly, 2 more sessions');
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
    const { values } = checkSessionForm(state({ date: '2026-10-20', repeat: true, ends: 'after', count: '8' }));
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

describe('clash wording for a long repeat', () => {
  const candidate = { studentId: 's1', tutorId: 't1', tutorNames: names, studentNames, viewerInZone: true };
  const clashing = [session('2026-10-27', '16:00', '17:00', { student_id: 's2' })];

  test('a repeat that never ends, or ends past six months, is checked in part', () => {
    expect(clashCheckIsPartial(checkSessionForm(state({ repeat: true })).values)).toBe(true);
    expect(clashCheckIsPartial(checkSessionForm(state({ repeat: true, ends: 'after', count: '40' })).values)).toBe(true);
    expect(clashCheckIsPartial(checkSessionForm(state({ repeat: true, ends: 'after', count: '26' })).values)).toBe(false);
    expect(clashCheckIsPartial(checkSessionForm(state({ repeat: true, ends: 'on', until: '2026-12-01' })).values)).toBe(false);
    expect(clashCheckIsPartial(checkSessionForm(state()).values)).toBe(false);
  });

  test('speaks of the next six months instead of a count', () => {
    const planned = plannedTimes(checkSessionForm(state({ repeat: true })).values);
    expect(clashReport({ ...candidate, planned, list: clashing, partial: true }).title).toBe('1 date in the next 6 months clashes');
    const two = [...clashing, session('2026-11-03', '16:00', '17:00', { student_id: 's2' })];
    expect(clashReport({ ...candidate, planned, list: two, partial: true }).title).toBe('2 dates in the next 6 months clash');
    expect(clashReport({ ...candidate, planned, list: two }).title).toBe('2 of 26 dates clash');
  });
});


// The admin's "Free trial lesson" box: the family pays 0 percent, the tutor is paid
describe('free trial', () => {
  test('ticking marks the lesson a trial; nothing to write when it already is', () => {
    expect(trialChange(null, true)).toEqual({ charge_pct: 0, reason: 'trial' });
    expect(trialChange({ charge_pct: 50, reason: 'other' }, true)).toEqual({ charge_pct: 0, reason: 'trial' });
    expect(trialChange({ charge_pct: 0, reason: 'trial' }, true)).toBeNull();
  });

  test('unticking clears only a trial, never another exception', () => {
    expect(trialChange({ charge_pct: 0, reason: 'trial' }, false)).toEqual({ charge_pct: null, reason: null });
    expect(trialChange({ charge_pct: 0, reason: 'no_show_forgiven' }, false)).toBeNull();
    expect(trialChange(null, false)).toBeNull();
  });

  test('the words: no dashes, and they say the tutor is still paid', () => {
    expect(TRIAL_LABEL).toBe('Free trial lesson');
    expect(TRIAL_HINT).toMatch(/tutor is still paid/);
    expect(`${TRIAL_LABEL} ${TRIAL_HINT}`).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('the form offers the trial to the admin only, for one lesson', () => {
  const src = readFileSync(new URL('../../portal/js/session-form.js', import.meta.url), 'utf8');
  test('only the admin gets the box, and it hides for a weekly series', () => {
    expect(src).toMatch(/if \(isAdmin\) \{\n\s+trialBox = h\('input'/);
    expect(src).toMatch(/trialField\.hidden = repeatSelect\?\.value === 'weekly'/);
  });
  test('a new lesson is marked after it is saved; an edit writes the trial first', () => {
    expect(src).toMatch(/writeSessionBilling\(id, trialChange\(null, true\)\)/);
    expect(src).toMatch(/if \(editing && !\(await saveTrial\(\)\)\) return;/);
  });
});
