import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SOURCE_ACCEPT, SOURCE_KINDS, SOURCE_MIME_TYPES, REFUSED, MAX_SOURCE_FILES, MAX_PDF_BYTES, MAX_DOC_BYTES, MAX_TOTAL_BYTES,
  MAX_PDF_PAGES, MAX_IMAGES, MAX_TEXT_CHARS, MAX_PASTED_NOTES, MAX_EMBEDDED_IMAGES, MAX_EMBEDDED_IMAGE_BYTES, MB,
  classifyFile, fileProblem, sourcesProblem, safeName, sourcePath, draftKey, SOURCE_PATH, pagesText, sizeText,
} from '../../portal/js/draft-sources-model.js';
import { MATERIAL_TYPES, materialType } from '../../portal/js/materials-model.js';

const file = (name, type = '', size = 1000) => ({ name, type, size });

describe('which files a draft takes', () => {
  test('the limits the owner set', () => {
    expect(MAX_SOURCE_FILES).toBe(10);
    expect(MAX_PDF_BYTES).toBe(20 * MB);
    expect(MAX_DOC_BYTES).toBe(15 * MB);
    expect(MAX_TOTAL_BYTES).toBe(25 * MB);
    expect(MAX_PDF_PAGES).toBe(100);
    expect(MAX_IMAGES).toBe(20);
    expect(MAX_TEXT_CHARS).toBe(100_000);
    expect(MAX_PASTED_NOTES).toBe(10_000);
    expect(MAX_EMBEDDED_IMAGES).toBe(8);
    expect(MAX_EMBEDDED_IMAGE_BYTES).toBe(Math.floor(3.5 * MB));
  });

  test('the picker offers every kind', () => {
    expect(SOURCE_ACCEPT).toBe('image/*,.heic,.heif,.pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.txt,.md,.csv,.html,.htm,.rtf');
  });

  test('by name first, then by the browser\'s type', () => {
    const kind = (name, type) => classifyFile(file(name, type)).kind;
    expect(kind('Whiteboard.JPG')).toBe('image');
    expect(kind('IMG_1.heic', '')).toBe('image');
    expect(classifyFile(file('IMG_1.HEIC')).heic).toBe(true);
    expect(classifyFile(file('photo', 'image/heif')).heic).toBe(true);
    expect(kind('scan', 'image/png')).toBe('image');
    expect(kind('Worksheet.pdf', '')).toBe('pdf');
    expect(kind('Notes.docx')).toBe('docx');
    expect(kind('Slides.pptx')).toBe('pptx');
    expect(kind('Grades.xlsx')).toBe('xlsx');
    expect(kind('a.odt')).toBe('odt');
    expect(kind('a.odp')).toBe('odp');
    expect(kind('a.ods')).toBe('ods');
    expect(kind('plan.txt')).toBe('text');
    expect(kind('plan.md')).toBe('markdown');
    expect(kind('scores.csv', 'application/vnd.ms-excel')).toBe('csv');   // Windows calls a CSV this
    expect(kind('page.htm')).toBe('html');
    expect(kind('letter.rtf')).toBe('rtf');
    expect(kind('pasted', 'text/plain')).toBe('text');
  });

  test('refused with a message: old Office formats, Apple iWork, anything else', () => {
    const why = (name, type) => classifyFile(file(name, type)).refused;
    expect(why('Lesson.doc')).toBe(REFUSED.doc);
    expect(why('Lesson.ppt')).toBe(REFUSED.ppt);
    expect(why('Lesson.xls')).toBe(REFUSED.xls);
    expect(why('x', 'application/msword')).toBe(REFUSED.doc);
    expect(why('Lesson.pages')).toBe(REFUSED.iwork);
    expect(why('Lesson.key')).toBe(REFUSED.iwork);
    expect(why('Lesson.numbers')).toBe(REFUSED.iwork);
    expect(why('archive.zip', 'application/zip')).toBe(REFUSED.unknown);
    expect(why('movie.mp4', 'video/mp4')).toBe(REFUSED.unknown);
    expect(REFUSED.doc).toBe('This older Word format (.doc) can’t be read. Save it as PDF or .docx and add it again.');
    expect(REFUSED.iwork).toBe('Pages, Keynote and Numbers files can’t be read. Export it as PDF and add it again.');
    expect(Object.values(REFUSED).join(' ')).not.toMatch(/[–—]|\bAI\b/);
  });

  test('each file\'s size, and all of them together', () => {
    expect(fileProblem(file('a.pdf', '', MAX_PDF_BYTES), 'pdf')).toBeNull();
    expect(fileProblem(file('a.pdf', '', MAX_PDF_BYTES + 1), 'pdf')).toBe('PDFs must be 20 MB or smaller. Split it, or save the pages you need as a new PDF.');
    expect(fileProblem(file('a.docx', '', MAX_DOC_BYTES + 1), 'docx')).toBe('Files like this must be 15 MB or smaller.');
    expect(fileProblem(file('a.jpg', '', 30 * MB), 'image')).toBeNull();   // made smaller before upload
    expect(fileProblem(file('a.txt', '', 0), 'text')).toBe(REFUSED.empty);
    const pdfs = (n, pages) => Array.from({ length: n }, () => ({ kind: 'pdf', bytes: MB, pages }));
    expect(sourcesProblem(pdfs(10, 10))).toBe('');
    expect(sourcesProblem(pdfs(11, 1))).toBe('Add at most 10 files to one draft.');
    expect(sourcesProblem([...pdfs(4, 25), { kind: 'pdf', bytes: MB, pages: 1 }])).toBe('These PDFs have 101 pages together. One draft can read 100 pages, so remove a PDF or use fewer pages.');
    expect(sourcesProblem([{ kind: 'pdf', bytes: 20 * MB, pages: 1 }, { kind: 'docx', bytes: 6 * MB }])).toBe('These files are 26 MB together. One draft can read 25 MB in all, so remove a file.');
    expect(sourcesProblem([{ kind: 'pdf', bytes: 2 * MB, pages: null }])).toBe('');
  });

  test('the bucket takes exactly the types the panel uploads, and the migration lists the same ones', () => {
    for (const k of Object.values(SOURCE_KINDS)) expect(SOURCE_MIME_TYPES).toContain(k.mime);
    const sql = readFileSync(new URL('../../supabase/migrations/20261027120000_draft_sources.sql', import.meta.url), 'utf8');
    const listed = [...sql.slice(sql.indexOf('array['), sql.indexOf('])')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...listed].sort()).toEqual([...SOURCE_MIME_TYPES].sort());
    expect(sql).toContain("values ('draft-sources', 'draft-sources', false, 26214400, array[");
  });

  test('what an assignment can hold as an attachment: photos, PDFs, Word and PowerPoint', () => {
    const attachable = Object.entries(SOURCE_KINDS).filter(([, k]) => materialType({ type: k.mime, name: '' })).map(([kind]) => kind);
    expect(attachable).toEqual(['image', 'pdf', 'docx', 'pptx']);
    expect(MATERIAL_TYPES['image/jpeg']).toBeTruthy();
  });
});

