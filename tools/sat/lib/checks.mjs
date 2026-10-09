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

// "Repeated word around the blank": the word just before the blank that every
// choice also starts with, or the word just after it that every choice ends
// with (so the completed sentence says it twice).
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
  // the word before the blank opening every choice, or the word after it closing every choice
  if (before.length >= 2 && firsts.every((f) => f === before)) return { word: before, side: 'before', choices: 'start' };
  if (after.length >= 2 && lasts.every((l) => l === after)) return { word: after, side: 'after', choices: 'end' };
  return null;
}
