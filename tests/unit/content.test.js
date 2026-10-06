import { describe, test, expect } from 'vitest';
import {
  sniffType, toGradableContent, jpegPagesOf, pagesThatFit, MAX_TEXT_CHARS, MAX_PDF_PAGES, MAX_PAGES_BASE64, MAX_IMAGE_BASE64,
} from '../../api/_lib/content.js';
import { PermanentGradingError } from '../../api/_lib/errors.js';
import { packJpegsToPdf } from '../../portal/js/pdf-pack.js';
import { makePdf, TINY_PNG } from './fixtures.js';
import { RGB_12X16, GRAY_16X8, fakeJpeg } from './jpeg-fixtures.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const text = (s) => new TextEncoder().encode(s);

async function permanent(promise) {
  const err = await promise.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(PermanentGradingError);
  return err.message;
}

describe('sniffType', () => {
  test('recognises PDF, PNG and JPEG by their first bytes', () => {
    expect(sniffType(makePdf('hi'))).toBe('application/pdf');
    expect(sniffType(TINY_PNG)).toBe('image/png');
    expect(sniffType(JPEG)).toBe('image/jpeg');
  });

  test('returns null for anything else', () => {
    expect(sniffType(text('just words'))).toBeNull();
    expect(sniffType(new Uint8Array([]))).toBeNull();
  });
});

describe('toGradableContent', () => {
  test('reads the text layer of a PDF', async () => {
    const content = await toGradableContent(makePdf('x = 4 because 2x = 8'), 'application/pdf');
    expect(content).toEqual({ kind: 'text', text: 'x = 4 because 2x = 8' });
  });

  test('a PDF with no text layer asks for photos instead', async () => {
    expect(await permanent(toGradableContent(makePdf(''), 'application/pdf'))).toMatch(/photos of the pages/);
  });

  test('a broken PDF is a permanent failure', async () => {
    const broken = new Uint8Array([...text('%PDF-1.4\n'), ...text('garbage')]);
    await permanent(toGradableContent(broken, 'application/pdf'));
  });

  test('reads a UTF-8 text file', async () => {
    expect(await toGradableContent(text('  1. 42\n2. 7  '), 'text/plain')).toEqual({ kind: 'text', text: '1. 42\n2. 7' });
  });

  test('rejects text that is not valid UTF-8 or contains NUL bytes', async () => {
    await permanent(toGradableContent(new Uint8Array([0xc3, 0x28]), 'text/plain'));
    await permanent(toGradableContent(text('a\u0000b'), 'text/plain'));
  });

  test('rejects an empty file', async () => {
    await permanent(toGradableContent(text('   '), 'text/plain'));
  });

  test('truncates very long text', async () => {
    const content = await toGradableContent(text('a'.repeat(MAX_TEXT_CHARS + 500)), 'text/plain');
    expect(content.text.length).toBeLessThan(MAX_TEXT_CHARS + 50);
    expect(content.text.endsWith('[truncated]')).toBe(true);
  });

  test('passes a photo through as base64', async () => {
    const content = await toGradableContent(TINY_PNG, 'image/png');
    expect(content).toEqual({ kind: 'image', mime: 'image/png', base64: Buffer.from(TINY_PNG).toString('base64') });
  });

  test('rejects a file whose bytes do not match its declared type', async () => {
    await permanent(toGradableContent(makePdf('hi'), 'image/png'));
    await permanent(toGradableContent(TINY_PNG, 'text/plain'));
  });

  test('rejects an oversized photo and an unsupported type', async () => {
    const huge = new Uint8Array(8 * 1024 * 1024);
    huge.set(TINY_PNG.subarray(0, 8));
    expect(await permanent(toGradableContent(huge, 'image/png'))).toMatch(/too large/);
    await permanent(toGradableContent(text('x'), 'application/zip'));
  });
});

// ---------------------------------------------------------------------------
// PDFs the portal makes from several photos (portal/js/pdf-pack.js)

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const page = (bytes, width, height) => ({ bytes, width, height });
const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');
const fromLatin1 = (text) => new Uint8Array(Buffer.from(text, 'latin1'));

// A distinct JPEG-shaped page per number, `extra` bytes of filler after the header
function numbered(n, extra = 0) {
  const head = fakeJpeg({ width: 30, height: 40, payload: new Uint8Array([n, n + 1, n + 2]) });
  return extra ? new Uint8Array(Buffer.concat([head.subarray(0, -2), Buffer.alloc(extra, n), Buffer.from([0xff, 0xd9])])) : head;
}
const pdfOf = (jpegs) => packJpegsToPdf(jpegs.map((j) => page(j, 30, 40)));

