import { describe, test, expect } from 'vitest';
import {
  MAX_PREP_ROWS, appliesTo, pickLastLesson, agoText, recapMayOverflow, lastLessonInfo, homeworkSince,
  moreText, waitingOn, buildPrep, studentWorkHref, REVIEW_QUEUE_HREF,
} from '../../portal/js/prep-model.js';
import { deriveItems } from '../../portal/js/buckets.js';
import { zonedIso } from '../../portal/js/dates.js';

// Tuesday, October 6, 2026 at 12:00 pm Pacific
const NOW = new Date('2026-10-06T19:00:00Z');

let nextId = 100;
const session = (day, extra = {}) => ({
  id: nextId++,
  student_id: 's1',
  tutor_id: 't1',
  subject: 'Algebra',
  starts_at: zonedIso(day, '16:00'),
  ends_at: zonedIso(day, '17:00'),
  status: 'scheduled',
  attendance: null,
  recap: null,
  ...extra,
});

const task = (id, extra = {}) => ({
  id, student_id: 's1', kind: 'assignment', title: `Task ${id}`, due_at: null, completed_at: null,
  created_at: '2026-09-01T00:00:00Z', session_id: null, series_id: null, ...extra,
});
const sub = (id, taskId, status = 'ai_graded', grade = null, extra = {}) => ({
  id, task_id: taskId, student_id: 's1', status, error: null, created_at: '2026-10-05T18:00:00Z', grade, ...extra,
});
const draft = (result = 'completed') => ({ result, feedback: null, reviewed_at: null, released_at: null });
const edited = (result = 'completed') => ({ result, feedback: 'ok', reviewed_at: '2026-10-05T20:00:00Z', released_at: null });
const released = (result = 'completed') => ({ result, feedback: 'Good', reviewed_at: '2026-10-05T20:00:00Z', released_at: '2026-10-05T21:00:00Z' });
const derive = (tasks, subs = []) => deriveItems(tasks, subs, NOW, { audience: 'staff' });
const ids = (rows) => rows.map((i) => i.task.id);

// This lesson: Tuesday Oct 13 at 4 pm
const current = () => session('2026-10-13', { id: 1 });
// Last lesson: Tuesday Sep 29
const lastWeek = (extra = {}) => session('2026-09-29', { id: 2, ...extra });

describe('appliesTo', () => {
  test('a lesson still to come or happening now', () => {
    expect(appliesTo(session('2026-10-13'), NOW)).toBe(true);
    // Oct 6, 4 pm to 5 pm is later today
    expect(appliesTo(session('2026-10-06'), NOW)).toBe(true);
    const happening = { ...session('2026-10-06'), starts_at: '2026-10-06T18:30:00Z', ends_at: '2026-10-06T19:30:00Z' };
    expect(appliesTo(happening, NOW)).toBe(true);
  });

  test('not once it has ended, nor when cancelled', () => {
    expect(appliesTo(session('2026-10-05'), NOW)).toBe(false);
    const justEnded = { ...session('2026-10-06'), starts_at: '2026-10-06T18:00:00Z', ends_at: '2026-10-06T19:00:00Z' };
    expect(appliesTo(justEnded, NOW)).toBe(false);
    expect(appliesTo(session('2026-10-13', { status: 'cancelled' }), NOW)).toBe(false);
  });

  test('missing sessions and bad dates are no', () => {
    expect(appliesTo(null, NOW)).toBe(false);
    expect(appliesTo({ status: 'scheduled', ends_at: 'soon' }, NOW)).toBe(false);
  });
});

