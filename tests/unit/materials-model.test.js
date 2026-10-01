import { describe, test, expect } from 'vitest';
import {
  materialType, validateMaterialFile, materialPath, titleFromFile, sizeText, downloadName, linkLabel,
  validateLink, isLink, materialIcon, materialMeta, materialsFor, materialCounts, homeworkFor, homeworkDueKey,
  MAX_MATERIAL_BYTES, MATERIAL_ACCEPT,
} from '../../portal/js/materials-model.js';
import { zonedIso } from '../../portal/js/dates.js';

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const file = (name, type, size = 1000) => ({ name, type, size });

describe('files', () => {
  test('type from the browser, or from the name when the browser gives none', () => {
    expect(materialType(file('a.pdf', 'application/pdf'))).toBe('application/pdf');
    expect(materialType(file('Lesson 4.pptx', ''))).toBe(PPTX);
    expect(materialType(file('photo.JPEG', ''))).toBe('image/jpeg');
    expect(materialType(file('notes.txt', 'text/plain'))).toBeNull();
    expect(materialType(file('run.exe', ''))).toBeNull();
  });

  test('validation messages', () => {
    expect(validateMaterialFile(null)).toBe('Choose a file.');
    expect(validateMaterialFile(file('x.zip', 'application/zip'))).toMatch(/PDF, a PowerPoint/);
    expect(validateMaterialFile(file('x.pdf', 'application/pdf', 0))).toBe('That file is empty.');
    expect(validateMaterialFile(file('x.pdf', 'application/pdf', MAX_MATERIAL_BYTES + 1))).toBe('Files must be under 25 MB.');
    expect(validateMaterialFile(file('x.pptx', PPTX, 5_000_000))).toBeNull();
  });

  test('storage names match the bucket policy', () => {
    const path = materialPath('6a0b2c3d-0000-4000-8000-000000000001', PPTX, '11111111-2222-4333-8444-555555555555');
    expect(path).toBe('6a0b2c3d-0000-4000-8000-000000000001/11111111-2222-4333-8444-555555555555.pptx');
    expect(path).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|pptx|ppt|docx|doc|png|jpg)$/);
    expect(materialPath('s', 'image/jpeg', 'i')).toBe('s/i.jpg');
  });

  test('titles, sizes and download names', () => {
    expect(titleFromFile('Lesson_4_slides.pptx')).toBe('Lesson 4 slides');
    expect(titleFromFile('.pdf')).toBe('Untitled file');
    expect(sizeText(850 * 1024)).toBe('850 KB');
    expect(sizeText(2.4 * 1024 * 1024)).toBe('2.4 MB');
    expect(sizeText(12 * 1024 * 1024)).toBe('12 MB');
    expect(sizeText(0)).toBe('');
    expect(downloadName({ title: 'Week 3: slides', file_type: PPTX })).toBe('Week 3  slides.pptx');
    expect(downloadName({ title: 'Sheet.pdf', file_type: 'application/pdf' })).toBe('Sheet.pdf');
  });

  test('the accept list covers every type', () => {
    for (const ext of ['.pdf', '.pptx', '.ppt', '.docx', '.doc', '.png', '.jpg', '.jpeg']) expect(MATERIAL_ACCEPT).toContain(ext);
  });
});

describe('links', () => {
  test('labels', () => {
    expect(linkLabel('https://docs.google.com/presentation/d/abc/edit')).toBe('Google Slides');
    expect(linkLabel('https://docs.google.com/document/d/abc')).toBe('Google Doc');
    expect(linkLabel('https://www.canva.com/design/x')).toBe('Canva');
    expect(linkLabel('https://youtu.be/x')).toBe('YouTube video');
    expect(linkLabel('https://www.desmos.com/calculator')).toBe('Desmos');
    expect(linkLabel('https://example.org/a')).toBe('example.org');
    expect(linkLabel('nonsense')).toBe('Link');
  });

  test('validation fills a blank title from the link', () => {
    expect(validateLink({ url: ' https://docs.google.com/presentation/d/x ' })).toEqual({
      ok: true, errors: {}, values: { url: 'https://docs.google.com/presentation/d/x', title: 'Google Slides' },
    });
    expect(validateLink({ url: 'https://x.example', title: ' Practice set ' }).values.title).toBe('Practice set');
    expect(validateLink({}).errors.url).toBe('Paste a link.');
    expect(validateLink({ url: 'http://x.example' }).errors.url).toBe('Use a link that starts with https://');
    expect(validateLink({ url: 'https://x.example/a b' }).errors.url).toBe('Use a link that starts with https://');
  });
});

