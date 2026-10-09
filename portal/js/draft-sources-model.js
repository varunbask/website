// The lesson materials a homework draft can read (staff only): which files
// are taken, their limits, the names they are stored under, and what the
// panel says about each one. No DOM and no imports, so the server
// (api/_lib/source-files.js) uses the same numbers and kinds.
//
// A tutor adds photos, PDFs, Word, PowerPoint, Excel, OpenDocument and text
// files, or pastes lesson notes. Photos are made smaller in the browser (a
// JPEG, which drops location data); every other file goes up as it is. The
// files go to the private draft-sources bucket under the tutor's own folder,
// the server reads them for the one draft and deletes them right after.
// The kind chosen here is only for the panel: the server reads the real type
// from the file's first bytes and never trusts a name or a browser's type.

export const SOURCE_BUCKET = 'draft-sources';

// Limits, checked in the panel before anything is uploaded and again on the server
export const MAX_SOURCE_FILES = 10;
export const MB = 1024 * 1024;
export const MAX_PDF_BYTES = 20 * MB;
export const MAX_DOC_BYTES = 15 * MB;           // every file that is not a PDF or a photo
export const MAX_PHOTO_BYTES = 40 * MB;         // a photo before it is made smaller
export const MAX_TOTAL_BYTES = 25 * MB;         // everything uploaded for one draft
export const MAX_PDF_PAGES = 100;               // all PDFs of one draft together
export const MAX_IMAGES = 20;                   // photos and pictures inside documents
export const MAX_TEXT_CHARS = 100_000;          // text read from documents and pasted notes
export const MAX_PASTED_NOTES = 10_000;
export const MAX_EMBEDDED_IMAGES = 8;           // pictures taken from one document
export const MAX_EMBEDDED_IMAGE_BYTES = Math.floor(3.5 * MB);
export const MAX_NAME = 200;

export const SOURCE_ACCEPT = 'image/*,.heic,.heif,.pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.txt,.md,.csv,.html,.htm,.rtf';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// kind -> what it is called, its icon, and the type it is uploaded as (the
// draft-sources bucket allows exactly these types)
export const SOURCE_KINDS = Object.freeze({
  image: Object.freeze({ label: 'Photo', icon: 'image-square', mime: 'image/jpeg' }),
  pdf: Object.freeze({ label: 'PDF', icon: 'file-pdf', mime: 'application/pdf' }),
  docx: Object.freeze({ label: 'Word', icon: 'file-text', mime: DOCX }),
  pptx: Object.freeze({ label: 'PowerPoint', icon: 'presentation', mime: PPTX }),
  xlsx: Object.freeze({ label: 'Excel', icon: 'file-text', mime: XLSX }),
  odt: Object.freeze({ label: 'OpenDocument text', icon: 'file-text', mime: 'application/vnd.oasis.opendocument.text' }),
  odp: Object.freeze({ label: 'OpenDocument slides', icon: 'presentation', mime: 'application/vnd.oasis.opendocument.presentation' }),
  ods: Object.freeze({ label: 'OpenDocument sheet', icon: 'file-text', mime: 'application/vnd.oasis.opendocument.spreadsheet' }),
  text: Object.freeze({ label: 'Text', icon: 'file-text', mime: 'text/plain' }),
  markdown: Object.freeze({ label: 'Markdown', icon: 'file-text', mime: 'text/markdown' }),
  csv: Object.freeze({ label: 'CSV', icon: 'file-text', mime: 'text/csv' }),
  html: Object.freeze({ label: 'Web page', icon: 'file-text', mime: 'text/html' }),
  rtf: Object.freeze({ label: 'Rich text', icon: 'file-text', mime: 'application/rtf' }),
});

// Every type the bucket takes (the migration lists the same ones)
export const SOURCE_MIME_TYPES = Object.freeze([
  ...new Set([...Object.values(SOURCE_KINDS).map((k) => k.mime), 'image/png', 'image/webp', 'image/gif', 'text/rtf']),
]);

const BY_EXTENSION = {
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image', heic: 'image', heif: 'image',
  bmp: 'image', avif: 'image',
  pdf: 'pdf', docx: 'docx', pptx: 'pptx', xlsx: 'xlsx', odt: 'odt', odp: 'odp', ods: 'ods',
  txt: 'text', text: 'text', md: 'markdown', markdown: 'markdown', csv: 'csv', html: 'html', htm: 'html', rtf: 'rtf',
};
const BY_MIME = {
  'application/pdf': 'pdf', [DOCX]: 'docx', [PPTX]: 'pptx', [XLSX]: 'xlsx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'text/plain': 'text', 'text/markdown': 'markdown', 'text/x-markdown': 'markdown', 'text/csv': 'csv',
  'text/html': 'html', 'application/rtf': 'rtf', 'text/rtf': 'rtf',
};

