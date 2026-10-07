import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext, familyRows, familyBlockers, familySnapshot, needsAttention, monthEnd } from '../../portal/js/billing-model.js';
import {
  FAMILY_METHODS, paidMethod, markPaidPlan, paidControl, latestPayment, paymentRow, paymentOutcome,
  markPaidText, undoDoneText, markPaidLabel, undoLabel, heldNote, UNDO_REASON,
} from '../../portal/js/billing-paid.js';
import { zonedIso } from '../../portal/js/dates.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

// Wednesday, November 18, 2026, noon Pacific
const NOW = new Date(zonedIso('2026-11-18', '12:00'));
const MONTH = '2026-11-01';
const at = (day, time) => zonedIso(day, time);
const SETTINGS = {
  business_name: 'VP Education Group', payroll_anchor: '2026-11-01', pay_lag_days: 6, due_day: 15,
  ledger_start: '2026-11-01', pay_note: null,
};
const POLICY = { effective_from: '2026-11-01', absent_family_pct: 100, absent_tutor_pct: 100, count_unconfirmed: true };

let nextId = 1;
const session = (student, day, extra = {}) => ({
  id: nextId++, student_id: student, tutor_id: 'ethan', series_id: null, subject: 'Math',
  starts_at: at(day, '16:00'), ends_at: at(day, '17:00'), status: 'scheduled', attendance: 'present',
  created_at: at('2026-10-01', '09:00'), cancelled_at: null, ...extra,
});
const rate = (student, cents) => ({ id: nextId++, student_id: student, subject: 'Math', tutor_id: null, rate_cents: cents, effective_from: '2026-11-01', voided_at: null });
const NAMES = new Map([['grace', 'Grace'], ['ian', 'Ian'], ['ethan', 'Ethan Poon'], ['hana', 'Hana'], ['jo', 'Jo']]);
const payment = (extra = {}) => ({
  id: nextId++, parent_id: 'grace', period: MONTH, amount_cents: 50000, method: 'zelle', received_on: '2026-11-10',
  created_at: '2026-11-10T20:00:00Z', owed_cents: 127500, lines: [], voided_at: null, ...extra,
});

// Grace: 15 one-hour lessons at $85 = $1,275.00. Hana: one lesson, no rate. Jo: nothing yet.
const fifteen = () => Array.from({ length: 15 }, (_, i) => session('ian', `2026-11-${String(i + 2).padStart(2, '0')}`));
function books({ sessions = fifteen(), extra = {}, rates = [rate('ian', 8500)] } = {}) {
  return buildContext({
    sessions,
    now: NOW,
    billing: {
      settings: SETTINGS,
      policies: [POLICY],
      familyRates: rates,
      tutorRates: [{ id: nextId++, tutor_id: 'ethan', rate_cents: 3000, effective_from: '2026-11-01', voided_at: null }],
      sessionBilling: [], payments: [], payouts: [], adjustments: [], contacts: [], statements: [],
      parentLinks: [{ parent_id: 'grace', student_id: 'ian', bills: true }, { parent_id: 'hana', student_id: 'kai', bills: true }],
      names: NAMES, fullNames: NAMES,
      ...extra,
    },
  });
}
const rowOf = (ctx, parent = 'grace') => familyRows(ctx, MONTH).find((f) => f.parentId === parent);
const plan = (ctx, parent = 'grace') => {
  const f = rowOf(ctx, parent);
  return markPaidPlan(f, { held: !familyBlockers(ctx, parent, MONTH).ok });
};

