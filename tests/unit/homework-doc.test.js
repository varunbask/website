import { describe, test, expect } from 'vitest';
import {
  parseHomework, serializeHomework, parseKey, serializeKey, problemRefs, splitMath, hasMath, mathIn, detailsSummary, plainMath, inlineTex,
} from '../../portal/js/homework-doc.js';
import { normalizeDraft } from '../../api/_lib/homework-draft.js';
import { draftV2, opusEquationsDraft } from './draft-fixtures.js';

const OPUS = normalizeDraft(opusEquationsDraft(), { count: 6 });

const SAMPLE = [
  'Objective: Factor trinomials of the form $x^2 + bx + c$.',
  'Time: about 25 minutes',
  'Materials: Pencil. No calculator.',
  '',
  '## Part A: Warm-up',
  'Directions: Multiply.',
  '1. Multiply $(x + 2)(x + 3)$. [space: short]',
  '2. Multiply $(x - 1)(x + 4)$. [space: short]',
  '',
  '## Worked example',
  'Problem: Factor $x^2 + 7x + 12$.',
  'Step 1: Find two numbers that multiply to $12$ and add to $7$.',
  'Step 2: They are $3$ and $4$.',
  'Answer: $(x + 3)(x + 4)$',
  '',
  '## Part B: Practice',
  'Directions: Factor each one.',
  '1. Factor $x^2 + 9x + 20$. [space: medium]',
  '   Hint: Which factors of $20$ add to $9$?',
  '2. Which is a factor of $x^2 - x - 6$? [space: none]',
  '   (A) $x - 2$  (B) $x + 2$  (C) $x + 3$  (D) $x - 6$',
  '',
  '## Part C: Apply',
  '1. A garden has area $x^2 + 5x + 6$ square feet. [space: long]',
  '   Write its length and width.',
  '',
  '## Challenge',
  '1. Factor $2x^2 + 7x + 3$. [space: grid]',
  '',
  '## Check and reflect',
  'Answer in a sentence.',
  '',
  '1. Why does the sign of $c$ matter? [space: medium]',
].join('\n');

describe('parseHomework', () => {
  const doc = parseHomework(SAMPLE);

  test('the header, then the sections in order with their letters', () => {
    expect(doc).toMatchObject({ structured: true, objective: 'Factor trinomials of the form $x^2 + bx + c$.', time: 'about 25 minutes', materials: 'Pencil. No calculator.' });
    expect(doc.sections.map((s) => [s.heading, s.letter])).toEqual([
      ['Part A: Warm-up', 'A'], ['Worked example', null], ['Part B: Practice', 'B'], ['Part C: Apply', 'C'], ['Challenge', 'D'], ['Check and reflect', 'E'],
    ]);
    expect(problemRefs(doc)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'D1', 'E1']);
  });

  test('directions, the worked example and its steps, problems with hints, choices and work space', () => {
    expect(doc.sections[0].directions).toBe('Multiply.');
    expect(doc.sections[1].example).toEqual({
      problem: 'Factor $x^2 + 7x + 12$.',
      steps: ['Find two numbers that multiply to $12$ and add to $7$.', 'They are $3$ and $4$.'],
      answer: '$(x + 3)(x + 4)$',
    });
    expect(doc.sections[2].problems).toEqual([
      { number: 1, prompt: 'Factor $x^2 + 9x + 20$.', choices: null, hint: 'Which factors of $20$ add to $9$?', space: 'medium' },
      { number: 2, prompt: 'Which is a factor of $x^2 - x - 6$?', choices: ['$x - 2$', '$x + 2$', '$x + 3$', '$x - 6$'], hint: null, space: 'none' },
    ]);
    expect(doc.sections[3].problems[0].prompt).toBe('A garden has area $x^2 + 5x + 6$ square feet.\nWrite its length and width.');
    expect(doc.sections[5].text).toEqual(['Answer in a sentence.']);
  });

  test('a "Part" heading names its letter; others follow on', () => {
    const d = parseHomework('## Part C: Apply\n1. One\n\n## Extra\n1. Two');
    expect(d.sections.map((s) => s.letter)).toEqual(['C', 'D']);
  });

  test('choices one per line work too', () => {
    const d = parseHomework('## Quiz\n1. Pick one.\n   (A) red\n   (B) blue\n   (C) green');
    expect(d.sections[0].problems[0].choices).toEqual(['red', 'blue', 'green']);
  });
});

