import { describe, test, expect } from 'vitest';
import { packJpegsToPdf, fitPage, readJpegInfo, LETTER_SHORT, LETTER_LONG } from '../../portal/js/pdf-pack.js';
import { RGB_12X16, GRAY_16X8, fakeJpeg } from './jpeg-fixtures.js';

// ---------------------------------------------------------------------------
// A small PDF reader for these tests. It trusts nothing but the file's own
// cross-reference table, the way a real reader does: startxref -> xref ->
// object offsets -> objects, and a stream is its /Length bytes.

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');
const bytesOf = (text) => new Uint8Array(Buffer.from(text, 'latin1'));

function indexOfBytes(haystack, needle, from = 0) {
  return Buffer.from(haystack).indexOf(Buffer.from(needle, 'latin1'), from);
}

function parsePdf(pdf) {
  const text = latin1(pdf);
  const tail = text.slice(-64);
  const startxref = /startxref\n(\d+)\n%%EOF\n$/.exec(tail);
  expect(startxref, 'startxref and %%EOF close the file').not.toBeNull();
  const xrefAt = Number(startxref[1]);
  expect(text.slice(xrefAt, xrefAt + 5)).toBe('xref\n');

  const head = /^xref\n0 (\d+)\n/.exec(text.slice(xrefAt));
  const count = Number(head[1]);
  let at = xrefAt + head[0].length;
  const entries = [];
  for (let n = 0; n < count; n += 1) {
    const entry = text.slice(at, at + 20);
    expect(entry, `xref entry ${n} is 20 bytes`).toMatch(/^\d{10} \d{5} [nf] \n$/);
    entries.push({ offset: Number(entry.slice(0, 10)), generation: Number(entry.slice(11, 16)), kind: entry[17] });
    at += 20;
  }
  expect(text.slice(at, at + 8)).toBe('trailer\n');
  const trailer = /^trailer\n<< (.*?) >>\nstartxref/.exec(text.slice(at));
  expect(trailer, 'trailer dictionary').not.toBeNull();

  // Object n: the text from its "n 0 obj" line to the first "endobj" after the
  // dictionary (and after the stream, if it has one, found by /Length)
  const object = (n) => {
    const offset = entries[n].offset;
    expect(text.slice(offset, offset + `${n} 0 obj\n`.length), `xref offset of object ${n}`).toBe(`${n} 0 obj\n`);
    const bodyStart = offset + `${n} 0 obj\n`.length;
    const rest = text.slice(bodyStart);
    const hasStream = rest.search(/\nstream\n/) !== -1 && rest.search(/\nstream\n/) < rest.indexOf('endobj');
    if (!hasStream) {
      const end = text.indexOf('endobj\n', bodyStart);
      return { id: n, dict: text.slice(bodyStart, end).trim(), stream: null, end: end + 'endobj\n'.length };
    }
    const streamKeyword = text.indexOf('\nstream\n', bodyStart);
    const dict = text.slice(bodyStart, streamKeyword);
    const length = Number(/\/Length (\d+)/.exec(dict)[1]);
    const dataStart = streamKeyword + '\nstream\n'.length;
    const stream = pdf.subarray(dataStart, dataStart + length);
    const after = text.slice(dataStart + length, dataStart + length + 'endstream\nendobj\n'.length + 1);
    // One newline may sit between the data and "endstream"; it is not counted in /Length
    expect(['endstream\nendobj\n', '\nendstream\nendobj\n'].some((tail2) => after.startsWith(tail2)), `object ${n} ends after its /Length bytes`).toBe(true);
    return { id: n, dict, stream, end: text.indexOf('endobj\n', dataStart + length) + 'endobj\n'.length };
  };

  return { text, xrefAt, count, entries, trailer: trailer[1], object };
}

