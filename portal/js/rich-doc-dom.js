// The DOM side of a formatted answer (see rich-doc.js for the document):
//   domToDoc(root)  the editor's content, or pasted HTML, as a document
//   docNodes(doc)   a document as elements (built with h(), never parsed)
// Pasted HTML is read with DOMParser, which never runs scripts or loads
// images, and only the text and the formatting below survive.

import { h } from './dom.js';
import { normalizeDoc, docToText, DOC_VERSION } from './rich-doc.js';

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'LI', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'MAIN', 'NAV', 'FIGURE', 'FIGCAPTION', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'DL', 'DT', 'DD', 'ADDRESS', 'HR']);
const TAG_MARKS = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', INS: 'u', S: 's', STRIKE: 's', DEL: 's', SUP: 'sup', SUB: 'sub' };

function blockType(tag, inherited) {
  if (tag === 'H1' || tag === 'H2') return 'h2';
  if (/^H[3-6]$/.test(tag)) return 'h3';
  if (tag === 'BLOCKQUOTE') return 'quote';
  return inherited === 'quote' ? 'quote' : 'p';
}

// An element's name in capitals, also for SVG and MathML (whose tagName keeps
// its case)
const nameOf = (el) => String(el.localName || el.tagName || '').toUpperCase();

// The style attribute as { property: value }, read from the attribute itself:
// under the portal's CSP a parsed document ignores style attributes, so
// el.style is always empty
function styleOf(el) {
  const out = {};
  for (const part of String(el.getAttribute?.('style') ?? '').split(';')) {
    const at = part.indexOf(':');
    if (at < 1) continue;
    out[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim().toLowerCase();
  }
  return out;
}

// The marks an element adds (or, through its style, takes away: Google Docs
// pastes everything inside <b style="font-weight:normal">)
function marksFor(el, marks) {
  const next = new Set(marks);
  const tagMark = TAG_MARKS[nameOf(el)];
  if (tagMark) next.add(tagMark);
  const style = styleOf(el);
  const weight = style['font-weight'];
  if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) next.add('b');
  else if (weight === 'normal' || weight === 'lighter' || (Number(weight) > 0 && Number(weight) < 600)) next.delete('b');
  const fontStyle = style['font-style'];
  if (fontStyle === 'italic' || fontStyle === 'oblique') next.add('i');
  else if (fontStyle === 'normal') next.delete('i');
  const line = `${style['text-decoration-line'] ?? ''} ${style['text-decoration'] ?? ''}`;
  if (line.includes('underline')) next.add('u');
  if (line.includes('line-through')) next.add('s');
  if (style['vertical-align'] === 'super') next.add('sup');
  if (style['vertical-align'] === 'sub') next.add('sub');
  return next;
}

