import { describe, test, expect } from 'vitest';
import { staffStatus, familyStatus, canRetry } from '../../portal/js/labels.js';

const NOW = new Date('2026-10-10T12:00:00Z');
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

describe('staffStatus', () => {
  test('follows the pipeline and the review', () => {
    expect(staffStatus({ status: 'pending' }, null)).toEqual({ text: 'Submitted', tone: 'wait' });
    expect(staffStatus({ status: 'grading' }, null)).toEqual({ text: 'Grading', tone: 'wait' });
    expect(staffStatus({ status: 'ai_graded' }, { reviewed_at: null, released_at: null })).toEqual({ text: 'AI draft', tone: 'review' });
    expect(staffStatus({ status: 'ai_graded' }, { reviewed_at: ago(1), released_at: null })).toEqual({ text: 'Edited, not released', tone: 'review' });
    expect(staffStatus({ status: 'failed' }, { reviewed_at: null, released_at: null })).toEqual({ text: 'Could not grade', tone: 'alert' });
    expect(staffStatus({ status: 'failed' }, { reviewed_at: ago(1), released_at: ago(1) })).toEqual({ text: 'Released', tone: 'done' });
  });
});

describe('familyStatus', () => {
  test('never hints at a draft', () => {
    expect(familyStatus({ status: 'ai_graded' }, null)).toEqual({ text: 'Submitted, waiting for review', tone: 'wait' });
    expect(familyStatus({ status: 'pending' }, null)).toEqual({ text: 'Submitted, waiting for review', tone: 'wait' });
    expect(familyStatus({ status: 'failed', error: 'This PDF has no readable text.' }, null)).toEqual({ text: 'Needs attention', tone: 'alert' });
    expect(familyStatus({ status: 'ai_graded' }, { released_at: ago(1) })).toEqual({ text: 'Graded', tone: 'done' });
  });
});

describe('canRetry', () => {
  test('failed work, stale pending work, and stuck grading', () => {
    expect(canRetry({ status: 'failed', status_changed_at: ago(1) }, NOW)).toBe(true);
    expect(canRetry({ status: 'pending', status_changed_at: ago(2) }, NOW)).toBe(false);
    expect(canRetry({ status: 'pending', status_changed_at: ago(6) }, NOW)).toBe(true);
    expect(canRetry({ status: 'grading', status_changed_at: ago(5) }, NOW)).toBe(false);
    expect(canRetry({ status: 'grading', status_changed_at: ago(11) }, NOW)).toBe(true);
    expect(canRetry({ status: 'ai_graded', status_changed_at: ago(60) }, NOW)).toBe(false);
  });
});
