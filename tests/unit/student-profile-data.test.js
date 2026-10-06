import { describe, test, expect, vi, beforeEach } from 'vitest';

// A stand-in for the Supabase client that records every write to student_profiles
// and answers from a queue of results, one per call
const calls = [];
let results = [];
vi.mock('../../portal/js/supabase.js', () => ({
  sb: {
    from: (table) => {
      const call = { table, op: null, payload: null, filter: null };
      calls.push(call);
      const builder = {
        update(payload) { call.op = 'update'; call.payload = payload; return builder; },
        insert(payload) { call.op = 'insert'; call.payload = payload; return builder; },
        select() { return builder; },
        eq(column, value) { call.filter = [column, value]; return builder; },
        maybeSingle() { call.op = 'select'; return builder; },
        then(resolve, reject) { return Promise.resolve(results.shift() ?? { data: [], error: null }).then(resolve, reject); },
      };
      return builder;
    },
  },
}));
const { saveProfile } = await import('../../portal/js/student-profile-data.js');

const ID = 'student-1';
const row = { student_id: ID, grade_level: '9th grade', school: 'Arcadia High School', goals: 'Raise it', learning_notes: 'Needs breaks', updated_by: 't1', updated_at: '2026-10-14T20:00:00Z' };
const form = (over = {}) => ({ grade_level: '9th grade', school: 'Arcadia High School', goals: 'Raise it', learning_notes: 'Needs breaks', ...over });
const saved = (over) => ({ data: [{ ...row, ...over }], error: null });

beforeEach(() => {
  calls.length = 0;
  results = [];
});

describe('saving the profile', () => {
  test('an edit sends only the fields that changed, so a colleague\'s untouched fields are never overwritten', async () => {
    results = [saved({ school: 'Pasadena High School' })];
    const out = await saveProfile(ID, form({ school: 'Pasadena High School' }), { row });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: 'student_profiles', op: 'update', payload: { school: 'Pasadena High School' }, filter: ['student_id', ID] });
    expect(Object.keys(calls[0].payload)).toEqual(['school']);
    expect(out.school).toBe('Pasadena High School');
  });

  test('a cleared field is sent as null, and nothing else', async () => {
    results = [saved({ goals: null })];
    await saveProfile(ID, form({ goals: null }), { row });
    expect(calls[0].payload).toEqual({ goals: null });
  });

  test('nothing changed sends nothing and returns the row', async () => {
    const out = await saveProfile(ID, form(), { row });
    expect(calls).toHaveLength(0);
    expect(out).toBe(row);
  });

  test('with no row the full set is inserted', async () => {
    results = [saved({})];
    await saveProfile(ID, form({ goals: null }), { row: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ op: 'insert', payload: { student_id: ID, grade_level: '9th grade', school: 'Arcadia High School', goals: null, learning_notes: 'Needs breaks' } });
  });

  test('a colleague inserted first (23505): only the changed fields are updated', async () => {
    results = [{ data: null, error: { code: '23505' } }, saved({})];
    await saveProfile(ID, form({ goals: null, learning_notes: null }), { row: null });
    expect(calls.map((c) => c.op)).toEqual(['insert', 'update']);
    expect(calls[1].payload).toEqual({ grade_level: '9th grade', school: 'Arcadia High School' });
    expect(calls[1].filter).toEqual(['student_id', ID]);
  });

  test('the row vanished since it was read: the full set is inserted', async () => {
    results = [{ data: [], error: null }, saved({})];
    await saveProfile(ID, form({ school: 'Pasadena High School' }), { row });
    expect(calls.map((c) => c.op)).toEqual(['update', 'insert']);
    expect(calls[0].payload).toEqual({ school: 'Pasadena High School' });
    expect(calls[1].payload).toEqual({ student_id: ID, ...form({ school: 'Pasadena High School' }) });
  });

  test('another failure is thrown, and an update that matches no row after the insert fallback is an error', async () => {
    results = [{ data: null, error: { code: '42501', message: 'denied' } }];
    await expect(saveProfile(ID, form({ school: 'X' }), { row })).rejects.toMatchObject({ code: '42501' });
    results = [{ data: [], error: null }, { data: [], error: null }];
    await expect(saveProfile(ID, form({ school: 'X' }), { row })).rejects.toThrow('The profile was not saved.');
  });
});
