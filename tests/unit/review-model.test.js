import { describe, test, expect } from 'vitest';
import {
  FILTERS, FILTER_LABELS, normalizeFilter, needsReview, reviewGroupOf, queueGroups, queueOrder,
  filterCounts, stillGrading, waitingLabel, attemptInfo, neighbors, recentlyReleased, todayLede,
  pendingLabel, dueThisWeek, stampLabel, dateLabel, reviewHref, subsByTask, validateGrade,
} from '../../portal/js/review-model.js';
import { needsReview as appNeedsReview } from '../../portal/js/app-model.js';
import { deriveItems, MAX_SUBMISSIONS } from '../../portal/js/buckets.js';

// Wednesday, October 14, 2026 at 12:00 pm Pacific
const NOW = new Date('2026-10-14T19:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms) => new Date(NOW.getTime() + ms).toISOString();

const sub = (id, extra = {}) => ({
  id, task_id: id, student_id: 's1', status: 'ai_graded', error: null,
  created_at: ago(DAY), status_changed_at: ago(DAY), grade: null, ...extra,
});
const grade = ({ reviewed = false, released = false, score = 84 } = {}) => ({
  score, feedback: 'ok', reviewed_at: reviewed ? ago(HOUR) : null, released_at: released ? ago(HOUR) : null,
});

const STATUSES = ['pending', 'grading', 'ai_graded', 'failed'];

// Every combination of status, reviewed_at and released_at (plus a missing grade row)
function everyCombination() {
  const out = [];
  let id = 1;
  for (const status of STATUSES) {
    out.push(sub(id++, { status, grade: null }));
    for (const reviewed of [false, true]) {
      for (const released of [false, true]) {
        out.push(sub(id++, { status, grade: grade({ reviewed, released }) }));
      }
    }
  }
  return out;
}

describe('filters', () => {
  test('four filters in the spec order with their labels', () => {
    expect(FILTERS).toEqual(['all', 'draft', 'failed', 'edited']);
    expect(FILTERS.map((f) => FILTER_LABELS[f])).toEqual(['All', 'Draft ready', 'Could not grade', 'Edited']);
  });

  test('normalizeFilter falls back to all', () => {
    expect(normalizeFilter('draft')).toBe('draft');
    expect(normalizeFilter('edited')).toBe('edited');
    expect(normalizeFilter(undefined)).toBe('all');
    expect(normalizeFilter('nonsense')).toBe('all');
    expect(normalizeFilter('')).toBe('all');
  });
});

describe('needsReview', () => {
  test('AI-graded or failed work with no released grade', () => {
    expect(needsReview(sub(1, { status: 'ai_graded' }))).toBe(true);
    expect(needsReview(sub(1, { status: 'failed' }))).toBe(true);
    expect(needsReview(sub(1, { status: 'ai_graded', grade: grade({ reviewed: true }) }))).toBe(true);
    expect(needsReview(sub(1, { status: 'ai_graded', grade: grade({ released: true }) }))).toBe(false);
    expect(needsReview(sub(1, { status: 'pending' }))).toBe(false);
    expect(needsReview(sub(1, { status: 'grading' }))).toBe(false);
    expect(needsReview(null)).toBe(false);
  });

  test('tolerates the grade embed as an array', () => {
    expect(needsReview(sub(1, { grade: [grade({ released: true })] }))).toBe(false);
    expect(needsReview(sub(1, { grade: [grade()] }))).toBe(true);
  });

  test('agrees with the nav badge count in app-model for every combination', () => {
    for (const s of everyCombination()) expect(needsReview(s)).toBe(appNeedsReview(s));
  });
});

describe('queueGroups', () => {
  test('the needsReview partition equals the three groups for every combination', () => {
    const all = everyCombination();
    const groups = queueGroups(all, 'all');
    const grouped = groups.flatMap((g) => g.items.map((s) => s.id)).sort((a, b) => a - b);
    const expected = all.filter(needsReview).map((s) => s.id).sort((a, b) => a - b);
    expect(grouped).toEqual(expected);
    // no submission appears twice
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const s of all) {
      expect(reviewGroupOf(s) !== null).toBe(needsReview(s));
    }
  });

  test('groups follow staffStatus: edited wins over failed, failed over draft', () => {
    expect(reviewGroupOf(sub(1, { status: 'failed' }))).toBe('failed');
    expect(reviewGroupOf(sub(1, { status: 'failed', grade: grade({ reviewed: true }) }))).toBe('edited');
    expect(reviewGroupOf(sub(1, { status: 'ai_graded' }))).toBe('draft');
    expect(reviewGroupOf(sub(1, { status: 'ai_graded', grade: grade({ reviewed: true }) }))).toBe('edited');
    expect(reviewGroupOf(sub(1, { status: 'pending' }))).toBe(null);
  });

  test('groups in order Could not grade, Draft ready, Edited; empty ones omitted', () => {
    const subs = [
      sub(1, { status: 'ai_graded', grade: grade({ reviewed: true }) }),
      sub(2, { status: 'ai_graded', grade: grade() }),
      sub(3, { status: 'failed' }),
    ];
    expect(queueGroups(subs).map((g) => [g.key, g.label])).toEqual([
      ['failed', 'Could not grade'], ['draft', 'Draft ready'], ['edited', 'Edited, not released'],
    ]);
    expect(queueGroups([subs[1]]).map((g) => g.key)).toEqual(['draft']);
    expect(queueGroups([])).toEqual([]);
  });

  test('oldest submission first within a group, ties by the lower id', () => {
    const subs = [
      sub(5, { created_at: ago(HOUR) }),
      sub(6, { created_at: ago(3 * DAY) }),
      sub(8, { created_at: ago(DAY) }),
      sub(7, { created_at: ago(DAY) }),
    ];
    expect(queueGroups(subs)[0].items.map((s) => s.id)).toEqual([6, 7, 8, 5]);
  });

  test('a filter keeps only its group', () => {
    const subs = [
      sub(1, { status: 'failed' }),
      sub(2, { status: 'ai_graded' }),
      sub(3, { status: 'ai_graded', grade: grade({ reviewed: true }) }),
    ];
    expect(queueGroups(subs, 'failed').map((g) => g.key)).toEqual(['failed']);
    expect(queueGroups(subs, 'draft').map((g) => g.key)).toEqual(['draft']);
    expect(queueGroups(subs, 'edited').map((g) => g.key)).toEqual(['edited']);
    expect(queueGroups(subs, 'bogus').map((g) => g.key)).toEqual(['failed', 'draft', 'edited']);
    expect(queueGroups([subs[0]], 'draft')).toEqual([]);
  });

  test('queueOrder flattens the groups in order', () => {
    const subs = [
      sub(1, { status: 'ai_graded', created_at: ago(5 * DAY) }),
      sub(2, { status: 'failed', created_at: ago(HOUR) }),
      sub(3, { status: 'ai_graded', grade: grade({ reviewed: true }), created_at: ago(9 * DAY) }),
      sub(4, { status: 'ai_graded', created_at: ago(2 * DAY) }),
    ];
    expect(queueOrder(subs).map((s) => s.id)).toEqual([2, 1, 4, 3]);
    expect(queueOrder(subs, 'draft').map((s) => s.id)).toEqual([1, 4]);
  });

  test('only the newest attempt for each task is in the queue', () => {
    const subs = [
      sub(1, { task_id: 7, created_at: ago(2 * DAY) }),
      sub(2, { task_id: 7, created_at: ago(DAY), grade: grade({ reviewed: true, released: true }) }),
      sub(3, { task_id: 8, created_at: ago(2 * DAY), status: 'failed' }),
      sub(4, { task_id: 8, created_at: ago(DAY) }),
    ];
    expect(queueOrder(subs).map((s) => s.id)).toEqual([4]);
    expect(filterCounts(subs)).toEqual({ all: 1, draft: 1, failed: 0, edited: 0 });
  });

  test('filterCounts counts each group and their total', () => {
    const subs = [
      ...everyCombination(),
      sub(90, { status: 'ai_graded' }),
    ];
    const counts = filterCounts(subs);
    expect(counts.all).toBe(subs.filter(needsReview).length);
    expect(counts.failed + counts.draft + counts.edited).toBe(counts.all);
    expect(counts.draft).toBe(queueOrder(subs, 'draft').length);
    expect(counts.failed).toBe(queueOrder(subs, 'failed').length);
    expect(counts.edited).toBe(queueOrder(subs, 'edited').length);
  });
});

