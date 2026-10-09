// LaTeX from the SAT books -> SAT docs ({ v: 1, blocks }, the format in the
// SAT spec). It reads the subset of LaTeX the books use for questions and
// answer keys: paragraphs, marks, inline and display math, passages and data
// boxes, tables, lists, blanks and TikZ figures. Anything it does not know is
// counted (never silently dropped) so the report can list it.
//
// toDoc(tex, ctx) -> { v: 1, blocks }
//   ctx.figure(tikzSource, img) -> boolean            (fills img.src; w and h may come later)
//   ctx.unknown: Map name -> count                     (filled in)
//   ctx.difficulty(value)                              (\diff{...} seen)
//   ctx.dashes: 'all' | 'passages'                     (where --- becomes an em dash)
//
// docText(doc) -> plain text (for search, checks and alt text)

import { readGroup, readArg, readOptional, findEnvEnd, splitItems, splitTopLevel, skipSpaces } from './tex.mjs';

export const DOC_VERSION = 1;
const MARK_ORDER = ['b', 'i', 'u', 'sup', 'sub'];

// Text-mode symbols
const SYMBOLS = {
  ldots: '…', dots: '…', textellipsis: '…', checkmark: '✓', textbar: '|',
  textasciitilde: '~', textasciicircum: '^', textbackslash: '\\', S: '§', P: '¶',
  copyright: '©', textdegree: '°', degree: '°', textendash: '–', textemdash: '—',
  textquoteleft: '‘', textquoteright: '’', textquotedblleft: '“', textquotedblright: '”',
  pounds: '£', euro: '€', textregistered: '®', texttrademark: '™', dag: '†',
  textbullet: '•', textperiodcentered: '·', i: 'ı', ss: 'ß', ae: 'æ', o: 'ø',
  O: 'Ø', AE: 'Æ', l: 'ł', L: 'Ł', aa: 'å', AA: 'Å', oe: 'œ', OE: 'Œ',
  quad: ' ', qquad: ' ', enspace: ' ', enskip: ' ', thinspace: ' ', space: ' ', textvisiblespace: '␣',
  textless: '<', textgreater: '>', textunderscore: '_', textdollar: '$', textpercent: '%',
};

// Escaped single characters in text mode
const ESCAPES = { '\n': ' ', '\t': ' ', '$': '$', '%': '%', '&': '&', '#': '#', _: '_', '{': '{', '}': '}', ' ': ' ', ',': ' ', ';': ' ', ':': ' ', '!': '', '/': '', '-': '', '@': '', '>': ' ' };

