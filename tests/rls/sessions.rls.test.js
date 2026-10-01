import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildWorld, hasService, anonClient } from './world.js';

// Needs supabase/migrations/20261002120000_sessions.sql applied to the project
// the .env points at. Tests run in file order; later ones build on earlier ones.

const HOUR = 3_600_000;
const slot = (hoursAhead, length = 1) => {
  const start = new Date(Math.ceil(Date.now() / HOUR) * HOUR + hoursAhead * HOUR);
  return { starts_at: start.toISOString(), ends_at: new Date(start.getTime() + length * HOUR).toISOString() };
};
const ids = (rows) => (rows ?? []).map((r) => String(r.id)).sort();

describe.skipIf(!hasService)('session row-level security', () => {
  let w;
  let P;
  let mine;      // tutorA's session with studentA
  let theirs;    // tutorB's session with studentA (booked by the admin)

  beforeAll(async () => {
    w = await buildWorld();
    P = w.people;
    // studentA has two tutors: A teaches Algebra, B teaches SAT Reading
    await w.admin.from('tutor_students').update({ subject: 'Algebra' })
      .eq('tutor_id', P.tutorA.id).eq('student_id', P.studentA.id);
    const link = await w.admin.from('tutor_students')
      .insert({ tutor_id: P.tutorB.id, student_id: P.studentA.id, subject: 'SAT Reading' });
    if (link.error) throw new Error(link.error.message);
  });

  afterAll(async () => {
    await w?.cleanup();
  });

  test('a tutor books a session with their own student', async () => {
    const { data, error } = await P.tutorA.client.from('sessions')
      .insert({ student_id: P.studentA.id, subject: 'Algebra', ...slot(24) }).select('id, tutor_id, status').single();
    expect(error).toBeNull();
    expect(data.tutor_id).toBe(P.tutorA.id);
    expect(data.status).toBe('scheduled');
    mine = data.id;
  });

  test('a tutor cannot book another tutor or a student who is not theirs', async () => {
    const asOther = await P.tutorA.client.from('sessions')
      .insert({ student_id: P.studentA.id, tutor_id: P.tutorB.id, ...slot(30) });
    expect(asOther.error?.code).toBe('42501');
    const notMine = await P.tutorA.client.from('sessions').insert({ student_id: P.studentB.id, ...slot(30) });
    expect(notMine.error?.code).toBe('42501');
  });

  test('an admin books for any tutor linked to the student, not for an unlinked one', async () => {
    const ok = await P.admin.client.from('sessions')
      .insert({ student_id: P.studentA.id, tutor_id: P.tutorB.id, subject: 'SAT Reading', ...slot(48) })
      .select('id').single();
    expect(ok.error).toBeNull();
    theirs = ok.data.id;
    const unlinked = await P.admin.client.from('sessions')
      .insert({ student_id: P.studentB.id, tutor_id: P.tutorB.id, ...slot(48) });
    expect(unlinked.error?.code).toBe('42501');
  });

  test('the student, their parent and both tutors read the sessions; nobody else does', async () => {
    const both = [String(mine), String(theirs)].sort();
    for (const who of ['studentA', 'parentA', 'tutorA', 'tutorB', 'admin']) {
      const { data, error } = await P[who].client.from('sessions').select('id').eq('student_id', P.studentA.id);
      expect(error, who).toBeNull();
      expect(ids(data), who).toEqual(both);
    }
    for (const who of ['studentB', 'pending']) {
      const { data } = await P[who].client.from('sessions').select('id');
      expect(data, who).toEqual([]);
    }
    const anon = await anonClient().from('sessions').select('id');
    expect(anon.error?.code).toBe('42501');
  });

  test('students and parents cannot book, change or delete sessions', async () => {
    for (const who of ['studentA', 'parentA']) {
      const c = P[who].client;
      expect((await c.from('sessions').insert({ student_id: P.studentA.id, tutor_id: P.tutorA.id, ...slot(60) })).error, who).not.toBeNull();
      const moved = await c.from('sessions').update({ notes: 'x' }).eq('id', mine).select('id');
      expect(moved.data ?? [], who).toEqual([]);
      const gone = await c.from('sessions').delete().eq('id', mine).select('id');
      expect(gone.data ?? [], who).toEqual([]);
    }
  });

  test('another tutor of the same student sees but cannot change a session', async () => {
    const c = P.tutorB.client;
    expect((await c.from('sessions').update({ status: 'cancelled' }).eq('id', mine).select('id')).data).toEqual([]);
    expect((await c.from('sessions').delete().eq('id', mine).select('id')).data).toEqual([]);
  });

  test('a new plan is not news; moving a session keeps the old start and marks the change', async () => {
    const c = P.tutorA.client;
    const planned = await c.from('sessions').update({ notes: 'Bring the quiz' }).eq('id', mine).select('changed_at').single();
    expect(planned.data.changed_at).toBeNull();
    const before = (await w.admin.from('sessions').select('starts_at').eq('id', mine).single()).data.starts_at;
    const next = slot(26);
    const { data, error } = await c.from('sessions').update(next).eq('id', mine).select('moved_from, starts_at, changed_at').single();
    expect(error).toBeNull();
    expect(Date.parse(data.moved_from)).toBe(Date.parse(before));
    expect(Date.parse(data.starts_at)).toBe(Date.parse(next.starts_at));
    expect(data.changed_at).not.toBeNull();
    expect((await c.from('sessions').update({ tutor_id: P.tutorB.id }).eq('id', mine)).error?.code).toBe('42501');
    expect((await c.from('sessions').update({ student_id: P.studentB.id }).eq('id', mine)).error?.code).toBe('42501');
  });

  test('the tutor cancels and writes the recap; the family reads both', async () => {
    const c = P.tutorA.client;
    const done = await c.from('sessions').update({ status: 'cancelled', attendance: 'absent', recap: 'Moved to next week.' })
      .eq('id', mine).select('id');
    expect(ids(done.data)).toEqual([String(mine)]);
    const seen = await P.parentA.client.from('sessions').select('status, attendance, recap').eq('id', mine).single();
    expect(seen.data).toEqual({ status: 'cancelled', attendance: 'absent', recap: 'Moved to next week.' });
  });

  test('bad times, lengths and links are refused', async () => {
    const c = P.tutorA.client;
    const s = slot(70);
    expect((await c.from('sessions').insert({ student_id: P.studentA.id, starts_at: s.ends_at, ends_at: s.starts_at })).error).not.toBeNull();
    expect((await c.from('sessions').insert({ student_id: P.studentA.id, ...slot(70, 9) })).error).not.toBeNull();
    expect((await c.from('sessions').insert({ student_id: P.studentA.id, meeting_url: 'http://x.example', ...s })).error).not.toBeNull();
    // A line break would let a link write extra lines into a calendar file
    expect((await c.from('sessions').insert({ student_id: P.studentA.id, meeting_url: 'https://x.example\r\nBEGIN:VALARM', ...s })).error).not.toBeNull();
  });

  test('a weekly series shares one series id', async () => {
    const series = randomUUID();
    const rows = [0, 1, 2].map((i) => ({ student_id: P.studentA.id, series_id: series, ...slot(96 + i * 168) }));
    const { data, error } = await P.tutorA.client.from('sessions').insert(rows).select('id, series_id');
    expect(error).toBeNull();
    expect(data.map((r) => r.series_id)).toEqual([series, series, series]);
  });

  test('families list the student’s tutors with subjects; other families get nothing', async () => {
    const { data, error } = await P.parentA.client.rpc('student_tutors', { p_student: P.studentA.id });
    expect(error).toBeNull();
    expect(data.map((t) => [t.tutor_id, t.subject]).sort()).toEqual([[P.tutorA.id, 'Algebra'], [P.tutorB.id, 'SAT Reading']].sort());
    const other = await P.studentB.client.rpc('student_tutors', { p_student: P.studentA.id });
    expect(other.data ?? []).toEqual([]);
    expect((await anonClient().rpc('student_tutors', { p_student: P.studentA.id })).error).not.toBeNull();
  });

  test('only an admin sets a link’s subject', async () => {
    const byTutor = await P.tutorA.client.from('tutor_students').update({ subject: 'Geometry' })
      .eq('tutor_id', P.tutorA.id).eq('student_id', P.studentA.id).select('tutor_id');
    expect(byTutor.data ?? []).toEqual([]);
    const byAdmin = await P.admin.client.from('tutor_students').update({ subject: 'Geometry' })
      .eq('tutor_id', P.tutorA.id).eq('student_id', P.studentA.id).select('subject');
    expect(byAdmin.data).toEqual([{ subject: 'Geometry' }]);
  });

  test('an unlink removes the tutor’s future sessions; past ones stay, read only', async () => {
    const past = (await w.admin.from('sessions')
      .insert({ student_id: P.studentA.id, tutor_id: P.tutorA.id, ...slot(-72) }).select('id').single()).data.id;
    await w.admin.from('tutor_students').delete().eq('tutor_id', P.tutorA.id).eq('student_id', P.studentA.id);
    const c = P.tutorA.client;
    const { data } = await c.from('sessions').select('id, starts_at').eq('student_id', P.studentA.id);
    expect(ids(data)).toEqual([String(past)]);
    expect((await c.from('sessions').update({ recap: 'x' }).eq('id', past).select('id')).data).toEqual([]);
    // Priya's session with the same student is untouched
    const other = await w.admin.from('sessions').select('id').eq('id', theirs);
    expect(ids(other.data)).toEqual([String(theirs)]);
  });

  test('a tutor who is no longer a tutor reads none of their old sessions', async () => {
    await w.admin.from('profiles').update({ role: 'pending' }).eq('id', P.tutorA.id);
    const { data } = await P.tutorA.client.from('sessions').select('id');
    expect(data).toEqual([]);
  });
});
