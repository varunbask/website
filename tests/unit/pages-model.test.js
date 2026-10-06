import { describe, test, expect } from 'vitest';
import { addFiles, removeAt, moveBy, isPages, isPhoto, pagesText, said, MAX_PAGES } from '../../portal/js/pages-model.js';
import { MAX_UPLOAD_BYTES } from '../../portal/js/upload.js';

const file = (name, type = 'image/jpeg', size = 100) => new File([new Uint8Array(size)], name, { type });
const photo = (name) => file(name, 'image/jpeg');
const png = (name) => file(name, 'image/png');
const pdf = (name = 'work.pdf') => file(name, 'application/pdf');
const txt = (name = 'work.txt') => file(name, 'text/plain');
const names = (files) => files.map((f) => f.name);
const photos = (n, from = 1) => Array.from({ length: n }, (_, i) => photo(`p${from + i}.jpg`));

describe('what counts as pages', () => {
  test('photos are JPG or PNG; a list of photos is pages', () => {
    expect(isPhoto(photo('a'))).toBe(true);
    expect(isPhoto(png('a'))).toBe(true);
    expect(isPhoto(pdf())).toBe(false);
    expect(isPhoto(txt())).toBe(false);
    expect(isPhoto(undefined)).toBe(false);
    expect(isPages([])).toBe(false);
    expect(isPages([photo('a'), png('b')])).toBe(true);
    expect(isPages([pdf()])).toBe(false);
    expect(isPages([photo('a'), pdf()])).toBe(false);
  });

  test('page counts read as words', () => {
    expect(pagesText(1)).toBe('1 page');
    expect(pagesText(2)).toBe('2 pages');
    expect(pagesText(0)).toBe('0 pages');
  });
});

describe('addFiles: photos', () => {
  test('several photos at once become pages in the order chosen', () => {
    const r = addFiles([], [photo('a'), png('b'), photo('c')]);
    expect(r).toMatchObject({ added: 3, problem: null });
    expect(names(r.files)).toEqual(['a', 'b', 'c']);
  });

  test('more photos join the ones already there, after them', () => {
    const first = addFiles([], [photo('a'), photo('b')]).files;
    const r = addFiles(first, [photo('c')]);
    expect(names(r.files)).toEqual(['a', 'b', 'c']);
    expect(r.added).toBe(1);
  });

  test('a single photo is a list of one page', () => {
    const r = addFiles([], [photo('a')]);
    expect(r.files).toHaveLength(1);
    expect(isPages(r.files)).toBe(true);
  });

  test('photos replace a single PDF or text file', () => {
    expect(names(addFiles([pdf('old.pdf')], [photo('a'), photo('b')]).files)).toEqual(['a', 'b']);
    expect(names(addFiles([txt('old.txt')], [photo('a')]).files)).toEqual(['a']);
  });

  test('the cap is ten pages and nothing is added past it', () => {
    expect(MAX_PAGES).toBe(10);
    expect(addFiles([], photos(10)).files).toHaveLength(10);

    const nine = photos(9);
    const refused = addFiles(nine, photos(2, 10));
    expect(refused.files).toBe(nine);
    expect(refused.added).toBe(0);
    expect(refused.problem).toBe('A submission can have up to 10 pages. You have 9, so you can add 1 more.');

    expect(addFiles(photos(10), [photo('x')]).problem).toMatch(/already have 10\. Remove one/);
    expect(addFiles([], photos(11)).problem).toBe('A submission can have up to 10 pages. Choose 10 photos or fewer.');
  });

  test('the cap can be changed', () => {
    expect(addFiles(photos(2), [photo('x')], { max: 2 }).problem).toMatch(/up to 2 pages/);
  });
});

