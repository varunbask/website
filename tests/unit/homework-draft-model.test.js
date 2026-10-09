import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SHRINK, MIN_PROBLEMS, MAX_PROBLEMS, DEFAULT_PROBLEMS, MAX_NOTES, DIFFICULTIES,
  POLL_MS, RECENT_DAYS, DRAFTING_TEXT, READING_TEXT, UPLOADING_TEXT, SLOW_TEXT, READY_TEXT, MAX_ATTACHMENTS, GONE_ERROR, MAX_DETAILS,
  pollOutcome, tokenNeedsRefresh, attachmentsProblem, elsewhereText, photoFileName, stageText,
  fitSize, checkOptions, draftRequest,
  draftContext, contextText, formFromDraft, draftState, elapsedText, recentDrafts, optionsText, activeDraft, shouldReopen,
} from '../../portal/js/homework-draft-model.js';
import * as sources from '../../portal/js/draft-sources-model.js';
import * as server from '../../api/_lib/homework-draft.js';

const NOW = new Date('2026-10-08T18:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

describe('the browser and the server agree', () => {
  test('problems, notes, difficulties, and the files\' limits (shared with the server)', () => {
    expect([MIN_PROBLEMS, MAX_PROBLEMS, DEFAULT_PROBLEMS]).toEqual([server.MIN_PROBLEMS, server.MAX_PROBLEMS, server.DEFAULT_PROBLEMS]);
    expect(MAX_NOTES).toBe(server.MAX_NOTES);
    expect(DIFFICULTIES.map((d) => d.value)).toEqual(Object.keys(server.DIFFICULTIES));
    const serverSource = readFileSync(new URL('../../api/_lib/homework-draft.js', import.meta.url), 'utf8');
    expect(serverSource).toContain("from '../../portal/js/draft-sources-model.js';");
  });

  test('the request body the panel builds passes the server check', () => {
    const me = '11111111-2222-4333-8444-555555555555';
    const uploaded = [
      { path: `${me}/k3yAbc12/1-Worksheet.pdf`, name: 'Worksheet.pdf', kind: 'pdf' },
      { path: `${me}/k3yAbc12/2-Whiteboard.jpg`, name: 'Whiteboard.HEIC', kind: 'image' },
    ];
    const body = draftRequest({
      sources: uploaded, notesText: '  We did factoring.  ', options: checkOptions({ count: '7', difficulty: 'harder', hints: true, notes: ' negatives ' }).values,
      context: { subject: 'Algebra', grade: '9th grade' }, studentId: 'u-maya',
    });
    expect(body).toEqual({
      action: 'draft_homework',
      sources: [
        { path: uploaded[0].path, name: 'Worksheet.pdf', type: 'pdf' },
        { path: uploaded[1].path, name: 'Whiteboard.HEIC', type: 'image' },
      ],
      notes_text: 'We did factoring.',
      count: 7, difficulty: 'harder', hints: true, challenge: true, notes: 'negatives',
      subject: 'Algebra', grade: '9th grade', student_id: 'u-maya',
    });
    expect(body).not.toHaveProperty('images');
    const checked = server.checkDraftRequest(body);
    expect(checked.error).toBeUndefined();
    expect(checked.values).toMatchObject({ count: 7, difficulty: 'harder', hints: true, notes: 'negatives', notesText: 'We did factoring.', subject: 'Algebra', studentId: 'u-maya' });
    expect(checked.values.sources.map((s) => s.path)).toEqual(uploaded.map((s) => s.path));
    expect(draftRequest({ sources: uploaded, notesText: '   ', options: checkOptions({}).values })).not.toHaveProperty('notes_text');
  });

  test('a path the panel makes is one the server takes', () => {
    const me = '11111111-2222-4333-8444-555555555555';
    const key = sources.draftKey();
    for (const name of ['Lesson 4 – slides (final).pptx', 'Ünïcødé nötes.docx', '???.pdf', `${'x'.repeat(300)}.txt`, 'no extension', '.hidden']) {
      const path = sources.sourcePath(me, key, 10, name);
      expect(server.checkDraftRequest({ sources: [{ path, name }] }).error, name).toBeUndefined();
    }
  });
});

describe('photos', () => {
  test('the long edge goes to 1600 px at JPEG quality 0.85', () => {
    expect(SHRINK).toEqual({ maxEdge: 1600, quality: 0.85 });
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

  test('a photo is attached as the JPEG it became', () => {
    expect(photoFileName('IMG_2041.HEIC')).toBe('IMG_2041.jpg');
    expect(photoFileName('Whiteboard.png')).toBe('Whiteboard.jpg');
    expect(photoFileName('', 3)).toBe('Lesson photo 3.jpg');
  });
});

describe('options', () => {
  test('defaults: 5 problems, about the same, no hints, no notes', () => {
    expect(checkOptions({})).toEqual({ values: { count: 5, difficulty: 'same', hints: false, challenge: true, notes: null }, errors: {} });
    expect(checkOptions({ challenge: false }).values.challenge).toBe(false);
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
    // an admin who does not teach the student: their only subject, never a guess between two
    expect(draftContext({ links, studentId: 's1', tutorId: 'admin' }).subject).toBeNull();
    expect(draftContext({ links: [...links, { tutor_id: 't1', student_id: 's2', subject: 'Chemistry' }], studentId: 's2', tutorId: 'admin' }).subject).toBe('Chemistry');
    expect(contextText({ subject: 'Algebra', grade: '9th grade' })).toBe('Algebra, 9th grade');
    expect(contextText({})).toBe('');
  });
});

describe('a finished draft fills the form', () => {
  test('title, details and the answer key text, clamped to the columns', () => {
    const result = { title: ' Factoring practice ', details: '1. Factor x^2 + 5x + 6.', answer_key_text: '1. (x + 2)(x + 3)', problems: [] };
    expect(formFromDraft(result)).toEqual({ title: 'Factoring practice', details: '1. Factor x^2 + 5x + 6.', answerKey: '1. (x + 2)(x + 3)', notice: null });
    expect(formFromDraft({ ...result, notice: '2 problems were left out.' }).notice).toBe('2 problems were left out.');
    const long = formFromDraft({ title: 't'.repeat(300), details: 'd'.repeat(13000), answer_key_text: 'k'.repeat(30000) });
    expect([long.title.length, long.details.length, long.answerKey.length]).toEqual([200, 12000, 20000]);
    expect(MAX_DETAILS).toBe(server.MAX_DETAILS);
    expect(formFromDraft(null)).toEqual({ title: '', details: '', answerKey: '', notice: null });
  });
});

describe('job status', () => {
  test('the state is what the server said: no clock check here (draft_status marks a stale one failed)', () => {
    expect(draftState({ status: 'drafting', created_at: ago(60_000) })).toBe('drafting');
    expect(draftState({ status: 'drafting', created_at: ago(server.DRAFT_STALE_MS * 10) })).toBe('drafting');
    expect(draftState({ status: 'ready', created_at: ago(1) })).toBe('ready');
    expect(draftState({ status: 'failed', created_at: ago(1) })).toBe('failed');
    expect(draftState({ status: 'odd' })).toBe('failed');
    expect(draftState(null)).toBe('failed');
  });

  test('polling: only a 404 means gone; every other answer that is not a 200 is asked again', () => {
    expect(pollOutcome(200)).toBe('apply');
    expect(pollOutcome(404)).toBe('gone');
    for (const status of [0, 400, 401, 403, 408, 429, 500, 502, 503]) expect(pollOutcome(status), String(status)).toBe('retry');
    expect(GONE_ERROR).toBe('This draft is no longer available.');
  });

  test('the sign-in token is refreshed near its expiry, or after a 401', () => {
    const nowMs = NOW.getTime();
    const expiresIn = (s) => ({ access_token: 't', expires_at: Math.floor(nowMs / 1000) + s });
    expect(tokenNeedsRefresh(expiresIn(3600), nowMs)).toBe(false);
    expect(tokenNeedsRefresh(expiresIn(59), nowMs)).toBe(true);
    expect(tokenNeedsRefresh(expiresIn(-10), nowMs)).toBe(true);
    expect(tokenNeedsRefresh(expiresIn(3600), nowMs, { forced: true })).toBe(true);
    expect(tokenNeedsRefresh({ access_token: 'demo-token' }, nowMs)).toBe(false);   // no expiry: the local demo
    expect(tokenNeedsRefresh(null, nowMs)).toBe(false);
    expect(tokenNeedsRefresh(null, nowMs, { forced: true })).toBe(true);
  });

  test('a finished draft for another student says where to find it', () => {
    expect(elsewhereText('Leo Park')).toBe('Draft for Leo Park is ready. Open it from Recent drafts.');
    expect(elsewhereText(null)).toBe('Draft for another student is ready. Open it from Recent drafts.');
  });

  test('polling every 5 s; the elapsed timer reads m:ss', () => {
    expect(POLL_MS).toBe(5000);
    expect(elapsedText(0)).toBe('0:00');
    expect(elapsedText(5_400)).toBe('0:05');
    expect(elapsedText(83_000)).toBe('1:23');
    expect(elapsedText(723_000)).toBe('12:03');
    expect(elapsedText(-5)).toBe('0:00');
  });

  test('the status while a draft runs: uploading, reading the files, then drafting', () => {
    expect(UPLOADING_TEXT).toBe('Uploading your files…');
    expect(READING_TEXT).toBe('Reading your files…');
    expect(DRAFTING_TEXT).toBe('Drafting…');
    expect(SLOW_TEXT).toBe('This can take a few minutes. You can keep working and come back.');
    expect([stageText('uploading'), stageText('reading'), stageText('drafting'), stageText(undefined)]).toEqual([UPLOADING_TEXT, READING_TEXT, DRAFTING_TEXT, DRAFTING_TEXT]);
    expect(`${UPLOADING_TEXT}${READING_TEXT}${DRAFTING_TEXT}${SLOW_TEXT}${READY_TEXT}`).not.toMatch(/[–—]/);
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
      { id: 1, student_id: 's1', status: 'drafting', created_at: ago(server.DRAFT_STALE_MS + 5) },
      { id: 2, student_id: 's1', status: 'drafting', created_at: ago(90_000) },
      { id: 3, student_id: 's2', status: 'drafting', created_at: ago(10_000) },
      { id: 4, student_id: 's1', status: 'ready', created_at: ago(5_000) },
    ];
    expect(activeDraft(rows, { studentId: 's1' }).id).toBe(2);
    expect(activeDraft(rows, { studentId: 's3' })).toBeNull();
    // no student in the form: never a draft, not even one saved without a student
    const loose = [...rows, { id: 5, student_id: null, status: 'drafting', created_at: ago(1000) }];
    expect(activeDraft(loose, { studentId: null })).toBeNull();
    expect(activeDraft(loose, { studentId: undefined })).toBeNull();
    expect(activeDraft(loose, { studentId: '' })).toBeNull();
  });

  test('one line about a draft\'s options', () => {
    expect(optionsText({ count: 5, difficulty: 'same' })).toBe('5 practice problems, about the same');
    expect(optionsText({ count: 1, difficulty: 'harder', hints: true })).toBe('1 practice problem, harder, with hints');
    expect(optionsText({})).toBe('5 practice problems');
  });
});

describe('reopening the panel by itself', () => {
  test('a draft still drafting, or one ready in the last hour, for this student', () => {
    const row = (over) => ({ id: 1, student_id: 's1', status: 'ready', created_at: ago(30 * 60_000), finished_at: ago(29 * 60_000), ...over });
    expect(shouldReopen([row({ status: 'drafting', created_at: ago(60_000), finished_at: null })], { studentId: 's1', now: NOW })).toBe(true);
    expect(shouldReopen([row()], { studentId: 's1', now: NOW })).toBe(true);
    expect(shouldReopen([row({ finished_at: ago(61 * 60_000) })], { studentId: 's1', now: NOW })).toBe(false);
    expect(shouldReopen([row({ status: 'failed' })], { studentId: 's1', now: NOW })).toBe(false);
    // still drafting as far as the server last said: reopen, and its status poll settles it
    expect(shouldReopen([row({ status: 'drafting', created_at: ago(server.DRAFT_STALE_MS + 1), finished_at: null })], { studentId: 's1', now: NOW })).toBe(true);
    expect(shouldReopen([row()], { studentId: 's2', now: NOW })).toBe(false);
    expect(shouldReopen([row()], { studentId: null, now: NOW })).toBe(false);
  });
});

describe('attachments', () => {
  test('files and ticked lesson files together stay within the 10 an assignment allows', () => {
    expect(MAX_ATTACHMENTS).toBe(10);
    expect(attachmentsProblem(4, 6)).toBe('');
    expect(attachmentsProblem(10, 0)).toBe('');
    expect(attachmentsProblem(5, 6)).toBe('An assignment can have at most 10 attachments. This one has 5 files and 6 lesson files. Remove some files, or untick Attach these to the assignment.');
    expect(attachmentsProblem(1, 10)).toMatch(/1 file and 10 lesson files/);
    expect(attachmentsProblem(10, 1)).toMatch(/10 files and 1 lesson file\./);
  });

  test('the form uses the same limit', () => {
    const form = readFileSync(new URL('../../portal/js/item-form.js', import.meta.url), 'utf8');
    expect(form).toContain("import { draftContext, attachmentsProblem, MAX_ATTACHMENTS } from './homework-draft-model.js';");
    expect(form).not.toMatch(/const MAX_ATTACHMENTS = /);
  });
});
