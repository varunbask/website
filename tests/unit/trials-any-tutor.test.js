import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

describe('free trial lessons with any tutor', () => {
  const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  const NEW = '20261021120000_trials_any_tutor.sql';
  const sql = read(`supabase/migrations/${NEW}`);

  test('the migration is last, drops only the admin-tutor rule, and touches nothing else', () => {
    expect(migrations.at(-1)).toBe(NEW);
    expect(sql).toContain('drop trigger if exists session_billing_trial on public.session_billing;');
    expect(sql).toContain('drop function if exists private.session_billing_trial();');
    const statements = sql.replace(/--.*$/gm, '').split(';').map((x) => x.trim()).filter(Boolean);
    expect(statements).toHaveLength(2);
    // the rules that stay are not dropped, altered or replaced
    expect(sql.replace(/--.*$/gm, '')).not.toMatch(/constraint|policy|grant|alter table|create /i);
    expect(sql).not.toMatch(/[–—]/);
  });

  test('a trial still means the family pays 0, and only the admin writes session_billing', () => {
    const billing = read('supabase/migrations/20261010120000_billing.sql');
    expect(billing).toContain("constraint session_billing_trial check (reason is distinct from 'trial' or charge_pct = 0)");
    for (const op of ['adds', 'changes', 'removes']) {
      expect(billing).toMatch(new RegExp(`create policy "admin ${op} session billing" on public\\.session_billing[\\s\\S]*?is_admin\\(\\)`));
    }
    // no later migration brings back a rule about who teaches a trial
    for (const f of migrations.filter((x) => x > '20261010120000_billing.sql')) {
      expect(read(`supabase/migrations/${f}`), f).not.toMatch(/create (or replace )?function private\.session_billing_trial/);
    }
  });

  test('the Families page offers a trial on every lesson, and says nothing about only your own', () => {
    const families = read('portal/js/views/account-families.js');
    expect(families).not.toContain('ownLesson');
    expect(families).not.toMatch(/value !== 'trial'/);
    expect(families).not.toMatch(/only the admin teaches/i);
    expect(families).toContain("trial: 'Trial lesson (free)'");
    expect(families).toContain("A trial lesson is free: the family pays 0 percent.");
    expect(read('portal/js/billing-model.js')).not.toMatch(/adminIds|only they teach/);
  });
});