// Accents: \'e, \'{e}, \"o, \c{c} ... -> combining marks
const ACCENTS = { "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇', u: '̆', v: '̌', H: '̋', c: '̧', k: '̨', r: '̊', d: '̣', b: '̱' };

// Macros with no visible output and no arguments
const DROP0 = new Set(['noindent', 'indent', 'centering', 'raggedright', 'raggedleft', 'smallskip', 'medskip', 'bigskip',
  'nopagebreak', 'pagebreak', 'newpage', 'clearpage', 'small', 'footnotesize', 'scriptsize', 'tiny', 'normalsize',
  'large', 'Large', 'LARGE', 'huge', 'Huge', 'boldmath', 'unboldmath', 'hfill', 'vfill', 'protect', 'relax',
  'sffamily', 'rmfamily', 'ttfamily', 'upshape', 'normalfont', 'mdseries', 'allowbreak', 'break', 'nobreak', 'null',
  'strut', 'leavevmode', 'ignorespaces', 'selectfont', 'displaystyle', 'textstyle', 'hline', 'toprule', 'midrule',
  'bottomrule', 'par@', 'maketitle', 'tableofcontents', 'satflushlabel', 'columnbreak', 'filbreak', 'goodbreak']);
// ... and with one braced argument
const DROP1 = new Set(['needspace', 'vspace', 'label', 'color', 'phantom', 'hphantom', 'vphantom', 'pagestyle',
  'thispagestyle', 'index', 'enlargethispage', 'linespread', 'fontsize@', 'cmidrule', 'cline', 'addvspace', 'nolinkurl@']);
// ... and with two
const DROP2 = new Set(['setlength', 'addtolength', 'setcounter', 'addtocounter', 'fontsize']);
// Wrappers whose last argument is the visible text
const WRAP = { textnormal: 0, textrm: 0, textsf: 0, textup: 0, mbox: 0, text: 0, hbox: 0, textmd: 0, textsc: 0,
  textcolor: 1, colorbox: 1, fbox: 0, framebox: 0, makebox: 0, raisebox: 1, parbox: 1, href: 1, url: 0, ensuremath: 0,
  texorpdfstring: 0, hyperref: 0, mathrm: 0, nolinkurl: 0 };
const MARK_MACROS = { textbf: 'b', emph: 'i', textit: 'i', textsl: 'i', underline: 'u', uline: 'u', textsuperscript: 'sup', textsubscript: 'sub' };
const MARK_DECLS = { bfseries: 'b', itshape: 'i', em: 'i', slshape: 'i' };

// Display math environments -> how to wrap their body for MathJax
const DISPLAY_ENVS = { 'align*': 'aligned', align: 'aligned', 'gather*': 'gathered', gather: 'gathered',
  'equation*': null, equation: null, 'multline*': 'gathered', multline: 'gathered', 'flalign*': 'aligned', displaymath: null };
// Environments that only lay their content out (their content is kept as is)
const TRANSPARENT = new Set(['center', 'flushleft', 'flushright', 'minipage', 'figure', 'figure*', 'varwidth', 'samepage', 'small', 'footnotesize', 'multicols', 'table', 'adjustbox']);

// Plain text of an inline run list or a doc
export function inlineText(c) {
  return (c ?? []).map((n) => (n.br ? '\n' : n.blank ? '____' : n.tex !== undefined ? n.tex : n.x ?? '')).join('');
}
export function docText(doc) {
  const out = [];
  const walk = (blocks) => {
    for (const b of blocks ?? []) {
      if (b.c) out.push(inlineText(b.c));
      else if (b.items) for (const it of b.items) out.push(inlineText(it));
      else if (b.rows) for (const row of b.rows) out.push(row.map(inlineText).join(' | '));
      else if (b.t === 'math') out.push(b.tex);
      else if (b.t === 'img') out.push(`[${b.alt}]`);
      else if (b.t === 'passage') {
        if (b.label) out.push(b.label);
        walk(b.blocks);
      }
    }
  };
  walk(doc?.blocks ?? doc);
  return out.join('\n');
}

// TeX for MathJax: one line, the books' own math macros spelled out
export function cleanMath(tex) {
  return tex
    .replace(/\\degree(?![a-zA-Z])/g, '^{\\circ}')
    .replace(/\\dd(?![a-zA-Z])/g, '\\,\\mathrm{d}')
    .replace(/\\Re(?![a-zA-Z])/g, '\\mathbb{R}')
    .replace(/\\boldmath(?![a-zA-Z])/g, '')
    .replace(/\\(?:small|footnotesize|scriptsize|tiny|normalsize)(?![a-zA-Z])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Inline runs: marks in a fixed order, neighbours with the same marks joined,
// runs of spaces collapsed and the ends trimmed
export function tidyInlines(raw, { trim = true } = {}) {
  const out = [];
  for (const node of raw) {
    if (node.text !== undefined) {
      const m = MARK_ORDER.filter((k) => node.m?.includes(k));
      const last = out[out.length - 1];
      if (last && last.x !== undefined && (last.m ?? []).join() === m.join()) last.x += node.text;
      else out.push(m.length ? { x: node.text, m } : { x: node.text });
    } else out.push(node);
  }
  // collapse whitespace inside and across runs (a break or math keeps its own spacing)
  let prevSpace = true;
  for (const node of out) {
    if (node.x !== undefined) {
      let x = node.x.replace(/[ \t\r\n]+/g, ' ');
      if (prevSpace) x = x.replace(/^ /, '');
      node.x = x;
      if (x) prevSpace = x.endsWith(' ');
    } else prevSpace = Boolean(node.br);
  }
  let result = out.filter((n) => n.x === undefined || n.x !== '');
  if (trim) {
    while (result.length && result[0].br) result.shift();
    while (result.length && result[result.length - 1].br) result.pop();
    const first = result[0];
    if (first?.x !== undefined) first.x = first.x.replace(/^\s+/, '');
    const last = result[result.length - 1];
    if (last?.x !== undefined) last.x = last.x.replace(/\s+$/, '');
    result = result.filter((n) => n.x === undefined || n.x !== '');
  }
  return result;
}

// Blocks -> raw inline nodes ({ text, m } for text) for tidyInlines: list
// items and table cells hold inlines only, so blocks become line breaks
function flattenBlocks(blocks) {
  const out = [];
  const add = (c) => {
    for (const n of c) out.push(n.x !== undefined ? { text: n.x, m: n.m ?? [] } : n);
  };
  for (const b of blocks) {
    if (out.length) out.push({ br: true });
    if (b.c) add(b.c);
    else if (b.items) b.items.forEach((it, k) => { if (k) out.push({ br: true }); add(it); });
    else if (b.t === 'math') out.push({ tex: b.tex });
    else if (b.t === 'passage') out.push(...flattenBlocks(b.blocks));
    else if (b.rows) b.rows.forEach((row, k) => { if (k) out.push({ br: true }); row.forEach((cell, j) => { if (j) out.push({ text: '  ', m: [] }); add(cell); }); });
  }
  return out;
}

// Bookkeeping kept off the JSON: a property JSON.stringify skips
export function hidden(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: false, writable: true, configurable: true });
  return obj;
}
const captioned = new WeakSet();

class Builder {
  constructor() {
    this.blocks = [];
    this.para = [];
  }
  inline(node) {
    this.para.push(node);
  }
  flush() {
    const c = tidyInlines(this.para);
    this.para = [];
    if (c.length) this.blocks.push({ t: 'p', c });
  }
  block(b) {
    this.flush();
    this.blocks.push(b);
  }
}

// A blank is an underline over nothing but space, or a thin \rule
function isBlankUnderline(content) {
  return /^\s*(\\(hphantom|phantom|hspace\*?|kern|quad|qquad)\s*(\{[^}]*\})?|~|\\ |\s)*\s*$/.test(content);
}
function ruleIsBlank(height) {
  const m = /^\s*([\d.]+)\s*(pt|ex|em|mm|bp)?\s*$/.exec(height ?? '');
  if (!m) return false;
  const v = Number(m[1]);
  const pt = m[2] === 'ex' ? v * 4.3 : m[2] === 'em' ? v * 10 : m[2] === 'mm' ? v * 2.85 : v;
  return pt <= 1.5;
}

