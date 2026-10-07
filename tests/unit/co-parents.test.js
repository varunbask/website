import { describe, test, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../../portal/js/supabase.js', () => ({ sb: {} }));

const { buildContext, familyMonth } = await import('../../portal/js/billing-model.js');
const { statementSnapshot, statementStudents, statementStatuses } = await import('../../portal/js/billing-text.js');
const { introText } = await import('../../portal/js/views/billing.js');
const { familyJoinIds, andList, familyJoinText } = await import('../../portal/js/views/people.js');
const { zonedIso } = await import('../../portal/js/dates.js');

const read = (rel) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const NOW = new Date(zonedIso('2026-11-18', '12:00'));
const NAMES = new Map([['kevin', 'Kevin Wang'], ['ava', 'Ava Wang'], ['alan', 'Alan Wang'], ['ethan', 'Ethan Poon']]);

function ctxOf(sessions, parentLinks) {
  return buildContext({
    sessions,
    now: NOW,
    billing: {
      settings: { business_name: 'VP Education Group', payroll_anchor: '2026-11-01', pay_lag_days: 6, due_day: 15, ledger_start: '2026-11-01' },
      policies: [{ effective_from: '2026-11-01', absent_family_pct: 100, absent_tutor_pct: 100, count_unconfirmed: true }],
      familyRates: [{ id: 1, student_id: 'kevin', subject: 'Math', tutor_id: null, rate_cents: 4500, effective_from: '2026-11-01', voided_at: null },
        { id: 2, student_id: 'ava', subject: 'Math', tutor_id: null, rate_cents: 4500, effective_from: '2026-11-01', voided_at: null }],
      tutorRates: [{ id: 3, tutor_id: 'ethan', rate_cents: 3000, effective_from: '2026-11-01', voided_at: null }],
      sessionBilling: [], edits: [], payments: [], payouts: [], adjustments: [], contacts: [], statements: [],
      parentLinks, names: NAMES, fullNames: NAMES,
    },
  });
}
const lesson = (id, student, day) => ({
  id, student_id: student, tutor_id: 'ethan', series_id: null, subject: 'Math', status: 'scheduled', attendance: 'present',
  starts_at: zonedIso(day, '16:00'), ends_at: zonedIso(day, '17:00'), created_at: zonedIso('2026-10-01', '09:00'), cancelled_at: null,
});

describe('which students a statement covers', () => {
  const links = [
    { parent_id: 'alan', student_id: 'kevin', bills: true },
    { parent_id: 'alan', student_id: 'ava', bills: true },
    { parent_id: 'mia', student_id: 'kevin', bills: false },
  ];

  test('the released snapshot lists the students with lessons that month, sorted', () => {
    const ctx = ctxOf([lesson(1, 'kevin', '2026-11-03'), lesson(2, 'ava', '2026-11-04'), lesson(3, 'kevin', '2026-11-10')], links);
    const snap = statementSnapshot(ctx, familyMonth(ctx, 'alan', '2026-11-01'), { sentOn: '2026-12-01' });
    expect(snap.student_ids).toEqual(['ava', 'kevin']);
  });

  test('only the students on the bill, not every child the payer has', () => {
    const ctx = ctxOf([lesson(1, 'kevin', '2026-11-03')], links);
    expect(statementStudents(ctx, familyMonth(ctx, 'alan', '2026-11-01'))).toEqual(['kevin']);
  });

  test('a month with no lessons falls back to the children this parent pays for', () => {
    expect(statementStudents({ parentLinks: links }, { parentId: 'alan', lines: [], adjustments: [] })).toEqual(['ava', 'kevin']);
    expect(statementStudents({ parentLinks: links }, { parentId: 'mia', lines: [], adjustments: [] })).toEqual([]);
  });
});

describe('statement statuses with two paying parents', () => {
  const row = (payer, period, due, paid, previous = 0) => ({
    payer_id: payer, period, due_cents: due, paid_total_cents: paid,
    snapshot: { due_cents: due, due_date: '2026-01-15', paid_total_cents: 0, previous_cents: previous },
  });

  test('each payer carries into their own next statement, never into the other payer', () => {
    // mom: Oct unpaid, carried into Nov. dad: Oct paid in full, no Nov yet
    const momNov = row('mom', '2026-11-01', 9000, 0, 5000);
    const momOct = row('mom', '2026-10-01', 5000, 0);
    const dadOct = row('dad', '2026-10-01', 3000, 3000);
    const statuses = statementStatuses([momNov, momOct, dadOct], '2026-12-31');
    expect(statuses[1].key).toBe('carried');
    // dad's October is his newest, so it is live and paid, not carried into mom's November
    expect(statuses[2]).toMatchObject({ key: 'paid', label: 'Paid' });
  });

  test('rows without payer_id (older pages) still work as one list', () => {
    const nov = { period: '2026-11-01', due_cents: 9000, paid_total_cents: 0, snapshot: { due_cents: 9000, due_date: '2026-12-15', paid_total_cents: 0, previous_cents: 5000 } };
    const oct = { period: '2026-10-01', due_cents: 5000, paid_total_cents: 0, snapshot: { due_cents: 5000, due_date: '2026-11-15', paid_total_cents: 0 } };
    expect(statementStatuses([nov, oct], '2026-12-31').map((s) => s.key)).toEqual(['overdue', 'carried']);
  });
});

describe('the parent Billing page', () => {
  test('a parent who pays reads "Your monthly statements"', () => {
    expect(introText([{ own: true }])).toMatch(/^Your monthly statements, as we released them\./);
  });

  test('the other parent is told who gets the bill', () => {
    const text = introText([{ own: false, payer_name: 'Grace Lin' }, { own: false, payer_name: 'Grace Lin' }]);
    expect(text).toContain('Grace Lin gets the bill and pays it; you see the same statements here.');
  });

  test('a mix of their own and the other parent\'s', () => {
    expect(introText([{ own: true }, { own: false, payer_name: 'Grace Lin' }])).toContain('including ones billed to another parent');
  });

  test('a shared row links with the payer so the right statement opens, and says who it is billed to', () => {
    const src = read('portal/js/views/billing.js');
    expect(src).toContain('&from=${r.payer_id}');
    expect(src).toContain(', billed to ${name}');
  });

  test('no em or en dashes in the new copy', () => {
    for (const t of [introText([{ own: false, payer_name: 'A' }]), introText([{ own: true }, { own: false }]), familyJoinText('Dad', 'Mom', ['Kevin'], true), familyJoinText('Dad', 'Mom', ['Kevin'], false)]) {
      expect(t).not.toMatch(/[–—]/);
    }
  });
});

describe('Same family as (People)', () => {
  const links = [
    { parent_id: 'mom', student_id: 'kevin', bills: true },
    { parent_id: 'mom', student_id: 'ava', bills: true },
    { parent_id: 'dad', student_id: 'kevin', bills: false },
  ];

  test('links only the children the parent does not have yet', () => {
    expect(familyJoinIds(links, 'dad', 'mom')).toEqual(['ava']);
    expect(familyJoinIds(links, 'mom', 'dad')).toEqual([]);
    expect(familyJoinIds(links, 'new', 'mom')).toEqual(['kevin', 'ava']);
    expect(familyJoinIds([], 'new', 'mom')).toEqual([]);
  });

  test('names read naturally', () => {
    expect(andList(['Kevin'])).toBe('Kevin');
    expect(andList(['Kevin', 'Ava'])).toBe('Kevin and Ava');
    expect(andList(['Kevin', 'Ava', 'Leo'])).toBe('Kevin, Ava and Leo');
    expect(andList([])).toBe('');
  });

  test('the toast says who still pays', () => {
    expect(familyJoinText('Dad Wang', 'Grace Wang', ['Kevin', 'Ava'], true))
      .toBe('Linked Dad Wang to Kevin and Ava. Grace Wang still gets the bill, and Dad Wang sees it under Billing too.');
    expect(familyJoinText('Dad Wang', 'Grace Wang', ['Kevin'], false)).toBe('Linked Dad Wang to Kevin. Each child’s bill stays with the parent who pays.');
  });

  test('the parent row offers Same family as, and inserts every missing link in one write', () => {
    const src = read('portal/js/views/people.js');
    expect(src).toContain("label: 'Same family as'");
    expect(src).toContain("sb.from('parent_students').insert(ids.map((id) => ({ parent_id: parent.id, student_id: id })))");
    expect(src).toContain('childGroup(person, students, parents)');
  });
});

describe('the whole-family rule', () => {
  const sql = read('supabase/migrations/20261022130000_co_parent_bills_whole_family.sql');

  test('another parent also has to share every child the paying parent pays for', () => {
    expect(sql).toContain('create or replace function public.my_statements()');
    expect(sql).toContain('and c.family <@ me.students');
    expect(sql).toContain('and c.students <@ me.students');
    expect(sql).toMatch(/where ps\.parent_id = s\.parent_id and ps\.bills\),\s*'\{\}'::uuid\[\]\) as family/);
    expect(sql).toContain('revoke execute on function public.my_statements() from public, anon');
    expect(sql).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('the migration', () => {
  const sql = read('supabase/migrations/20261022120000_co_parent_bills.sql');

  test('my_statements returns who pays and whether it is the reader\'s own', () => {
    expect(sql).toMatch(/own boolean,\s*payer_id uuid,\s*payer_name text/);
    expect(sql).toContain('security definer');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('revoke execute on function public.my_statements() from public, anon');
  });

  test('another parent sees a statement only when linked to every student on it', () => {
    expect(sql).toContain('c.students <@ me.students');
    expect(sql).toContain('cardinality(c.students) > 0');
  });

  test('the paid total is the paying parent\'s, not the reader\'s', () => {
    expect(sql).toContain('where p.parent_id = c.parent_id and p.voided_at is null');
  });
});
