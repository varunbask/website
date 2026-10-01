import { describe, test, expect } from 'vitest';
import {
  clockText, timeRange, durationMinutes, durationText, sessionTitle, movedNote, sessionState,
  subjectTone, toneClass, subjectLegend, sortSessions, sessionsByDay, upcomingSessions, recentChanges,
  followingInSeries, weekStartKey, weekKeys, weekTitle, dayMinutes, hourRange, layoutDay, overlaps,
  findClashes, timeInput, addMinutesToTime, validateSessionForm, weeklyTimes, retimeRows, sessionAria,
  toIcs, SUBJECT_TONES,
} from '../../portal/js/sessions-model.js';
import { zonedIso, dayKey } from '../../portal/js/dates.js';

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

describe('words', () => {
  test('clock and range in Pacific', () => {
    expect(clockText(at('2026-10-14', '16:00'))).toBe('4:00 pm');
    expect(clockText(at('2026-10-14', '00:05'))).toBe('12:05 am');
    expect(timeRange(session('2026-10-14', '16:00', '17:30'), { viewerInZone: true })).toBe('4:00 to 5:30 pm');
    expect(timeRange(session('2026-10-14', '11:30', '12:30'), { viewerInZone: true })).toBe('11:30 am to 12:30 pm');
    expect(timeRange(session('2026-10-14', '16:00', '17:00'), { viewerInZone: false })).toBe('4:00 to 5:00 pm PT');
  });

  test('durations', () => {
    expect(durationMinutes(session('2026-10-14', '16:00', '17:30'))).toBe(90);
    expect(durationText(45)).toBe('45 minutes');
    expect(durationText(60)).toBe('1 hour');
    expect(durationText(90)).toBe('1 hour 30 minutes');
    expect(durationText(120)).toBe('2 hours');
  });

  test('title falls back for a blank subject', () => {
    expect(sessionTitle({ subject: ' SAT Reading ' })).toBe('SAT Reading');
    expect(sessionTitle({ subject: '' })).toBe('Tutoring session');
    expect(sessionTitle({ subject: null })).toBe('Tutoring session');
  });

  test('moved note names the old day and time', () => {
    const s = session('2026-10-16', '16:00', '17:00', { moved_from: at('2026-10-15', '16:00') });
    expect(movedNote(s, '2026-10-14')).toBe('Moved from Thu, Oct 15 at 4:00 pm');
    expect(movedNote(session('2026-10-16', '16:00', '17:00'))).toBeNull();
  });

  test('spoken label', () => {
    const s = session('2026-10-15', '16:00', '17:00', { moved_from: at('2026-10-14', '16:00') });
    expect(sessionAria(s, { who: 'Daniel Ortiz', now: NOW, viewerInZone: true }))
      .toBe('Algebra with Daniel Ortiz, 4:00 to 5:00 pm, moved');
  });
});

describe('sessionState', () => {
  test('before, during and after', () => {
    expect(sessionState(session('2026-10-15', '16:00', '17:00'), NOW).key).toBe('scheduled');
    expect(sessionState(session('2026-10-14', '11:30', '12:30'), NOW).key).toBe('now');
    expect(sessionState(session('2026-10-13', '16:00', '17:00'), NOW).key).toBe('finished');
    expect(sessionState(session('2026-10-13', '16:00', '17:00', { attendance: 'present' }), NOW).key).toBe('attended');
    expect(sessionState(session('2026-10-13', '16:00', '17:00', { attendance: 'absent' }), NOW)).toMatchObject({ key: 'missed', tone: 'danger' });
    expect(sessionState(session('2026-10-15', '16:00', '17:00', { moved_from: at('2026-10-14', '16:00') }), NOW).key).toBe('moved');
  });

  test('cancelled wins over everything', () => {
    expect(sessionState(session('2026-10-14', '11:30', '12:30', { status: 'cancelled' }), NOW).key).toBe('cancelled');
  });
});