export class LatexConverter {
  constructor(ctx = {}) {
    this.ctx = ctx;
    this.unknown = ctx.unknown ?? new Map();
    this.dashes = ctx.dashes ?? 'all';
    this.lastImg = null;
  }

  note(name) {
    this.unknown.set(name, (this.unknown.get(name) ?? 0) + 1);
  }

  // LaTeX -> blocks
  blocks(tex, { passage = false } = {}) {
    const b = new Builder();
    this.walk(tex, b, [], passage);
    b.flush();
    return b.blocks;
  }

  // LaTeX -> inline runs (any block structure becomes line breaks)
  inlines(tex, marks = [], passage = false) {
    const b = new Builder();
    this.walk(tex, b, [...marks], passage);
    b.flush();
    return tidyInlines(flattenBlocks(b.blocks));
  }

  text(raw, b, marks, passage) {
    let t = raw;
    if (this.dashes === 'all' || passage) t = t.replace(/---/g, '—').replace(/--/g, '–');
    t = t.replace(/``/g, '“').replace(/''/g, '”').replace(/`/g, '‘').replace(/'/g, '’')
      .replace(/~/g, ' ');
    // a blank line ends the paragraph
    const parts = t.split(/\n[ \t]*\n\s*/);
    parts.forEach((part, k) => {
      if (k) b.flush();
      if (part) b.inline({ text: part, m: marks });
    });
  }

  walk(s, b, marks, passage) {
    let i = 0;
    let buf = '';
    const flushText = () => {
      if (buf) this.text(buf, b, marks, passage);
      buf = '';
    };
    while (i < s.length) {
      const ch = s[i];
      if (ch === '\\') {
        flushText();
        i = this.macro(s, i, b, marks, passage);
        continue;
      }
      if (ch === '$') {
        flushText();
        if (s[i + 1] === '$') {
          const close = s.indexOf('$$', i + 2);
          const end = close === -1 ? s.length : close;
          b.block({ t: 'math', tex: cleanMath(s.slice(i + 2, end)) });
          i = end + 2;
          continue;
        }
        let j = i + 1;
        for (; j < s.length; j++) {
          if (s[j] === '\\') { j++; continue; }
          if (s[j] === '$') break;
        }
        const tex = cleanMath(s.slice(i + 1, j));
        if (tex) b.inline({ tex });
        i = j + 1;
        continue;
      }
      if (ch === '{') {
        flushText();
        const g = readGroup(s, i);
        this.walk(g.content, b, [...marks], passage);
        i = g.end;
        continue;
      }
      if (ch === '}') {
        i++;
        continue;
      }
      buf += ch;
      i++;
    }
    flushText();
  }

  // One control sequence at s[i] === '\\'; returns the index after it
  macro(s, i, b, marks, passage) {
    const next = s[i + 1];
    if (next === undefined) return i + 1;
    if (!/[a-zA-Z]/.test(next)) {
      if (next === '\\') {
        // a line break, with an optional * and [length]
        let j = i + 2;
        if (s[j] === '*') j++;
        const opt = readOptional(s, j);
        if (opt && /^\s*-?[\d.]+\s*[a-z]{2}\s*$/.test(opt.content)) j = opt.end;
        b.inline({ br: true });
        return j;
      }
      if (next === '[') return this.display(s, i + 2, '\\]', b);
      if (next === '(') {
        const close = s.indexOf('\\)', i + 2);
        const end = close === -1 ? s.length : close;
        b.inline({ tex: cleanMath(s.slice(i + 2, end)) });
        return end + 2;
      }
      if (ACCENTS[next]) {
        const arg = readArg(s, i + 2);
        if (arg && ACCENTS[next]) {
          const base = arg.content.replace(/^\\i$/, 'i');
          b.inline({ text: (base + ACCENTS[next]).normalize('NFC'), m: marks });
          return arg.end;
        }
      }
      if (next in ESCAPES) {
        b.inline({ text: ESCAPES[next], m: marks });
        return i + 2;
      }
      this.note(`\\${next}`);
      return i + 2;
    }
    const m = /^[a-zA-Z@]+\*?/.exec(s.slice(i + 1));
    let name = m[0];
    let j = i + 1 + name.length;
    const star = name.endsWith('*');
    if (star) name = name.slice(0, -1);
    // TeX skips the spaces after a control word
    const afterWord = () => skipSpaces(s, j);

    if (name.length === 1 && ACCENTS[name] && !star) {
      const arg = readArg(s, j);
      if (arg) {
        b.inline({ text: (arg.content.replace(/^\\i$/, 'i') + ACCENTS[name]).normalize('NFC'), m: marks });
        return arg.end;
      }
    }
    if (name === 'begin') {
      const g = readGroup(s, skipSpaces(s, j));
      if (!g) return j;
      return this.environment(s, g.content.trim(), g.end, b, marks, passage);
    }
    if (name === 'end') {
      const g = readGroup(s, skipSpaces(s, j));
      this.note(`\\end{${g?.content}} without \\begin`);
      return g ? g.end : j;
    }
    if (name === 'par') {
      b.flush();
      return afterWord();
    }
    if (name === 'newline' || name === 'linebreak') {
      b.inline({ br: true });
      return afterWord();
    }
    if (name === 'item') {
      b.flush();
      const opt = readOptional(s, j);
      if (opt) {
        b.inline({ text: `${this.inlinesText(opt.content)} `, m: marks });
        return opt.end;
      }
      return afterWord();
    }
    if (SYMBOLS[name] !== undefined) {
      b.inline({ text: SYMBOLS[name], m: marks });
      // \ldots{} and \ldots\ keep their space; a bare control word eats it
      if (s[j] === '{' && s[j + 1] === '}') return j + 2;
      return afterWord();
    }
    if (name === 'char') {
      const c = /^`\\?(.)|^"([0-9A-Fa-f]+)|^'([0-7]+)|^(\d+)/.exec(s.slice(j));
      if (c) {
        const text = c[1] ?? String.fromCodePoint(c[2] ? parseInt(c[2], 16) : c[3] ? parseInt(c[3], 8) : Number(c[4]));
        b.inline({ text, m: marks });
        return j + c[0].length;
      }
      this.note('\\char');
      return j;
    }
    if (DROP0.has(name)) return afterWord();
    if (DROP1.has(name)) {
      const opt = readOptional(s, j);
      const arg = readArg(s, opt ? opt.end : j);
      // the cmidrule's (lr) trim spec
      return arg ? arg.end : j;
    }
    if (DROP2.has(name)) {
      const a = readArg(s, j);
      const c = a && readArg(s, a.end);
      return c ? c.end : j;
    }
    if (name === 'hspace') {
      const arg = readArg(s, j);
      b.inline({ text: ' ', m: marks });
      return arg ? arg.end : j;
    }
    if (name === 'rule') {
      const opt = readOptional(s, j);
      const w = readArg(s, opt ? opt.end : j);
      const h = w && readArg(s, w.end);
      if (h && ruleIsBlank(h.content)) b.inline({ blank: true });
      else this.note('\\rule (not a blank)');
      return h ? h.end : j;
    }
    if (name === 'diff') {
      const arg = readArg(s, j);
      if (arg) this.ctx.difficulty?.(arg.content.trim());
      return arg ? arg.end : j;
    }
    if (MARK_MACROS[name]) {
      const arg = readArg(s, j);
      if (!arg) return j;
      if (MARK_MACROS[name] === 'u' && isBlankUnderline(arg.content)) {
        b.inline({ blank: true });
        return arg.end;
      }
      this.walk(arg.content, b, [...marks, MARK_MACROS[name]], passage);
      return arg.end;
    }
    if (MARK_DECLS[name]) {
      marks.push(MARK_DECLS[name]);
      return afterWord();
    }
    if (name === 'texttt') {
      const arg = readArg(s, j);
      if (!arg) return j;
      this.walk(arg.content, b, marks, passage);
      return arg.end;
    }
    if (WRAP[name] !== undefined) {
      let at = j;
      for (let k = 0; k < WRAP[name]; k++) {
        const opt = readOptional(s, at);
        if (opt) at = opt.end;
        const skip = readArg(s, at);
        if (!skip) return at;
        at = skip.end;
      }
      while (readOptional(s, at)) at = readOptional(s, at).end;
      const arg = readArg(s, at);
      if (!arg) return at;
      this.walk(arg.content, b, marks, passage);
      return arg.end;
    }
    if (name === 'figcaption') {
      const arg = readArg(s, j);
      if (!arg) return j;
      const c = this.inlines(arg.content, ['i'], passage);
      if (this.lastImg && !captioned.has(this.lastImg)) {
        this.lastImg.alt = inlineText(c).trim() || this.lastImg.alt;
        captioned.add(this.lastImg);
      }
      b.block(hidden({ t: 'p', c }, 'caption', true));
      return arg.end;
    }
    if (name === 'solution') {
      b.flush();
      b.inline({ text: 'Solution. ', m: [...marks, 'b'] });
      return afterWord();
    }
    if (name === 'solpart') {
      const arg = readArg(s, j);
      b.flush();
      if (arg) b.inline({ text: `(${arg.content}) `, m: [...marks, 'b'] });
      return arg ? arg.end : j;
    }
    if (name === 'footnote') {
      const arg = readArg(s, j);
      this.note('\\footnote');
      if (arg) {
        b.inline({ text: ' (', m: marks });
        this.walk(arg.content, b, marks, passage);
        b.inline({ text: ')', m: marks });
      }
      return arg ? arg.end : j;
    }
    if (name === 'includegraphics') {
      const opt = readOptional(s, j);
      const arg = readArg(s, opt ? opt.end : j);
      this.note('\\includegraphics');
      return arg ? arg.end : j;
    }
    if (name === 'tfrac' || name === 'dfrac' || name === 'frac' || name === 'sqrt') {
      // math macros used outside $...$ (a slip in the source): keep them as math
      const a = readArg(s, j);
      const c = name === 'sqrt' ? null : a && readArg(s, a.end);
      const end = (c ?? a)?.end ?? j;
      b.inline({ tex: cleanMath(s.slice(i, end)) });
      this.note(`\\${name} outside math`);
      return end;
    }
    // Unknown: count it, keep the text of its braced arguments
    this.note(`\\${name}`);
    let at = j;
    for (;;) {
      const opt = readOptional(s, at);
      if (opt) {
        at = opt.end;
        continue;
      }
      const k = skipSpaces(s, at);
      if (s[k] !== '{') break;
      const g = readGroup(s, k);
      this.walk(g.content, b, marks, passage);
      at = g.end;
    }
    return at === j ? afterWord() : at;
  }

