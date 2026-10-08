import { describe, test, expect } from 'vitest';
import {
  RESULTS, RESULT_LABELS, resultOf, resultLabel, extendedDueAt, checkExtension, extensionChanges,
  EXTEND_DATE_ERROR, EXTEND_PAST_ERROR, assignmentOutcome, completionCounts, completionText, rateText,
} from '../../portal/js/results.js';

// Wednesday, October 14, 2026 at 12:00 pm Pacific
const NOW = new Date('2026-10-14T19:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms) => new Date(NOW.getTime() + ms).toISOString();

const task = (id, extra = {}) => ({ id, kind: 'assignment', due_at: null, created_at: '2026-09-01T00:00:00Z', ...extra });
const sub = (id, taskId, createdAt, grade = null) => ({ id, task_id: taskId, created_at: createdAt, grade });
const released = (result, at = ago(DAY)) => ({ result, feedback: null, released_at: at });
const draft = (result) => ({ result, feedback: null, released_at: null });

describe('names', () => {
  test('three results, in order, with their labels', () => {
    expect(RESULTS).toEqual(['completed', 'missing', 'extended']);
    expect(RESULT_LABELS).toEqual({ completed: 'Completed', missing: 'Missing', extended: 'Extended' });
    expect(resultLabel('missing')).toBe('Missing');
    expect(resultLabel('A+')).toBeNull();
  });

  test('resultOf reads a grade row or an embed, and ignores anything else', () => {
    expect(resultOf({ result: 'extended' })).toBe('extended');
    expect(resultOf([{ result: 'completed' }])).toBe('completed');
    expect(resultOf({ result: 'Completed' })).toBeNull();
    expect(resultOf({ score: 90 })).toBeNull();
    expect(resultOf(null)).toBeNull();
  });
});

describe('extensions', () => {
  test('keep the assignment due time of day, in Pacific time', () => {
    // 5:00 pm Pacific on Oct 14 (PDT) -> 5:00 pm Pacific on Oct 20
    expect(extendedDueAt('2026-10-20', '2026-10-15T00:00:00Z')).toBe('2026-10-21T00:00:00.000Z');
    // across the end of daylight saving time the wall time still holds
    expect(extendedDueAt('2026-11-05', '2026-10-15T00:00:00Z')).toBe('2026-11-06T01:00:00.000Z');
  });

  test('without a due time, 11:59 pm Pacific', () => {
    expect(extendedDueAt('2026-10-20')).toBe('2026-10-21T06:59:00.000Z');
    expect(extendedDueAt('2026-10-20', 'not a date')).toBe('2026-10-21T06:59:00.000Z');
  });

  test('only real dates', () => {
    expect(extendedDueAt('2026-02-30')).toBeNull();
    expect(extendedDueAt('10/20/2026')).toBeNull();
    expect(extendedDueAt('')).toBeNull();
  });

  test('checkExtension wants a date whose new due time is still ahead', () => {
    expect(checkExtension('', null, NOW)).toEqual({ ok: false, dueAt: null, error: EXTEND_DATE_ERROR });
    expect(checkExtension('nope', null, NOW).error).toBe(EXTEND_DATE_ERROR);
    expect(checkExtension('2026-10-13', null, NOW)).toEqual({ ok: false, dueAt: null, error: EXTEND_PAST_ERROR });
    // today at 11:59 pm is still ahead at noon
    expect(checkExtension('2026-10-14', null, NOW)).toEqual({ ok: true, dueAt: '2026-10-15T06:59:00.000Z', error: null });
    // today at 9:00 am (the assignment's time) has passed
    expect(checkExtension('2026-10-14', '2026-10-10T16:00:00Z', NOW).error).toBe(EXTEND_PAST_ERROR);
    expect(checkExtension('2026-10-15', '2026-10-10T16:00:00Z', NOW)).toMatchObject({ ok: true, dueAt: '2026-10-15T16:00:00.000Z' });
    expect(EXTEND_DATE_ERROR + EXTEND_PAST_ERROR).not.toMatch(/[\u2013\u2014]/);
  });

  test('extensionChanges keeps the first original due date', () => {
    expect(extensionChanges({ due_at: 'A', extended_from: null }, 'B')).toEqual({ due_at: 'B', extended_from: 'A' });
    expect(extensionChanges({ due_at: 'B', extended_from: 'A' }, 'C')).toEqual({ due_at: 'C', extended_from: 'A' });
    expect(extensionChanges({ due_at: null }, 'C')).toEqual({ due_at: 'C', extended_from: null });
  });
});

describe('assignmentOutcome', () => {
  const undecided = { result: null, at: null, extended: false };

  test('the latest released result decides, at its release time', () => {
    const at = ago(2 * DAY);
    expect(assignmentOutcome(task(1), [sub(1, 1, ago(3 * DAY), released('completed', at))], NOW)).toEqual({ result: 'completed', at, extended: false });
    expect(assignmentOutcome(task(1), [sub(1, 1, ago(3 * DAY), released('missing', at))], NOW)).toEqual({ result: 'missing', at, extended: false });
  });

  test('a newer attempt still in review keeps the older released result', () => {
    const subs = [sub(1, 1, ago(5 * DAY), released('missing', ago(4 * DAY))), sub(2, 1, ago(DAY), draft('completed'))];
    expect(assignmentOutcome(task(1), subs, NOW).result).toBe('missing');
  });

  test('drafts never count, and neither does work waiting for review', () => {
    expect(assignmentOutcome(task(1, { due_at: ago(DAY) }), [sub(1, 1, ago(2 * DAY), draft('completed'))], NOW)).toEqual(undecided);
    expect(assignmentOutcome(task(1), [sub(1, 1, ago(2 * DAY))], NOW)).toEqual(undecided);
  });

  test('nothing handed in: missing once past due (at the due date), undecided before', () => {
    const due = ago(HOUR);
    expect(assignmentOutcome(task(1, { due_at: due }), [], NOW)).toEqual({ result: 'missing', at: due, extended: false });
    expect(assignmentOutcome(task(1, { due_at: ahead(HOUR) }), [], NOW)).toEqual(undecided);
    expect(assignmentOutcome(task(1), [], NOW)).toEqual(undecided);
  });

  test('a released Extended waits until its new due date, then counts as missing', () => {
    const subs = [sub(1, 1, ago(5 * DAY), released('extended', ago(4 * DAY)))];
    expect(assignmentOutcome(task(1, { due_at: ahead(DAY) }), subs, NOW)).toEqual({ ...undecided, extended: true });
    const due = ago(HOUR);
    expect(assignmentOutcome(task(1, { due_at: due }), subs, NOW)).toEqual({ result: 'missing', at: due, extended: false });
  });

  test('handed in again after an extension: undecided until that one is released', () => {
    const subs = [sub(1, 1, ago(5 * DAY), released('extended', ago(4 * DAY))), sub(2, 1, ago(DAY), draft(null))];
    expect(assignmentOutcome(task(1, { due_at: ago(HOUR) }), subs, NOW)).toEqual(undecided);
    const done = [...subs.slice(0, 1), sub(2, 1, ago(DAY), released('completed', ago(HOUR)))];
    expect(assignmentOutcome(task(1, { due_at: ago(HOUR) }), done, NOW).result).toBe('completed');
  });

  test('staff extended the due date before anything came in', () => {
    const t = task(1, { due_at: ahead(2 * DAY), extended_from: ago(DAY) });
    expect(assignmentOutcome(t, [], NOW)).toEqual({ ...undecided, extended: true });
    expect(assignmentOutcome({ ...t, due_at: ago(HOUR) }, [], NOW).result).toBe('missing');
  });

  test('tasks and released grades without a result never count', () => {
    expect(assignmentOutcome(task(1, { kind: 'task', due_at: ago(DAY) }), [], NOW)).toEqual(undecided);
    expect(assignmentOutcome(task(1, { due_at: ago(DAY) }), [sub(1, 1, ago(2 * DAY), { score: 90, released_at: ago(DAY) })], NOW)).toEqual(undecided);
  });
});

describe('completionCounts', () => {
  const tasks = [
    task(1, { due_at: ago(10 * DAY) }),                     // completed
    task(2, { due_at: ago(9 * DAY) }),                      // completed
    task(3, { due_at: ago(8 * DAY) }),                      // released missing
    task(4, { due_at: ago(40 * DAY) }),                     // nothing handed in, long ago
    task(5, { due_at: ago(2 * DAY) }),                      // nothing handed in
    task(6, { due_at: ahead(3 * DAY) }),                    // extended, still running
    task(7, { due_at: ahead(3 * DAY) }),                    // not due yet
    task(8, { due_at: ago(DAY) }),                          // waiting for review
    task(9, { kind: 'task', due_at: ago(DAY) }),            // a task: never counted
    task(10, { due_at: ahead(DAY), extended_from: ago(DAY) }), // extended by staff
  ];
  const subs = [
    sub(1, 1, ago(11 * DAY), released('completed', ago(10 * DAY))),
    sub(2, 2, ago(10 * DAY), released('completed', ago(45 * DAY))),
    sub(3, 3, ago(9 * DAY), released('missing', ago(8 * DAY))),
    sub(6, 6, ago(5 * DAY), released('extended', ago(4 * DAY))),
    sub(8, 8, ago(2 * DAY), draft('completed')),
  ];

  test('completed over completed plus missing; extended counted apart', () => {
    expect(completionCounts(tasks, subs, NOW)).toEqual({ completed: 2, missing: 3, total: 5, rate: 0.4, extended: 2 });
  });

  test('within() keeps results decided in a window; extended is never limited', () => {
    const last30 = (at) => NOW.getTime() - Date.parse(at) <= 30 * DAY;
    expect(completionCounts(tasks, subs, NOW, { within: last30 })).toEqual({ completed: 1, missing: 2, total: 3, rate: 1 / 3, extended: 2 });
  });

  test('nothing decided: a null rate', () => {
    expect(completionCounts([task(1, { due_at: ahead(DAY) })], [], NOW)).toEqual({ completed: 0, missing: 0, total: 0, rate: null, extended: 0 });
    expect(completionCounts(null, null, NOW).rate).toBeNull();
  });

  test('submissions match tasks by id, whatever their type', () => {
    const counts = completionCounts([task('12')], [sub(1, 12, ago(DAY), released('completed'))], NOW);
    expect(counts.completed).toBe(1);
  });

  test('wording', () => {
    expect(completionText({ completed: 8, total: 10 })).toBe('8 of 10');
    expect(rateText(0.8)).toBe('80%');
    expect(rateText(2 / 3)).toBe('67%');
    expect(rateText(null)).toBeNull();
  });
});
