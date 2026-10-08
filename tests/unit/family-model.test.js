import { describe, test, expect } from 'vitest';
import {
  recentSessions, attendanceStatus, recapPreview, tutorFirstName, recentWhen, recentLabel, recentRows,
  showChildrenRow, childHref, childSummary, childLines, RECENT_LIMIT, RECAP_PREVIEW_CHARS,
} from '../../portal/js/family-model.js';
import { deriveItems } from '../../portal/js/buckets.js';
import { tutorToneClass } from '../../portal/js/sessions-model.js';
import { zonedIso } from '../../portal/js/dates.js';

// Wednesday, October 14, 2026 at 12:00 pm Pacific
const NOW = new Date('2026-10-14T19:00:00Z');
const TODAY = '2026-10-14';
const at = (key, time) => zonedIso(key, time);
const inZone = { viewerInZone: true };

let nextId = 1;
const session = (key, start, end, extra = {}) => ({
  id: nextId++, student_id: 's1', tutor_id: 't1', series_id: null, subject: 'Algebra',
  starts_at: at(key, start), ends_at: at(key, end), location: null, meeting_url: null, notes: null,
  status: 'scheduled', attendance: null, recap: null, moved_from: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...extra,
});
const ids = (list) => list.map((s) => s.id);

describe('recentSessions', () => {
  test('returns the last 3 sessions that ended, newest first', () => {
    const a = session('2026-10-01', '16:00', '17:00');
    const b = session('2026-10-05', '16:00', '17:00');
    const c = session('2026-10-08', '16:00', '17:00');
    const d = session('2026-10-12', '16:00', '17:00');
    expect(RECENT_LIMIT).toBe(3);
    expect(ids(recentSessions([a, c, d, b], NOW))).toEqual([d.id, c.id, b.id]);
  });

  test('leaves out cancelled sessions', () => {
    const a = session('2026-10-05', '16:00', '17:00');
    const gone = session('2026-10-12', '16:00', '17:00', { status: 'cancelled' });
    expect(ids(recentSessions([a, gone], NOW))).toEqual([a.id]);
  });

  test('leaves out sessions that have not ended, including one under way', () => {
    const done = session('2026-10-13', '16:00', '17:00');
    const live = session(TODAY, '11:30', '12:30');
    const later = session(TODAY, '16:00', '17:00');
    const next = session('2026-10-20', '16:00', '17:00');
    expect(ids(recentSessions([done, live, later, next], NOW))).toEqual([done.id]);
  });

  test('a session that ends exactly now counts as happened', () => {
    const justEnded = session(TODAY, '11:00', '12:00');
    expect(ids(recentSessions([justEnded], NOW))).toEqual([justEnded.id]);
  });

  test('sessions at the same time list the newer id first', () => {
    const a = session('2026-10-12', '16:00', '17:00');
    const b = session('2026-10-12', '16:00', '17:00');
    expect(ids(recentSessions([a, b], NOW))).toEqual([b.id, a.id]);
  });

  test('keeps sessions with no notes, honours limit, and never mutates the input', () => {
    const list = [session('2026-10-05', '16:00', '17:00'), session('2026-10-12', '16:00', '17:00', { recap: 'Fractions', attendance: 'present' })];
    const copy = [...list];
    expect(recentSessions(list, NOW)).toHaveLength(2);
    expect(recentSessions(list, NOW, { limit: 1 })).toHaveLength(1);
    expect(list).toEqual(copy);
  });

  test('nothing, null or garbage dates give an empty list', () => {
    expect(recentSessions([], NOW)).toEqual([]);
    expect(recentSessions(null, NOW)).toEqual([]);
    expect(recentSessions([{ id: 1, starts_at: 'x', ends_at: 'y' }], NOW)).toEqual([]);
  });
});

describe('attendanceStatus', () => {
  test('maps the three values to a pill', () => {
    expect(attendanceStatus('present')).toEqual({ key: 'present', label: 'Present', tone: 'success', icon: 'check-circle' });
    expect(attendanceStatus('late')).toEqual({ key: 'late', label: 'Late', tone: 'warning', icon: 'clock' });
    expect(attendanceStatus('absent')).toEqual({ key: 'absent', label: 'Absent', tone: 'danger', icon: 'minus-circle' });
  });

  test('null and unknown values give no pill', () => {
    expect(attendanceStatus(null)).toBeNull();
    expect(attendanceStatus(undefined)).toBeNull();
    expect(attendanceStatus('excused')).toBeNull();
  });
});

