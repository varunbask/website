import { describe, test, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rpc = vi.fn();
vi.mock('../../portal/js/supabase.js', () => ({ sb: { rpc: (...args) => rpc(...args), from: () => ({}) } }));

const { busyBlocks, findClashes } = await import('../../portal/js/sessions-model.js');
const { clashLine, clashReport, mergeSessions } = await import('../../portal/js/session-form-model.js');
const store = await import('../../portal/js/store.js');

const read = (rel) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

const busyRow = { starts_at: '2026-10-13T22:00:00Z', ends_at: '2026-10-13T23:00:00Z' };

describe('busy blocks (a student\'s lessons with other tutors, times only)', () => {
  test('stand in for sessions with no tutor and no subject', () => {
    const [b] = busyBlocks('andrew', [busyRow]);
    expect(b).toMatchObject({ student_id: 'andrew', tutor_id: null, subject: null, status: 'scheduled', busy: true, ...busyRow });
    expect(String(b.id)).toMatch(/^busy-/);
    expect(busyBlocks('andrew', null)).toEqual([]);
  });

  test('two blocks never share an id, so merging keeps both', () => {
    const blocks = busyBlocks('andrew', [busyRow, { starts_at: '2026-10-20T22:00:00Z', ends_at: '2026-10-20T23:00:00Z' }]);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(2);
    expect(mergeSessions([], blocks)).toHaveLength(2);
  });

  test('a busy block clashes as the student\'s, and says nothing about the lesson', () => {
    const candidate = { student_id: 'andrew', tutor_id: 'lauren', starts_at: '2026-10-13T22:30:00Z', ends_at: '2026-10-13T23:30:00Z' };
    const clashes = findClashes(candidate, busyBlocks('andrew', [busyRow]));
    expect(clashes).toHaveLength(1);
    expect(clashes[0].who).toBe('student');
    const line = clashLine(clashes[0], { studentNames: new Map([['andrew', 'Andrew']]) });
    expect(line).toBe('Andrew has another lesson then.');
  });

  test('the clash report lists it like any other clash', () => {
    const report = clashReport({
      planned: [{ starts_at: '2026-10-13T22:30:00Z', ends_at: '2026-10-13T23:30:00Z' }],
      studentId: 'andrew',
      tutorId: 'lauren',
      list: busyBlocks('andrew', [busyRow]),
      studentNames: new Map([['andrew', 'Andrew']]),
    });
    expect(report.count).toBe(1);
    expect(report.lines).toEqual(['Andrew has another lesson then.']);
  });

  test('a real session (one the reader may see) still names the subject and tutor', () => {
    const s = { id: 1, student_id: 'andrew', tutor_id: 'varun', subject: 'Math', ...busyRow };
    const line = clashLine({ session: s, who: 'student' }, { studentNames: new Map([['andrew', 'Andrew']]), tutorNames: new Map([['varun', 'Varun']]) });
    expect(line).toBe('Andrew has Math with Varun then.');
  });
});

describe('store.getStudentBusy', () => {
  beforeEach(() => rpc.mockReset());

  test('asks student_busy for 30 days back to a year ahead, within the 400-day limit', async () => {
    rpc.mockResolvedValue({ data: [busyRow], error: null });
    const out = await store.getStudentBusy('andrew');
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe('student_busy');
    expect(args.p_student).toBe('andrew');
    const days = (Date.parse(args.p_to) - Date.parse(args.p_from)) / 86400000;
    expect(days).toBeGreaterThan(390);
    expect(days).toBeLessThanOrEqual(400);
    expect(out[0]).toMatchObject({ busy: true, student_id: 'andrew', ...busyRow });
  });

  test('is never cached: another tutor\'s changes do not reach this tutor\'s live updates', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await store.getStudentBusy('andrew');
    await store.getStudentBusy('andrew');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  test('an error is thrown for the caller to ignore', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'nope' } });
    await expect(store.getStudentBusy('andrew')).rejects.toBeTruthy();
  });
});

describe('wiring', () => {
  test('the session form asks for busy times only for a tutor, and merges them into the clash check', () => {
    const src = read('portal/js/session-form.js');
    expect(src).toContain("const wantsBusy = me?.role === 'tutor' && typeof dctx.store?.getStudentBusy === 'function';");
    expect(src).toContain('ensureBusy(sid);');
    expect(src).toContain('busyLists.get(sid) ?? [],');
  });

  test('moving a session on the calendar checks busy times too, for a tutor', () => {
    const src = read('portal/js/views/calendar.js');
    expect(src).toContain("const wantsBusy = ctx.me?.role === 'tutor' && typeof ctx.store.getStudentBusy === 'function';");
    expect(src).toContain('tutorsOwn(state.sessions), busy ?? [])');
  });

  test('the demo mirrors the rule and the function', () => {
    const src = read('tools/demo/demo-supabase.js');
    expect(src).toContain("sessions: (r) => (isStaff() && r.tutor_id === meId) || (role() !== 'tutor' && canSee(r.student_id)),");
    expect(src).toContain("case 'student_busy':");
  });
});

describe('the migration', () => {
  const sql = read('supabase/migrations/20261023120000_tutors_see_own_sessions.sql');
  const body = sql.replace(/--.*$/gm, '');

  test('a tutor reads only their own sessions and series; admin, parents and students as before', () => {
    expect(body).toContain('drop policy "read sessions of viewable students" on public.sessions;');
    expect(body).toContain('drop policy "read series of viewable students" on public.session_series;');
    const rule = "using ((tutor_id = (select auth.uid()) and (select private.my_role()) in ('tutor', 'admin'))\n         or ((select private.my_role()) in ('admin', 'parent', 'student') and private.can_view_student(student_id)));";
    expect(body.split(rule)).toHaveLength(3);
  });

  test('student_busy returns times only, for someone who may see the student, over at most 400 days', () => {
    expect(body).toContain('returns table (starts_at timestamptz, ends_at timestamptz)');
    expect(body).toContain('security definer set search_path = \'\'');
    expect(body).toContain('private.can_view_student(p_student)');
    expect(body).toContain("p_to - p_from <= interval '400 days'");
    expect(body).toContain("s.status <> 'cancelled'");
    expect(body).toContain('s.tutor_id is distinct from auth.uid()');
    expect(body).toContain('revoke execute on function public.student_busy(uuid, timestamptz, timestamptz) from public, anon;');
    expect(sql).not.toMatch(/[–—]/);
  });

  test('writes are untouched', () => {
    expect(body).not.toMatch(/for (insert|update|delete)/);
  });
});