describe('a PDF made of photos', () => {
  test('is read as its photos, in page order, as base64 JPEGs', async () => {
    const jpegs = [numbered(1), numbered(2), numbered(3)];
    const content = await toGradableContent(pdfOf(jpegs), 'application/pdf');
    expect(content).toEqual({ kind: 'images', images: jpegs.map((j) => ({ mime: 'image/jpeg', base64: b64(j) })) });
  });

  test('works for real encoder output, color and gray, and for a single page', async () => {
    const two = await toGradableContent(packJpegsToPdf([page(RGB_12X16, 12, 16), page(GRAY_16X8, 16, 8)]), 'application/pdf');
    expect(two.images.map((i) => i.base64)).toEqual([b64(RGB_12X16), b64(GRAY_16X8)]);
    const one = await toGradableContent(packJpegsToPdf([page(RGB_12X16, 12, 16)]), 'application/pdf');
    expect(one).toEqual({ kind: 'images', images: [{ mime: 'image/jpeg', base64: b64(RGB_12X16) }] });
  });

  test('every byte of each page comes through exactly', async () => {
    const payload = new Uint8Array(1024).map((_, i) => i % 256);
    const jpeg = fakeJpeg({ width: 30, height: 40, payload });
    const { images } = await toGradableContent(pdfOf([jpeg, jpeg]), 'application/pdf');
    expect(Buffer.from(images[1].base64, 'base64').equals(Buffer.from(jpeg))).toBe(true);
  });

  test('a PDF with a text layer is read as text, exactly as before', async () => {
    expect(await toGradableContent(makePdf('x = 4 because 2x = 8'), 'application/pdf'))
      .toEqual({ kind: 'text', text: 'x = 4 because 2x = 8' });
  });

  test('keeps the first ten pages and says how many were left out', async () => {
    const jpegs = Array.from({ length: 12 }, (_, i) => numbered(i));
    const content = await toGradableContent(pdfOf(jpegs), 'application/pdf');
    expect(MAX_PDF_PAGES).toBe(10);
    expect(content.kind).toBe('images');
    expect(content.images.map((i) => i.base64)).toEqual(jpegs.slice(0, 10).map(b64));
    expect(content.omitted).toBe(2);
    expect((await toGradableContent(pdfOf(jpegs.slice(0, 10)), 'application/pdf')).omitted).toBeUndefined();
  });

  test('keeps the first pages that fit in the total size, not later small ones', async () => {
    const big = 5 * 1024 * 1024;                              // 6.7 MB as base64: two of them are over the 12 MB total
    const jpegs = [numbered(1, big), numbered(2, big), numbered(3)];
    const content = await toGradableContent(pdfOf(jpegs), 'application/pdf');
    expect(content.images).toHaveLength(1);
    expect(content.images[0].base64).toBe(b64(jpegs[0]));
    expect(content.omitted).toBe(2);
  });

  test('refuses a first page that is over the limit for one image', async () => {
    const huge = numbered(1, 8 * 1024 * 1024);                // over 10 MB as base64
    expect(await permanent(toGradableContent(pdfOf([huge, numbered(2)]), 'application/pdf'))).toMatch(/first page is too large/);
  });

  test('a photo PDF with nothing in it to read as text is not mistaken for a PDF with text', async () => {
    const content = await toGradableContent(pdfOf([numbered(1)]), 'application/pdf');
    expect(content.kind).toBe('images');
  });
});