describe('subject colors', () => {
  test('stable, case and space insensitive, in range', () => {
    expect(subjectTone('Algebra')).toBe(subjectTone(' algebra '));
    for (const name of ['Algebra', 'SAT Reading', 'AP Chemistry', 'English', 'Physics', 'Spanish']) {
      const n = subjectTone(name);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(SUBJECT_TONES);
    }
    expect(subjectTone('')).toBe(-1);
    expect(toneClass(null)).toBe('subj-none');
    expect(toneClass('Algebra')).toMatch(/^subj-[0-5]$/);
  });

  test('a palette gives loaded subjects different tones while tones last', async () => {
    const { buildPalette } = await import('../../portal/js/sessions-model.js');
    const seven = ['Math', 'Algebra', 'SAT Reading', 'English', 'Physics', 'Chemistry', 'Spanish'];
    const six = buildPalette(seven.slice(0, 6));
    expect(new Set(six.values()).size).toBe(6);
    expect(buildPalette(['math', ' Math ', 'Algebra']).size).toBe(2);
    // Same input, same answer, whatever the order
    expect([...buildPalette(seven).entries()]).toEqual([...buildPalette([...seven].reverse()).entries()]);
    for (const tone of buildPalette(seven).values()) expect(tone).toBeLessThan(SUBJECT_TONES);
  });

  test('legend lists each subject once', () => {
    const list = [session('2026-10-15', '16:00', '17:00'), session('2026-10-16', '16:00', '17:00', { subject: 'algebra' }),
      session('2026-10-17', '10:00', '11:00', { subject: 'SAT Reading' })];
    expect(subjectLegend(list).map((l) => l.subject)).toEqual(['Algebra', 'SAT Reading']);
  });
});

describe('lists', () => {
  test('sorted and grouped by Pacific day', () => {
    const late = session('2026-10-14', '23:30', '23:59');
    const early = session('2026-10-14', '08:00', '09:00');
    expect(sortSessions([late, early])).toEqual([early, late]);
    // 11:30 pm Pacific is the next day in UTC but stays on the 14th
    expect([...sessionsByDay([late, early]).keys()]).toEqual(['2026-10-14']);
  });

  test('upcoming skips cancelled and finished sessions', () => {
    const past = session('2026-10-13', '16:00', '17:00');
    const live = session('2026-10-14', '11:30', '12:30');
    const next = session('2026-10-15', '16:00', '17:00');
    const off = session('2026-10-16', '16:00', '17:00', { status: 'cancelled' });
    const far = session('2026-11-30', '16:00', '17:00');
    expect(upcomingSessions([far, off, next, live, past], NOW)).toEqual([live, next, far]);
    expect(upcomingSessions([far, next, live], NOW, { limit: 1 })).toEqual([live]);
    expect(upcomingSessions([far, next, live], NOW, { days: 7 })).toEqual([live, next]);
  });

  test('recent changes are moves and cancellations after a time, still ahead', () => {
    const moved = session('2026-10-16', '16:00', '17:00', { moved_from: at('2026-10-15', '16:00'), updated_at: '2026-10-13T00:00:00Z' });
    const cancelled = session('2026-10-17', '16:00', '17:00', { status: 'cancelled', updated_at: '2026-10-10T00:00:00Z' });
    const plain = session('2026-10-18', '16:00', '17:00', { updated_at: '2026-10-13T00:00:00Z' });
    const old = session('2026-10-12', '16:00', '17:00', { status: 'cancelled', updated_at: '2026-10-13T00:00:00Z' });
    expect(recentChanges([moved, cancelled, plain, old], '2026-10-12T00:00:00Z', NOW)).toEqual([moved]);
    expect(recentChanges([moved, cancelled, plain, old], null, NOW)).toEqual([moved, cancelled]);
  });

  test('following in a series', () => {
    const a = session('2026-10-13', '16:00', '17:00', { series_id: 'x' });
    const b = session('2026-10-20', '16:00', '17:00', { series_id: 'x' });
    const c = session('2026-10-27', '16:00', '17:00', { series_id: 'x' });
    const other = session('2026-10-21', '16:00', '17:00', { series_id: 'y' });
    expect(followingInSeries([c, other, a, b], b)).toEqual([b, c]);
    const single = session('2026-10-21', '16:00', '17:00');
    expect(followingInSeries([single], single)).toEqual([single]);
  });
});

