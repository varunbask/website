import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildWorld, hasService } from './world.js';

// Needs supabase/migrations/20261001200000_sessions.sql and
// 20261001200100_lesson_materials.sql applied to the project the .env points
// at. Tests run in file order; later ones build on earlier ones.

const HOUR = 3_600_000;
const slot = (hoursAhead) => {
  const start = new Date(Math.ceil(Date.now() / HOUR) * HOUR + hoursAhead * HOUR);
  return { starts_at: start.toISOString(), ends_at: new Date(start.getTime() + HOUR).toISOString() };
};
const pdf = Buffer.from('%PDF-1.4\n% test\n', 'utf8');

describe.skipIf(!hasService)('lesson materials row-level security', () => {
  let w;
  let P;
  let lesson;      // tutorA's session with studentA
  let otherLesson; // tutorA's session with studentB (not their student)
  let link;
  const files = [];

  beforeAll(async () => {
    w = await buildWorld();
    P = w.people;
    const add = await w.admin.from('tutor_students').insert({ tutor_id: P.tutorB.id, student_id: P.studentA.id, subject: 'SAT Reading' });
    if (add.error) throw new Error(add.error.message);
    lesson = (await P.tutorA.client.from('sessions').insert({ student_id: P.studentA.id, subject: 'Algebra', ...slot(24) }).select('id').single()).data.id;
    otherLesson = (await w.admin.from('sessions').insert({ student_id: P.studentB.id, tutor_id: P.tutorB.id, ...slot(24) }).select('id').single()).data.id;
  });

  afterAll(async () => {
    if (files.length) await w?.admin.storage.from('materials').remove(files);
    await w?.cleanup();
  });

  test('the session’s tutor adds a link; another tutor of the student cannot', async () => {
    const ok = await P.tutorA.client.from('materials')
      .insert({ student_id: P.studentA.id, session_id: lesson, title: 'Slides', url: 'https://docs.google.com/presentation/d/x' })
      .select('id').single();
    expect(ok.error).toBeNull();
    link = ok.data.id;
    const other = await P.tutorB.client.from('materials')
      .insert({ student_id: P.studentA.id, session_id: lesson, title: 'X', url: 'https://x.example' });
    expect(other.error?.code).toBe('42501');
  });

  test('students and parents cannot add or remove materials', async () => {
    for (const who of ['studentA', 'parentA']) {
      const c = P[who].client;
      expect((await c.from('materials').insert({ student_id: P.studentA.id, session_id: lesson, title: 'X', url: 'https://x.example' })).error, who).not.toBeNull();
      expect((await c.from('materials').delete().eq('id', link).select('id')).data ?? [], who).toEqual([]);
    }
  });

  test('the student, their parent and their tutors read materials; others do not', async () => {
    for (const who of ['studentA', 'parentA', 'tutorA', 'tutorB', 'admin']) {
      const { data } = await P[who].client.from('materials').select('id').eq('id', link);
      expect((data ?? []).map((r) => r.id), who).toEqual([link]);
    }
    for (const who of ['studentB', 'pending']) {
      const { data } = await P[who].client.from('materials').select('id');
      expect(data, who).toEqual([]);
    }
  });

  test('a material must belong to the session’s student, and a file to their folder', async () => {
    const wrongStudent = await w.admin.from('materials')
      .insert({ student_id: P.studentA.id, session_id: otherLesson, title: 'X', url: 'https://x.example' });
    expect(wrongStudent.error).not.toBeNull();
    const wrongFolder = await P.tutorA.client.from('materials').insert({
      student_id: P.studentA.id, session_id: lesson, title: 'X',
      storage_path: `${P.studentB.id}/${randomUUID()}.pdf`, file_type: 'application/pdf', size_bytes: 10,
    });
    expect(wrongFolder.error).not.toBeNull();
    const badLink = await P.tutorA.client.from('materials')
      .insert({ student_id: P.studentA.id, session_id: lesson, title: 'X', url: 'https://x.example/a b' });
    expect(badLink.error).not.toBeNull();
  });

  test('staff upload files into the student’s folder; students cannot; families can read them', async () => {
    const path = `${P.studentA.id}/${randomUUID()}.pdf`;
    const up = await P.tutorA.client.storage.from('materials').upload(path, pdf, { contentType: 'application/pdf' });
    expect(up.error).toBeNull();
    files.push(path);
    const row = await P.tutorA.client.from('materials').insert({
      student_id: P.studentA.id, session_id: lesson, title: 'Handout', storage_path: path, file_type: 'application/pdf', size_bytes: pdf.length,
    }).select('id').single();
    expect(row.error).toBeNull();
    const signed = await P.parentA.client.storage.from('materials').createSignedUrl(path, 60);
    expect(signed.error).toBeNull();
    const mine = `${P.studentA.id}/${randomUUID()}.pdf`;
    expect((await P.studentA.client.storage.from('materials').upload(mine, pdf, { contentType: 'application/pdf' })).error).not.toBeNull();
    expect((await P.studentB.client.storage.from('materials').createSignedUrl(path, 60)).error).not.toBeNull();
    const badName = `${P.studentA.id}/notes.exe`;
    expect((await P.tutorA.client.storage.from('materials').upload(badName, pdf, { contentType: 'application/pdf' })).error).not.toBeNull();
  });

  test('homework set in a lesson must be that student’s lesson; any of their tutors attaches a worksheet', async () => {
    const hw = await P.tutorA.client.from('tasks')
      .insert({ student_id: P.studentA.id, kind: 'assignment', title: 'Worksheet', session_id: lesson }).select('id, session_id').single();
    expect(hw.error).toBeNull();
    expect(hw.data.session_id).toBe(lesson);
    const wrong = await P.tutorA.client.from('tasks')
      .insert({ student_id: P.studentA.id, kind: 'assignment', title: 'W', session_id: otherLesson });
    expect(wrong.error).not.toBeNull();
    const sheet = await P.tutorB.client.from('materials')
      .insert({ student_id: P.studentA.id, task_id: hw.data.id, title: 'Sheet', url: 'https://x.example/sheet' }).select('id');
    expect(sheet.error).toBeNull();
  });

  test('the session’s tutor removes a material', async () => {
    const gone = await P.tutorA.client.from('materials').delete().eq('id', link).select('id');
    expect((gone.data ?? []).map((r) => r.id)).toEqual([link]);
  });
});
