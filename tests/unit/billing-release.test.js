import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildContext, familyMonth, familyRows, familyStatus, familyBlockers, needsAttention, monthEnd, statementNumber,
} from '../../portal/js/billing-model.js';
import { policyText, familiesCsv } from '../../portal/js/billing-text.js';
import {
  releasePlan, releaseCounts, releaseHeadline, releaseCopy, releaseDoneText, releaseResultCopy, releaseLabel,
  outcomeOf, releaseAll,
} from '../../portal/js/billing-release.js';
import { zonedIso } from '../../portal/js/dates.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

// Monday, November 2, 2026, noon Pacific: October has ended, November has not
const NOW = new Date(zonedIso('2026-11-02', '12:00'));
const MONTH = '2026-10-01';
const TODAY = '2026-11-02';
const at = (day, time) => zonedIso(day, time);

const SETTINGS = {
  business_name: 'VP Education Group', payroll_anchor: '2026-10-04', pay_lag_days: 6, due_day: 15,
  ledger_start: '2026-10-01', pay_note: 'Zelle: pay@vp.test',
};
const POLICY = { effective_from: '2026-10-01', absent_family_pct: 100, absent_tutor_pct: 100, count_unconfirmed: true };

let nextId = 1;
const session = (student, day, extra = {}) => ({
  id: nextId++, student_id: student, tutor_id: 'ethan', series_id: null, subject: 'Math',
  starts_at: at(day, '16:00'), ends_at: at(day, '17:00'), status: 'scheduled', attendance: 'present',
  created_at: at('2026-09-20', '09:00'), cancelled_at: null, ...extra,
});
const rate = (student) => ({ id: nextId++, student_id: student, subject: 'Math', tutor_id: null, rate_cents: 4500, effective_from: '2026-10-01', voided_at: null });

const NAMES = new Map([
  ['alan', 'Alan Wang'], ['ryan', 'Ryan Li'], ['nina', 'Nina Cho'], ['sam', 'Sam Roy'], ['tia', 'Tia Ng'], ['vic', 'Vic Hu'],
  ['kevin', 'Kevin Wang'], ['amy', 'Amy Li'], ['lee', 'Lee Cho'], ['ben', 'Ben Roy'], ['cy', 'Cy Ng'], ['di', 'Di Hu'], ['maya', 'Maya Ito'],
  ['ethan', 'Ethan Poon'],
]);
const KIDS = [['alan', 'kevin'], ['ryan', 'amy'], ['nina', 'lee'], ['sam', 'ben'], ['tia', 'cy'], ['vic', 'di']];
const sent = (parent, extra = {}) => ({
  parent_id: parent, period: MONTH, sent_on: '2026-11-01', due_cents: 4500, month_cents: 4500, previous_cents: 0, ...extra,
});

// Six families in October: alan is ready (his lesson never got attendance, which
// counts as held and holds nothing back), ryan has a lesson with no family rate,
// nina only cancelled, sam is released, tia was released and then changed, vic
// was marked sent before the portal kept copies. maya has no paying parent.
function october({ statements = [], extra = {} } = {}) {
  const sessions = [
    session('kevin', '2026-10-05', { attendance: null }),
    session('amy', '2026-10-06'),
    session('lee', '2026-10-07', { status: 'cancelled', attendance: null, cancelled_at: at('2026-10-06', '08:00') }),
    session('ben', '2026-10-08'),
    session('cy', '2026-10-09'),
    session('di', '2026-10-10'),
    session('maya', '2026-10-11'),
  ];
  const billing = {
    settings: SETTINGS,
    policies: [POLICY],
    familyRates: ['kevin', 'lee', 'ben', 'cy', 'di', 'maya'].map(rate),
    tutorRates: [{ id: nextId++, tutor_id: 'ethan', rate_cents: 3000, effective_from: '2026-10-01', voided_at: null }],
    sessionBilling: [], edits: [], payments: [], payouts: [], adjustments: [], contacts: [],
    statements,
    parentLinks: KIDS.map(([parent, student]) => ({ parent_id: parent, student_id: student, bills: true })),
    names: NAMES,
    fullNames: NAMES,
    ...extra,
  };
  return buildContext({ sessions, billing, now: NOW, links: [], rules: [], adminIds: [] });
}

