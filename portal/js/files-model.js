// Pure logic for the Files page (#/files): every worksheet, PDF and link a tutor
// attached to one student's assignments and tasks, in one searchable list. No DOM.
//
// Input rows come from store.getFiles(): a material row (materials-model.js)
// with its assignment embedded as `task` ({ id, title, kind, due_at,
// created_at, series_id }). Only materials on assignments and tasks belong
// here. Slides on a lesson (session_id) are not listed, and a student's own
// submission files live in another table, so they never reach this module.
//
// The assignment drawer shows a task's materials with materialsFor(list,
// { taskId }) and nothing else: no draft or unreleased state exists for
// tasks or materials, and row level security already limits who reads what.
// So the library is exactly the union of what each assignment's drawer would
// show; a material whose assignment cannot be read is left out, because its
// drawer could not open either.
//
//   fileEntries(rows)              rows -> entries, newest first
//   collapseRepeats(entries, now)  one entry per file of a repeating series
//   libraryView(entries, { query, kind, now })
//                                  { groups, counts, shown, total, filtered }
//   groupByMonth(entries)          [{ key: '2026-10', label: 'October 2026', entries }]
//   searchEntries / filterKind / kindCounts / countText / fileWhen / fromLabel

import { dayKey, todayKey, monthTitle } from './dates.js';
import { one } from './format.js';
import { MATERIAL_TYPES, isLink, materialMeta } from './materials-model.js';
import { shortDayText } from './sessions-model.js';

// The type chips, in order. 'all' is every file; 'other' is Word, PowerPoint
// and anything not named by another chip.
export const KINDS = Object.freeze([
  Object.freeze({ key: 'all', label: 'All' }),
  Object.freeze({ key: 'pdf', label: 'PDFs' }),
  Object.freeze({ key: 'image', label: 'Images' }),
  Object.freeze({ key: 'link', label: 'Links' }),
  Object.freeze({ key: 'other', label: 'Other' }),
]);

const KIND_KEYS = new Set(KINDS.map((k) => k.key));

const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));
const blank = (v) => v === null || v === undefined || String(v).trim() === '';

// An unknown chip key (a stale value) means All
export function normalizeKind(kind) {
  return KIND_KEYS.has(kind) ? kind : 'all';
}

// 'pdf' | 'image' | 'link' | 'other' for a material row
export function fileKind(material) {
  if (isLink(material)) return 'link';
  const type = String(material?.file_type ?? '');
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/')) return 'image';
  return 'other';
}

// "PDF", "Image", "Word", "PowerPoint", "Link"; "File" for a type this page
// does not know
export function typeLabel(material) {
  if (isLink(material)) return 'Link';
  return MATERIAL_TYPES[material?.file_type]?.label ?? 'File';
}

// "PDF, 240 KB" for a file; "Link, Google Slides" (or the host) for a link
function metaOf(material) {
  const detail = materialMeta(material);
  if (!isLink(material)) return detail;
  return detail === 'Link' ? 'Link' : `Link, ${detail}`;
}

// ---------------------------------------------------------------------------
// Entries

// Newest assignment first (by its day, then by when it was made), and the
// files of one assignment together, in the order they were attached
function byNewest(a, b) {
  return (ms(b.at) - ms(a.at))
    || (Number(b.task.id) - Number(a.task.id))
    || (ms(a.material.created_at ?? 0) - ms(b.material.created_at ?? 0))
    || (Number(a.id) - Number(b.id));
}

// One entry per material on an assignment or task, newest first:
// { id, material, title, kind, typeLabel, isLink, url, meta,
//   task: { id, title, kind, dueAt, createdAt, seriesId },
//   at, month, undated, repeats }
//   at       the assignment's due date, or its created date when it has none
//   month    '2026-10' of `at` on the business clock
//   repeats  other copies of a repeating series this entry stands for (0 here)
export function fileEntries(rows) {
  const entries = [];
  for (const row of rows ?? []) {
    if (row?.task_id === null || row?.task_id === undefined) continue;
    const task = one(row.task);
    if (!task) continue;
    const at = task.due_at ?? task.created_at ?? row.created_at;
    const key = dayKey(at);
    if (!key) continue;
    entries.push({
      id: row.id,
      material: row,
      title: blank(row.title) ? 'Untitled file' : String(row.title).trim(),
      kind: fileKind(row),
      typeLabel: typeLabel(row),
      isLink: isLink(row),
      url: row.url ?? null,
      meta: metaOf(row),
      task: {
        id: task.id,
        title: blank(task.title) ? 'Untitled' : String(task.title).trim(),
        kind: task.kind === 'task' ? 'task' : 'assignment',
        dueAt: task.due_at ?? null,
        createdAt: task.created_at ?? null,
        seriesId: task.series_id ?? null,
      },
      at,
      month: key.slice(0, 7),
      undated: !task.due_at,
      repeats: 0,
    });
  }
  return entries.sort(byNewest);
}

