// Study-guide Markdown -> SAT docs. A small, strict subset: front matter,
// ## and ### headings, paragraphs, - and 1. lists, **bold**, *italic*,
// $inline tex$, $$display tex$$, pipe tables and > callouts (quote blocks).
// SAT docs have one heading level, so ## becomes an h3 and ### a bold line.

export const DOC_VERSION = 1;

// "---\nkey: value\n---\nbody" -> { meta, body }
export function frontMatter(text) {
  const src = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (!kv) continue;
    let v = kv[2].replace(/^(['"])(.*)\1$/, '$2');
    if (/^-?\d+$/.test(v)) v = Number(v);
    meta[kv[1]] = v;
  }
  return { meta, body: src.slice(m[0].length) };
}

// One line of Markdown -> inline runs
export function mdInlines(text) {
  const out = [];
  const push = (x, m) => {
    if (!x) return;
    const last = out[out.length - 1];
    const marks = [...m].sort((a, b) => ['b', 'i'].indexOf(a) - ['b', 'i'].indexOf(b));
    if (last && last.x !== undefined && (last.m ?? []).join() === marks.join()) last.x += x;
    else out.push(marks.length ? { x, m: marks } : { x });
  };
  const marks = new Set();
  let buf = '';
  const flush = () => {
    push(buf, marks);
    buf = '';
  };
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!$|>]/.test(s[i + 1])) {
      buf += s[i + 1];
      i++;
      continue;
    }
    if (ch === '$') {
      const close = s.indexOf('$', i + 1);
      if (close > i + 1) {
        flush();
        out.push({ tex: s.slice(i + 1, close).trim() });
        i = close;
        continue;
      }
    }
    if (ch === '`') {
      const close = s.indexOf('`', i + 1);
      if (close > i) {
        buf += s.slice(i + 1, close);
        i = close;
        continue;
      }
    }
    if (ch === '[') {
      const link = /^\[([^\]]*)\]\(([^)]*)\)/.exec(s.slice(i));
      if (link) {
        flush();
        for (const n of mdInlines(link[1])) {
          if (n.x !== undefined) push(n.x, new Set([...(n.m ?? []), ...marks]));
          else out.push(n);
        }
        i += link[0].length - 1;
        continue;
      }
    }
    if ((ch === '*' && s[i + 1] === '*') || (ch === '_' && s[i + 1] === '_')) {
      flush();
      if (marks.has('b')) marks.delete('b');
      else marks.add('b');
      i++;
      continue;
    }
    if (ch === '*' || (ch === '_' && !/\w/.test(s[i - 1] ?? '') ) || (ch === '_' && marks.has('i'))) {
      flush();
      if (marks.has('i')) marks.delete('i');
      else marks.add('i');
      continue;
    }
    buf += ch;
  }
  flush();
  // tidy the ends
  if (out[0]?.x !== undefined) out[0].x = out[0].x.replace(/^\s+/, '');
  const last = out[out.length - 1];
  if (last?.x !== undefined) last.x = last.x.replace(/\s+$/, '');
  return out.filter((n) => n.x === undefined || n.x !== '');
}

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

// Markdown body -> SAT doc
export function markdownToDoc(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  const flushPara = () => {
    if (para.length) {
      const c = mdInlines(para.join(' '));
      if (c.length) blocks.push({ t: 'p', c });
    }
    para = [];
  };
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    const t = line.trim();
    if (!t) {
      flushPara();
      continue;
    }
    let m;
    if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(t))) {
      flushPara();
      const c = mdInlines(m[2]);
      if (m[1].length <= 2) blocks.push({ t: 'h3', c });
      else blocks.push({ t: 'p', c: c.map((n) => (n.x !== undefined ? { x: n.x, m: [...new Set(['b', ...(n.m ?? [])])].sort() } : n)) });
      continue;
    }
    if (t.startsWith('$$')) {
      flushPara();
      let tex = t.slice(2);
      if (tex.endsWith('$$') && tex.length >= 2) tex = tex.slice(0, -2);
      else {
        while (k + 1 < lines.length) {
          k++;
          const l = lines[k];
          if (l.trim().endsWith('$$')) {
            tex += `\n${l.trim().slice(0, -2)}`;
            break;
          }
          tex += `\n${l}`;
        }
      }
      tex = tex.replace(/\s+/g, ' ').trim();
      if (tex) blocks.push({ t: 'math', tex });
      continue;
    }
    if (t.startsWith('>')) {
      flushPara();
      const quote = [t.replace(/^>\s?/, '')];
      while (k + 1 < lines.length && lines[k + 1].trim().startsWith('>')) {
        k++;
        quote.push(lines[k].trim().replace(/^>\s?/, ''));
      }
      // a blank "> " line inside the callout is a line break
      const c = [];
      quote.join('\n').split(/\n\s*\n/).forEach((part, n) => {
        if (n) c.push({ br: true });
        c.push(...mdInlines(part.replace(/\n/g, ' ')));
      });
      if (c.length) blocks.push({ t: 'quote', c });
      continue;
    }
    if (/^\|/.test(t) && k + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[k + 1].trim())) {
      flushPara();
      const rows = [splitRow(t).map(mdInlines)];
      k++;
      while (k + 1 < lines.length && /^\|/.test(lines[k + 1].trim())) {
        k++;
        rows.push(splitRow(lines[k]).map(mdInlines));
      }
      blocks.push({ t: 'table', head: true, rows });
      continue;
    }
    if ((m = /^([-*+]|\d+[.)])\s+(.*)$/.exec(t))) {
      flushPara();
      const ordered = /\d/.test(m[1]);
      const items = [m[2]];
      while (k + 1 < lines.length) {
        const next = lines[k + 1];
        const nm = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(next);
        if (nm && /\d/.test(nm[1]) === ordered) {
          items.push(nm[2]);
          k++;
        } else if (next.trim() && /^\s{2,}\S/.test(next) && !nm) {
          items[items.length - 1] += ` ${next.trim()}`;
          k++;
        } else break;
      }
      blocks.push({ t: ordered ? 'ol' : 'ul', items: items.map(mdInlines) });
      continue;
    }
    para.push(t);
  }
  flushPara();
  return { v: DOC_VERSION, blocks };
}

// A guide file -> { meta, body: SAT doc }
export function guideFromMarkdown(text) {
  const { meta, body } = frontMatter(text);
  return { meta, body: markdownToDoc(body) };
}
