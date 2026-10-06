import { describe, test, expect } from 'vitest';
import {
  KINDS, normalizeKind, fileKind, typeLabel, fileEntries, collapseRepeats, searchEntries, filterKind,
  kindCounts, countText, groupByMonth, libraryView, fileWhen, fromLabel, repeatsText,
} from '../../portal/js/files-model.js';
import { zonedIso } from '../../portal/js/dates.js';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const NOW = new Date(zonedIso('2026-10-14', '12:00'));
const due = (key) => zonedIso(key, '23:59');

let n = 0;
// A material row on an assignment, joined to its task like store.getFiles()
function row({ id = ++n, title = `File ${id}`, type = PDF, size = 24_000, url = null, taskId = 10, taskTitle = 'Fractions worksheet',
  kind = 'assignment', dueAt = due('2026-10-12'), taskMade = '2026-10-01T17:00:00Z', series = null, added = '2026-10-02T17:00:00Z' } = {}) {
  return {
    id, student_id: 's1', session_id: null, task_id: taskId, title,
    storage_path: url ? null : `s1/${id}.pdf`, file_type: url ? null : type, size_bytes: url ? null : size, url,
    created_by: 't1', created_at: added,
    task: { id: taskId, title: taskTitle, kind, due_at: dueAt, created_at: taskMade, series_id: series },
  };
}
const link = (o = {}) => row({ url: 'https://www.khanacademy.org/math/ratios', title: 'Khan Academy: ratios', ...o });

describe('kinds and labels', () => {
  test('the chips, in order, with All first', () => {
    expect(KINDS.map((k) => k.key)).toEqual(['all', 'pdf', 'image', 'link', 'other']);
    expect(KINDS.map((k) => k.label)).toEqual(['All', 'PDFs', 'Images', 'Links', 'Other']);
  });

  test('normalizeKind falls back to all', () => {
    expect(normalizeKind('pdf')).toBe('pdf');
    expect(normalizeKind('word')).toBe('all');
    expect(normalizeKind(undefined)).toBe('all');
    expect(normalizeKind('')).toBe('all');
  });

  test('every file type the bucket allows lands in a chip', () => {
    expect(fileKind({ storage_path: 'a', file_type: PDF })).toBe('pdf');
    expect(fileKind({ storage_path: 'a', file_type: 'image/png' })).toBe('image');
    expect(fileKind({ storage_path: 'a', file_type: 'image/jpeg' })).toBe('image');
    expect(fileKind({ storage_path: 'a', file_type: DOCX })).toBe('other');
    expect(fileKind({ storage_path: 'a', file_type: 'application/msword' })).toBe('other');
    expect(fileKind({ storage_path: 'a', file_type: PPTX })).toBe('other');
    expect(fileKind({ storage_path: 'a', file_type: 'application/vnd.ms-powerpoint' })).toBe('other');
    expect(fileKind({ url: 'https://example.com/x' })).toBe('link');
  });

  test('a type this page does not know is Other, never a crash', () => {
    expect(fileKind({ storage_path: 'a', file_type: 'application/zip' })).toBe('other');
    expect(fileKind({ storage_path: 'a', file_type: null })).toBe('other');
    expect(fileKind(null)).toBe('other');
  });

  test('type labels', () => {
    expect(typeLabel({ storage_path: 'a', file_type: PDF })).toBe('PDF');
    expect(typeLabel({ storage_path: 'a', file_type: 'image/jpeg' })).toBe('Image');
    expect(typeLabel({ storage_path: 'a', file_type: DOCX })).toBe('Word');
    expect(typeLabel({ storage_path: 'a', file_type: 'application/msword' })).toBe('Word');
    expect(typeLabel({ storage_path: 'a', file_type: PPTX })).toBe('PowerPoint');
    expect(typeLabel({ url: 'https://example.com' })).toBe('Link');
    expect(typeLabel({ storage_path: 'a', file_type: 'application/zip' })).toBe('File');
  });
});

