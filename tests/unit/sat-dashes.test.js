import { describe, test, expect } from 'vitest';
import { rewriteRuns, rewriteExplanation, isClause } from '../../tools/sat/lib/dashes.mjs';

// Made-up explanation sentences
const text = (runs) => runs.map((n) => (n.x !== undefined ? n.x : n.tex !== undefined ? `$${n.tex}$` : '')).join('');
const fix = (s) => text(rewriteRuns([{ x: s }]).c);

describe('dashes in explanations', () => {
  test('a pair in one sentence becomes commas, or parentheses when the middle has a comma', () => {
    expect(fix('The median is the middle value — the seventh — which is 5.')).toBe('The median is the middle value, the seventh, which is 5.');
    expect(fix('It doubles — slowly, then fast — over the year.')).toBe('It doubles (slowly, then fast) over the year.');
    expect(fix('Two groups \u2014 cats, and dogs \u2014 neither of which came.')).toBe('Two groups (cats, and dogs), neither of which came.');
    expect(fix('It ends with a pair — here at the end —.')).toBe('It ends with a pair, here at the end.');
  });

  test('a single dash: a colon after a complete clause, a comma otherwise', () => {
    expect(fix('(A) is the word-match trap — it borrows a phrase from the text.')).toBe('(A) is the word-match trap: it borrows a phrase from the text.');
    expect(fix('The coating stops the flaking — and the paint stays put.')).toBe('The coating stops the flaking, and the paint stays put.');
    expect(fix('A small change — nothing more.')).toBe('A small change, nothing more.');
    expect(fix('Step 4 — evaluate.')).toBe('Step 4: evaluate.');
    expect(fix('Here is the rule: the subject — not the noun nearby.')).toBe('Here is the rule: the subject, not the noun nearby.');
  });

  test('ranges and compounds with an en dash', () => {
    expect(fix('Pages 3–5 hold it, and the subject–verb pair agrees.')).toBe('Pages 3 to 5 hold it, and the subject-verb pair agrees.');
    expect(text(rewriteRuns([{ x: 'goals in ' }, { tex: '10' }, { x: '–' }, { tex: '14' }, { x: '.' }]).c)).toBe('goals in $10$ to $14$.');
    expect(text(rewriteRuns([{ x: 'the ' }, { tex: '8' }, { x: '–' }, { tex: '15' }, { x: '–' }, { tex: '17' }, { x: ' triangle' }]).c)).toBe('the $8$-$15$-$17$ triangle');
  });

  test('math, quotes, italic text and sentences about dashes keep their dashes', () => {
    const math = [{ x: 'So ' }, { tex: 'a—b' }, { x: ' holds.' }];
    expect(rewriteRuns(math).c).toEqual(math);
    expect(fix('The text says “not one — not ever” and means it.')).toBe('The text says “not one — not ever” and means it.');
    expect(fix('The closing mark must be a dash — like the opening one.')).toBe('The closing mark must be a dash — like the opening one.');
    const italic = [{ x: 'Read it: ' }, { x: 'symphony — left unfinished', m: ['i'] }, { x: '.' }];
    expect(rewriteRuns(italic).c).toEqual(italic);
    expect(rewriteRuns(italic).kept).toBe(1);
    expect(text(rewriteRuns([{ x: 'Step 2 \u2014 square.', m: ['i'] }, { x: ' Then add.' }]).c)).toBe('Step 2: square. Then add.');
  });

  test('marks and math around a dash survive', () => {
    const out = rewriteRuns([{ x: '(B)', m: ['b'] }, { x: ' gives ' }, { tex: 'x=4' }, { x: ' — the other variable.' }]).c;
    expect(out).toEqual([{ x: '(B)', m: ['b'] }, { x: ' gives ' }, { tex: 'x=4' }, { x: ': the other variable.' }]);
  });

  test('a whole explanation: counts and before/after samples; passages untouched', () => {
    const doc = { v: 1, blocks: [
      { t: 'p', c: [{ x: 'The line rises — the slope is positive.' }] },
      { t: 'passage', label: null, blocks: [{ t: 'p', c: [{ x: 'Quoted — text.' }] }] },
      { t: 'ul', items: [[{ x: 'A list \u2014 two items.' }]] },
    ] };
    const r = rewriteExplanation(doc);
    expect(r.changed).toBe(2);
    expect(r.doc.blocks[0].c[0].x).toBe('The line rises: the slope is positive.');
    expect(r.doc.blocks[1]).toBe(doc.blocks[1]);
    expect(r.doc.blocks[2].items[0][0].x).toBe('A list, two items.');
    expect(r.samples[0]).toEqual({ before: 'The line rises — the slope is positive.', after: 'The line rises: the slope is positive.' });
  });

  test('what counts as a clause', () => {
    expect(isClause('(C) is the trap')).toBe(true);
    expect(isClause('the coating supplies the gloss')).toBe(true);
    expect(isClause('A small change')).toBe(false);
    expect(isClause('the four tablets')).toBe(false);
  });
});
