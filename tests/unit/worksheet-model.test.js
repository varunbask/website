import { describe, test, expect } from 'vitest';
import {
  PAGE, BRAND, FONTS, DEFAULT_COLORS, SPACE_HEIGHTS, wrapText, layoutRich, layoutWorksheet, spaceFor, worksheetFileName, hasWorksheet,
  isAppleTouch, lineHeight,
} from '../../portal/js/worksheet-model.js';
import { normalizeDraft } from '../../api/_lib/homework-draft.js';
import { draftV2, opusEquationsDraft } from './draft-fixtures.js';
import { inlineTex } from '../../portal/js/homework-doc.js';

// Stand-ins for canvas measureText and MathJax: every character half its font
// size wide; a formula 0.45 em a character, 0.9 em up and 0.3 em down
const measure = (text, key) => [...String(text)].length * FONTS[key].size * 0.5;
const measureMath = (tex, display, key) => ({ width: tex.length * FONTS[key].size * 0.45, ascent: FONTS[key].size * 0.9, descent: FONTS[key].size * 0.3 });
const BOTTOM = PAGE.height - PAGE.margin;

const DRAFTED = normalizeDraft(draftV2({ practice: 7 }), { count: 7 });
const layout = layoutWorksheet({ title: DRAFTED.title, details: DRAFTED.details, dueText: 'Due Monday, October 12' }, measure, measureMath);
const all = layout.pages.flatMap((p) => p.items);
const texts = (page) => page.items.filter((i) => i.type === 'text').map((i) => i.text);

describe('rich text', () => {
  test('words wrap at the width and keep the text\'s line breaks; a long word breaks between characters', () => {
    expect(wrapText('aaa bbb ccc', 7 * 5.75, measure, 'problem')).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText('one\ntwo', 600, measure, 'problem')).toEqual(['one', 'two']);
    expect(wrapText('abcdefghij', 4 * 5.75, measure, 'problem')).toEqual(['abcd', 'efgh', 'ij']);
  });

  test('a formula is a box on the line: never split, never split from the word it touches', () => {
    const rich = layoutRich('Factor ($x^2 + 5x + 6$).', 1000, measure, measureMath, 'problem');
    expect(rich.lines).toHaveLength(1);
    const items = rich.lines[0].items;
    expect(items.map((i) => i.type)).toEqual(['text', 'math', 'text']);
    expect(items[0].text).toBe('Factor (');
    expect(items[1]).toMatchObject({ tex: 'x^2 + 5x + 6', display: false });
    expect(items[2].dx).toBeCloseTo(items[1].dx + items[1].width);
    // narrow: the group "($...$)." moves to the next line whole
    const narrow = layoutRich('Factor ($x^2 + 5x + 6$).', 80, measure, measureMath, 'problem');
    expect(narrow.lines).toHaveLength(2);
    expect(narrow.lines[1].items.map((i) => i.type)).toEqual(['text', 'math', 'text']);
  });

  test('display math gets its own centered line; a tall formula makes its line taller', () => {
    const rich = layoutRich('So $$\\frac{a}{b}$$ is it.', 400, measure, measureMath, 'problem');
    expect(rich.lines).toHaveLength(3);
    expect(rich.lines[1]).toMatchObject({ center: true });
    expect(rich.lines[1].items[0]).toMatchObject({ type: 'math', display: true });
    const tall = layoutRich('$x$', 400, measure, () => ({ width: 10, ascent: 30, descent: 12 }), 'problem');
    expect(tall.lines[0].height).toBeGreaterThan(40);
  });

  test('without MathJax a formula still takes room, as its TeX', () => {
    const rich = layoutRich('Factor $x^2$.', 400, measure, () => null, 'problem');
    expect(rich.lines[0].items[1]).toMatchObject({ type: 'math', fallback: true });
  });
});