describe('rows', () => {
  const m = (id, extra) => ({ id, created_at: `2026-10-0${id}T00:00:00Z`, session_id: null, task_id: null, ...extra });
  const list = [
    m(3, { session_id: 7, url: 'https://docs.google.com/presentation/d/x', title: 'Deck' }),
    m(1, { session_id: 7, storage_path: 's/a.pptx', file_type: PPTX, size_bytes: 2.4 * 1024 * 1024, title: 'Slides' }),
    m(2, { task_id: 9, storage_path: 's/b.pdf', file_type: 'application/pdf', size_bytes: 1024, title: 'Worksheet' }),
  ];

  test('icons and meta', () => {
    expect(isLink(list[0])).toBe(true);
    expect(materialIcon(list[0])).toBe('link-simple');
    expect(materialIcon(list[1])).toBe('presentation');
    expect(materialMeta(list[0])).toBe('Google Slides');
    expect(materialMeta(list[1])).toBe('PowerPoint, 2.4 MB');
    expect(materialMeta(list[2])).toBe('PDF, 1 KB');
    // A title that already says what the link is gets the site instead
    expect(materialMeta({ title: 'Desmos', url: 'https://www.desmos.com/calculator/x' })).toBe('desmos.com');
  });

  test('per session or task, oldest first; counts per session', () => {
    expect(materialsFor(list, { sessionId: 7 }).map((x) => x.id)).toEqual([1, 3]);
    expect(materialsFor(list, { taskId: '9' }).map((x) => x.id)).toEqual([2]);
    expect(materialsFor(list, { sessionId: 8 })).toEqual([]);
    expect([...materialCounts(list)]).toEqual([['7', 2]]);
  });
});

describe('homework', () => {
  const at = (key, time) => zonedIso(key, time);
  const s = (id, key, extra = {}) => ({
    id, tutor_id: 't1', student_id: 's1', status: 'scheduled', starts_at: at(key, '16:00'), ends_at: at(key, '17:00'), ...extra,
  });

  test('lesson labels', async () => {
    const { lessonLabel } = await import('../../portal/js/materials-model.js');
    expect(lessonLabel(s(1, '2026-10-13', { subject: 'Algebra' }), '2026-10-01')).toBe('the Algebra lesson on Tue, Oct 13');
    expect(lessonLabel(s(1, '2026-10-13', { subject: null }), '2026-10-01')).toBe('the lesson on Tue, Oct 13');
  });

  test('tasks set in a session, soonest due first', () => {
    const tasks = [
      { id: 1, session_id: 5, due_at: '2026-10-20T06:59:00Z' },
      { id: 2, session_id: 5, due_at: null },
      { id: 3, session_id: 6, due_at: '2026-10-10T06:59:00Z' },
      { id: 4, session_id: 5, due_at: '2026-10-15T06:59:00Z' },
      { id: 5, session_id: null },
    ];
    expect(homeworkFor(tasks, 5).map((t) => t.id)).toEqual([4, 1, 2]);
  });

  test('due the day before the next lesson with the same tutor', () => {
    const tue = s(1, '2026-10-13');
    const thu = s(2, '2026-10-15');
    const other = s(3, '2026-10-14', { tutor_id: 't2' });
    const off = s(4, '2026-10-14', { status: 'cancelled' });
    expect(homeworkDueKey(tue, [tue, thu, other, off])).toBe('2026-10-14');
    // The next lesson is the next day: due no earlier than that day
    const wed = s(5, '2026-10-14');
    expect(homeworkDueKey(tue, [tue, wed])).toBe('2026-10-14');
    // No next lesson: six days later
    expect(homeworkDueKey(thu, [thu])).toBe('2026-10-21');
  });
});
