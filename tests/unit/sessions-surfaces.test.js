import { describe, test, expect, vi } from 'vitest';
import {
  changeNote, changeNotes, canJoin, placeText, whenText, sessionRowLabel, tutorEntries, tutorText, tutorsTitle,
  linkSubject, normalizeSubject, needsNotesCount, todayPlan, todayPill, nextLine, todayRowLabel,
  nextSessionOf, nextSessionParts, clockLabel, SUBJECT_MAX, NOTES_WINDOW_DAYS, CATCH_UP_ROWS,
  sessionGaps, gapsText, catchUpSessions, catchUpWindow, showAllLabel, sessionCount, attendanceSaved, attendanceErrorText, quickLabel,
  notesDrawerId, notesDrawerSession, notesBlockedText,
  normalizeScope, scopeTutorId, getTodayScope, setTodayScope, SCOPE_LABELS, QUICK_ATTENDANCE,
} from '../../portal/js/schedule-summary.js';
import { zonedIso } from '../../portal/js/dates.js';

// The Students view imports the store chain, which builds a Supabase client
vi.mock('../../portal/js/supabase.js', () => ({ sb: {} }));
const { studentSummaries } = await import('../../portal/js/views/students.js');

// Wednesday, October 14, 2026 at 12:00 pm Pacific
const NOW = new Date('2026-10-14T19:00:00Z');
const TODAY = '2026-10-14';
const MONDAY = '2026-10-12';
const at = (key, time) => zonedIso(key, time);
const MIN = 60_000;
const inMinutes = (n) => new Date(NOW.getTime() + n * MIN).toISOString();

let nextId = 1;
const session = (key, start, end, extra = {}) => ({
  id: nextId++, student_id: 's1', tutor_id: 't1', series_id: null, subject: 'Algebra',
  starts_at: at(key, start), ends_at: at(key, end), location: null, meeting_url: null, notes: null,
  status: 'scheduled', attendance: null, recap: null, moved_from: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...extra,
});
const inZone = { viewerInZone: true };

describe('changeNote', () => {
  test('a move names the old day and the new day and time', () => {
    const s = session('2026-10-16', '16:30', '17:30', { moved_from: at('2026-10-15', '16:00') });
    expect(changeNote(s, MONDAY, inZone)).toBe('Thursday’s Algebra moved to Friday at 4:30 pm');
  });

  test('a cancellation names the day', () => {
    const s = session('2026-10-17', '10:00', '11:30', { subject: 'SAT Reading', status: 'cancelled' });
    expect(changeNote(s, TODAY, inZone)).toBe('Saturday’s SAT Reading is cancelled');
  });

  test('today and tomorrow read as words', () => {
    const moved = session('2026-10-15', '17:00', '18:00', { moved_from: at('2026-10-14', '16:00') });
    expect(changeNote(moved, TODAY, inZone)).toBe('Today’s Algebra moved to tomorrow at 5:00 pm');
    const gone = session('2026-10-15', '16:00', '17:00', { status: 'cancelled' });
    expect(changeNote(gone, TODAY, inZone)).toBe('Tomorrow’s Algebra is cancelled');
  });

  test('a move within the same day gives only the new time', () => {
    const s = session('2026-10-15', '17:00', '18:00', { moved_from: at('2026-10-15', '16:00') });
    expect(changeNote(s, TODAY, inZone)).toBe('Tomorrow’s Algebra moved to 5:00 pm');
  });

  test('days a week or more away use dates, not weekday names', () => {
    const moved = session('2026-10-29', '16:00', '17:00', { moved_from: at('2026-10-22', '16:00') });
    expect(changeNote(moved, TODAY, inZone)).toBe('Algebra on Thu, Oct 22 moved to Thu, Oct 29 at 4:00 pm');
    const gone = session('2026-10-24', '10:00', '11:00', { subject: 'SAT Reading', status: 'cancelled' });
    expect(changeNote(gone, TODAY, inZone)).toBe('SAT Reading on Sat, Oct 24 is cancelled');
  });

  test('a blank subject reads as a tutoring session', () => {
    const gone = session('2026-10-16', '16:00', '17:00', { subject: null, status: 'cancelled' });
    expect(changeNote(gone, TODAY, inZone)).toBe('Friday’s tutoring session is cancelled');
    const far = session('2026-10-30', '16:00', '17:00', { subject: ' ', status: 'cancelled' });
    expect(changeNote(far, TODAY, inZone)).toBe('Tutoring session on Fri, Oct 30 is cancelled');
  });

  test('the time says PT when the viewer is in another zone', () => {
    const s = session('2026-10-16', '16:30', '17:30', { moved_from: at('2026-10-15', '16:00') });
    expect(changeNote(s, MONDAY, { viewerInZone: false })).toBe('Thursday’s Algebra moved to Friday at 4:30 pm PT');
  });

  test('a session that neither moved nor was cancelled has no note', () => {
    expect(changeNote(session('2026-10-16', '16:00', '17:00'), TODAY, inZone)).toBeNull();
    expect(changeNote(null, TODAY)).toBeNull();
  });

  test('cancelled wins over moved', () => {
    const s = session('2026-10-16', '16:30', '17:30', { moved_from: at('2026-10-15', '16:00'), status: 'cancelled' });
    expect(changeNote(s, TODAY, inZone)).toBe('Friday’s Algebra is cancelled');
  });
});