describe('a PDF with no text that is not made of photos', () => {
  const FRIENDLY = /no readable text.*photos of the pages/;

  // A valid one-page PDF whose page is one JPEG, written the way other tools do
  function scanned(imageDict, jpeg = numbered(1)) {
    const objects = [
      Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
      Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
      Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>'),
      Buffer.from('<< /Length 31 >>\nstream\nq 612 0 0 792 0 0 cm /Im0 Do Q\nendstream'),
      Buffer.concat([Buffer.from(`<< ${imageDict(jpeg.length)} >>\nstream\n`), Buffer.from(jpeg), Buffer.from('\nendstream')]),
    ];
    const parts = [Buffer.from('%PDF-1.4\n')];
    const offsets = [];
    let length = parts[0].length;
    objects.forEach((body, i) => {
      offsets.push(length);
      const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
      parts.push(chunk);
      length += chunk.length;
    });
    let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) tail += `${String(o).padStart(10, '0')} 00000 n \n`;
    tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
    return new Uint8Array(Buffer.concat([...parts, Buffer.from(tail)]));
  }
  const dict = (filter, extra = '') => (n) => `/Type /XObject /Subtype /Image /Width 30 /Height 40 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${filter} ${extra}/Length ${n}`;

  test('a PDF with no content at all still asks for photos instead', async () => {
    expect(await permanent(toGradableContent(makePdf(''), 'application/pdf'))).toMatch(FRIENDLY);
  });

  test('a scan whose image is written some other way is left alone', async () => {
    // This helper writes valid PDFs: the same file with the packer's own filter entry is read
    expect(await toGradableContent(scanned(dict('/DCTDecode')), 'application/pdf')).toMatchObject({ kind: 'images' });
    for (const filter of ['[/DCTDecode]', '[/FlateDecode /DCTDecode]', '/FlateDecode']) {
      expect(await permanent(toGradableContent(scanned(dict(filter)), 'application/pdf')), filter).toMatch(FRIENDLY);
    }
    // an indirect /Length cannot be followed
    expect(await permanent(toGradableContent(scanned(() => '/Type /XObject /Subtype /Image /Width 30 /Height 40 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length 9 0 R'), 'application/pdf'))).toMatch(FRIENDLY);
  });

  test('an image in another color space is left alone', async () => {
    const cmyk = (n) => `/Type /XObject /Subtype /Image /Width 30 /Height 40 /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /DCTDecode /Length ${n}`;
    expect(await permanent(toGradableContent(scanned(cmyk), 'application/pdf'))).toMatch(FRIENDLY);
  });

  test('stream bytes that are not a JPEG, or a /Length that is wrong, are left alone', async () => {
    expect(await permanent(toGradableContent(scanned(dict('/DCTDecode'), new Uint8Array(40).fill(7)), 'application/pdf'))).toMatch(FRIENDLY);
    const text = latin1(scanned(dict('/DCTDecode')));
    const lengthOf = (change) => fromLatin1(text.replace(/\/DCTDecode \/Length (\d+)/, (m, n) => `/DCTDecode /Length ${change(n)}`));
    const shorter = lengthOf((n) => String(Number(n) - 3));                    // the stream no longer ends at "endstream"
    expect(await permanent(toGradableContent(shorter, 'application/pdf'))).toMatch(FRIENDLY);
    const longer = lengthOf((n) => '9'.repeat(n.length));                      // runs past the end of the file
    expect(await permanent(toGradableContent(longer, 'application/pdf'))).toMatch(FRIENDLY);
    expect(await toGradableContent(lengthOf((n) => n), 'application/pdf')).toMatchObject({ kind: 'images' });
  });

  test('a photo PDF with a page that is not a photo is not read as photos', async () => {
    const two = latin1(pdfOf([numbered(1), numbered(2)]));
    const second = two.lastIndexOf('/DCTDecode');
    const broken = fromLatin1(`${two.slice(0, second)}/DCTDecodx${two.slice(second + 10)}`);   // same length: offsets stay valid
    expect(jpegPagesOf(broken)).toHaveLength(1);
    expect(await permanent(toGradableContent(broken, 'application/pdf'))).toMatch(FRIENDLY);
  });

  test('a broken PDF is still a permanent failure, not a read of its bytes', async () => {
    const broken = new Uint8Array([...text('%PDF-1.4\n'), ...text('/Subtype /Image /Filter /DCTDecode /Length 4 >>\nstream\n'), 0xff, 0xd8, 0xff, 0xe0, ...text('\nendstream')]);
    expect(await permanent(toGradableContent(broken, 'application/pdf'))).toMatch(/could not be opened/);
  });
});

describe('jpegPagesOf', () => {
  test('finds each JPEG once, even when image data holds text that looks like another image', () => {
    const trap = fromLatin1('/Subtype /Image /ColorSpace /DeviceRGB /Filter /DCTDecode /Length 4 >>\nstream\n');
    const jpeg = fakeJpeg({ width: 30, height: 40, payload: trap });
    const pages = jpegPagesOf(pdfOf([jpeg, numbered(2)]));
    expect(pages).toHaveLength(2);
    expect(Buffer.from(pages[0]).equals(Buffer.from(jpeg))).toBe(true);
  });

  test('finds nothing in a PDF with no images, in text, or in empty bytes', () => {
    expect(jpegPagesOf(makePdf('hello'))).toEqual([]);
    expect(jpegPagesOf(text('/DCTDecode'))).toEqual([]);
    expect(jpegPagesOf(new Uint8Array())).toEqual([]);
  });

  test('works on a Buffer that is a slice of a larger one', () => {
    const pdf = pdfOf([numbered(4)]);
    const padded = Buffer.concat([Buffer.alloc(100, 1), Buffer.from(pdf), Buffer.alloc(100, 2)]);
    const pages = jpegPagesOf(padded.subarray(100, 100 + pdf.length));
    expect(pages).toHaveLength(1);
    expect(Buffer.from(pages[0]).equals(Buffer.from(numbered(4)))).toBe(true);
  });
});

describe('pagesThatFit', () => {
  test('takes every page when they fit', () => {
    expect(pagesThatFit([100, 200, 300])).toBe(3);
    expect(pagesThatFit([])).toBe(0);
  });

  test('stops at ten pages', () => {
    expect(pagesThatFit(Array(10).fill(10))).toBe(10);
    expect(pagesThatFit(Array(11).fill(10))).toBe(10);
  });

  test('stops at the first page that would pass the total, and does not skip ahead', () => {
    const half = MAX_PAGES_BASE64 / 2;
    expect(pagesThatFit([half, half, 1])).toBe(2);
    expect(pagesThatFit([half, half + 1, 1])).toBe(1);
    expect(pagesThatFit([half + 1, half - 1, 1])).toBe(2);
  });

  test('stops at a page over the limit for one image', () => {
    expect(pagesThatFit([10, MAX_IMAGE_BASE64 + 1, 10])).toBe(1);
    expect(pagesThatFit([MAX_IMAGE_BASE64 + 1])).toBe(0);
    expect(MAX_PAGES_BASE64).toBeGreaterThan(MAX_IMAGE_BASE64);
  });
});
