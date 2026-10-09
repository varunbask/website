import { describe, test, expect } from 'vitest';
import { writePdf, LETTER, JPEG_QUALITY, MAX_PAGE_BYTES } from '../../portal/js/pdf-writer.js';
import { jpegPagesOf, toGradableContent } from '../../api/_lib/content.js';
import { RGB_12X16, GRAY_16X8, fakeJpeg } from './jpeg-fixtures.js';

const latin = (bytes) => Buffer.from(bytes).toString('latin1');
// A page the way the worksheet makes them: Letter shape at 200 dpi
const letterPage = (payload = 400) => ({ bytes: fakeJpeg({ width: 1700, height: 2200, payload: new Uint8Array(payload).fill(7) }), width: 1700, height: 2200 });

describe('writePdf', () => {
  const pages = [letterPage(500), letterPage(900), { bytes: RGB_12X16, width: 12, height: 16 }];
  const pdf = writePdf(pages);
  const text = latin(pdf);

  test('a PDF 1.4 header, then a binary marker line', () => {
    expect(text.startsWith('%PDF-1.4\n%')).toBe(true);
    expect([...pdf.slice(10, 14)].every((b) => b >= 0x80)).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  test('one Letter page per JPEG, each 612 x 792 points', () => {
    expect(LETTER).toEqual({ width: 612, height: 792 });
    expect(text).toContain('/Type /Pages /Count 3 ');
    expect(text.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(3);
    expect(text.match(/\/MediaBox \[0 0 612 792\]/g)).toHaveLength(3);
    expect(text.match(/\/Filter \/DCTDecode/g)).toHaveLength(3);
    // the image fills the page
    expect(text.match(/612 0 0 792 0 0 cm\n\/Im0 Do/g)).toHaveLength(3);
  });

  test('the xref table points at every object, and startxref at the table', () => {
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)[1]);
    expect(text.slice(startxref, startxref + 5)).toBe('xref\n');
    const table = /xref\n0 (\d+)\n([\s\S]*?)trailer/.exec(text);
    const size = Number(table[1]);
    expect(size).toBe(3 + pages.length * 3);
    const rows = table[2].split('\n').filter(Boolean);
    expect(rows[0]).toBe('0000000000 65535 f ');
    rows.slice(1).forEach((row, i) => {
      expect(row).toMatch(/^\d{10} 00000 n $/);
      const offset = Number(row.slice(0, 10));
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    expect(text).toContain(`trailer\n<< /Size ${size} /Root 1 0 R >>`);
  });

  test('each JPEG goes in untouched and comes back out byte for byte', () => {
    const out = jpegPagesOf(pdf);
    expect(out).toHaveLength(3);
    out.forEach((jpeg, i) => expect(Buffer.compare(Buffer.from(jpeg), Buffer.from(pages[i].bytes))).toBe(0));
    expect(text).toContain(`/Width 1700 /Height 2200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pages[0].bytes.length}`);
  });

  test('a gray page is DeviceGray; anything but a JPEG is refused', () => {
    expect(latin(writePdf([{ bytes: GRAY_16X8, width: 16, height: 8 }]))).toContain('/ColorSpace /DeviceGray');
    expect(() => writePdf([])).toThrow();
    expect(() => writePdf([{ bytes: new Uint8Array([1, 2, 3, 4]), width: 1, height: 1 }])).toThrow(/not a JPEG/);
  });

  test('the encoder settings: quality 0.9, pages aimed at 600 KB or less', () => {
    expect(JPEG_QUALITY).toBe(0.9);
    expect(MAX_PAGE_BYTES).toBe(600 * 1024);
  });
});

describe('the grader reads a handed-in worksheet as its pages', () => {
  test('an image-only worksheet PDF becomes the page images, in order', async () => {
    const pdf = writePdf([
      { bytes: RGB_12X16, width: 12, height: 16 },
      { bytes: GRAY_16X8, width: 16, height: 8 },
    ]);
    const content = await toGradableContent(pdf, 'application/pdf');
    expect(content.kind).toBe('images');
    expect(content.images.map((i) => i.mime)).toEqual(['image/jpeg', 'image/jpeg']);
    expect(content.images[0].base64).toBe(Buffer.from(RGB_12X16).toString('base64'));
    expect(content.images[1].base64).toBe(Buffer.from(GRAY_16X8).toString('base64'));
    expect(content.omitted).toBeUndefined();
  });
});