describe('changeNotes', () => {
  const moved = session('2026-10-16', '16:30', '17:30', {
    moved_from: at('2026-10-15', '16:00'), changed_at: '2026-10-12T20:00:00Z',
  });
  const gone = session('2026-10-17', '10:00', '11:00', {
    subject: 'SAT Reading', status: 'cancelled', changed_at: '2026-10-13T20:00:00Z',
  });
  const quiet = session('2026-10-15', '16:00', '17:00');
  const all = [gone, quiet, moved];

  test('a first visit counts the last 7 days, soonest session first', () => {
    const notes = changeNotes(all, null, NOW, inZone);
    expect(notes.map((n) => [n.id, n.kind])).toEqual([[moved.id, 'moved'], [gone.id, 'cancelled']]);
    expect(notes[0].text).toBe('Tomorrow’s Algebra moved to Friday at 4:30 pm');
  });

  test('a first visit ignores changes older than 7 days', () => {
    const old = session('2026-10-16', '16:30', '17:30', {
      moved_from: at('2026-10-15', '16:00'), changed_at: '2026-10-01T20:00:00Z',
    });
    expect(changeNotes([old], null, NOW, inZone)).toEqual([]);
  });

  test('only changes after the last look show', () => {
    const notes = changeNotes(all, '2026-10-13T00:00:00Z', NOW, inZone);
    expect(notes.map((n) => n.id)).toEqual([gone.id]);
    expect(changeNotes(all, '2026-10-14T00:00:00Z', NOW, inZone)).toEqual([]);
  });

  test('nothing shows when storage is unavailable', () => {
    expect(changeNotes(all, undefined, NOW, inZone)).toEqual([]);
  });

  test('a session that already ended is left out', () => {
    const past = session('2026-10-13', '16:00', '17:00', { status: 'cancelled', changed_at: '2026-10-12T00:00:00Z' });
    expect(changeNotes([past], null, NOW, inZone)).toEqual([]);
  });
});

describe('canJoin and placeText', () => {
  const url = 'https://meet.example/abc';
  const online = (startMin, endMin, extra = {}) => ({
    ...session(TODAY, '12:00', '13:00', { meeting_url: url, ...extra }),
    starts_at: inMinutes(startMin),
    ends_at: inMinutes(endMin),
  });

  test('shows from 15 minutes before the start until the end', () => {
    expect(canJoin(online(20, 80), NOW)).toBe(false);
    expect(canJoin(online(15, 75), NOW)).toBe(true);
    expect(canJoin(online(5, 65), NOW)).toBe(true);
    expect(canJoin(online(-10, 50), NOW)).toBe(true);
    expect(canJoin(online(-60, 0), NOW)).toBe(false);
  });

  test('needs a link and a session that was not cancelled', () => {
    expect(canJoin(online(5, 65, { meeting_url: null }), NOW)).toBe(false);
    expect(canJoin(online(5, 65, { meeting_url: '  ' }), NOW)).toBe(false);
    expect(canJoin(online(5, 65, { status: 'cancelled' }), NOW)).toBe(false);
    expect(canJoin(null, NOW)).toBe(false);
  });

  test('place is the location, "Online" for a link only, or nothing', () => {
    expect(placeText({ location: ' Room 3 ', meeting_url: url })).toBe('Room 3');
    expect(placeText({ location: null, meeting_url: url })).toBe('Online');
    expect(placeText({ location: '', meeting_url: null })).toBe('');
    expect(placeText(null)).toBe('');
  });
});

