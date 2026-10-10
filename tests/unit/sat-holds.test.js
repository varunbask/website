import { describe, test, expect } from 'vitest';
import { mapFindings, matchFinding, sourceIndex } from '../../tools/sat/lib/holds.mjs';
import { loadOverrides, normLabel, labelMatches } from '../../tools/sat/lib/overrides.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Made-up items and findings shaped like content.json and the checkers' files
const items = [
  { id: 'alg-ch4-07', source: { file: '05-algebra/04-ineq/chapter.tex', set: 'Chapter 4 Practice --- Inequalities', q: 7 } },
  { id: 'geo-t3-03', source: { file: '08-geo/practice-tests/tests.tex', set: 'Practice Test 3 --- Geometry \\& Trig', q: 3 } },
  { id: 'geo-t4-03', source: { file: '08-geo/practice-tests/tests.tex', set: 'Practice Test 4 --- Geometry \\& Trig', q: 3 } },
  { id: 'full-01-rw2-16', source: { file: '09-cumulative-master/practice-tests/exam-01-rw2.tex', set: 'Practice Test 1', module_label: 'Reading \\& Writing --- Module 2', q: 16 } },
  { id: 'cs-ch2-04', source: { file: '02-cs/02-tsp/chapter.tex', set: 'Chapter 2 Practice', q: 4, repaired: true } },
];
const finding = (over) => ({ file: '05-algebra/04-ineq/chapter.tex', where: 'Chapter 4 Practice', q: 7, keyed: 'B', verdict: 'wrong_key', severity: 'hold', suggested: 'C', reason: 'Made up.', ...over });

describe('findings -> items', () => {
  const index = sourceIndex(items);

  test('a file with one set: file and question number are enough', () => {
    expect(matchFinding(finding(), index)).toEqual({ item: 'alg-ch4-07', repaired: false });
    expect(matchFinding(finding({ where: 'anything at all' }), index).item).toBe('alg-ch4-07');
    expect(matchFinding(finding({ file: './05-algebra/04-ineq/chapter.tex' }), index).item).toBe('alg-ch4-07');
  });

  test('a file with several sets: the label picks the set', () => {
    expect(matchFinding(finding({ file: '08-geo/practice-tests/tests.tex', where: 'Practice Test 4', q: 3 }), index).item).toBe('geo-t4-03');
    expect(matchFinding(finding({ file: '08-geo/practice-tests/tests.tex', where: 'Practice Test 3 — Geometry & Trig', q: 3 }), index).item).toBe('geo-t3-03');
    expect(matchFinding(finding({ file: '08-geo/practice-tests/tests.tex', where: 'Test set', q: 3 }), index).why).toMatch(/does not pick one/);
  });

  test('unknown files and questions are not matched', () => {
    expect(matchFinding(finding({ file: 'nope.tex' }), index).why).toMatch(/no converted item/);
    expect(matchFinding(finding({ q: 99 }), index).why).toMatch(/no question 99/);
  });

  test('mapFindings lists holds and unmatched findings, and marks repaired items', () => {
    const out = mapFindings([
      { name: 'a.json', data: { group: 'a', findings: [finding(), finding({ severity: 'fix', q: 7 }), finding({ file: '02-cs/02-tsp/chapter.tex', q: 4 })] } },
      { name: 'b.json', data: { group: 'b', findings: [finding({ file: 'x.tex', severity: 'note' }), finding({ file: '09-cumulative-master/practice-tests/exam-01-rw2.tex', where: 'Test 1 R&W Module 2', q: 16 })] } },
    ], items);
    expect(out.holds.map((h) => [h.item, h.severity, h.repaired ?? false])).toEqual([
      ['alg-ch4-07', 'hold', false], ['alg-ch4-07', 'fix', false], ['cs-ch2-04', 'hold', true], ['full-01-rw2-16', 'hold', false],
    ]);
    expect(out.holds[0]).toMatchObject({ verdict: 'wrong_key', suggested: 'C', reason: 'Made up.', group: 'a' });
    expect(out.unmatched).toEqual([expect.objectContaining({ file: 'x.tex', why: expect.any(String) })]);
    expect(out.summary).toMatchObject({ hold: 3, fix: 1, note: 0, repaired: 1, unmatched: 1, items_held: 2 });
  });
});

describe('override matching', () => {
  test('labels compare loosely: dashes, spaces, case, \\&', () => {
    expect(normLabel('Practice Test 3 --- Geometry \\& Trig')).toBe(normLabel('practice test 3 —  geometry & trig'));
    expect(labelMatches('Practice Test 2', 'Practice Test 2 --- Algebra')).toBe(true);
    expect(labelMatches('Practice Test 2', 'Practice Test 3 --- Algebra')).toBe(false);
  });

  test('entries match on file and question, on label only when the file has several sets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sat-ov-'));
    writeFileSync(join(dir, 'a.json'), JSON.stringify([
      { file: '08-geo/practice-tests/tests.tex', set_label: 'Practice Test 4 — Geometry & Trig', q: 3, item_tex: '\\item x', key_tex: null, reason: 'r' },
      { file: '05-algebra/04-ineq/chapter.tex', set_label: 'Chapter 4', q: 7, item_tex: null, key_tex: null, difficulty: 'hard', reason: 'r' },
      { file: 'bad', q: 'x' },
    ]));
    writeFileSync(join(dir, 'b.json'), 'not json');
    const stats = { files: 0, entries: 0, errors: [] };
    const ov = loadOverrides(dir, stats);
    expect(stats).toMatchObject({ files: 2, entries: 2 });
    expect(stats.errors).toHaveLength(2);
    expect(ov.take('08-geo/practice-tests/tests.tex', 'Practice Test 3 --- Geometry \\& Trig', 3, { multi: true })).toEqual([]);
    expect(ov.take('08-geo/practice-tests/tests.tex', 'Practice Test 4 --- Geometry \\& Trig', 3, { multi: true })).toHaveLength(1);
    expect(ov.take('05-algebra/04-ineq/chapter.tex', 'Chapter 4 Practice --- Inequalities', 7)[0].difficulty).toBe('hard');
    expect(ov.unused()).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
