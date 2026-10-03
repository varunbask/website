import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildWorld, hasService, anonClient, txt } from './world.js';

const TABLES = ['profiles', 'tutor_students', 'parent_students', 'tasks', 'submissions', 'grades', 'updates'];
const idSet = (rows) => new Set((rows ?? []).map((r) => String(r.id)));
const asSet = (...values) => new Set(values.map(String));
const rows = (embedded) => [].concat(embedded ?? []);

// Tests run in file order; later ones build on earlier ones.
describe.skipIf(!hasService)('portal row-level security', () => {
  let w;
  let P;

  beforeAll(async () => {
    w = await buildWorld();
    P = w.people;
  });

  afterAll(async () => {
    await w?.cleanup();
  });

  test('a new account starts pending and ignores role hints in its metadata', async () => {
    const { data } = await w.admin.from('profiles')
      .select('role, requested_role, full_name').eq('id', P.pending.id).single();
    expect(data).toEqual({ role: 'pending', requested_role: null, full_name: 'Test pending' });
  });

  test('an anonymous visitor reads nothing', async () => {
    const c = anonClient();
    for (const table of TABLES) {
      const { data, error } = await c.from(table).select('*');
      expect(error?.code, table).toBe('42501');
      expect(data, table).toBeNull();
    }
  });

  test('a pending user sees only their own profile', async () => {
    const c = P.pending.client;
    const { data: profiles } = await c.from('profiles').select('id');
    expect(idSet(profiles)).toEqual(asSet(P.pending.id));
    for (const table of TABLES.filter((t) => t !== 'profiles')) {
      const { data, error } = await c.from(table).select('*');
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
  });

  test('a pending user cannot create tasks, upload, or tick tasks', async () => {
    const c = P.pending.client;
    expect((await c.from('tasks').insert({ student_id: P.studentA.id, kind: 'task', title: 'x' })).error).not.toBeNull();
    const upload = await c.storage.from('homework')
      .upload(`${P.pending.id}/${randomUUID()}.txt`, txt('hi'), { contentType: 'text/plain' });
    expect(upload.error).not.toBeNull();
    expect((await c.rpc('set_task_done', { p_task_id: w.seed.T1, p_done: true })).error).not.toBeNull();
  });

  test('a student sees their own tasks and only the updates shared with them', async () => {
    const c = P.studentA.client;
    const { data: tasks } = await c.from('tasks').select('id');
    expect(idSet(tasks)).toEqual(asSet(w.seed.A1, w.seed.T1));
    const { data: updates } = await c.from('updates').select('id');
    expect(idSet(updates)).toEqual(asSet(w.seed.U2));
    const { data: profiles } = await c.from('profiles').select('id');
    expect(idSet(profiles)).toEqual(asSet(P.studentA.id));
  });

  test('a student cannot create or rewrite tasks', async () => {
    const c = P.studentA.client;
    expect((await c.from('tasks').insert({ student_id: P.studentA.id, kind: 'task', title: 'mine' })).error).not.toBeNull();
    const renamed = await c.from('tasks').update({ title: 'changed' }).eq('id', w.seed.T1).select();
    expect(renamed.data ?? []).toEqual([]);
    const { data } = await w.admin.from('tasks').select('title').eq('id', w.seed.T1).single();
    expect(data.title).toBe('Seed task');
  });

  test('a student ticks their own task through set_task_done, and nothing else', async () => {
    const c = P.studentA.client;
    expect((await c.rpc('set_task_done', { p_task_id: w.seed.T1, p_done: true })).error).toBeNull();
    const { data: done } = await w.admin.from('tasks').select('completed_at').eq('id', w.seed.T1).single();
    expect(done.completed_at).not.toBeNull();
    expect((await c.rpc('set_task_done', { p_task_id: w.seed.T1, p_done: false })).error).toBeNull();
    const { data: undone } = await w.admin.from('tasks').select('completed_at').eq('id', w.seed.T1).single();
    expect(undone.completed_at).toBeNull();
    expect((await c.rpc('set_task_done', { p_task_id: w.seed.A1, p_done: true })).error).not.toBeNull();
    expect((await c.rpc('set_task_done', { p_task_id: w.seed.B1, p_done: true })).error).not.toBeNull();
  });

  test('a student uploads only into their own folder and cannot overwrite', async () => {
    const bucket = P.studentA.client.storage.from('homework');
    const own = `${P.studentA.id}/${randomUUID()}.txt`;
    expect((await bucket.upload(own, txt('first'), { contentType: 'text/plain' })).error).toBeNull();
    expect((await bucket.upload(own, txt('again'), { contentType: 'text/plain', upsert: true })).error).not.toBeNull();
    expect((await bucket.upload(`${P.studentB.id}/${randomUUID()}.txt`, txt('x'), { contentType: 'text/plain' })).error).not.toBeNull();
    expect((await bucket.upload(`${P.studentA.id}/${randomUUID()}.exe`, txt('x'), { contentType: 'application/x-msdownload' })).error).not.toBeNull();
  });

  test('a student submits only their own uploaded file, against their own assignment, at most five times', async () => {
    const c = P.studentA.client;
    const bucket = c.storage.from('homework');
    const upload = async (text) => {
      const path = `${P.studentA.id}/${randomUUID()}.txt`;
      expect((await bucket.upload(path, txt(text), { contentType: 'text/plain' })).error).toBeNull();
      return path;
    };
    const path = await upload('answer');
    const base = { task_id: w.seed.A1, storage_path: path, file_type: 'text/plain' };

    expect((await c.from('submissions').insert({ ...base, student_id: P.studentA.id })).error).not.toBeNull();
    expect((await c.from('submissions').insert({ ...base, status: 'ai_graded' })).error).not.toBeNull();
    expect((await c.from('submissions').insert({ ...base, task_id: w.seed.B1 })).error).not.toBeNull();
    expect((await c.from('submissions').insert({ ...base, storage_path: `${P.studentA.id}/${randomUUID()}.txt` })).error).not.toBeNull();
    expect((await c.from('submissions').insert({ ...base, storage_path: w.seed.bFile })).error).not.toBeNull();

    const ok = await c.from('submissions').insert(base).select('id, status, student_id').single();
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ status: 'pending', student_id: P.studentA.id });

    // the seeded submission plus this one make two; three more reach the cap of five
    for (let i = 0; i < 3; i++) {
      expect((await c.from('submissions').insert({ ...base, storage_path: await upload(`try ${i}`) })).error).toBeNull();
    }
    expect((await c.from('submissions').insert({ ...base, storage_path: await upload('sixth') })).error).not.toBeNull();

    // students never change or remove submissions
    expect((await c.from('submissions').update({ note: 'x' }).eq('id', ok.data.id)).error).not.toBeNull();
    expect((await c.from('submissions').delete().eq('id', ok.data.id)).error).not.toBeNull();
  });

  test('a typed answer needs no file; a blank or empty submission is refused', async () => {
    const c = P.studentA.client;
    const task = await w.admin.from('tasks')
      .insert({ student_id: P.studentA.id, kind: 'assignment', title: 'Typed answer check' }).select('id').single();
    expect(task.error).toBeNull();
    const id = task.data.id;

    const typed = await c.from('submissions').insert({ task_id: id, body: 'x = 4 because 2x = 8' })
      .select('id, status, storage_path, file_type').single();
    expect(typed.error).toBeNull();
    expect(typed.data).toMatchObject({ status: 'pending', storage_path: null, file_type: null });

    expect((await c.from('submissions').insert({ task_id: id })).error).not.toBeNull();
    expect((await c.from('submissions').insert({ task_id: id, body: '   ' })).error).not.toBeNull();
    expect((await c.from('submissions').insert({ task_id: id, body: 'x', storage_path: `${P.studentA.id}/${randomUUID()}.pdf` })).error).not.toBeNull();
    expect((await c.from('submissions').insert({ task_id: id, body: 'x', storage_path: `${P.studentA.id}/${randomUUID()}.pdf`, file_type: 'application/pdf' })).error).not.toBeNull();
    expect((await P.parentA.client.from('submissions').insert({ task_id: id, body: 'from a parent' })).error).not.toBeNull();
  });

  test('an unreleased grade is invisible to the student and parent, even through embeds', async () => {
    await w.admin.from('grades').update({ score: 88, feedback: 'Draft' }).eq('submission_id', w.seed.SA1);
    for (const who of ['studentA', 'parentA']) {
      const c = P[who].client;
      const { data: direct } = await c.from('grades').select('*').eq('submission_id', w.seed.SA1);
      expect(direct, who).toEqual([]);
      const { data: sub } = await c.from('submissions').select('id, grade:grades(score, feedback)').eq('id', w.seed.SA1).single();
      expect(rows(sub.grade), who).toEqual([]);
    }
    const { data: draft } = await P.tutorA.client.from('grades').select('score').eq('submission_id', w.seed.SA1).single();
    expect(Number(draft.score)).toBe(88);
  });

  test('a tutor releases a grade; then the family sees it and the reviewer is stamped', async () => {
    const c = P.tutorA.client;
    const released = await c.from('grades')
      .update({ score: 91, feedback: 'Nice work', released_at: new Date().toISOString() })
      .eq('submission_id', w.seed.SA1).select('submission_id');
    expect(released.error).toBeNull();
    expect(released.data).toHaveLength(1);
    const { data: stamp } = await w.admin.from('grades').select('reviewed_by, reviewed_at').eq('submission_id', w.seed.SA1).single();
    expect(stamp.reviewed_by).toBe(P.tutorA.id);
    expect(stamp.reviewed_at).not.toBeNull();
    for (const who of ['studentA', 'parentA']) {
      const { data } = await P[who].client.from('grades').select('score, feedback').eq('submission_id', w.seed.SA1).single();
      expect(Number(data.score), who).toBe(91);
      expect(data.feedback, who).toBe('Nice work');
    }
    expect((await c.from('grades').insert({ submission_id: w.seed.SA1, student_id: P.studentA.id, score: 1 })).error).not.toBeNull();
    expect((await c.from('grades').update({ student_id: P.studentB.id }).eq('submission_id', w.seed.SA1)).error).not.toBeNull();
  });

  test('an assigned tutor manages tasks and updates for their student', async () => {
    const c = P.tutorA.client;
    const created = await c.from('tasks')
      .insert({ student_id: P.studentA.id, kind: 'assignment', title: 'Tutor made', due_at: new Date(Date.now() + 86400000).toISOString() })
      .select('id, created_by').single();
    expect(created.error).toBeNull();
    expect(created.data.created_by).toBe(P.tutorA.id);
    expect((await c.from('tasks').update({ title: 'Renamed' }).eq('id', created.data.id).select()).data).toHaveLength(1);
    expect((await c.from('tasks').delete().eq('id', created.data.id).select()).data).toHaveLength(1);
    const posted = await c.from('updates').insert({ student_id: P.studentA.id, body: 'Progress note' }).select('id, author_id').single();
    expect(posted.error).toBeNull();
    expect(posted.data.author_id).toBe(P.tutorA.id);
  });

  test('a tutor not assigned to a student sees and changes nothing of theirs', async () => {
    const c = P.tutorB.client;
    expect((await c.from('profiles').select('id').eq('id', P.studentA.id)).data).toEqual([]);
    for (const table of ['tasks', 'submissions', 'grades', 'updates']) {
      const { data } = await c.from(table).select('student_id').eq('student_id', P.studentA.id);
      expect(data, table).toEqual([]);
    }
    expect((await c.from('tasks').insert({ student_id: P.studentA.id, kind: 'task', title: 'x' })).error).not.toBeNull();
    expect((await c.from('updates').insert({ student_id: P.studentA.id, body: 'x' })).error).not.toBeNull();
    expect((await c.from('tutor_students').insert({ tutor_id: P.tutorB.id, student_id: P.studentA.id })).error).not.toBeNull();
    expect((await c.storage.from('homework').createSignedUrl(w.seed.aFile, 60)).error).not.toBeNull();
  });

  test('a parent sees their child, not other children, and cannot act for them', async () => {
    const c = P.parentA.client;
    // every task of their child (earlier tests add some to the seed), and no one else's
    const childTasks = (await w.admin.from('tasks').select('id').eq('student_id', P.studentA.id)).data;
    const seen = idSet((await c.from('tasks').select('id')).data);
    expect(seen).toEqual(idSet(childTasks));
    expect(seen.has(String(w.seed.A1)) && seen.has(String(w.seed.T1))).toBe(true);
    const updates = (await c.from('updates').select('id')).data;
    expect(idSet(updates).has(String(w.seed.U1))).toBe(true);
    expect(idSet(updates).has(String(w.seed.U2))).toBe(true);
    expect(idSet(updates).has(String(w.seed.U3))).toBe(false);
    const subs = (await c.from('submissions').select('student_id')).data;
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.every((s) => s.student_id === P.studentA.id)).toBe(true);
    const bucket = c.storage.from('homework');
    expect((await bucket.createSignedUrl(w.seed.aFile, 60)).error).toBeNull();
    expect((await bucket.createSignedUrl(w.seed.bFile, 60)).error).not.toBeNull();
    expect((await bucket.upload(`${P.studentA.id}/${randomUUID()}.txt`, txt('x'), { contentType: 'text/plain' })).error).not.toBeNull();
    expect((await c.rpc('set_task_done', { p_task_id: w.seed.T1, p_done: true })).error).not.toBeNull();
    expect((await c.from('parent_students').insert({ parent_id: P.parentA.id, student_id: P.studentB.id })).error).not.toBeNull();
  });

  test('nobody but an admin changes roles, and an admin cannot demote themselves', async () => {
    for (const who of ['pending', 'studentA', 'parentA', 'tutorA']) {
      const { data } = await P[who].client.from('profiles').update({ role: 'admin' }).eq('id', P[who].id).select();
      expect(data ?? [], who).toEqual([]);
    }
    // user_metadata is user-editable and must never grant anything
    await P.studentA.client.auth.updateUser({ data: { role: 'admin', requested_role: 'admin' } });
    const { data: still } = await w.admin.from('profiles').select('role').eq('id', P.studentA.id).single();
    expect(still.role).toBe('student');
    expect((await P.studentA.client.from('tutor_students').insert({ tutor_id: P.tutorB.id, student_id: P.studentA.id })).error).not.toBeNull();

    const a = P.admin.client;
    const promoted = await a.from('profiles').update({ role: 'tutor' }).eq('id', P.pending.id).select('role').single();
    expect(promoted.error).toBeNull();
    expect(promoted.data.role).toBe('tutor');
    expect((await a.from('profiles').update({ role: 'student' }).eq('id', P.admin.id).select()).error).not.toBeNull();
    expect((await a.from('parent_students').insert({ parent_id: P.studentB.id, student_id: P.studentA.id })).error).not.toBeNull();
    expect((await a.from('tasks').select('id').eq('student_id', P.studentB.id)).data).toHaveLength(1);
  });

  test('helper functions are not callable over the API; staff_names returns names only', async () => {
    const c = P.studentA.client;
    expect((await c.rpc('my_role')).error).not.toBeNull();
    expect((await c.rpc('can_teach', { p_student: P.studentA.id })).error).not.toBeNull();
    // the helpers live in the private schema; reaching it must fail because it is not exposed (PGRST106)
    const hiddenRole = await c.schema('private').rpc('my_role');
    expect(hiddenRole.error?.code).toBe('PGRST106');
    expect(hiddenRole.data).toBeNull();
    const hiddenTeach = await c.schema('private').rpc('can_teach', { p_student: P.studentA.id });
    expect(hiddenTeach.error?.code).toBe('PGRST106');
    expect(hiddenTeach.data).toBeNull();
    const { data, error } = await c.rpc('staff_names');
    expect(error).toBeNull();
    expect(data.length).toBeGreaterThan(0);
    for (const row of data) expect(Object.keys(row).sort()).toEqual(['full_name', 'id']);
  });
});