describe('stillGrading', () => {
  test('pending and grading work with no released grade, oldest first', () => {
    const subs = [
      sub(1, { status: 'pending', created_at: ago(HOUR) }),
      sub(2, { status: 'grading', created_at: ago(DAY) }),
      sub(3, { status: 'ai_graded' }),
      sub(4, { status: 'failed' }),
      sub(5, { status: 'grading', grade: grade({ released: true }) }),
    ];
    expect(stillGrading(subs).map((s) => s.id)).toEqual([2, 1]);
    expect(stillGrading([])).toEqual([]);
    expect(stillGrading(undefined)).toEqual([]);
  });
});

describe('waitingLabel', () => {
  const at = (ms) => sub(1, { created_at: ago(ms) });
  test('minutes, hours and days, singular and plural', () => {
    expect(waitingLabel(at(10 * 1000), NOW).text).toBe('Waiting 1 minute');
    expect(waitingLabel(at(5 * MIN), NOW).text).toBe('Waiting 5 minutes');
    expect(waitingLabel(at(HOUR), NOW).text).toBe('Waiting 1 hour');
    expect(waitingLabel(at(23 * HOUR), NOW).text).toBe('Waiting 23 hours');
    expect(waitingLabel(at(DAY), NOW).text).toBe('Waiting 1 day');
    expect(waitingLabel(at(2 * DAY + 5 * HOUR), NOW).text).toBe('Waiting 2 days');
  });

  test('warning tone only after 48 hours', () => {
    expect(waitingLabel(at(47 * HOUR), NOW).tone).toBe(null);
    expect(waitingLabel(at(48 * HOUR), NOW).tone).toBe(null);
    expect(waitingLabel(at(48 * HOUR + 1), NOW).tone).toBe('warning');
    expect(waitingLabel(at(10 * DAY), NOW).tone).toBe('warning');
  });

  test('a clock slightly behind the server never shows a negative wait', () => {
    expect(waitingLabel(sub(1, { created_at: ahead(MIN) }), NOW).text).toBe('Waiting 1 minute');
  });

  test('full text for the title attribute', () => {
    const label = waitingLabel(sub(1, { created_at: '2026-10-12T23:12:00Z' }), NOW, { viewerInZone: true });
    expect(label.full).toBe('Submitted Oct 12 at 4:12 pm');
  });
});