describe('fileEntries', () => {
  test('one entry per material, with its assignment and a meta line', () => {
    const [e] = fileEntries([row({ id: 5, title: 'Fractions practice', size: 245_760 })]);
    expect(e).toMatchObject({
      id: 5, title: 'Fractions practice', kind: 'pdf', typeLabel: 'PDF', isLink: false, url: null,
      meta: 'PDF, 240 KB', undated: false, repeats: 0, month: '2026-10',
      task: { id: 10, title: 'Fractions worksheet', kind: 'assignment', dueAt: due('2026-10-12'), seriesId: null },
    });
    expect(e.material.id).toBe(5);
  });

  test('links say Link and where they go; a title that names the site shows the host', () => {
    const [a] = fileEntries([link()]);
    expect(a).toMatchObject({ kind: 'link', typeLabel: 'Link', isLink: true, url: 'https://www.khanacademy.org/math/ratios', meta: 'Link, Khan Academy' });
    const [b] = fileEntries([link({ title: 'Google Slides' }), ].map((r) => ({ ...r, url: 'https://docs.google.com/presentation/d/1/edit' })));
    expect(b.meta).toBe('Link, docs.google.com');
    const [c] = fileEntries([link({ title: 'Reading' })].map((r) => ({ ...r, url: 'https://example.org/read' })));
    expect(c.meta).toBe('Link, example.org');
  });

  test('materials on a lesson (no task) are not here', () => {
    const slides = { ...row({ id: 1 }), task_id: null, session_id: 77, task: null };
    expect(fileEntries([slides, row({ id: 2 })]).map((e) => e.id)).toEqual([2]);
  });

  test('a material whose assignment cannot be read is left out, as its drawer could not open', () => {
    const orphan = { ...row({ id: 1 }), task: null };
    expect(fileEntries([orphan, row({ id: 2 })]).map((e) => e.id)).toEqual([2]);
    expect(fileEntries([{ ...row({ id: 3 }), task: undefined }])).toEqual([]);
  });

  test('a to-one embed that arrives as an array is read', () => {
    const r = row({ id: 4 });
    expect(fileEntries([{ ...r, task: [r.task] }])).toHaveLength(1);
    expect(fileEntries([{ ...r, task: [] }])).toEqual([]);
  });

  test('tasks are told apart from assignments; an unknown kind reads as an assignment', () => {
    expect(fileEntries([row({ kind: 'task' })])[0].task.kind).toBe('task');
    expect(fileEntries([row({ kind: 'assignment' })])[0].task.kind).toBe('assignment');
    expect(fileEntries([row({ kind: 'weird' })])[0].task.kind).toBe('assignment');
  });

  test('blank titles get a name rather than an empty row', () => {
    const [e] = fileEntries([{ ...row({ id: 1 }), title: '   ', task: { ...row().task, title: '' } }]);
    expect(e.title).toBe('Untitled file');
    expect(e.task.title).toBe('Untitled');
  });

  test('an undated assignment is placed by when it was created', () => {
    const [e] = fileEntries([row({ dueAt: null, taskMade: '2026-09-03T18:00:00Z' })]);
    expect(e).toMatchObject({ undated: true, month: '2026-09', at: '2026-09-03T18:00:00Z' });
    expect(e.task.dueAt).toBeNull();
  });

  test('with no due date and no created date, the file added decides', () => {
    const r = row({ dueAt: null, added: '2026-08-20T20:00:00Z' });
    r.task.created_at = null;
    expect(fileEntries([r])[0]).toMatchObject({ month: '2026-08', undated: true });
  });

  test('the month follows the business clock: due 11:59 pm Pacific on Oct 31 is October', () => {
    expect(fileEntries([row({ dueAt: '2026-11-01T06:59:00Z' })])[0].month).toBe('2026-10');
    expect(fileEntries([row({ dueAt: '2026-11-01T07:00:00Z' })])[0].month).toBe('2026-11');
  });

  test('newest assignment first, and the files of one assignment together in the order attached', () => {
    const rows = [
      row({ id: 1, taskId: 1, dueAt: due('2026-10-05') }),
      row({ id: 2, taskId: 2, dueAt: due('2026-10-12'), added: '2026-10-03T10:00:00Z' }),
      row({ id: 3, taskId: 3, dueAt: due('2026-10-12'), added: '2026-10-01T10:00:00Z' }),
      row({ id: 4, taskId: 2, dueAt: due('2026-10-12'), added: '2026-10-02T10:00:00Z' }),
      row({ id: 5, taskId: 2, dueAt: due('2026-10-12'), added: '2026-10-02T10:00:00Z' }),
    ];
    // Assignment 3 is newer than 2 (same day), so it leads; 2's files keep their attach order
    expect(fileEntries(rows).map((e) => e.id)).toEqual([3, 4, 5, 2, 1]);
  });

  test('nothing in, nothing out', () => {
    expect(fileEntries([])).toEqual([]);
    expect(fileEntries(null)).toEqual([]);
    expect(fileEntries(undefined)).toEqual([]);
  });

  test('does not change the rows it is given', () => {
    const rows = [row({ id: 1 }), row({ id: 2, dueAt: due('2026-10-20') })];
    const copy = JSON.parse(JSON.stringify(rows));
    fileEntries(rows);
    expect(rows).toEqual(copy);
  });
});

