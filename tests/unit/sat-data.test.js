import { test, expect, beforeAll, vi } from 'vitest';

// sat-data.js reaches the Supabase client at import time: stand in for it
const calls = [];
let data;
beforeAll(async () => {
  const builder = (table) => {
    const q = {
      table, filters: [],
      select() { return q; }, eq(...a) { q.filters.push(['eq', ...a]); return q; }, or(f) { q.filters.push(['or', f]); return q; },
      order() { return q; }, range() { calls.push(['from', table, q.filters]); return Promise.resolve({ data: [], error: null }); },
    };
    return q;
  };
  globalThis.window = {
    supabase: {
      createClient: () => ({
        from: builder,
        rpc: vi.fn(async (name, args) => { calls.push(['rpc', name, args]); return { data: name === 'sat_item_index' ? [{ id: 'a', set_id: 's', held: false, difficulty: 'easy' }] : 0, error: null }; }),
        storage: { from: () => ({}) },
      }),
    },
  };
  data = await import('../../portal/js/sat-data.js');
});

test('the item index comes from sat_item_index (no question text), not the items table', async () => {
  const content = await data.getContent();
  expect(calls.some((c) => c[0] === 'rpc' && c[1] === 'sat_item_index')).toBe(true);
  expect(calls.some((c) => c[0] === 'from' && c[1] === 'sat_items')).toBe(false);
  expect(content.counts.get('s').easy).toBe(1);
});

test('a module key is checked before it goes into a filter', async () => {
  await expect(data.getItems('full-01', 'rw1),id.neq.x')).rejects.toThrow(/bad module/);
  await expect(data.getItems('full-01', 'RW1')).rejects.toThrow(/bad module/);
  await data.getItems('full-01', 'rw1');
  expect(calls.find((c) => c[1] === 'sat_items')[2]).toContainEqual(['or', 'module.eq.rw1,module.is.null']);
});

test('attempts are read after abandoned modules are settled', async () => {
  await data.getAttempts('s1');
  const at = calls.findIndex((c) => c[1] === 'sat_settle');
  expect(calls[at][2]).toEqual({ p_student: 's1' });
  expect(calls.findIndex((c) => c[1] === 'sat_attempts')).toBeGreaterThan(at);
});
