import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The real rules are exercised against Postgres (PGlite, and test:rls on the live
// project). These guard the shape of the file itself.
const sql = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20261017120000_student_profiles.sql', import.meta.url)), 'utf8');
const policies = (table) => [...sql.matchAll(new RegExp(`create policy "([^"]+)" on public\\.${table}\\s+for (\\w+)([\\s\\S]*?);`, 'g'))]
  .map(([, name, command, body]) => ({ name, command, body }));

test('row level security is on for both tables', () => {
  expect(sql).toContain('alter table public.student_profiles enable row level security');
  expect(sql).toContain('alter table public.student_notes    enable row level security');
});

test('staff notes are never readable by families: every policy asks who teaches the student', () => {
  const list = policies('student_notes');
  expect(list.map((p) => p.command).sort()).toEqual(['delete', 'insert', 'select']);
  for (const p of list) {
    expect(p.body, p.name).toMatch(/can_teach\(student_id\)|is_admin\(\)/);
    expect(p.body, p.name).not.toContain('can_view_student');
  }
});

test('the profile table is staff only: every policy asks who teaches the student', () => {
  const list = policies('student_profiles');
  expect(list.map((p) => p.command).sort()).toEqual(['insert', 'select', 'update']);
  for (const p of list) {
    expect(p.body, p.name).toContain('can_teach(student_id)');
    expect(p.body, p.name).not.toContain('can_view_student');
  }
});

test('families read the profile only through family_profile: grade, school and goals', () => {
  const fn = sql.slice(sql.indexOf('create function public.family_profile'));
  expect(fn).toContain('returns table (grade_level text, school text, goals text)');
  expect(fn).toContain('security definer set search_path = \'\'');
  expect(fn).toContain('private.can_view_student(p_student)');
  const body = fn.slice(0, fn.indexOf('$$;'));
  expect(body).not.toMatch(/learning_notes|updated_by|updated_at/);
  expect(sql).toContain('revoke execute on function public.family_profile(uuid) from public, anon');
  expect(sql).toContain('grant execute on function public.family_profile(uuid) to authenticated');
});

test('clients can write only the fields they own', () => {
  expect(sql).toContain('grant insert (student_id, grade_level, school, goals, learning_notes) on public.student_profiles');
  expect(sql).toContain('grant update (grade_level, school, goals, learning_notes) on public.student_profiles');
  expect(sql).toContain('grant insert (student_id, body) on public.student_notes');
  expect(sql).not.toMatch(/grant [^;]*update[^;]*on public\.student_notes/);
});

test('the parent contacts function is staff only and closed to anonymous callers', () => {
  expect(sql).toContain('private.can_teach(p_student)');
  expect(sql).toContain('revoke execute on function public.staff_parent_contacts(uuid) from public, anon');
  expect(sql).toContain('grant execute on function public.staff_parent_contacts(uuid) to authenticated');
});

test('the migration has no em or en dashes', () => {
  expect(sql).not.toMatch(/[–—]/);
});
