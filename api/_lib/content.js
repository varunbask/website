import { getDocumentProxy, extractText } from 'unpdf';
import { PermanentGradingError } from './errors.js';

export const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'];

// The model API accepts at most 10 MB per base64-encoded image (about 7 MB on disk)
export const MAX_IMAGE_BASE64 = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 60_000;

// A student's photos sent as the pages of one PDF (the portal builds it in the
// browser, portal/js/pdf-pack.js): at most this many pages go to the model, and
// at most this much base64 in all. 12 MB matches MAX_ASSIGNMENT_IMAGE_BASE64, so
// a request with the tutor's files and the student's pages stays under the model
// API's 32 MB limit. The portal keeps to 10 pages and 20 MB per PDF, usually far less.
export const MAX_PDF_PAGES = 10;
export const MAX_PAGES_BASE64 = 12 * 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// The real type of a file from its first bytes, or null for plain text and anything unknown
export function sniffType(bytes) {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44
      && bytes[3] === 0x46 && bytes[4] === 0x2d) return 'application/pdf';             // %PDF-
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

// How many of these pages (their base64 lengths, in order) to send: the longest
// start of the list that is at most MAX_PDF_PAGES pages and MAX_PAGES_BASE64 in
// all, with every page under the per-image limit. Never skips a page to fit a
// later one, so what is sent is always the first pages, in order.
export function pagesThatFit(base64Lengths) {
  let total = 0;
  let count = 0;
  for (const size of base64Lengths) {
    if (count >= MAX_PDF_PAGES || size > MAX_IMAGE_BASE64 || total + size > MAX_PAGES_BASE64) break;
    total += size;
    count += 1;
  }
  return count;
}

const base64Length = (byteLength) => Math.ceil(byteLength / 3) * 4;

// The JPEG streams of a PDF the portal built from photos, in file order (which
// is page order there: one page, one image). It looks for the packer's own shape,
//   ... /Subtype /Image ... /ColorSpace /DeviceRGB|/DeviceGray ... /Filter /DCTDecode /Length N >>
//   stream
//   <N bytes starting with a JPEG header>
//   endstream
// and skips anything that does not fit it exactly: an image whose length is not a
// number, whose bytes are not a JPEG, or that has some other color space. Reads
// bytes only; nothing in the file is run or decoded here.
const DCT = Buffer.from('/DCTDecode', 'latin1');
const IMAGE_DICT = /\/Subtype\s*\/Image\b[^>]*?\/Filter\s*\/DCTDecode[^>]*?\/Length\s+(\d+)[^>]*>>\s*stream\r?\n/;
const MAX_SCANNED = 500;

export function jpegPagesOf(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pages = [];
  let scanned = 0;
  let from = 0;
  while (scanned < MAX_SCANNED) {
    const at = buf.indexOf(DCT, from);
    if (at === -1) break;
    scanned += 1;
    from = at + DCT.length;
    const start = Math.max(0, at - 300);
    const head = buf.toString('latin1', start, Math.min(buf.length, at + 160));
    const dict = IMAGE_DICT.exec(head);
    if (!dict || start + dict.index + dict[0].indexOf('/DCTDecode') !== at) continue;
    if (!/\/ColorSpace\s*\/Device(RGB|Gray)\b/.test(dict[0])) continue;
    const dataStart = start + dict.index + dict[0].length;
    const dataEnd = dataStart + Number(dict[1]);
    if (!Number.isSafeInteger(dataEnd) || dataEnd > buf.length || dataEnd - dataStart < 4) continue;
    if (buf[dataStart] !== 0xff || buf[dataStart + 1] !== 0xd8 || buf[dataStart + 2] !== 0xff) continue;
    if (!/^\r?\n?endstream/.test(buf.toString('latin1', dataEnd, dataEnd + 12))) continue;
    pages.push(buf.subarray(dataStart, dataEnd));
    from = dataEnd;                       // the JPEG's own bytes are not scanned
  }
  return pages;
}

// The photos in a PDF without a text layer, as { kind: 'images', images } for the
// model, or null when this is not such a PDF: the page count has to equal the
// number of JPEGs found, so a PDF with other content on its pages is not read as
// photos. At most MAX_PDF_PAGES pages and MAX_PAGES_BASE64 go in; `omitted` says
// how many pages were left out (it is absent when none were).
function photosOfPdf(bytes, pageCount) {
  const jpegs = jpegPagesOf(bytes);
  if (!jpegs.length || jpegs.length !== pageCount) return null;
  const keep = pagesThatFit(jpegs.map((jpeg) => base64Length(jpeg.length)));
  if (!keep) throw new PermanentGradingError('The first page is too large to grade (the limit is about 7 MB).');
  const images = jpegs.slice(0, keep).map((jpeg) => ({ mime: 'image/jpeg', base64: jpeg.toString('base64') }));
  return keep < jpegs.length ? { kind: 'images', images, omitted: jpegs.length - keep } : { kind: 'images', images };
}

function asText(raw, emptyMessage) {
  const text = (raw ?? '').trim();
  if (!text) throw new PermanentGradingError(emptyMessage);
  if (text.length <= MAX_TEXT_CHARS) return { kind: 'text', text };
  return { kind: 'text', text: `${text.slice(0, MAX_TEXT_CHARS)}\n[truncated]` };
}

/**
 * What the grader sends to the model: text for PDFs and text files, the image
 * itself for photos (the model reads handwriting better than OCR does). A PDF the
 * portal made from several photos has no text layer: its pages are the photos,
 * returned as { kind: 'images', images: [{ mime, base64 }], omitted? } in page
 * order. Any other PDF with no text still fails with the message below.
 */
export async function toGradableContent(bytes, declared) {
  if (!ALLOWED_TYPES.includes(declared)) {
    throw new PermanentGradingError('This file type cannot be graded.');
  }
  const sniffed = sniffType(bytes);

  if (declared === 'text/plain') {
    if (sniffed) throw new PermanentGradingError('The file does not match its type.');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new PermanentGradingError('The text file could not be read.');
    }
    if (text.includes('\u0000')) throw new PermanentGradingError('The text file could not be read.');
    return asText(text, 'The file is empty.');
  }

  if (sniffed !== declared) throw new PermanentGradingError('The file does not match its type.');

  if (declared === 'application/pdf') {
    let text;
    let pageCount;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      pageCount = pdf.numPages;
      ({ text } = await extractText(pdf, { mergePages: true }));
    } catch {
      throw new PermanentGradingError('The PDF could not be opened.');
    }
    if (!(text ?? '').trim()) {
      const photos = photosOfPdf(bytes, pageCount);
      if (photos) return photos;
    }
    return asText(text, 'This PDF has no readable text. Upload photos of the pages instead.');
  }

  const base64 = Buffer.from(bytes).toString('base64');
  if (base64.length > MAX_IMAGE_BASE64) {
    throw new PermanentGradingError('The photo is too large to grade (the limit is about 7 MB).');
  }
  return { kind: 'image', mime: declared, base64 };
}
