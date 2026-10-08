// The worksheet's PDF: version 1.4, one US Letter page (612 x 792 points) per
// JPEG, each image an XObject with /Filter /DCTDecode drawn to fill its page,
// then the cross-reference table and the trailer. Pure: bytes in, bytes out.
//
// writePdf(pages) -> Uint8Array
//   pages  [{ bytes: Uint8Array (a JPEG), width, height }]; worksheets are drawn
//          at the Letter shape (1700 x 2200 pixels at 200 dpi), so nothing stretches
//
// The bytes come from pdf-pack.js, the packer that already turns a student's
// photos into one PDF: the same file layout, so the grader reads a worksheet a
// student handed in as photographed pages (api/_lib/content.js, jpegPagesOf).

import { packJpegsToPdf, LETTER_SHORT, LETTER_LONG } from './pdf-pack.js';

export const LETTER = Object.freeze({ width: LETTER_SHORT, height: LETTER_LONG });
export const JPEG_QUALITY = 0.9;
export const MAX_PAGE_BYTES = 600 * 1024;   // each page's JPEG aims to stay under this

export function writePdf(pages) {
  return packJpegsToPdf(pages, { pageSize: LETTER });
}
