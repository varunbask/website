// Lesson materials for a homework draft: what a file really is, and what the
// model is sent from it (staff only; api/_lib/homework-draft.js calls this).
//
// The real type comes from a file's first bytes, never from its name or the
// type the browser gave it:
//   photos     JPEG, PNG, WebP, GIF        -> image blocks
//   PDF        sent as it is               -> a document block (the model reads
//                                             the pages, text and pictures)
//   Word, PowerPoint, Excel (.docx .pptx .xlsx) and OpenDocument (.odt .odp .ods)
//              read here: a small ZIP reader (stored and deflate only, no
//              ZIP64, no encryption, with caps so a zip bomb fails safely)
//              and the text of their XML; the JPEG, PNG, WebP and GIF
//              pictures inside are sent as image blocks
//   text       TXT, Markdown, CSV, HTML (scripts, styles and tags dropped)
//              and RTF (control words and groups dropped) -> text blocks
// Refused, with a message staff can act on: Word 97-2003, PowerPoint 97-2003
// and Excel 97-2003 files, Pages, Keynote and Numbers files, HEIC photos
// (the browser makes photos JPEG first), password-protected files, and
// anything else. No new dependencies: node:zlib only.
//
// The limits (portal/js/draft-sources-model.js) hold for all files of one
// draft together: 100 PDF pages, 20 pictures, 100,000 characters of text
// (cut with a note for staff), and a request under 32 MB with its base64.

import { inflateRawSync, inflateSync } from 'node:zlib';
import {
  MAX_PDF_PAGES, MAX_IMAGES, MAX_TEXT_CHARS, MAX_EMBEDDED_IMAGES, MAX_EMBEDDED_IMAGE_BYTES, MAX_NAME, MAX_PDF_BYTES, MAX_DOC_BYTES,
  REFUSED, MB, sizeText,
} from '../../portal/js/draft-sources-model.js';
import { pdfFacts } from '../../portal/js/pdf-pages.js';

export const ZIP_LIMITS = Object.freeze({
  maxEntries: 2000,
  maxEntryBytes: 20 * MB,        // one file inside, unpacked
  maxTotalBytes: 30 * MB,        // everything read from one ZIP, unpacked
});
export const MAX_REQUEST_BYTES = 32 * MB;          // the model API's limit for one request
export const CONTENT_BUDGET = 31 * MB;             // what the files may take of it (base64 included)
export const MAX_IMAGE_EDGE = 8000;                // pixels, the model API's limit
export const MAX_SHEET_ROWS = 500;
export const MAX_SHEET_COLUMNS = 60;

/** A file that cannot be used. `message` is for staff; `code` is for the logs. */
export class SourceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SourceError';
    this.code = code;
  }
}

const utf8 = new TextDecoder('utf-8');
const cp1252 = new TextDecoder('windows-1252');
const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const be16 = (b, o) => (b[o] << 8) | b[o + 1];
const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
export const base64Length = (bytes) => 4 * Math.ceil(bytes / 3);

