import { describe, test, expect } from 'vitest';
import {
  savedNotes, differsFromSaved, rememberDraft, recallDraft, forgetDraft, draftCount,
} from '../../portal/js/notes-draft.js';

const session = (extra = {}) => ({ id: 12, attendance: null, recap: null, ...extra });

describe('session notes drafts', () => {
  test('the saved values in the form shape', () => {
    expect(savedNotes(session())).toEqual({ attendance: null, recap: '' });
    expect(savedNotes(session({ attendance: 'late', recap: 'Fractions' }))).toEqual({ attendance: 'late', recap: 'Fractions' });
    expect(savedNotes(null)).toEqual({ attendance: null, recap: '' });
  });

  test('typed text that matches what is saved is not a change', () => {
    const s = session({ attendance: 'present', recap: 'Fractions' });
    expect(differsFromSaved({ attendance: 'present', recap: 'Fractions' }, s)).toBe(false);
    expect(differsFromSaved({ attendance: 'present', recap: '  Fractions \n' }, s)).toBe(false);
    expect(differsFromSaved({ attendance: 'late', recap: 'Fractions' }, s)).toBe(true);
    expect(differsFromSaved({ attendance: 'present', recap: 'Fractions and decimals' }, s)).toBe(true);
    expect(differsFromSaved({ attendance: null, recap: '' }, session())).toBe(false);
  });

  test('a draft is kept, recalled as a copy, and cleared', () => {
    const store = new Map();
    const s = session();
    expect(rememberDraft(s, { attendance: 'present', recap: 'We covered ratios.' }, store)).toBe(true);
    expect(draftCount(store)).toBe(1);
    const back = recallDraft(s, store);
    expect(back).toEqual({ attendance: 'present', recap: 'We covered ratios.' });
    back.recap = 'changed';
    expect(recallDraft(s, store).recap).toBe('We covered ratios.');
    forgetDraft(s.id, store);
    expect(recallDraft(s, store)).toBeNull();
    expect(draftCount(store)).toBe(0);
  });

  test('each session has its own draft', () => {
    const store = new Map();
    rememberDraft(session({ id: 1 }), { attendance: null, recap: 'one' }, store);
    rememberDraft(session({ id: 2 }), { attendance: 'late', recap: '' }, store);
    expect(recallDraft(session({ id: 1 }), store).recap).toBe('one');
    expect(recallDraft(session({ id: 2 }), store).attendance).toBe('late');
    expect(recallDraft(session({ id: 3 }), store)).toBeNull();
  });

  test('typing it back to what is saved drops the draft', () => {
    const store = new Map();
    const s = session({ recap: 'Fractions' });
    rememberDraft(s, { attendance: null, recap: 'Fractions and more' }, store);
    expect(draftCount(store)).toBe(1);
    expect(rememberDraft(s, { attendance: null, recap: 'Fractions' }, store)).toBe(false);
    expect(draftCount(store)).toBe(0);
  });

  test('a draft that matches a session saved elsewhere meanwhile is dropped on recall', () => {
    const store = new Map();
    rememberDraft(session(), { attendance: 'present', recap: 'Done' }, store);
    const saved = session({ attendance: 'present', recap: 'Done' });
    expect(recallDraft(saved, store)).toBeNull();
    expect(draftCount(store)).toBe(0);
  });

  test('ids match as text', () => {
    const store = new Map();
    rememberDraft(session({ id: 7 }), { attendance: 'absent', recap: '' }, store);
    expect(recallDraft(session({ id: '7' }), store)).toEqual({ attendance: 'absent', recap: '' });
    forgetDraft('7', store);
    expect(draftCount(store)).toBe(0);
  });

  test('no session, nothing kept', () => {
    const store = new Map();
    expect(rememberDraft(null, { attendance: 'present', recap: 'x' }, store)).toBe(false);
    expect(recallDraft(null, store)).toBeNull();
  });
});