describe('week grid', () => {
  test('weeks start on Sunday', () => {
    expect(weekStartKey('2026-10-14')).toBe('2026-10-11');
    expect(weekKeys('2026-10-14')).toEqual(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']);
    expect(weekKeys('2026-10-11')[0]).toBe('2026-10-11');
  });

  test('titles across months and years', () => {
    expect(weekTitle('2026-10-11')).toBe('Oct 11 to 17, 2026');
    expect(weekTitle('2026-09-27')).toBe('Sep 27 to Oct 3, 2026');
    expect(weekTitle('2026-12-27')).toBe('Dec 27, 2026 to Jan 2, 2027');
  });

  test('minutes of the day, past midnight clamps', () => {
    expect(dayMinutes(session('2026-10-14', '16:00', '17:30'))).toEqual({ start: 960, end: 1050 });
    const late = { starts_at: at('2026-10-14', '23:00'), ends_at: at('2026-10-15', '00:30') };
    expect(dayMinutes(late)).toEqual({ start: 1380, end: 1440 });
  });

  test('hour range widens to fit', () => {
    expect(hourRange([])).toEqual({ start: 7, end: 21 });
    expect(hourRange([session('2026-10-14', '06:30', '07:30'), session('2026-10-14', '21:00', '22:15')])).toEqual({ start: 6, end: 23 });
  });

  test('overlapping sessions share columns, separate clusters do not', () => {
    const a = session('2026-10-14', '16:00', '17:00');
    const b = session('2026-10-14', '16:30', '17:30');
    const c = session('2026-10-14', '17:00', '18:00');
    const d = session('2026-10-14', '19:00', '20:00');
    const blocks = layoutDay([d, c, b, a], { startHour: 7, endHour: 21 });
    const byId = new Map(blocks.map((x) => [x.session.id, x]));
    expect(byId.get(a.id)).toMatchObject({ col: 0, cols: 2 });
    expect(byId.get(b.id)).toMatchObject({ col: 1, cols: 2 });
    expect(byId.get(c.id)).toMatchObject({ col: 0, cols: 2 });
    expect(byId.get(d.id)).toMatchObject({ col: 0, cols: 1 });
    expect(byId.get(a.id).top).toBeCloseTo((16 - 7) / 14);
    expect(byId.get(a.id).height).toBeCloseTo(1 / 14);
  });

  test('a very short session gets a minimum height', () => {
    const [block] = layoutDay([session('2026-10-14', '16:00', '16:05')], { startHour: 7, endHour: 21 });
    expect(block.height).toBeCloseTo(20 / (14 * 60));
  });
});

describe('clashes', () => {
  test('overlap is strict at the edges', () => {
    expect(overlaps(session('2026-10-14', '16:00', '17:00'), session('2026-10-14', '17:00', '18:00'))).toBe(false);
    expect(overlaps(session('2026-10-14', '16:00', '17:00'), session('2026-10-14', '16:59', '18:00'))).toBe(true);
  });

  test('same tutor or same student, not cancelled, not itself', () => {
    const mine = session('2026-10-15', '16:00', '17:00');
    const otherStudent = session('2026-10-15', '16:30', '17:30', { student_id: 's2' });
    const otherTutor = session('2026-10-15', '16:30', '17:30', { tutor_id: 't2' });
    const unrelated = session('2026-10-15', '16:30', '17:30', { tutor_id: 't3', student_id: 's3' });
    const cancelled = session('2026-10-15', '16:00', '17:00', { status: 'cancelled' });
    const candidate = { ...mine };
    const found = findClashes(candidate, [mine, otherStudent, otherTutor, unrelated, cancelled]);
    expect(found.map((c) => [c.session.id, c.who])).toEqual([[otherStudent.id, 'tutor'], [otherTutor.id, 'student']]);
    const fresh = { tutor_id: 't1', student_id: 's1', starts_at: mine.starts_at, ends_at: mine.ends_at };
    expect(findClashes(fresh, [mine]).map((c) => c.who)).toEqual(['both']);
  });
});

describe('form', () => {
  test('time helpers', () => {
    expect(timeInput(at('2026-10-14', '16:05'))).toBe('16:05');
    expect(addMinutesToTime('16:30', 60)).toBe('17:30');
    expect(addMinutesToTime('23:30', 60)).toBe('23:59');
  });

  test('valid create with repeats', () => {
    const r = validateSessionForm({ date: '2026-10-15', start: '16:00', end: '17:00', subject: ' Algebra ', repeat: true, weeks: '8', meeting_url: ' https://meet.example.com/x ' });
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ subject: 'Algebra', weeks: 8, repeat: true, meeting_url: 'https://meet.example.com/x', location: null });
  });

  test('errors', () => {
    expect(validateSessionForm({}).errors).toMatchObject({ date: 'Choose a date.', start: 'Enter a start time.', end: 'Enter an end time.' });
    expect(validateSessionForm({ date: '2026-10-15', start: '17:00', end: '16:00' }).errors.end).toBe('End after the start time.');
    expect(validateSessionForm({ date: '2026-10-15', start: '08:00', end: '16:30' }).errors.end).toBe('A session can be at most 8 hours.');
    expect(validateSessionForm({ date: '2026-10-15', start: '16:00', end: '17:00', meeting_url: 'http://x.com' }).errors.meeting_url)
      .toBe('Use a link that starts with https://');
    expect(validateSessionForm({ date: '2026-10-15', start: '16:00', end: '17:00', repeat: true, weeks: '30' }).errors.weeks).toBe('Repeat for 1 to 26 weeks.');
  });

  test('editing ignores repeat', () => {
    const r = validateSessionForm({ date: '2026-10-15', start: '16:00', end: '17:00', repeat: true, weeks: '99' }, { creating: false });
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ repeat: false, weeks: 1 });
  });
});

