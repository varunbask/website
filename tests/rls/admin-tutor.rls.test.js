import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { buildWorld, hasService } from './world.js';

// Needs supabase/migrations/20261003130000_admin_tutor_links.sql applied to the
// project the .env points at. Tests run in file order; later ones build on earlier ones.

const HOUR = 3_600_000;
const slot = (hoursAhead, length = 1) => {
  const start = new Date(Math.ceil(Date.now() / HOUR) * HOUR + hoursAhead * HOUR);
  return { starts_at: start.toISOString(), ends_at: new Date(start.getTime() + length * HOUR).toISOString() };
};

describe.skipIf(!hasService)('an admin who also teaches', () => {
  let w;
  let P;
  let own; // the admin's session with studentB

  beforeAll(async () => {
    w = await buildWorld();
    P = w.people;
  });

  afterAll(async () => {
    await w?.cleanup();
  });

  test('an admin links themselves to a student as their tutor', async () => {
    const { error } = await P.admin.client.from('tutor_students')
      .insert({ tutor_id: P.admin.id, student_id: P.studentB.id, subject: 'Physics' });
    expect(error).toBeNull();
  });

  test('a parent or a student still cannot be made a tutor', async () => {
    const parent = await P.admin.client.from('tutor_students').insert({ tutor_id: P.parentA.id, student_id: P.studentB.id });
    expect(parent.error?.code).toBe('42501');
    const student = await P.admin.client.from('tutor_students').insert({ tutor_id: P.studentA.id, student_id: P.studentB.id });
    expect(student.error?.code).toBe('42501');
  });

  test('the admin books a session they teach, but not one for a student they do not teach', async () => {
    const ok = await P.admin.client.from('sessions')
      .insert({ student_id: P.studentB.id, tutor_id: P.admin.id, subject: 'Physics', ...slot(24) })
      .select('id').single();
    expect(ok.error).toBeNull();
    own = ok.data.id;
    const notTheirs = await P.admin.client.from('sessions')
      .insert({ student_id: P.studentA.id, tutor_id: P.admin.id, ...slot(30) });
    expect(notTheirs.error?.code).toBe('42501');
  });

  test('the student sees the session and lists the admin as a tutor; another student sees neither', async () => {
    const seen = await P.studentB.client.from('sessions').select('id').eq('tutor_id', P.admin.id);
    expect((seen.data ?? []).map((r) => String(r.id))).toEqual([String(own)]);
    const tutors = await P.studentB.client.rpc('student_tutors', { p_student: P.studentB.id });
    expect((tutors.data ?? []).some((t) => t.tutor_id === P.admin.id && t.subject === 'Physics')).toBe(true);
    const other = await P.studentA.client.from('sessions').select('id').eq('tutor_id', P.admin.id);
    expect(other.data ?? []).toEqual([]);
    const otherTutors = await P.studentA.client.rpc('student_tutors', { p_student: P.studentB.id });
    expect(otherTutors.data ?? []).toEqual([]);
  });
});
