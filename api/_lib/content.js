import { getDocumentProxy, extractText } from 'unpdf';
import { PermanentGradingError } from './errors.js';

export const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'];

// The model API accepts at most 10 MB per base64-encoded image (about 7 MB on disk)
export const MAX_IMAGE_BASE64 = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 60_000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// The real type of a file from its first bytes, or null for plain text and anything unknown
export function sniffType(bytes) {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44
      && bytes[3] === 0x46 && bytes[4] === 0x2d) return 'application/pdf';             // %PDF-
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

function asText(raw, emptyMessage) {
  const text = (raw ?? '').trim();
  if (!text) throw new PermanentGradingError(emptyMessage);
  if (text.length <= MAX_TEXT_CHARS) return { kind: 'text', text };
  return { kind: 'text', text: `${text.slice(0, MAX_TEXT_CHARS)}\n[truncated]` };
}

/**
 * What the grader sends to the model: text for PDFs and text files, the image
 * itself for photos (the model reads handwriting better than OCR does).
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
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      ({ text } = await extractText(pdf, { mergePages: true }));
    } catch {
      throw new PermanentGradingError('The PDF could not be opened.');
    }
    return asText(text, 'This PDF has no readable text. Upload photos of the pages instead.');
  }

  const base64 = Buffer.from(bytes).toString('base64');
  if (base64.length > MAX_IMAGE_BASE64) {
    throw new PermanentGradingError('The photo is too large to grade (the limit is about 7 MB).');
  }
  return { kind: 'image', mime: declared, base64 };
}
