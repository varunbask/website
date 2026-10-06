import { describe, test, expect } from 'vitest';
import {
  savedNotes, differsFromSaved, rememberDraft, recallDraft, forgetDraft, draftCount,
} from '../../portal/js/notes-draft.js';

const session = (extra = {}) => ({ id: 12, attendance: null, recap: null, ...extra });
const typed = (extra = {}) => ({ attendance: null, recap: '', touched: false, ...extra });

describe('session notes drafts', () => {
  test('the saved values in the form shape', () => {
    expect(savedNotes(session())).toEqual({ attendance: null, recap: '' });
    expect(savedNotes(session({ attendance: 'late', recap: 'Fractions' }))).toEqual({ attendance: 'late', recap: 'Fractions' });
    expect(savedNotes(null)).toEqual({ attendance: null, recap: '' });
  });

  test('typed text that matches what is saved is not a change', () => {
    const s = session({ attendance: 'present', recap: 'Fractions' });
    expect(differsFromSaved(typed({ attendance: 'present', recap: 'Fractions', touched: true }), s)).toBe(false);
    expect(differsFromSaved(typed({ attendance: 'present', recap: '  Fractions \n', touched: true }), s)).toBe(false);
    expect(differsFromSaved(typed({ attendance: 'late', recap: 'Fractions', touched: true }), s)).toBe(true);
    expect(differsFromSaved(typed({ attendance: 'present', recap: 'Fractions and decimals' }), s)).toBe(true);
    expect(differsFromSaved(typed(), session())).toBe(false);
  });

  test('an attendance nobody touched is not a change, whatever the form held', () => {
    const s = session({ attendance: 'present', recap: 'Fractions' });
    expect(differsFromSaved(typed({ attendance: null, recap: 'Fractions', touched: false }), s)).toBe(false);
    expect(differsFromSaved(typed({ attendance: 'late', recap: 'Fractions', touched: false }), s)).toBe(false);
  });

  test('a draft is kept, recalled as a copy, and cleared', () => {
    const store = new Map();
    const s = session();
    expect(rememberDraft(s, typed({ attendance: 'present', recap: 'We covered ratios.', touched: true }), store)).toBe(true);
    expect(draftCount(store)).toBe(1);
    const back = recallDraft(s, store);
    expect(back).toEqual({ attendance: 'present', recap: 'We covered ratios.', touched: true });
    back.recap = 'changed';
    expect(recallDraft(s, store).recap).toBe('We covered ratios.');
    forgetDraft(s.id, store);
    expect(recallDraft(s, store)).toBeNull();
    expect(draftCount(store)).toBe(0);
  });

  test('each session has its own draft', () => {
    const store = new Map();
    rememberDraft(session({ id: 1 }), typed({ recap: 'one' }), store);
    rememberDraft(session({ id: 2 }), typed({ attendance: 'late', touched: true }), store);
    expect(recallDraft(session({ id: 1 }), store).recap).toBe('one');
    expect(recallDraft(session({ id: 2 }), store).attendance).toBe('late');
    expect(recallDraft(session({ id: 3 }), store)).toBeNull();
  });

  test('typing it back to what is saved drops the draft', () => {
    const store = new Map();
    const s = session({ recap: 'Fractions' });
    rememberDraft(s, typed({ recap: 'Fractions and more' }), store);
    expect(draftCount(store)).toBe(1);
    expect(rememberDraft(s, typed({ recap: 'Fractions' }), store)).toBe(false);
    expect(draftCount(store)).toBe(0);
  });

  test('a draft that matches a session saved elsewhere meanwhile is dropped on recall', () => {
    const store = new Map();
    rememberDraft(session(), typed({ attendance: 'present', recap: 'Done', touched: true }), store);
    const saved = session({ attendance: 'present', recap: 'Done' });
    expect(recallDraft(saved, store)).toBeNull();
    expect(draftCount(store)).toBe(0);
  });

  test('ids match as text', () => {
    const store = new Map();
    rememberDraft(session({ id: 7 }), typed({ attendance: 'absent', touched: true }), store);
    expect(recallDraft(session({ id: '7' }), store)).toEqual({ attendance: 'absent', recap: '', touched: true });
    forgetDraft('7', store);
    expect(draftCount(store)).toBe(0);
  });

  test('no session, nothing kept', () => {
    const store = new Map();
    expect(rememberDraft(null, typed({ attendance: 'present', recap: 'x', touched: true }), store)).toBe(false);
    expect(recallDraft(null, store)).toBeNull();
  });

  describe('attendance set elsewhere while a draft was kept', () => {
    test('the scenario: recap typed, form closed, Present tapped on Today, form reopened', () => {
      const store = new Map();
      const opened = session();   // no attendance yet
      // the form held attendance null and the tutor never touched it
      rememberDraft(opened, typed({ attendance: null, recap: 'Worked on ratios.', touched: false }), store);
      // Present is tapped on the Today row
      const later = session({ attendance: 'present' });
      expect(recallDraft(later, store)).toEqual({ attendance: 'present', recap: 'Worked on ratios.', touched: false });
      // an untouched attendance is not part of what Save would write
      expect(differsFromSaved(typed({ attendance: 'present', recap: 'Worked on ratios.', touched: false }), later)).toBe(true);
    });

    test('an admin changed it meanwhile: their value stands over an untouched form', () => {
      const store = new Map();
      rememberDraft(session(), typed({ recap: 'Worked on ratios.' }), store);
      const byAdmin = session({ attendance: 'absent' });
      expect(recallDraft(byAdmin, store)).toMatchObject({ attendance: 'absent', touched: false, recap: 'Worked on ratios.' });
    });

    test('a choice made in the form survives while the session still has what it had', () => {
      const store = new Map();
      rememberDraft(session(), typed({ attendance: 'late', recap: 'Arrived at 4:15.', touched: true }), store);
      expect(recallDraft(session(), store)).toEqual({ attendance: 'late', recap: 'Arrived at 4:15.', touched: true });
    });

    test('a choice made in the form is dropped when someone else changed the session since', () => {
      const store = new Map();
      rememberDraft(session(), typed({ attendance: 'late', recap: 'Arrived at 4:15.', touched: true }), store);
      const byAdmin = session({ attendance: 'present' });
      const back = recallDraft(byAdmin, store);
      expect(back).toEqual({ attendance: 'present', recap: 'Arrived at 4:15.', touched: false });
    });

    test('nothing but a stale choice left: the draft is dropped', () => {
      const store = new Map();
      rememberDraft(session(), typed({ attendance: 'late', touched: true }), store);
      expect(recallDraft(session({ attendance: 'present' }), store)).toBeNull();
      expect(draftCount(store)).toBe(0);
    });

    test('pressing the saved value again is not a choice to keep', () => {
      const store = new Map();
      const s = session({ attendance: 'present' });
      expect(rememberDraft(s, typed({ attendance: 'present', touched: true }), store)).toBe(false);
      expect(draftCount(store)).toBe(0);
    });
  });
});