describe('row words', () => {
  test('when: Today, Tomorrow, then the weekday', () => {
    expect(whenText(session('2026-10-14', '16:00', '17:00'), TODAY, inZone)).toBe('Today, 4:00 to 5:00 pm');
    expect(whenText(session('2026-10-15', '16:00', '17:30'), TODAY, inZone)).toBe('Tomorrow, 4:00 to 5:30 pm');
    expect(whenText(session('2026-10-20', '10:00', '11:30'), TODAY, inZone)).toBe('Tue, 10:00 to 11:30 am');
    expect(whenText(session('2026-10-20', '10:00', '11:30'), TODAY, { viewerInZone: false })).toBe('Tue, 10:00 to 11:30 am PT');
  });

  test('the spoken label has the date, time, state and place', () => {
    const s = session('2026-10-16', '16:30', '17:30', { moved_from: at('2026-10-15', '16:00'), location: 'Room 3' });
    expect(sessionRowLabel(s, { who: 'Daniel Ortiz', now: NOW, ...inZone }))
      .toBe('Algebra with Daniel Ortiz, Friday, October 16, 4:30 to 5:30 pm, moved, Room 3');
    expect(sessionRowLabel(session('2026-10-16', '16:00', '17:00'), { now: NOW, ...inZone }))
      .toBe('Algebra, Friday, October 16, 4:00 to 5:00 pm');
  });

  test('a session in another year names the year', () => {
    expect(sessionRowLabel(session('2027-01-05', '16:00', '17:00'), { now: NOW, ...inZone }))
      .toBe('Algebra, Tuesday, January 5, 2027, 4:00 to 5:00 pm');
  });

  test('clock label adds PT only outside the zone', () => {
    const iso = at('2026-10-15', '16:00');
    expect(clockLabel(iso, inZone)).toBe('4:00 pm');
    expect(clockLabel(iso, { viewerInZone: false })).toBe('4:00 pm PT');
  });
});

describe('tutors', () => {
  const names = new Map([['t1', 'Daniel Ortiz'], ['t2', 'Priya Shah']]);

  test('entries come back by name with the subject and its colour', () => {
    const rows = [
      { tutor_id: 't2', student_id: 's1', subject: ' SAT Reading ' },
      { tutor_id: 't1', student_id: 's1', subject: 'Algebra' },
    ];
    const list = tutorEntries(rows, names);
    expect(list.map((t) => [t.name, t.subject])).toEqual([['Daniel Ortiz', 'Algebra'], ['Priya Shah', 'SAT Reading']]);
    expect(list[0].tone).toMatch(/^subj-\d$/);
  });

  test('a missing subject has no colour and a missing name says Tutor', () => {
    const [one] = tutorEntries([{ tutor_id: 't9', subject: null }], names);
    expect(one).toMatchObject({ name: 'Tutor', subject: null, tone: 'subj-none' });
  });

  test('the rpc rows bring their own name', () => {
    const [one] = tutorEntries([{ tutor_id: 't1', full_name: ' Daniel Ortiz ', subject: 'Math' }]);
    expect(one.name).toBe('Daniel Ortiz');
  });

  test('chip text and titles', () => {
    expect(tutorText({ name: 'Daniel Ortiz', subject: 'Algebra' })).toBe('Daniel Ortiz, Algebra');
    expect(tutorText({ name: 'Daniel Ortiz', subject: null })).toBe('Daniel Ortiz');
    expect(tutorsTitle('Maya')).toBe('Maya’s tutors');
    expect(tutorsTitle('')).toBe('Tutors');
  });

  test('finds one tutor link subject', () => {
    const links = [
      { tutor_id: 't1', student_id: 's1', subject: 'Algebra' },
      { tutor_id: 't1', student_id: 's2', subject: null },
    ];
    expect(linkSubject(links, 't1', 's1')).toBe('Algebra');
    expect(linkSubject(links, 't1', 's2')).toBeNull();
    expect(linkSubject(links, 't2', 's1')).toBeNull();
  });

  test('subject input: trimmed, blank clears, at most 60 characters', () => {
    expect(normalizeSubject('  SAT   Reading ')).toEqual({ ok: true, subject: 'SAT Reading', error: null });
    expect(normalizeSubject('   ')).toEqual({ ok: true, subject: null, error: null });
    expect(normalizeSubject(null).subject).toBeNull();
    expect(normalizeSubject('a'.repeat(SUBJECT_MAX)).ok).toBe(true);
    const long = normalizeSubject('a'.repeat(SUBJECT_MAX + 1));
    expect(long.ok).toBe(false);
    expect(long.error).toBe('Use at most 60 characters.');
  });
});