describe('who gets Mark paid, and for how much', () => {
  test('a family with a balance due for the month: exactly what the row shows as due', () => {
    const ctx = books();
    const f = rowOf(ctx);
    expect(f.dueCents).toBe(127500);
    expect(plan(ctx)).toEqual({ ok: true, cents: 127500, method: 'zelle' });
    expect(markPaidText({ name: 'Grace', cents: 127500, method: 'zelle' })).toBe('Grace marked paid: $1,275.00 by Zelle.');
  });

  test('the amount is the month only, never a balance brought forward', () => {
    const oct = { ...SETTINGS, ledger_start: '2026-10-01' };
    const ctx = books({ sessions: [...fifteen(), session('ian', '2026-10-12')], extra: { settings: oct } });
    expect(rowOf(ctx).dueCents).toBe(127500);
    expect(plan(ctx).cents).toBe(127500);
  });

  test('a partial payment leaves Mark paid for the remaining balance', () => {
    const ctx = books({ extra: { payments: [payment({ amount_cents: 50000 })] } });
    const f = rowOf(ctx);
    expect(f.status).toMatchObject({ key: 'partial', label: 'Paid $500.00 of $1,275.00' });
    expect(plan(ctx)).toMatchObject({ ok: true, cents: 77500 });
    expect(paidControl(f)).toMatchObject({ kind: 'mark', cents: 77500 });
  });

  test('a lesson added after a payment: Mark paid records the difference', () => {
    const ctx = books({ sessions: [...fifteen(), session('ian', '2026-11-17')], extra: { payments: [payment({ amount_cents: 127500 })] } });
    expect(rowOf(ctx).status.key).toBe('partial');
    expect(plan(ctx).cents).toBe(8500);
  });

  test('the method is the family’s usual one when it is a real one, else Zelle', () => {
    expect(paidMethod({ preferred_method: 'check' })).toBe('check');
    expect(paidMethod({ preferred_method: 'venmo' })).toBe('venmo');
    expect(paidMethod({ preferred_method: 'payroll' })).toBe('zelle');
    expect(paidMethod({ preferred_method: null })).toBe('zelle');
    expect(paidMethod(null)).toBe('zelle');
    expect(plan(books({ extra: { contacts: [{ parent_id: 'grace', preferred_method: 'cash' }] } })).method).toBe('cash');
    expect(markPaidText({ name: 'Grace', cents: 4500, method: 'check' })).toBe('Grace marked paid: $45.00 by Check.');
    expect(FAMILY_METHODS).toEqual(['zelle', 'venmo', 'check', 'cash', 'card', 'other']);
  });

  test('held back while a session has no family rate; a rate frees it', () => {
    const sessions = [...fifteen(), session('ian', '2026-11-17', { subject: 'Piano' })];
    const ctx = books({ sessions, rates: [{ ...rate('ian', 8500), subject: 'Math' }] });
    expect(familyBlockers(ctx, 'grace', MONTH).ok).toBe(false);
    expect(plan(ctx)).toEqual({ ok: false, reason: 'held' });
    expect(paidControl(rowOf(ctx), { held: true })).toEqual({ kind: null });
    const fixed = books({ sessions, rates: [rate('ian', 8500), { ...rate('ian', 6000), subject: 'Piano' }] });
    expect(plan(fixed)).toMatchObject({ ok: true, cents: 127500 + 6000 });
  });

  test('a session without attendance, or one added late, does not hold it back: it counts as held', () => {
    const sessions = [session('ian', '2026-11-03', { attendance: null }), session('ian', '2026-11-04', { created_at: at('2026-11-10', '09:00') })];
    const ctx = books({ sessions });
    expect(needsAttention(ctx, MONTH, monthEnd(MONTH), { sessionsOnly: true }).items).toEqual([]);
    expect(plan(ctx)).toMatchObject({ ok: true, cents: 17000 });
  });

  test('nothing due, nothing to mark: nothing owed, all cancelled, upcoming, paid in full, credit', () => {
    expect(markPaidPlan({ parentId: 'grace', dueCents: 0, status: { key: 'nothing' } })).toEqual({ ok: false, reason: 'nothing_due' });
    const cancelled = books({ sessions: [session('ian', '2026-11-03', { status: 'cancelled', attendance: 'present' })] });
    expect(plan(cancelled)).toEqual({ ok: false, reason: 'nothing_due' });
    const upcoming = books({ sessions: [session('ian', '2026-11-25')] });
    expect(rowOf(upcoming).status.key).toBe('upcoming');
    expect(plan(upcoming)).toEqual({ ok: false, reason: 'nothing_due' });
    const paid = books({ extra: { payments: [payment({ amount_cents: 127500 })] } });
    expect(plan(paid)).toEqual({ ok: false, reason: 'nothing_due' });
    const credit = books({ extra: { payments: [payment({ amount_cents: 130000 })] } });
    expect(rowOf(credit).status.key).toBe('credit');
    expect(plan(credit)).toEqual({ ok: false, reason: 'nothing_due' });
  });

  test('a family already covered by an earlier credit is not asked to pay again', () => {
    const ctx = books({ extra: { payments: [payment({ period: null, amount_cents: 300000, received_on: '2026-10-20' })] } });
    const f = rowOf(ctx);
    expect(f.status.key).toBe('covered');
    expect(f.dueCents).toBeGreaterThan(0);
    expect(markPaidPlan(f)).toEqual({ ok: false, reason: 'covered' });
  });

  test('a row with no paying parent has no button', () => {
    expect(markPaidPlan({ parentId: '', dueCents: 4500 })).toEqual({ ok: false, reason: 'no_payer' });
    expect(markPaidPlan(null)).toEqual({ ok: false, reason: 'no_payer' });
  });
});