describe('attemptInfo', () => {
  const taskSubs = [
    sub(3, { created_at: ago(HOUR) }),
    sub(1, { created_at: ago(3 * DAY) }),
    sub(2, { created_at: ago(DAY) }),
  ];
  test('position among the task’s submissions, oldest is attempt 1', () => {
    expect(attemptInfo(taskSubs[1], taskSubs)).toEqual({ n: 1, total: MAX_SUBMISSIONS, newer: true });
    expect(attemptInfo(taskSubs[2], taskSubs)).toEqual({ n: 2, total: MAX_SUBMISSIONS, newer: true });
    expect(attemptInfo(taskSubs[0], taskSubs)).toEqual({ n: 3, total: MAX_SUBMISSIONS, newer: false });
  });

  test('matches by id as a string or number', () => {
    expect(attemptInfo({ id: '2' }, taskSubs).n).toBe(2);
  });

  test('a submission missing from the list counts as the newest', () => {
    const lone = sub(9, { created_at: NOW.toISOString() });
    expect(attemptInfo(lone, taskSubs)).toEqual({ n: 4, total: MAX_SUBMISSIONS, newer: false });
    expect(attemptInfo(lone, [])).toEqual({ n: 1, total: MAX_SUBMISSIONS, newer: false });
    expect(attemptInfo(lone, undefined)).toEqual({ n: 1, total: MAX_SUBMISSIONS, newer: false });
  });
});