describe('collapseRepeats', () => {
  // Four weekly copies of one packet, each with its own file, plus an unrelated file on each
  const weekly = (series, keys, extra = {}) => keys.map((k, i) => row({
    id: 100 + i + (extra.base ?? 0), title: extra.title ?? 'Weekly packet', series, taskId: 200 + i + (extra.base ?? 0),
    taskTitle: 'Weekly packet', dueAt: due(k), size: extra.size ?? 50_000, url: extra.url ?? null,
  }));

  test('the copy due next stands for its series', () => {
    const entries = fileEntries(weekly('A', ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28']));
    const out = collapseRepeats(entries, NOW);   // Oct 14 noon: the 14th is due tonight
    expect(out).toHaveLength(1);
    expect(out[0].task.dueAt).toBe(due('2026-10-14'));
    expect(out[0].repeats).toBe(3);
  });

  test('when every copy is past, the latest stands', () => {
    const entries = fileEntries(weekly('A', ['2026-09-02', '2026-09-09', '2026-09-16']));
    const out = collapseRepeats(entries, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].task.dueAt).toBe(due('2026-09-16'));
    expect(out[0].repeats).toBe(2);
  });

  test('when every copy is ahead, the soonest stands', () => {
    const entries = fileEntries(weekly('A', ['2026-11-04', '2026-11-11']));
    expect(collapseRepeats(entries, NOW)[0].task.dueAt).toBe(due('2026-11-04'));
  });

  test('a copy due tonight is still next; once its time passes the following copy is', () => {
    const keys = ['2026-10-13', '2026-10-14', '2026-10-21'];
    const stood = (at) => collapseRepeats(fileEntries(weekly('A', keys)), new Date(at))[0].task.dueAt;
    expect(stood(zonedIso('2026-10-14', '23:00'))).toBe(due('2026-10-14'));
    expect(stood(zonedIso('2026-10-15', '00:30'))).toBe(due('2026-10-21'));
  });

  test('files that differ stay apart: another name, another size, another link', () => {
    const entries = fileEntries([
      ...weekly('A', ['2026-10-07', '2026-10-14']),
      ...weekly('A', ['2026-10-07', '2026-10-14'], { title: 'Answer key', base: 10 }),
      ...weekly('A', ['2026-10-07', '2026-10-14'], { size: 99, base: 20 }),
    ]);
    const out = collapseRepeats(entries, NOW);
    expect(out).toHaveLength(3);
    expect(out.every((e) => e.repeats === 1)).toBe(true);
  });

  test('names are compared without regard to case', () => {
    const a = row({ id: 1, series: 'A', title: 'Weekly Packet', taskId: 1, dueAt: due('2026-10-07') });
    const b = row({ id: 2, series: 'A', title: 'weekly packet', taskId: 2, dueAt: due('2026-10-14') });
    expect(collapseRepeats(fileEntries([a, b]), NOW)).toHaveLength(1);
  });

  test('links collapse by address', () => {
    const entries = fileEntries([
      ...weekly('A', ['2026-10-07', '2026-10-14'], { title: 'Khan Academy', url: 'https://www.khanacademy.org/a' }),
      ...weekly('A', ['2026-10-07', '2026-10-14'], { title: 'Khan Academy', url: 'https://www.khanacademy.org/b', base: 10 }),
    ]);
    const out = collapseRepeats(entries, NOW);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.url).sort()).toEqual(['https://www.khanacademy.org/a', 'https://www.khanacademy.org/b']);
  });

  test('different series never merge, and work outside a series is untouched', () => {
    const entries = fileEntries([
      ...weekly('A', ['2026-10-07', '2026-10-14']),
      ...weekly('B', ['2026-10-07', '2026-10-14'], { base: 10 }),
      row({ id: 900, taskId: 900 }),
      row({ id: 901, taskId: 901 }),
    ]);
    const out = collapseRepeats(entries, NOW);
    expect(out).toHaveLength(4);
    expect(out.filter((e) => e.task.seriesId === null).every((e) => e.repeats === 0)).toBe(true);
  });

  test('a series of one has nothing to collapse', () => {
    const out = collapseRepeats(fileEntries(weekly('A', ['2026-10-07'])), NOW);
    expect(out).toHaveLength(1);
    expect(out[0].repeats).toBe(0);
  });

  test('the result is newest first again, and the input is not changed', () => {
    const entries = fileEntries([
      ...weekly('A', ['2026-09-02', '2026-09-09']),
      row({ id: 900, taskId: 900, dueAt: due('2026-10-12') }),
    ]);
    const before = entries.map((e) => e.id);
    expect(collapseRepeats(entries, NOW).map((e) => e.id)).toEqual([900, 101]);
    expect(entries.map((e) => e.id)).toEqual(before);
    expect(entries.every((e) => e.repeats === 0)).toBe(true);
  });

  test('repeatsText', () => {
    expect(repeatsText({ repeats: 0 })).toBe('');
    expect(repeatsText({ repeats: 1 })).toBe('+1 repeat');
    expect(repeatsText({ repeats: 7 })).toBe('+7 repeats');
  });
});

