// What a student has attached to a submission, as a list of files, and the
// rules for changing it. Pure (no DOM), so the rules are tested in node.
//
// The list is either
//   one file of any allowed type (a PDF, a text file, or a single photo), or
//   up to MAX_PAGES photos (JPG or PNG): the pages of one handwritten answer.
// Two or more photos are combined into one PDF when the work is submitted
// (upload.js, pdf-pack.js); one photo is sent as it is.

import { validateUpload } from './upload.js';

export const MAX_PAGES = 10;

export const isPhoto = (file) => file?.type === 'image/png' || file?.type === 'image/jpeg';

// True for a list of one or more photos, the list that shows as pages
export const isPages = (files) => files.length > 0 && files.every(isPhoto);

export const pagesText = (n) => `${n} ${n === 1 ? 'page' : 'pages'}`;

const MIXED = 'Photos are combined into one PDF, so a PDF or text file can’t be added with them. Choose photos only, or just the one file.';
const ONE_FILE = 'Attach one PDF or text file, or several photos.';
const REMOVE_FIRST = 'Remove your photos first to attach a PDF or text file instead.';

function tooMany(have, max) {
  if (have === 0) return `A submission can have up to ${max} pages. Choose ${max} photos or fewer.`;
  if (have >= max) return `A submission can have up to ${max} pages, and you already have ${max}. Remove one to add another.`;
  return `A submission can have up to ${max} pages. You have ${have}, so you can add ${max - have} more.`;
}

// Adds chosen, dropped or pasted files to the list.
//   -> { files, added, problem }
// With a problem nothing changes (files is `current` and added is 0): either
// every file goes in or none does, and the message says why.
//   photos            join the photos already there (up to max in all); if the
//                     list held one other file, the photos replace it
//   one other file    replaces a single file or photo; it is refused while
//                     there are two or more photos, so pages are never lost
//   anything else     (several other files, or photos mixed with other
//                     files) is refused
export function addFiles(current, incoming, { max = MAX_PAGES, validate = validateUpload } = {}) {
  const list = [...incoming];
  const refuse = (problem) => ({ files: current, added: 0, problem });
  if (!list.length) return { files: current, added: 0, problem: null };

  for (const file of list) {
    const problem = validate(file);
    if (problem) return refuse(list.length > 1 ? `${file.name || 'A file'}: ${problem}` : problem);
  }

  const photos = list.filter(isPhoto);
  if (photos.length && photos.length < list.length) return refuse(MIXED);

  if (!photos.length) {
    if (list.length > 1) return refuse(ONE_FILE);
    if (current.length > 1 && isPages(current)) return refuse(REMOVE_FIRST);
    return { files: list, added: 1, problem: null };
  }

  const base = isPages(current) ? current : [];
  if (base.length + photos.length > max) return refuse(tooMany(base.length, max));
  return { files: [...base, ...photos], added: photos.length, problem: null };
}

export function removeAt(files, index) {
  if (!Number.isInteger(index) || index < 0 || index >= files.length) return files;
  return files.filter((_, i) => i !== index);
}

// Moves the file at `index` one place earlier (delta -1) or later (delta 1).
// Returns { files, index }: the new list and where the file is now.
export function moveBy(files, index, delta) {
  const to = index + delta;
  if (!Number.isInteger(index) || index < 0 || index >= files.length || to < 0 || to >= files.length) return { files, index };
  const next = [...files];
  [next[index], next[to]] = [next[to], next[index]];
  return { files: next, index: to };
}

// What a screen reader is told after each change
export const said = {
  added: (added, total) => `${added === 1 ? '1 page' : `${added} pages`} added. ${pagesText(total)} in all.`,
  removed: (index, left) => (left ? `Page ${index + 1} removed. ${pagesText(left)} left.` : `Page ${index + 1} removed. No pages left.`),
  moved: (to, total) => `Moved to page ${to + 1} of ${total}.`,
};
