// Small lesson files built in the tests: ZIPs (with zlib's deflateRawSync)
// for Word, PowerPoint, Excel and OpenDocument, PDFs, and image headers.
// Each is the least a real file has for the reader under test, nothing more.
import { deflateRawSync, deflateSync, crc32 as zlibCrc32 } from 'node:zlib';

const enc = new TextEncoder();
const bytesOf = (data) => (typeof data === 'string' ? enc.encode(data) : data);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  if (typeof zlibCrc32 === 'function') return zlibCrc32(bytes);
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A ZIP of entries [[name, string | Uint8Array, { store, method, flags, size }]].
 * opts.zip64 writes the 0xFFFFFFFF sizes a ZIP64 file has.
 */
export function zip(entries, { zip64 = false, comment = '' } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data, o = {}] of entries) {
    const raw = bytesOf(data);
    const method = o.method ?? (o.store ? 0 : 8);
    const body = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const nameBytes = enc.encode(name);
    const flags = o.flags ?? 0x0800;
    const size = o.size ?? raw.length;
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc32(raw), true);
    lv.setUint32(18, zip64 ? 0xffffffff : body.length, true);
    lv.setUint32(22, zip64 ? 0xffffffff : size, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc32(raw), true);
    cv.setUint32(20, zip64 ? 0xffffffff : body.length, true);
    cv.setUint32(24, zip64 ? 0xffffffff : size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const commentBytes = enc.encode(comment);
  const end = new Uint8Array(22 + commentBytes.length);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, commentBytes.length, true);
  end.set(commentBytes, 22);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const xmlEscape = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
export const wp = (...runs) => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${runs.join('')}</w:p>`;
export const wr = (text) => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;

/** A Word document: body XML (w:p...), optional header, footer and media */
export function docx({ body = wp(wr('Hello')), header = null, footer = null, media = [] } = {}) {
  const entries = [
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`],
  ];
  if (header) entries.push(['word/header1.xml', `<w:hdr ${W}>${wp(wr(header))}</w:hdr>`]);
  if (footer) entries.push(['word/footer1.xml', `<w:ftr ${W}>${wp(wr(footer))}</w:ftr>`]);
  media.forEach(([name, bytes]) => entries.push([`word/media/${name}`, bytes, { store: true }]));
  return zip(entries);
}

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const shape = (paragraphs, ph = null) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}" idx="1"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${paragraphs.map((t) => `<a:p><a:r><a:t>${xmlEscape(t)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;

/** A PowerPoint file: slides [{ texts: [...], notes }] stored as slide1..N (files listed out of order) */
export function pptx({ slides = [{ texts: ['Hello'] }], media = [] } = {}) {
  const entries = [
    ['[Content_Types].xml', '<Types/>'],
    ['ppt/presentation.xml', `<p:presentation ${A}/>`],
  ];
  [...slides.keys()].reverse().forEach((i) => {
    const s = slides[i];
    entries.push([`ppt/slides/slide${i + 1}.xml`, `<p:sld ${A}><p:cSld><p:spTree>${shape(s.texts)}</p:spTree></p:cSld></p:sld>`]);
    if (s.notes) {
      entries.push([`ppt/slides/_rels/slide${i + 1}.xml.rels`, `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${i + 1}.xml"/></Relationships>`]);
      entries.push([`ppt/notesSlides/notesSlide${i + 1}.xml`, `<p:notes ${A}><p:cSld><p:spTree>${shape(['slide image'], 'sldImg')}${shape([s.notes], 'body')}${shape([String(i + 1)], 'sldNum')}</p:spTree></p:cSld></p:notes>`]);
    }
  });
  media.forEach(([name, bytes]) => entries.push([`ppt/media/${name}`, bytes]));
  return zip(entries);
}