const STATEMENTS = [
  sent('sam'),
  sent('tia', { month_cents: 3000, due_cents: 3000 }),
  sent('vic', { sent_on: '2026-10-28', month_cents: null, previous_cents: null, due_cents: null }),
];
const names = (list) => list.map((x) => x.name);

describe('release planning: who is ready, held back, already out', () => {
  const b = october({ statements: STATEMENTS });
  const plan = releasePlan(b, MONTH, TODAY, { noLogin: new Set(['alan']) });

  test('a family with a rate is ready, whether or not attendance was recorded', () => {
    expect(names(plan.ready)).toEqual(['Alan Wang', 'Vic Hu']);
    expect(plan.ready[0]).toMatchObject({ parentId: 'alan', noLogin: true, previous: 0 });
    expect(plan.ready[0].action).toMatchObject({ kind: 'mark', blocked: false });
  });

  test('a statement marked sent before the portal kept copies is ready to save a copy, on the day it really went out', () => {
    expect(plan.ready[1]).toMatchObject({ parentId: 'vic', noLogin: false });
    expect(plan.ready[1].action).toMatchObject({ kind: 'save', sentOn: '2026-10-28' });
  });

  test('a family that already has a released statement is left alone, and one that changed since is flagged, not rewritten', () => {
    expect(plan.already.map((x) => [x.name, x.changed, x.sentOn])).toEqual([['Sam Roy', false, '2026-11-01'], ['Tia Ng', true, '2026-11-01']]);
    expect(plan.ready.map((x) => x.parentId)).not.toContain('tia');
  });

  test('held back, with the reason: no family rate, nothing owed, no paying parent', () => {
    expect(plan.held.map((x) => [x.name, x.reason])).toEqual([
      ['Maya Ito', 'no_payer'], ['Nina Cho', 'nothing'], ['Ryan Li', 'blocked'],
    ]);
    const ryan = plan.held.find((x) => x.parentId === 'ryan');
    expect(ryan.detail).toBe('1 session has no family rate (add one on Rates)');
    expect(plan.held.find((x) => x.studentId === 'maya')).toMatchObject({ parentId: null, detail: 'no paying parent is linked to this student' });
  });

  test('the blocked families are exactly the ones Mark paid and Record payment are blocked for', () => {
    for (const f of familyRows(b, MONTH)) {
      const blockedHere = plan.held.some((x) => x.parentId === f.parentId && x.reason === 'blocked');
      expect(blockedHere, f.name).toBe(!familyBlockers(b, f.parentId, MONTH).ok && !plan.already.some((x) => x.parentId === f.parentId));
    }
  });

  test('every family lands in exactly one list', () => {
    const ids = [...plan.ready, ...plan.already, ...plan.held.filter((x) => x.parentId)].map((x) => x.parentId).sort();
    expect(ids).toEqual(familyRows(b, MONTH).map((f) => f.parentId).sort());
    expect(releaseCounts(plan)).toEqual({ ready: 2, readyNoLogin: 1, already: 2, changed: 1, held: 3, heldFamilies: 2, families: 6 });
  });

  test('a month with only a balance brought forward still goes out; a credit with no charges too; nothing at all does not', () => {
    // nina cancelled in October and owed $20 for September: the statement shows what is due
    const withDebt = october({
      extra: {
        adjustments: [{ party: 'family', party_id: 'nina', period: '2026-09-01', amount_cents: 2000, label: 'late_fee', note: null, voided_at: null }],
        settings: { ...SETTINGS, ledger_start: '2026-09-01' },
      },
    });
    const p = releasePlan(withDebt, MONTH, TODAY);
    expect(p.ready.map((x) => x.parentId)).toContain('nina');
    expect(p.ready.find((x) => x.parentId === 'nina').previous).toBe(2000);
    const credit = october({ extra: { adjustments: [{ party: 'family', party_id: 'nina', period: MONTH, amount_cents: -1000, label: 'credit', note: null, voided_at: null }] } });
    expect(releasePlan(credit, MONTH, TODAY).ready.map((x) => x.parentId)).toContain('nina');
  });

  test('a month that has not ended is planned the same way, with a flag for the warning', () => {
    expect(plan.monthEnded).toBe(true);
    expect(releasePlan(b, MONTH, '2026-10-20').monthEnded).toBe(false);
    expect(releasePlan(b, MONTH, '2026-10-31').monthEnded).toBe(false);
    expect(releasePlan(b, MONTH, '2026-11-01').monthEnded).toBe(true);
    expect(releasePlan(b, MONTH, '2026-10-20').ready.map((x) => x.parentId)).toEqual(plan.ready.map((x) => x.parentId));
  });

  test('needsAttention is worked out once for the whole month, with the same answer as one family at a time', () => {
    const attention = needsAttention(b, MONTH, monthEnd(MONTH), { sessionsOnly: true });
    for (const f of familyRows(b, MONTH)) {
      expect(familyBlockers(b, f.parentId, MONTH, { attention })).toEqual(familyBlockers(b, f.parentId, MONTH));
    }
  });
});