describe('search', () => {
  const entries = fileEntries([
    row({ id: 1, title: 'Fractions practice', taskTitle: 'Fractions worksheet' }),
    row({ id: 2, title: 'Photo of the board', type: 'image/png', taskTitle: 'Systems of equations' , taskId: 11 }),
    link({ id: 3, taskTitle: 'Ratio word problems', taskId: 12 }),
    row({ id: 4, title: 'Essay outline', type: DOCX, taskTitle: 'Persuasive essay draft', taskId: 13 }),
  ]);
  const ids = (list) => list.map((e) => e.id).sort();

  test('a blank search keeps everything', () => {
    expect(searchEntries(entries, '')).toHaveLength(4);
    expect(searchEntries(entries, '   ')).toHaveLength(4);
    expect(searchEntries(entries, undefined)).toHaveLength(4);
  });

  test('matches the file name, ignoring case', () => {
    expect(ids(searchEntries(entries, 'PHOTO'))).toEqual([2]);
    expect(ids(searchEntries(entries, 'outline'))).toEqual([4]);
  });

  test('matches a link title', () => {
    expect(ids(searchEntries(entries, 'khan'))).toEqual([3]);
  });

  test('matches the assignment title', () => {
    expect(ids(searchEntries(entries, 'systems'))).toEqual([2]);
    expect(ids(searchEntries(entries, 'persuasive'))).toEqual([4]);
  });

  test('every word must match, in any order, across name and assignment', () => {
    expect(ids(searchEntries(entries, 'fractions worksheet'))).toEqual([1]);
    expect(ids(searchEntries(entries, 'worksheet fractions'))).toEqual([1]);
    expect(ids(searchEntries(entries, 'practice worksheet'))).toEqual([1]);
    expect(ids(searchEntries(entries, 'photo worksheet'))).toEqual([]);
  });

  test('extra spaces do not matter', () => {
    expect(ids(searchEntries(entries, '  fractions    practice '))).toEqual([1]);
  });

  test('does not look at the file type or the link address', () => {
    expect(searchEntries(entries, 'pdf')).toEqual([]);
    expect(searchEntries(entries, 'https')).toEqual([]);
  });

  test('nothing matches nothing', () => {
    expect(searchEntries(entries, 'zzz')).toEqual([]);
  });

  test('special characters are plain text, not patterns', () => {
    expect(searchEntries(entries, '.*')).toEqual([]);
    expect(searchEntries(entries, '(')).toEqual([]);
    expect(searchEntries(entries, ':')).toHaveLength(1);   // "Khan Academy: ratios"
  });
});