describe('Today', () => {
  const mine = {
    done: session(TODAY, '09:00', '10:00', { id: 101, student_id: 's1' }),
    live: session(TODAY, '11:30', '12:30', { id: 102, student_id: 's2' }),
    soon: session(TODAY, '16:00', '17:00', { id: 103, student_id: 's1' }),
    late: session(TODAY, '18:00', '19:00', { id: 104, student_id: 's3' }),
    cancelled: session(TODAY, '15:00', '16:00', { id: 105, status: 'cancelled' }),
  };
  const other = session(TODAY, '17:30', '18:30', { id: 106, tutor_id: 't2' });
  const tomorrow = session('2026-10-15', '16:00', '17:00', { id: 107 });
  const list = [...Object.values(mine), other, tomorrow];

  test('a tutor sees only their own sessions today, in time order', () => {
    const plan = todayPlan(list, NOW, { tutorId: 't1' });
    expect(plan.today.map((s) => s.id)).toEqual([101, 102, 105, 103, 104]);
  });

  test('an admin sees everyone', () => {
    const plan = todayPlan(list, NOW);
    expect(plan.today.map((s) => s.id)).toEqual([101, 102, 105, 103, 106, 104]);
  });

  test('the live one is marked and the next to start is the first not yet started', () => {
    const plan = todayPlan(list, NOW, { tutorId: 't1' });
    expect([...plan.liveIds]).toEqual([102]);
    expect(plan.upNextId).toBe(103);   // the cancelled 3:00 pm is never next
    expect(plan.later).toBeNull();
  });

  test('with nothing left today, the next upcoming session on a later day is offered', () => {
    const plan = todayPlan([mine.done, tomorrow], NOW, { tutorId: 't1' });
    expect(plan.upNextId).toBeNull();
    expect(plan.later.id).toBe(107);
  });

  test('no sessions today still offers the next one', () => {
    const plan = todayPlan([tomorrow], NOW, { tutorId: 't1' });
    expect(plan.today).toEqual([]);
    expect(plan.later.id).toBe(107);
    expect(todayPlan([], NOW).later).toBeNull();
  });

  test('the pill', () => {
    expect(todayPill(mine.live, NOW)).toEqual({ key: 'now', label: 'Now', tone: 'accent' });
    expect(todayPill(mine.done, NOW)).toEqual({ key: 'notes', label: 'Needs notes', tone: 'warning' });
    expect(todayPill({ ...mine.done, attendance: 'present' }, NOW)).toMatchObject({ key: 'attended', label: 'Attended' });
    expect(todayPill(mine.soon, NOW, { upNext: true })).toEqual({ key: 'next', label: 'Up next', tone: 'info' });
    expect(todayPill(mine.late, NOW)).toMatchObject({ key: 'scheduled', label: 'Scheduled' });
    expect(todayPill(mine.cancelled, NOW, { upNext: true })).toMatchObject({ key: 'cancelled' });
    const moved = { ...mine.late, moved_from: at('2026-10-13', '18:00') };
    expect(todayPill(moved, NOW, { upNext: true })).toMatchObject({ key: 'moved', label: 'Moved' });
  });

  test('the next-session line for a tutor and for an admin', () => {
    const s = session('2026-10-20', '16:00', '17:00');
    expect(nextLine(s, { student: 'Leo Park', today: TODAY, ...inZone })).toBe('Next: Tue, Oct 20 at 4:00 pm with Leo Park');
    expect(nextLine(s, { student: 'Leo Park', tutor: 'Daniel Ortiz', today: TODAY, admin: true, ...inZone }))
      .toBe('Next: Tue, Oct 20 at 4:00 pm, Daniel Ortiz with Leo Park');
    expect(nextLine(s, { student: 'Leo Park', today: TODAY, admin: true, ...inZone })).toBe('Next: Tue, Oct 20 at 4:00 pm with Leo Park');
  });

  test('the spoken label of a row', () => {
    const s = { ...mine.live, location: 'Room 3' };
    expect(todayRowLabel(s, { student: 'Leo Park', tutor: 'Daniel Ortiz', now: NOW, ...inZone }))
      .toBe('11:30 am to 12:30 pm, Leo Park, Algebra with Daniel Ortiz, Room 3, now');
    expect(todayRowLabel(mine.done, { student: 'Maya Lin', now: NOW, ...inZone }))
      .toBe('9:00 to 10:00 am, Maya Lin, Algebra, needs notes');
  });
});

