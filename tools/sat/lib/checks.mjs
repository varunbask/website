// Content checks that only report (they never change a question).

import { docText } from './latex-doc.mjs';

const BLANK = '\u0000';
const word = (w) => String(w ?? '').toLowerCase().replace(/[’']/g, "'").replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');

// The text of the paragraph holding the first blank, with the blank as \0
function blankParagraph(doc) {
  let found = null;
  const walk = (blocks) => {
    for (const b of blocks ?? []) {
      if (found) return;
      if (b.c && b.c.some((n) => n.blank)) {
        found = b.c.map((n) => (n.blank ? BLANK : n.br ? ' ' : n.tex !== undefined ? n.tex : n.x ?? '')).join('');
      } else if (b.t === 'passage') walk(b.blocks);
    }
  };
  walk(doc?.blocks);
  return found;
}

// "Repeated word around the blank": a word next to the blank that every
// choice also starts or ends with (so the completed sentence says it twice).
// -> { word, side, choices: 'start' | 'end' } or null
export function repeatedWordSuspect(item) {
  if (!item.choices || item.choices.length !== 4) return null;
  const text = blankParagraph(item.stem) ?? blankParagraph(item.passage);
  if (!text) return null;
  const at = text.indexOf(BLANK);
  const before = word(text.slice(0, at).trim().split(/\s+/).pop());
  const after = word(text.slice(at + 1).trim().split(/\s+/)[0]);
  const choices = item.choices.map((c) => docText(c).trim()).filter((t) => !/^\(?no punctuation\)?$/i.test(t));
  if (choices.length < 3) return null;
  const firsts = choices.map((t) => word(t.split(/\s+/)[0]));
  const lasts = choices.map((t) => word(t.split(/\s+/).pop()));
  for (const [w, side] of [[before, 'before'], [after, 'after']]) {
    if (!w || w.length < 2) continue;
    if (firsts.every((f) => f === w)) return { word: w, side, choices: 'start' };
    if (lasts.every((l) => l === w)) return { word: w, side, choices: 'end' };
  }
  return null;
}
