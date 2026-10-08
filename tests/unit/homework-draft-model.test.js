import { describe, test, expect } from 'vitest';
import {
  MAX_PHOTOS, MAX_PHOTO_CHARS, SHRINK_TRIES, MIN_PROBLEMS, MAX_PROBLEMS, DEFAULT_PROBLEMS, MAX_NOTES, DIFFICULTIES,
  POLL_MS, STALE_MS, RECENT_DAYS, DRAFTING_TEXT, READY_TEXT,
  fitSize, base64Length, isImageFile, sizeText, fitsBudget, overBudgetText, photoProblems, checkOptions, draftRequest,
  draftContext, contextText, formFromDraft, draftState, elapsedText, recentDrafts, optionsText, activeDraft,
} from '../../portal/js/homework-draft-model.js';
import * as server from '../../api/_lib/homework-draft.js';

const NOW = new Date('2026-10-08T18:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

describe('the browser and the server agree', () => {
  test('photos, problems, notes, difficulties and the stale time', () => {
    expect(MAX_PHOTOS).toBe(server.MAX_DRAFT_IMAGES);
    expect(MAX_PHOTO_CHARS).toBe(server.MAX_DRAFT_IMAGE_CHARS);
    expect([MIN_PROBLEMS, MAX_PROBLEMS, DEFAULT_PROBLEMS]).toEqual([server.MIN_PROBLEMS, server.MAX_PROBLEMS, server.DEFAULT_PROBLEMS]);
    expect(MAX_NOTES).toBe(server.MAX_NOTES);
    expect(DIFFICULTIES.map((d) => d.value)).toEqual(Object.keys(server.DIFFICULTIES));
    expect(STALE_MS).toBe(server.DRAFT_STALE_MS);
  });

  test('the request body the panel builds passes the server check', () => {
    const photos = [{ dataUrl: `data:image/jpeg;base64,${'A'.repeat(800)}`, chars: 800 }];
    const body = draftRequest({
      photos, options: checkOptions({ count: '7', difficulty: 'harder', hints: true, notes: ' negatives ' }).values,
      context: { subject: 'Algebra', grade: '9th grade' }, studentId: 'u-maya',
    });
    expect(body).toEqual({
      action: 'draft_homework', images: [photos[0].dataUrl], count: 7, difficulty: 'harder', hints: true, notes: 'negatives',
      subject: 'Algebra', grade: '9th grade', student_id: 'u-maya',
    });
    const checked = server.checkDraftRequest(body);
    expect(checked.error).toBeUndefined();
    expect(checked.values).toMatchObject({ count: 7, difficulty: 'harder', hints: true, notes: 'negatives', subject: 'Algebra', studentId: 'u-maya' });
  });
});

describe('downscale math', () => {
  test('the long edge goes to 1600 px at JPEG quality 0.85 first, then a smaller try', () => {
    expect(SHRINK_TRIES[0]).toEqual({ maxEdge: 1600, quality: 0.85 });
    expect(SHRINK_TRIES[1].maxEdge).toBeLessThan(1600);
    expect(SHRINK_TRIES[1].quality).toBeLessThan(0.85);
  });

  test('fitSize keeps the shape and never enlarges', () => {
    expect(fitSize(4032, 3024)).toEqual({ width: 1600, height: 1200, scale: 1600 / 4032 });
    expect(fitSize(3024, 4032)).toMatchObject({ width: 1200, height: 1600 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600, scale: 1 });
    expect(fitSize(1600, 10)).toMatchObject({ width: 1600, height: 10 });
    expect(fitSize(20000, 3)).toMatchObject({ width: 1600, height: 1 });
    expect(fitSize(4032, 3024, 1200)).toMatchObject({ width: 1200, height: 900 });
    expect(fitSize(0, 0)).toMatchObject({ width: 1, height: 1 });
  });

  test('base64 is four characters for every three bytes, rounded up', () => {
    expect(base64Length(0)).toBe(0);
    expect(base64Length(1)).toBe(4);
    expect(base64Length(3)).toBe(4);
    expect(base64Length(4)).toBe(8);
    expect(base64Length(300_000)).toBe(400_000);
    expect(base64Length(Buffer.alloc(1234).length)).toBe(Buffer.alloc(1234).toString('base64').length);
  });
});

describe('the photo budget', () => {
  test('3.5 MB of base64 in all, checked before a photo is added', () => {
    expect(MAX_PHOTO_CHARS).toBe(3.5 * 1024 * 1024);
    const six = Array.from({ length: 5 }, () => ({ chars: 700_000 }));
    expect(fitsBudget(six, MAX_PHOTO_CHARS - 3_500_000)).toBe(true);
    expect(fitsBudget(six, MAX_PHOTO_CHARS - 3_500_000 + 1)).toBe(false);
    expect(fitsBudget([], MAX_PHOTO_CHARS)).toBe(true);
    expect(fitsBudget([], MAX_PHOTO_CHARS + 1)).toBe(false);
  });

  test('says clearly when photos are over', () => {
    expect(overBudgetText([{ chars: 3_000_000 }], 900_000)).toBe('These photos are too large together (3.7 MB of 3.5 MB). Remove a photo, or use fewer or smaller ones.');
    expect(sizeText(850 * 1024)).toBe('850 KB');
    expect(sizeText(1.2 * 1024 * 1024)).toBe('1.2 MB');
  });

  test('only images are photos (a blank type falls back to the name)', () => {
    expect(isImageFile({ type: 'image/jpeg', name: 'a.jpg' })).toBe(true);
    expect(isImageFile({ type: 'image/heic', name: 'a.heic' })).toBe(true);
    expect(isImageFile({ type: 'application/pdf', name: 'a.pdf' })).toBe(false);
    expect(isImageFile({ type: 'text/plain', name: 'a.jpg' })).toBe(false);
    expect(isImageFile({ type: '', name: 'IMG_1.HEIC' })).toBe(true);
    expect(isImageFile({ type: '', name: 'notes.docx' })).toBe(false);
    expect(isImageFile(null)).toBe(false);
  });

  test('what was not added, in one sentence each', () => {
    expect(photoProblems({})).toBe('');
    expect(photoProblems({ notImages: ['a.pdf'], tooMany: 2 })).toBe('a.pdf: not an image. Add photos (JPG, PNG or WebP). Add at most 6 photos.');
    expect(photoProblems({ unreadable: ['b.heic'] })).toMatch(/could not be opened/);
  });
});

describe('options', () => {
  test('defaults: 5 problems, about the same, no hints, no notes', () => {
    expect(checkOptions({})).toEqual({ values: { count: 5, difficulty: 'same', hints: false, notes: null }, errors: {} });
    expect(DIFFICULTIES.map((d) => d.label)).toEqual(['Easier', 'About the same', 'Harder']);
  });

  test('1 to 15 problems', () => {
    for (const count of ['1', '15', 1, 15, ' 8 ']) expect(checkOptions({ count }).errors.count, String(count)).toBeUndefined();
    for (const count of ['0', '16', '2.5', 'many', -3]) expect(checkOptions({ count }).errors.count, String(count)).toBe('Choose 1 to 15 problems.');
  });

  test('notes up to 500 characters, trimmed; an unknown difficulty is about the same', () => {
    expect(checkOptions({ notes: 'x'.repeat(501) }).errors.notes).toBe('Keep the notes under 500 characters.');
    expect(checkOptions({ notes: `  ${'x'.repeat(500)}  ` }).errors.notes).toBeUndefined();
    expect(checkOptions({ difficulty: 'brutal' }).values.difficulty).toBe('same');
    expect(checkOptions({ hints: 'on' }).values.hints).toBe(true);
  });

  test('context: the lesson\'s subject, else the tutor\'s link; the grade from the profile', () => {
    const links = [{ tutor_id: 't1', student_id: 's1', subject: 'Math' }, { tutor_id: 't2', student_id: 's1', subject: 'SAT Reading' }];
    expect(draftContext({ lesson: { student_id: 's1', subject: 'Algebra' }, links, studentId: 's1', tutorId: 't1', gradeLevel: '9th grade' }))
      .toEqual({ subject: 'Algebra', grade: '9th grade' });
    expect(draftContext({ links, studentId: 's1', tutorId: 't2' })).toEqual({ subject: 'SAT Reading', grade: null });
    expect(draftContext({ lesson: { student_id: 'other', subject: 'Chemistry' }, links, studentId: 's1', tutorId: 't1' }).subject).toBe('Math');
    expect(draftContext({ links: null, studentId: 's1', tutorId: 't3' })).toEqual({ subject: null, grade: null });
    expect(contextText({ subject: 'Algebra', grade: '9th grade' })).toBe('Algebra, 9th grade');
    expect(contextText({})).toBe('');
  });
});

describe('a finished draft fills the form', () => {
  test('title, details and the answer key text, clamped to the columns', () => {
    const result = { title: ' Factoring practice ', details: '1. Factor x^2 + 5x + 6.', answer_key_text: '1. (x + 2)(x + 3)', problems: [] };
    expect(formFromDraft(result)).toEqual({ title: 'Factoring practice', details: '1. Factor x^2 + 5x + 6.', answerKey: '1. (x + 2)(x + 3)' });
    const long = formFromDraft({ title: 't'.repeat(300), details: 'd'.repeat(6000), answer_key_text: 'k'.repeat(30000) });
    expect([long.title.length, long.details.length, long.answerKey.length]).toEqual([200, 5000, 20000]);
    expect(formFromDraft(null)).toEqual({ title: '', details: '', answerKey: '' });
  });
});

describe('job status', () => {
  test('a draft still drafting after 6 minutes has failed', () => {
    expect(draftState({ status: 'drafting', created_at: ago(60_000) }, NOW)).toBe('drafting');
    expect(draftState({ status: 'drafting', created_at: ago(STALE_MS + 1) }, NOW)).toBe('failed');
    expect(draftState({ status: 'ready', created_at: ago(STALE_MS * 10) }, NOW)).toBe('ready');
    expect(draftState({ status: 'failed', created_at: ago(1) }, NOW)).toBe('failed');
    expect(draftState(null, NOW)).toBe('failed');
  });

  test('polling every 5 s; the elapsed timer reads m:ss', () => {
    expect(POLL_MS).toBe(5000);
    expect(elapsedText(0)).toBe('0:00');
    expect(elapsedText(5_400)).toBe('0:05');
    expect(elapsedText(83_000)).toBe('1:23');
    expect(elapsedText(723_000)).toBe('12:03');
    expect(elapsedText(-5)).toBe('0:00');
  });

  test('the slow-draft wording', () => {
    expect(DRAFTING_TEXT).toBe('Drafting your homework. This can take a few minutes; you can keep working and come back.');
    expect(`${DRAFTING_TEXT}${READY_TEXT}`).not.toMatch(/[–—]/);
  });

  test('recent drafts: the last 7 days, this student first, newest first', () => {
    expect(RECENT_DAYS).toBe(7);
    const rows = [
      { id: 1, student_id: 's2', created_at: ago(60_000) },
      { id: 2, student_id: 's1', created_at: ago(3 * 86_400_000) },
      { id: 3, student_id: 's1', created_at: ago(120_000) },
      { id: 4, student_id: 's1', created_at: ago(8 * 86_400_000) },
      { id: 5, student_id: null, created_at: ago(30_000) },
    ];
    expect(recentDrafts(rows, { studentId: 's1', now: NOW }).map((r) => r.id)).toEqual([3, 2, 5, 1]);
    expect(recentDrafts(rows, { studentId: null, now: NOW }).map((r) => r.id)).toEqual([5, 1, 3, 2]);
  });

  test('the draft to pick up again when the form reopens: this student\'s newest still drafting', () => {
    const rows = [
      { id: 1, student_id: 's1', status: 'drafting', created_at: ago(STALE_MS + 5) },
      { id: 2, student_id: 's1', status: 'drafting', created_at: ago(90_000) },
      { id: 3, student_id: 's2', status: 'drafting', created_at: ago(10_000) },
      { id: 4, student_id: 's1', status: 'ready', created_at: ago(5_000) },
    ];
    expect(activeDraft(rows, { studentId: 's1', now: NOW }).id).toBe(2);
    expect(activeDraft(rows, { studentId: 's3', now: NOW })).toBeNull();
  });

  test('one line about a draft\'s options', () => {
    expect(optionsText({ count: 5, difficulty: 'same' })).toBe('5 problems, about the same');
    expect(optionsText({ count: 1, difficulty: 'harder', hints: true })).toBe('1 problem, harder, with hints');
    expect(optionsText({})).toBe('5 problems');
  });
});
