import { test, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Merging a stray second sign-in deletes that account, and the database
// cascade deletes every row that points at it with on delete cascade.
// signinHoldings (api/_lib/people-delete.js) must refuse while any such row
// matters. This test finds every cascading table in the migrations: each one
// is either counted by the merge check or listed here with the reason it is
// safe. A new table fails here until someone decides.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(ROOT, 'supabase/migrations');

// table -> how signinHoldings counts it
const COUNTED = {
  tutor_students: 'countsOf tutor_links', parent_students: 'countsOf parent_links', sessions: 'sessionsOf',
  tasks: 'countsOf tasks', submissions: 'countsOf submissions', submission_drafts: 'countsOf drafts',
  updates: 'countsOf updates', student_notes: 'countsOf notes', session_series: 'countsOf series',
  family_rates: 'countsOf family_rates', tutor_rates: 'countsOf tutor_rates', statements: 'countsOf statements',
  google_connections: 'googleCount', sat_access: 'strayCounts', sat_attempts: 'strayCounts',
  homework_drafts: 'strayCounts', billing_contacts: 'strayCounts', student_profiles: 'strayCounts profile_details',
};
// table -> why losing it with the stray account is fine
const SAFE = {
  profiles: 'the account itself',
  portal_invites: 'links to a no-login account; a signed-in stray has none',
  grades: 'follow submissions, which are counted',
  materials: 'belong to sessions and tasks, which are counted',
  sat_responses: 'follow sat_attempts, which are counted',
  session_billing: 'follows sessions, which are counted',
  staff_profiles: 'staff only; a stray is a student or parent',
  google_oauth_states: 'a short-lived sign-in step',
  google_deletions: 'tutor calendar bookkeeping',
  family_profile: 'a parent profile view, not stored rows',
  student_busy: 'a function, not a table',
};

test('every table that cascades from profiles is counted by the merge check or listed as safe', () => {
  const cascading = new Set();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(DIR, file), 'utf8');
    for (const m of sql.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      if (/references public\.profiles\s*\(id\)\s*on delete cascade/i.test(m[2])) cascading.add(m[1]);
    }
    for (const m of sql.matchAll(/alter table (?:only )?public\.(\w+)\s+add column[^;]*references public\.profiles\s*\(id\)\s*on delete cascade/gi)) cascading.add(m[1]);
  }
  const unknown = [...cascading].filter((t) => !(t in COUNTED) && !(t in SAFE)).sort();
  expect(unknown, 'decide for each: count it in signinHoldings, or list it in SAFE with a reason').toEqual([]);
  expect(cascading.size).toBeGreaterThan(10);
});

test('the counted tables really are counted in people-delete.js', () => {
  const src = readFileSync(join(ROOT, 'api/_lib/people-delete.js'), 'utf8');
  for (const table of Object.keys(COUNTED)) expect(src, table).toContain(`'${table}'`);
});
