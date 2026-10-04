import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { buildWorld, hasService } from './world.js';

// Needs supabase/migrations/20261004120000_rich_answers.sql applied to the
// project the .env points at. Tests run in file order; later ones build on earlier ones.

const DOC = { v: 1, blocks: [{ t: 'p', c: [{ x: 'My answer' }] }] };

describe.skipIf(!hasService)('answer drafts and formatted answers', () => {
  let w;
  let P;
  let assignment; // a fresh assignment of studentA's

  beforeAll(async () => {
    w = await buildWorld();
    P = w.people;
    const made = await w.admin.from('tasks')
      .insert({ student_id: P.studentA.id, created_by: P.tutorA.id, kind: 'assignment', title: 'Draft check' })
      .select('id').single();
    if (made.error) throw new Error(made.error.message);
    assignment = made.data.id;
  });

  afterAll(async () => {
    await w?.cleanup();
  });

  const save = (client, taskId, body = 'My answer') => client.from('submission_drafts')
    .upsert({ task_id: taskId, body_doc: DOC, body }, { onConflict: 'student_id,task_id' });

  test('a student saves and updates a draft of their own assignment', async () => {
    expect((await save(P.studentA.client, assignment)).error).toBeNull();
    expect((await save(P.studentA.client, assignment, 'My answer, longer')).error).toBeNull();
    const { data } = await P.studentA.client.from('submission_drafts').select('task_id, body').eq('task_id', assignment);
    expect(data).toEqual([{ task_id: assignment, body: 'My answer, longer' }]);
  });

  test('a draft stays with its assignment, and only assignments take drafts', async () => {
    const other = await w.admin.from('tasks')
      .insert({ student_id: P.studentA.id, created_by: P.tutorA.id, kind: 'assignment', title: 'Other draft check' })
      .select('id').single();
    const moved = await P.studentA.client.from('submission_drafts').update({ task_id: other.data.id }).eq('task_id', assignment).select('task_id');
    expect(moved.error).not.toBeNull();
    const chore = await w.admin.from('tasks')
      .insert({ student_id: P.studentA.id, created_by: P.tutorA.id, kind: 'task', title: 'Chore' })
      .select('id').single();
    expect((await save(P.studentA.client, chore.data.id)).error?.code).toBe('42501');
  });

  test('nobody else reads or writes it', async () => {
    for (const who of ['tutorA', 'parentA', 'studentB', 'admin']) {
      const seen = await P[who].client.from('submission_drafts').select('task_id').eq('task_id', assignment);
      expect(seen.data ?? [], who).toEqual([]);
    }
    expect((await save(P.studentB.client, assignment)).error?.code).toBe('42501');
    expect((await save(P.tutorA.client, assignment)).error?.code).toBe('42501');
  });

  test('a formatted answer needs its plain text; submitting removes the draft', async () => {
    const docOnly = await P.studentA.client.from('submissions').insert({ task_id: assignment, body_doc: DOC });
    expect(docOnly.error).not.toBeNull();
    const sent = await P.studentA.client.from('submissions')
      .insert({ task_id: assignment, body: 'My answer, longer', body_doc: DOC }).select('id').single();
    expect(sent.error).toBeNull();
    const left = await w.admin.from('submission_drafts').select('task_id').eq('task_id', assignment);
    expect(left.data).toEqual([]);
    const tutor = await P.tutorA.client.from('submissions').select('body, body_doc').eq('id', sent.data.id).single();
    expect(tutor.data).toEqual({ body: 'My answer, longer', body_doc: DOC });
  });
});
