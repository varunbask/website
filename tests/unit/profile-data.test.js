import { describe, test, expect, vi, beforeEach } from 'vitest';

// A stand-in Supabase client: records every call and answers from a queue
const calls = [];
let results = [];
vi.mock('../../portal/js/supabase.js', () => ({
  sb: {
    rpc: async (name, args) => {
      calls.push({ rpc: name, args });
      return results.shift() ?? { data: [], error: null };
    },
    from: (table) => {
      const call = { table, op: null, payload: null, filter: null };
      calls.push(call);
      const builder = {
        update(payload) { call.op = 'update'; call.payload = payload; return builder; },
        insert(payload) { call.op = 'insert'; call.payload = payload; return builder; },
        upsert(payload) { call.op = 'upsert'; call.payload = payload; return builder; },
        select() { call.op ??= 'select'; return builder; },
        eq(column, value) { call.filter = [column, value]; return builder; },
        maybeSingle() { return builder; },
        then(resolve, reject) { return Promise.resolve(results.shift() ?? { data: [], error: null }).then(resolve, reject); },
      };
      return builder;
    },
  },
}));
const { saveStudentFields, saveStaffFields } = await import('../../portal/js/profile-data.js');

beforeEach(() => {
  calls.length = 0;
  results = [];
});

describe('saving the family fields', () => {
  const opened = { grade_level: '9th grade', school: 'Arcadia High', pronouns: null, interests: 'Soccer', favorite_subjects: null, goals: 'A in algebra', learning_style: null };

  test('fields this person did not change are sent as they are now, so another person\'s edit stands', async () => {
    const now = { ...opened, goals: 'Ready for the SAT' };   // a tutor changed the goals meanwhile
    results = [{ data: [now], error: null }, { data: [{ ...now, school: 'Pasadena High' }], error: null }];
    await saveStudentFields('s1', { ...opened, school: 'Pasadena High' }, { row: opened });
    expect(calls[0]).toMatchObject({ rpc: 'family_profile', args: { p_student: 's1' } });
    expect(calls[1].rpc).toBe('save_student_profile');
    expect(calls[1].args).toEqual({
      p_student: 's1', p_grade_level: '9th grade', p_school: 'Pasadena High', p_pronouns: null, p_interests: 'Soccer',
      p_favorite_subjects: null, p_goals: 'Ready for the SAT', p_learning_style: null,
    });
  });

  test('a field this person cleared is sent as null', async () => {
    results = [{ data: [opened], error: null }, { data: [opened], error: null }];
    await saveStudentFields('s1', { ...opened, interests: null }, { row: opened });
    expect(calls[1].args.p_interests).toBeNull();
  });

  test('a first save sends every field typed', async () => {
    results = [{ data: [], error: null }, { data: [opened], error: null }];
    await saveStudentFields('s1', opened, { row: null });
    expect(calls[1].args.p_goals).toBe('A in algebra');
    expect(calls[1].args.p_school).toBe('Arcadia High');
  });

  test('a refusal is thrown', async () => {
    results = [{ data: [opened], error: null }, { data: null, error: { code: '42501' } }];
    await expect(saveStudentFields('s1', opened, { row: opened })).rejects.toMatchObject({ code: '42501' });
  });
});

describe('saving a staff profile', () => {
  const row = { profile_id: 't1', bio: 'Hi', subjects: 'Algebra', education: null, interests: null, updated_at: 'x' };

  test('the first save inserts, never an upsert (profile_id has no update grant)', async () => {
    results = [{ data: [row], error: null }];
    await saveStaffFields('t1', { bio: 'Hi', subjects: 'Algebra', education: null, interests: null }, { row: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: 'staff_profiles', op: 'insert', payload: { profile_id: 't1', bio: 'Hi', subjects: 'Algebra', education: null, interests: null } });
  });

  test('later saves update only the fields that changed', async () => {
    results = [{ data: [{ ...row, subjects: 'Geometry' }], error: null }];
    const out = await saveStaffFields('t1', { bio: 'Hi', subjects: 'Geometry', education: null, interests: null }, { row });
    expect(calls[0]).toMatchObject({ op: 'update', payload: { subjects: 'Geometry' }, filter: ['profile_id', 't1'] });
    expect(Object.keys(calls[0].payload)).toEqual(['subjects']);
    expect(out.subjects).toBe('Geometry');
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  test('nothing changed sends nothing', async () => {
    const out = await saveStaffFields('t1', { bio: 'Hi', subjects: 'Algebra', education: null, interests: null }, { row });
    expect(calls).toHaveLength(0);
    expect(out).toBe(row);
  });

  test('a row made meanwhile in another tab (23505): the insert becomes an update', async () => {
    results = [{ data: null, error: { code: '23505' } }, { data: [row], error: null }];
    await saveStaffFields('t1', { bio: 'Hi', subjects: 'Algebra', education: null, interests: null }, { row: null });
    expect(calls.map((c) => c.op)).toEqual(['insert', 'update']);
    expect(calls[1].payload).toEqual({ bio: 'Hi', subjects: 'Algebra' });
  });

  test('a row gone meanwhile: the update becomes an insert', async () => {
    results = [{ data: [], error: null }, { data: [row], error: null }];
    await saveStaffFields('t1', { bio: 'Hello', subjects: 'Algebra', education: null, interests: null }, { row });
    expect(calls.map((c) => c.op)).toEqual(['update', 'insert']);
  });
});