describe('the design', () => {
  const first = layout.pages[0];

  test('a header band in the accent color with the company and the title', () => {
    const band = first.items[0];
    expect(band).toMatchObject({ type: 'rect', x: PAGE.margin, y: PAGE.margin, fill: DEFAULT_COLORS.accent });
    expect(band.w).toBeCloseTo(PAGE.width - PAGE.margin * 2);
    expect(texts(first).slice(0, 2)).toEqual([BRAND.toUpperCase(), 'Factoring trinomials']);
  });

  test('Name, Date and Period fields, then the objective, time, materials and due chips', () => {
    const t = texts(first);
    for (const label of ['Name', 'Date', 'Period', 'OBJECTIVE', 'TIME', 'About 25 minutes', 'MATERIALS', 'Pencil. No calculator.', 'DUE', 'Monday, October 12']) {
      expect(t, label).toContain(label);
    }
    expect(first.items.filter((i) => i.type === 'math' && i.tex === 'x^2 + bx + c' && i.font === 'chip')).toHaveLength(1);
  });

  test('a heading bar for each section, with its directions', () => {
    const bars = all.filter((i) => i.type === 'rect' && i.fill === DEFAULT_COLORS.accentSoft && i.h >= 24);
    expect(bars.length).toBeGreaterThanOrEqual(6);
    const headings = all.filter((i) => i.type === 'text' && i.font === 'heading').map((i) => i.text);
    expect(headings).toEqual(['Part A: Warm-up', 'Worked example', 'Part B: Practice', 'Part C: Apply', 'Part D: Challenge', 'Part E: Check and reflect']);
    expect(all.some((i) => i.type === 'text' && i.font === 'directions' && i.text.startsWith('Factor each trinomial.'))).toBe(true);
  });

  test('a shaded worked-example box with numbered steps and the answer', () => {
    const t = all.filter((i) => i.type === 'text').map((i) => i.text);
    expect(t).toContain('WORKED EXAMPLE');
    expect(t).toContain('Problem');
    expect(t).toEqual(expect.arrayContaining(['1.', '2.', '3.', 'Answer']));
    expect(all.some((i) => i.type === 'rect' && i.fill === '#F6F8F9')).toBe(true);
  });

  test('number badges, multiple-choice bubbles, and work space by kind', () => {
    const badges = all.filter((i) => i.type === 'circle' && i.fill === DEFAULT_COLORS.accent);
    expect(badges).toHaveLength(2 + 7 + 1 + 1 + 2);
    const bubbles = all.filter((i) => i.type === 'circle' && !i.fill);
    expect(bubbles).toHaveLength(4);
    expect(all.filter((i) => i.type === 'text' && i.font === 'bubble').map((i) => i.text)).toEqual(['A', 'B', 'C', 'D']);
    expect(all.filter((i) => i.type === 'text' && i.text === 'Answer' && i.font === 'label').length).toBeGreaterThanOrEqual(3);
    expect(all.filter((i) => i.type === 'grid')).toHaveLength(1);
    expect(SPACE_HEIGHTS).toEqual({ none: 0, short: 30, medium: 96, long: 184, grid: 180 });
  });

  test('every formula is placed on a baseline with its size', () => {
    const maths = all.filter((i) => i.type === 'math');
    expect(maths.length).toBeGreaterThan(15);
    for (const m of maths) {
      expect(m.width).toBeGreaterThan(0);
      expect(m.ascent).toBeGreaterThan(0);
      expect(m.y).toBeGreaterThan(m.ascent);
    }
  });

  test('a footer on every page: the title, and Page N of M', () => {
    layout.pages.forEach((p, i) => {
      const t = texts(p);
      expect(t.at(-1)).toBe(`Page ${i + 1} of ${layout.pages.length}`);
      expect(t.at(-2)).toBe('Factoring trinomials');
    });
  });
});

