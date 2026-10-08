import { describe, test, expect } from 'vitest';
import {
  PAGE, BRAND, FONTS, parseDetails, wrapText, layoutWorksheet, workHeight, worksheetFileName, hasWorksheet, isAppleTouch, lineHeight,
} from '../../portal/js/worksheet-model.js';

// A stand-in for canvas measureText: every character half its font size wide
const measure = (text, key) => [...String(text)].length * FONTS[key].size * 0.5;
const bottom = PAGE.height - PAGE.margin;

const DETAILS = [
  'Factor each expression completely.',
  '',
  '1. Factor x² + 7x + 12.',
  '',
  '2. Factor x² − 2x − 15.',
  '   Hint: two numbers that multiply to −15.',
  '',
  '3) Find √49 + √16.',
].join('\n');

describe('parseDetails', () => {
  test('the intro is everything before 1., each number starts a problem, and a hint stays with its problem', () => {
    const { intro, problems } = parseDetails(DETAILS);
    expect(intro).toBe('Factor each expression completely.');
    expect(problems).toEqual([
      { number: 1, text: 'Factor x² + 7x + 12.' },
      { number: 2, text: 'Factor x² − 2x − 15.\nHint: two numbers that multiply to −15.' },
      { number: 3, text: 'Find √49 + √16.' },
    ]);
  });

  test('numbers start at 1 and go up by one, so a stray number in the text stays text', () => {
    expect(parseDetails('Read pages 10 to 20.\n10. Not a problem').problems).toEqual([]);
    const { problems } = parseDetails('1. First\n3. Still part of the first\n2. Second');
    expect(problems.map((p) => p.text)).toEqual(['First\n3. Still part of the first', 'Second']);
    expect(parseDetails('Problems 1 to 15. Graph each one.').problems).toEqual([]);
    expect(parseDetails('2.5 + 1.2 = ?').problems).toEqual([]);
  });

  test('nothing numbered: the whole text is the instructions', () => {
    expect(parseDetails('Read chapter 6.\nWrite a summary.')).toEqual({ intro: 'Read chapter 6.\nWrite a summary.', problems: [] });
    expect(parseDetails('')).toEqual({ intro: '', problems: [] });
    expect(parseDetails(null)).toEqual({ intro: '', problems: [] });
  });

  test('Windows line breaks and a problem with no intro', () => {
    expect(parseDetails('1. A\r\n2. B')).toEqual({ intro: '', problems: [{ number: 1, text: 'A' }, { number: 2, text: 'B' }] });
  });
});

describe('wrapText', () => {
  test('wraps at the width, keeps line breaks, and breaks a word too long for a line', () => {
    expect(wrapText('aaa bbb ccc', 7 * 6, measure, 'problem')).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText('one\ntwo', 600, measure, 'problem')).toEqual(['one', 'two']);
    expect(wrapText('abcdefghij', 4 * 6, measure, 'problem')).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('\n\nhi\n\n', 600, measure, 'problem')).toEqual(['hi']);
  });
});

const texts = (page) => page.items.filter((i) => i.type === 'text').map((i) => i.text);
const boxes = (page) => page.items.filter((i) => i.type === 'box');

