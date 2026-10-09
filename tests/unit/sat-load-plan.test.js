import { describe, test, expect } from 'vitest';
import { join } from 'node:path';
import { parseEnvFile, chunks, planItems, setRows, fileRows, guideRows, uploads, stale } from '../../tools/sat/lib/load-plan.mjs';

// Made-up bundle pieces
const item = (id, extra = {}) => ({ id, set: 'alg-ch1', module: null, position: 1, domain: 'algebra', skill: null, difficulty: 'easy', kind: 'mc', passage: null, stem: { v: 1, blocks: [] }, choices: [], source: { file: 'f.tex', q: 1 }, ...extra });
const key = (id, answer = 'A') => ({ item: id, answer, accept: [], explanation: { v: 1, blocks: [] } });
const holds = { holds: [
  { item: 'a', severity: 'hold', verdict: 'wrong_key', reason: 'Key is C.', suggested: 'C' },
  { item: 'a', severity: 'note', verdict: 'explanation_wrong', reason: 'Typo.' },
  { item: 'b', severity: 'fix', verdict: 'grid_in_format', reason: 'Add .6667.' },
  { item: 'r', severity: 'hold', verdict: 'two_correct', reason: 'B also works.' },
] };

describe('env file', () => {
  test('reads only the two Supabase keys', () => {
    const env = parseEnvFile('# comment\nSUPABASE_URL="https://x.example"\nexport SUPABASE_SERVICE_ROLE_KEY=abc # note\nOTHER_SECRET=zzz\n');
    expect(env).toEqual({ SUPABASE_URL: 'https://x.example', SUPABASE_SERVICE_ROLE_KEY: 'abc' });
  });
});

describe('item rows', () => {
  const items = [item('a'), item('b'), item('c'), item('r', { source: { file: 'f.tex', q: 4, repaired: true } })];
  const keys = items.map((i) => key(i.id));

  test('holds hold; fixes and notes become review notes; repaired items are never held', () => {
    const { itemRows } = planItems({ items, keys, holds });
    const row = new Map(itemRows.map((r) => [r.id, r]));
    expect(row.get('a')).toMatchObject({ held: true, hold_reason: 'wrong_key: Key is C. (suggested: C)', review_note: 'note, explanation_wrong: Typo.' });
    expect(row.get('b')).toMatchObject({ held: false, hold_reason: null, review_note: 'fix, grid_in_format: Add .6667.' });
    expect(row.get('c')).toMatchObject({ held: false, hold_reason: null, review_note: null });
    expect(row.get('r')).toMatchObject({ held: false, hold_reason: null });
    expect(row.get('r').review_note).toMatch(/^repaired after these findings\nhold, two_correct/);
    expect(row.get('a')).toMatchObject({ set_id: 'alg-ch1', stem: { v: 1, blocks: [] }, source: { file: 'f.tex', q: 1 } });
  });

  test('a question the admin released stays released, unless rehold', () => {
    const existing = new Map([['a', { held: false, answer: 'A' }]]);
    const last = { held: ['a'], released: [], answers: { a: 'A' } };
    const kept = planItems({ items, keys, holds, existing, last });
    expect(kept.itemRows.find((r) => r.id === 'a').held).toBe(false);
    expect(kept.released).toEqual(['a']);
    expect(kept.state.released).toEqual(['a']);
    // and on the next load too
    const next = planItems({ items, keys, holds, existing, last: kept.state });
    expect(next.itemRows.find((r) => r.id === 'a').held).toBe(false);
    const again = planItems({ items, keys, holds, existing, last, rehold: true });
    expect(again.itemRows.find((r) => r.id === 'a').held).toBe(true);
  });

  test('a new finding holds a question that was never held', () => {
    const existing = new Map([['a', { held: false, answer: 'A' }]]);
    const { itemRows } = planItems({ items, keys, holds, existing, last: { held: [], released: [], answers: {} } });
    expect(itemRows.find((r) => r.id === 'a').held).toBe(true);
  });

  test('an answer the admin set is kept until our own key changes', () => {
    const existing = new Map([['c', { held: false, answer: 'D', accept: [] }]]);
    const last = { held: [], released: [], answers: { c: 'A' } };
    const same = planItems({ items, keys, holds, existing, last });
    expect(same.keyRows.find((k) => k.item_id === 'c').answer).toBe('D');
    expect(same.keptAnswers).toEqual(['c']);
    expect(same.state.answers.c).toBe('A');
    const changed = planItems({ items, keys: keys.map((k) => (k.item === 'c' ? key('c', 'B') : k)), holds, existing, last });
    expect(changed.keyRows.find((k) => k.item_id === 'c').answer).toBe('B');
  });
});

describe('other rows and uploads', () => {
  const content = {
    sets: [{ id: 'alg-ch1', kind: 'practice', domain: 'algebra', skill: 'alg-x', title: 'X', position: 1, modules: [], origin: 'vp' }],
    files: [{ id: 'f1', collection: 'lesson', domain: 'algebra', skill: null, difficulty: null, title: 'L', local: '/tmp/l.pdf', path: 'lessons/alg-ch1.pdf', bytes: 10, pages: 2, staff_only: false, position: 1 }],
    guides: [{ skill: 'alg-x', domain: 'algebra', title: 'G', position: 1, body: { v: 1, blocks: [{ t: 'img', src: 'figures/g.png', w: 1, h: 1, alt: '' }] } }],
    items: [item('a', { stem: { v: 1, blocks: [{ t: 'passage', label: null, blocks: [{ t: 'img', src: 'figures/a.png', w: 1, h: 1, alt: '' }] }] } })],
    keys: [{ item: 'a', answer: 'A', accept: [], explanation: { v: 1, blocks: [{ t: 'img', src: 'figures/a.png', w: 1, h: 1, alt: '' }] } }],
  };

  test('rows carry the spec columns', () => {
    expect(setRows(content)[0]).toEqual({ id: 'alg-ch1', kind: 'practice', domain: 'algebra', skill: 'alg-x', title: 'X', position: 1, modules: [], origin: 'vp' });
    expect(fileRows(content)[0]).toEqual({ id: 'f1', collection: 'lesson', domain: 'algebra', skill: null, difficulty: null, title: 'L', storage_path: 'lessons/alg-ch1.pdf', bytes: 10, pages: 2, staff_only: false, position: 1 });
    expect(guideRows(content)[0]).toMatchObject({ skill: 'alg-x', domain: 'algebra', title: 'G', position: 1 });
  });

  test('every PDF and every figure the docs point at is uploaded once', () => {
    expect(uploads(content, '/out', join)).toEqual([
      { local: '/tmp/l.pdf', path: 'lessons/alg-ch1.pdf', type: 'application/pdf' },
      { local: '/out/figures/a.png', path: 'figures/a.png', type: 'image/png' },
      { local: '/out/figures/g.png', path: 'figures/g.png', type: 'image/png' },
    ]);
  });

  test('batches and stale ids', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks(Array.from({ length: 450 }), undefined).map((c) => c.length)).toEqual([200, 200, 50]);
    expect(stale(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });
});