describe('what the page and the dialog say', () => {
  const b = october({ statements: STATEMENTS });
  const plan = releasePlan(b, MONTH, TODAY, { noLogin: new Set(['alan']) });

  test('the confirm dialog counts who will be released, who is already out, and who is held back and why', () => {
    const copy = releaseCopy(plan);
    expect(copy.title).toBe('Release October 2026 bills?');
    expect(copy.confirmLabel).toBe('Release 2 bills');
    expect(copy.lines).toEqual([
      '2 families will be released. Each paying parent with a login can then read the bill under Billing in the portal.',
      '1 of them has no login, so that statement reaches them as copied text or a printout, from its row here.',
      '2 families are already released and will not be touched. 1 of them has changed since: use Release again on its row.',
    ]);
    expect(copy.heldTitle).toBe('Held back (3)');
    expect(copy.held).toEqual([
      'Maya Ito: no paying parent is linked to this student',
      'Nina Cho: nothing owed for the month',
      'Ryan Li: 1 session has no family rate (add one on Rates)',
    ]);
    expect(copy.warning).toBeNull();
  });

  test('a month that has not ended gets a warning, not a block', () => {
    const early = releaseCopy(releasePlan(b, MONTH, '2026-10-20'));
    expect(early.warning.title).toBe('October 2026 has not ended yet');
    expect(early.warning.text).toContain('count only what has happened so far');
    expect(early.warning.text).toContain('usually released on Sun, Nov 1');
    expect(early.confirmLabel).toBe('Release 2 bills');
  });

  test('singular and plural, and nothing ready leaves no release button', () => {
    const one = { ...plan, ready: plan.ready.slice(0, 1), already: [], held: [] };
    expect(releaseCopy(one).confirmLabel).toBe('Release 1 bill');
    expect(releaseCopy(one).lines[0]).toMatch(/^1 family will be released/);
    const none = releaseCopy({ ...plan, ready: [] });
    expect(none.title).toBe('Nothing to release for October 2026');
    expect(none.confirmLabel).toBeNull();
    expect(none.lines[0]).toBe('No family is ready to release.');
  });

  test('the strip under the month picker says where the month stands', () => {
    expect(releaseHeadline(plan)).toEqual({
      title: '2 of 6 families released',
      meta: '2 are ready. 2 held back. 1 changed since release. 1 student has no paying parent.',
      tone: 'ready',
    });
    const fresh = releasePlan(october(), MONTH, TODAY);
    expect(releaseHeadline(fresh).title).toBe('None of 6 families released yet');
    expect(releaseHeadline(fresh).meta).toContain('Parents see nothing until you release.');
    expect(releaseHeadline(releasePlan(october(), MONTH, '2026-10-20'))).toMatchObject({ tone: 'waiting' });
    expect(releaseHeadline(releasePlan(october(), MONTH, '2026-10-20')).meta).toBe('4 are ready. 2 held back. 1 student has no paying parent. October 2026 has not ended yet (usually released Nov 1).');
    // everything out
    const done = { ...plan, ready: [], held: plan.held.filter((x) => x.reason === 'no_payer') };
    expect(releaseHeadline(done)).toMatchObject({ title: 'All 2 families released', tone: 'done' });
    expect(releaseHeadline(done).meta).toBe('1 family has changed since release. Open its row and use Release again. 1 student has no paying parent.');
    expect(releaseHeadline({ ...done, held: [], already: done.already.slice(0, 1) }).meta).toBe('Parents can read them under Billing in the portal.');
  });

  test('the words use release, never sent, and never a dash', () => {
    const texts = [
      ...Object.values(releaseCopy(plan)).flat().map((x) => (x && typeof x === 'object' ? Object.values(x).join(' ') : String(x))),
      ...Object.values(releaseHeadline(plan)),
      releaseDoneText({ name: 'Alan Wang', noLogin: false, dueDay: 'Sun, Nov 15' }),
      releaseDoneText({ name: 'Alan Wang', noLogin: true, dueDay: 'Sun, Nov 15', again: true }),
      releaseLabel(null, TODAY), releaseLabel({ sent_on: '2026-11-01' }, TODAY),
    ].join('\n');
    expect(texts).not.toMatch(/[–—]/);
    expect(texts).not.toMatch(/\b(marked sent|mark sent|send again|sent on)\b/i);
  });

  test('a family row reads Not released yet, then Released Nov 1', () => {
    expect(releaseLabel(null, TODAY)).toBe('Not released yet');
    expect(releaseLabel({ sent_on: '2026-11-01' }, TODAY)).toBe('Released Nov 1');
    expect(releaseDoneText({ name: 'Alan Wang', noLogin: false, dueDay: 'Sun, Nov 15' })).toBe('Released. Alan Wang can read the bill under Billing in the portal, due Sun, Nov 15.');
    expect(releaseDoneText({ name: 'Alan Wang', noLogin: false, dueDay: 'Sun, Nov 15', again: true })).toBe('Released again. Alan Wang now sees the new bill, due Sun, Nov 15.');
    expect(releaseDoneText({ name: 'Zed Park', noLogin: true, dueDay: 'Sun, Nov 15' })).toBe('Released. Zed Park has no login yet, so copy or print the statement to send it.');
  });

  test('the status column follows the bill: Not released yet, Released Nov 1, and the old Sent for a statement the portal has no copy of', () => {
    const status = (parent, ctx = october({ statements: STATEMENTS })) => familyStatus(ctx, familyMonth(ctx, parent, MONTH));
    expect(status('alan')).toMatchObject({ key: 'unpaid', label: 'Not released yet' });
    expect(status('sam')).toMatchObject({ key: 'released', label: 'Released Nov 1' });
    expect(status('vic')).toMatchObject({ key: 'sent', label: 'Sent Oct 28' });
    // a released bill that is paid, or overdue, reads as that
    const paid = october({ statements: [sent('sam')], extra: { payments: [{ parent_id: 'sam', period: MONTH, amount_cents: 4500, received_on: '2026-11-02', created_at: 'a', lines: [], owed_cents: 4500 }] } });
    expect(status('sam', paid).key).toBe('paid');
    // the CSV keeps payment status; the release day is its own column
    const csv = familiesCsv(familyRows(october({ statements: STATEMENTS }), MONTH));
    expect(csv).toContain('Family,Students,Hours,Owed,Paid,Balance,Status,Released');
    expect(csv).toContain('Alan Wang,1,1.00,45.00,0.00,45.00,Unpaid,\r\n');
    expect(csv).toContain('Sam Roy,1,1.00,45.00,0.00,45.00,Unpaid,2026-11-01\r\n');
    // marked sent before the portal kept a copy: not released
    expect(csv).toContain('Vic Hu,1,1.00,45.00,0.00,45.00,Unpaid,\r\n');
  });

  test('the policy text tells the admin parents see nothing until release', () => {
    const text = policyText(POLICY, SETTINGS);
    expect(text).toContain('A parent sees a month’s bill in the portal only after you release it, usually on the 1st');
    expect(text).toContain('with the bill dated the 1st of the next month and due on the 15th');
    expect(text).not.toMatch(/[–—]/);
  });
});