  inlinesText(tex) {
    return inlineText(this.inlines(tex));
  }

  display(s, start, close, b) {
    const end = s.indexOf(close, start);
    const stop = end === -1 ? s.length : end;
    const tex = cleanMath(s.slice(start, stop));
    if (tex) b.block({ t: 'math', tex });
    return stop + close.length;
  }

  environment(s, name, bodyStart, b, marks, passage) {
    const bodyEnd = findEnvEnd(s, bodyStart, name);
    const stop = bodyEnd === -1 ? s.length : bodyEnd;
    const after = bodyEnd === -1 ? s.length : bodyEnd + `\\end{${name}}`.length;
    let body = s.slice(bodyStart, stop);

    if (name === 'passage' || name === 'databox') {
      const opt = readOptional(body, 0);
      let label = null;
      if (opt) {
        label = this.inlinesText(opt.content).trim() || null;
        body = body.slice(opt.end);
      }
      const blocks = this.blocks(body, { passage: true });
      b.block({ t: 'passage', label, blocks });
      return after;
    }
    if (TRANSPARENT.has(name)) {
      if (name === 'minipage' || name === 'varwidth') {
        let at = 0;
        while (readOptional(body, at)) at = readOptional(body, at).end;
        const w = readArg(body, at);
        body = w ? body.slice(w.end) : body;
      } else if (name === 'figure' || name === 'figure*' || name === 'table') {
        const opt = readOptional(body, 0);
        if (opt) body = body.slice(opt.end);
      } else if (name === 'multicols') {
        const w = readArg(body, 0);
        body = w ? body.slice(w.end) : body;
      }
      b.flush();
      this.walk(body, b, [...marks], passage);
      b.flush();
      return after;
    }
    if (name === 'tabular' || name === 'tabular*' || name === 'tabularx' || name === 'array') {
      b.block(this.table(body, name, passage));
      return after;
    }
    if (name === 'tikzpicture') {
      const source = s.slice(s.lastIndexOf('\\begin{tikzpicture}', bodyStart), after);
      const img = { t: 'img', src: '', w: 0, h: 0, alt: 'Figure' };
      if (this.ctx.figure?.(source, img)) {
        this.lastImg = img;
        b.block(img);
      } else this.note('tikzpicture (not drawn)');
      return after;
    }
    if (name === 'itemize' || name === 'enumerate' || name === 'description') {
      const opt = readOptional(body, 0);
      if (opt) body = body.slice(opt.end);
      const items = splitItems(body).map(({ text }) => {
        let t = text;
        let label = '';
        const lo = readOptional(t, 0);
        if (lo) {
          label = `${this.inlinesText(lo.content)} `;
          t = t.slice(lo.end);
        }
        const c = this.inlines(t, marks, passage);
        return label ? tidyInlines([{ text: label, m: name === 'description' ? ['b'] : [] }, ...c.map((n) => (n.x !== undefined ? { text: n.x, m: n.m ?? [] } : n))]) : c;
      }).filter((c) => c.length);
      b.block({ t: name === 'enumerate' ? 'ol' : 'ul', items });
      return after;
    }
    if (name === 'quote' || name === 'quotation') {
      b.block({ t: 'quote', c: this.inlines(body, marks, passage) });
      return after;
    }
    if (name in DISPLAY_ENVS) {
      const wrap = DISPLAY_ENVS[name];
      const tex = cleanMath(wrap ? `\\begin{${wrap}}${body}\\end{${wrap}}` : body);
      if (tex) b.block({ t: 'math', tex });
      return after;
    }
    // Lesson boxes and anything else: keep the content, count the name
    this.note(`env:${name}`);
    const opt = readOptional(body, 0);
    if (opt) body = body.slice(opt.end);
    b.flush();
    this.walk(body, b, [...marks], passage);
    b.flush();
    return after;
  }