// A file's name as staff typed it, safe to show and to put in an attribute
export function cleanName(name) {
  const text = String(name ?? '').replace(/[\u0000-\u001f\u007f<>"&]/g, '').replace(/\s+/g, ' ').trim();
  return text.slice(0, MAX_NAME) || 'Untitled file';
}

// ---------------------------------------------------------------------------
// ZIP

/**
 * A minimal ZIP reader: the central directory, then each entry on demand.
 * -> { names, has(name), read(name) -> Uint8Array, text(name) -> string }
 * Throws a SourceError for ZIP64, encryption, a broken file, or more than
 * the limits allow (entries, one entry unpacked, all reads unpacked).
 */
export function readZip(bytes, limits = ZIP_LIMITS) {
  const broken = () => new SourceError('zip_broken', 'This file is damaged or is not a document that can be read.');
  if (bytes.length < 22) throw broken();
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw broken();
  if (eocd >= 20 && u32(bytes, eocd - 20) === 0x07064b50) throw new SourceError('zip64', 'This file is too large to read. Save a smaller copy and add it again.');
  const disk = u16(bytes, eocd + 4);
  const count = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new SourceError('zip64', 'This file is too large to read. Save a smaller copy and add it again.');
  }
  if (disk !== 0) throw broken();
  if (count > limits.maxEntries) throw new SourceError('zip_entries', 'This file has too many parts to read.');
  if (cdOffset + cdSize > eocd) throw broken();

  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw broken();
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compressed = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLength = u16(bytes, p + 28);
    const extraLength = u16(bytes, p + 30);
    const commentLength = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    if (compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) {
      throw new SourceError('zip64', 'This file is too large to read. Save a smaller copy and add it again.');
    }
    if (flags & 0x1) throw new SourceError('encrypted', REFUSED.encrypted);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    if (!entries.has(name)) entries.set(name, { method, compressed, size, local });
    p += 46 + nameLength + extraLength + commentLength;
  }

  let total = 0;
  function read(name) {
    const e = entries.get(name);
    if (!e) return null;
    if (e.size > limits.maxEntryBytes) throw new SourceError('zip_large', 'A part of this file is too large to read.');
    if (e.local + 30 > bytes.length || u32(bytes, e.local) !== 0x04034b50) throw broken();
    const start = e.local + 30 + u16(bytes, e.local + 26) + u16(bytes, e.local + 28);
    const data = bytes.subarray(start, start + e.compressed);
    if (data.length !== e.compressed) throw broken();
    const room = Math.min(limits.maxEntryBytes, limits.maxTotalBytes - total);
    if (room <= 0) throw new SourceError('zip_large', 'This file holds too much to read.');
    let out;
    if (e.method === 0) {
      out = data;
    } else if (e.method === 8) {
      try {
        out = new Uint8Array(inflateRawSync(data, { maxOutputLength: room }));
      } catch (err) {
        if (err?.code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError) {
          throw new SourceError('zip_large', 'This file holds too much to read.');
        }
        throw broken();
      }
    } else {
      throw new SourceError('zip_method', 'This file is packed in a way that can’t be read. Save a new copy and add it again.');
    }
    if (out.length > room) throw new SourceError('zip_large', 'This file holds too much to read.');
    total += out.length;
    return out;
  }
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    size: (name) => entries.get(name)?.size ?? 0,
    read,
    text: (name) => {
      const raw = read(name);
      return raw ? utf8.decode(raw) : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Types from the first bytes

const OFFICE = { 'word/document.xml': 'docx', 'ppt/presentation.xml': 'pptx', 'xl/workbook.xml': 'xlsx' };
const ODF = {
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.text-template': 'odt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.presentation-template': 'odp',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.spreadsheet-template': 'ods',
};
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const utf16le = (text) => Buffer.from(text, 'utf16le');

function includesBytes(bytes, needle, limit = bytes.length) {
  const end = Math.min(bytes.length, limit) - needle.length;
  outer: for (let i = 0; i <= end; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

// Whether bytes read as text: no NUL bytes and few other control characters
function looksLikeText(bytes) {
  const sample = bytes.subarray(0, 65_536);
  if (sample[0] === 0xff && sample[1] === 0xfe) return true;
  if (sample[0] === 0xfe && sample[1] === 0xff) return true;
  let control = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32 && b !== 27)) control += 1;
  }
  return control <= sample.length / 100;
}

/**
 * -> { kind, mime?, zip? } where kind is image | pdf | docx | pptx | xlsx |
 * odt | odp | ods | text | html | rtf. Throws a SourceError for a type that is
 * refused.
 */
export function sniff(bytes) {
  if (!bytes?.length) throw new SourceError('empty', REFUSED.empty);
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (b.length >= 8 && be32(b, 0) === 0x89504e47 && be32(b, 4) === 0x0d0a1a0a) return { kind: 'image', mime: 'image/png' };
  if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) return { kind: 'image', mime: 'image/gif' };
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    if (HEIF_BRANDS.has(ascii(b, 8, 12))) throw new SourceError('heic', REFUSED.heic);
    throw new SourceError('unknown', REFUSED.unknown);
  }
  if (includesBytes(b, [0x25, 0x50, 0x44, 0x46, 0x2d], 1024)) return { kind: 'pdf', mime: 'application/pdf' };
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05)) {
    const zip = readZip(b);
    for (const [entry, kind] of Object.entries(OFFICE)) if (zip.has(entry)) return { kind, zip };
    if (zip.has('mimetype')) {
      const type = (zip.text('mimetype') ?? '').trim();
      if (ODF[type]) return { kind: ODF[type], zip };
    }
    if (zip.names.some((n) => /^Index\/.*\.iwa$/.test(n) || n === 'index.apxl' || n === 'index.xml')) throw new SourceError('iwork', REFUSED.iwork);
    throw new SourceError('unknown', REFUSED.unknown);
  }
  if (b.length >= 8 && be32(b, 0) === 0xd0cf11e0 && be32(b, 4) === 0xa1b11ae1) {
    if (includesBytes(b, utf16le('EncryptedPackage'))) throw new SourceError('encrypted', REFUSED.encrypted);
    if (includesBytes(b, utf16le('WordDocument'))) throw new SourceError('legacy', REFUSED.doc);
    if (includesBytes(b, utf16le('PowerPoint Document'))) throw new SourceError('legacy', REFUSED.ppt);
    if (includesBytes(b, utf16le('Workbook')) || includesBytes(b, utf16le('Book'))) throw new SourceError('legacy', REFUSED.xls);
    throw new SourceError('legacy', REFUSED.doc);
  }
  if (ascii(b, 0, Math.min(5, b.length)) === '{\\rtf') return { kind: 'rtf', mime: 'application/rtf' };
  if (looksLikeText(b)) {
    const head = decodeText(b.subarray(0, 4096)).trimStart().toLowerCase();
    const html = /^(<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]|<meta[\s>])/.test(head)
      || (head.startsWith('<') && (head.match(/<(?:p|div|br|table|span|h[1-6]|ul|ol|li|section|article)\b/g) ?? []).length >= 2);
    return html ? { kind: 'html', mime: 'text/html' } : { kind: 'text', mime: 'text/plain' };
  }
  throw new SourceError('unknown', REFUSED.unknown);
}

