// The DOM side of a formatted answer (see rich-doc.js for the document):
//   domToDoc(root)  the editor's content, or pasted HTML, as a document
//   docNodes(doc)   a document as elements (built with h(), never parsed)
// Pasted HTML is read with DOMParser, which never runs scripts or loads
// images, and only the text and the formatting below survive.

import { h } from './dom.js';
import { normalizeDoc, DOC_VERSION } from './rich-doc.js';

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'LI', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'MAIN', 'NAV', 'FIGURE', 'FIGCAPTION', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'DL', 'DT', 'DD', 'ADDRESS', 'HR']);
const TAG_MARKS = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', INS: 'u', S: 's', STRIKE: 's', DEL: 's', SUP: 'sup', SUB: 'sub' };

function blockType(tag, inherited) {
  if (tag === 'H1' || tag === 'H2') return 'h2';
  if (/^H[3-6]$/.test(tag)) return 'h3';
  if (tag === 'BLOCKQUOTE') return 'quote';
  return inherited === 'quote' ? 'quote' : 'p';
}

// The marks an element adds (or, through its style, takes away: Google Docs
// pastes everything inside <b style="font-weight:normal">)
function marksFor(el, marks) {
  const next = new Set(marks);
  const tagMark = TAG_MARKS[el.tagName];
  if (tagMark) next.add(tagMark);
  const style = el.style;
  if (style) {
    const weight = style.fontWeight;
    if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) next.add('b');
    else if (weight === 'normal' || weight === 'lighter' || (Number(weight) > 0 && Number(weight) < 600)) next.delete('b');
    if (style.fontStyle === 'italic' || style.fontStyle === 'oblique') next.add('i');
    else if (style.fontStyle === 'normal') next.delete('i');
    const line = `${style.textDecorationLine || ''} ${style.textDecoration || ''}`;
    if (line.includes('underline')) next.add('u');
    if (line.includes('line-through')) next.add('s');
    if (style.verticalAlign === 'super') next.add('sup');
    if (style.verticalAlign === 'sub') next.add('sub');
  }
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
      let x = node.nodeValue ?? '';
      x = pre ? x : x.replace(/[ \t\n\r\f]+/g, ' ');
      x = x.replace(/ /g, ' ');
      if (x) sink.push({ x, m: [...marks], a: href ?? undefined });
      return;
    }
    if (node.nodeType !== 1 || SKIP.has(node.tagName)) return;
    if (node.tagName === 'BR') {
      sink.push({ br: true });
      return;
    }
    const nextMarks = marksFor(node, marks);
    const nextHref = node.tagName === 'A' && node.getAttribute('href') ? node.getAttribute('href') : href;
    for (const child of node.childNodes) inline(child, nextMarks, nextHref, sink, pre || node.tagName === 'PRE');
  }

  // A list: its items, with nested lists folded in as more items
  function list(el, into) {
    for (const child of el.children) {
      if (child.tagName === 'LI') {
        const item = [];
        for (const part of child.childNodes) {
          if (part.nodeType === 1 && (part.tagName === 'UL' || part.tagName === 'OL')) {
            into.items.push(item.splice(0));
            list(part, into);
          } else {
            inline(part, new Set(), null, item, false);
          }
        }
        into.items.push(item);
      } else if (child.tagName === 'UL' || child.tagName === 'OL') {
        list(child, into);
      }
    }
  }

  const hasBlocks = (el) => [...el.children].some((c) => BLOCKS.has(c.tagName) || c.tagName === 'UL' || c.tagName === 'OL'
    || (!SKIP.has(c.tagName) && c.children.length && hasBlocks(c)));

  // marks and href come down from inline wrappers around blocks (Google Docs
  // wraps a whole paste in one <b>)
  function walk(node, inherited, marks = new Set(), href = null) {
    if (node.nodeType === 3) {
      inline(node, marks, href, open(inherited).c, false);
      return;
    }
    if (node.nodeType !== 1 || SKIP.has(node.tagName)) return;
    const tag = node.tagName;
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
        ? h('a', { href: n.a, target: '_blank', rel: 'noopener noreferrer nofollow' }, el)
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
// when there is one, otherwise the plain text as typed (older answers)
export function answerView(sub, { className = null } = {}) {
  const nodes = sub?.body_doc ? docNodes(sub.body_doc) : [];
  if (nodes.length) return h('div', { class: ['doc-view', 'read', className].filter(Boolean).join(' ') }, nodes);
  return h('p', { class: ['read', 'is-pre', className].filter(Boolean).join(' ') }, sub?.body ?? '');
}
