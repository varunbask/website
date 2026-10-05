import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { buildWorld, hasService } from './world.js';

// Needs supabase/migrations/20261005120000_task_series.sql applied to the
// project the .env points at. Tests run in file order; later ones build on earlier ones.

describe.skipIf(!hasService)('repeating tasks and assignments', () => {
  let w;
  let P;
  const series = crypto.randomUUID();
  let ids = [];

  beforeAll(async () => {
    w = await buildWorld();
    P = w.people;
  });

  afterAll(async () => {
    await w?.cleanup();
  });

  const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

  test('a tutor creates every copy in one insert', async () => {
    const rows = [1, 8, 15].map((n) => ({
      student_id: P.studentA.id, kind: 'assignment', title: 'Weekly log', due_at: day(n), series_id: series,
    }));
    const { data, error } = await P.tutorA.client.from('tasks').insert(rows).select('id, series_id');
    expect(error).toBeNull();
    expect(data).toHaveLength(3);
    expect(data.every((t) => t.series_id === series)).toBe(true);
    ids = data.map((t) => t.id);
  });

  test('only staff who teach the student create copies', async () => {
    for (const who of ['studentA', 'parentA', 'tutorB']) {
      const { error } = await P[who].client.from('tasks')
        .insert({ student_id: P.studentA.id, kind: 'task', title: 'X', series_id: series });
      expect(error, who).not.toBeNull();
    }
  });

  test('the series id never changes', async () => {
    const { error } = await P.tutorA.client.from('tasks').update({ series_id: crypto.randomUUID() }).eq('id', ids[0]);
    expect(error?.code).toBe('42501');
  });

  test('the family sees the copies, nobody else does', async () => {
    for (const who of ['studentA', 'parentA']) {
      const { data } = await P[who].client.from('tasks').select('id').eq('series_id', series);
      expect(data, who).toHaveLength(3);
    }
    for (const who of ['studentB', 'tutorB']) {
      const { data } = await P[who].client.from('tasks').select('id').eq('series_id', series);
      expect(data ?? [], who).toEqual([]);
    }
  });

  test('this and following: edit and delete the later copies together', async () => {
    const later = ids.slice(1);
    const edit = await P.tutorA.client.from('tasks').update({ title: 'Reading log' }).in('id', later).select('id');
    expect(edit.error).toBeNull();
    expect(edit.data).toHaveLength(2);
    const del = await P.tutorA.client.from('tasks').delete().in('id', later).select('id');
    expect(del.error).toBeNull();
    expect(del.data).toHaveLength(2);
    const { data } = await w.admin.from('tasks').select('id, title').eq('series_id', series);
    expect(data).toEqual([{ id: ids[0], title: 'Weekly log' }]);
  });
});