describe('pickLastLesson', () => {
  test('the most recent earlier lesson that already happened', () => {
    const a = session('2026-09-15');
    const b = session('2026-09-22');
    const c = session('2026-09-29');
    expect(pickLastLesson([c, a, b, current()], current(), NOW)).toBe(c);
  });

  test('never a later lesson, the lesson itself, or one that has not ended', () => {
    const cur = current();
    const next = session('2026-10-20');
    const todayLater = session('2026-10-06');   // 4 pm today, not ended at noon
    expect(pickLastLesson([cur, next, todayLater], cur, NOW)).toBeNull();
    const earlier = session('2026-09-29');
    expect(pickLastLesson([cur, next, todayLater, earlier], cur, NOW)).toBe(earlier);
  });

  test('skips cancelled lessons', () => {
    const real = session('2026-09-22');
    const cancelled = session('2026-09-29', { status: 'cancelled' });
    expect(pickLastLesson([real, cancelled], current(), NOW)).toBe(real);
  });

  test('a lesson earlier today that has ended counts for one later today', () => {
    const morning = { ...session('2026-10-06'), starts_at: '2026-10-06T16:00:00Z', ends_at: '2026-10-06T17:00:00Z' };
    const evening = session('2026-10-06');
    expect(pickLastLesson([morning, evening], evening, NOW)).toBe(morning);
  });

  test('prefers the same subject over a more recent lesson of another', () => {
    const algebra = session('2026-09-22');
    const sat = session('2026-09-29', { subject: 'SAT Reading', tutor_id: 't2' });
    expect(pickLastLesson([algebra, sat], current(), NOW)).toBe(algebra);
  });

  test('the same subject with another tutor beats the same tutor with another subject', () => {
    const sameSubject = session('2026-09-15', { tutor_id: 't2' });
    const sameTutor = session('2026-09-29', { subject: 'Geometry' });
    expect(pickLastLesson([sameSubject, sameTutor], current(), NOW)).toBe(sameSubject);
  });

  test('the same tutor beats a stranger when no subject matches', () => {
    const sameTutor = session('2026-09-15', { subject: 'Geometry' });
    const other = session('2026-09-29', { subject: 'SAT Reading', tutor_id: 't2' });
    expect(pickLastLesson([sameTutor, other], current(), NOW)).toBe(sameTutor);
  });

  test('falls back to any earlier lesson of the student', () => {
    const other = session('2026-09-29', { subject: 'SAT Reading', tutor_id: 't2' });
    expect(pickLastLesson([other], current(), NOW)).toBe(other);
  });

  test('subject match ignores case and spaces', () => {
    const algebra = session('2026-09-22', { subject: '  algebra ' });
    const sat = session('2026-09-29', { subject: 'SAT Reading', tutor_id: 't2' });
    expect(pickLastLesson([algebra, sat], current(), NOW)).toBe(algebra);
  });

  test('two lessons without a subject match each other', () => {
    const cur = session('2026-10-13', { subject: null });
    const blank = session('2026-09-22', { subject: '' });
    const algebra = session('2026-09-29');
    expect(pickLastLesson([blank, algebra], cur, NOW)).toBe(blank);
  });

  test('another student is never picked', () => {
    const stranger = session('2026-09-29', { student_id: 's2' });
    expect(pickLastLesson([stranger], current(), NOW)).toBeNull();
  });

  test('two lessons the same day: the later one', () => {
    const early = { ...session('2026-09-29'), starts_at: zonedIso('2026-09-29', '09:00'), ends_at: zonedIso('2026-09-29', '10:00') };
    const late = session('2026-09-29');
    expect(pickLastLesson([late, early], current(), NOW)).toBe(late);
  });

  test('nothing to pick from', () => {
    expect(pickLastLesson([], current(), NOW)).toBeNull();
    expect(pickLastLesson(null, current(), NOW)).toBeNull();
    expect(pickLastLesson([lastWeek()], null, NOW)).toBeNull();
  });
});

describe('agoText', () => {
  test('days, then weeks, then nothing', () => {
    expect(agoText('2026-10-06T15:00:00Z', NOW)).toBe('earlier today');
    expect(agoText('2026-10-05T23:00:00Z', NOW)).toBe('yesterday');
    expect(agoText(zonedIso('2026-09-29', '16:00'), NOW)).toBe('7 days ago');
    expect(agoText(zonedIso('2026-09-22', '16:00'), NOW)).toBe('2 weeks ago');
    expect(agoText(zonedIso('2026-08-11', '16:00'), NOW)).toBe('8 weeks ago');
    expect(agoText(zonedIso('2026-06-01', '16:00'), NOW)).toBeNull();
  });

  test('a future time has no ago', () => {
    expect(agoText(zonedIso('2026-10-13', '16:00'), NOW)).toBeNull();
  });
});