describe('round trip', () => {
  test('serialize then parse gives the same document', () => {
    const doc = parseHomework(SAMPLE);
    const again = parseHomework(serializeHomework(doc));
    expect(again).toEqual(doc);
  });

  test('canonical text comes back byte for byte', () => {
    const canonical = serializeHomework(parseHomework(SAMPLE));
    expect(serializeHomework(parseHomework(canonical))).toBe(canonical);
    // the canonical form keeps the work space tag on the problem's first line
    expect(canonical).toContain('1. A garden has area $x^2 + 5x + 6$ square feet. [space: long]\n   Write its length and width.');
  });

  test('a drafted assignment round-trips, and its key lines up with its problems', () => {
    const d = normalizeDraft(draftV2(), { count: 5 });
    expect(serializeHomework(parseHomework(d.details))).toBe(d.details);
    const groups = parseKey(d.answer_key_text);
    expect(serializeKey(groups)).toBe(d.answer_key_text);
    expect(groups.flatMap((g) => g.entries.map((e) => e.ref))).toEqual(problemRefs(parseHomework(d.details)));
  });

  test('the answer key format: refs, steps, part headings', () => {
    const groups = [{ heading: 'Part A: Warm-up', entries: [{ ref: 'A1', answer: '$x^2 + 5x + 6$', steps: ['Multiply the first terms.', 'Add the middle terms.'] }] }];
    const text = serializeKey(groups);
    expect(text).toBe('## Part A: Warm-up\nA1. $x^2 + 5x + 6$\n   Step 1: Multiply the first terms.\n   Step 2: Add the middle terms.');
    expect(parseKey(text)).toEqual(groups);
    expect(parseKey('1. (x + 2)(x + 3)\nJust typed.')).toBeNull();
  });
});

describe('text a tutor typed (not in the format)', () => {
  test('paragraphs, then numbered problems, as the worksheet always read them', () => {
    const d = parseHomework('Factor each one.\n\n1. Factor x² + 5x + 6.\n\n2. Factor x² − 1.\n   Hint: squares.');
    expect(d.structured).toBe(false);
    expect(d.sections).toHaveLength(1);
    expect(d.sections[0]).toMatchObject({ heading: null, letter: 'A', text: ['Factor each one.'] });
    expect(d.sections[0].problems.map((p) => [p.prompt, p.hint, p.space])).toEqual([['Factor x² + 5x + 6.', null, null], ['Factor x² − 1.', 'squares.', null]]);
  });

  test('numbers start at 1 and go up by one, so a stray number stays text', () => {
    expect(parseHomework('Read pages 10 to 20.\n10. Not a problem').sections[0].problems).toEqual([]);
    expect(parseHomework('1. First\n3. Still part of the first\n2. Second').sections[0].problems.map((p) => p.prompt)).toEqual(['First\n3. Still part of the first', 'Second']);
    expect(parseHomework('2.5 + 1.2 = ?').sections[0].problems).toEqual([]);
  });

  test('nothing at all', () => {
    expect(parseHomework('')).toEqual({ objective: null, time: null, materials: null, sections: [], structured: false });
  });
});

