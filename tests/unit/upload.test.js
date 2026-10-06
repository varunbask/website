import { describe, test, expect } from 'vitest';
import {
  validateUpload, storagePath, prepareUpload, preparePagesPdf, photoToJpeg, UploadProblem, PAGE_TRIES,
  MAX_UPLOAD_BYTES, MAX_PHOTO_BYTES, MAX_PAGES_PDF_BYTES,
} from '../../portal/js/upload.js';
import { toGradableContent, MAX_PAGES_BASE64, MAX_PDF_PAGES } from '../../api/_lib/content.js';
import { packJpegsToPdf } from '../../portal/js/pdf-pack.js';
import { fakeJpeg } from './jpeg-fixtures.js';

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
    const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0, frame.length + 2, ...frame];
    return new Uint8Array(Buffer.concat([Buffer.from(head), Buffer.alloc(extra), Buffer.from([0xff, 0xd9])]));
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

  test('there are three tries, each smaller, and the third is used if the first two are over', async () => {
    expect(PAGE_TRIES.map((t) => [t.maxEdge, t.quality])).toEqual([[2000, 0.85], [1400, 0.7], [1200, 0.6]]);
    const calls = [];
    const convert = async (f, options) => {
      calls.push(options.maxEdge);
      return { bytes: jpeg(40, 30, options.maxEdge === 1200 ? 100 : 5000), width: 40, height: 30 };
    };
    const seen = [];
    const out = await preparePagesPdf(photos(2), { convert, maxBytes: 4000, onProgress: (p) => seen.push(p.smaller) });
    expect(calls).toEqual([2000, 2000, 1400, 1400, 1200, 1200]);
    expect(seen).toEqual([false, false, true, true, true, true]);
    expect(out.body.size).toBeLessThanOrEqual(4000);
  });

  test('says so when even the smallest pages are over the limit, and sends nothing', async () => {
    const convert = async () => ({ bytes: jpeg(40, 30, 5000), width: 40, height: 30 });
    const err = await preparePagesPdf(photos(4), { convert, maxBytes: 4000 }).catch((e) => e);
    expect(err).toBeInstanceOf(UploadProblem);
    expect(err.message).toMatch(/^These 4 pages add up to [\d.]+ MB, over the 0 MB that can be graded together\. Remove a page or use smaller photos\.$/);
  });

  test('the default limit is what the grader can read, not the 20 MB upload limit', async () => {
    expect(MAX_PAGES_PDF_BYTES).toBe(Math.floor(8.5 * 1024 * 1024));
    expect(MAX_PAGES_PDF_BYTES).toBeLessThan(MAX_UPLOAD_BYTES);
    // ten pages of 900 KB (9 MB in all) are over it at 2000 px, so the second try is used
    const sizes = { 2000: 900_000, 1400: 600_000, 1200: 300_000 };
    const calls = [];
    const convert = async (f, options) => {
      calls.push(options.maxEdge);
      return { bytes: jpeg(40, 30, sizes[options.maxEdge]), width: 40, height: 30 };
    };
    const out = await preparePagesPdf(photos(10), { convert });
    expect(new Set(calls)).toEqual(new Set([2000, 1400]));
    expect(out.body.size).toBeGreaterThan(5_000_000);
    expect(out.body.size).toBeLessThanOrEqual(MAX_PAGES_PDF_BYTES);
    // ten pages of 800 KB (8 MB) fit at the first try
    const first = [];
    await preparePagesPdf(photos(10), { convert: async (f, o) => { first.push(o.maxEdge); return { bytes: jpeg(40, 30, 800_000), width: 40, height: 30 }; } });
    expect(new Set(first)).toEqual(new Set([2000]));
  });

  test('a PDF the grader would only partly read is refused, even though it is under 20 MB', async () => {
    const heavy = async () => ({ bytes: jpeg(40, 30, 1_000_000), width: 40, height: 30 });   // about 10 MB in all, at every try
    const err = await preparePagesPdf(photos(10), { convert: heavy }).catch((e) => e);
    expect(err).toBeInstanceOf(UploadProblem);
    expect(err.message).toMatch(/^These 10 pages add up to 9\.\d MB, over the 8\.5 MB that can be graded together\. Remove a page or use smaller photos\.$/);
  });

  test('a larger limit cannot go past the 20 MB upload limit', async () => {
    const huge = async () => ({ bytes: jpeg(40, 30, 2_200_000), width: 40, height: 30 });   // about 22 MB in all
    const err = await preparePagesPdf(photos(10), { convert: huge, maxBytes: 100 * 1024 * 1024 }).catch((e) => e);
    expect(err.message).toMatch(/over the 20 MB that can be graded together/);
    const ok = async () => ({ bytes: jpeg(40, 30, 1_500_000), width: 40, height: 30 });     // about 15 MB in all
    const out = await preparePagesPdf(photos(10), { convert: ok, maxBytes: 100 * 1024 * 1024 });
    expect(out.body.size).toBeGreaterThan(MAX_PAGES_PDF_BYTES);
    expect(out.body.size).toBeLessThan(MAX_UPLOAD_BYTES);
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

describe('the PDF size limit matches what the grader reads', () => {
  // Ten pages whose PDF is exactly `total` bytes, as a browser would make them
  function pdfOfSize(total, pages = MAX_PDF_PAGES) {
    const make = (extra) => packJpegsToPdf(Array.from({ length: pages }, () => ({
      bytes: new Uint8Array(Buffer.concat([fakeJpeg({ width: 30, height: 40 }).subarray(0, -2), Buffer.alloc(extra, 0x42), Buffer.from([0xff, 0xd9])])),
      width: 30,
      height: 40,
    })));
    // The overhead grows a little with the digits of each /Length, so start near the answer
    let extra = Math.floor(total / pages) - 1000;
    let pdf = make(extra);
    extra += Math.floor((total - pdf.length) / pages);
    pdf = make(extra);
    return pdf.length > total ? make(extra - 1) : pdf;
  }

  test('a PDF at the limit is read whole: every page goes to the model, within its budget', async () => {
    const pdf = pdfOfSize(MAX_PAGES_PDF_BYTES);
    expect(pdf.length).toBeLessThanOrEqual(MAX_PAGES_PDF_BYTES);
    expect(pdf.length).toBeGreaterThan(MAX_PAGES_PDF_BYTES - 20);   // as close to the limit as whole bytes allow
    const content = await toGradableContent(pdf, 'application/pdf');
    expect(content.kind).toBe('images');
    expect(content.images).toHaveLength(MAX_PDF_PAGES);
    expect(content.omitted).toBeUndefined();
    const total = content.images.reduce((sum, image) => sum + image.base64.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_PAGES_BASE64);
  });

  test('a PDF a little over the limit is the kind the grader cuts short', async () => {
    const pdf = pdfOfSize(Math.floor(MAX_PAGES_BASE64 * 3 / 4) + 1024 * 1024);
    const content = await toGradableContent(pdf, 'application/pdf');
    expect(content.omitted).toBeGreaterThan(0);
  });

  test('the limit is close to the grader budget (not far below it) and below the upload limit', () => {
    const jpegBytes = Math.floor(MAX_PAGES_BASE64 * 3 / 4);   // base64 is 4 characters for every 3 bytes
    expect(MAX_PAGES_PDF_BYTES).toBeLessThan(jpegBytes);
    expect(MAX_PAGES_PDF_BYTES).toBeGreaterThan(jpegBytes - 1024 * 1024);
    expect(MAX_PAGES_PDF_BYTES).toBeLessThan(MAX_UPLOAD_BYTES);
  });
});

describe('pages that cannot be made or packed', () => {
  const photos = (n) => Array.from({ length: n }, (_, i) => file(10, 'image/jpeg', `p${i + 1}.jpg`));
  const ok = { bytes: fakeJpeg({ width: 40, height: 30 }), width: 40, height: 30 };

  test('a page that cannot go into a PDF is named, not reported as a failed submission', async () => {
    const notJpeg = { bytes: new Uint8Array([1, 2, 3, 4, 5, 6]), width: 40, height: 30 };
    const convert = async (f) => (f.name === 'p2.jpg' ? notJpeg : ok);
    const err = await preparePagesPdf(photos(3), { convert }).catch((e) => e);
    expect(err).toBeInstanceOf(UploadProblem);
    expect(err.message).toBe('Page 2 could not be put into the PDF. Remove it or choose a different photo, then try again.');
  });

  test('a page whose size does not match its JPEG is named too', async () => {
    const wrong = { bytes: fakeJpeg({ width: 40, height: 30 }), width: 41, height: 30 };
    const err = await preparePagesPdf(photos(2), { convert: async (f) => (f.name === 'p1.jpg' ? wrong : ok) }).catch((e) => e);
    expect(err).toBeInstanceOf(UploadProblem);
    expect(err.message).toMatch(/^Page 1 could not be put into the PDF/);
  });

  describe('in a browser that cannot make a JPEG', () => {
    // A stand-in for the canvas calls shrinking makes; `type` is what convertToBlob hands back
    const stubCanvas = (type) => {
      globalThis.createImageBitmap = async () => ({ width: 4000, height: 3000, close() {} });
      globalThis.OffscreenCanvas = class {
        constructor(width, height) { this.width = width; this.height = height; }
        getContext() { return { fillRect() {}, drawImage() {}, set fillStyle(v) {} }; }
        async convertToBlob() { return new Blob([fakeJpeg({ width: this.width, height: this.height })], { type }); }
      };
    };
    const restore = () => { delete globalThis.createImageBitmap; delete globalThis.OffscreenCanvas; };

    test('a JPEG comes back with its size, scaled to 2000 px on the long side', async () => {
      stubCanvas('image/jpeg');
      try {
        const page = await photoToJpeg(file(10, 'image/png', 'a.png'));
        expect([page.width, page.height]).toEqual([2000, 1500]);
        expect(page.bytes[0]).toBe(0xff);
        expect(page.bytes).toBeInstanceOf(Uint8Array);
      } finally { restore(); }
    });

    test('a PNG in its place is refused, for a page and for a single photo', async () => {
      stubCanvas('image/png');
      try {
        await expect(photoToJpeg(file(10, 'image/jpeg', 'a.jpg'))).rejects.toThrow(/not a JPEG/);
        const err = await preparePagesPdf(photos(2)).catch((e) => e);
        expect(err.message).toMatch(/^Page 1 could not be prepared/);
        // a single photo falls back to the original instead of being sent as a mislabelled JPEG
        const original = file(1000, 'image/png', 'b.png');
        expect(await prepareUpload(original)).toEqual({ body: original, type: 'image/png' });
      } finally { restore(); }
    });

    test('with working canvas calls the whole path makes a PDF', async () => {
      stubCanvas('image/jpeg');
      try {
        const out = await preparePagesPdf(photos(3));
        expect(out.type).toBe('application/pdf');
        const text = Buffer.from(await out.body.arrayBuffer()).toString('latin1');
        expect(text).toMatch(/\/Count 3 /);
        expect(text).toMatch(/\/Width 2000 \/Height 1500/);
      } finally { restore(); }
    });
  });
});