const refs = (dict, key) => [...new RegExp(`${key}\\s*\\[([^\\]]*)\\]`).exec(dict)[1].matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
const ref = (dict, key) => Number(new RegExp(`${key} (\\d+) 0 R`).exec(dict)[1]);
const mediaBox = (dict) => /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(dict).slice(1).map(Number);

// Walks catalog -> page tree -> pages and returns each page's pieces
function readPages(pdf) {
  const doc = parsePdf(pdf);
  const root = doc.object(ref(doc.trailer, '/Root'));
  expect(root.dict).toMatch(/\/Type \/Catalog/);
  const tree = doc.object(ref(root.dict, '/Pages'));
  expect(tree.dict).toMatch(/\/Type \/Pages/);
  const kids = refs(tree.dict, '/Kids');
  expect(Number(/\/Count (\d+)/.exec(tree.dict)[1])).toBe(kids.length);
  const pages = kids.map((id) => {
    const page = doc.object(id);
    expect(page.dict).toMatch(/\/Type \/Page /);
    expect(ref(page.dict, '/Parent')).toBe(tree.id);
    const content = doc.object(ref(page.dict, '/Contents'));
    const image = doc.object(ref(page.dict, '/Im0'));
    return { page, box: mediaBox(page.dict), content, image };
  });
  return { doc, pages };
}

const jpegPage = (bytes, width, height) => ({ bytes, width, height });

// ---------------------------------------------------------------------------

describe('file structure', () => {
  const pdf = packJpegsToPdf([jpegPage(RGB_12X16, 12, 16)]);

  test('starts with the 1.4 header and a binary comment line', () => {
    expect(latin1(pdf.subarray(0, 9))).toBe('%PDF-1.4\n');
    expect(pdf.subarray(9, 15)).toEqual(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  });

  test('ends with startxref, its offset and %%EOF', () => {
    expect(latin1(pdf.subarray(-6))).toBe('%%EOF\n');
    const { text, xrefAt } = parsePdf(pdf);
    expect(text.endsWith(`startxref\n${xrefAt}\n%%EOF\n`)).toBe(true);
  });

  test('every xref entry is 20 bytes and points at its "n 0 obj" line', () => {
    const { doc } = readPages(pdf);
    expect(doc.entries[0]).toEqual({ offset: 0, generation: 65535, kind: 'f' });
    for (let n = 1; n < doc.count; n += 1) {
      const { offset, kind, generation } = doc.entries[n];
      expect(kind).toBe('n');
      expect(generation).toBe(0);
      expect(latin1(pdf.subarray(offset, offset + `${n} 0 obj\n`.length))).toBe(`${n} 0 obj\n`);
    }
  });

  test('the trailer size is the object count and the root is the catalog', () => {
    const { doc } = readPages(pdf);
    expect(doc.count).toBe(6);                              // free entry, catalog, tree, page, content, image
    expect(Number(/\/Size (\d+)/.exec(doc.trailer)[1])).toBe(doc.count);
    expect(ref(doc.trailer, '/Root')).toBe(1);
  });

  test('the xref table starts exactly where startxref says, after the last object', () => {
    const doc = parsePdf(pdf);
    const last = doc.object(doc.count - 1);
    expect(doc.xrefAt).toBe(last.end);
  });

  test('is deterministic: the same pages give the same bytes', () => {
    const again = packJpegsToPdf([jpegPage(RGB_12X16, 12, 16)]);
    expect(Buffer.from(again).equals(Buffer.from(pdf))).toBe(true);
  });

  test('contains only ASCII outside the JPEG data and the binary comment', () => {
    const copy = Buffer.from(pdf);
    const start = copy.indexOf(Buffer.from(RGB_12X16));
    const stripped = Buffer.concat([copy.subarray(15, start), copy.subarray(start + RGB_12X16.length)]);
    expect([...stripped].every((byte) => byte < 0x80)).toBe(true);
  });
});

describe('pages', () => {
  test('one page per image, in the order given, each with its own image object', () => {
    const a = fakeJpeg({ width: 30, height: 40, payload: [1, 2, 3] });
    const b = fakeJpeg({ width: 40, height: 30, payload: [4, 5, 6] });
    const c = fakeJpeg({ width: 50, height: 50, payload: [7, 8, 9] });
    const { pages, doc } = readPages(packJpegsToPdf([jpegPage(a, 30, 40), jpegPage(b, 40, 30), jpegPage(c, 50, 50)]));
    expect(pages).toHaveLength(3);
    expect(doc.count).toBe(1 + 2 + 3 * 3);
    const streams = pages.map((p) => [...p.image.stream]);
    expect(streams).toEqual([[...a], [...b], [...c]]);
    // Object ids never repeat
    const ids = pages.flatMap((p) => [p.page.id, p.content.id, p.image.id]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('page size keeps the image shape inside Letter', () => {
    expect(fitPage(3000, 4000)).toEqual({ width: 594, height: 792 });     // a portrait photo
    expect(fitPage(4000, 3000)).toEqual({ width: 792, height: 594 });     // a landscape photo
    expect(fitPage(500, 500)).toEqual({ width: LETTER_SHORT, height: LETTER_SHORT });
    expect(fitPage(612, 792)).toEqual({ width: 612, height: 792 });       // already Letter
    expect(fitPage(2000, 1000)).toEqual({ width: LETTER_LONG, height: 396 });
    expect(fitPage(1000, 3000)).toEqual({ width: 264, height: LETTER_LONG });
    expect(fitPage(12, 16)).toEqual({ width: 594, height: 792 });         // small images scale up to the page
  });

  test('the MediaBox and the drawing matrix match the fitted size', () => {
    const portrait = fakeJpeg({ width: 1500, height: 2000 });
    const landscape = fakeJpeg({ width: 2000, height: 1500 });
    const { pages } = readPages(packJpegsToPdf([jpegPage(portrait, 1500, 2000), jpegPage(landscape, 2000, 1500)]));
    expect(pages[0].box).toEqual([594, 792]);
    expect(pages[1].box).toEqual([792, 594]);
    for (const { box, content } of pages) {
      expect(latin1(content.stream)).toBe(`q\n${box[0]} 0 0 ${box[1]} 0 0 cm\n/Im0 Do\nQ\n`);
    }
  });

  test('fractional page sizes are written without exponents and keep the aspect ratio', () => {
    const jpeg = fakeJpeg({ width: 1777, height: 999 });
    const { pages } = readPages(packJpegsToPdf([jpegPage(jpeg, 1777, 999)]));
    const [w, h] = pages[0].box;
    expect(w).toBe(792);
    expect(Math.abs(w / h - 1777 / 999)).toBeLessThan(0.002);
  });

  test('the image object describes the JPEG', () => {
    const { pages } = readPages(packJpegsToPdf([jpegPage(RGB_12X16, 12, 16), jpegPage(GRAY_16X8, 16, 8)]));
    const [rgb, gray] = pages.map((p) => p.image.dict);
    for (const dict of [rgb, gray]) {
      expect(dict).toContain('/Type /XObject');
      expect(dict).toContain('/Subtype /Image');
      expect(dict).toContain('/Filter /DCTDecode');
      expect(dict).toContain('/BitsPerComponent 8');
    }
    expect(rgb).toContain('/Width 12 /Height 16');
    expect(rgb).toContain('/ColorSpace /DeviceRGB');
    expect(gray).toContain('/Width 16 /Height 8');
    expect(gray).toContain('/ColorSpace /DeviceGray');
  });

  test('the page lists the image it draws as a resource', () => {
    const { pages } = readPages(packJpegsToPdf([jpegPage(RGB_12X16, 12, 16)]));
    expect(pages[0].page.dict).toMatch(/\/Resources << \/XObject << \/Im0 \d+ 0 R >>/);
  });
});

describe('image bytes', () => {
  test('real JPEG bytes come back exactly', () => {
    const { pages } = readPages(packJpegsToPdf([jpegPage(RGB_12X16, 12, 16), jpegPage(GRAY_16X8, 16, 8)]));
    expect(Buffer.from(pages[0].image.stream).equals(Buffer.from(RGB_12X16))).toBe(true);
    expect(Buffer.from(pages[1].image.stream).equals(Buffer.from(GRAY_16X8))).toBe(true);
  });

  test('/Length is the byte length of the JPEG', () => {
    const jpeg = fakeJpeg({ width: 20, height: 20, payload: new Uint8Array(1234).fill(7) });
    const { pages } = readPages(packJpegsToPdf([jpegPage(jpeg, 20, 20)]));
    expect(pages[0].image.dict).toContain(`/Length ${jpeg.length}`);
    expect(pages[0].image.stream.length).toBe(jpeg.length);
  });

  test('every byte value survives, including 0xff, 0x0a, 0x0d and 0x00', () => {
    const payload = new Uint8Array(256 * 4);
    payload.forEach((_, i) => { payload[i] = i % 256; });
    const jpeg = fakeJpeg({ width: 9, height: 9, payload });
    const pdf = packJpegsToPdf([jpegPage(jpeg, 9, 9)]);
    expect(indexOfBytes(pdf, latin1(jpeg))).toBeGreaterThan(0);
    const { pages } = readPages(pdf);
    expect(Buffer.from(pages[0].image.stream).equals(Buffer.from(jpeg))).toBe(true);
  });

  test('image data that looks like PDF syntax is not mistaken for it', () => {
    const trap = bytesOf('endstream\nendobj\n99 0 obj\nxref\nstartxref\n0\n%%EOF\n');
    const jpeg = fakeJpeg({ width: 4, height: 4, payload: trap });
    const other = fakeJpeg({ width: 4, height: 4, payload: [1, 2, 3] });
    const { pages } = readPages(packJpegsToPdf([jpegPage(jpeg, 4, 4), jpegPage(other, 4, 4)]));
    expect(Buffer.from(pages[0].image.stream).equals(Buffer.from(jpeg))).toBe(true);
    expect(Buffer.from(pages[1].image.stream).equals(Buffer.from(other))).toBe(true);
  });

  test('does not change the bytes it was given', () => {
    const copy = new Uint8Array(RGB_12X16);
    packJpegsToPdf([jpegPage(RGB_12X16, 12, 16)]);
    expect(Buffer.from(RGB_12X16).equals(Buffer.from(copy))).toBe(true);
  });

  test('ten large pages: the file is the images plus a small fixed overhead per page', () => {
    const payload = new Uint8Array(200_000).fill(0x42);
    const jpeg = fakeJpeg({ width: 2000, height: 1500, payload });
    const pdf = packJpegsToPdf(Array.from({ length: 10 }, () => jpegPage(jpeg, 2000, 1500)));
    expect(pdf.length).toBeGreaterThan(10 * jpeg.length);
    expect(pdf.length - 10 * jpeg.length).toBeLessThan(10 * 700 + 400);
    const { pages } = readPages(pdf);
    expect(pages).toHaveLength(10);
    for (const { image } of pages) expect(image.stream.length).toBe(jpeg.length);
  });
});

describe('readJpegInfo', () => {
  test('reads size, components and kind from the frame header', () => {
    expect(readJpegInfo(RGB_12X16)).toEqual({ width: 12, height: 16, components: 3, precision: 8, kind: 'baseline' });
    expect(readJpegInfo(GRAY_16X8)).toEqual({ width: 16, height: 8, components: 1, precision: 8, kind: 'baseline' });
  });

  test('tells baseline, extended and progressive from other kinds', () => {
    expect(readJpegInfo(fakeJpeg({ width: 5, height: 5, marker: 0xc1 })).kind).toBe('extended');
    expect(readJpegInfo(fakeJpeg({ width: 5, height: 5, marker: 0xc2 })).kind).toBe('progressive');
    expect(readJpegInfo(fakeJpeg({ width: 5, height: 5, marker: 0xc3 })).kind).toBe('other');
  });

  test('reads sizes above 255 (two-byte fields)', () => {
    expect(readJpegInfo(fakeJpeg({ width: 2000, height: 1333 }))).toMatchObject({ width: 2000, height: 1333 });
  });

  test('gives null for anything that is not a JPEG with a frame header', () => {
    expect(readJpegInfo(new Uint8Array([]))).toBeNull();
    expect(readJpegInfo(bytesOf('%PDF-1.4'))).toBeNull();
    expect(readJpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(readJpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]))).toBeNull();
    expect(readJpegInfo('not bytes')).toBeNull();
  });
});

describe('bad input', () => {
  const ok = jpegPage(RGB_12X16, 12, 16);

  test('needs at least one page', () => {
    expect(() => packJpegsToPdf([])).toThrow(/at least one page/i);
    expect(() => packJpegsToPdf(undefined)).toThrow(/at least one page/i);
  });

  test('names the page that is not a JPEG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => packJpegsToPdf([ok, jpegPage(png, 10, 10)])).toThrow(/Page 2 is not a JPEG/);
    expect(() => packJpegsToPdf([jpegPage('text', 10, 10)])).toThrow(/Page 1 is not a JPEG/);
    expect(() => packJpegsToPdf([jpegPage(new Uint8Array([0xff, 0xd8]), 10, 10)])).toThrow(/not a JPEG/);
    expect(() => packJpegsToPdf([undefined])).toThrow(/Page 1/);
  });

  test('needs whole-number pixel sizes', () => {
    for (const [w, h] of [[0, 10], [10, 0], [-3, 10], [10.5, 10], [NaN, 10], [undefined, 10], ['12', 16]]) {
      expect(() => packJpegsToPdf([jpegPage(fakeJpeg({ width: 10, height: 10 }), w, h)])).toThrow(/Page 1 needs a whole-number/);
    }
  });

  test('refuses a size that does not match the JPEG header', () => {
    expect(() => packJpegsToPdf([jpegPage(RGB_12X16, 16, 12)])).toThrow(/12 x 16 pixels, not the 16 x 12 given/);
  });

  test('refuses JPEG kinds a PDF reader cannot decode', () => {
    expect(() => packJpegsToPdf([jpegPage(fakeJpeg({ width: 5, height: 5, marker: 0xc3 }), 5, 5)])).toThrow(/cannot hold/);
    expect(() => packJpegsToPdf([jpegPage(fakeJpeg({ width: 5, height: 5, precision: 12 }), 5, 5)])).toThrow(/8-bit/);
    expect(() => packJpegsToPdf([jpegPage(fakeJpeg({ width: 5, height: 5, components: 4 }), 5, 5)])).toThrow(/gray or RGB/);
  });

  test('accepts progressive and extended JPEGs', () => {
    for (const marker of [0xc1, 0xc2]) {
      expect(() => packJpegsToPdf([jpegPage(fakeJpeg({ width: 5, height: 5, marker }), 5, 5)])).not.toThrow();
    }
  });

  test('refuses an image too narrow to be a page', () => {
    expect(() => packJpegsToPdf([jpegPage(fakeJpeg({ width: 1, height: 5000 }), 1, 5000)])).toThrow(/too narrow/);
  });

  test('a JPEG without a readable frame header is taken as 8-bit RGB at the size given', () => {
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
    const { pages } = readPages(packJpegsToPdf([jpegPage(bare, 30, 40)]));
    expect(pages[0].image.dict).toContain('/ColorSpace /DeviceRGB');
    expect(pages[0].image.dict).toContain('/Width 30 /Height 40');
  });
});