describe('recapMayOverflow', () => {
  test('short one-line recaps never need the toggle', () => {
    expect(recapMayOverflow('Reviewed factoring.')).toBe(false);
    expect(recapMayOverflow('')).toBe(false);
    expect(recapMayOverflow(null)).toBe(false);
    expect(recapMayOverflow('a\nb')).toBe(false);
  });

  test('long text or three lines may', () => {
    expect(recapMayOverflow('x'.repeat(111))).toBe(true);
    expect(recapMayOverflow('x'.repeat(110))).toBe(false);
    expect(recapMayOverflow('a\nb\nc')).toBe(true);
  });
});

describe('lastLessonInfo', () => {
  test('date, ago, attendance and recap', () => {
    const last = lastWeek({ attendance: 'late', recap: '  Worked through slope.  ' });
    const info = lastLessonInfo(last, current(), NOW);
    expect(info).toMatchObject({
      id: last.id,
      when: 'Tue, Sep 29',
      ago: '7 days ago',
      subject: 'Algebra',
      sameSubject: true,
      sameTutor: true,
      attendance: 'late',
      attendanceLabel: 'Late',
      recap: 'Worked through slope.',
      hasNotes: true,
    });
  });

  test('no notes written yet', () => {
    const info = lastLessonInfo(lastWeek(), current(), NOW);
    expect(info).toMatchObject({ attendance: null, attendanceLabel: null, recap: null, hasNotes: false });
  });

  test('a recap alone or attendance alone counts as notes', () => {
    expect(lastLessonInfo(lastWeek({ recap: 'Quiz review.' }), current(), NOW).hasNotes).toBe(true);
    expect(lastLessonInfo(lastWeek({ attendance: 'absent' }), current(), NOW)).toMatchObject({ hasNotes: true, attendanceLabel: 'Absent' });
  });

  test('an unknown attendance value is ignored', () => {
    expect(lastLessonInfo(lastWeek({ attendance: 'excused' }), current(), NOW).attendance).toBeNull();
  });

  test('says when the subject or tutor differs', () => {
    const last = lastWeek({ subject: 'SAT Reading', tutor_id: 't2' });
    expect(lastLessonInfo(last, current(), NOW)).toMatchObject({ sameSubject: false, sameTutor: false, subject: 'SAT Reading', tutorId: 't2' });
  });

  test('a lesson with no subject is called a tutoring session', () => {
    expect(lastLessonInfo(lastWeek({ subject: null }), current(), NOW).subject).toBe('Tutoring session');
  });

  test('the year shows when it differs from this year', () => {
    const old = session('2025-12-30', { id: 9 });
    expect(lastLessonInfo(old, current(), NOW).when).toBe('Tue, Dec 30, 2025');
  });

  test('no lesson, no info', () => {
    expect(lastLessonInfo(null, current(), NOW)).toBeNull();
  });
});