describe('math, by the Pandoc dollar rule', () => {
  const math = (text) => splitMath(text).filter((p) => p.type === 'math').map((p) => (p.display ? `$$${p.value}$$` : p.value));

  test('inline and display math', () => {
    expect(splitMath('Factor $x^2 + 5x + 6$ now.')).toEqual([
      { type: 'text', value: 'Factor ' }, { type: 'math', value: 'x^2 + 5x + 6', display: false }, { type: 'text', value: ' now.' },
    ]);
    expect(math('Solve: $$\\frac{a}{b} = 2$$ then stop.')).toEqual(['$$\\frac{a}{b} = 2$$']);
  });

  test('an opening $ needs a non-space after it; a closing $ a non-space before it and no digit after', () => {
    expect(math('costs $5 and $10 today')).toEqual([]);
    expect(math('pay $20,000')).toEqual([]);
    expect(math('$ x$ and $x $')).toEqual([]);
    expect(math('$x$5')).toEqual([]);
    expect(math('$x+1$ and $y$')).toEqual(['x+1', 'y']);
    expect(math('costs $5 and $10, then $x$ ok')).toEqual(['x']);
  });

  test('\\$ is a literal dollar sign; a lone $5 in typed text stays text', () => {
    expect(splitMath('Price: \\$3 or $y$')).toEqual([{ type: 'text', value: 'Price: $3 or ' }, { type: 'math', value: 'y', display: false }]);
    expect(splitMath('Lunch costs $5.')).toEqual([{ type: 'text', value: 'Lunch costs $5.' }]);
    expect(hasMath('Lunch costs $5.')).toBe(false);
    expect(hasMath('Factor $x^2$')).toBe(true);
  });

  test('inline math stays on one line; mhchem is just TeX', () => {
    expect(math('$x\ny$')).toEqual([]);
    expect(mathIn('Water is $\\ce{H2O}$.')).toEqual([{ tex: '\\ce{H2O}', display: false }]);
  });
});

describe('one-line previews', () => {
  test('a problem set shows its objective; typed text its first line; math as TeX without dollar signs', () => {
    expect(detailsSummary(SAMPLE)).toBe('Factor trinomials of the form x^2 + bx + c.');
    expect(detailsSummary('\n  Read pages 10 to 20.\nThen answer.')).toBe('Read pages 10 to 20.');
    expect(detailsSummary('## Part A: Warm-up\nDirections: Multiply $(x+1)(x+2)$.\n1. One')).toBe('Multiply (x+1)(x+2).');
    expect(plainMath('Lunch costs $5 and \\$3; $x$ wins')).toBe('Lunch costs $5 and $3; x wins');
    expect(detailsSummary('')).toBe('');
  });
});

describe('inline fractions are full size', () => {
  test('inline math with a fraction is set in display style; other math is left alone', () => {
    expect(inlineTex('\\frac{x}{5} = 3')).toBe('\\displaystyle \\frac{x}{5} = 3');
    expect(inlineTex('\\frac{4x}{4} = \\frac{28}{4}')).toBe('\\displaystyle \\frac{4x}{4} = \\frac{28}{4}');
    expect(inlineTex('\\tfrac{1}{2}x')).toBe('\\displaystyle \\dfrac{1}{2}x');
    expect(inlineTex('\\sqrt{\\frac{a}{b}}')).toBe('\\displaystyle \\sqrt{\\frac{a}{b}}');
    expect(inlineTex('\\binom{n}{k}')).toBe('\\displaystyle \\binom{n}{k}');
    expect(inlineTex('x = 7')).toBe('x = 7');
    expect(inlineTex('\\sqrt{49}')).toBe('\\sqrt{49}');
    expect(inlineTex('\\displaystyle \\frac{a}{b}')).toBe('\\displaystyle \\frac{a}{b}');
    expect(inlineTex('\\fraction')).toBe('\\fraction');
  });

  test('the real draft that printed fractions too small has them in its problems and steps', () => {
    const fractions = mathIn(OPUS.details).map((m) => m.tex).filter((tex) => inlineTex(tex) !== tex);
    expect(fractions).toEqual(expect.arrayContaining(['\\frac{x}{5} = 3', '\\frac{4x}{4} = \\frac{28}{4}']));
  });
});