describe('recapPreview', () => {
  test('collapses line breaks and extra spaces into one line', () => {
    expect(recapPreview('Worked on fractions.\n\nHomework:   page 12.\r\n')).toBe('Worked on fractions. Homework: page 12.');
  });

  test('blank or missing recaps give an empty string', () => {
    expect(recapPreview(null)).toBe('');
    expect(recapPreview(undefined)).toBe('');
    expect(recapPreview('  \n ')).toBe('');
  });

  test('a short recap is left as written', () => {
    expect(recapPreview('Great session!')).toBe('Great session!');
  });

  test('a long recap is cut at a word and ends with an ellipsis', () => {
    const long = 'Maya worked through quadratic equations and checked every answer. '.repeat(10);
    const out = recapPreview(long);
    expect(out.length).toBeLessThanOrEqual(RECAP_PREVIEW_CHARS + 1);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
    expect(long.replace(/\s+/g, ' ').startsWith(out.slice(0, -1))).toBe(true);
  });

  test('one very long word is cut hard rather than dropped', () => {
    const out = recapPreview('x'.repeat(500), { max: 40 });
    expect(out).toBe(`${'x'.repeat(40)}…`);
  });
});

describe('tutorFirstName', () => {
  test('takes the first word of the full name', () => {
    expect(tutorFirstName(new Map([['t1', ' Daniel Ortiz ']]), 't1')).toBe('Daniel');
    expect(tutorFirstName(new Map([['7', 'Priya']]), 7)).toBe('Priya');
  });

  test('an unknown or blank name is null', () => {
    expect(tutorFirstName(new Map(), 't1')).toBeNull();
    expect(tutorFirstName(new Map([['t1', '  ']]), 't1')).toBeNull();
    expect(tutorFirstName(null, 't1')).toBeNull();
  });
});

describe('recentWhen and recentLabel', () => {
  test('today, yesterday, a weekday within the week, then a date', () => {
    expect(recentWhen(session(TODAY, '09:00', '10:00'), TODAY, inZone)).toBe('Today, 9:00 to 10:00 am');
    expect(recentWhen(session('2026-10-13', '16:00', '17:00'), TODAY, inZone)).toBe('Yesterday, 4:00 to 5:00 pm');
    expect(recentWhen(session('2026-10-10', '16:00', '17:30'), TODAY, inZone)).toBe('Sat, 4:00 to 5:30 pm');
    expect(recentWhen(session('2026-10-08', '16:00', '17:00'), TODAY, inZone)).toBe('Thu, 4:00 to 5:00 pm');
    expect(recentWhen(session('2026-10-07', '16:00', '17:00'), TODAY, inZone)).toBe('Wed, Oct 7, 4:00 to 5:00 pm');
  });

  test('a session from another year carries the year', () => {
    expect(recentWhen(session('2025-12-30', '16:00', '17:00'), TODAY, inZone)).toBe('Tue, Dec 30, 2025, 4:00 to 5:00 pm');
  });

  test('the spoken label names the subject, tutor, day and attendance', () => {
    const s = session('2026-10-12', '16:00', '17:00');
    expect(recentLabel(s, { who: 'Daniel', today: TODAY, attendance: attendanceStatus('late') }))
      .toBe('Algebra with Daniel, Monday, October 12, late');
    expect(recentLabel(s, { today: TODAY })).toBe('Algebra, Monday, October 12');
  });

  test('a session with no subject is a tutoring session', () => {
    const s = session('2026-10-12', '16:00', '17:00', { subject: null });
    expect(recentLabel(s, { who: 'Daniel', today: TODAY })).toBe('Tutoring session with Daniel, Monday, October 12');
  });
});

describe('recentRows', () => {
  const names = new Map([['t1', 'Daniel Ortiz'], ['t2', 'Priya Nair']]);

  test('builds a row per recent session with first name, pill and recap preview', () => {
    const a = session('2026-10-08', '16:00', '17:00', { tutor_id: 't2', subject: 'Chemistry' });
    const b = session('2026-10-12', '16:00', '17:00', { attendance: 'present', recap: 'We covered ratios.\nTry page 4.' });
    const rows = recentRows([a, b], names, NOW, inZone);
    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(rows[0]).toMatchObject({
      title: 'Algebra', month: 10, day: 12, who: 'Daniel', when: 'Mon, 4:00 to 5:00 pm',
      attendance: { label: 'Present', tone: 'success' }, recap: 'We covered ratios. Try page 4.',
    });
    expect(rows[0].label).toBe('Algebra with Daniel, Monday, October 12, present');
    expect(rows[0].tone).toMatch(/^tc-[a-z]+$/);
    expect(rows[0].tone).toBe(tutorToneClass('t1'));
    expect(rows[1].tone).toBe(tutorToneClass('t2'));
    expect(rows[1]).toMatchObject({ title: 'Chemistry', who: 'Priya', attendance: null, recap: null });
  });

  test('an unknown tutor leaves the name out', () => {
    const s = session('2026-10-12', '16:00', '17:00', { tutor_id: 'nobody' });
    const [row] = recentRows([s], names, NOW, inZone);
    expect(row.who).toBeNull();
    expect(row.label).toBe('Algebra, Monday, October 12');
  });

  test('at most 3 rows', () => {
    const list = ['2026-10-01', '2026-10-05', '2026-10-08', '2026-10-12'].map((k) => session(k, '16:00', '17:00'));
    expect(recentRows(list, names, NOW, inZone)).toHaveLength(3);
  });
});

