import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The real rules are exercised against Postgres (PGlite). These guard the shape of the file itself.
const sql = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20261024120000_grade_results.sql', import.meta.url)), 'utf8');
const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

test('a grade result is one of three lower-case words, or null', () => {
  expect(code).toContain("add column result text check (result in ('completed', 'missing', 'extended'))");
  expect(code).not.toMatch(/result text\s+not null/);
});

test('every scored grade is marked completed, and the score column stays', () => {
  expect(code).toContain("update public.grades set result = 'completed' where score is not null;");
  expect(code).not.toMatch(/drop column/);
});

test('a released grade needs a result; feedback is optional', () => {
  expect(code).toContain('drop constraint released_grade_is_complete');
  expect(code).toContain('add constraint released_grade_has_result check (released_at is null or result is not null)');
  expect(code).not.toMatch(/feedback is not null/);
});

test('clients may update only the new columns, and insert neither', () => {
  expect(code).toContain('grant update (result) on public.grades to authenticated;');
  expect(code).toContain('add column extended_from timestamptz;');
  expect(code).toContain('grant update (extended_from) on public.tasks to authenticated;');
  expect(code).not.toMatch(/grant [^;]*insert/);
  expect(code).not.toMatch(/policy/);
});

test('the header explains who may write the new columns', () => {
  expect(sql).toMatch(/staff edit tasks/);
  expect(sql).toMatch(/staff review grades/);
});

test('the migration has no em or en dashes', () => {
  expect(sql).not.toMatch(/[\u2013\u2014]/);
});