describe('repeats and series edits', () => {
  test('weekly times keep the wall clock across the DST change', () => {
    const times = weeklyTimes({ date: '2026-10-27', start: '16:00', end: '17:00', weeks: 2 });
    expect(times.map((t) => dayKey(t.starts_at))).toEqual(['2026-10-27', '2026-11-03']);
    expect(times.map((t) => clockText(t.starts_at))).toEqual(['4:00 pm', '4:00 pm']);
    // PDT then PST: the UTC hour moves, the Pacific hour does not
    expect(times[0].starts_at).toBe('2026-10-27T23:00:00.000Z');
    expect(times[1].starts_at).toBe('2026-11-04T00:00:00.000Z');
  });

  test('retiming the rest of a series shifts every row the same', () => {
    const rows = [session('2026-10-20', '16:00', '17:00'), session('2026-10-27', '16:00', '17:00')];
    const out = retimeRows(rows, rows[0], { date: '2026-10-21', start: '17:30', end: '18:30' });
    expect(out.map((r) => [dayKey(r.starts_at), clockText(r.starts_at), clockText(r.ends_at)]))
      .toEqual([['2026-10-21', '5:30 pm', '6:30 pm'], ['2026-10-28', '5:30 pm', '6:30 pm']]);
    expect(out.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });
});

describe('toIcs', () => {
  test('one event per session with escaped text and a cancel status', () => {
    const s = session('2026-10-15', '16:00', '17:00', {
      id: 42, location: 'Library, room 2', notes: 'Bring the quiz; review ch. 6', meeting_url: 'https://meet.example.com/abc',
    });
    const off = session('2026-10-22', '16:00', '17:00', { id: 43, status: 'cancelled' });
    const text = toIcs([off, s], { names: new Map([['t1', 'Daniel Ortiz']]), now: NOW });
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(text).toContain('UID:session-42@varunbaskaran.com');
    expect(text).toContain('DTSTART:20261015T230000Z');
    expect(text).toContain('SUMMARY:Algebra with Daniel Ortiz');
    expect(text).toContain('LOCATION:Library\\, room 2');
    expect(text).toContain('Bring the quiz\\; review ch. 6');
    expect(text).toContain('STATUS:CANCELLED');
    // The earlier session comes first
    expect(text.indexOf('session-42')).toBeLessThan(text.indexOf('session-43'));
    for (const line of text.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75);
  });
});

describe('canEditSession', () => {
  test('admin, or the tutor who owns it', async () => {
    const { canEditSession } = await import('../../portal/js/sessions-model.js');
    const s = { tutor_id: 't1' };
    expect(canEditSession(s, { id: 'a', role: 'admin' })).toBe(true);
    expect(canEditSession(s, { id: 't1', role: 'tutor' })).toBe(true);
    expect(canEditSession(s, { id: 't2', role: 'tutor' })).toBe(false);
    expect(canEditSession(s, { id: 's1', role: 'student' })).toBe(false);
    expect(canEditSession(s, { id: 'p1', role: 'parent' })).toBe(false);
  });
});
