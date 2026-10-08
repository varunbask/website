import { describe, test, expect } from 'vitest';
import {
  ARCHIVE_GRADED_AFTER_DAYS, ARCHIVE_MISSED_AFTER_DAYS, DUE_SOON_HOURS, MAX_SUBMISSIONS,
  DONE_RECENT_DAYS, GRADED_RECENT_DAYS,
  sortSubs, bucketOf, archiveReason, dueState, isExtended, deriveItems, groupTodo, groupInReviewStaff,
  inReviewFamily, groupGraded, groupArchived, groupTasks, navCounts,
} from '../../portal/js/buckets.js';

// Wednesday, October 14, 2026 at 12:00 pm Pacific
const NOW = new Date('2026-10-14T19:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms) => new Date(NOW.getTime() + ms).toISOString();

const task = (id, extra = {}) => ({
  id, student_id: 's1', kind: 'assignment', title: `Task ${id}`, details: '',
  due_at: null, completed_at: null, created_at: '2026-09-01T00:00:00Z', ...extra,
});
const sub = (id, taskId, createdAt, status = 'ai_graded', grade = null, extra = {}) => ({
  id, task_id: taskId, student_id: 's1', status, error: null, created_at: createdAt, grade, ...extra,
});
const draft = (result = 'completed') => ({ result, feedback: 'ok', reviewed_at: null, released_at: null });
const edited = (result = 'completed') => ({ result, feedback: 'ok', reviewed_at: ago(HOUR), released_at: null });
const released = (at, result = 'completed') => ({ result, feedback: 'ok', reviewed_at: at, released_at: at });

const one = (t, subs = [], opts = { audience: 'staff' }) => deriveItems([t], subs, NOW, opts)[0];

describe('constants', () => {
  test('match the spec', () => {
    expect([ARCHIVE_GRADED_AFTER_DAYS, ARCHIVE_MISSED_AFTER_DAYS, DUE_SOON_HOURS, MAX_SUBMISSIONS,
      DONE_RECENT_DAYS, GRADED_RECENT_DAYS]).toEqual([21, 30, 48, 5, 14, 7]);
  });
});

describe('sortSubs', () => {
  test('newest first, ties broken by the higher id, without mutating', () => {
    const subs = [sub(1, 1, '2026-10-01T00:00:00Z'), sub(3, 1, '2026-10-02T00:00:00Z'), sub(2, 1, '2026-10-02T00:00:00Z')];
    expect(sortSubs(subs).map((s) => s.id)).toEqual([3, 2, 1]);
    expect(subs.map((s) => s.id)).toEqual([1, 3, 2]);
  });
});

describe('bucketOf and archiveReason', () => {
  test('no submissions: to do until 30 days past due', () => {
    expect(bucketOf(task(1), [], NOW)).toBe('todo');
    expect(bucketOf(task(1, { due_at: ahead(DAY) }), [], NOW)).toBe('todo');
    expect(bucketOf(task(1, { due_at: ago(DAY) }), [], NOW)).toBe('todo');
    expect(bucketOf(task(1, { due_at: ago(30 * DAY) }), [], NOW)).toBe('todo');
    expect(bucketOf(task(1, { due_at: ago(30 * DAY + 1) }), [], NOW)).toBe('archived');
    expect(archiveReason(task(1, { due_at: ago(30 * DAY + 1) }), [], NOW)).toBe('missed');
    expect(archiveReason(task(1, { due_at: ago(DAY) }), [], NOW)).toBeNull();
  });

  test('completed_at is ignored for assignments', () => {
    const done = { completed_at: ago(DAY) };
    expect(bucketOf(task(1, { ...done, due_at: ahead(DAY) }), [], NOW)).toBe('todo');
    expect(bucketOf(task(1, { ...done, due_at: ago(31 * DAY) }), [], NOW)).toBe('archived');
  });

  test('unreleased latest submission is in review', () => {
    expect(bucketOf(task(1), [sub(1, 1, ago(HOUR), 'pending')], NOW)).toBe('in-review');
    expect(bucketOf(task(1), [sub(1, 1, ago(HOUR), 'ai_graded', draft())], NOW)).toBe('in-review');
    expect(bucketOf(task(1), [sub(1, 1, ago(HOUR), 'failed')], NOW)).toBe('in-review');
  });

  test('families receive null grades for unreleased work', () => {
    expect(bucketOf(task(1), [sub(1, 1, ago(HOUR), 'ai_graded', null)], NOW)).toBe('in-review');
  });

  test('released: graded for 21 days, then archived', () => {
    const at = (ms) => [sub(1, 1, ago(40 * DAY), 'ai_graded', released(ago(ms)))];
    expect(bucketOf(task(1), at(DAY), NOW)).toBe('graded');
    expect(bucketOf(task(1), at(21 * DAY), NOW)).toBe('graded');
    expect(bucketOf(task(1), at(21 * DAY + 1), NOW)).toBe('archived');
    expect(archiveReason(task(1), at(21 * DAY + 1), NOW)).toBe('graded');
    expect(archiveReason(task(1), at(DAY), NOW)).toBeNull();
  });

  test('an embedded grade may arrive as an array', () => {
    expect(bucketOf(task(1), [sub(1, 1, ago(DAY), 'ai_graded', [released(ago(HOUR))])], NOW)).toBe('graded');
  });

  test('a resubmission after a release goes back to in review', () => {
    const subs = [
      sub(1, 1, ago(10 * DAY), 'ai_graded', released(ago(9 * DAY), 'missing')),
      sub(2, 1, ago(HOUR), 'pending'),
    ];
    expect(bucketOf(task(1), subs, NOW)).toBe('in-review');
    const item = one(task(1), subs);
    expect(item.previousResult).toBe('missing');
    expect(item.latest.id).toBe(2);
    expect(item.grade).toBeNull();
  });

  test('late work on a missed assignment moves it to in review', () => {
    const t = task(1, { due_at: ago(40 * DAY) });
    expect(bucketOf(t, [], NOW)).toBe('archived');
    expect(bucketOf(t, [sub(1, 1, ago(MIN), 'pending')], NOW)).toBe('in-review');
  });

  test('tasks have their own bucket', () => {
    expect(bucketOf(task(1, { kind: 'task' }), [], NOW)).toBe('task');
  });
});

describe('results: Completed, Missing and Extended', () => {
  test('a released Completed or Missing is graded', () => {
    expect(bucketOf(task(1), [sub(1, 1, ago(DAY), 'ai_graded', released(ago(HOUR), 'completed'))], NOW)).toBe('graded');
    expect(bucketOf(task(1), [sub(1, 1, ago(DAY), 'ai_graded', released(ago(HOUR), 'missing'))], NOW)).toBe('graded');
  });

  test('a released Extended goes back to To do, due on the new date', () => {
    const t = task(1, { due_at: ahead(3 * DAY), extended_from: ago(2 * DAY) });
    const subs = [sub(1, 1, ago(3 * DAY), 'ai_graded', released(ago(DAY), 'extended'))];
    expect(bucketOf(t, subs, NOW)).toBe('todo');
    expect(dueState(t, subs, NOW)).toBe('upcoming');
    expect(isExtended(t, subs)).toBe(true);
    const item = one(t, subs, { audience: 'family' });
    expect(item).toMatchObject({ bucket: 'todo', dueState: 'upcoming', extended: true, attempts: 1 });
    expect(item.grade.result).toBe('extended');
    expect(dueState({ ...t, due_at: ahead(HOUR) }, subs, NOW)).toBe('soon');
  });

  test('an extension that runs out is overdue (Missing), then archived 30 days on', () => {
    const subs = [sub(1, 1, ago(10 * DAY), 'ai_graded', released(ago(9 * DAY), 'extended'))];
    expect(dueState(task(1, { due_at: ago(HOUR) }), subs, NOW)).toBe('overdue');
    expect(bucketOf(task(1, { due_at: ago(HOUR) }), subs, NOW)).toBe('todo');
    expect(bucketOf(task(1, { due_at: ago(31 * DAY) }), subs, NOW)).toBe('archived');
    expect(archiveReason(task(1, { due_at: ago(31 * DAY) }), subs, NOW)).toBe('missed');
  });

  test('the student hands in again: in review as usual, and no longer extended', () => {
    const t = task(1, { due_at: ahead(3 * DAY), extended_from: ago(2 * DAY) });
    const subs = [
      sub(1, 1, ago(3 * DAY), 'ai_graded', released(ago(DAY), 'extended')),
      sub(2, 1, ago(HOUR), 'pending'),
    ];
    expect(bucketOf(t, subs, NOW)).toBe('in-review');
    expect(dueState(t, subs, NOW)).toBe('done');
    expect(isExtended(t, subs)).toBe(false);
    const item = one(t, subs, { audience: 'family' });
    expect(item.previousResult).toBe('extended');
    expect(item.canSubmit).toBe(false);
    expect(one(t, subs, { audience: 'family', canSubmit: true }).canSubmit).toBe(true);
  });

  test('a drafted Extended is still in review: only a release opens it again', () => {
    const subs = [sub(1, 1, ago(DAY), 'ai_graded', edited('extended'))];
    expect(bucketOf(task(1, { due_at: ago(HOUR) }), subs, NOW)).toBe('in-review');
    expect(isExtended(task(1), subs)).toBe(false);
  });

  test('staff extended the due date before anything came in', () => {
    const t = task(1, { due_at: ahead(2 * DAY), extended_from: ago(DAY) });
    expect(isExtended(t, [])).toBe(true);
    expect(one(t, [])).toMatchObject({ bucket: 'todo', extended: true });
    expect(isExtended(task(1, { due_at: ahead(DAY) }), [])).toBe(false);
    expect(isExtended(task(1, { kind: 'task', extended_from: ago(DAY) }), [])).toBe(false);
  });

  test('a graded assignment keeps graded even with an older extension', () => {
    const subs = [
      sub(1, 1, ago(5 * DAY), 'ai_graded', released(ago(4 * DAY), 'extended')),
      sub(2, 1, ago(2 * DAY), 'ai_graded', released(ago(DAY), 'completed')),
    ];
    const t = task(1, { due_at: ago(3 * DAY), extended_from: ago(6 * DAY) });
    expect(bucketOf(t, subs, NOW)).toBe('graded');
    expect(isExtended(t, subs)).toBe(false);
  });
});

describe('dueState', () => {
  test('every branch', () => {
    expect(dueState(task(1), [], NOW)).toBe('undated');
    expect(dueState(task(1, { due_at: ago(1) }), [], NOW)).toBe('overdue');
    expect(dueState(task(1, { due_at: ahead(48 * HOUR) }), [], NOW)).toBe('soon');
    expect(dueState(task(1, { due_at: ahead(48 * HOUR + 1) }), [], NOW)).toBe('upcoming');
    expect(dueState(task(1, { due_at: ago(DAY) }), [sub(1, 1, ago(HOUR), 'pending')], NOW)).toBe('done');
    expect(dueState(task(1, { kind: 'task', due_at: ago(DAY), completed_at: ago(HOUR) }), [], NOW)).toBe('done');
    expect(dueState(task(1, { kind: 'task', due_at: ago(DAY) }), [], NOW)).toBe('overdue');
    expect(dueState(task(1, { completed_at: ago(HOUR), due_at: ago(DAY) }), [], NOW)).toBe('overdue');
  });
});

describe('deriveItems', () => {
  test('builds one item per task with its own submissions', () => {
    const tasks = [task(1), task(2), task(3, { kind: 'task' })];
    const subs = [sub(10, 1, ago(2 * DAY), 'failed'), sub(11, 1, ago(DAY), 'ai_graded', draft('missing')), sub(20, 2, ago(DAY), 'pending')];
    const items = deriveItems(tasks, subs, NOW, { audience: 'staff' });
    expect(items).toHaveLength(3);
    const [a, b, c] = items;
    expect(a.task.id).toBe(1);
    expect(a.subs.map((s) => s.id)).toEqual([11, 10]);
    expect(a.latest.id).toBe(11);
    expect(a.grade).toEqual(draft('missing'));
    expect(a.attempts).toBe(2);
    expect(a.bucket).toBe('in-review');
    expect(a.dueState).toBe('done');
    expect(a.archiveReason).toBeNull();
    expect(a.previousResult).toBeNull();
    expect(a.extended).toBe(false);
    expect(b.attempts).toBe(1);
    expect(c.bucket).toBe('task');
    expect(c.latest).toBeNull();
    expect(c.grade).toBeNull();
  });

  test('families never receive an unreleased grade, even if one slips through', () => {
    const item = one(task(1), [sub(1, 1, ago(DAY), 'ai_graded', draft('completed'))], { audience: 'family' });
    expect(item.grade).toBeNull();
    expect(item.latest.grade).toBeNull();
    expect(item.bucket).toBe('in-review');
  });

  test('canSubmit: only when allowed, for assignments under the cap', () => {
    const subs = (n) => Array.from({ length: n }, (_, i) => sub(i + 1, 1, ago((i + 1) * HOUR), 'pending'));
    expect(one(task(1), subs(4), { audience: 'family', canSubmit: true }).canSubmit).toBe(true);
    expect(one(task(1), subs(5), { audience: 'family', canSubmit: true }).canSubmit).toBe(false);
    expect(one(task(1), [], { audience: 'family' }).canSubmit).toBe(false);
    expect(one(task(1, { kind: 'task' }), [], { audience: 'family', canSubmit: true }).canSubmit).toBe(false);
    const missed = task(1, { due_at: ago(40 * DAY) });
    expect(one(missed, [], { audience: 'family', canSubmit: true })).toMatchObject({ bucket: 'archived', canSubmit: true });
  });
});

describe('groupTodo', () => {
  test('overdue, today, next 7 days, later and no due date, empty groups omitted', () => {
    const tasks = [
      task(1, { due_at: '2026-10-15T06:59:00Z' }), // today 11:59 pm
      task(2, { due_at: '2026-10-16T06:59:00Z' }), // tomorrow
      task(3, { due_at: '2026-10-21T06:59:00Z' }), // today + 6
      task(4, { due_at: '2026-10-22T06:59:00Z' }), // today + 7
      task(5, { due_at: '2026-10-14T18:00:00Z' }), // earlier today
      task(6, { due_at: '2026-10-10T06:59:00Z' }), // days ago
      task(7),
      task(8, { due_at: '2026-10-14T22:00:00Z' }), // today 3 pm
      task(9, { due_at: ahead(DAY) }), // tomorrow noon
    ];
    tasks.push(task(10, { due_at: ahead(DAY) }));
    const items = deriveItems(tasks, [sub(1, 10, ago(HOUR), 'pending')], NOW, { audience: 'family' });
    const groups = groupTodo(items, NOW);
    expect(groups.map((g) => g.key)).toEqual(['overdue', 'today', 'next7', 'later', 'undated']);
    // An assignment past due with nothing handed in is Missing
    expect(groups.map((g) => g.label)).toEqual(['Missing', 'Today', 'Next 7 days', 'Later', 'No due date']);
    const ids = (key) => groups.find((g) => g.key === key).items.map((i) => i.task.id);
    expect(ids('overdue')).toEqual([6, 5]);
    expect(ids('today')).toEqual([8, 1]);
    expect(ids('next7')).toEqual([9, 2, 3]);
    expect(ids('later')).toEqual([4]);
    expect(ids('undated')).toEqual([7]);
    expect(groups.find((g) => g.key === 'undated').collapsed).toBe(true);
    expect(groups.find((g) => g.key === 'overdue').collapsed).toBe(false);
  });

  test('only overdue', () => {
    const items = deriveItems([task(1, { due_at: ago(HOUR) })], [], NOW, { audience: 'family' });
    expect(groupTodo(items, NOW).map((g) => g.key)).toEqual(['overdue']);
    expect(groupTodo([], NOW)).toEqual([]);
  });
});

describe('in review', () => {
  const tasks = [task(1), task(2), task(3), task(4), task(5), task(6), task(7)];
  const subs = [
    sub(1, 1, ago(3 * DAY), 'failed'),
    sub(2, 2, ago(5 * DAY), 'ai_graded', draft()),
    sub(3, 3, ago(2 * DAY), 'ai_graded', draft()),
    sub(4, 4, ago(4 * DAY), 'ai_graded', edited()),
    sub(5, 5, ago(HOUR), 'pending'),
    sub(6, 6, ago(2 * HOUR), 'grading'),
    sub(7, 7, ago(DAY), 'ai_graded', released(ago(HOUR))),
  ];

  test('staff: four groups in order, oldest submission first', () => {
    const groups = groupInReviewStaff(deriveItems(tasks, subs, NOW, { audience: 'staff' }));
    expect(groups.map((g) => g.key)).toEqual(['failed', 'draft', 'edited', 'grading']);
    expect(groups.map((g) => g.label)).toEqual(['Could not grade', 'Ready for review', 'Edited, not released', 'Grading now']);
    expect(groups.map((g) => g.items.map((i) => i.task.id))).toEqual([[1], [2, 3], [4], [6, 5]]);
    expect(groups.map((g) => g.collapsed)).toEqual([false, false, false, true]);
  });

  test('staff: a failed submission that was edited counts as edited', () => {
    const groups = groupInReviewStaff(deriveItems([task(1)], [sub(1, 1, ago(DAY), 'failed', edited())], NOW, { audience: 'staff' }));
    expect(groups.map((g) => g.key)).toEqual(['edited']);
  });

  test('families: one flat list, newest submission first', () => {
    const items = deriveItems(tasks, subs.map((s) => ({ ...s, grade: s.grade?.released_at ? s.grade : null })), NOW, { audience: 'family' });
    expect(inReviewFamily(items).map((i) => i.task.id)).toEqual([5, 6, 3, 1, 4, 2]);
  });
});

describe('groupGraded', () => {
  test('this week, then earlier, newest release first', () => {
    const tasks = [task(1), task(2), task(3), task(4)];
    const subs = [
      sub(1, 1, ago(30 * DAY), 'ai_graded', released(ago(7 * DAY))),
      sub(2, 2, ago(30 * DAY), 'ai_graded', released(ago(7 * DAY + 1))),
      sub(3, 3, ago(30 * DAY), 'ai_graded', released(ago(HOUR))),
      sub(4, 4, ago(30 * DAY), 'ai_graded', released(ago(20 * DAY))),
    ];
    const groups = groupGraded(deriveItems(tasks, subs, NOW, { audience: 'family' }), NOW);
    expect(groups.map((g) => [g.key, g.label])).toEqual([['week', 'This week'], ['earlier', 'Earlier']]);
    expect(groups.map((g) => g.items.map((i) => i.task.id))).toEqual([[3, 1], [2, 4]]);
  });

  test('empty groups omitted', () => {
    const items = deriveItems([task(1)], [sub(1, 1, ago(30 * DAY), 'ai_graded', released(ago(10 * DAY)))], NOW, { audience: 'family' });
    expect(groupGraded(items, NOW).map((g) => g.key)).toEqual(['earlier']);
  });
});

describe('groupArchived', () => {
  test('by Pacific month of release or due date, newest first', () => {
    const tasks = [
      task(1),
      task(2, { due_at: '2026-08-20T06:59:00Z' }),
      task(3),
      task(4, { due_at: '2026-09-01T06:59:00Z' }), // Aug 31 Pacific
      task(5),
    ];
    const subs = [
      sub(1, 1, ago(90 * DAY), 'ai_graded', released('2026-09-10T20:00:00Z')),
      sub(3, 3, ago(90 * DAY), 'ai_graded', released('2026-09-01T03:00:00Z')), // Aug 31 Pacific
      sub(5, 5, ago(90 * DAY), 'ai_graded', released('2026-09-20T20:00:00Z')),
    ];
    const groups = groupArchived(deriveItems(tasks, subs, NOW, { audience: 'family' }));
    expect(groups.map((g) => [g.key, g.label])).toEqual([['2026-09', 'September 2026'], ['2026-08', 'August 2026']]);
    expect(groups.map((g) => g.items.map((i) => i.task.id))).toEqual([[5, 1], [4, 3, 2]]);
  });
});

describe('groupTasks', () => {
  test('open tasks in due groups, then recent and older done', () => {
    const tasks = [
      task(1, { kind: 'task', due_at: ago(HOUR) }),
      task(2, { kind: 'task' }),
      task(3, { kind: 'task', completed_at: ago(DAY) }),
      task(4, { kind: 'task', completed_at: ago(14 * DAY) }),
      task(5, { kind: 'task', completed_at: ago(14 * DAY + 1) }),
      task(6, { kind: 'task', completed_at: ago(3 * DAY) }),
      task(7, { due_at: ago(HOUR) }), // an assignment, ignored
    ];
    const { open, doneRecent, doneOlder } = groupTasks(deriveItems(tasks, [], NOW, { audience: 'family' }), NOW);
    expect(open.map((g) => [g.key, g.items.map((i) => i.task.id)])).toEqual([['overdue', [1]], ['undated', [2]]]);
    expect(doneRecent.map((i) => i.task.id)).toEqual([3, 6, 4]);
    expect(doneOlder.map((i) => i.task.id)).toEqual([5]);
  });
});

describe('navCounts', () => {
  const tasks = [
    task(1, { due_at: ago(HOUR) }), task(2, { due_at: ahead(DAY) }), task(3),
    task(4), task(5), task(6), task(7),
    task(8, { kind: 'task' }), task(9, { kind: 'task', completed_at: ago(HOUR) }), task(10, { kind: 'task', due_at: ago(DAY) }),
  ];
  const subs = [
    sub(4, 4, ago(DAY), 'failed'),
    sub(5, 5, ago(DAY), 'ai_graded', draft()),
    sub(6, 6, ago(DAY), 'pending'),
    sub(7, 7, ago(DAY), 'ai_graded', edited()),
  ];

  test('families count every in-review row', () => {
    const familySubs = subs.map((s) => ({ ...s, grade: null }));
    expect(navCounts(deriveItems(tasks, familySubs, NOW, { audience: 'family' }), { audience: 'family' }))
      .toEqual({ todo: 3, todoOverdue: 1, inReview: 4, tasksOpen: 2 });
  });

  test('staff count only the three actionable groups', () => {
    expect(navCounts(deriveItems(tasks, subs, NOW, { audience: 'staff' }), { audience: 'staff' }))
      .toEqual({ todo: 3, todoOverdue: 1, inReview: 3, tasksOpen: 2 });
  });
});
