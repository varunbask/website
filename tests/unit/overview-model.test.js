import { describe, test, expect } from 'vitest';
import {
  greeting, studentLede, parentSummary, parentTitle, weekCounts, dueNext, overdueItems, comingUp,
  openTasks, gradedItems, weekStrip, stripLabel, chipStyle, shortDay, firstLine, lastUpdateLabel,
  completionWindow, completionMetric, onTimeMetric, dueMetric, reviewEntries, isOpen,
} from '../../portal/js/overview-model.js';
import { deriveItems } from '../../portal/js/buckets.js';
import { zonedIso } from '../../portal/js/dates.js';
import { queueOrder, attemptInfo } from '../../portal/js/review-model.js';

// Wednesday, October 14, 2026 at 12:00 pm Pacific
const NOW = new Date('2026-10-14T19:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms) => new Date(NOW.getTime() + ms).toISOString();
const dueOn = (key, time = '23:59') => zonedIso(key, time);

const task = (id, extra = {}) => ({
  id, student_id: 's1', kind: 'assignment', title: `Task ${id}`, details: '',
  due_at: null, completed_at: null, created_at: '2026-09-01T00:00:00Z', ...extra,
});
const sub = (id, taskId, createdAt, status = 'ai_graded', grade = null) => ({
  id, task_id: taskId, student_id: 's1', status, error: null, created_at: createdAt, grade,
});
const released = (at, result = 'completed', feedback = 'Good work') => ({ result, feedback, reviewed_at: at, released_at: at });
const items = (tasks, subs = [], audience = 'family') => deriveItems(tasks, subs, NOW, { audience });

describe('greeting', () => {
  test('uses the viewer local hour', () => {
    expect(greeting(new Date(2026, 9, 14, 5, 0), 'Maya')).toBe('Good morning, Maya');
    expect(greeting(new Date(2026, 9, 14, 11, 59), 'Maya')).toBe('Good morning, Maya');
    expect(greeting(new Date(2026, 9, 14, 12, 0), 'Maya')).toBe('Good afternoon, Maya');
    expect(greeting(new Date(2026, 9, 14, 16, 59), 'Maya')).toBe('Good afternoon, Maya');
    expect(greeting(new Date(2026, 9, 14, 17, 0), 'Maya')).toBe('Good evening, Maya');
    expect(greeting(new Date(2026, 9, 14, 4, 59), 'Maya')).toBe('Good evening, Maya');
    expect(greeting(new Date(2026, 9, 14, 0, 0), 'Maya')).toBe('Good evening, Maya');
  });

  test('no name, no comma, never an exclamation mark', () => {
    expect(greeting(new Date(2026, 9, 14, 9, 0))).toBe('Good morning');
    expect(greeting(new Date(2026, 9, 14, 9, 0), '  ')).toBe('Good morning');
    expect(greeting(new Date(2026, 9, 14, 9, 0), 'Maya')).not.toContain('!');
  });
});

describe('studentLede', () => {
  test('missing and due', () => {
    expect(studentLede({ overdue: 1, dueThisWeek: 2 })).toBe('1 assignment is missing and 2 are due this week.');
    expect(studentLede({ overdue: 2, dueThisWeek: 1 })).toBe('2 assignments are missing and 1 is due this week.');
  });

  test('missing only', () => {
    expect(studentLede({ overdue: 1 })).toBe('1 assignment is missing.');
    expect(studentLede({ overdue: 2 })).toBe('2 assignments are missing.');
  });

  test('due only', () => {
    expect(studentLede({ dueThisWeek: 2 })).toBe('2 assignments are due this week.');
    expect(studentLede({ dueThisWeek: 1 })).toBe('1 assignment is due this week.');
  });

  test('neither', () => {
    expect(studentLede({})).toBe('Nothing is due this week.');
    expect(studentLede({ overdue: 0, dueThisWeek: 0, newGrades: 0 })).toBe('Nothing is due this week.');
  });

  test('adds the new grades sentence', () => {
    expect(studentLede({ newGrades: 1 })).toBe('Nothing is due this week. 1 new grade is ready.');
    expect(studentLede({ overdue: 1, dueThisWeek: 2, newGrades: 2 }))
      .toBe('1 assignment is missing and 2 are due this week. 2 new grades are ready.');
  });

  test('names tasks by kind when there are any', () => {
    expect(studentLede({ dueThisWeek: 2, overdueTasks: 1 })).toBe('1 task is overdue and 2 assignments are due this week.');
    expect(studentLede({ overdueTasks: 1 })).toBe('1 task is overdue.');
    expect(studentLede({ overdue: 1, overdueTasks: 2 })).toBe('1 assignment is missing and 2 tasks are overdue.');
    expect(studentLede({ overdue: 1, overdueTasks: 1, dueThisWeek: 1 }))
      .toBe('1 assignment is missing and 1 task is overdue. 1 assignment is due this week.');
    expect(studentLede({ overdue: 2, tasksDueThisWeek: 1 })).toBe('2 assignments are missing and 1 task is due this week.');
    expect(studentLede({ dueThisWeek: 1, tasksDueThisWeek: 1 })).toBe('1 assignment and 1 task are due this week.');
    expect(studentLede({ dueThisWeek: 2, tasksDueThisWeek: 1, overdueTasks: 1 }))
      .toBe('1 task is overdue. 2 assignments and 1 task are due this week.');
  });
});

describe('parentSummary and parentTitle', () => {
  test('every template', () => {
    expect(parentSummary('Maya', { dueThisWeek: 2, overdue: 1 })).toBe('Maya has 2 assignments due this week and 1 missing.');
    expect(parentSummary('Maya', { dueThisWeek: 1, overdue: 3 })).toBe('Maya has 1 assignment due this week and 3 missing.');
    expect(parentSummary('Maya', { overdue: 1 })).toBe('Maya has 1 missing assignment.');
    expect(parentSummary('Maya', { overdue: 2 })).toBe('Maya has 2 missing assignments.');
    expect(parentSummary('Maya', { dueThisWeek: 2 })).toBe('Maya has 2 assignments due this week.');
    expect(parentSummary('Maya', { dueThisWeek: 1 })).toBe('Maya has 1 assignment due this week.');
    expect(parentSummary('Maya', {})).toBe('Maya is all caught up.');
  });

  test('names tasks by kind when there are any', () => {
    expect(parentSummary('Maya', { dueThisWeek: 2, overdueTasks: 1 })).toBe('Maya has 2 assignments due this week and 1 overdue task.');
    expect(parentSummary('Maya', { overdueTasks: 2 })).toBe('Maya has 2 overdue tasks.');
    expect(parentSummary('Maya', { tasksDueThisWeek: 1 })).toBe('Maya has 1 task due this week.');
    expect(parentSummary('Maya', { dueThisWeek: 2, tasksDueThisWeek: 1, overdue: 1, overdueTasks: 1 }))
      .toBe('Maya has 2 assignments and 1 task due this week, plus 1 missing assignment and 1 overdue task.');
    expect(parentSummary('Maya', { dueThisWeek: 2, overdue: 1, overdueTasks: 1 }))
      .toBe('Maya has 2 assignments due this week, 1 missing assignment and 1 overdue task.');
  });

  test('title uses a curly apostrophe', () => {
    expect(parentTitle('Maya')).toBe('Maya’s week');
  });
});

describe('weekCounts', () => {
  test('counts open work overdue and due in the rolling 7 days, by kind', () => {
    const list = items([
      task(1, { due_at: ago(2 * DAY) }),                    // overdue
      task(2, { due_at: ago(HOUR) }),                       // overdue earlier today
      task(3, { due_at: dueOn('2026-10-14') }),             // today
      task(4, { due_at: dueOn('2026-10-20') }),             // today + 6
      task(5, { due_at: dueOn('2026-10-21') }),             // today + 7: outside
      task(6, { due_at: null }),                            // undated
      task(7, { kind: 'task', due_at: dueOn('2026-10-15') }), // open task due tomorrow
      task(8, { due_at: dueOn('2026-10-15') }),             // submitted: not To do
      task(9, { kind: 'task', due_at: ago(3 * DAY) }),      // overdue task
      task(10, { kind: 'task', due_at: dueOn('2026-10-16'), completed_at: ago(HOUR) }), // done: not counted
      task(11, { kind: 'task', due_at: null }),             // undated task
    ], [sub(80, 8, ago(HOUR))]);
    expect(weekCounts(list, NOW)).toEqual({ overdue: 2, dueThisWeek: 2, overdueTasks: 1, tasksDueThisWeek: 1 });
  });

  test('agrees with the Overdue card and Coming up', () => {
    const list = items([
      task(1, { due_at: dueOn('2026-10-15') }),
      task(2, { kind: 'task', due_at: ago(3 * DAY) }),
      task(3, { kind: 'task', due_at: dueOn('2026-10-15') }),
    ]);
    const counts = weekCounts(list, NOW);
    expect(counts.overdue + counts.overdueTasks).toBe(overdueItems(list, { tasks: true }).length);
    const coming = comingUp(list, NOW).reduce((n, g) => n + g.items.length, 0);
    expect(counts.dueThisWeek + counts.tasksDueThisWeek).toBe(coming);
    expect(dueMetric(counts)).toMatchObject({ value: '2', line: '1 overdue', danger: true });
    expect(parentSummary('Maya', counts)).toBe('Maya has 1 assignment and 1 task due this week, plus 1 overdue task.');
  });

  test('the window follows the Pacific day, not UTC', () => {
    // 11:30 pm Pacific on Oct 20 is Oct 21 in UTC but still today + 6
    const list = items([task(1, { due_at: dueOn('2026-10-20', '23:30') })]);
    expect(weekCounts(list, NOW).dueThisWeek).toBe(1);
  });
});

describe('dueNext', () => {
  test('oldest overdue first, then soonest, undated last', () => {
    const list = items([
      task(1, { due_at: null }),
      task(2, { due_at: ahead(3 * DAY) }),
      task(3, { due_at: ago(DAY) }),
      task(4, { due_at: ago(5 * DAY) }),
      task(5, { due_at: ahead(DAY) }),
    ]);
    const { next, after } = dueNext(list);
    expect(next.task.id).toBe(4);
    expect(after.map((i) => i.task.id)).toEqual([3, 5]);
  });

  test('undated work comes after every dated item', () => {
    const list = items([task(1, { due_at: null }), task(2, { due_at: ahead(40 * DAY) })]);
    expect(dueNext(list).next.task.id).toBe(2);
    expect(dueNext(list).after.map((i) => i.task.id)).toEqual([1]);
  });

  test('skips tasks, submitted and archived work; empty gives null', () => {
    const list = items([
      task(1, { kind: 'task', due_at: ahead(DAY) }),
      task(2, { due_at: ahead(DAY) }),
      task(3, { due_at: ago(40 * DAY) }), // archived, not turned in
    ], [sub(20, 2, ago(HOUR))]);
    expect(dueNext(list)).toEqual({ next: null, after: [] });
  });
});

describe('lists', () => {
  const list = items([
    task(1, { due_at: ago(DAY) }),
    task(2, { kind: 'task', due_at: ago(2 * DAY) }),
    task(3, { due_at: dueOn('2026-10-15') }),
    task(4, { kind: 'task', due_at: dueOn('2026-10-15', '09:00') }),
    task(5, { due_at: dueOn('2026-10-25') }),
    task(6, { kind: 'task', completed_at: ago(HOUR), due_at: dueOn('2026-10-16') }),
    task(7, { kind: 'task', due_at: null }),
  ]);

  test('isOpen', () => {
    expect(list.map(isOpen)).toEqual([true, true, true, true, true, false, true]);
  });

  test('overdueItems: assignments by default, tasks on request', () => {
    expect(overdueItems(list).map((i) => i.task.id)).toEqual([1]);
    expect(overdueItems(list, { tasks: true }).map((i) => i.task.id)).toEqual([2, 1]);
  });

  test('comingUp groups open work by day with headings', () => {
    const groups = comingUp(list, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('2026-10-15');
    expect(groups[0].heading).toBe('Tomorrow, Thu Oct 15');
    expect(groups[0].items.map((i) => i.task.id)).toEqual([4, 3]);
  });

  test('openTasks: soonest first, undated last, capped', () => {
    expect(openTasks(list).map((i) => i.task.id)).toEqual([2, 4, 7]);
    expect(openTasks(list, 1).map((i) => i.task.id)).toEqual([2]);
  });

  test('gradedItems: newest release first; drafts and extensions never count', () => {
    const staffList = items([task(1), task(2), task(3), task(4, { due_at: ahead(3 * DAY) })], [
      sub(10, 1, ago(10 * DAY), 'ai_graded', released(ago(9 * DAY), 'missing')),
      sub(20, 2, ago(3 * DAY), 'ai_graded', released(ago(2 * DAY), 'completed')),
      sub(30, 3, ago(DAY), 'ai_graded', { result: 'completed', feedback: 'x', reviewed_at: null, released_at: null }),
      sub(40, 4, ago(DAY), 'ai_graded', released(ago(HOUR), 'extended')),
    ], 'staff');
    expect(gradedItems(staffList).map((i) => i.task.id)).toEqual([2, 1]);
  });
});

describe('weekStrip', () => {
  test('seven rolling days from today, business-zone keys', () => {
    const days = weekStrip([], '2026-10-14');
    expect(days.map((d) => d.key)).toEqual([
      '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20',
    ]);
    expect(days[0]).toMatchObject({ weekday: 'Wed', day: 14, month: 'Oct', ym: '2026-10', isToday: true });
    expect(days[1].isToday).toBe(false);
  });

  test('crosses a month end', () => {
    const days = weekStrip([], '2026-10-29');
    expect(days.at(-1)).toMatchObject({ key: '2026-11-04', ym: '2026-11', month: 'Nov', day: 4 });
  });

  test('places items on their Pacific day, open work first', () => {
    const list = items([
      task(1, { due_at: dueOn('2026-10-15', '10:00') }),
      task(2, { kind: 'task', due_at: dueOn('2026-10-15', '08:00'), completed_at: ago(HOUR) }),
      task(3, { due_at: dueOn('2026-10-15', '23:30') }),
      task(4, { due_at: dueOn('2026-10-22') }),
      task(5, { due_at: null }),
    ]);
    const days = weekStrip(list, '2026-10-14');
    expect(days[1].items.map((i) => i.task.id)).toEqual([1, 3, 2]);
    expect(days.flatMap((d) => d.items)).toHaveLength(3);
  });

  test('stripLabel wording', () => {
    const list = items([
      task(1, { title: 'Algebra worksheet', due_at: ago(HOUR) }),
      task(2, { kind: 'task', title: 'Read chapter 3', due_at: dueOn('2026-10-14'), completed_at: ago(HOUR) }),
    ]);
    const [today, tomorrow] = weekStrip(list, '2026-10-14');
    expect(stripLabel(today)).toBe('Wednesday, October 14, today. 2 items: Algebra worksheet, missing; Read chapter 3, done');
    expect(stripLabel(tomorrow)).toBe('Thursday, October 15. Nothing due.');
  });
});

describe('chipStyle', () => {
  test('maps statuses to chip variants and icons', () => {
    const list = items([
      task(1, { due_at: ago(HOUR) }),
      task(2, { due_at: ahead(HOUR) }),
      task(3, { due_at: ahead(5 * DAY) }),
      task(4, { due_at: ahead(DAY) }),
      task(5, { due_at: ahead(DAY) }),
      task(6, { kind: 'task', due_at: ahead(DAY), completed_at: ago(HOUR) }),
      task(7, { kind: 'task', due_at: ahead(5 * DAY) }),
    ], [
      sub(40, 4, ago(HOUR), 'pending'),
      sub(50, 5, ago(DAY), 'ai_graded', released(ago(HOUR))),
    ]);
    expect(list.map((i) => chipStyle(i))).toEqual([
      { variant: 'overdue', icon: 'warning-circle' },
      { variant: 'soon', icon: 'clipboard-text' },
      { variant: 'open', icon: 'clipboard-text' },
      { variant: 'submitted', icon: 'hourglass-medium' },
      { variant: 'graded', icon: 'check-circle' },
      { variant: 'done', icon: 'check-square' },
      { variant: 'open', icon: 'check-square' },
    ]);
  });

  test('results: Completed graded, Missing danger, Extended like due soon', () => {
    const list = items([
      task(1, { due_at: ahead(DAY) }),
      task(2, { due_at: ahead(DAY) }),
      task(3, { due_at: ahead(5 * DAY), extended_from: ago(DAY) }),
    ], [
      sub(10, 1, ago(DAY), 'ai_graded', released(ago(HOUR), 'completed')),
      sub(20, 2, ago(DAY), 'ai_graded', released(ago(HOUR), 'missing')),
      sub(30, 3, ago(DAY), 'ai_graded', released(ago(HOUR), 'extended')),
    ]);
    expect(list.map((i) => chipStyle(i))).toEqual([
      { variant: 'graded', icon: 'check-circle' },
      { variant: 'attention', icon: 'minus-circle' },
      { variant: 'soon', icon: 'clock' },
    ]);
  });
});

describe('text helpers', () => {
  test('shortDay adds the year only when it differs', () => {
    expect(shortDay('2026-10-05T19:00:00Z', NOW)).toBe('Oct 5');
    expect(shortDay('2025-09-02T19:00:00Z', NOW)).toBe('Sep 2, 2025');
    // 1:00 am UTC on Oct 6 is still Oct 5 in Pacific time
    expect(shortDay('2026-10-06T01:00:00Z', NOW)).toBe('Oct 5');
    expect(shortDay(null, NOW)).toBe('');
  });

  test('firstLine', () => {
    expect(firstLine('\n  Show your work.  \nThen check it.')).toBe('Show your work.');
    expect(firstLine('')).toBe('');
    expect(firstLine(null)).toBe('');
  });

  test('lastUpdateLabel uses the newest update', () => {
    expect(lastUpdateLabel([], NOW)).toBeNull();
    expect(lastUpdateLabel(null, NOW)).toBeNull();
    expect(lastUpdateLabel([{ created_at: ago(5 * DAY) }, { created_at: ago(2 * DAY) }], NOW).text).toBe('Last update 2 days ago');
    expect(lastUpdateLabel([{ created_at: ago(DAY) }], NOW).text).toBe('Last update yesterday');
    expect(lastUpdateLabel([{ created_at: ago(1000) }], NOW).text).toBe('Last update just now');
    expect(lastUpdateLabel([{ created_at: '2026-09-20T19:00:00Z' }], NOW).text).toBe('Last update Sep 20');
    expect(lastUpdateLabel([{ created_at: ago(2 * HOUR) }], NOW).iso).toBe(ago(2 * HOUR));
  });
});

describe('completionWindow', () => {
  const t = (id, extra = {}) => task(id, { due_at: ago(40 * DAY), ...extra });
  const s = (id, at, result) => sub(id, id, ago(41 * DAY), 'ai_graded', released(at, result));

  test('results decided in the last 30 days: released ones, and work never handed in', () => {
    const tasks = [t(1), t(2), t(3), t(4, { due_at: ago(2 * DAY) }), t(5), t(6, { due_at: ahead(DAY) })];
    const subs = [s(1, ago(DAY), 'completed'), s(2, ago(29 * DAY), 'missing'), s(3, ago(31 * DAY), 'completed')];
    // 1 completed, 2 missing (released), 4 missing (never handed in, due 2 days ago);
    // 3 released 31 days ago and 5 due 40 days ago fall outside; 6 is not due yet
    expect(completionWindow(tasks, subs, NOW)).toEqual({ completed: 1, missing: 2, total: 3, rate: 1 / 3, extended: 0 });
  });

  test('window edges: exactly 30 days is in, a moment more is out', () => {
    expect(completionWindow([t(1)], [s(1, ago(30 * DAY), 'completed')], NOW).completed).toBe(1);
    expect(completionWindow([t(1)], [s(1, ago(30 * DAY + 1), 'completed')], NOW).completed).toBe(0);
  });

  test('a release stamped a moment in the future still counts', () => {
    expect(completionWindow([t(1)], [s(1, ahead(2000), 'completed')], NOW).completed).toBe(1);
  });

  test('drafts never count; extensions are counted apart', () => {
    const tasks = [t(1), t(2, { due_at: ahead(2 * DAY) })];
    const subs = [
      sub(1, 1, ago(DAY), 'ai_graded', { result: 'completed', feedback: 'x', reviewed_at: null, released_at: null }),
      sub(2, 2, ago(DAY), 'ai_graded', released(ago(HOUR), 'extended')),
    ];
    expect(completionWindow(tasks, subs, NOW)).toEqual({ completed: 0, missing: 0, total: 0, rate: null, extended: 1 });
  });
});

describe('metrics', () => {
  test('completionMetric states', () => {
    const t = (id, extra = {}) => task(id, { due_at: ago(40 * DAY), ...extra });
    const s = (id, at, result) => sub(id, id, ago(41 * DAY), 'ai_graded', released(at, result));
    expect(completionMetric([], [], NOW)).toMatchObject({ value: 'No results yet', isText: true, line: null });
    expect(completionMetric([t(1, { due_at: ahead(DAY), extended_from: ago(DAY) })], [], NOW))
      .toMatchObject({ value: 'No results yet', line: '1 extended' });
    expect(completionMetric([t(1)], [s(1, ago(45 * DAY), 'completed')], NOW))
      .toMatchObject({ value: 'None this month', isText: true, line: 'Nothing missing' });
    expect(completionMetric([t(1), t(2), t(3)], [s(1, ago(DAY), 'completed'), s(2, ago(2 * DAY), 'completed'), s(3, ago(DAY), 'missing')], NOW))
      .toMatchObject({ value: '2', suffix: 'of 3', isText: false, line: '1 missing', danger: false });
    expect(completionMetric([t(1), t(2, { due_at: ahead(DAY) })], [s(1, ago(DAY), 'completed'), s(2, ago(HOUR), 'extended')], NOW))
      .toMatchObject({ value: '1', suffix: 'of 1', line: 'Nothing missing, 1 extended' });
  });

  test('onTimeMetric', () => {
    expect(onTimeMetric([], NOW)).toMatchObject({ value: 'Nothing due yet', isText: true });
    const tasks = [
      { due_at: ago(2 * DAY), completed_at: ago(3 * DAY) },   // on time
      { due_at: ago(2 * DAY), completed_at: ago(DAY) },       // late
      { due_at: ago(DAY), completed_at: null },               // missed
      { due_at: ahead(DAY), completed_at: null },             // not judged yet
    ];
    expect(onTimeMetric(tasks, NOW)).toMatchObject({ value: '1', suffix: 'of 3', line: 'finished by the due date' });
  });

  test('dueMetric', () => {
    expect(dueMetric({ dueThisWeek: 3, overdue: 1 })).toMatchObject({ value: '3', line: '1 overdue', danger: true });
    expect(dueMetric({ dueThisWeek: 0, overdue: 0 })).toMatchObject({ value: '0', line: 'Nothing overdue', danger: false });
    expect(dueMetric({ dueThisWeek: 2, overdue: 0, overdueTasks: 1, tasksDueThisWeek: 1 }))
      .toMatchObject({ value: '3', line: '1 overdue', danger: true });
  });
});

describe('reviewEntries', () => {
  const draft = { score: 80, feedback: 'x', reviewed_at: null, released_at: null };
  const edited = { score: 80, feedback: 'x', reviewed_at: ago(HOUR), released_at: null };

  test('groups in queue order, oldest first within a group', () => {
    const subs = [
      sub(1, 't1', ago(1 * DAY), 'ai_graded', draft),
      sub(2, 't2', ago(3 * DAY), 'ai_graded', draft),
      sub(3, 't3', ago(2 * DAY), 'failed', null),
      sub(4, 't4', ago(5 * DAY), 'ai_graded', edited),
      sub(5, 't5', ago(4 * DAY), 'failed', null),
      sub(6, 't6', ago(1 * DAY), 'pending', null),
      sub(7, 't7', ago(1 * DAY), 'ai_graded', released(ago(HOUR))),
    ];
    expect(reviewEntries(subs).map((e) => e.sub.id)).toEqual([5, 3, 2, 1, 4]);
  });

  test('attempt numbers count the older attempts', () => {
    const subs = [
      sub(11, 't1', ago(2 * DAY), 'ai_graded', draft),
      sub(10, 't1', ago(3 * DAY), 'ai_graded', released(ago(2.5 * DAY))),
    ];
    expect(reviewEntries(subs)).toEqual([{ sub: subs[0], attempt: 2, total: 5, newer: false }]);
  });

  test('a newer attempt takes an older attempt out of the queue', () => {
    const subs = [
      sub(12, 't1', ago(1 * DAY), 'pending', null),
      sub(11, 't1', ago(2 * DAY), 'ai_graded', draft),
    ];
    expect(reviewEntries(subs)).toEqual([]);
    const released12 = [sub(12, 't1', ago(1 * DAY), 'ai_graded', released(ago(HOUR))), subs[1]];
    expect(reviewEntries(released12)).toEqual([]);
  });

  test('same order and attempt numbers as the Review queue (review-model.js)', () => {
    const subs = [
      sub(21, 't1', ago(4 * DAY), 'ai_graded', draft),
      sub(22, 't1', ago(2 * DAY), 'failed', null),
      sub(23, 't2', ago(3 * DAY), 'ai_graded', edited),
      sub(24, 't2', ago(1 * DAY), 'ai_graded', draft),
    ];
    const entries = reviewEntries(subs);
    expect(entries.map((e) => e.sub.id)).toEqual(queueOrder(subs).map((s) => s.id));
    for (const e of entries) {
      const info = attemptInfo(e.sub, subs.filter((s) => s.task_id === e.sub.task_id));
      expect({ attempt: e.attempt, total: e.total, newer: e.newer }).toEqual({ attempt: info.n, total: info.total, newer: info.newer });
    }
  });

  test('empty input', () => {
    expect(reviewEntries([])).toEqual([]);
    expect(reviewEntries(null)).toEqual([]);
  });
});