describe('releasing a month: one family at a time, safe to run again', () => {
  const ok = (id) => ({ data: [{ parent_id: id }], error: null });
  const b = october({ statements: STATEMENTS });

  test('writes the ready families in order and reports progress', async () => {
    const plan = releasePlan(b, MONTH, TODAY);
    const calls = [];
    const progress = [];
    const result = await releaseAll(plan.ready, async (item) => {
      calls.push(item.parentId);
      await new Promise((resolve) => setTimeout(resolve, 5 - calls.length));
      return ok(item.parentId);
    }, { onProgress: (p) => progress.push([p.done, p.total, p.item.parentId, p.outcome]) });
    expect(calls).toEqual(['alan', 'vic']);
    expect(progress).toEqual([[1, 2, 'alan', 'released'], [2, 2, 'vic', 'released']]);
    expect(result.released.map((x) => x.parentId)).toEqual(['alan', 'vic']);
    expect(result.failed).toEqual([]);
  });

  test('a family that already has a statement (a duplicate key) is skipped, not counted as a failure', () => {
    expect(outcomeOf({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "statements_pkey"' } })).toBe('skipped');
  });

  test('an error, a refusal with no rows, or a throw is a failure; the rest still go out', async () => {
    const plan = { ready: [{ parentId: 'a', name: 'Ann' }, { parentId: 'b', name: 'Bo' }, { parentId: 'c', name: 'Cy' }, { parentId: 'd', name: 'Di' }, { parentId: 'e', name: 'Ed' }] };
    const result = await releaseAll(plan.ready, async (item) => {
      if (item.parentId === 'a') return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
      if (item.parentId === 'b') return { data: [], error: null };
      if (item.parentId === 'c') throw new Error('network down');
      if (item.parentId === 'd') return { data: null, error: { code: '23505', message: 'duplicate key' } };
      return ok(item.parentId);
    });
    expect(result.failed.map((x) => [x.name, x.message])).toEqual([
      ['Ann', 'new row violates row-level security policy'], ['Bo', 'The database did not save it'], ['Cy', 'network down'],
    ]);
    expect(result.skipped.map((x) => x.parentId)).toEqual(['d']);
    expect(result.released.map((x) => x.parentId)).toEqual(['e']);
    const copy = releaseResultCopy(result, { month: MONTH });
    expect(copy.title).toBe('Released 1 of 4 October 2026 bills');
    expect(copy.failed).toEqual(['Ann: did not save', 'Bo: did not save', 'Cy: did not save']);
    expect(copy.lines).toContain('1 family was already released and was left alone.');
    expect(copy.lines.at(-1)).toBe('Close this and press Release bills again to retry them. Families already released are skipped.');
  });

  test('retry: after a partial run only the families that did not save are planned again', async () => {
    const first = releasePlan(b, MONTH, TODAY);
    const saved = [];
    const result = await releaseAll(first.ready, async (item) => {
      if (item.parentId === 'vic') return { data: null, error: { code: '08006', message: 'connection lost' } };
      saved.push(item.parentId);
      return ok(item.parentId);
    });
    expect(saved).toEqual(['alan']);
    expect(result.failed.map((x) => x.name)).toEqual(['Vic Hu']);
    // the page reloads: alan now has a released statement for the month
    const reloaded = october({ statements: [...STATEMENTS, sent('alan', { sent_on: TODAY })] });
    const second = releasePlan(reloaded, MONTH, TODAY);
    expect(second.ready.map((x) => x.parentId)).toEqual(['vic']);
    expect(second.already.map((x) => x.parentId)).toContain('alan');
    const again = await releaseAll(second.ready, async (item) => ok(item.parentId));
    expect(again.released.map((x) => x.parentId)).toEqual(['vic']);
    // a third press with everything out has nothing left to write
    const done = october({ statements: [...STATEMENTS.filter((s) => s.parent_id !== 'vic'), sent('alan'), sent('vic')] });
    expect(releasePlan(done, MONTH, TODAY).ready).toEqual([]);
    expect(releaseCopy(releasePlan(done, MONTH, TODAY)).confirmLabel).toBeNull();
  });

  test('a stale page that tries to release a family someone else already released skips it', async () => {
    const result = await releaseAll(releasePlan(b, MONTH, TODAY).ready, async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }));
    expect(result.skipped).toHaveLength(2);
    expect(releaseResultCopy(result, { month: MONTH }).title).toBe('October 2026 bills were already released');
  });

  test('the result says who has no login so their statement is copied or printed', async () => {
    const plan = releasePlan(b, MONTH, TODAY, { noLogin: new Set(['alan']) });
    const result = await releaseAll(plan.ready, async (item) => ok(item.parentId));
    const copy = releaseResultCopy(result, plan);
    expect(copy.title).toBe('Released 2 October 2026 bills');
    expect(copy.lines).toContain('1 has no login yet: copy or print that statement from its row.');
  });

  test('the number a parent will quote matches the statement', () => {
    expect(statementNumber('alan', MONTH)).toBe('2026-10-ALAN');
  });
});

// ---------------------------------------------------------------------------
// Nothing about a month reaches a family before it is released

describe('nothing leaks before release', () => {
  const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  const allSql = migrations.map((f) => [f, read(`supabase/migrations/${f}`)]);

  test('my_statements() returns only the caller\'s own statements that have a saved snapshot', () => {
    const body = /create function public\.my_statements\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(read('supabase/migrations/20261014120000_parent_statements.sql'))[1];
    expect(body).toMatch(/s\.parent_id = auth\.uid\(\)/);
    expect(body).toMatch(/s\.snapshot is not null/);
    // the caller's payments only, never anyone else's
    expect(body).toMatch(/p\.parent_id = auth\.uid\(\)/);
    // no later migration redefines it without the filter
    for (const [file, sql] of allSql) {
      if (file === '20261014120000_parent_statements.sql' || !/function public\.my_statements/.test(sql)) continue;
      expect(sql, file).toMatch(/s\.snapshot is not null/);
    }
  });

  test('every policy on statements and the billing tables is admin only; there is no parent policy', () => {
    const tables = ['statements', 'payments', 'payouts', 'billing_adjustments', 'billing_contacts', 'family_rates', 'tutor_rates', 'session_billing', 'billing_settings', 'billing_policies'];
    for (const [file, sql] of allSql) {
      for (const m of sql.matchAll(/create policy "[^"]+"\s+on public\.(\w+)([\s\S]*?);/g)) {
        if (!tables.includes(m[1])) continue;
        expect(m[0], `${file}: ${m[1]}`).toMatch(/is_admin\(\)/);
      }
    }
  });

  test('only my_statements() hands money to a non-admin: no other public function mentions cents', () => {
    const offenders = [];
    for (const [file, sql] of allSql) {
      for (const m of sql.matchAll(/create (?:or replace )?function public\.(\w+)\([\s\S]*?\n\$\$;?/g)) {
        if (/cents/.test(m[0]) && m[1] !== 'my_statements') offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('only the Account pages and the store read the billing tables; the parent Billing page reads my_statements() and nothing else', () => {
    const MONEY = /\.from\(\s*['"](payments|payouts|statements|family_rates|tutor_rates|billing_\w+|session_billing)['"]/;
    const ALLOWED = new Set(['store.js', 'views/account-families.js', 'views/account-release.js', 'views/account-payroll.js', 'views/account-rates.js', 'views/account-shared.js']);
    const files = readdirSync(join(ROOT, 'portal/js'), { recursive: true }).map(String).filter((f) => f.endsWith('.js'));
    const readers = files.filter((f) => MONEY.test(read(`portal/js/${f}`)));
    expect(readers.filter((f) => !ALLOWED.has(f))).toEqual([]);
    const callers = files.filter((f) => /rpc\(\s*['"]my_statements['"]/.test(read(`portal/js/${f}`)));
    expect(callers).toEqual(['views/billing.js']);
    // the family page opens Billing's rows from the rpc alone
    const billing = read('portal/js/views/billing.js');
    expect(billing).not.toMatch(/\.from\(/);
    expect(billing).toContain("sb.rpc('my_statements')");
  });

  test('the Account views are only in the admin page\'s routes, and that page requires an admin', () => {
    const routes = read('portal/js/routes.js');
    const accountStart = routes.indexOf('export function accountRoutes');
    const before = routes.slice(0, accountStart).split('\n').filter((l) => !l.startsWith('import ')).join('\n');
    expect(before).not.toMatch(/account(Dashboard|Families|Payroll|Rates|Print)/);
    expect(read('portal/js/account.js')).toContain("requireRole(['admin'])");
  });

  test('a month appears on the parent Billing page only as a row from my_statements(); the empty state says it is released first', () => {
    const billing = read('portal/js/views/billing.js');
    expect(billing).toContain('Your bill for a month appears here once we release it, usually on the 1st of the next month.');
    expect(billing).not.toMatch(/once they are sent|as they were sent|marked sent/i);
    expect(billing).not.toMatch(/[–—]/);
  });

  test('the old words are gone from the Families page', () => {
    const families = read('portal/js/views/account-families.js');
    for (const gone of ['Mark sent', 'marked sent', 'Changed since sent', 'send again', 'Send again', 'sent on']) expect(families).not.toContain(gone);
    expect(families).toContain("label: 'Release'");
    expect(families).toContain("label: 'Release again'");
    expect(read('portal/js/views/account-release.js')).toContain("label: 'Release bills'");
  });
});