// Width and height from an image's header, or null when it can't tell
export function imageSize(bytes, mime) {
  const b = bytes;
  try {
    if (mime === 'image/png' && b.length >= 24) return { width: be32(b, 16), height: be32(b, 20) };
    if (mime === 'image/gif' && b.length >= 10) return { width: u16(b, 6), height: u16(b, 8) };
    if (mime === 'image/webp' && b.length >= 30) {
      const chunk = ascii(b, 12, 16);
      if (chunk === 'VP8 ') return { width: u16(b, 26) & 0x3fff, height: u16(b, 28) & 0x3fff };
      if (chunk === 'VP8L') {
        return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
      }
      if (chunk === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      return null;
    }
    if (mime === 'image/jpeg') {
      let p = 2;
      while (p + 9 < b.length) {
        if (b[p] !== 0xff) { p += 1; continue; }
        const marker = b[p + 1];
        if (marker === 0xff) { p += 1; continue; }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
        if (marker === 0xd9 || marker === 0xda) return null;
        if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: be16(b, p + 7), height: be16(b, p + 5) };
        p += 2 + be16(b, p + 2);
      }
    }
  } catch {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: ', ', hellip: '...', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', times: '×', divide: '÷', plusmn: '±', deg: '°', middot: '·', bull: '•', minus: '−', le: '≤', ge: '≥',
  ne: '≠', frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', pi: 'π', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£',
  cent: '¢', yen: '¥', sect: '§', para: '¶', laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿', shy: '', zwj: '', zwnj: '', thinsp: ' ',
  ensp: ' ', emsp: ' ', infin: '∞', radic: '√', sum: '∑', prod: '∏', int: '∫', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ',
  lambda: 'λ', mu: 'μ', sigma: 'σ', omega: 'ω', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω', larr: '←', rarr: '→', harr: '↔', rArr: '⇒', hArr: '⇔',
};

export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,8});/gi, (all, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '�';
    }
    return Object.hasOwn(NAMED, ent) ? NAMED[ent] : all;
  });
}

// Bytes as text: a byte order mark decides, else UTF-8, else Windows-1252
export function decodeText(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8.decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return cp1252.decode(bytes);
  }
}

// Blank lines at most one in a row, no spaces at line ends
export function tidy(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n\t]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** HTML as text: scripts, styles and comments go, blocks become lines, cells tabs */
export function htmlText(html) {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? '';
  const body = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head|object|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(script|style)\b[\s\S]*$/i, ' ')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/?(p|div|section|article|header|footer|main|nav|aside|h[1-6]|ul|ol|tr|table|thead|tbody|blockquote|pre|dl|dd|dt|figure|figcaption|form|fieldset|caption)\b[^>]*>/gi, '\n')
    .replace(/<\/?(td|th)\b[^>]*>/gi, '\t')
    .replace(/<[^>]*>/g, '');
  const text = tidy(decodeEntities(body).replace(/\t{2,}/g, '\t').replace(/\n\t/g, '\n'));
  const head = tidy(decodeEntities(title.replace(/<[^>]*>/g, '')));
  return head && !text.startsWith(head) ? `${head}\n\n${text}` : text;
}

const RTF_SKIP = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'objdata', 'themedata', 'colorschememapping', 'datastore',
  'latentstyles', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'mmathPr', 'fldinst', 'filetbl', 'revtbl',
  'pgdsctbl', 'bkmkstart', 'bkmkend', 'shppict', 'nonshppict', 'shp', 'docvar', 'xe', 'tc', 'userprops', 'wgrffmtfilter', 'fchars', 'lchars',
]);
const RTF_CHAR = {
  par: '\n', line: '\n', sect: '\n\n', page: '\n\n', row: '\n', cell: '\t', tab: '\t', emdash: ', ', endash: '-', bullet: '•',
  lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ', qmspace: ' ',
};

