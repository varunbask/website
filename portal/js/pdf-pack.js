// Packs JPEG pages into one PDF (version 1.4). Pure: bytes in, bytes out, no DOM,
// so it runs the same in the browser and under node.
//
// packJpegsToPdf(pages) -> Uint8Array
//   pages  [{ bytes: Uint8Array (a JPEG), width, height }]  in page order; width
//          and height are the JPEG's pixel size
//
// One page per image. The JPEG bytes go into the file untouched as an image
// XObject with /Filter /DCTDecode (the PDF reader decodes them), so nothing is
// re-encoded and the pages cost no more than the photos did. Each page is the
// image's own shape, scaled to fit US Letter: inside 612 x 792 points for a
// portrait image, inside 792 x 612 for a landscape one, no margins.
//
// File layout: header, catalog (object 1), page tree (object 2), then for page
// n three objects (page, content stream, image), the cross-reference table and
// the trailer. Offsets in the table are byte offsets from the first byte.

export const LETTER_SHORT = 612;   // points (8.5 in)
export const LETTER_LONG = 792;    // points (11 in)
const MIN_PAGE_SIDE = 3;           // the PDF spec's smallest page side

const ascii = new TextEncoder();   // everything but the JPEG bytes is plain ASCII

// "612", "594.5", never exponent notation
function num(n) {
  return String(Math.round(n * 100) / 100);
}

// The page size for an image of width x height pixels: the same shape, the
// largest that fits Letter (portrait box for tall and square images, landscape
// box for wide ones)
export function fitPage(width, height) {
  const landscape = width > height;
  const boxW = landscape ? LETTER_LONG : LETTER_SHORT;
  const boxH = landscape ? LETTER_SHORT : LETTER_LONG;
  const scale = Math.min(boxW / width, boxH / height);
  return { width: Math.round(width * scale * 100) / 100, height: Math.round(height * scale * 100) / 100 };
}

// Reads the first frame header (SOF) of a JPEG: { width, height, components,
// precision, kind } where kind is 'baseline', 'extended' or 'progressive'
// (the three kinds a PDF reader's DCTDecode handles), or 'other'. Returns null
// when the bytes are not a JPEG or no frame header comes before the scan.
export function readJpegInfo(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xff) {                    // fill byte before a marker
      i += 1;
      continue;
    }
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;                                 // a marker without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;   // end of image or scan, no frame header seen
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (i + 9 >= bytes.length) return null;
      const kind = { 0xc0: 'baseline', 0xc1: 'extended', 0xc2: 'progressive' }[marker] ?? 'other';
      return {
        precision: bytes[i + 4],
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components: bytes[i + 9],
        kind,
      };
    }
    i += 2 + length;
  }
  return null;
}

const COLOR_SPACES = { 1: '/DeviceGray', 3: '/DeviceRGB' };

// Checks one page and returns what its image object needs
function describePage(page, n) {
  const where = `Page ${n}`;
  const bytes = page?.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error(`${where} is not a JPEG image.`);
  }
  const { width, height } = page;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`${where} needs a whole-number width and height in pixels.`);
  }
  const info = readJpegInfo(bytes);
  let colorSpace = '/DeviceRGB';
  if (info) {
    if (info.kind === 'other') throw new Error(`${where} is a kind of JPEG that a PDF cannot hold.`);
    if (info.precision !== 8) throw new Error(`${where} must be an 8-bit JPEG.`);
    colorSpace = COLOR_SPACES[info.components];
    if (!colorSpace) throw new Error(`${where} must be a gray or RGB JPEG.`);
    if (info.width !== width || info.height !== height) {
      throw new Error(`${where} is ${info.width} x ${info.height} pixels, not the ${width} x ${height} given.`);
    }
  }
  const size = fitPage(width, height);
  if (size.width < MIN_PAGE_SIDE || size.height < MIN_PAGE_SIDE) throw new Error(`${where} is too narrow to make a page.`);
  return { bytes, width, height, colorSpace, size };
}

export function packJpegsToPdf(pages) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('Add at least one page.');
  const described = pages.map((page, index) => describePage(page, index + 1));

  const chunks = [];
  const offsets = [];            // offsets[n] is where object n starts (index 0 unused)
  let length = 0;
  const push = (chunk) => {
    chunks.push(chunk);
    length += chunk.length;
  };
  const text = (value) => push(ascii.encode(value));
  const begin = (id) => {
    offsets[id] = length;
    text(`${id} 0 obj\n`);
  };

  // The second line is four high bytes: it marks the file as binary for tools that guess
  text('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // Object ids: 1 catalog, 2 page tree, then page, content, image for each page
  const pageId = (i) => 3 + i * 3;
  begin(1);
  text('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  begin(2);
  text(`<< /Type /Pages /Count ${described.length} /Kids [${described.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>\nendobj\n`);

  described.forEach((page, i) => {
    const id = pageId(i);
    const w = num(page.size.width);
    const h = num(page.size.height);

    begin(id);
    text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${id + 1} 0 R `
      + `/Resources << /XObject << /Im0 ${id + 2} 0 R >> /ProcSet [/PDF /ImageB /ImageC] >> >>\nendobj\n`);

    const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
    begin(id + 1);
    text(`<< /Length ${ascii.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);

    begin(id + 2);
    text(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} `
      + `/ColorSpace ${page.colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`);
    push(page.bytes);
    text('\nendstream\nendobj\n');
  });

  const count = 3 + described.length * 3;     // objects 1 .. count - 1, plus the free entry 0
  const xrefAt = length;
  text(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id += 1) text(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  text(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