describe('the row: Mark paid, then Paid with its date and an Undo', () => {
  test('unpaid shows Mark paid; paid in full shows the date and Undo for the newest payment', () => {
    const open = rowOf(books());
    expect(paidControl(open)).toEqual({ kind: 'mark', cents: 127500, method: 'zelle' });
    const first = payment({ id: 7, amount_cents: 27500, created_at: '2026-11-10T20:00:00Z', received_on: '2026-11-10' });
    const second = payment({ id: 8, amount_cents: 100000, created_at: '2026-11-12T20:00:00Z', received_on: '2026-11-12' });
    const paid = rowOf(books({ extra: { payments: [first, second] } }));
    expect(paid.status).toMatchObject({ key: 'paid', label: 'Paid Nov 12', tone: 'success' });
    expect(paidControl(paid)).toEqual({ kind: 'undo', payment: second });
    // undoing the last one leaves "Paid $x of $y" and Mark paid for the rest
    const back = rowOf(books({ extra: { payments: [first] } }));
    expect(back.status.label).toBe('Paid $275.00 of $1,275.00');
    expect(paidControl(back)).toMatchObject({ kind: 'mark', cents: 100000 });
  });

  test('the newest payment is by when it was recorded, then by id', () => {
    const a = { id: 3, created_at: '2026-11-10T10:00:00Z' };
    const b = { id: 2, created_at: '2026-11-10T11:00:00Z' };
    const c = { id: 9, created_at: '2026-11-10T11:00:00Z' };
    expect(latestPayment([a, b])).toBe(b);
    expect(latestPayment([b, c, a])).toBe(c);
    expect(latestPayment([])).toBeNull();
    expect(latestPayment(undefined)).toBeNull();
  });
});