// What to say about a file that cannot be read, by what it is
export const REFUSED = Object.freeze({
  doc: 'This older Word format (.doc) can’t be read. Save it as PDF or .docx and add it again.',
  ppt: 'This older PowerPoint format (.ppt) can’t be read. Save it as PDF or .pptx and add it again.',
  xls: 'This older Excel format (.xls) can’t be read. Save it as PDF or .xlsx and add it again.',
  iwork: 'Pages, Keynote and Numbers files can’t be read. Export it as PDF and add it again.',
  heic: 'This photo format can’t be read here. Save it as JPEG or take a screenshot.',
  encrypted: 'This file is password-protected. Remove the password, or save it as a new PDF, and add it again.',
  empty: 'This file is empty.',
  unknown: 'This type of file can’t be read. Add a photo, a PDF, or a Word, PowerPoint, Excel or text file.',
});
const LEGACY = {
  doc: 'doc', dot: 'doc', ppt: 'ppt', pps: 'ppt', pot: 'ppt', xls: 'xls', xlt: 'xls',
  pages: 'iwork', key: 'iwork', numbers: 'iwork',
};
const LEGACY_MIME = {
  'application/msword': 'doc', 'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.ms-excel': 'xls',
  'application/vnd.apple.pages': 'iwork', 'application/vnd.apple.keynote': 'iwork', 'application/vnd.apple.numbers': 'iwork',
  'application/x-iwork-pages-sffpages': 'iwork', 'application/x-iwork-keynote-sffkey': 'iwork', 'application/x-iwork-numbers-sffnumbers': 'iwork',
};

export const extOf = (name) => {
  const m = /\.([a-z0-9]+)$/i.exec(String(name ?? ''));
  return m ? m[1].toLowerCase() : '';
};

/**
 * What the panel takes a chosen file to be, by its name and the browser's
 * type: { kind } or { refused: message }. A .csv the browser calls
 * application/vnd.ms-excel (Windows does) is still a CSV.
 */
export function classifyFile(file) {
  const ext = extOf(file?.name);
  const type = String(file?.type ?? '').toLowerCase();
  if (BY_EXTENSION[ext]) return { kind: BY_EXTENSION[ext], heic: ext === 'heic' || ext === 'heif' || /hei[cf]/.test(type) };
  if (LEGACY[ext]) return { refused: REFUSED[LEGACY[ext]] };
  if (type.startsWith('image/')) return { kind: 'image', heic: /hei[cf]/.test(type) };
  if (BY_MIME[type]) return { kind: BY_MIME[type], heic: false };
  if (LEGACY_MIME[type]) return { refused: REFUSED[LEGACY_MIME[type]] };
  return { refused: REFUSED.unknown };
}

// The largest a file of this kind may be (a photo is checked again after it is made smaller)
export function maxBytesFor(kind) {
  if (kind === 'pdf') return MAX_PDF_BYTES;
  if (kind === 'image') return MAX_PHOTO_BYTES;
  return MAX_DOC_BYTES;
}

// "850 KB", "2.4 MB"
export function sizeText(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < MB) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / MB;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

// What is wrong with one file before it is added, or null
export function fileProblem(file, kind) {
  if (!file?.size) return REFUSED.empty;
  const max = maxBytesFor(kind);
  if (file.size > max) {
    return kind === 'pdf'
      ? `PDFs must be ${sizeText(max)} or smaller. Split it, or save the pages you need as a new PDF.`
      : `Files like this must be ${sizeText(max)} or smaller.`;
  }
  return null;
}

/**
 * Whether the files fit one draft together, as the panel holds them:
 * sources [{ kind, bytes (as uploaded), pages (PDFs, or null) }].
 * -> '' or one sentence saying what to remove.
 */
export function sourcesProblem(sources) {
  const list = sources ?? [];
  if (list.length > MAX_SOURCE_FILES) return `Add at most ${MAX_SOURCE_FILES} files to one draft.`;
  const total = list.reduce((n, s) => n + (Number(s.bytes) || 0), 0);
  if (total > MAX_TOTAL_BYTES) {
    return `These files are ${sizeText(total)} together. One draft can read ${sizeText(MAX_TOTAL_BYTES)} in all, so remove a file.`;
  }
  const pages = list.reduce((n, s) => n + (s.kind === 'pdf' ? Number(s.pages) || 0 : 0), 0);
  if (pages > MAX_PDF_PAGES) return `These PDFs have ${pages} pages together. One draft can read ${MAX_PDF_PAGES} pages, so remove a PDF or use fewer pages.`;
  const photos = list.filter((s) => s.kind === 'image').length;
  if (photos > MAX_IMAGES) return `Add at most ${MAX_IMAGES} photos to one draft.`;
  return '';
}

// The name a file is stored under: letters, digits, dot, dash and underscore,
// the extension kept, at most 100 characters
export function safeName(name) {
  const raw = String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const ext = extOf(raw);
  const base = (ext ? raw.slice(0, -(ext.length + 1)) : raw)
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  const cut = (base || 'file').slice(0, ext ? 95 - ext.length : 100).replace(/[-.]+$/g, '') || 'file';
  return ext ? `${cut}.${ext}` : cut;
}

// A random folder name for one draft's files
export function draftKey(random = globalThis.crypto) {
  const bytes = new Uint8Array(12);
  random.getRandomValues(bytes);
  return [...bytes].map((b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'[b & 63]).join('');
}

// '<person id>/<draft key>/<n>-<safe name>' in the draft-sources bucket
export function sourcePath(personId, key, n, name) {
  return `${personId}/${key}/${n}-${safeName(name)}`;
}

// A stored source the server will read: the person's folder must be a uuid
export const SOURCE_PATH = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([A-Za-z0-9_-]{8,64})\/([0-9]{1,2})-([A-Za-z0-9._-]{1,100})$/;

// "12 pages", "1 page"
export const pagesText = (n) => (Number.isInteger(n) && n > 0 ? `${n} ${n === 1 ? 'page' : 'pages'}` : '');