  table(body, name, passage) {
    let src = body;
    // the column spec (tabular* and tabularx take a width first)
    if (name === 'tabular*' || name === 'tabularx') {
      const w = readArg(src, 0);
      src = w ? src.slice(w.end) : src;
    }
    const opt = readOptional(src, 0);
    if (opt) src = src.slice(opt.end);
    const spec = readArg(src, 0);
    if (spec) src = src.slice(spec.end);
    const rules = /\\(toprule|midrule|bottomrule|hline|addlinespace)(\[[^\]]*\])?|\\(cmidrule|cline)(\([^)]*\))?\{[^}]*\}|\\rowcolor(\[[^\]]*\])?\{[^}]*\}/g;
    const rawRows = splitTopLevel(src, '\\\\');
    const rows = [];
    let head = false;
    for (const raw of rawRows) {
      let r = raw.replace(/^\s*\[[^\]]*\]/, '');
      // a rule right after the first row marks it as the header
      const lead = /^(\s*(\\(toprule|midrule|bottomrule|hline|addlinespace)(\[[^\]]*\])?|\\(cmidrule|cline)(\([^)]*\))?\{[^}]*\}))*/.exec(r)[0];
      if (rows.length === 1 && /\\(midrule|hline|cmidrule)/.test(lead)) head = true;
      r = r.replace(rules, '');
      if (!r.trim()) continue;
      const cells = [];
      for (const cellTex of splitTopLevel(r, '&')) {
        const mc = /^\s*\\multicolumn\s*\{(\d+)\}\s*\{[^}]*\}\s*/.exec(cellTex);
        if (mc) {
          const g = readGroup(cellTex, mc[0].length);
          cells.push(this.inlines(g ? g.content : '', [], passage));
          for (let n = 1; n < Number(mc[1]); n++) cells.push([]);
        } else cells.push(this.inlines(cellTex, [], passage));
      }
      rows.push(cells);
    }
    // a bold first row is a header too
    if (!head && rows.length > 1 && rows[0].every((cell) => cell.length === 0 || cell.every((n) => n.tex !== undefined || n.m?.includes('b')))) head = true;
    return { t: 'table', head, rows };
  }
}

// LaTeX -> SAT doc
export function toDoc(tex, ctx = {}) {
  const conv = new LatexConverter(ctx);
  return { v: DOC_VERSION, blocks: conv.blocks(tex) };
}

// Whether a block is a figure caption the converter made
export const isCaption = (block) => block?.caption === true;