describe('Needs notes', () => {
  const ended = (key, extra = {}) => session(key, '16:00', '17:00', extra);
  const day = (n) => {
    // n days before TODAY as a day key (all in October 2026 or late September)
    const d = new Date(Date.UTC(2026, 9, 14 - n));
    return d.toISOString().slice(0, 10);
  };

  test('looks back 30 days', () => {
    expect(NOTES_WINDOW_DAYS).toBe(30);
    const list = [
      ended(day(1)),                    // yesterday
      ended(day(8)),                    // a week ago: counts now
      ended(day(29)),                   // counts
      ended(day(31)),                   // too old
    ];
    expect(needsNotesCount(list, NOW)).toBe(3);
  });

  test('counts a session with attendance but no recap, and one with a recap but no attendance', () => {
    const list = [
      ended('2026-10-13', { attendance: 'present' }),                         // notes missing
      ended('2026-10-12', { attendance: 'present', recap: 'Fractions' }),     // done
      ended('2026-10-12', { recap: 'Fractions' }),                            // attendance missing
      ended('2026-10-11', { attendance: 'late', recap: '   ' }),              // blank recap
    ];
    expect(catchUpSessions(list, NOW).map((s) => s.id)).toEqual([list[0].id, list[2].id, list[3].id]);
  });

  test('leaves out cancelled sessions and ones that have not ended', () => {
    const list = [
      ended('2026-10-12', { status: 'cancelled' }),
      session(TODAY, '16:00', '17:00'),   // still to come
      session(TODAY, '11:30', '12:30'),   // happening now
      ended('2026-10-13'),
    ];
    expect(needsNotesCount(list, NOW)).toBe(1);
  });

  test('a tutor counts only their own', () => {
    const list = [ended('2026-10-13'), ended('2026-10-12', { tutor_id: 't2' })];
    expect(needsNotesCount(list, NOW, { tutorId: 't1' })).toBe(1);
    expect(needsNotesCount(list, NOW)).toBe(2);
  });

  test('a student the tutor no longer teaches is left out', () => {
    const list = [ended('2026-10-13', { student_id: 's1' }), ended('2026-10-12', { student_id: 's2' })];
    const links = [{ tutor_id: 't1', student_id: 's1' }];
    expect(catchUpSessions(list, NOW, { tutorId: 't1', links }).map((s) => s.student_id)).toEqual(['s1']);
  });

  test('newest first', () => {
    const a = ended('2026-10-09', { id: 801 });
    const b = ended('2026-10-13', { id: 802 });
    const c = ended('2026-10-13', { id: 803 });   // same time as b: higher id first
    const d = session('2026-10-13', '10:00', '11:00', { id: 804 });
    expect(catchUpSessions([a, b, c, d], NOW).map((s) => s.id)).toEqual([803, 802, 804, 801]);
  });

  test('what an ended session still lacks', () => {
    const done = ended('2026-10-13');
    expect(sessionGaps(done, NOW)).toEqual({ attendance: true, notes: true });
    expect(sessionGaps({ ...done, attendance: 'present' }, NOW)).toEqual({ attendance: false, notes: true });
    expect(sessionGaps({ ...done, recap: 'Fractions' }, NOW)).toEqual({ attendance: true, notes: false });
    expect(sessionGaps({ ...done, attendance: 'absent', recap: 'Missed' }, NOW)).toEqual({ attendance: false, notes: false });
    expect(sessionGaps({ ...done, status: 'cancelled' }, NOW)).toEqual({ attendance: false, notes: false });
    expect(sessionGaps(session(TODAY, '16:00', '17:00'), NOW)).toEqual({ attendance: false, notes: false });
    expect(sessionGaps(null, NOW)).toEqual({ attendance: false, notes: false });
  });

  test('what is missing, in words', () => {
    expect(gapsText({ attendance: true, notes: true })).toBe('Needs attendance and notes');
    expect(gapsText({ attendance: true, notes: false })).toBe('Needs attendance');
    expect(gapsText({ attendance: false, notes: true })).toBe('Needs notes');
    expect(gapsText({ attendance: false, notes: false })).toBe('');
  });

  test('the list shows 8 until expanded', () => {
    expect(CATCH_UP_ROWS).toBe(8);
    const twelve = Array.from({ length: 12 }, (_, i) => i);
    expect(catchUpWindow(twelve)).toEqual({ shown: twelve.slice(0, 8), hidden: 4 });
    expect(catchUpWindow(twelve, { expanded: true })).toEqual({ shown: twelve, hidden: 0 });
    expect(catchUpWindow(twelve.slice(0, 8))).toEqual({ shown: twelve.slice(0, 8), hidden: 0 });
    expect(catchUpWindow(null)).toEqual({ shown: [], hidden: 0 });
    expect(showAllLabel(12)).toBe('Show all 12');
    expect(sessionCount(1)).toBe('1 session');
    expect(sessionCount(3)).toBe('3 sessions');
  });

  test('the toast and the button names', () => {
    expect(QUICK_ATTENDANCE).toEqual(['present', 'late', 'absent']);
    expect(attendanceSaved('Leo Park', 'present')).toBe('Marked Leo Park present');
    expect(attendanceSaved('Leo Park', 'absent')).toBe('Marked Leo Park absent');
    expect(attendanceSaved('', 'late')).toBe('Marked the student late');
    expect(attendanceSaved('Leo Park', null)).toBe('Attendance cleared for Leo Park');
    const s = session('2026-10-12', '17:30', '18:30', { subject: 'Math' });
    expect(quickLabel('present', s, { student: 'Leo Park', today: TODAY })).toBe('Present, Leo Park, Math, Mon, Oct 12');
    expect(quickLabel('notes', s, { student: 'Leo Park', today: TODAY })).toBe('Write notes, Leo Park, Math, Mon, Oct 12');
    expect(quickLabel('late', { ...s, subject: null }, { today: TODAY })).toBe('Late, Tutoring session, Mon, Oct 12');
  });

  test('why an attendance save failed', () => {
    expect(attendanceErrorText({ code: 'VP002', message: 'This month is already paid' })).toBe('This month is already paid.');
    expect(attendanceErrorText({ code: 'VP002', message: 'Already paid.' })).toBe('Already paid.');
    expect(attendanceErrorText({ code: '42501' })).toBe('You can only change attendance on sessions you tutor.');
    expect(attendanceErrorText({ message: 'Failed to fetch' })).toBe('Attendance didn’t save. Check your connection and try again.');
    expect(attendanceErrorText(null)).toBe('Attendance didn’t save. Check your connection and try again.');
  });

  test('the notes drawer id round-trips and rejects other drawer ids', () => {
    expect(notesDrawerId(12)).toBe('notes-s12');
    expect(notesDrawerSession('notes-s12')).toBe('12');
    expect(notesDrawerSession(notesDrawerId(907))).toBe('907');
    for (const other of ['s12', 'new', 'new-session', '12', 'notes-s', 'notes-sx', 'notes-s12x', 'xnotes-s12', null, undefined]) {
      expect(notesDrawerSession(other)).toBeNull();
    }
  });

  test('when the notes form cannot be used', () => {
    const tutor = { id: 't1', role: 'tutor' };
    const admin = { id: 'a1', role: 'admin' };
    const done = ended('2026-10-13');
    const links = [{ tutor_id: 't1', student_id: 's1' }];
    expect(notesBlockedText(done, tutor, { links, now: NOW })).toBeNull();
    expect(notesBlockedText(done, admin, { now: NOW })).toBeNull();
    // happening now is fine: the form is open from the start
    expect(notesBlockedText(session(TODAY, '11:30', '12:30'), tutor, { now: NOW })).toBeNull();
    expect(notesBlockedText(session('2026-10-20', '16:00', '17:00'), tutor, { now: NOW })).toMatch(/hasn’t started/);
    expect(notesBlockedText({ ...done, status: 'cancelled' }, tutor, { now: NOW })).toMatch(/cancelled/);
    expect(notesBlockedText({ ...done, tutor_id: 't2' }, tutor, { now: NOW })).toMatch(/Only the session’s tutor/);
    expect(notesBlockedText(done, tutor, { links: [], now: NOW })).toMatch(/Only the session’s tutor/);
    expect(notesBlockedText(null, tutor, { now: NOW })).toMatch(/isn’t available/);
  });

  test('Today plan: today lists its own, catch up lists the earlier ones', () => {
    const doneToday = session(TODAY, '09:00', '10:00', { id: 701 });
    const earlier = ended('2026-10-13', { id: 702 });
    const other = ended('2026-10-12', { id: 703, tutor_id: 't2' });
    const plan = todayPlan([doneToday, earlier, other], NOW, { tutorId: 't1' });
    expect(plan.today.map((s) => s.id)).toEqual([701]);
    expect(plan.catchUp.map((s) => s.id)).toEqual([702]);
    expect(plan.needsNotes).toBe(2);
    const everyone = todayPlan([doneToday, earlier, other], NOW);
    expect(everyone.catchUp.map((s) => s.id)).toEqual([702, 703]);
    expect(everyone.needsNotes).toBe(3);
  });

  test('Today plan: sessions with a student the tutor no longer teaches do not count', () => {
    const gone = ended('2026-10-13', { id: 704, student_id: 's9' });
    const kept = ended('2026-10-12', { id: 705 });
    const plan = todayPlan([gone, kept], NOW, { tutorId: 't1', links: [{ tutor_id: 't1', student_id: 's1' }] });
    expect(plan.catchUp.map((s) => s.id)).toEqual([705]);
  });
});