/** RTF as text: groups that are not text (fonts, pictures, fields' codes...) and control words go */
export function rtfText(source) {
  const rtf = String(source);
  let out = '';
  let state = { skip: false, uc: 1 };
  const stack = [];
  let pending = 0;     // characters still to skip after a \u (its fallback)
  let i = 0;
  const emit = (text) => {
    if (pending > 0) { pending -= 1; return; }
    if (!state.skip) out += text;
  };
  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === '{') { stack.push(state); state = { ...state }; pending = 0; i += 1; continue; }
    if (ch === '}') { state = stack.pop() ?? state; pending = 0; i += 1; continue; }
    if (ch === '\r' || ch === '\n') { i += 1; continue; }
    if (ch !== '\\') { emit(ch); i += 1; continue; }
    const next = rtf[i + 1];
    if (next === '\\' || next === '{' || next === '}') { emit(next); i += 2; continue; }
    if (next === '*') { state.skip = true; i += 2; continue; }
    if (next === "'") {
      const code = parseInt(rtf.slice(i + 2, i + 4), 16);
      if (Number.isInteger(code)) emit(cp1252.decode(Uint8Array.of(code)));
      i += 4;
      continue;
    }
    if (next === '~') { emit(' '); i += 2; continue; }
    if (next === '_') { emit('-'); i += 2; continue; }
    if (next === '-' || next === ':' || next === '|') { i += 2; continue; }
    if (next === '\n' || next === '\r') { emit('\n'); i += 2; continue; }
    const m = /^\\([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(rtf.slice(i, i + 48));
    if (!m) { i += 2; continue; }
    i += m[0].length;
    const [, word, param] = m;
    if (RTF_SKIP.has(word)) { state.skip = true; continue; }
    if (word === 'uc') { state.uc = Math.max(0, Number(param) || 0); continue; }
    if (word === 'u') {
      let code = Number(param);
      if (code < 0) code += 65_536;
      if (!state.skip && pending === 0 && code > 0) out += String.fromCharCode(code);
      pending = state.uc;
      continue;
    }
    if (Object.hasOwn(RTF_CHAR, word)) emit(RTF_CHAR[word]);
  }
  return tidy(out);
}

// ---------------------------------------------------------------------------
// XML of documents

const TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s(?:[^>"'/]|\/(?!>)|"[^"]*"|'[^']*')*)?)(\/?)>|([^<]+)/g;

function* tokens(xml) {
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(xml))) {
    if (m[1] !== undefined) yield { text: m[1] };
    else if (m[6] !== undefined) yield { text: decodeEntities(m[6]) };
    else if (m[3]) yield { close: m[2] === '/', name: m[3], attrs: m[4] ?? '', empty: m[5] === '/' };
  }
}

