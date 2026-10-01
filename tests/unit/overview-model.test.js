import { describe, test, expect } from 'vitest';
import {
  greeting, studentLede, parentSummary, parentTitle, weekCounts, dueNext, overdueItems, comingUp,
  openTasks, gradedItems, weekStrip, stripLabel, chipStyle, shortDay, firstLine, lastUpdateLabel,
  scoreWindow, trendText, averageMetric, onTimeMetric, dueMetric, reviewEntries, isOpen,
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
const released = (at, score = 90, feedback = 'Good work') => ({ score, feedback, reviewed_at: at, released_at: at });
const items = (tasks, subs = [], audience = 'family') => deriveItems(tasks, subs, NOW, { audience });
const grade = (score, at) => ({ score, released_at: at });

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
  test('overdue and due', () => {
    expect(studentLede({ overdue: 1, dueThisWeek: 2 })).toBe('1 assignment is overdue and 2 are due this week.');
    expect(studentLede({ overdue: 2, dueThisWeek: 1 })).toBe('2 assignments are overdue and 1 is due this week.');
  });

  test('overdue only', () => {
    expect(studentLede({ overdue: 1 })).toBe('1 assignment is overdue.');
    expect(studentLede({ overdue: 2 })).toBe('2 assignments are overdue.');
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
      .toBe('1 assignment is overdue and 2 are due this week. 2 new grades are ready.');
  });

  test('names tasks by kind when there are any', () => {
    expect(studentLede({ dueThisWeek: 2, overdueTasks: 1 })).toBe('1 task is overdue and 2 assignments are due this week.');
    expect(studentLede({ overdueTasks: 1 })).toBe('1 task is overdue.');
    expect(studentLede({ overdue: 1, overdueTasks: 2 })).toBe('1 assignment and 2 tasks are overdue.');
    expect(studentLede({ dueThisWeek: 1, tasksDueThisWeek: 1 })).toBe('1 assignment and 1 task are due this week.');
    expect(studentLede({ dueThisWeek: 2, tasksDueThisWeek: 1, overdueTasks: 1 }))
      .toBe('1 task is overdue. 2 assignments and 1 task are due this week.');
  });
});