describe('Today: Mine and Everyone', () => {
  const memory = () => {
    const data = new Map();
    return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, data };
  };

  test('only "all" means Everyone', () => {
    expect(normalizeScope('all')).toBe('all');
    expect(normalizeScope('mine')).toBe('mine');
    expect(normalizeScope(null)).toBe('mine');
    expect(normalizeScope('everyone')).toBe('mine');
    expect(SCOPE_LABELS).toEqual({ mine: 'Mine', all: 'Everyone' });
  });

  test('a tutor always sees their own; an admin chooses', () => {
    expect(scopeTutorId('tutor', 'all', 't1')).toBe('t1');
    expect(scopeTutorId('tutor', 'mine', 't1')).toBe('t1');
    expect(scopeTutorId('admin', 'mine', 'a1')).toBe('a1');
    expect(scopeTutorId('admin', undefined, 'a1')).toBe('a1');
    expect(scopeTutorId('admin', 'all', 'a1')).toBeNull();
  });

  test('the choice is remembered per person', () => {
    const storage = memory();
    expect(getTodayScope('a1', storage)).toBe('mine');
    expect(setTodayScope('a1', 'all', storage)).toBe(true);
    expect(getTodayScope('a1', storage)).toBe('all');
    expect(getTodayScope('a2', storage)).toBe('mine');
    setTodayScope('a1', 'mine', storage);
    expect(getTodayScope('a1', storage)).toBe('mine');
  });

  test('storage that is missing or throws never breaks it', () => {
    const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    expect(getTodayScope('a1', broken)).toBe('mine');
    expect(setTodayScope('a1', 'all', broken)).toBe(false);
    expect(getTodayScope('a1', null)).toBe('mine');
    expect(setTodayScope('a1', 'all', null)).toBe(false);
  });
});