describe('pagination', () => {
  test('a problem never splits from its work space, and nothing passes the bottom margin', () => {
    expect(layout.pages.length).toBeGreaterThan(1);
    for (const page of layout.pages) {
      const badges = page.items.filter((i) => i.type === 'circle' && i.fill === DEFAULT_COLORS.accent);
      for (const b of badges) expect(b.cy).toBeLessThan(BOTTOM);
      for (const it of page.items) {
        if (it.type === 'rule' && it.y1 < PAGE.height - PAGE.margin) expect(it.y1).toBeLessThanOrEqual(BOTTOM);
        if (it.type === 'rect' || it.type === 'grid') expect(it.y + it.h).toBeLessThanOrEqual(BOTTOM + 0.001);
        if (it.type === 'math') expect(it.y + it.descent).toBeLessThanOrEqual(BOTTOM + 0.001);
      }
    }
  });

  test('a section heading never ends a page', () => {
    for (const page of layout.pages) {
      const items = page.items.filter((i) => !(i.type === 'text' && i.font === 'footer') && i.type !== 'rule');
      const last = [...items].reverse().find((i) => i.type === 'text');
      expect(last.font).not.toBe('heading');
      expect(last.font).not.toBe('directions');
    }
  });

  test('the page text lists everything in reading order, math as TeX', () => {
    const text = layout.pages.map((p) => p.text).join('\n');
    expect(text).toContain('Objective: You will be able to factor trinomials of the form x^2 + bx + c.');
    expect(text.indexOf('Part A: Warm-up')).toBeLessThan(text.indexOf('Part B: Practice'));
    expect(text).toContain('(A) x - 2');
  });

  test('the answer key comes only when it is passed, on its own pages, with its refs', () => {
    expect(all.some((i) => i.type === 'text' && /Answer key/.test(i.text))).toBe(false);
    const keyed = layoutWorksheet({ title: 'T', details: DRAFTED.details, appendix: { heading: 'Answer key (staff only)', text: DRAFTED.answer_key_text } }, measure, measureMath);
    expect(keyed.pages.length).toBeGreaterThan(layout.pages.length);
    const keyPages = keyed.pages.slice(layout.pages.length);
    const keyTexts = keyPages.flatMap(texts);
    expect(keyTexts[0]).toBe('Answer key (staff only)');
    for (const ref of ['A1', 'B1', 'B7', 'C1', 'D1', 'E2']) expect(keyTexts, ref).toContain(ref);
    expect(keyPages.flatMap((p) => p.items).some((i) => i.type === 'math')).toBe(true);
  });
});

describe('text a tutor typed (not in the format)', () => {
  test('its text, then numbered problems with ruled work space', () => {
    const typed = layoutWorksheet({ title: 'Typed', details: 'Factor each one.\n\n1. Factor x² + 5x + 6.\n2. Factor x² − 1.\n3. Solve 3x − 7 = 11.' }, measure, measureMath);
    const items = typed.pages.flatMap((p) => p.items);
    expect(items.filter((i) => i.type === 'circle' && i.fill === DEFAULT_COLORS.accent)).toHaveLength(3);
    expect(spaceFor({ space: null }, { kind: 'legacy', count: 3 })).toBe('long');
    expect(spaceFor({ space: null }, { kind: 'legacy', count: 5 })).toBe('medium');
    expect(spaceFor({ space: null, choices: ['a', 'b'] }, { kind: 'legacy', count: 3 })).toBe('none');
    expect(items.filter((i) => i.type === 'rule' && i.width === 0.6).length).toBeGreaterThanOrEqual(24);
  });

  test('one typed problem gets the rest of its page', () => {
    const one = layoutWorksheet({ title: 'One', details: '1. Prove it.' }, measure, measureMath);
    expect(one.pages).toHaveLength(1);
    const lines = one.pages[0].items.filter((i) => i.type === 'rule' && i.width === 0.6);
    expect(lines.at(-1).y1).toBeGreaterThan(BOTTOM - 40);
  });

  test('nothing numbered: the text, then one large work area', () => {
    const plain = layoutWorksheet({ title: 'Essay', details: 'Write a paragraph about your weekend.' }, measure, measureMath);
    const box = plain.pages[0].items.filter((i) => i.type === 'rect' && !i.fill).at(-1);
    expect(box.h).toBeGreaterThan(300);
  });

  test('a paragraph longer than a page flows on', () => {
    const huge = layoutWorksheet({ title: 'T', details: 'word '.repeat(3000) }, measure, measureMath);
    expect(huge.pages.length).toBeGreaterThan(1);
  });
});