describe('homeworkSince', () => {
  const last = () => lastWeek();
  const cur = () => current();

  test('items linked to the last lesson are listed with every status', () => {
    const lesson = last();
    const tasks = [
      task(1, { session_id: lesson.id, due_at: zonedIso('2026-10-12') }),
      task(2, { session_id: lesson.id, due_at: zonedIso('2026-10-12') }),
      task(3, { session_id: lesson.id, due_at: zonedIso('2026-10-12') }),
      task(4, { session_id: lesson.id, due_at: zonedIso('2026-10-12') }),
    ];
    const subs = [
      sub(10, 2, 'ai_graded', draft()),
      sub(11, 3, 'ai_graded', released('missing')),
      sub(12, 4, 'pending'),
    ];
    const { rows } = homeworkSince(derive(tasks, subs), { last: lesson, session: cur(), now: NOW });
    expect(ids(rows).sort()).toEqual([1, 2, 3, 4]);
    const byId = new Map(rows.map((i) => [i.task.id, i]));
    expect(byId.get(1).bucket).toBe('todo');
    expect(byId.get(2).bucket).toBe('in-review');
    expect(byId.get(3)).toMatchObject({ bucket: 'graded', grade: expect.objectContaining({ result: 'missing' }) });
    expect(byId.get(4).bucket).toBe('in-review');
  });

  test('order: overdue, then waiting on the tutor, then to do, then finished', () => {
    const lesson = last();
    const tasks = [
      task(1, { session_id: lesson.id, due_at: zonedIso('2026-10-12') }),                           // to do
      task(2, { session_id: lesson.id, due_at: zonedIso('2026-10-05') }),                           // overdue
      task(3, { session_id: lesson.id, due_at: zonedIso('2026-10-12') }),                           // graded
      task(4, { session_id: lesson.id, due_at: zonedIso('2026-10-12') }),                           // in review
    ];
    const subs = [sub(10, 3, 'ai_graded', released()), sub(11, 4, 'ai_graded', draft())];
    const { rows } = homeworkSince(derive(tasks, subs), { last: lesson, session: cur(), now: NOW });
    expect(ids(rows)).toEqual([2, 4, 1, 3]);
  });

  test('within a rank, soonest due first, undated last', () => {
    const lesson = last();
    const tasks = [
      task(1, { session_id: lesson.id }),
      task(2, { session_id: lesson.id, due_at: zonedIso('2026-10-12') }),
      task(3, { session_id: lesson.id, due_at: zonedIso('2026-10-09') }),
    ];
    const { rows } = homeworkSince(derive(tasks), { last: lesson, session: cur(), now: NOW });
    expect(ids(rows)).toEqual([3, 2, 1]);
  });

  test('work made since the last lesson started is included, older work is not', () => {
    const lesson = last();
    const tasks = [
      task(1, { created_at: '2026-09-29T23:30:00Z', due_at: zonedIso('2026-10-12') }),   // during the lesson
      task(2, { created_at: '2026-10-02T12:00:00Z', due_at: zonedIso('2026-10-12') }),   // after
      task(3, { created_at: '2026-09-20T12:00:00Z', due_at: zonedIso('2026-10-12') }),   // before, but due since: included
      task(4, { created_at: '2026-09-20T12:00:00Z', due_at: zonedIso('2026-09-25'), completed_at: '2026-09-24T12:00:00Z', kind: 'task' }),   // before and done and due before
    ];
    const { rows } = homeworkSince(derive(tasks), { last: lesson, session: cur(), now: NOW });
    expect(ids(rows).sort()).toEqual([1, 2, 3]);
  });

  test('work due since the last lesson is included even if made earlier', () => {
    const lesson = last();
    const tasks = [task(1, { created_at: '2026-09-01T00:00:00Z', due_at: zonedIso('2026-10-08') })];
    expect(ids(homeworkSince(derive(tasks), { last: lesson, session: cur(), now: NOW }).rows)).toEqual([1]);
  });

  test('work due long after this lesson is left out', () => {
    const lesson = last();
    const tasks = [
      task(1, { created_at: '2026-10-02T00:00:00Z', due_at: zonedIso('2026-10-20') }),    // a week after Oct 13, end of day: in
      task(4, { created_at: '2026-10-02T00:00:00Z', due_at: zonedIso('2026-10-21', '00:30') }),   // just past: out
      task(2, { created_at: '2026-10-02T00:00:00Z', due_at: zonedIso('2026-11-30') }),    // far off: out
      task(3, { created_at: '2026-10-02T00:00:00Z' }),                                    // no due date: in
    ];
    const { rows } = homeworkSince(derive(tasks), { last: lesson, session: cur(), now: NOW });
    expect(ids(rows).sort()).toEqual([1, 3]);
  });

  test('copies of a repeating task far ahead are left out', () => {
    const lesson = last();
    const tasks = [
      task(1, { kind: 'task', series_id: 'r', created_at: '2026-10-01T00:00:00Z', due_at: zonedIso('2026-10-08') }),
      task(2, { kind: 'task', series_id: 'r', created_at: '2026-10-01T00:00:00Z', due_at: zonedIso('2026-11-12') }),
    ];
    expect(ids(homeworkSince(derive(tasks), { last: lesson, session: cur(), now: NOW }).rows)).toEqual([1]);
  });

  test('work set in this lesson is left to the drawer own Homework section', () => {
    const lesson = last();
    const here = cur();
    const tasks = [
      task(1, { session_id: here.id, due_at: zonedIso('2026-10-19') }),
      task(2, { session_id: here.id, due_at: zonedIso('2026-10-05') }),   // even if overdue
    ];
    expect(homeworkSince(derive(tasks), { last: lesson, session: here, now: NOW }).rows).toEqual([]);
  });

  test('work set in some other lesson is left out unless overdue', () => {
    const lesson = last();
    const tasks = [
      task(1, { session_id: 777, created_at: '2026-10-02T00:00:00Z', due_at: zonedIso('2026-10-10') }),
      task(2, { session_id: 777, created_at: '2026-10-02T00:00:00Z', due_at: zonedIso('2026-10-03') }),
    ];
    expect(ids(homeworkSince(derive(tasks), { last: lesson, session: cur(), now: NOW }).rows)).toEqual([2]);
  });

  test('anything overdue and open is listed, however old', () => {
    const lesson = last();
    const tasks = [
      task(1, { created_at: '2026-08-01T00:00:00Z', due_at: zonedIso('2026-09-10') }),
      task(2, { kind: 'task', created_at: '2026-08-01T00:00:00Z', due_at: zonedIso('2026-09-01') }),
    ];
    const { rows } = homeworkSince(derive(tasks), { last: lesson, session: cur(), now: NOW });
    // Oldest due first
    expect(ids(rows)).toEqual([2, 1]);
    expect(rows.every((i) => i.dueState === 'overdue')).toBe(true);
  });

  test('an overdue item that was turned in is not overdue', () => {
    const lesson = last();
    const tasks = [task(1, { created_at: '2026-08-01T00:00:00Z', due_at: zonedIso('2026-09-01') })];
    const subs = [sub(10, 1, 'ai_graded', released())];
    // Graded long ago: archived, so left out
    expect(homeworkSince(derive(tasks, subs), { last: lesson, session: cur(), now: NOW }).rows).toEqual([]);
  });

  test('archived work is never listed, even when linked to the last lesson', () => {
    const lesson = last();
    // Due 40 days ago, never turned in: archived as missed
    const tasks = [task(1, { session_id: lesson.id, due_at: zonedIso('2026-08-20') })];
    const items = derive(tasks);
    expect(items[0].bucket).toBe('archived');
    expect(homeworkSince(items, { last: lesson, session: cur(), now: NOW }).rows).toEqual([]);
  });

  test('a done task linked to the last lesson shows as finished', () => {
    const lesson = last();
    const tasks = [task(1, { kind: 'task', session_id: lesson.id, completed_at: '2026-10-01T12:00:00Z', due_at: zonedIso('2026-10-02') })];
    const { rows } = homeworkSince(derive(tasks), { last: lesson, session: cur(), now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0].dueState).toBe('done');
  });

  test('without a last lesson only linked-nowhere overdue work is listed', () => {
    const tasks = [
      task(1, { created_at: '2026-10-02T00:00:00Z', due_at: zonedIso('2026-10-10') }),
      task(2, { created_at: '2026-10-02T00:00:00Z', due_at: zonedIso('2026-10-03') }),
    ];
    expect(ids(homeworkSince(derive(tasks), { last: null, session: cur(), now: NOW }).rows)).toEqual([2]);
  });

  test('a long list is cut with the rest counted', () => {
    const lesson = last();
    const tasks = Array.from({ length: 9 }, (_, i) => task(i + 1, {
      session_id: lesson.id,
      // 3 overdue, 6 coming up
      due_at: zonedIso(i < 3 ? `2026-10-0${i + 1}` : `2026-10-1${i - 3}`),
    }));
    const { rows, more, moreOverdue } = homeworkSince(derive(tasks), { last: lesson, session: cur(), now: NOW });
    expect(rows).toHaveLength(MAX_PREP_ROWS);
    expect(more).toBe(3);
    // Overdue ones come first, so none of them is hidden
    expect(moreOverdue).toBe(0);
    expect(ids(rows).slice(0, 3)).toEqual([1, 2, 3]);
  });

  test('hidden overdue items are counted', () => {
    const lesson = last();
    const tasks = Array.from({ length: 5 }, (_, i) => task(i + 1, { session_id: lesson.id, due_at: zonedIso(`2026-10-0${i + 1}`) }));
    const { rows, more, moreOverdue } = homeworkSince(derive(tasks), { last: lesson, session: cur(), now: NOW, limit: 3 });
    expect(rows).toHaveLength(3);
    expect(more).toBe(2);
    expect(moreOverdue).toBe(2);
  });

  test('nothing in, nothing out', () => {
    expect(homeworkSince([], { last: last(), session: cur(), now: NOW })).toEqual({ rows: [], more: 0, moreOverdue: 0 });
    expect(homeworkSince(null, { last: last(), session: cur(), now: NOW }).rows).toEqual([]);
    expect(homeworkSince([], { session: null, now: NOW }).rows).toEqual([]);
  });

  test('reads the portal own derivation: items are returned as deriveItems made them', () => {
    const lesson = last();
    const items = derive([task(1, { session_id: lesson.id })]);
    expect(homeworkSince(items, { last: lesson, session: cur(), now: NOW }).rows[0]).toBe(items[0]);
  });
});