describe('neighbors', () => {
  const queue = [{ id: 10 }, { id: 11 }, { id: 12 }];
  test('middle', () => {
    expect(neighbors(queue, 11)).toEqual({ index: 1, total: 3, prevId: 10, nextId: 12 });
  });
  test('first has no previous, last has no next', () => {
    expect(neighbors(queue, 10)).toEqual({ index: 0, total: 3, prevId: null, nextId: 11 });
    expect(neighbors(queue, '12')).toEqual({ index: 2, total: 3, prevId: 11, nextId: null });
  });
  test('a single item and an id that is not queued', () => {
    expect(neighbors([{ id: 5 }], 5)).toEqual({ index: 0, total: 1, prevId: null, nextId: null });
    expect(neighbors(queue, 99)).toEqual({ index: -1, total: 3, prevId: null, nextId: null });
    expect(neighbors([], 1)).toEqual({ index: -1, total: 0, prevId: null, nextId: null });
  });
  test('accepts plain ids too', () => {
    expect(neighbors([1, 2, 3], 2)).toEqual({ index: 1, total: 3, prevId: 1, nextId: 3 });
  });
});

describe('recentlyReleased', () => {
  const rel = (id, at) => sub(id, { grade: { score: 90, released_at: at, reviewed_at: at } });
  test('within 14 days, newest release first, at most 5', () => {
    const subs = [
      rel(1, ago(DAY)),
      rel(2, ago(3 * HOUR)),
      rel(3, ago(14 * DAY + MIN)),
      rel(4, ago(14 * DAY)),
      sub(5, { grade: grade() }),
      rel(6, ago(2 * DAY)),
      rel(7, ago(3 * DAY)),
      rel(8, ago(4 * DAY)),
    ];
    expect(recentlyReleased(subs, NOW).map((s) => s.id)).toEqual([2, 1, 6, 7, 8]);
    expect(recentlyReleased(subs, NOW, { limit: 10 }).map((s) => s.id)).toEqual([2, 1, 6, 7, 8, 4]);
    expect(recentlyReleased(subs, NOW, { days: 1 }).map((s) => s.id)).toEqual([2, 1]);
  });
});

