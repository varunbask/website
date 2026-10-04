// A formatted answer, as a small document the portal checks and draws itself
// (never stored or shown as HTML). No DOM here: rich-doc-dom.js turns the
// editor's DOM into a document and a document back into nodes.
//
//   { v: 1, blocks: [Block] }
//   Block:  { t: 'p' | 'h2' | 'h3' | 'quote', c: [Inline] }
//         | { t: 'ul' | 'ol', items: [[Inline]] }
//   Inline: { x: 'text', m?: [Mark], a?: 'https://...' } | { br: true }
//   Mark:   'b' | 'i' | 'u' | 's' | 'sup' | 'sub'
//
// submissions.body keeps the plain text (docToText), so grading, the length
// limit and the never-blank check work as before; body_doc keeps this.

export const DOC_VERSION = 1;
export const TEXT_BLOCKS = Object.freeze(['p', 'h2', 'h3', 'quote']);
export const LIST_BLOCKS = Object.freeze(['ul', 'ol']);
export const MARKS = Object.freeze(['b', 'i', 'u', 's', 'sup', 'sub']);
export const MAX_BLOCKS = 2000;
export const MAX_LINK_CHARS = 2000;

export const emptyDoc = () => ({ v: DOC_VERSION, blocks: [] });

// Only web and mail links survive; anything else (script or data links) is dropped
export function safeHref(href) {
  const value = String(href ?? '').trim();
  if (!value || value.length > MAX_LINK_CHARS || /\s/.test(value)) return null;
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

// Text without control characters (tabs become spaces; line breaks are {br})
function cleanText(text) {
  return String(text ?? '').replace(/\t/g, ' ').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
}

const sameMarks = (a, b) => (a.m ?? []).join() === (b.m ?? []).join() && (a.a ?? null) === (b.a ?? null);

// One run of inlines, checked: unknown marks and unsafe links go, marks come
// in a fixed order, sup and sub never together, neighbours that look the
// same are joined, and empty text runs are dropped
export function normalizeInlines(raw) {
  const out = [];
  for (const node of Array.isArray(raw) ? raw : []) {
    if (!node || typeof node !== 'object') continue;
    if (node.br === true) {
      out.push({ br: true });
      continue;
    }
    const x = cleanText(node.x).replace(/[\r\n]+/g, ' ');
    if (!x) continue;
    let m = MARKS.filter((mark) => Array.isArray(node.m) && node.m.includes(mark));
    if (m.includes('sup') && m.includes('sub')) m = m.filter((mark) => mark !== 'sub');
    const a = node.a ? safeHref(node.a) : null;
    const inline = { x };
    if (m.length) inline.m = m;
    if (a) inline.a = a;
    const last = out[out.length - 1];
    if (last && !last.br && sameMarks(last, inline)) last.x += x;
    else out.push(inline);
  }
  // A break at the very end of a block shows nothing
  while (out.length && out[out.length - 1].br) out.pop();
  return out;
}

const hasText = (inlines) => inlines.some((n) => !n.br && n.x.trim());

// A document from anything (a draft, a saved answer, the editor): a clean
// copy, or an empty document. Empty paragraphs are kept as spacing, but never
// two in a row, and none at the start or end.
export function normalizeDoc(raw) {
  const blocks = [];
  const source = raw && typeof raw === 'object' && Array.isArray(raw.blocks) ? raw.blocks : [];
  for (const block of source) {
    if (blocks.length >= MAX_BLOCKS) break;
    if (!block || typeof block !== 'object') continue;
    if (LIST_BLOCKS.includes(block.t)) {
      const items = (Array.isArray(block.items) ? block.items : []).map(normalizeInlines).filter(hasText);
      if (items.length) blocks.push({ t: block.t, items });
      continue;
    }
    const t = TEXT_BLOCKS.includes(block.t) ? block.t : 'p';
    const c = normalizeInlines(block.c);
    if (!hasText(c)) {
      const prev = blocks[blocks.length - 1];
      if (blocks.length && !(prev.t === 'p' && !prev.c.length)) blocks.push({ t: 'p', c: [] });
      continue;
    }
    blocks.push({ t, c });
  }
  while (blocks.length && blocks[blocks.length - 1].t === 'p' && !blocks[blocks.length - 1].c.length) blocks.pop();
  return { v: DOC_VERSION, blocks };
}

export const isEmptyDoc = (doc) => !normalizeDoc(doc).blocks.length;

// ---------------------------------------------------------------------------
// Plain text: what the grader reads and the 20,000 character limit counts.
// Headings and quotes keep a marker, list items their bullet or number, and
// x² is written x^2 (H₂O as H_2O) so the math still reads.

function inlineText(inlines) {
  return inlines.map((n) => {
    if (n.br) return '\n';
    const marks = n.m ?? [];
    const wrap = (sign) => (n.x.length > 1 ? `${sign}(${n.x})` : `${sign}${n.x}`);
    if (marks.includes('sup')) return wrap('^');
    if (marks.includes('sub')) return wrap('_');
    return n.x;
  }).join('');
}

export function docToText(raw) {
  const doc = normalizeDoc(raw);
  const parts = doc.blocks.map((block) => {
    if (block.t === 'ul') return block.items.map((item) => `- ${inlineText(item)}`).join('\n');
    if (block.t === 'ol') return block.items.map((item, i) => `${i + 1}. ${inlineText(item)}`).join('\n');
    const text = inlineText(block.c);
    if (block.t === 'h2') return `## ${text}`;
    if (block.t === 'h3') return `### ${text}`;
    if (block.t === 'quote') return text.split('\n').map((line) => `> ${line}`).join('\n');
    return text;
  });
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Words, for the editor's count: what a reader would count, so list numbers
// and heading markers are left out
export function wordCount(raw) {
  const doc = normalizeDoc(raw);
  const texts = [];
  for (const block of doc.blocks) {
    if (block.items) for (const item of block.items) texts.push(item.map((n) => (n.br ? ' ' : n.x)).join(''));
    else texts.push(block.c.map((n) => (n.br ? ' ' : n.x)).join(''));
  }
  return texts.join(' ').split(/\s+/).filter(Boolean).length;
}

// A plain answer (an old submission, or pasted text) as a document: blank
// lines start paragraphs, single line breaks stay breaks
export function textToDoc(text) {
  const paragraphs = cleanText(text).replace(/\r\n?/g, '\n').split(/\n{2,}/);
  return normalizeDoc({
    v: DOC_VERSION,
    blocks: paragraphs.map((p) => ({
      t: 'p',
      c: p.split('\n').flatMap((line, i) => (i ? [{ br: true }, { x: line }] : [{ x: line }])),
    })),
  });
}

// ---------------------------------------------------------------------------
// HTML, only for pasting into the editor (document.execCommand('insertHTML')),
// built from a checked document with every piece of text escaped

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

const MARK_TAGS = { b: 'strong', i: 'em', u: 'u', s: 's', sup: 'sup', sub: 'sub' };
const BLOCK_TAGS = { p: 'p', h2: 'h2', h3: 'h3', quote: 'blockquote', ul: 'ul', ol: 'ol' };

function inlineHtml(inlines) {
  return inlines.map((n) => {
    if (n.br) return '<br>';
    let html = escapeHtml(n.x);
    for (const mark of [...(n.m ?? [])].reverse()) html = `<${MARK_TAGS[mark]}>${html}</${MARK_TAGS[mark]}>`;
    return n.a ? `<a href="${escapeHtml(n.a)}">${html}</a>` : html;
  }).join('');
}

export function docToHtml(raw) {
  return normalizeDoc(raw).blocks.map((block) => {
    const tag = BLOCK_TAGS[block.t];
    if (block.items) return `<${tag}>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</${tag}>`;
    return `<${tag}>${block.c.length ? inlineHtml(block.c) : '<br>'}</${tag}>`;
  }).join('');
}
