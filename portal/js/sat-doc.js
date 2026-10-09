// SAT content documents as DOM: passages, question stems, choices, study
// guides and explanations. The format extends rich-doc.js ({ v: 1, blocks }):
//
//   Block:  { t: 'p' | 'h3' | 'quote', c: [Inline] } | { t: 'ul' | 'ol', items: [[Inline]] }
//         | { t: 'table', head: boolean, rows: [[ [Inline] ]] }
//         | { t: 'img', src: 'figures/<id>.png', w, h, alt }
//         | { t: 'passage', label: string | null, blocks: [Block] }
//         | { t: 'math', tex }
//   Inline: { x: 'text', m?: ['b' | 'i' | 'u' | 'sup' | 'sub'] } | { br: true }
//         | { tex } | { blank: true }
//
// Everything is built with h() and text nodes, never parsed as HTML, so the
// content can never become markup. Math is left as span.hw-math[data-tex]
// (showing its TeX) and typeset by math.js typesetIn(), whose svg is
// sanitized. A figure's picture comes from figure(src) -> Promise<url> (a
// signed link to the sat-files bucket); its box is sized from w and h before
// it loads, so nothing moves. w and h are the PNG's pixels, drawn at 2x, so
// the figure shows at half that size (never wider than its column).
//
// satDocNodes(doc, { figure }) -> [Node | string]
// satInlineNodes(inlines) -> [Node | string]
// satDoc(doc, { figure, className }) -> div.sat-doc (typeset with typesetSatDoc)
// satDocText(doc) -> plain text (screen reader labels, tests)

import { h } from './dom.js';
import { typesetIn } from './math.js';

const MARK_TAGS = { b: 'strong', i: 'em', u: 'u', sup: 'sup', sub: 'sub' };
const MARK_ORDER = ['b', 'i', 'u', 'sup', 'sub'];
const MAX_DEPTH = 4;

const blocksOf = (doc) => {
  if (Array.isArray(doc)) return doc;
  if (doc && typeof doc === 'object' && Array.isArray(doc.blocks)) return doc.blocks;
  if (typeof doc === 'string' && doc.trim()) return [{ t: 'p', c: [{ x: doc }] }];
  return [];
};

const runs = (c) => (Array.isArray(c) ? c : []);

export function satInlineNodes(inlines) {
  const out = [];
  for (const n of runs(inlines)) {
    if (!n || typeof n !== 'object') continue;
    if (n.br === true) {
      out.push(h('br'));
      continue;
    }
    if (n.blank === true) {
      out.push(h('span', { class: 'sat-blank' }, h('span', { class: 'visually-hidden' }, 'blank')));
      continue;
    }
    if (typeof n.tex === 'string') {
      out.push(h('span', { class: 'hw-math', dataset: { tex: n.tex } }, n.tex));
      continue;
    }
    if (typeof n.x !== 'string' || !n.x) continue;
    const marks = MARK_ORDER.filter((m) => Array.isArray(n.m) && n.m.includes(m));
    let node = n.x;
    for (const mark of [...marks].reverse()) node = h(MARK_TAGS[mark], {}, node);
    out.push(node);
  }
  return out;
}

function figureNode(block, figure) {
  const w = Math.max(1, Math.round(Number(block.w) / 2) || 0);
  const ht = Math.max(1, Math.round(Number(block.h) / 2) || 0);
  const sized = Number(block.w) > 0 && Number(block.h) > 0;
  const img = h('img', {
    class: 'sat-figure-img',
    alt: block.alt || 'Figure',
    width: sized ? String(w) : undefined,
    height: sized ? String(ht) : undefined,
    decoding: 'async',
    draggable: 'false',
  });
  const box = h('figure', { class: 'sat-figure' }, img);
  // A figure that cannot load says what it shows instead
  const missing = () => {
    if (box.classList.contains('is-missing')) return;
    box.classList.add('is-missing');
    box.append(h('figcaption', { class: 'sat-figure-missing' }, `Figure could not load: ${block.alt || 'no description'}`));
  };
  img.addEventListener('error', missing);
  if (typeof figure === 'function' && block.src) {
    Promise.resolve()
      .then(() => figure(block.src))
      .then((url) => {
        if (url) img.setAttribute('src', url);
        else missing();
      })
      .catch(missing);
  } else {
    missing();
  }
  return box;
}