describe('addFiles: other files', () => {
  test('one PDF or text file becomes the file', () => {
    const r = addFiles([], [pdf()]);
    expect(names(r.files)).toEqual(['work.pdf']);
    expect(r).toMatchObject({ added: 1, problem: null });
    expect(names(addFiles([], [txt()]).files)).toEqual(['work.txt']);
  });

  test('one file replaces the one file already chosen, photo or not', () => {
    expect(names(addFiles([pdf('a.pdf')], [pdf('b.pdf')]).files)).toEqual(['b.pdf']);
    expect(names(addFiles([photo('p')], [pdf('b.pdf')]).files)).toEqual(['b.pdf']);
  });

  test('a PDF is refused while two or more photos are attached, so no page is lost', () => {
    const pages = photos(2);
    const r = addFiles(pages, [pdf()]);
    expect(r.files).toBe(pages);
    expect(r.problem).toMatch(/Remove your photos first/);
  });

  test('several PDFs or text files at once are refused', () => {
    const r = addFiles([], [pdf('a.pdf'), pdf('b.pdf')]);
    expect(r.files).toEqual([]);
    expect(r.problem).toBe('Attach one PDF or text file, or several photos.');
  });

  test('photos mixed with a PDF or text file are refused, whole', () => {
    const r = addFiles([], [photo('a'), pdf(), photo('b')]);
    expect(r.files).toEqual([]);
    expect(r.added).toBe(0);
    expect(r.problem).toMatch(/PDF or text file can’t be added with them/);
    expect(addFiles(photos(1), [photo('x'), txt()]).problem).toMatch(/can’t be added with them/);
  });
});

describe('addFiles: invalid files', () => {
  test('a file that cannot be uploaded is refused with the upload message', () => {
    const heic = file('IMG.heic', 'image/heic');
    expect(addFiles([], [heic]).problem).toMatch(/PDF, a photo/);
    expect(addFiles([], [file('e.jpg', 'image/jpeg', 0)]).problem).toMatch(/empty/);
    expect(addFiles([], [file('big.jpg', 'image/jpeg', MAX_UPLOAD_BYTES + 1)]).problem).toMatch(/20 MB/);
  });

  test('with several files, the message names the one that failed and none are added', () => {
    const current = photos(1);
    const r = addFiles(current, [photo('ok.jpg'), file('IMG_7.heic', 'image/heic')]);
    expect(r.problem).toBe('IMG_7.heic: Upload a PDF, a photo (JPG or PNG), or a text file.');
    expect(r.files).toBe(current);
    expect(r.added).toBe(0);
  });

  test('choosing nothing changes nothing', () => {
    const current = photos(2);
    expect(addFiles(current, [])).toEqual({ files: current, added: 0, problem: null });
  });

  test('does not change the list it was given', () => {
    const current = photos(2);
    addFiles(current, [photo('x')]);
    expect(current).toHaveLength(2);
  });
});

describe('removeAt and moveBy', () => {
  const list = () => [photo('a'), photo('b'), photo('c')];

  test('removeAt drops one page and keeps the order of the rest', () => {
    expect(names(removeAt(list(), 1))).toEqual(['a', 'c']);
    expect(names(removeAt(list(), 0))).toEqual(['b', 'c']);
    expect(names(removeAt(list(), 2))).toEqual(['a', 'b']);
    expect(removeAt([photo('a')], 0)).toEqual([]);
  });

  test('removeAt ignores an index that is not on the list', () => {
    const files = list();
    expect(removeAt(files, 3)).toBe(files);
    expect(removeAt(files, -1)).toBe(files);
    expect(removeAt(files, 1.5)).toBe(files);
  });

  test('moveBy swaps with the neighbour and says where the page went', () => {
    let r = moveBy(list(), 1, -1);
    expect(names(r.files)).toEqual(['b', 'a', 'c']);
    expect(r.index).toBe(0);
    r = moveBy(list(), 1, 1);
    expect(names(r.files)).toEqual(['a', 'c', 'b']);
    expect(r.index).toBe(2);
  });

  test('moveBy does nothing at either end', () => {
    const files = list();
    expect(moveBy(files, 0, -1)).toEqual({ files, index: 0 });
    expect(moveBy(files, 2, 1)).toEqual({ files, index: 2 });
    expect(moveBy(files, 5, -1)).toEqual({ files, index: 5 });
  });

  test('moveBy returns a new list and leaves the old one alone', () => {
    const files = list();
    const r = moveBy(files, 0, 1);
    expect(r.files).not.toBe(files);
    expect(names(files)).toEqual(['a', 'b', 'c']);
  });
});

describe('what is announced', () => {
  test('after adding, removing and moving', () => {
    expect(said.added(1, 1)).toBe('1 page added. 1 page in all.');
    expect(said.added(3, 5)).toBe('3 pages added. 5 pages in all.');
    expect(said.removed(1, 2)).toBe('Page 2 removed. 2 pages left.');
    expect(said.removed(0, 1)).toBe('Page 1 removed. 1 page left.');
    expect(said.removed(0, 0)).toBe('Page 1 removed. No pages left.');
    expect(said.moved(0, 4)).toBe('Moved to page 1 of 4.');
  });
});