describe('type chips and counts', () => {
  const entries = fileEntries([
    row({ id: 1, taskId: 1 }), row({ id: 2, taskId: 2 }), row({ id: 3, taskId: 3, type: 'image/jpeg' }),
    link({ id: 4, taskId: 4 }), link({ id: 5, taskId: 5 }), link({ id: 6, taskId: 6 }),
    row({ id: 7, taskId: 7, type: DOCX }), row({ id: 8, taskId: 8, type: PPTX }),
  ]);

  test('counts per chip add up to All', () => {
    expect(kindCounts(entries)).toEqual({ all: 8, pdf: 2, image: 1, link: 3, other: 2 });
    expect(kindCounts([])).toEqual({ all: 0, pdf: 0, image: 0, link: 0, other: 0 });
    expect(kindCounts(null)).toEqual({ all: 0, pdf: 0, image: 0, link: 0, other: 0 });
  });

  test('each chip keeps only its type; All and unknown keys keep everything', () => {
    expect(filterKind(entries, 'pdf').map((e) => e.id).sort()).toEqual([1, 2]);
    expect(filterKind(entries, 'image').map((e) => e.id)).toEqual([3]);
    expect(filterKind(entries, 'link')).toHaveLength(3);
    expect(filterKind(entries, 'other').map((e) => e.id).sort()).toEqual([7, 8]);
    expect(filterKind(entries, 'all')).toHaveLength(8);
    expect(filterKind(entries, 'nonsense')).toHaveLength(8);
  });

  test('countText', () => {
    expect(countText(12, 12)).toBe('12 files');
    expect(countText(1, 1)).toBe('1 file');
    expect(countText(0, 0)).toBe('0 files');
    expect(countText(3, 12)).toBe('3 of 12 files');
    expect(countText(0, 1)).toBe('0 of 1 file');
  });
});

describe('groupByMonth', () => {
  test('newest month first, newest file first inside, labelled with the month and year', () => {
    const entries = fileEntries([
      row({ id: 1, dueAt: due('2026-09-30') }),
      row({ id: 2, dueAt: due('2026-10-02') }),
      row({ id: 3, dueAt: due('2026-10-20') }),
      row({ id: 4, dueAt: due('2026-08-15') }),
      row({ id: 5, dueAt: due('2027-01-05') }),
    ]);
    const groups = groupByMonth(entries);
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['2027-01', 'January 2027'], ['2026-10', 'October 2026'], ['2026-09', 'September 2026'], ['2026-08', 'August 2026'],
    ]);
    expect(groups[1].entries.map((e) => e.id)).toEqual([3, 2]);
  });

  test('undated work sits in the month it was made', () => {
    const groups = groupByMonth(fileEntries([
      row({ id: 1, dueAt: null, taskMade: '2026-09-03T18:00:00Z' }),
      row({ id: 2, dueAt: due('2026-09-20') }),
    ]));
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.id)).toEqual([2, 1]);
  });

  test('empty in, empty out', () => {
    expect(groupByMonth([])).toEqual([]);
    expect(groupByMonth(null)).toEqual([]);
  });
});