function tableNode(block) {
  const rows = Array.isArray(block.rows) ? block.rows.filter(Array.isArray) : [];
  if (!rows.length) return null;
  const head = block.head ? rows[0] : null;
  const body = block.head ? rows.slice(1) : rows;
  return h('div', { class: 'sat-table-wrap' },
    h('table', { class: 'sat-table' },
      head ? h('thead', {}, h('tr', {}, head.map((cell) => h('th', { scope: 'col' }, satInlineNodes(cell))))) : null,
      h('tbody', {}, body.map((row) => h('tr', {}, row.map((cell) => h('td', {}, satInlineNodes(cell))))))));
}

function blockNode(block, opts, depth) {
  if (!block || typeof block !== 'object') return null;
  switch (block.t) {
    case 'h3': return h('h3', { class: 'sat-h' }, satInlineNodes(block.c));
    case 'quote': return h('blockquote', { class: 'sat-quote' }, satInlineNodes(block.c));
    case 'ul':
    case 'ol':
      return h(block.t, { class: 'sat-list' }, (Array.isArray(block.items) ? block.items : []).map((item) => h('li', {}, satInlineNodes(item))));
    case 'table': return tableNode(block);
    case 'img': return figureNode(block, opts.figure);
    case 'math':
      return typeof block.tex === 'string'
        ? h('div', { class: 'sat-math' }, h('span', { class: 'hw-math is-display', dataset: { tex: block.tex } }, block.tex))
        : null;
    case 'passage':
      if (depth >= MAX_DEPTH) return null;
      return h('section', { class: 'sat-passage', 'aria-label': block.label || 'Passage' },
        block.label ? h('p', { class: 'sat-passage-label' }, block.label) : null,
        satDocNodes(block.blocks, opts, depth + 1));
    default: {
      const content = satInlineNodes(block.c);
      return content.length ? h('p', {}, content) : null;
    }
  }
}

export function satDocNodes(doc, opts = {}, depth = 0) {
  return blocksOf(doc).map((b) => blockNode(b, opts, depth)).filter(Boolean);
}

// A whole document in its wrapper
export function satDoc(doc, { figure = null, className = null } = {}) {
  return h('div', { class: ['sat-doc', className].filter(Boolean).join(' ') }, satDocNodes(doc, { figure }));
}

// Typesets the math under a root (MathJax loads the first time a page shows
// math). Never rejects: a formula MathJax cannot read keeps its TeX.
export async function typesetSatDoc(root) {
  try {
    return await typesetIn(root);
  } catch (error) {
    console.error(error);
    return 0;
  }
}

// Plain text of a document: TeX as written, a blank as "____"
export function satDocText(doc) {
  const inline = (c) => runs(c).map((n) => {
    if (!n || typeof n !== 'object') return '';
    if (n.br) return '\n';
    if (n.blank) return '____';
    if (typeof n.tex === 'string') return n.tex;
    return typeof n.x === 'string' ? n.x : '';
  }).join('');
  const block = (b, depth = 0) => {
    if (!b || typeof b !== 'object') return '';
    if (b.t === 'ul' || b.t === 'ol') return (b.items ?? []).map(inline).join('\n');
    if (b.t === 'table') return (b.rows ?? []).map((row) => (row ?? []).map(inline).join(' | ')).join('\n');
    if (b.t === 'img') return b.alt ? `[${b.alt}]` : '';
    if (b.t === 'math') return b.tex ?? '';
    if (b.t === 'passage') return depth >= MAX_DEPTH ? '' : [b.label, ...blocksOf(b.blocks).map((x) => block(x, depth + 1))].filter(Boolean).join('\n');
    return inline(b.c);
  };
  return blocksOf(doc).map((b) => block(b)).filter(Boolean).join('\n\n');
}