// A repeat makes a copy of the assignment, and of every file on it, for each
// day. Listing them all would bury the one worksheet a student wants under
// dozens of twins, so one entry stands for the files of a series that share a
// name and content: the copy due next, or the latest one when all are past.
// `repeats` says how many other copies it stands for.
export function collapseRepeats(entries, now = new Date()) {
  const nowMs = ms(now);
  const out = [];
  const series = new Map();
  for (const e of entries ?? []) {
    if (e.task.seriesId === null || e.task.seriesId === undefined) {
      out.push(e);
      continue;
    }
    const content = e.isLink ? e.url : `${e.material.file_type}:${e.material.size_bytes}`;
    const key = JSON.stringify([e.task.seriesId, e.title.toLowerCase(), content]);
    if (!series.has(key)) series.set(key, []);
    series.get(key).push(e);
  }
  for (const copies of series.values()) {
    const oldestFirst = [...copies].sort((a, b) => -byNewest(a, b));
    const stand = oldestFirst.find((e) => ms(e.at) >= nowMs) ?? oldestFirst.at(-1);
    out.push({ ...stand, repeats: copies.length - 1 });
  }
  return out.sort(byNewest);
}

// ---------------------------------------------------------------------------
// Search, type chips, counts

const words = (text) => String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);

// Every word typed must appear in the file's name or link title, or in the
// assignment's title (any order, any case)
export function searchEntries(entries, query) {
  const terms = words(query);
  if (!terms.length) return [...(entries ?? [])];
  return (entries ?? []).filter((e) => {
    const haystack = `${e.title} ${e.task.title}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

export function filterKind(entries, kind) {
  const key = normalizeKind(kind);
  return key === 'all' ? [...(entries ?? [])] : (entries ?? []).filter((e) => e.kind === key);
}

// { all, pdf, image, link, other }
export function kindCounts(entries) {
  const counts = { all: 0, pdf: 0, image: 0, link: 0, other: 0 };
  for (const e of entries ?? []) {
    counts.all += 1;
    counts[e.kind] += 1;
  }
  return counts;
}

// "12 files", "1 file", "3 of 12 files"
export function countText(shown, total) {
  const noun = total === 1 ? 'file' : 'files';
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}

// ---------------------------------------------------------------------------
// Months

// [{ key, label, entries }], the newest month first and each month's entries
// newest first. Upcoming months come first, like any "newest first" list.
export function groupByMonth(entries) {
  const groups = new Map();
  for (const e of [...(entries ?? [])].sort(byNewest)) {
    if (!groups.has(e.month)) groups.set(e.month, { key: e.month, label: monthTitle(e.month), entries: [] });
    groups.get(e.month).entries.push(e);
  }
  return [...groups.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

// What the page draws for the current search and chip:
//   counts    per chip, for the files that match the search (so the chips
//             always add up to what All says)
//   shown     entries after both the search and the chip
//   filtered  true when a search or a chip narrows the list
//   total     every entry, however filtered
export function libraryView(entries, { query = '', kind = 'all' } = {}) {
  const matching = searchEntries(entries, query);
  const key = normalizeKind(kind);
  const shown = filterKind(matching, key);
  return {
    groups: groupByMonth(shown),
    counts: kindCounts(matching),
    shown: shown.length,
    total: (entries ?? []).length,
    filtered: words(query).length > 0 || key !== 'all',
  };
}

// ---------------------------------------------------------------------------
// Row text

// "Due Mon, Oct 12" for dated work; "Added Mon, Oct 12" for undated work (the
// year shows only when it is not this year)
export function fileWhen(entry, now = new Date()) {
  const today = todayKey(now);
  if (entry.undated) {
    const added = dayKey(entry.task.createdAt ?? entry.at);
    return `Added ${shortDayText(added, today)}`;
  }
  return `Due ${shortDayText(dayKey(entry.task.dueAt), today)}`;
}

// "assignment" or "task", for "Open assignment <title>"
export function fromLabel(entry) {
  return entry.task.kind === 'task' ? 'task' : 'assignment';
}

// "+3 repeats" next to an entry that stands for copies of a series, else ''
export function repeatsText(entry) {
  const n = entry.repeats;
  return n > 0 ? `+${n} ${n === 1 ? 'repeat' : 'repeats'}` : '';
}