describe('childHref and showChildrenRow', () => {
  test('links to the child and the Overview', () => {
    expect(childHref('u-leo')).toBe('?child=u-leo#/overview');
    expect(childHref('a b/c')).toBe('?child=a%20b%2Fc#/overview');
  });

  test('only two or more children get the row', () => {
    expect(showChildrenRow(null)).toBe(false);
    expect(showChildrenRow([])).toBe(false);
    expect(showChildrenRow([{ id: 'a' }])).toBe(false);
    expect(showChildrenRow([{ id: 'a' }, { id: 'b' }])).toBe(true);
  });
});

describe('childSummary', () => {
  const task = (id, extra = {}) => ({
    id, student_id: 's1', kind: 'assignment', title: `Task ${id}`, details: '',
    due_at: null, completed_at: null, created_at: '2026-09-01T00:00:00Z', ...extra,
  });
  const graded = (id, taskId, result, releasedAt) => ({
    id, task_id: taskId, student_id: 's1', status: 'ai_graded', error: null, created_at: releasedAt,
    grade: { result, feedback: 'Good', reviewed_at: releasedAt, released_at: releasedAt },
  });
  const items = (tasks, subs = []) => deriveItems(tasks, subs, NOW, { audience: 'family' });
  const maya = { id: 's1', full_name: 'Maya Lin', email: 'maya@example.com' };

  test('counts overdue assignments and tasks, picks the next session and newest released grade', () => {
    const tasks = [
      task(1, { due_at: at('2026-10-10', '23:59') }),
      task(2, { kind: 'task', due_at: at('2026-10-12', '23:59') }),
      task(3, { due_at: at('2026-10-20', '23:59') }),
      task(4, { title: 'Fractions quiz' }),
      task(5, { title: 'Essay' }),
    ];
    const subs = [
      graded(10, 4, 'missing', '2026-10-06T20:00:00Z'),
      graded(11, 5, 'completed', '2026-10-12T20:00:00Z'),
    ];
    const sessions = [
      session('2026-10-09', '16:00', '17:00'),
      session('2026-10-16', '16:00', '17:00'),
      session('2026-10-15', '16:30', '17:30', { status: 'cancelled' }),
      session('2026-10-22', '16:00', '17:00'),
    ];
    const s = childSummary({ child: maya, items: items(tasks, subs), sessions, now: NOW, viewerInZone: true });
    expect(s).toMatchObject({ id: 's1', name: 'Maya Lin', first: 'Maya', hasWork: true, hasSchedule: true, overdue: 2 });
    expect(s.grade).toEqual({ result: 'completed', title: 'Essay', releasedAt: '2026-10-12T20:00:00Z' });
    expect(s.next).toMatchObject({ subject: 'Algebra', day: 'Fri, Oct 16', time: '4:00 pm', today: false, tomorrow: false });
  });

  test('a released Extended is not the newest grade: the work is back in To do', () => {
    const tasks = [task(1, { title: 'Essay', due_at: at('2026-10-20', '23:59'), extended_from: at('2026-10-10', '23:59') })];
    const s = childSummary({ child: maya, items: items(tasks, [graded(10, 1, 'extended', '2026-10-12T20:00:00Z')]), sessions: [], now: NOW });
    expect(s.grade).toBeNull();
    expect(s.overdue).toBe(0);
  });

  test('a grade the family cannot see yet is not the newest grade', () => {
    const tasks = [task(1, { title: 'Essay' })];
    const unreleased = [{
      id: 1, task_id: 1, student_id: 's1', status: 'ai_graded', error: null, created_at: '2026-10-12T20:00:00Z',
      grade: null,
    }];
    const s = childSummary({ child: maya, items: items(tasks, unreleased), sessions: [], now: NOW });
    expect(s.grade).toBeNull();
    expect(s.next).toBeNull();
  });

  test('work that is done does not count as overdue', () => {
    const tasks = [
      task(1, { kind: 'task', due_at: at('2026-10-10', '23:59'), completed_at: '2026-10-09T10:00:00Z' }),
      task(2, { due_at: at('2026-10-10', '23:59') }),
    ];
    const handedIn = [{ id: 20, task_id: 2, student_id: 's1', status: 'submitted', error: null, created_at: '2026-10-09T10:00:00Z', grade: null }];
    const s = childSummary({ child: maya, items: items(tasks, handedIn), sessions: [], now: NOW });
    expect(s.overdue).toBe(0);
  });

  test('a session today or tomorrow is flagged', () => {
    const soon = session(TODAY, '16:00', '17:00');
    const tomorrow = session('2026-10-15', '16:00', '17:00');
    expect(childSummary({ child: maya, items: [], sessions: [soon], now: NOW, viewerInZone: true }).next).toMatchObject({ today: true, tomorrow: false });
    expect(childSummary({ child: maya, items: [], sessions: [tomorrow], now: NOW, viewerInZone: true }).next).toMatchObject({ today: false, tomorrow: true });
  });

  test('failed loads are marked, not faked', () => {
    const noWork = childSummary({ child: maya, items: null, sessions: [], now: NOW });
    expect(noWork).toMatchObject({ hasWork: false, hasSchedule: true, overdue: 0, grade: null });
    const noSchedule = childSummary({ child: maya, items: [], sessions: null, now: NOW });
    expect(noSchedule).toMatchObject({ hasWork: true, hasSchedule: false, next: null });
  });

  test('a child with no name falls back to their email', () => {
    const s = childSummary({ child: { id: 's2', full_name: '', email: 'leo@example.com' }, items: [], sessions: [], now: NOW });
    expect(s.name).toBe('leo@example.com');
  });
});

