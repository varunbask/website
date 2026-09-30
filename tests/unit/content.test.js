import { describe, test, expect } from 'vitest';
import { sniffType, toGradableContent, MAX_TEXT_CHARS } from '../../api/_lib/content.js';
import { PermanentGradingError } from '../../api/_lib/errors.js';
import { makePdf, TINY_PNG } from './fixtures.js';

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