describe('next session', () => {
  test('the first upcoming session in a list', () => {
    const list = [
      session('2026-10-13', '16:00', '17:00'),
      session('2026-10-16', '16:00', '17:00', { id: 901 }),
      session('2026-10-15', '16:00', '17:00', { id: 900, status: 'cancelled' }),
      session('2026-10-20', '16:00', '17:00'),
    ];
    expect(nextSessionOf(list, NOW).id).toBe(901);
    expect(nextSessionOf([], NOW)).toBeNull();
  });

  test('day and time, with PT outside the zone', () => {
    const s = session('2026-10-20', '16:00', '17:00');
    expect(nextSessionParts(s, TODAY, inZone)).toEqual({ day: 'Tue, Oct 20', time: '4:00 pm', text: 'Tue, Oct 20 at 4:00 pm' });
    expect(nextSessionParts(s, TODAY, { viewerInZone: false }).time).toBe('4:00 pm PT');
  });
});

describe('studentSummaries', () => {
  const ws = {
    students: [
      { id: 's1', full_name: 'Maya Lin', email: 'maya@example.com' },
      { id: 's2', full_name: 'Leo Park', email: 'leo@example.com' },
      { id: 's3', full_name: 'Ava Ruiz', email: 'ava@example.com' },
    ],
    tasks: [],
    submissions: [],
    sessions: [
      session('2026-10-13', '16:00', '17:00', { id: 1 }),
      session('2026-10-16', '16:00', '17:00', { id: 2 }),
      session('2026-10-15', '16:00', '17:00', { id: 3, status: 'cancelled' }),
      session('2026-10-19', '16:00', '17:00', { id: 4, student_id: 's2', tutor_id: 't2' }),
    ],
    links: [
      { tutor_id: 't2', student_id: 's1', subject: 'SAT Reading' },
      { tutor_id: 't1', student_id: 's1', subject: 'Algebra' },
      { tutor_id: 't1', student_id: 's2', subject: null },
    ],
  };
  const names = new Map([['t1', 'Daniel Ortiz'], ['t2', 'Priya Shah']]);

  test('each student gets the next upcoming session and the tutors with subjects', () => {
    const [maya, leo, ava] = studentSummaries(ws, NOW, { names });
    expect(maya.nextSession.id).toBe(2);
    expect(maya.tutors.map((t) => tutorText(t))).toEqual(['Daniel Ortiz, Algebra', 'Priya Shah, SAT Reading']);
    expect(leo.nextSession.id).toBe(4);
    expect(leo.tutors.map((t) => tutorText(t))).toEqual(['Daniel Ortiz']);
    expect(ava.nextSession).toBeNull();
    expect(ava.tutors).toEqual([]);
  });

  test('a workspace without sessions or links still summarizes', () => {
    const [only] = studentSummaries({ students: [{ id: 's1', full_name: 'Maya Lin' }] }, NOW);
    expect(only).toMatchObject({ name: 'Maya Lin', nextSession: null, tutors: [], review: 0 });
  });

  test('a no-login person keeps their name but never shows the made-up address', () => {
    const made = 'no-login+0b9f5c3e-2d41-4c7e-9a55-6f0f2d1a7c11@people.varunbaskaran.com';
    const rows = studentSummaries({
      students: [
        { id: 's8', full_name: 'Rosa Diaz', email: made },
        { id: 's9', full_name: null, email: made },
        { id: 's7', full_name: 'Ana Ruiz', email: 'ana@example.com' },
      ],
    }, NOW);
    expect(rows.map((r) => [r.name, r.email])).toEqual([['Rosa Diaz', ''], ['Unknown', ''], ['Ana Ruiz', 'ana@example.com']]);
  });

  test('without names the chips say Tutor', () => {
    const [maya] = studentSummaries(ws, NOW);
    expect(maya.tutors.map((t) => t.name)).toEqual(['Tutor', 'Tutor']);
  });
});