describe('where the files go', () => {
  const ME = '11111111-2222-4333-8444-555555555555';

  test('safe names keep the extension and only plain characters', () => {
    expect(safeName('Lesson 4: slides (final).pptx')).toBe('Lesson-4-slides-final.pptx');
    expect(safeName('Ünïcødé nötes.docx')).toBe('Unic-de-notes.docx');
    expect(safeName('???.pdf')).toBe('file.pdf');
    expect(safeName(`${'x'.repeat(300)}.txt`)).toHaveLength(95 - 3 + 4);
    expect(safeName('no extension')).toBe('no-extension');
  });

  test('<person>/<draft key>/<n>-<name>, and the server pattern agrees', () => {
    const key = draftKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(draftKey()).not.toBe(key);
    const path = sourcePath(ME, key, 3, 'Week 3 notes.docx');
    expect(path).toBe(`${ME}/${key}/3-Week-3-notes.docx`);
    expect(SOURCE_PATH.exec(path)?.[1]).toBe(ME);
    expect(SOURCE_PATH.test(`u-daniel/${key}/3-a.docx`)).toBe(false);
  });

  test('labels', () => {
    expect(pagesText(1)).toBe('1 page');
    expect(pagesText(12)).toBe('12 pages');
    expect(pagesText(null)).toBe('');
    expect(sizeText(850 * 1024)).toBe('850 KB');
    expect(sizeText(2.4 * MB)).toBe('2.4 MB');
    expect(sizeText(25 * MB)).toBe('25 MB');
  });
});