describe('childLines', () => {
  const base = { id: 's1', name: 'Maya Lin', first: 'Maya', hasWork: true, hasSchedule: true, next: null, overdue: 0, grade: null };
  const next = { id: 4, subject: 'Algebra', day: 'Fri, Oct 16', time: '4:00 pm', text: 'Fri, Oct 16 at 4:00 pm', today: false, tomorrow: false };

  test('next session, overdue count and latest grade in plain words', () => {
    const lines = childLines({ ...base, next, overdue: 2, grade: { result: 'completed', title: 'Essay', releasedAt: '2026-10-12T20:00:00Z' } });
    expect(lines.next).toEqual({ text: 'Fri, Oct 16 at 4:00 pm', tone: null });
    expect(lines.overdue).toEqual({ text: '2 overdue', tone: 'danger' });
    expect(lines.grade).toEqual({ text: 'Latest: Essay, Completed', tone: null });
    expect(lines.label).toBe('Maya Lin, next session Fri, Oct 16 at 4:00 pm, 2 overdue items, latest grade Essay, Completed');
    expect(childLines({ ...base, grade: { result: 'missing', title: 'Quiz', releasedAt: '2026-10-12T20:00:00Z' } }).grade.text)
      .toBe('Latest: Quiz, Missing');
  });

  test('today and tomorrow read as words', () => {
    expect(childLines({ ...base, next: { ...next, today: true } }).next.text).toBe('Today at 4:00 pm');
    expect(childLines({ ...base, next: { ...next, tomorrow: true } }).next.text).toBe('Tomorrow at 4:00 pm');
  });

  test('quiet wording when there is nothing to report', () => {
    const lines = childLines(base);
    expect(lines.next.text).toBe('No upcoming sessions');
    expect(lines.overdue).toEqual({ text: 'Nothing overdue', tone: null });
    expect(lines.grade.text).toBe('No grades yet');
    expect(lines.label).toBe('Maya Lin, no upcoming sessions, nothing overdue');
  });

  test('one overdue item is singular in the spoken label', () => {
    expect(childLines({ ...base, overdue: 1 }).label).toBe('Maya Lin, no upcoming sessions, 1 overdue item');
  });

  test('parts that did not load are null and named in the label', () => {
    const lines = childLines({ ...base, hasWork: false, hasSchedule: false });
    expect(lines.next).toBeNull();
    expect(lines.overdue).toBeNull();
    expect(lines.grade).toBeNull();
    expect(lines.label).toBe('Maya Lin, schedule unavailable, work unavailable');
  });
});