const attr = (attrs, name) => {
  const m = new RegExp(`(?:^|\\s)${name.replace(/[.:]/g, '\\$&')}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : null;
};

/**
 * Lines of text from a document's XML. `names` says which elements hold
 * text, end a paragraph, are a tab or a line break, and make a table, its
 * rows and cells. Tables come out as tab-separated lines.
 */
function xmlLines(xml, names, { mathMarks = null, skip = null, onOpen = null, cellCap = MAX_SHEET_COLUMNS } = {}) {
  const lines = [];
  let para = '';
  let inText = 0;
  let skipping = 0;
  const tables = [];
  const top = () => tables[tables.length - 1];
  const add = (text) => {
    if (skipping) return;
    para += text;
  };
  const endPara = () => {
    const text = para.replace(/[  ]+/g, ' ').trim();
    para = '';
    const t = top();
    if (t?.cell) { if (text) t.cell.push(text); return; }
    lines.push(text);
  };
  for (const tok of tokens(xml)) {
    if (tok.text !== undefined) {
      if (inText > 0 || names.anyText) add(tok.text.replace(/[\r\n]+/g, ' '));
      continue;
    }
    const { name, close, empty, attrs } = tok;
    if (skip?.has(name)) {
      if (!close && !empty) skipping += 1;
      else if (close) skipping = Math.max(0, skipping - 1);
      continue;
    }
    if (!close) onOpen?.(name, attrs, { lines, endPara, add });
    if (names.text.has(name)) {
      if (!close && !empty) inText += 1;
      else if (close) inText = Math.max(0, inText - 1);
      continue;
    }
    if (!close && names.tab.has(name)) { add(top()?.cell ? ' ' : '\t'); continue; }
    if (!close && names.lineBreak.has(name)) { add(top()?.cell ? ' ' : '\n'); continue; }
    if (!close && names.space?.has(name)) { add(' '.repeat(Math.min(50, Math.max(1, Number(attr(attrs, names.spaceCount)) || 1)))); continue; }
    if (mathMarks && Object.hasOwn(mathMarks, name)) { add(close ? mathMarks[name][1] : mathMarks[name][0]); continue; }
    if (names.table.has(name)) {
      if (!close && !empty) tables.push({ rows: [], row: null, cell: null });
      else if (close) {
        tables.pop();
      }
      continue;
    }
    const t = top();
    if (names.row.has(name) && t) {
      if (!close) t.row = [];
      if (close || empty) {
        const cells = (t.row ?? []).slice(0, cellCap);
        while (cells.length && !cells[cells.length - 1]) cells.pop();
        const text = cells.join('\t');
        t.row = null;
        if (tables.length > 1) tables[tables.length - 2].cell?.push(text.replace(/\t/g, ' '));
        else if (text) lines.push(text);
      }
      continue;
    }
    if (names.cell.has(name) && t) {
      if (!close) t.cell = [];
      if (close || empty) {
        if (para.trim()) endPara();
        t.row?.push((t.cell ?? []).join(' ').replace(/\t/g, ' '));
        t.cell = null;
      }
      continue;
    }
    if (names.para.has(name) && (close || empty)) endPara();
  }
  if (para.trim()) endPara();
  return lines;
}

const linesText = (lines) => tidy(lines.join('\n'));

// Office Math as plain text: a fraction (a)/(b), powers ^( ), subscripts _( ), roots √( )
const OMML_MARKS = {
  'm:num': ['(', ')/'], 'm:den': ['(', ')'], 'm:sup': ['^(', ')'], 'm:sub': ['_(', ')'], 'm:rad': ['√(', ')'], 'm:d': ['(', ')'],
};
const WORD = {
  text: new Set(['w:t', 'm:t']),
  para: new Set(['w:p']),
  tab: new Set(['w:tab', 'w:ptab']),
  lineBreak: new Set(['w:br', 'w:cr']),
  table: new Set(['w:tbl']),
  row: new Set(['w:tr']),
  cell: new Set(['w:tc']),
};
const WORD_SKIP = new Set(['w:delText', 'w:instrText', 'm:degHide', 'w:rPr', 'w:pPr', 'm:rPr', 'm:ctrlPr', 'm:fPr', 'm:radPr', 'm:dPr', 'm:sSupPr', 'm:sSubPr']);

/** The text of a Word document's XML part */
export function wordText(xml) {
  return linesText(xmlLines(xml, WORD, { mathMarks: OMML_MARKS, skip: WORD_SKIP }));
}

const sortByNumber = (names, re) => names.map((n) => ({ n, k: Number(re.exec(n)?.[1]) })).filter((x) => Number.isFinite(x.k))
  .sort((a, b) => a.k - b.k).map((x) => x.n);

/** Word: the body, then headers, footers and footnotes */
export function docxText(zip) {
  const parts = [];
  const each = (re) => sortByNumber(zip.names.filter((n) => re.test(n)), re).map((n) => wordText(zip.text(n) ?? '')).filter(Boolean);
  const headers = [...new Set(each(/^word\/header(\d*)\.xml$/))];
  if (headers.length) parts.push(`Header: ${headers.join(' / ')}`);
  parts.push(wordText(zip.text('word/document.xml') ?? ''));
  const notes = [...each(/^word\/footnotes()\.xml$/), ...each(/^word\/endnotes()\.xml$/)];
  if (notes.length) parts.push(`Notes:\n${notes.join('\n')}`);
  const footers = [...new Set(each(/^word\/footer(\d*)\.xml$/))];
  if (footers.length) parts.push(`Footer: ${footers.join(' / ')}`);
  return tidy(parts.filter(Boolean).join('\n\n'));
}

const DRAWING = {
  text: new Set(['a:t']),
  para: new Set(['a:p']),
  tab: new Set(['a:tab']),
  lineBreak: new Set(['a:br']),
  table: new Set(['a:tbl']),
  row: new Set(['a:tr']),
  cell: new Set(['a:tc']),
};

// A part's relationships: id -> target path (resolved against the part's folder)
function relationships(zip, part) {
  const slash = part.lastIndexOf('/');
  const dir = part.slice(0, slash);
  const rels = zip.text(`${dir}/_rels/${part.slice(slash + 1)}.rels`);
  const out = [];
  if (!rels) return out;
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], 'Id');
    const type = attr(m[1], 'Type') ?? '';
    let target = attr(m[1], 'Target') ?? '';
    if (attr(m[1], 'TargetMode') === 'External') continue;
    const parts = (target.startsWith('/') ? target.slice(1) : `${dir}/${target}`).split('/');
    const path = [];
    for (const seg of parts) {
      if (seg === '..') path.pop();
      else if (seg && seg !== '.') path.push(seg);
    }
    target = path.join('/');
    out.push({ id, type, target });
  }
  return out;
}

/** PowerPoint: every slide in order, "Slide N" and its text, then its speaker notes */
export function pptxText(zip) {
  const slides = sortByNumber(zip.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)), /slide(\d+)\.xml$/);
  const out = [];
  slides.forEach((name, i) => {
    const text = linesText(xmlLines(zip.text(name) ?? '', DRAWING));
    const notesPart = relationships(zip, name).find((r) => /\/notesSlide$/.test(r.type))?.target;
    let notes = '';
    if (notesPart && zip.has(notesPart)) {
      const xml = zip.text(notesPart) ?? '';
      const bodies = [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].map((m) => m[0]).filter((sp) => /<p:ph\b[^>]*\btype="body"/.test(sp));
      notes = linesText(bodies.flatMap((sp) => xmlLines(sp, DRAWING)));
    }
    out.push([`Slide ${i + 1}`, text, notes ? `Speaker notes: ${notes}` : ''].filter(Boolean).join('\n'));
  });
  return tidy(out.join('\n\n'));
}

// "B12" -> 1 (zero-based column)
const columnIndex = (ref) => {
  const letters = /^([A-Z]{1,3})/.exec(String(ref ?? ''))?.[1];
  if (!letters) return null;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
const cellText = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

/** Excel: each sheet's cells as tab-separated lines, at most MAX_SHEET_ROWS rows a sheet */
export function xlsxText(zip) {
  const shared = [];
  const sst = zip.text('xl/sharedStrings.xml');
  if (sst) {
    for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
      const body = (m[1] ?? '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
      shared.push(decodeEntities([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
    }
  }
  const workbook = zip.text('xl/workbook.xml') ?? '';
  const rels = relationships(zip, 'xl/workbook.xml');
  let sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => {
    const id = attr(m[1], 'r:id');
    return { name: attr(m[1], 'name') ?? '', path: rels.find((r) => r.id === id)?.target ?? null };
  }).filter((s) => s.path && zip.has(s.path));
  if (!sheets.length) {
    sheets = sortByNumber(zip.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)), /sheet(\d+)\.xml$/)
      .map((path, i) => ({ name: `Sheet ${i + 1}`, path }));
  }
  const out = [];
  for (const sheet of sheets) {
    const xml = zip.text(sheet.path) ?? '';
    const rows = [];
    let more = false;
    for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = [];
      let next = 0;
      for (const c of (r[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const at = columnIndex(attr(c[1], 'r'));
        const col = at ?? next;
        next = col + 1;
        if (col >= MAX_SHEET_COLUMNS) continue;
        const type = attr(c[1], 't');
        const body = c[2] ?? '';
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value;
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = decodeEntities([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        else if (type === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else value = decodeEntities(v ?? '');
        cells[col] = cellText(value);
      }
      const line = Array.from(cells, (x) => x ?? '').join('\t').replace(/\t+$/, '');
      if (!line.trim()) continue;
      if (rows.length >= MAX_SHEET_ROWS) { more = true; break; }
      rows.push(line);
    }
    if (!rows.length) continue;
    out.push([`Sheet: ${cellText(sheet.name) || 'Untitled'}`, ...rows, more ? `(Only the first ${MAX_SHEET_ROWS} rows of this sheet were read.)` : ''].filter(Boolean).join('\n'));
  }
  return out.join('\n\n');
}

const ODF_NAMES = {
  text: new Set([]),
  anyText: true,
  para: new Set(['text:p', 'text:h']),
  tab: new Set(['text:tab']),
  lineBreak: new Set(['text:line-break']),
  space: new Set(['text:s']),
  spaceCount: 'text:c',
  table: new Set(['table:table']),
  row: new Set(['table:table-row']),
  cell: new Set(['table:table-cell', 'table:covered-table-cell']),
};

/**
 * OpenDocument: the text of content.xml. Text sits in text:p and text:h at
 * any depth. A slide (draw:page) starts "Slide N", its speaker notes are
 * marked, and a spreadsheet's sheets are named and capped like Excel's.
 */
export function odfText(zip, kind) {
  const xml = zip.text('content.xml') ?? '';
  // Repeated cells and rows (a sheet's empty tail repeats a million times)
  // are written out a few times at most, and empty ones once
  const expanded = xml
    .replace(/<table:table-cell\b([^>]*?)\btable:number-columns-repeated="(\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/table:table-cell>)/g,
      (all, a, n, b, end, inner) => `<table:table-cell${a}${b}${end}`.repeat(Math.min(Number(n) || 1, inner && inner.trim() ? MAX_SHEET_COLUMNS : 1)))
    .replace(/<table:table-row\b([^>]*?)\btable:number-rows-repeated="(\d+)"([^>]*?)(?<!\/)>([\s\S]*?)<\/table:table-row>/g,
      (all, a, n, b, inner) => `<table:table-row${a}${b}>${inner}</table:table-row>`.repeat(Math.min(Number(n) || 1, /<text:p\b[^>]*>(?!<\/text:p>)/.test(inner) ? 20 : 1)));
  let slide = 0;
  const lines = xmlLines(expanded, ODF_NAMES, {
    skip: new Set(['office:annotation', 'text:tracked-changes', 'office:forms', 'presentation:settings']),
    onOpen(name, attrs, api) {
      if (name === 'draw:page') { slide += 1; api.lines.push('', `Slide ${slide}`); }
      if (name === 'presentation:notes') api.lines.push('Speaker notes:');
      if (name === 'table:table' && kind === 'ods') api.lines.push('', `Sheet: ${cellText(attr(attrs, 'table:name')) || 'Untitled'}`);
    },
  });
  return capSheetRows(tidy(lines.join('\n')), kind);
}

// An OpenDocument spreadsheet keeps at most MAX_SHEET_ROWS rows a sheet
function capSheetRows(text, kind) {
  if (kind !== 'ods') return text;
  return text.split(/\n(?=Sheet: )/).map((block) => {
    const [head, ...rows] = block.split('\n');
    if (rows.length <= MAX_SHEET_ROWS) return block;
    return [head, ...rows.slice(0, MAX_SHEET_ROWS), `(Only the first ${MAX_SHEET_ROWS} rows of this sheet were read.)`].join('\n');
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Pictures inside documents

const MEDIA = { docx: /^word\/media\//, pptx: /^ppt\/media\//, odt: /^Pictures\//, odp: /^Pictures\//, xlsx: /^xl\/media\//, ods: /^Pictures\// };
const PICTURE_KINDS = new Set(['docx', 'pptx', 'odt', 'odp']);

/**
 * The JPEG, PNG, WebP and GIF pictures in a document, each at most
 * MAX_EMBEDDED_IMAGE_BYTES and MAX_IMAGE_EDGE, at most `max` of them, in the
 * order they are stored. -> { pictures: [{ mime, bytes }], skipped }
 */
export function documentPictures(zip, kind, { max = MAX_EMBEDDED_IMAGES } = {}) {
  if (!PICTURE_KINDS.has(kind)) return { pictures: [], skipped: 0 };
  const names = zip.names.filter((n) => MEDIA[kind].test(n) && !n.endsWith('/'));
  const pictures = [];
  let skipped = 0;
  for (const name of sortByNumber(names, /(\d+)\.[a-z0-9]+$/i).concat(names.filter((n) => !/(\d+)\.[a-z0-9]+$/i.test(n)))) {
    if (pictures.length >= max || zip.size(name) > MAX_EMBEDDED_IMAGE_BYTES) { skipped += 1; continue; }
    let bytes;
    try {
      bytes = zip.read(name);
    } catch {
      skipped += 1;
      continue;
    }
    let type = null;
    try {
      type = sniff(bytes);
    } catch {
      type = null;
    }
    const size = type?.kind === 'image' ? imageSize(bytes, type.mime) : null;
    if (type?.kind !== 'image' || bytes.length > MAX_EMBEDDED_IMAGE_BYTES || (size && Math.max(size.width, size.height) > MAX_IMAGE_EDGE)) {
      skipped += 1;
      continue;
    }
    pictures.push({ mime: type.mime, bytes });
  }
  return { pictures, skipped };
}

// ---------------------------------------------------------------------------
// One file, then all of them

const zlibInflate = (raw, max) => new Uint8Array(inflateSync(raw, { maxOutputLength: max }));

/**
 * What one file gives the model.
 * -> { name, kind, pdf?: { bytes, pages }, image?: { mime, bytes },
 *      text?: string, pictures: [{ mime, bytes }], skippedPictures }
 * Throws a SourceError whose message starts with the file's name.
 */
export async function extractSource({ name, bytes }) {
  const label = cleanName(name);
  try {
    const type = sniff(bytes);
    if (type.kind === 'pdf' && bytes.length > MAX_PDF_BYTES) {
      throw new SourceError('too_large', `PDFs must be ${sizeText(MAX_PDF_BYTES)} or smaller. Split it, or save the pages you need as a new PDF.`);
    }
    if (type.kind !== 'pdf' && type.kind !== 'image' && bytes.length > MAX_DOC_BYTES) {
      throw new SourceError('too_large', `Files like this must be ${sizeText(MAX_DOC_BYTES)} or smaller.`);
    }
    const base = { name: label, kind: type.kind, pictures: [], skippedPictures: 0 };
    if (type.kind === 'image') {
      const size = imageSize(bytes, type.mime);
      if (size && Math.max(size.width, size.height) > MAX_IMAGE_EDGE) throw new SourceError('image_large', 'This picture is too large. Use a smaller copy.');
      if (bytes.length > MAX_EMBEDDED_IMAGE_BYTES) throw new SourceError('image_large', 'This picture is too large. Use a smaller copy.');
      return { ...base, image: { mime: type.mime, bytes } };
    }
    if (type.kind === 'pdf') {
      const facts = await pdfFacts(bytes, { inflate: zlibInflate });
      if (facts.encrypted) throw new SourceError('encrypted', REFUSED.encrypted);
      return { ...base, pdf: { bytes, pages: facts.pages } };
    }
    if (type.kind === 'rtf') return { ...base, text: rtfText(cp1252.decode(bytes)) };
    if (type.kind === 'html') return { ...base, text: htmlText(decodeText(bytes)) };
    if (type.kind === 'text') return { ...base, text: tidy(decodeText(bytes)) };
    const zip = type.zip;
    const text = type.kind === 'docx' ? docxText(zip)
      : type.kind === 'pptx' ? pptxText(zip)
        : type.kind === 'xlsx' ? xlsxText(zip)
          : odfText(zip, type.kind);
    const { pictures, skipped } = documentPictures(zip, type.kind);
    return { ...base, text, pictures, skippedPictures: skipped };
  } catch (err) {
    if (err instanceof SourceError) throw new SourceError(err.code, `${label}: ${err.message}`);
    throw new SourceError('unreadable', `${label}: This file could not be read. Save a new copy and add it again.`);
  }
}

const b64 = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const PASTED = 'Pasted lesson notes';

// <reference_file name="...">...</reference_file>, with nothing inside able to close it early
export function referenceFile(name, text) {
  const safe = cleanName(name);
  const body = String(text ?? '').replace(/<\/?\s*reference_file\b[^>]*>/gi, '');
  return `<reference_file name="${safe}">\n${body}\n</reference_file>`;
}

// Cut text at the last line (else word) end that fits in max characters
function cutText(text, max) {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const line = head.lastIndexOf('\n');
  if (line > max * 0.6) return head.slice(0, line);
  const word = head.replace(/\s+\S*$/, '');
  return word || head;
}

/**
 * Every source of one draft as model content blocks, in the order the model
 * reads best: PDFs, then photos, then the text of documents (each followed by
 * its pictures), then pasted notes. Applies the limits for all files
 * together; what was left out is said in `notes` (for staff).
 *   files       [{ name, bytes }] as uploaded
 *   notesText   pasted lesson notes, or null
 * -> { blocks, notes, counts: { files, pdfs, pages, images, chars } }
 */
export async function sourceContent(files, { notesText = null } = {}) {
  const sources = [];
  for (const file of files) sources.push(await extractSource(file));

  const pages = sources.reduce((n, s) => n + (s.pdf?.pages ?? 0), 0);
  if (pages > MAX_PDF_PAGES) {
    throw new SourceError('pages', `These PDFs have ${pages} pages together. One draft can read ${MAX_PDF_PAGES} pages, so remove a PDF or use fewer pages.`);
  }
  const photos = sources.filter((s) => s.image).length;
  if (photos > MAX_IMAGES) throw new SourceError('images', `Add at most ${MAX_IMAGES} photos to one draft.`);

  const notes = [];
  // Text: in order, pasted notes last, cut when the total would pass MAX_TEXT_CHARS
  const texts = [...sources.filter((s) => typeof s.text === 'string').map((s) => ({ source: s, name: s.name, text: s.text }))];
  const pasted = typeof notesText === 'string' && notesText.trim() ? { name: PASTED, text: tidy(notesText) } : null;
  if (pasted) texts.push(pasted);
  let room = MAX_TEXT_CHARS;
  const cut = [];
  const empty = [];
  for (const t of texts) {
    if (!t.text) { if (t.source) empty.push(t.name); continue; }
    if (t.text.length > room) {
      t.text = room >= 200 ? cutText(t.text, room) : '';
      cut.push(t.name);
    }
    room -= t.text.length;
  }
  if (cut.length) notes.push(`Only the first ${MAX_TEXT_CHARS.toLocaleString('en-US')} characters of text were read, so ${cut.join(', ')} ${cut.length === 1 ? 'was' : 'were'} cut short.`);
  if (empty.length) notes.push(`No text was found in ${empty.join(', ')}.`);

  // Size: PDFs, photos and text must fit; pictures from documents go in while they do
  let used = 0;
  for (const s of sources) {
    if (s.pdf) used += base64Length(s.pdf.bytes.length) + 200;
    if (s.image) used += base64Length(s.image.bytes.length) + 200;
  }
  for (const t of texts) used += Math.ceil(Buffer.byteLength(t.text) * 1.1) + 200;
  if (used > CONTENT_BUDGET) {
    throw new SourceError('too_large', 'These files are too large together for one draft. Remove a file or use a smaller PDF.');
  }

  let images = photos;
  let overCount = 0;
  let overSize = 0;
  const kept = new Map();
  for (const s of sources) {
    const keep = [];
    for (const pic of s.pictures) {
      const size = base64Length(pic.bytes.length) + 200;
      if (images >= MAX_IMAGES) { overCount += 1; continue; }
      if (used + size > CONTENT_BUDGET) { overSize += 1; continue; }
      keep.push(pic);
      images += 1;
      used += size;
    }
    kept.set(s, keep);
    if (s.skippedPictures) {
      notes.push(`${plural(s.skippedPictures, 'picture')} in ${s.name} ${s.skippedPictures === 1 ? 'was' : 'were'} left out: only JPEG, PNG, WebP and GIF pictures under 3.5 MB are read, at most ${MAX_EMBEDDED_IMAGES} from each file.`);
    }
  }
  if (overCount) notes.push(`${plural(overCount, 'picture')} from documents ${overCount === 1 ? 'was' : 'were'} left out: one draft reads at most ${MAX_IMAGES} pictures.`);
  if (overSize) notes.push(`${plural(overSize, 'picture')} from documents ${overSize === 1 ? 'was' : 'were'} left out to keep the files small enough for one draft.`);

  const blocks = [];
  for (const s of sources) {
    if (s.pdf) blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(s.pdf.bytes) }, title: s.name });
  }
  const photoList = sources.filter((s) => s.image);
  photoList.forEach((s, i) => {
    blocks.push({ type: 'text', text: `Lesson photo ${i + 1} of ${photoList.length}: ${s.name}` });
    blocks.push({ type: 'image', source: { type: 'base64', media_type: s.image.mime, data: b64(s.image.bytes) } });
  });
  for (const t of texts) {
    if (t.text) blocks.push({ type: 'text', text: referenceFile(t.name, t.text) });
    const pics = t.source ? kept.get(t.source) ?? [] : [];
    if (pics.length) {
      blocks.push({ type: 'text', text: `${plural(pics.length, 'picture')} from ${t.name}:` });
      for (const pic of pics) blocks.push({ type: 'image', source: { type: 'base64', media_type: pic.mime, data: b64(pic.bytes) } });
    }
  }
  return {
    blocks,
    notes,
    counts: {
      files: sources.length,
      pdfs: sources.filter((s) => s.pdf).length,
      pages,
      images,
      chars: texts.reduce((n, t) => n + t.text.length, 0),
    },
  };
}