describe('moreText', () => {
  test('wording', () => {
    expect(moreText({ more: 0, moreOverdue: 0 })).toBe('');
    expect(moreText({ more: 3, moreOverdue: 0 })).toBe('3 more');
    expect(moreText({ more: 3, moreOverdue: 2 })).toBe('3 more, 2 overdue');
  });
});

describe('waitingOn', () => {
  test('counts AI drafts and edited drafts together, failures apart', () => {
    const subs = [
      sub(1, 1, 'ai_graded', draft()),
      sub(2, 2, 'ai_graded', edited()),
      sub(3, 3, 'failed'),
      sub(4, 4, 'ai_graded', released()),
      sub(5, 5, 'pending'),
    ];
    const w = waitingOn(subs);
    expect(w).toMatchObject({ drafts: 2, failed: 1, total: 3 });
    expect(w.notes.map((n) => n.key)).toEqual(['drafts', 'failed']);
    expect(w.notes[0].text).toBe('2 grades are drafted and waiting for you to release.');
    expect(w.notes[1].text).toBe('1 submission could not be graded.');
  });

  test('released and still grading work is not waiting on the tutor', () => {
    const subs = [sub(1, 1, 'ai_graded', released()), sub(2, 2, 'pending'), sub(3, 3, 'grading')];
    expect(waitingOn(subs)).toMatchObject({ drafts: 0, failed: 0, total: 0, notes: [] });
  });

  test('only the newest attempt counts, like the review queue', () => {
    const older = sub(1, 1, 'ai_graded', draft(), { created_at: '2026-10-01T10:00:00Z' });
    const newer = sub(2, 1, 'pending', null, { created_at: '2026-10-02T10:00:00Z' });
    expect(waitingOn([older, newer]).total).toBe(0);
    const newerReleased = sub(3, 1, 'ai_graded', released(), { created_at: '2026-10-03T10:00:00Z' });
    expect(waitingOn([older, newerReleased]).total).toBe(0);
  });

  test('a single draft links to its review page, several to the queue', () => {
    const one = waitingOn([sub(7, 1, 'ai_graded', draft())]);
    expect(one.notes[0]).toMatchObject({ text: '1 grade is drafted and waiting for you to release.', href: '#/review/7', linkLabel: 'Review it' });
    const many = waitingOn([sub(7, 1, 'ai_graded', draft()), sub(8, 2, 'ai_graded', draft())]);
    expect(many.notes[0]).toMatchObject({ href: REVIEW_QUEUE_HREF, linkLabel: 'Open review queue' });
  });

  test('a single failure links to its review page', () => {
    const w = waitingOn([sub(9, 1, 'failed')]);
    expect(w.notes[0]).toMatchObject({ key: 'failed', href: '#/review/9' });
  });

  test('no submissions', () => {
    expect(waitingOn([])).toMatchObject({ total: 0, notes: [] });
    expect(waitingOn(null)).toMatchObject({ total: 0, notes: [] });
  });

  test('grades embedded as one-element arrays are read too', () => {
    expect(waitingOn([sub(1, 1, 'ai_graded', [released()])]).total).toBe(0);
    expect(waitingOn([sub(1, 1, 'ai_graded', [draft()])]).drafts).toBe(1);
  });
});

