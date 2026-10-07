import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The real rules are exercised against Postgres (PGlite). These guard the shape of the file itself.
const sql = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20261019120000_tutor_colors.sql', import.meta.url)), 'utf8');

test('the column is a fixed list of names or null', () => {
  expect(sql).toContain('add column calendar_color text');
  expect(sql).toMatch(/check \(calendar_color in \(/);
  expect(sql).not.toMatch(/calendar_color text\s+not null/);
});

test('clients may write only that column, and a guard trigger keeps it to the admin', () => {
  expect(sql).toContain('grant update (calendar_color) on public.profiles to authenticated');
  expect(sql).not.toMatch(/grant [^;]*(insert|delete)[^;]*on public\.profiles/);
  expect(sql).toContain('private.is_admin()');
  expect(sql).toContain('before update of calendar_color, role on public.profiles');
  expect(sql).toContain('revoke execute on function private.profiles_color_guard() from public');
});

test('calendar_colors() is closed to anonymous callers and returns only ids and colors', () => {
  const fn = sql.slice(sql.indexOf('create function public.calendar_colors'));
  expect(fn).toContain('returns table (profile_id uuid, color text)');
  expect(fn).toContain("security definer set search_path = ''");
  expect(fn).toContain("p.role in ('tutor', 'admin')");
  const body = fn.slice(0, fn.indexOf('$$;'));
  expect(body).not.toMatch(/full_name|email|signup_note/);
  expect(sql).toContain('revoke execute on function public.calendar_colors() from public, anon');
  expect(sql).toContain('grant execute on function public.calendar_colors() to authenticated');
});

test('the migration has no em or en dashes', () => {
  expect(sql).not.toMatch(/[–—]/);
});
