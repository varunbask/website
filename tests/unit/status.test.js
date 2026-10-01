import { describe, test, expect } from 'vitest';
import { TONE_OF, itemStatus, submissionStatus } from '../../portal/js/status.js';
import { deriveItems } from '../../portal/js/buckets.js';

const NOW = new Date('2026-10-14T19:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms) => new Date(NOW.getTime() + ms).toISOString();

const task = (extra = {}) => ({ id: 1, kind: 'assignment', title: 'A', due_at: null, completed_at: null, created_at: ago(40 * DAY), ...extra });
const sub = (status, grade = null, extra = {}) => ({ id: 1, task_id: 1, status, error: null, created_at: ago(HOUR), grade, ...extra });
const draft = { score: 84, feedback: 'x', reviewed_at: null, released_at: null };
const edited = { score: 84, feedback: 'x', reviewed_at: ago(HOUR), released_at: null };
const released = (at) => ({ score: 90, feedback: 'x', reviewed_at: at, released_at: at });

// Derives the item the way the store does, then asks for its status
function status(t, subs, audience) {
  const [item] = deriveItems([t], subs, NOW, { audience });
  return itemStatus(item, { audience });
}
const pick = ({ key, label, tone, icon, dashed }) => ({ key, label, tone, icon, dashed });
const both = (t, subs) => ({ family: pick(status(t, subs, 'family')), staff: pick(status(t, subs, 'staff')) });

describe('TONE_OF', () => {
  test('maps labels.js tones to status tones', () => {
    expect(TONE_OF).toEqual({ done: 'success', wait: 'info', draft: 'warning', alert: 'danger' });
  });
});

describe('itemStatus, every row of the table', () => {
  test('to do: upcoming or undated', () => {
    const want = { key: 'todo', label: 'To do', tone: 'neutral', icon: 'circle', dashed: false };
    expect(both(task(), [])).toEqual({ family: want, staff: want });
    expect(both(task({ due_at: ahead(5 * DAY) }), [])).toEqual({ family: want, staff: want });
  });

  test('to do: due soon', () => {
    const want = { key: 'soon', label: 'Due soon', tone: 'warning', icon: 'clock', dashed: false };
    expect(both(task({ due_at: ahead(DAY) }), [])).toEqual({ family: want, staff: want });
  });

  test('to do: overdue', () => {
    const want = { key: 'overdue', label: 'Overdue', tone: 'danger', icon: 'warning-circle', dashed: false };
    expect(both(task({ due_at: ago(DAY) }), [])).toEqual({ family: want, staff: want });
  });

  test('in review: pending or grading', () => {
    const family = { key: 'submitted', label: 'Submitted', tone: 'info', icon: 'hourglass-medium', dashed: false };
    expect(both(task(), [sub('pending')])).toEqual({ family, staff: family });
    expect(both(task(), [sub('grading')])).toEqual({
      family, staff: { key: 'grading', label: 'Grading', tone: 'info', icon: 'hourglass-medium', dashed: false },
    });
  });

  test('in review: AI draft', () => {
    expect(pick(status(task(), [sub('ai_graded', null)], 'family')))
      .toEqual({ key: 'submitted', label: 'Submitted', tone: 'info', icon: 'hourglass-medium', dashed: false });
    expect(both(task(), [sub('ai_graded', draft)])).toEqual({
      family: { key: 'submitted', label: 'Submitted', tone: 'info', icon: 'hourglass-medium', dashed: false },
      staff: { key: 'draft', label: 'AI draft', tone: 'warning', icon: 'pencil-simple-line', dashed: true },
    });
  });

  test('in review: reviewed, not released', () => {
    expect(both(task(), [sub('ai_graded', edited)])).toEqual({
      family: { key: 'submitted', label: 'Submitted', tone: 'info', icon: 'hourglass-medium', dashed: false },
      staff: { key: 'edited', label: 'Edited, not released', tone: 'warning', icon: 'note-pencil', dashed: true },
    });
  });

  test('in review: failed', () => {
    const couldNot = { key: 'failed', label: 'Could not grade', tone: 'danger', icon: 'x-circle', dashed: false };
    expect(both(task(), [sub('failed', null, { error: 'This PDF has no readable text.' })])).toEqual({
      family: { key: 'needs-attention', label: 'Needs attention', tone: 'danger', icon: 'x-circle', dashed: false },
      staff: couldNot,
    });
    expect(both(task(), [sub('failed')])).toEqual({
      family: { key: 'submitted', label: 'Submitted', tone: 'info', icon: 'hourglass-medium', dashed: false },
      staff: couldNot,
    });
  });

  test('graded', () => {
    expect(both(task(), [sub('ai_graded', released(ago(DAY)))])).toEqual({
      family: { key: 'graded', label: 'Graded', tone: 'success', icon: 'check-circle', dashed: false },
      staff: { key: 'graded', label: 'Released', tone: 'success', icon: 'check-circle', dashed: false },
    });
  });

  test('archived, graded: success pill, neutral archive glyph', () => {
    const subs = [sub('ai_graded', released(ago(30 * DAY)))];
    expect(both(task(), subs)).toEqual({
      family: { key: 'graded', label: 'Graded', tone: 'success', icon: 'check-circle', dashed: false },
      staff: { key: 'graded', label: 'Released', tone: 'success', icon: 'check-circle', dashed: false },
    });
    expect(status(task(), subs, 'family').glyph).toEqual({ icon: 'archive', tone: 'neutral' });
  });

  test('archived, missed', () => {
    const want = { key: 'not-turned-in', label: 'Not turned in', tone: 'neutral', icon: 'minus-circle', dashed: false };
    const t = task({ due_at: ago(31 * DAY) });
    expect(both(t, [])).toEqual({ family: want, staff: want });
    expect(status(t, [], 'staff').glyph).toEqual({ icon: 'archive', tone: 'neutral' });
  });

  test('task open follows the due state', () => {
    expect(pick(status(task({ kind: 'task' }), [], 'family')).label).toBe('To do');
    expect(pick(status(task({ kind: 'task', due_at: ahead(HOUR) }), [], 'staff')).label).toBe('Due soon');
    expect(pick(status(task({ kind: 'task', due_at: ago(HOUR) }), [], 'family')).label).toBe('Overdue');
  });

  test('task done is struck through', () => {
    const want = { key: 'done', label: 'Done', tone: 'neutral', icon: 'check-circle', dashed: false };
    const t = task({ kind: 'task', due_at: ago(DAY), completed_at: ago(HOUR) });
    expect(both(t, [])).toEqual({ family: want, staff: want });
    expect(status(t, [], 'family').struck).toBe(true);
    expect(status(task({ kind: 'task' }), [], 'family').struck).toBe(false);
  });

  test('the row glyph matches the pill everywhere but the archive', () => {
    expect(status(task({ due_at: ago(DAY) }), [], 'family').glyph).toEqual({ icon: 'warning-circle', tone: 'danger' });
  });
});

describe('submissionStatus', () => {
  test('matches itemStatus for a single attempt', () => {
    expect(pick(submissionStatus(sub('ai_graded'), draft, { audience: 'staff' })).label).toBe('AI draft');
    expect(pick(submissionStatus(sub('ai_graded'), null, { audience: 'family' })).label).toBe('Submitted');
    expect(pick(submissionStatus(sub('ai_graded'), released(ago(DAY)), { audience: 'family' })).label).toBe('Graded');
    expect(pick(submissionStatus(sub('failed'), released(ago(DAY)), { audience: 'staff' })).label).toBe('Released');
  });

  test('families never see a staff-only word', () => {
    const forbidden = ['AI draft', 'Grading', 'Edited, not released', 'Could not grade', 'Released'];
    const grades = [null, draft, edited, released(ago(DAY))];
    for (const st of ['pending', 'grading', 'ai_graded', 'failed']) {
      for (const error of [null, 'Bad file']) {
        for (const grade of grades) {
          const s = submissionStatus(sub(st, null, { error }), grade, { audience: 'family' });
          expect(forbidden).not.toContain(s.label);
          expect(s.dashed).toBe(false);
          const item = status(task(), [sub(st, grade, { error })], 'family');
          expect(forbidden).not.toContain(item.label);
        }
      }
    }
  });
});