const colName = (n) => { let s = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

/** An Excel workbook: sheets [{ name, rows: [[cell...]] }]; strings go in sharedStrings, numbers and booleans inline */
export function xlsx({ sheets = [{ name: 'Sheet1', rows: [['a', 1]] }] } = {}) {
  const shared = [];
  const sid = (t) => { let i = shared.indexOf(t); if (i < 0) { shared.push(t); i = shared.length - 1; } return i; };
  const entries = [['[Content_Types].xml', '<Types/>']];
  const workbookSheets = [];
  const rels = [];
  sheets.forEach((sheet, si) => {
    const rows = sheet.rows.map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => {
      if (v === null || v === undefined) return '';
      const r = `${colName(ci)}${ri + 1}`;
      if (typeof v === 'number') return `<c r="${r}"><v>${v}</v></c>`;
      if (typeof v === 'boolean') return `<c r="${r}" t="b"><v>${v ? 1 : 0}</v></c>`;
      if (typeof v === 'object' && v.inline) return `<c r="${r}" t="inlineStr"><is><t>${xmlEscape(v.inline)}</t></is></c>`;
      return `<c r="${r}" t="s"><v>${sid(v)}</v></c>`;
    }).join('')}</row>`).join('');
    // stored as sheet(N+1) in reverse, so only the workbook's order is right
    const file = `sheet${sheets.length - si}.xml`;
    entries.push([`xl/worksheets/${file}`, `<worksheet><sheetData>${rows}</sheetData></worksheet>`]);
    workbookSheets.push(`<sheet name="${xmlEscape(sheet.name)}" sheetId="${si + 1}" r:id="rId${si + 1}"/>`);
    rels.push(`<Relationship Id="rId${si + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${file}"/>`);
  });
  entries.push(['xl/workbook.xml', `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets.join('')}</sheets></workbook>`]);
  entries.push(['xl/_rels/workbook.xml.rels', `<Relationships>${rels.join('')}</Relationships>`]);
  entries.push(['xl/sharedStrings.xml', `<sst>${shared.map((t) => `<si><t>${xmlEscape(t)}</t></si>`).join('')}<si><r><t>rich </t></r><r><t>text</t></r><rPh><t>ignored</t></rPh></si></sst>`]);
  return zip(entries);
}

const ODF_MIME = {
  odt: 'application/vnd.oasis.opendocument.text',
  odp: 'application/vnd.oasis.opendocument.presentation',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
};
const ODF_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"';

/** An OpenDocument file: kind odt | odp | ods and the XML inside office:body */
export function odf(kind, body, { media = [] } = {}) {
  return zip([
    ['mimetype', ODF_MIME[kind], { store: true }],
    ['META-INF/manifest.xml', '<manifest/>'],
    ['content.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:body>${body}</office:body></office:document-content>`],
    ...media.map(([name, bytes]) => [`Pictures/${name}`, bytes]),
  ]);
}

/** A PDF with `pages` pages; compressed puts the page tree in a deflated object stream; encrypted adds /Encrypt */
export function pdf({ pages = 1, compressed = false, encrypted = false } = {}) {
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ');
  const pageObjs = Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>');
  let out = '%PDF-1.7\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  if (!compressed) {
    out += `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages} >>\nendobj\n`;
    pageObjs.forEach((p, i) => { out += `${3 + i} 0 obj\n${p}\nendobj\n`; });
    out += `trailer\n<< /Root 1 0 R${encrypted ? ' /Encrypt 99 0 R' : ''} >>\n%%EOF\n`;
    return new Uint8Array(Buffer.from(out, 'latin1'));
  }
  const inner = [`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`, ...pageObjs].join('\n');
  const data = deflateSync(Buffer.from(inner, 'latin1'));
  const head = Buffer.from(`${out}50 0 obj\n<< /Type /ObjStm /N ${pages + 1} /First 0 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`, 'latin1');
  const tail = Buffer.from(`\nendstream\nendobj\n60 0 obj\n<< /Type /XRef /Root 1 0 R${encrypted ? ' /Encrypt << /Filter /Standard >>' : ''} >>\nendobj\n%%EOF\n`, 'latin1');
  return new Uint8Array(Buffer.concat([head, data, tail]));
}

/** The first bytes of an image of the given type and size (enough for type and size checks) */
export function image(type = 'png', width = 40, height = 30, pad = 64) {
  const b = new Uint8Array(pad + 40);
  const dv = new DataView(b.buffer);
  if (type === 'png') {
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    dv.setUint32(16, width);
    dv.setUint32(20, height);
  } else if (type === 'jpeg') {
    b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20);
    dv.setUint16(25, height);
    dv.setUint16(27, width);
  } else if (type === 'gif') {
    b.set(enc.encode('GIF89a'));
    dv.setUint16(6, width, true);
    dv.setUint16(8, height, true);
  } else if (type === 'webp') {
    b.set(enc.encode('RIFF'), 0);
    b.set(enc.encode('WEBPVP8X'), 8);
    b[24] = (width - 1) & 0xff; b[25] = ((width - 1) >> 8) & 0xff; b[26] = (width - 1) >> 16;
    b[27] = (height - 1) & 0xff; b[28] = ((height - 1) >> 8) & 0xff; b[29] = (height - 1) >> 16;
  } else if (type === 'heic') {
    b.set([0, 0, 0, 24]);
    b.set(enc.encode('ftypheic'), 4);
  } else if (type === 'emf') {
    b.set([1, 0, 0, 0, 0x6c, 0, 0, 0]);
  }
  return b;
}

/** An OLE2 (Office 97-2003) file holding a stream of this name */
export function ole(streamName) {
  const head = Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  const name = Buffer.from(streamName, 'utf16le');
  const out = new Uint8Array(1024);
  out.set(head);
  out.set(name, 512);
  return out;
}