describe('libraryView', () => {
  const entries = fileEntries([
    row({ id: 1, taskId: 1, title: 'Ratio sheet', taskTitle: 'Ratios', dueAt: due('2026-10-05') }),
    row({ id: 2, taskId: 2, title: 'Ratio photo', taskTitle: 'Ratios', type: 'image/png', dueAt: due('2026-10-05') }),
    link({ id: 3, taskId: 3, title: 'Khan: ratios', taskTitle: 'Ratios', dueAt: due('2026-09-14') }),
    row({ id: 4, taskId: 4, title: 'Essay outline', taskTitle: 'Essay', type: DOCX, dueAt: due('2026-09-20') }),
  ]);

  test('no search and All: everything, grouped', () => {
    const v = libraryView(entries);
    expect(v).toMatchObject({ shown: 4, total: 4, filtered: false, counts: { all: 4, pdf: 1, image: 1, link: 1, other: 1 } });
    expect(v.groups.map((g) => g.key)).toEqual(['2026-10', '2026-09']);
  });

  test('a search narrows the list and the chip counts together', () => {
    const v = libraryView(entries, { query: 'ratio' });
    expect(v).toMatchObject({ shown: 3, total: 4, filtered: true, counts: { all: 3, pdf: 1, image: 1, link: 1, other: 0 } });
  });

  test('a chip narrows the list but not the counts, so the other chips stay pressable', () => {
    const v = libraryView(entries, { kind: 'image' });
    expect(v).toMatchObject({ shown: 1, total: 4, filtered: true, counts: { all: 4, pdf: 1, image: 1, link: 1, other: 1 } });
    expect(v.groups).toHaveLength(1);
    expect(v.groups[0].entries[0].id).toBe(2);
  });

  test('search and chip combine', () => {
    const v = libraryView(entries, { query: 'ratio', kind: 'link' });
    expect(v.shown).toBe(1);
    expect(v.groups[0].entries[0].id).toBe(3);
    expect(v.counts.all).toBe(3);
    expect(libraryView(entries, { query: 'essay', kind: 'link' }).shown).toBe(0);
  });

  test('no match gives no groups, still counting the library', () => {
    expect(libraryView(entries, { query: 'zzz' })).toMatchObject({ groups: [], shown: 0, total: 4, filtered: true });
  });

  test('an unknown chip is All and does not count as filtering', () => {
    expect(libraryView(entries, { kind: 'bogus' })).toMatchObject({ shown: 4, filtered: false });
  });

  test('an empty library', () => {
    expect(libraryView([])).toMatchObject({ groups: [], shown: 0, total: 0, filtered: false, counts: { all: 0 } });
  });
});

describe('row text', () => {
  test('dated work says when it is due', () => {
    const [e] = fileEntries([row({ dueAt: due('2026-10-12') })]);
    expect(fileWhen(e, NOW)).toBe('Due Mon, Oct 12');
  });

  test('undated work says when it was added', () => {
    const [e] = fileEntries([row({ dueAt: null, taskMade: '2026-10-03T18:00:00Z' })]);
    expect(fileWhen(e, NOW)).toBe('Added Sat, Oct 3');
  });

  test('another year shows the year', () => {
    const [e] = fileEntries([row({ dueAt: due('2025-12-01') })]);
    expect(fileWhen(e, NOW)).toBe('Due Mon, Dec 1, 2025');
  });

  test('the assignment is called by its kind', () => {
    expect(fromLabel(fileEntries([row({ kind: 'assignment' })])[0])).toBe('assignment');
    expect(fromLabel(fileEntries([row({ kind: 'task' })])[0])).toBe('task');
  });
});