describe('parentSummary and parentTitle', () => {
  test('every template', () => {
    expect(parentSummary('Maya', { dueThisWeek: 2, overdue: 1 })).toBe('Maya has 2 assignments due this week and 1 overdue.');
    expect(parentSummary('Maya', { dueThisWeek: 1, overdue: 3 })).toBe('Maya has 1 assignment due this week and 3 overdue.');
    expect(parentSummary('Maya', { overdue: 1 })).toBe('Maya has 1 overdue assignment.');
    expect(parentSummary('Maya', { overdue: 2 })).toBe('Maya has 2 overdue assignments.');
    expect(parentSummary('Maya', { dueThisWeek: 2 })).toBe('Maya has 2 assignments due this week.');
    expect(parentSummary('Maya', { dueThisWeek: 1 })).toBe('Maya has 1 assignment due this week.');
    expect(parentSummary('Maya', {})).toBe('Maya is all caught up.');
  });

  test('names tasks by kind when there are any', () => {
    expect(parentSummary('Maya', { dueThisWeek: 2, overdueTasks: 1 })).toBe('Maya has 2 assignments due this week and 1 overdue task.');
    expect(parentSummary('Maya', { overdueTasks: 2 })).toBe('Maya has 2 overdue tasks.');
    expect(parentSummary('Maya', { tasksDueThisWeek: 1 })).toBe('Maya has 1 task due this week.');
    expect(parentSummary('Maya', { dueThisWeek: 2, tasksDueThisWeek: 1, overdue: 1, overdueTasks: 1 }))
      .toBe('Maya has 2 assignments and 1 task due this week, plus 1 overdue assignment and 1 overdue task.');
    expect(parentSummary('Maya', { dueThisWeek: 2, overdue: 1, overdueTasks: 1 }))
      .toBe('Maya has 2 assignments due this week, 1 overdue assignment and 1 overdue task.');
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

  test('gradedItems: newest release first, drafts never count', () => {
    const staffList = items([task(1), task(2), task(3)], [
      sub(10, 1, ago(10 * DAY), 'ai_graded', released(ago(9 * DAY), 80)),
      sub(20, 2, ago(3 * DAY), 'ai_graded', released(ago(2 * DAY), 95)),
      sub(30, 3, ago(DAY), 'ai_graded', { score: 70, feedback: 'x', reviewed_at: null, released_at: null }),
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
    expect(stripLabel(today)).toBe('Wednesday, October 14, today. 2 items: Algebra worksheet, overdue; Read chapter 3, done');
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

describe('scoreWindow', () => {
  test('averages the last 30 days and compares with the 30 before', () => {
    const w = scoreWindow([
      grade(90, ago(DAY)),
      grade(81, ago(29 * DAY)),
      grade(80, ago(31 * DAY)),
      grade(70, ago(59 * DAY)),
      grade(10, ago(61 * DAY)),
    ], NOW);
    expect(w).toEqual({ avg: 86, prevAvg: 75, delta: 11, count: 2, total: 5, lastAt: ago(DAY) });
  });

  test('window edges: exactly 30 days is current, exactly 60 is previous', () => {
    const w = scoreWindow([grade(80, ago(30 * DAY)), grade(60, ago(60 * DAY))], NOW);
    expect(w.avg).toBe(80);
    expect(w.prevAvg).toBe(60);
    const past = scoreWindow([grade(80, ago(30 * DAY + 1)), grade(60, ago(60 * DAY + 1))], NOW);
    expect(past.avg).toBeNull();
    expect(past.prevAvg).toBe(80);
  });

  test('a release stamped a moment in the future still counts', () => {
    expect(scoreWindow([grade(88, ahead(2000))], NOW).avg).toBe(88);
  });

  test('only released numeric scores count', () => {
    const w = scoreWindow([
      { score: 100, released_at: null },
      { score: null, released_at: ago(DAY) },
      { score: '72', released_at: ago(DAY) },
    ], NOW);
    expect(w).toMatchObject({ avg: 72, count: 1, total: 1 });
  });

  test('no previous window gives no delta; no grades gives nulls', () => {
    expect(scoreWindow([grade(90, ago(DAY))], NOW)).toMatchObject({ prevAvg: null, delta: null, count: 1 });
    expect(scoreWindow([], NOW)).toEqual({ avg: null, prevAvg: null, delta: null, count: 0, total: 0, lastAt: null });
  });

  test('delta compares the rounded averages', () => {
    const w = scoreWindow([grade(85.4, ago(DAY)), grade(84.6, ago(40 * DAY))], NOW);
    expect(w).toMatchObject({ avg: 85, prevAvg: 85, delta: 0 });
  });
});

describe('metrics', () => {
  test('trendText', () => {
    expect(trendText(4)).toBe('Up 4 from the 30 days before');
    expect(trendText(-3)).toBe('Down 3 from the 30 days before');
    expect(trendText(0)).toBe('Same as the 30 days before');
  });

  test('averageMetric states', () => {
    expect(averageMetric([], NOW)).toMatchObject({ value: 'No grades yet', isText: true, line: null });
    expect(averageMetric([grade(90, '2026-09-02T19:00:00Z')], NOW))
      .toMatchObject({ value: 'None this month', isText: true, line: 'Last grade Sep 2' });
    expect(averageMetric([grade(90, ago(DAY)), grade(86, ago(40 * DAY))], NOW))
      .toMatchObject({ value: '90', isText: false, line: 'Up 4 from the 30 days before', trend: 'up' });
    expect(averageMetric([grade(83, ago(DAY)), grade(86, ago(40 * DAY))], NOW))
      .toMatchObject({ value: '83', line: 'Down 3 from the 30 days before', trend: 'down' });
    expect(averageMetric([grade(86, ago(DAY)), grade(86, ago(40 * DAY))], NOW))
      .toMatchObject({ line: 'Same as the 30 days before', trend: null });
    expect(averageMetric([grade(90, ago(DAY)), grade(80, ago(2 * DAY)), grade(70, ago(3 * DAY))], NOW))
      .toMatchObject({ value: '80', line: 'Based on 3 grades' });
    expect(averageMetric([grade(90, ago(DAY))], NOW)).toMatchObject({ line: 'Based on 1 grade' });
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