describe('copy', () => {
  test('Today lede', () => {
    expect(todayLede(0, 0)).toBe('Nothing needs review right now.');
    expect(todayLede(1, 1)).toBe('1 submission needs review.');
    expect(todayLede(2, 1)).toBe('2 submissions from 1 student need review.');
    expect(todayLede(4, 3)).toBe('4 submissions need review across 3 students.');
  });

  test('pending sign-ups', () => {
    expect(pendingLabel(1)).toBe('1 person is waiting for approval');
    expect(pendingLabel(3)).toBe('3 people are waiting for approval');
  });

  test('stampLabel', () => {
    expect(stampLabel('2026-10-06T23:12:00Z', NOW, { viewerInZone: true })).toBe('Oct 6 at 4:12 pm');
    expect(stampLabel('2026-10-06T23:12:00Z', NOW, { viewerInZone: false })).toBe('Oct 6 at 4:12 pm PT');
    expect(stampLabel('2025-12-31T20:05:00Z', NOW, { viewerInZone: true })).toBe('Dec 31, 2025 at 12:05 pm');
    expect(stampLabel(null, NOW)).toBe('');
  });

  test('dateLabel', () => {
    expect(dateLabel('2026-10-06T23:12:00Z', NOW)).toBe('Oct 6');
    // 11:30 pm Pacific on Oct 5 is already Oct 6 in UTC
    expect(dateLabel('2026-10-06T06:30:00Z', NOW)).toBe('Oct 5');
    expect(dateLabel('2025-12-31T20:05:00Z', NOW)).toBe('Dec 31, 2025');
    expect(dateLabel(null, NOW)).toBe('');
  });

  test('no em or en dashes in any label', () => {
    const text = [
      todayLede(4, 3), pendingLabel(2), waitingLabel(sub(1), NOW).text, ...Object.values(FILTER_LABELS),
      ...queueGroups(everyCombination()).map((g) => g.label),
    ].join(' ');
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('reviewHref', () => {
  test('keeps a non-default filter only', () => {
    expect(reviewHref(12)).toBe('#/review/12');
    expect(reviewHref(12, 'all')).toBe('#/review/12');
    expect(reviewHref(12, 'draft')).toBe('#/review/12?filter=draft');
    expect(reviewHref(12, 'junk')).toBe('#/review/12');
  });
});

describe('subsByTask', () => {
  test('groups by task id', () => {
    const map = subsByTask([sub(1, { task_id: 7 }), sub(2, { task_id: 8 }), sub(3, { task_id: 7 })]);
    expect(map.get(7).map((s) => s.id)).toEqual([1, 3]);
    expect(map.get(8).map((s) => s.id)).toEqual([2]);
  });
});

describe('validateGrade', () => {
  test('draft: score optional but in range, feedback optional', () => {
    expect(validateGrade({ score: '', feedback: 'x' }, { release: false })).toEqual({ ok: true, values: { score: null, feedback: 'x' }, errors: {} });
    expect(validateGrade({ score: '70', feedback: '' }, { release: false })).toEqual({ ok: true, values: { score: 70, feedback: null }, errors: {} });
    expect(validateGrade({ score: ' 86.5 ', feedback: ' Nice ' }, { release: false }).values).toEqual({ score: 86.5, feedback: 'Nice' });
    expect(validateGrade({ score: '101', feedback: '' }, { release: false }).errors).toEqual({ score: 'Enter a score from 0 to 100.' });
    expect(validateGrade({ score: 'abc', feedback: '' }, { release: false }).ok).toBe(false);
    expect(validateGrade({ score: '-1', feedback: '' }, { release: false }).ok).toBe(false);
  });

  test('draft: a blank score and blank feedback do not save', () => {
    expect(validateGrade({ score: '', feedback: '' }, { release: false })).toEqual({
      ok: false, values: { score: null, feedback: null }, errors: { score: 'Enter a score or feedback before you save.' },
    });
    expect(validateGrade({ score: ' ', feedback: '  ' }, { release: false }).ok).toBe(false);
  });

  test('release: score 0 to 100 and feedback required', () => {
    expect(validateGrade({ score: '', feedback: 'x' }, { release: true }).errors).toEqual({ score: 'Enter a score from 0 to 100.' });
    expect(validateGrade({ score: '90', feedback: '  ' }, { release: true }).errors).toEqual({ feedback: 'Write feedback before releasing.' });
    expect(validateGrade({ score: '', feedback: '' }, { release: true }).errors).toEqual({
      score: 'Enter a score from 0 to 100.', feedback: 'Write feedback before releasing.',
    });
    expect(validateGrade({ score: '0', feedback: 'x' }, { release: true }).ok).toBe(true);
    expect(validateGrade({ score: '100', feedback: 'x' }, { release: true }).ok).toBe(true);
  });
});

describe('dueThisWeek', () => {
  const t = (id, extra = {}) => ({
    id, student_id: 's1', kind: 'assignment', title: `T${id}`, due_at: null, completed_at: null,
    created_at: '2026-09-01T00:00:00Z', ...extra,
  });
  test('open items due today through today plus 6 days, soonest first', () => {
    const tasks = [
      t(1, { due_at: ahead(3 * DAY) }),
      t(2, { due_at: ahead(2 * HOUR) }),
      t(3, { due_at: ahead(8 * DAY) }),             // too late
      t(4, { due_at: ago(2 * DAY) }),               // overdue from an earlier day
      t(5, { due_at: ahead(DAY) }),                 // submitted, so done
      t(6, { kind: 'task', due_at: ahead(2 * DAY) }),
      t(7, { kind: 'task', due_at: ahead(2 * DAY), completed_at: ago(HOUR) }),
      t(8),                                          // undated
      t(9, { due_at: '2026-10-21T06:59:00.000Z' }),  // Oct 20, 11:59 pm Pacific: today + 6 counts
      t(10, { due_at: '2026-10-22T06:59:00.000Z' }), // Oct 21: today + 7 does not
    ];
    const subs = [{ id: 1, task_id: 5, student_id: 's1', status: 'pending', created_at: ago(HOUR), grade: null }];
    const items = deriveItems(tasks, subs, NOW, { audience: 'staff' });
    expect(dueThisWeek(items, NOW).map((i) => i.task.id)).toEqual([2, 6, 1, 9]);
  });
});