describe('layoutWorksheet', () => {
  const layout = layoutWorksheet({ title: 'Factoring practice', details: DETAILS, dueText: 'Due Friday, October 16' }, measure);

  test('page 1 has the header: company, Name and Date lines, title, due date, instructions', () => {
    const first = texts(layout.pages[0]);
    expect(first.slice(0, 6)).toEqual([BRAND, 'Name', 'Date', 'Factoring practice', 'Due Friday, October 16', 'Factor each expression completely.']);
    expect(layout.pages[0].items.filter((i) => i.type === 'rule').length).toBe(3);
  });

  test('each problem is its number, its text, then a work area; three problems get 3 in each', () => {
    expect(layout.problemCount).toBe(3);
    const all = layout.pages.flatMap((p) => p.items);
    for (const n of ['1.', '2.', '3.']) expect(all.some((i) => i.type === 'text' && i.text === n)).toBe(true);
    expect(all.filter((i) => i.type === 'box').map((b) => b.h)).toEqual([216, 216, 216]);
    expect(all.some((i) => i.type === 'text' && i.text === 'Hint: two numbers that multiply to −15.')).toBe(true);
  });

  test('a problem and its work area never split across pages, and nothing passes the bottom margin', () => {
    const many = layoutWorksheet({ title: 'Long', details: Array.from({ length: 12 }, (_, i) => `${i + 1}. Problem ${i + 1} ${'word '.repeat(30)}`).join('\n') }, measure);
    expect(many.pages.length).toBeGreaterThan(2);
    for (const page of many.pages) {
      const numbers = page.items.filter((i) => i.type === 'text' && /^\d+\.$/.test(i.text));
      expect(numbers.length).toBe(boxes(page).length);
      for (const b of boxes(page)) expect(b.y + b.h).toBeLessThanOrEqual(bottom + 0.001);
      for (const t of page.items.filter((i) => i.type === 'text' && i.font !== 'footer')) expect(t.y).toBeLessThanOrEqual(bottom + 0.001);
    }
    expect(many.pages.flatMap(boxes).map((b) => b.h).every((hgt) => hgt === workHeight(12))).toBe(true);
  });

  test('work areas: about 3 in for up to 3 problems, 2.5 in for up to 6, 2 in for more', () => {
    expect([1, 3, 4, 6, 7, 15].map(workHeight)).toEqual([216, 216, 180, 180, 144, 144]);
  });

  test('a single problem gets the rest of its page', () => {
    const one = layoutWorksheet({ title: 'One', details: '1. Prove it.' }, measure);
    expect(one.pages).toHaveLength(1);
    const [box] = boxes(one.pages[0]);
    expect(box.y + box.h).toBeCloseTo(bottom, 5);
    expect(box.h).toBeGreaterThan(400);
  });

  test('no numbered problems: the instructions, then one large work area', () => {
    const plain = layoutWorksheet({ title: 'Essay', details: 'Write a paragraph about your weekend.' }, measure);
    expect(plain.problemCount).toBe(0);
    const [box] = boxes(plain.pages[0]);
    expect(box.h).toBeGreaterThan(400);
    expect(box.y + box.h).toBeCloseTo(bottom, 5);
  });

  test('every page ends with Page N of M', () => {
    const many = layoutWorksheet({ title: 'Long', details: Array.from({ length: 9 }, (_, i) => `${i + 1}. P${i + 1}`).join('\n') }, measure);
    many.pages.forEach((page, i) => {
      const footer = page.items.at(-1);
      expect(footer).toMatchObject({ type: 'text', text: `Page ${i + 1} of ${many.pages.length}`, font: 'footer' });
      expect(footer.y).toBeGreaterThan(bottom);
      expect(page.text.endsWith(`Page ${i + 1} of ${many.pages.length}`)).toBe(true);
    });
    // only page 1 has the header
    expect(many.pages.slice(1).every((p) => !texts(p).includes(BRAND))).toBe(true);
  });

  test('an appendix comes only when it is passed, on its own pages at the end', () => {
    expect(layout.pages.flatMap(texts).join('\n')).not.toMatch(/Answer key/);
    const keyed = layoutWorksheet({ title: 'T', details: DETAILS, appendix: { heading: 'Answer key (staff only)', text: '1. (x + 3)(x + 4)\n2. (x − 5)(x + 3)' } }, measure);
    expect(keyed.pages.length).toBe(layout.pages.length + 1);
    expect(texts(keyed.pages.at(-1)).slice(0, 3)).toEqual(['Answer key (staff only)', '1. (x + 3)(x + 4)', '2. (x − 5)(x + 3)']);
    expect(layoutWorksheet({ title: 'T', details: DETAILS, appendix: { heading: 'Answer key', text: '  ' } }, measure).pages.length).toBe(layout.pages.length);
  });

  test('a problem longer than a page still flows on, with a work area after it', () => {
    const huge = layoutWorksheet({ title: 'T', details: `1. ${'word '.repeat(2500)}` }, measure);
    expect(huge.pages.length).toBeGreaterThan(1);
    const box = huge.pages.flatMap(boxes)[0];
    expect(box.h).toBeGreaterThanOrEqual(54);
  });

  test('line heights follow the font sizes', () => {
    expect(lineHeight('problem')).toBeCloseTo(12 * 1.35);
  });
});

describe('around the worksheet', () => {
  test('the file name is the title as a slug', () => {
    expect(worksheetFileName('Factoring trinomials, set 1')).toBe('factoring-trinomials-set-1-worksheet.pdf');
    expect(worksheetFileName('Álgebra: x² + √2!')).toBe('algebra-x2-2-worksheet.pdf');
    expect(worksheetFileName('')).toBe('assignment-worksheet.pdf');
    expect(worksheetFileName('a'.repeat(100))).toBe(`${'a'.repeat(60)}-worksheet.pdf`);
  });

  test('assignments with written details get a worksheet; tasks and empty details do not', () => {
    expect(hasWorksheet({ kind: 'assignment', details: '1. x' })).toBe(true);
    expect(hasWorksheet({ kind: 'assignment', details: '  ' })).toBe(false);
    expect(hasWorksheet({ kind: 'task', details: '1. x' })).toBe(false);
    expect(hasWorksheet(null)).toBe(false);
  });

  test('iPhone and iPad (which reports itself as a Mac with touch)', () => {
    expect(isAppleTouch({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe(true);
    expect(isAppleTouch({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouch({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isAppleTouch({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux', maxTouchPoints: 5 })).toBe(false);
  });
});