describe('the one insert, shared with the Record payment form', () => {
  const ctx = books();
  const f = rowOf(ctx);
  const KEY = '3b0c2c5e-6f1a-4a3e-9d52-0f7a5a1d9a11';

  test('one payment for the month: the same columns, with the lines snapshot', () => {
    const row = paymentRow(f, { key: KEY, month: MONTH, cents: 127500, method: 'zelle', receivedOn: '2026-11-18' });
    expect(Object.keys(row)).toEqual(['client_key', 'parent_id', 'period', 'amount_cents', 'method', 'received_on', 'reference', 'lines', 'owed_cents']);
    expect(row).toMatchObject({
      client_key: KEY, parent_id: 'grace', period: MONTH, amount_cents: 127500, method: 'zelle', received_on: '2026-11-18', reference: null, owed_cents: 127500,
    });
    expect(row.lines).toEqual(familySnapshot(f));
    expect(row.lines).toHaveLength(15);
    expect(row.lines[0]).toMatchObject({ day: '2026-11-02', student_id: 'ian', amount_cents: 8500, rate_cents: 8500 });
  });

  test('a loose payment (a prepayment or several months) has no month and no lines', () => {
    const row = paymentRow(f, { key: KEY, month: MONTH, cents: 30000, method: 'check', receivedOn: '2026-11-18', reference: '1042', loose: true });
    expect(row).toMatchObject({ period: null, lines: [], owed_cents: 0, reference: '1042', method: 'check' });
  });

  test('an insert result reads back as saved, a resend that landed, or failed', () => {
    expect(paymentOutcome({ data: [{ id: 41 }], error: null })).toEqual({ ok: true, id: 41, duplicate: false });
    expect(paymentOutcome({ data: { id: 5 }, error: null })).toMatchObject({ ok: true, id: 5 });
    expect(paymentOutcome({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "payments_client_key_key" (client_key)' } }))
      .toEqual({ ok: true, id: null, duplicate: true });
    expect(paymentOutcome({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "other"' } }).ok).toBe(false);
    expect(paymentOutcome({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }).ok).toBe(false);
    // row security refusing it comes back as no rows
    expect(paymentOutcome({ data: [], error: null }).ok).toBe(false);
    expect(paymentOutcome(undefined).ok).toBe(false);
  });
});

describe('words', () => {
  test('toast, labels and the held note', () => {
    expect(markPaidText({ name: 'Grace', cents: 127500, method: 'zelle' })).toBe('Grace marked paid: $1,275.00 by Zelle.');
    expect(undoDoneText('Grace')).toBe('Payment from Grace undone.');
    expect(markPaidLabel({ name: 'Grace', cents: 127500 })).toBe('Mark Grace paid, $1,275.00');
    expect(undoLabel({ name: 'Grace', payment: { amount_cents: 127500 } })).toBe('Undo the $1,275.00 payment from Grace');
    expect(heldNote({ items: [{}] })).toEqual({
      title: '1 session has no family rate',
      text: 'Add a rate on Rates before marking the month paid, recording a payment or releasing the bill.',
    });
    expect(heldNote({ items: [{}, {}] }).title).toBe('2 sessions have no family rate');
    expect(UNDO_REASON.length).toBeGreaterThan(0);
  });

  test('no dashes in anything the admin reads', () => {
    const text = [
      markPaidText({ name: 'Grace', cents: 127500, method: 'zelle' }), undoDoneText('Grace'), markPaidLabel({ name: 'Grace', cents: 100 }),
      undoLabel({ name: 'Grace', payment: { amount_cents: 100 } }), ...Object.values(heldNote({ items: [{}] })), UNDO_REASON,
    ].join('\n');
    expect(text).not.toMatch(/[–—]/);
  });
});

describe('wiring on the Families page', () => {
  const families = read('portal/js/views/account-families.js');

  test('Mark paid and the Record payment form write the same row, from the one shared builder', () => {
    expect(families).toContain("from '../billing-paid.js'");
    expect(families.match(/paymentRow\(f, \{/g)).toHaveLength(2);
    // the page no longer spells out the columns itself
    expect(families).not.toContain('owed_cents:');
    expect(families).not.toContain('lines: ');
  });

  test('the row offers Mark paid, then Undo; the toast carries an Undo that voids the payment', () => {
    expect(families).toContain("label: 'Mark paid'");
    expect(families).toContain("label: 'Undo'");
    expect(families).toContain("{ label: 'Undo', run: () => undoPaid(f.name, id) }");
    expect(families).toContain('markPaidText(');
    expect(families).toContain('todayKey(new Date())');
    // the Record payment form stays
    expect(families).toContain("h('h4', {}, 'Record payment')");
    expect(families).toContain("label: 'Record payment'");
    // the toast's Undo and the Details void are the same update
    expect(families).toContain('const voidQuery = (tableName, id, reason) => sb.from(tableName).update({ voided_at');
    expect(families.match(/voidQuery\(/g)).toHaveLength(2);
  });

  test('no em or en dash in the page or its helpers', () => {
    for (const file of ['portal/js/billing-paid.js', 'portal/js/views/account-families.js', 'portal/js/views/account-dashboard.js']) {
      expect(read(file), file).not.toMatch(/[–—]/);
    }
  });
});

describe('the removed audit layer is gone from the views', () => {
  const dashboard = read('portal/js/views/account-dashboard.js');
  const families = read('portal/js/views/account-families.js');
  const payroll = read('portal/js/views/account-payroll.js');
  const shared = read('portal/js/views/account-shared.js');
  const model = read('portal/js/billing-model.js');

  test('no Accept, attendance, Restore or Keep cancelled controls for removed kinds', () => {
    for (const gone of ['Restore', 'Keep cancelled', "label: 'Present'", "label: 'Absent'", 'Mark all', 'older_unconfirmed', 'deleted_late', 'changed_paid']) {
      expect(dashboard, gone).not.toContain(gone);
    }
    // Accept stays only for the overlap list
    expect(dashboard.match(/label: 'Accept'/g)).toHaveLength(1);
    expect(shared).not.toContain('markAttendance');
    expect(families).not.toContain('changedSincePayment');
    expect(payroll).not.toContain("'unconfirmed' ? 'danger'");
  });

  test('the model has no flags, kinds or states for what was removed', () => {
    for (const gone of ['added_late', "'longer'", "'altered'", "'conflict'", 'deleted_late', 'older_unconfirmed', 'changed_paid', 'FAMILY_BLOCKS', 'TUTOR_BLOCKS', 'changedSincePayment', 'editsOf']) {
      expect(model, gone).not.toContain(gone);
    }
    // the audit table is still loaded by the store, untouched
    expect(read('portal/js/store.js')).toContain("sb.from('session_edits')");
  });
});

describe('pay dates are shown where a period is', () => {
  test('the Payroll period header, the printed pay summary and the CSV carry the pay date', () => {
    expect(read('portal/js/views/account-payroll.js')).toContain('payDateText(start)');
    expect(read('portal/js/views/account-print.js')).toContain("meta('Pay date', dayText(payDate(start), start))");
    expect(read('portal/js/billing-text.js')).toContain("'Period end', 'Pay date'");
  });
});