describe('around the worksheet', () => {
  test('the file name is the title as a slug', () => {
    expect(worksheetFileName('Factoring trinomials, set 1')).toBe('factoring-trinomials-set-1-worksheet.pdf');
    expect(worksheetFileName('')).toBe('assignment-worksheet.pdf');
  });

  test('assignments with written details get a worksheet; tasks and empty details do not', () => {
    expect(hasWorksheet({ kind: 'assignment', details: '1. x' })).toBe(true);
    expect(hasWorksheet({ kind: 'assignment', details: '  ' })).toBe(false);
    expect(hasWorksheet({ kind: 'task', details: '1. x' })).toBe(false);
  });

  test('iPhone and iPad (which reports itself as a Mac with touch)', () => {
    expect(isAppleTouch({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe(true);
    expect(isAppleTouch({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouch({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux', maxTouchPoints: 5 })).toBe(false);
  });

  test('line heights follow the font sizes', () => {
    expect(lineHeight('problem')).toBeCloseTo(11.5 * 1.38);
  });
});

describe('inline fractions (the real draft)', () => {
  // Like MathJax: a fraction in display style stands about 1.6 em tall; other inline math about 1 em
  const mathJaxLike = (tex, display, key) => {
    const em = FONTS[key].size;
    const tall = !display && inlineTex(tex) !== tex;
    return { width: tex.length * em * 0.4, ascent: (tall ? 0.95 : 0.75) * em, descent: (tall ? 0.7 : 0.25) * em };
  };
  const opus = normalizeDraft(opusEquationsDraft(), { count: 6 });
  const sheet = layoutWorksheet({ title: opus.title, details: opus.details }, measure, mathJaxLike);
  const maths = sheet.pages.flatMap((p) => p.items).filter((i) => i.type === 'math');

  test('a line with a fraction grows to fit it; others keep their height', () => {
    const plain = layoutRich('Solve $x + 9 = 15$.', 400, measure, mathJaxLike, 'problem');
    const frac = layoutRich('Solve $\\frac{x}{5} = 3$.', 400, measure, mathJaxLike, 'problem');
    expect(plain.lines[0].height).toBeCloseTo(11.5 * 1.38);
    expect(frac.lines[0].height).toBeGreaterThan(plain.lines[0].height);
    expect(frac.lines[0].height).toBeGreaterThanOrEqual((0.95 + 0.7) * 11.5);
  });

  test('the step with two fractions keeps its baseline with the text, and its lines do not overlap', () => {
    const step = layoutRich('$\\frac{4x}{4} = \\frac{28}{4}$, which gives $x = 7$.', 300, measure, mathJaxLike, 'body');
    const items = [];
    // place it and check every formula sits inside its own line box
    let top = 0;
    for (const line of step.lines) {
      const baseline = top + (line.height - (line.ascent + line.descent)) / 2 + line.ascent;
      for (const it of line.items) {
        if (it.type !== 'math') continue;
        expect(baseline - it.ascent).toBeGreaterThanOrEqual(top - 0.001);
        expect(baseline + it.descent).toBeLessThanOrEqual(top + line.height + 0.001);
        items.push(it);
      }
      top += line.height;
    }
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  test('on the worksheet, the fraction formulas are placed tall and on the text baseline', () => {
    const solve = maths.find((m) => m.tex === '\\frac{x}{5} = 3');
    expect(solve.ascent + solve.descent).toBeCloseTo(1.65 * FONTS.problem.size);
    const page = sheet.pages.find((p) => p.items.includes(solve));
    const words = page.items.filter((i) => i.type === 'text' && i.text === 'Solve' && Math.abs(i.y - solve.y) < 0.01);
    expect(words).toHaveLength(1);
    const step = maths.find((m) => m.tex === '\\frac{4x}{4} = \\frac{28}{4}');
    expect(step.font).toBe('body');
    // the line before the step and the one after do not run into it
    const pageItems = sheet.pages.find((p) => p.items.includes(step)).items.filter((i) => i.type === 'text' && i.font === 'body');
    const above = pageItems.filter((i) => i.y < step.y - 1).map((i) => i.y);
    if (above.length) expect(step.y - step.ascent).toBeGreaterThan(Math.max(...above));
  });
});
