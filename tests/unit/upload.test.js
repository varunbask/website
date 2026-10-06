import { describe, test, expect } from 'vitest';
import { validateUpload, storagePath, prepareUpload, preparePagesPdf, UploadProblem, MAX_UPLOAD_BYTES, MAX_PHOTO_BYTES } from '../../portal/js/upload.js';

const file = (size, type, name = 'work') => new File([new Uint8Array(size)], name, { type });

describe('validateUpload', () => {
  test('accepts PDF, PNG, JPEG and text', () => {
    for (const type of ['application/pdf', 'image/png', 'image/jpeg', 'text/plain']) {
      expect(validateUpload(file(10, type))).toBeNull();
    }
  });

  test('explains what is wrong', () => {
    expect(validateUpload(undefined)).toMatch(/Choose a file/);
    expect(validateUpload(file(10, 'image/heic'))).toMatch(/PDF, a photo/);
    expect(validateUpload(file(0, 'text/plain'))).toMatch(/empty/);
    expect(validateUpload(file(MAX_UPLOAD_BYTES + 1, 'application/pdf'))).toMatch(/20 MB/);
  });
});

describe('storagePath', () => {
  test("puts the file in the student's folder with the right extension", () => {
    const uid = '11111111-2222-3333-4444-555555555555';
    expect(storagePath(uid, 'image/jpeg', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'))
      .toBe(`${uid}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg`);
    expect(storagePath(uid, 'application/pdf')).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/);
  });
});

describe('prepareUpload', () => {
  test('passes PDFs and text through unchanged', async () => {
    const pdf = file(10, 'application/pdf');
    expect(await prepareUpload(pdf)).toEqual({ body: pdf, type: 'application/pdf' });
  });

  test('falls back to the original photo when it cannot be shrunk, if it is small enough', async () => {
    // Node has no createImageBitmap, which is exactly the "cannot shrink" path
    const small = file(1000, 'image/png');
    expect(await prepareUpload(small)).toEqual({ body: small, type: 'image/png' });
    await expect(prepareUpload(file(MAX_PHOTO_BYTES + 1, 'image/jpeg'))).rejects.toThrow(/too large/);
  });
});

describe('preparePagesPdf', () => {
  // A stand-in for the browser's canvas step: a JPEG-looking page per photo
  const jpeg = (width, height, extra = 0) => {
    const frame = [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0];
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0, frame.length + 2, ...frame, ...new Uint8Array(extra), 0xff, 0xd9]);
  };
  const photos = (n) => Array.from({ length: n }, (_, i) => file(10, 'image/jpeg', `p${i + 1}.jpg`));
  const convertWith = (log = []) => async (f, options) => {
    log.push({ name: f.name, ...options });
    return { bytes: jpeg(40, 30), width: 40, height: 30 };
  };

  test('makes one PDF named pages.pdf with a page per photo, in order', async () => {
    const calls = [];
    const out = await preparePagesPdf(photos(3), { convert: convertWith(calls) });
    expect(out.type).toBe('application/pdf');
    expect(out.body.name).toBe('pages.pdf');
    expect(out.body.type).toBe('application/pdf');
    const bytes = new Uint8Array(await out.body.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe('%PDF-1.4');
    expect(new TextDecoder('latin1').decode(bytes)).toMatch(/\/Count 3 /);
    expect(calls.map((c) => c.name)).toEqual(['p1.jpg', 'p2.jpg', 'p3.jpg']);
    expect(calls[0]).toMatchObject({ maxEdge: 2000, quality: 0.85 });
  });

  test('reports each page before it is prepared', async () => {
    const seen = [];
    await preparePagesPdf(photos(3), { convert: convertWith(), onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([1, 2, 3].map((page) => ({ page, of: 3, smaller: false })));
  });

  test('tries again with smaller pages when the PDF is over the limit, and uses that if it fits', async () => {
    const calls = [];
    const convert = async (f, options) => {
      calls.push(options.maxEdge);
      return { bytes: jpeg(40, 30, options.maxEdge === 2000 ? 5000 : 100), width: 40, height: 30 };
    };
    const out = await preparePagesPdf(photos(2), { convert, maxBytes: 4000 });
    expect(calls).toEqual([2000, 2000, 1400, 1400]);
    expect(out.body.size).toBeLessThanOrEqual(4000);
  });

  test('says so when even the smaller pages are over the limit', async () => {
    const convert = async () => ({ bytes: jpeg(40, 30, 5000), width: 40, height: 30 });
    const err = await preparePagesPdf(photos(4), { convert, maxBytes: 4000 }).catch((e) => e);
    expect(err).toBeInstanceOf(UploadProblem);
    expect(err.message).toMatch(/^These 4 pages add up to \d+\.\d MB, over the 0 MB limit\./);
  });

  test('the real limit is the 20 MB upload limit', async () => {
    const convert = async () => ({ bytes: jpeg(40, 30, 1_000_000), width: 40, height: 30 });
    const out = await preparePagesPdf(photos(10), { convert });
    expect(out.body.size).toBeGreaterThan(10_000_000);
    expect(out.body.size).toBeLessThan(MAX_UPLOAD_BYTES);
    const over = async () => ({ bytes: jpeg(40, 30, 2_200_000), width: 40, height: 30 });
    const err = await preparePagesPdf(photos(10), { convert: over }).catch((e) => e);
    expect(err.message).toMatch(/over the 20 MB limit\. Remove a page or use smaller photos\.$/);
  });

  test('names the page that could not be prepared', async () => {
    const convert = async (f) => {
      if (f.name === 'p2.jpg') throw new Error('decode failed');
      return { bytes: jpeg(40, 30), width: 40, height: 30 };
    };
    const err = await preparePagesPdf(photos(3), { convert }).catch((e) => e);
    expect(err).toBeInstanceOf(UploadProblem);
    expect(err.message).toBe('Page 2 could not be prepared. Remove it or choose a different photo, then try again.');
  });

  test('in node there is no canvas, so the real converter fails with the page named', async () => {
    const err = await preparePagesPdf(photos(2)).catch((e) => e);
    expect(err).toBeInstanceOf(UploadProblem);
    expect(err.message).toMatch(/^Page 1 could not be prepared/);
  });
});

describe('UploadProblem', () => {
  test('is an Error with its own name, and the oversize photo message uses it', async () => {
    const err = await prepareUpload(file(MAX_PHOTO_BYTES + 1, 'image/jpeg')).catch((e) => e);
    expect(err).toBeInstanceOf(UploadProblem);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('UploadProblem');
  });
});