describe('buildPrep', () => {
  const full = () => {
    const lesson = lastWeek({ attendance: 'present', recap: 'Slope and intercepts.' });
    const tasks = [task(1, { session_id: lesson.id, due_at: zonedIso('2026-10-12') })];
    return {
      session: current(),
      sessions: [lesson, current()],
      items: derive(tasks, [sub(10, 1, 'ai_graded', draft())]),
      subs: [sub(10, 1, 'ai_graded', draft())],
      now: NOW,
    };
  };

  test('puts the three parts together', () => {
    const prep = buildPrep(full());
    expect(prep.last).toMatchObject({ when: 'Tue, Sep 29', attendance: 'present', recap: 'Slope and intercepts.' });
    expect(ids(prep.homework.rows)).toEqual([1]);
    expect(prep.waiting.total).toBe(1);
  });

  test('null for a lesson that has ended or was cancelled', () => {
    const base = full();
    expect(buildPrep({ ...base, session: session('2026-10-05', { id: 1 }) })).toBeNull();
    expect(buildPrep({ ...base, session: { ...current(), status: 'cancelled' } })).toBeNull();
    expect(buildPrep({})).toBeNull();
  });

  test('null when there is nothing to say', () => {
    const cur = current();
    expect(buildPrep({ session: cur, sessions: [cur], items: [], subs: [], now: NOW })).toBeNull();
    expect(buildPrep({ session: cur, sessions: [cur], items: derive([task(1, { due_at: zonedIso('2026-11-30') })]), subs: [], now: NOW })).toBeNull();
  });

  test('a last lesson alone is enough', () => {
    const cur = current();
    const prep = buildPrep({ session: cur, sessions: [lastWeek(), cur], items: [], subs: [], now: NOW });
    expect(prep.last).not.toBeNull();
    expect(prep.homework.rows).toEqual([]);
    expect(prep.waiting.total).toBe(0);
  });

  test('waiting work alone is enough', () => {
    const cur = current();
    const prep = buildPrep({ session: cur, sessions: [cur], items: [], subs: [sub(1, 1, 'failed')], now: NOW });
    expect(prep.last).toBeNull();
    expect(prep.waiting.failed).toBe(1);
  });

  test('overdue work alone is enough', () => {
    const cur = current();
    const items = derive([task(1, { due_at: zonedIso('2026-10-01') })]);
    const prep = buildPrep({ session: cur, sessions: [cur], items, subs: [], now: NOW });
    expect(ids(prep.homework.rows)).toEqual([1]);
  });

  test('works for a lesson happening now', () => {
    const happening = { ...session('2026-10-06', { id: 60 }), starts_at: '2026-10-06T18:30:00Z', ends_at: '2026-10-06T19:30:00Z' };
    const prep = buildPrep({ session: happening, sessions: [lastWeek(), happening], items: [], subs: [], now: NOW });
    expect(prep.last.when).toBe('Tue, Sep 29');
  });
});

describe('studentWorkHref', () => {
  test('the scoped assignments list', () => {
    expect(studentWorkHref('u-maya')).toBe('?student=u-maya#/assignments/todo');
    expect(studentWorkHref('a b')).toBe('?student=a%20b#/assignments/todo');
  });
});