export function domToDoc(root) {
  const blocks = [];
  let current = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };
  const open = (t) => {
    if (!current) current = { t, c: [] };
    return current;
  };

  // Inline content into `sink` (an array of inlines)
  function inline(node, marks, href, sink, pre) {
    if (node.nodeType === 3) {
      const raw = String(node.nodeValue ?? '').replace(/\u00a0/g, ' ');
      const parts = pre ? raw.replace(/\r\n?/g, '\n').split('\n') : [raw.replace(/[ \t\n\r\f]+/g, ' ')];
      parts.forEach((x, i) => {
        if (i) sink.push({ br: true });
        if (x) sink.push({ x, m: [...marks], a: href ?? undefined });
      });
      return;
    }
    if (node.nodeType !== 1 || SKIP.has(nameOf(node))) return;
    if (nameOf(node) === 'BR') {
      sink.push({ br: true });
      return;
    }
    const nextMarks = marksFor(node, marks);
    const nextHref = nameOf(node) === 'A' && node.getAttribute('href') ? node.getAttribute('href') : href;
    for (const child of node.childNodes) inline(child, nextMarks, nextHref, sink, pre || nameOf(node) === 'PRE');
  }

  // A list: its items, with nested lists folded in as more items
  function list(el, into) {
    for (const child of el.children) {
      const name = nameOf(child);
      if (name === 'LI') {
        const item = [];
        for (const part of child.childNodes) {
          const partName = part.nodeType === 1 ? nameOf(part) : '';
          if (partName === 'UL' || partName === 'OL') {
            into.items.push(item.splice(0));
            list(part, into);
          } else {
            // Two paragraphs in one item stay apart
            if (BLOCKS.has(partName) && item.some((n) => !n.br)) item.push({ br: true });
            inline(part, new Set(), null, item, false);
          }
        }
        into.items.push(item);
      } else if (name === 'UL' || name === 'OL') {
        list(child, into);
      }
    }
  }

  const hasBlocks = (el) => [...el.children].some((c) => {
    const name = nameOf(c);
    return BLOCKS.has(name) || name === 'UL' || name === 'OL' || (!SKIP.has(name) && c.children.length && hasBlocks(c));
  });

  // marks and href come down from inline wrappers around blocks (Google Docs
  // wraps a whole paste in one <b>)
  function walk(node, inherited, marks = new Set(), href = null) {
    if (node.nodeType === 3) {
      inline(node, marks, href, open(inherited).c, false);
      return;
    }
    if (node.nodeType !== 1 || SKIP.has(nameOf(node))) return;
    const tag = nameOf(node);
    if (tag === 'UL' || tag === 'OL') {
      flush();
      const into = { t: tag === 'OL' ? 'ol' : 'ul', items: [] };
      list(node, into);
      blocks.push(into);
      return;
    }
    if (BLOCKS.has(tag)) {
      flush();
      const t = blockType(tag, inherited);
      const nextMarks = marksFor(node, marks);
      if (hasBlocks(node)) {
        for (const child of node.childNodes) walk(child, t, nextMarks, href);
      } else {
        const block = open(t);
        for (const child of node.childNodes) inline(child, nextMarks, href, block.c, tag === 'PRE');
      }
      flush();
      return;
    }
    const nextMarks = marksFor(node, marks);
    const nextHref = tag === 'A' && node.getAttribute('href') ? node.getAttribute('href') : href;
    // An inline wrapper around blocks: its children are walked as blocks
    if (hasBlocks(node)) {
      for (const child of node.childNodes) walk(child, inherited, nextMarks, nextHref);
      return;
    }
    // Inline at the top level: it joins the current paragraph
    inline(node, marks, href, open(inherited).c, false);
  }

  for (const child of root.childNodes) walk(child, 'p');
  flush();

  // Spaces at the start and end of a block are not part of the answer
  for (const block of blocks) {
    for (const runs of block.items ?? [block.c]) {
      const first = runs.find((n) => !n.br);
      const last = [...runs].reverse().find((n) => !n.br);
      if (first) first.x = first.x.replace(/^ +/, '');
      if (last) last.x = last.x.replace(/ +$/, '');
    }
  }
  return normalizeDoc({ v: DOC_VERSION, blocks });
}

// Pasted HTML as a document (DOMParser makes an inert document)
export function htmlToDoc(html) {
  const parsed = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
  return domToDoc(parsed.body);
}

const MARK_TAGS = { b: 'strong', i: 'em', u: 'u', s: 's', sup: 'sup', sub: 'sub' };
const BLOCK_TAGS = { p: 'p', h2: 'h2', h3: 'h3', quote: 'blockquote' };

function inlineNodes(inlines, { links }) {
  return inlines.map((n) => {
    if (n.br) return h('br');
    let el = document.createTextNode(n.x);
    for (const mark of [...(n.m ?? [])].reverse()) el = h(MARK_TAGS[mark], {}, el);
    if (n.a) {
      el = links === 'open'
        ? h('a', { href: n.a, title: n.a, target: '_blank', rel: 'noopener noreferrer nofollow' }, el)
        : h('a', { href: n.a }, el);
    }
    return el;
  });
}

// links: 'open' (a shown answer: they open in a new tab) or 'edit' (in the
// editor, where a click only places the caret)
export function docNodes(raw, { links = 'open' } = {}) {
  return normalizeDoc(raw).blocks.map((block) => {
    if (block.items) return h(block.t, {}, block.items.map((item) => h('li', {}, inlineNodes(item, { links }))));
    return h(BLOCK_TAGS[block.t], {}, block.c.length ? inlineNodes(block.c, { links }) : h('br'));
  });
}

// A submitted answer as shown to tutors and families: the formatted document
// when there is one, otherwise the plain text as typed (older answers). The
// document is shown only when its text is the text that was graded, so a
// tutor always sees what the grader read.
export function answerView(sub, { className = null } = {}) {
  const matches = sub?.body_doc && docToText(sub.body_doc).trim() === String(sub.body ?? '').trim();
  const nodes = matches ? docNodes(sub.body_doc) : [];
  if (nodes.length) return h('div', { class: ['doc-view', 'read', className].filter(Boolean).join(' ') }, nodes);
  return h('p', { class: ['read', 'is-pre', className].filter(Boolean).join(' ') }, sub?.body ?? '');
}
