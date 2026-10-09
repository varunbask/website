import { describe, test, expect } from 'vitest';
import { gridAccept, sprKey, parseGrid, enterable, sameNumber, plainValue, mcAnswer } from '../../tools/sat/lib/keys.mjs';

describe('grid-in values', () => {
  test('written values become plain grid strings', () => {
    expect(plainValue('$-\\tfrac{2}{3}$')).toBe('-2/3');
    expect(plainValue('\\textbf{.75}')).toBe('.75');
    expect(plainValue('$\\dfrac{37}{4}$')).toBe('37/4');
    expect(plainValue('$12{,}000$')).toBe('12000');
    expect(plainValue('$x=3$')).toBeNull();
  });

  test('parsing, equality and the entry limits', () => {
    expect(parseGrid('6/4')).toEqual({ n: 3, d: 2 });
    expect(parseGrid('.5')).toEqual({ n: 1, d: 2 });
    expect(parseGrid('-0.25')).toEqual({ n: -1, d: 4 });
    expect(parseGrid('1/0')).toBeNull();
    expect(sameNumber('6/4', '1.5')).toBe(true);
    expect(enterable('12345')).toBe(true);
    expect(enterable('123456')).toBe(false);
    expect(enterable('-12345')).toBe(true);
    expect(enterable('-.6667')).toBe(true);
    expect(enterable('2x')).toBe(false);
  });
});

describe('accept lists (SAT entry rules)', () => {
  test('a repeating fraction under 1: rounded and truncated forms that fill the box', () => {
    expect(gridAccept('2/3')).toEqual(['.6666', '.6667', '0.666', '0.667']);
    expect(gridAccept('8/17')).toEqual(['.4705', '.4706', '0.470', '0.471']);
    expect(gridAccept('-2/3')).toEqual(['-.6666', '-.6667', '-0.666', '-0.667']);
    expect(gridAccept('-1/3')).toEqual(['-.3333', '-0.333']);
  });

  test('a repeating value over 1 keeps as many decimals as fit', () => {
    expect(gridAccept('100/7')).toEqual(['14.28', '14.29']);
    expect(gridAccept('23/17')).toEqual(['1.352', '1.353']);
  });

  test('a terminating fraction lists its decimal; whole numbers and decimals need nothing', () => {
    expect(gridAccept('7/2')).toEqual(['3.5']);
    expect(gridAccept('3/4')).toEqual(['0.75']);
    expect(gridAccept('12')).toEqual([]);
    expect(gridAccept('2.5')).toEqual([]);
  });

  test('the key: canonical value, listed alternatives, and short decimals dropped', () => {
    expect(sprKey(['.5'])).toEqual({ answer: '0.5', accept: [], dropped: [] });
    expect(sprKey(['3/5', '0.6'])).toEqual({ answer: '3/5', accept: ['0.6'], dropped: [] });
    expect(sprKey(['-2/3', '-.667'])).toEqual({ answer: '-2/3', accept: ['-.6666', '-.6667', '-0.666', '-0.667'], dropped: ['-.667'] });
    expect(sprKey(['2/3', '.6667']).accept).toEqual(['.6667', '.6666', '0.666', '0.667']);
    // a second root is an alternative answer
    expect(sprKey(['2', '5'])).toEqual({ answer: '2', accept: ['5'], dropped: [] });
  });
});

describe('multiple-choice keys', () => {
  test('the letter after Answer, with or without a word after it', () => {
    expect(mcAnswer('\\textbf{Answer: (C).} Because.')).toBe('C');
    expect(mcAnswer('\\textbf{Answer: (B) endure.} The tortoise.')).toBe('B');
    expect(mcAnswer('\\textbf{Answer:} (D). Because.')).toBe('D');
    expect(mcAnswer('\\textbf{Answer: (E).}')).toBeNull();
    expect(mcAnswer('No letter.')).toBeNull();
  });
});
