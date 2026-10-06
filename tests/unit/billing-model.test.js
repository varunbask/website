import { describe, test, expect } from 'vitest';
import {
  money, signedMoney, hoursText, parseMoney, amountFor, monthOf, monthParam, addMonths, monthEnd, monthName,
  payPeriodStart, payPeriodEnd, periodsOverlapping, periodText, billDate, policyFor, familyRateFor, tutorRateFor,
  stateOf, buildContext, groupSlots, familyMonth, familyRows, familyBalance, familyStatus, allOutstanding,
  tutorPeriod, periodRows, periodStatus, rangeTotals, needsAttention, flagsFor,
  familyBlockers, tutorBlockers, familySnapshot, billingFact, inPaidPeriod, statementNumber,
  dueDate, yearToDate, isAccepted, dayText,
} from '../../portal/js/billing-model.js';
import {
  policyText, statementText, payoutText, payrollCsv, csvText, parseRateLines, matchRates, familiesCsv,
  statementSnapshot, statementStatus,
} from '../../portal/js/billing-text.js';
import { zonedIso } from '../../portal/js/dates.js';

// Wednesday, November 18, 2026, noon Pacific
const NOW = new Date(zonedIso('2026-11-18', '12:00'));
const at = (day, time) => zonedIso(day, time);

const SETTINGS = {
  business_name: 'VP Education Group', payroll_anchor: '2026-11-01', pay_lag_days: 6, due_day: 15,
  ledger_start: '2026-11-01', pay_note: 'Zelle: pay@vp.test',
};
const POLICY = { effective_from: '2026-11-01', absent_family_pct: 100, absent_tutor_pct: 100, count_unconfirmed: true };

let nextId = 1;
const session = (day, start, end, extra = {}) => ({
  id: nextId++, student_id: 'kevin', tutor_id: 'ethan', series_id: null, subject: 'Math',
  starts_at: at(day, start), ends_at: at(day, end), status: 'scheduled', attendance: null,
  created_at: at('2026-10-01', '09:00'), cancelled_at: null, ...extra,
});
const rate = (student, cents, extra = {}) => ({
  id: nextId++, student_id: student, subject: 'Math', tutor_id: null, rate_cents: cents, effective_from: '2026-11-01', voided_at: null, ...extra,
});
const trate = (tutor, cents, extra = {}) => ({ id: nextId++, tutor_id: tutor, rate_cents: cents, effective_from: '2026-11-01', voided_at: null, ...extra });

const NAMES = new Map([['kevin', 'Kevin Wang'], ['amy', 'Amy Li'], ['alan', 'Alan Wang'], ['ryan', 'Ryan Li'],
  ['ethan', 'Ethan Poon'], ['varun', 'Varun Baskaran'], ['jayden', 'Jayden Chu'], ['stella', 'Stella Chu']]);

function billing(extra = {}) {
  return {
    settings: SETTINGS,
    policies: [POLICY],
    familyRates: [rate('kevin', 4500), rate('amy', 6000)],
    tutorRates: [trate('ethan', 3000), trate('varun', 0)],
    sessionBilling: [],
    edits: [],
    payments: [],
    payouts: [],
    adjustments: [],
    contacts: [],
    statements: [],
    parentLinks: [{ parent_id: 'alan', student_id: 'kevin', bills: true }, { parent_id: 'ryan', student_id: 'amy', bills: true }],
    names: NAMES,
    ...extra,
  };
}
const ctxOf = (sessions, extra = {}, opts = {}) => buildContext({ sessions, billing: billing(extra), now: NOW, links: opts.links ?? [], rules: opts.rules ?? [], adminIds: ['varun'] });

describe('money and hours', () => {
  test('formats cents', () => {
    expect(money(4500)).toBe('$45.00');
    expect(money(123456)).toBe('$1,234.56');
    expect(money(-1250)).toBe('-$12.50');
    expect(money(0)).toBe('$0.00');
    expect(signedMoney(4500)).toBe('+$45.00');
    expect(signedMoney(-4500)).toBe('-$45.00');
    expect(hoursText(105)).toBe('1.75');
    expect(hoursText(60)).toBe('1.00');
  });

  test('reads typed amounts', () => {
    expect(parseMoney('45')).toBe(4500);
    expect(parseMoney('45.5')).toBe(4550);
    expect(parseMoney('$1,200.50')).toBe(120050);
    expect(parseMoney('0')).toBeNull();
    expect(parseMoney('0', { allowZero: true })).toBe(0);
    expect(parseMoney('-20')).toBeNull();
    expect(parseMoney('-20', { allowNegative: true })).toBe(-2000);
    expect(parseMoney('4.555')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
  });

  test('rounds each line to the cent', () => {
    expect(amountFor(45, 8500)).toBe(6375);
    expect(amountFor(50, 4500)).toBe(3750);
    expect(amountFor(60, 4500, 50)).toBe(2250);
    expect(amountFor(25, 3333)).toBe(1389);
  });
});

describe('months and pay periods', () => {
  test('months', () => {
    expect(monthOf('2026-11-18')).toBe('2026-11-01');
    expect(monthParam('2026-11')).toBe('2026-11-01');
    expect(monthParam('2026-11-01')).toBe('2026-11-01');
    expect(monthParam('2026-13')).toBeNull();
    expect(addMonths('2026-11-01', 2)).toBe('2027-01-01');
    expect(addMonths('2027-01-01', -1)).toBe('2026-12-01');
    expect(monthEnd('2026-02-01')).toBe('2026-02-28');
    expect(monthName('2026-11-01')).toBe('November 2026');
    expect(dayText('2026-11-03')).toBe('Tue, Nov 3');
  });

  test('tutor pay periods: the 1st to the 15th and the 16th to the last day', () => {
    expect(payPeriodStart('2026-11-01')).toBe('2026-11-01');
    expect(payPeriodStart('2026-11-15')).toBe('2026-11-01');
    expect(payPeriodStart('2026-11-16')).toBe('2026-11-16');
    expect(payPeriodStart('2026-11-30')).toBe('2026-11-16');
    expect(payPeriodEnd('2026-11-01')).toBe('2026-11-15');
    expect(payPeriodEnd('2026-11-16')).toBe('2026-11-30');
    expect(payPeriodEnd('2027-02-16')).toBe('2027-02-28');
    expect(payPeriodEnd('2028-02-16')).toBe('2028-02-29');
    expect(periodText('2026-12-16')).toBe('Dec 16 to Dec 31');
    expect(periodsOverlapping('2026-11-01', '2026-11-30')).toEqual(['2026-11-01', '2026-11-16']);
    expect(periodsOverlapping('2026-11-20', '2026-12-05')).toEqual(['2026-11-16', '2026-12-01']);
  });

  test('24 periods in a year', () => {
    expect(periodsOverlapping('2027-01-01', '2027-12-31')).toHaveLength(24);
  });

  test('a month is billed on the 1st of the next month', () => {
    expect(billDate('2026-09-01')).toBe('2026-10-01');
    expect(billDate('2026-12-15')).toBe('2027-01-01');
  });

  test('a late-night session stays on its Pacific day across months and DST', () => {
    const s = session('2026-10-31', '23:00', '23:45');
    expect(new Date(s.starts_at).toISOString().slice(0, 10)).toBe('2026-11-01');   // already Nov 1 in UTC
    const ctx = buildContext({ sessions: [s], billing: billing({ settings: { ...SETTINGS, ledger_start: '2026-10-01' } }), now: NOW });
    expect(ctx.rows[0].month).toBe('2026-10-01');
    // the fall-back night: 1:00 to 2:00 am exists twice; minutes come from instants
    const fb = session('2026-11-01', '00:30', '03:00');
    expect(buildContext({ sessions: [fb], billing: billing(), now: NOW }).rows[0].minutes).toBe(210);
  });
});

describe('rates and policy', () => {
  test('policy in force on a day', () => {
    const later = { effective_from: '2026-12-01', absent_family_pct: 50, absent_tutor_pct: 100, count_unconfirmed: false };
    expect(policyFor('2026-11-30', [POLICY, later])).toBe(POLICY);
    expect(policyFor('2026-12-01', [POLICY, later])).toBe(later);
    expect(policyFor('2026-10-01', [POLICY]).absent_family_pct).toBe(100);
  });

  test('most specific family rate wins: subject and tutor, subject, tutor, any', () => {
    const rates = [
      rate('jayden', 6000),
      rate('jayden', 4500, { tutor_id: 'ethan' }),
      rate('jayden', 5000, { subject: null }),
      rate('jayden', 5500, { subject: null, tutor_id: 'marcus' }),
    ];
    const at1 = { studentId: 'jayden', day: '2026-11-10' };
    expect(familyRateFor({ ...at1, tutorId: 'ethan', subject: 'Math' }, rates).rate_cents).toBe(4500);
    expect(familyRateFor({ ...at1, tutorId: 'lauren', subject: ' math ' }, rates).rate_cents).toBe(6000);
    expect(familyRateFor({ ...at1, tutorId: 'marcus', subject: 'SAT' }, rates).rate_cents).toBe(5500);
    expect(familyRateFor({ ...at1, tutorId: 'lauren', subject: 'SAT' }, rates).rate_cents).toBe(5000);
  });

  test('rates apply from their date; voided rows are ignored', () => {
    const rates = [rate('kevin', 4500), rate('kevin', 5000, { effective_from: '2026-12-01' }), rate('kevin', 9999, { effective_from: '2026-11-15', voided_at: 'x' })];
    expect(familyRateFor({ studentId: 'kevin', tutorId: 'ethan', subject: 'Math', day: '2026-11-30' }, rates).rate_cents).toBe(4500);
    expect(familyRateFor({ studentId: 'kevin', tutorId: 'ethan', subject: 'Math', day: '2026-12-01' }, rates).rate_cents).toBe(5000);
    expect(familyRateFor({ studentId: 'kevin', tutorId: 'ethan', subject: 'Math', day: '2026-10-31' }, rates)).toBeNull();
  });

  test('a Google-named subject falls back to the link subject', () => {
    const rates = [rate('kevin', 4500)];
    expect(familyRateFor({ studentId: 'kevin', tutorId: 'ethan', subject: 'math tues', day: '2026-11-10', linkSubject: 'Math' }, rates).rate_cents).toBe(4500);
    expect(familyRateFor({ studentId: 'kevin', tutorId: 'ethan', subject: null, day: '2026-11-10', linkSubject: 'Math' }, rates).rate_cents).toBe(4500);
    expect(familyRateFor({ studentId: 'kevin', tutorId: 'ethan', subject: 'SAT', day: '2026-11-10' }, rates)).toBeNull();
  });

  test('tutor rate in force', () => {
    const rates = [trate('ethan', 3000), trate('ethan', 3500, { effective_from: '2026-12-01' })];
    expect(tutorRateFor('ethan', '2026-11-30', rates).rate_cents).toBe(3000);
    expect(tutorRateFor('ethan', '2026-12-02', rates).rate_cents).toBe(3500);
    expect(tutorRateFor('marcus', '2026-12-02', rates)).toBeNull();
  });
});

describe('one session', () => {
  test('states', () => {
    expect(stateOf(session('2026-11-20', '16:00', '17:00'), NOW)).toBe('expected');
    expect(stateOf(session('2026-11-10', '16:00', '17:00'), NOW)).toBe('unconfirmed');
    expect(stateOf(session('2026-11-10', '16:00', '17:00', { attendance: 'late' }), NOW)).toBe('attended');
    expect(stateOf(session('2026-11-10', '16:00', '17:00', { attendance: 'absent' }), NOW)).toBe('noshow');
    expect(stateOf(session('2026-11-10', '16:00', '17:00', { status: 'cancelled' }), NOW)).toBe('cancelled');
    expect(stateOf(session('2026-11-10', '16:00', '17:00', { status: 'cancelled', attendance: 'present' }), NOW)).toBe('conflict');
  });

  test('what each state is worth', () => {
    const list = [
      session('2026-11-10', '16:00', '17:00', { attendance: 'present' }),   // attended
      session('2026-11-11', '16:00', '17:00', { attendance: 'absent' }),    // no-show
      session('2026-11-12', '16:00', '17:00'),                              // unconfirmed
      session('2026-11-13', '16:00', '17:00', { status: 'cancelled' }),     // cancelled
      session('2026-11-20', '16:00', '17:00'),                              // upcoming
    ];
    const r = ctxOf(list).rows;
    expect(r.map((x) => [x.state, x.familyExpected, x.familyRealized, x.tutorExpected, x.tutorRealized])).toEqual([
      ['attended', 4500, 4500, 3000, 3000],
      ['noshow', 4500, 4500, 3000, 3000],
      ['unconfirmed', 4500, 4500, 3000, 3000],
      ['cancelled', 0, 0, 0, 0],
      ['expected', 4500, 0, 3000, 0],
    ]);
  });

  test('policy percentages and the unconfirmed switch apply by day', () => {
    const half = { effective_from: '2026-11-11', absent_family_pct: 50, absent_tutor_pct: 0, count_unconfirmed: false };
    const list = [
      session('2026-11-10', '16:00', '17:00', { attendance: 'absent' }),
      session('2026-11-11', '16:00', '17:00', { attendance: 'absent' }),
      session('2026-11-12', '16:00', '17:00'),
    ];
    const r = ctxOf(list, { policies: [POLICY, half] }).rows;
    expect(r.map((x) => [x.familyRealized, x.tutorRealized])).toEqual([[4500, 3000], [2250, 0], [0, 0]]);
    expect(r[2].familyExpected).toBe(4500);
  });

  test('an exception changes only what the family pays; the tutor is paid the standard rate for what happened', () => {
    const late = session('2026-11-10', '16:00', '17:00', { status: 'cancelled' });
    const forgiven = session('2026-11-11', '16:00', '17:00', { attendance: 'absent' });
    const r = ctxOf([late, forgiven], {
      sessionBilling: [
        { session_id: late.id, charge_pct: 50, reason: 'late_cancel' },
        { session_id: forgiven.id, charge_pct: 0, reason: 'no_show_forgiven' },
      ],
    }).rows;
    expect([r[0].familyRealized, r[0].tutorRealized]).toEqual([2250, 0]);
    expect([r[1].familyRealized, r[1].tutorRealized]).toEqual([0, 3000]);
  });

  test('a free trial lesson (the admin\u2019s own) needs no family rate', () => {
    const trial = session('2026-11-11', '16:00', '17:00', { student_id: 'newkid', tutor_id: 'varun', attendance: 'present' });
    const ctx = ctxOf([trial], { sessionBilling: [{ session_id: trial.id, charge_pct: 0, reason: 'trial' }] });
    expect(ctx.rows[0]).toMatchObject({ familyRealized: 0, tutorRealized: 0, unpriced: true });
    expect(flagsFor(ctx, ctx.rows[0])).not.toContain('unpriced');
  });

  test('sessions before the ledger start are ignored', () => {
    expect(ctxOf([session('2026-10-31', '16:00', '17:00')]).rows).toEqual([]);
  });

  test('no family rate: priced at zero and flagged', () => {
    const s = session('2026-11-10', '16:00', '17:00', { student_id: 'nobody', attendance: 'present' });
    const ctx = ctxOf([s]);
    expect(ctx.rows[0].unpriced).toBe(true);
    expect(ctx.rows[0].familyRealized).toBe(0);
    expect(flagsFor(ctx, ctx.rows[0])).toContain('unpriced');
  });
});

describe('groups', () => {
  test('two group lessons with the same key on one day stay two slots', () => {
    const a = session('2026-11-10', '15:00', '16:00', { student_id: 'kevin', attendance: 'present' });
    const b = session('2026-11-10', '15:00', '16:00', { student_id: 'amy', attendance: 'present' });
    const c = session('2026-11-10', '18:00', '19:00', { student_id: 'kevin', attendance: 'present' });
    const d = session('2026-11-10', '18:00', '19:00', { student_id: 'amy', attendance: 'present' });
    const sb = [a, b, c, d].map((x) => ({ session_id: x.id, group_key: 'Math' }));
    const slots = groupSlots(ctxOf([a, b, c, d], { sessionBilling: sb }).rows);
    expect(slots).toHaveLength(2);
    expect(slots.reduce((t, x) => t + x.tutorRealized, 0)).toBe(6000);
  });

  test('a cancelled member adds no hours to its group', () => {
    const a = session('2026-11-10', '15:00', '16:00', { student_id: 'kevin', attendance: 'present' });
    const b = session('2026-11-10', '15:00', '17:00', { student_id: 'amy', status: 'cancelled' });
    const slots = groupSlots(ctxOf([a, b], { sessionBilling: [{ session_id: a.id, group_key: 'G' }, { session_id: b.id, group_key: 'G' }] }).rows);
    expect(slots[0].minutes).toBe(60);
  });

  test('a group is paid once for the longest member; strangers at the same time are paid twice', () => {
    const a = session('2026-11-10', '15:00', '16:00', { student_id: 'kevin', attendance: 'present' });
    const b = session('2026-11-10', '15:00', '16:30', { student_id: 'amy', attendance: 'present' });
    const sb = [{ session_id: a.id, group_key: 'Programming' }, { session_id: b.id, group_key: 'Programming' }];
    const grouped = ctxOf([a, b], { sessionBilling: sb });
    const slots = groupSlots(grouped.rows);
    expect(slots).toHaveLength(1);
    expect(slots[0].tutorRealized).toBe(4500);   // 90 minutes at $30
    expect(sum(grouped.rows.map((r) => r.familyRealized))).toBe(4500 + 9000);
    const loose = ctxOf([a, b]);
    expect(groupSlots(loose.rows)).toHaveLength(2);
    const { byKind } = needsAttention(loose, '2026-11-01', '2026-11-30');
    expect(byKind.get('overlap')?.length).toBe(2);
    expect(needsAttention(grouped, '2026-11-01', '2026-11-30').byKind.get('overlap')).toBeUndefined();
  });
});

const sum = (list) => list.reduce((t, x) => t + x, 0);

describe('families', () => {
  const sessions = () => [
    session('2026-11-03', '16:00', '17:00', { attendance: 'present' }),
    session('2026-11-10', '16:00', '17:00', { attendance: 'present' }),
    session('2026-11-24', '16:00', '17:00'),
    session('2026-11-05', '16:00', '17:00', { student_id: 'amy', attendance: 'present' }),
  ];

  test('one row per paying parent with owed, paid and status', () => {
    const ctx = ctxOf(sessions(), {
      payments: [{ id: 1, parent_id: 'ryan', period: '2026-11-01', amount_cents: 6000, received_on: '2026-11-06', created_at: 'a', owed_cents: 6000, lines: [] }],
    });
    const rows = familyRows(ctx, '2026-11-01');
    expect(rows.map((f) => [f.name, f.owedCents, f.expectedCents, f.paidCents, f.status.key])).toEqual([
      ['Alan Wang', 9000, 13500, 0, 'unpaid'],
      ['Ryan Li', 6000, 6000, 6000, 'paid'],
    ]);
  });

  test('siblings are one family; adjustments are lines, not payments', () => {
    const list = [...sessions(), session('2026-11-04', '16:00', '17:00', { student_id: 'amy2', attendance: 'present' })];
    const ctx = ctxOf(list, {
      familyRates: [rate('kevin', 4500), rate('amy', 6000), rate('amy2', 6000)],
      parentLinks: [{ parent_id: 'alan', student_id: 'kevin', bills: true }, { parent_id: 'ryan', student_id: 'amy', bills: true }, { parent_id: 'ryan', student_id: 'amy2', bills: true }],
      adjustments: [{ id: 9, party: 'family', party_id: 'ryan', period: '2026-11-01', amount_cents: -1000, label: 'discount' }],
    });
    const f = familyMonth(ctx, 'ryan', '2026-11-01');
    expect(f.students.sort()).toEqual(['amy', 'amy2']);
    expect(f.owedCents).toBe(12000 - 1000);
  });

  test('partial, credit and changed-since-payment statuses', () => {
    const pay = (cents, owed) => ({ id: 1, parent_id: 'alan', period: '2026-11-01', amount_cents: cents, received_on: '2026-11-12', created_at: 'a', owed_cents: owed, lines: [] });
    expect(familyStatus(ctxOf(sessions()), familyMonth(ctxOf(sessions(), { payments: [pay(5000, 9000)] }), 'alan', '2026-11-01')).label).toBe('Paid $50.00 of $90.00');
    const changed = ctxOf(sessions(), { payments: [pay(4500, 4500)] });
    expect(familyStatus(changed, familyMonth(changed, 'alan', '2026-11-01')).key).toBe('changed');
    const exact = ctxOf(sessions(), { payments: [pay(10000, 9000)] });
    const fm = familyMonth(exact, 'alan', '2026-11-01');
    expect(fm.changedSincePayment).toBe(false);
    expect(familyStatus(exact, fm).label).toBe('Credit $10.00');
  });

  test('balance across months; a payment with no month is applied overall', () => {
    const list = [...sessions(), session('2026-12-01', '16:00', '17:00', { attendance: 'present' })];
    const later = new Date(zonedIso('2026-12-20', '12:00'));
    const ctx = buildContext({
      sessions: list,
      now: later,
      billing: billing({ payments: [{ id: 1, parent_id: 'alan', period: null, amount_cents: 20000, received_on: '2026-11-20', created_at: 'a', owed_cents: 0, lines: [] }] }),
    });
    // Nov: 3 attended = 13500 (the 24th has now happened, unconfirmed counts); Dec: 4500
    expect(familyBalance(ctx, 'alan')).toBe(13500 + 4500 - 20000);
    expect(familyBalance(ctx, 'alan', '2026-11-01')).toBe(13500 - 20000);
    expect(allOutstanding(ctx)).toBe(6000);   // Ryan's 6000; Alan has a credit
  });

  test('due date: the 15th of next month, or 14 days after sending when later', () => {
    const ctx = ctxOf([]);
    expect(dueDate(ctx, '2026-11-01')).toBe('2026-12-15');
    expect(dueDate(ctx, '2026-11-01', '2026-12-10')).toBe('2026-12-24');
    expect(dueDate(ctx, '2026-11-01', '2026-12-01')).toBe('2026-12-15');
  });

  test('moving the bill to another parent never moves a month that was already paid', () => {
    const nov = session('2026-11-03', '16:00', '17:00', { attendance: 'present' });
    const dec = session('2026-12-01', '16:00', '17:00', { attendance: 'present' });
    const later = new Date(zonedIso('2026-12-20', '12:00'));
    const ctx = buildContext({
      sessions: [nov, dec],
      now: later,
      billing: billing({
        // Alan paid November; the bill then moved to Ryan
        parentLinks: [{ parent_id: 'alan', student_id: 'kevin', bills: false }, { parent_id: 'ryan', student_id: 'kevin', bills: true }],
        payments: [{ id: 1, parent_id: 'alan', payer_name: 'Alan Wang', period: '2026-11-01', amount_cents: 4500, received_on: '2026-11-05', created_at: 'a', owed_cents: 4500, lines: [{ session_id: String(nov.id), amount_cents: 4500 }] }],
      }),
    });
    expect(familyMonth(ctx, 'alan', '2026-11-01')).toMatchObject({ owedCents: 4500, paidCents: 4500, changedSincePayment: false });
    expect(familyMonth(ctx, 'ryan', '2026-11-01').lines).toEqual([]);
    expect(familyBalance(ctx, 'alan')).toBe(0);
    expect(familyMonth(ctx, 'ryan', '2026-12-01').owedCents).toBe(4500);
  });

  test('a credit covers later months: not overdue, shown as covered', () => {
    const list = [session('2026-11-03', '16:00', '17:00', { attendance: 'present' }), session('2026-12-01', '16:00', '17:00', { attendance: 'present' })];
    const ctx = buildContext({
      sessions: list,
      now: new Date(zonedIso('2027-01-20', '12:00')),
      billing: billing({ payments: [{ id: 1, parent_id: 'alan', period: null, amount_cents: 20000, received_on: '2026-11-02', created_at: 'a', owed_cents: 0, lines: [] }] }),
    });
    const dec = familyMonth(ctx, 'alan', '2026-12-01');
    expect(dec.balanceThrough).toBeLessThan(0);
    expect(familyStatus(ctx, dec).key).toBe('covered');
    expect(needsAttention(ctx, '2027-01-01', '2027-01-31').byKind.get('overdue')).toBeUndefined();
  });
});

describe('tutors', () => {
  const list = () => [
    session('2026-11-03', '16:00', '17:00', { attendance: 'present' }),
    session('2026-11-10', '16:00', '17:30', { attendance: 'present' }),
    session('2026-11-17', '16:00', '17:00', { attendance: 'present' }),
    session('2026-11-10', '18:00', '19:00', { tutor_id: 'varun', attendance: 'present' }),
  ];

  test('periods, totals and the owner at $0', () => {
    const ctx = ctxOf(list());
    const rows = periodRows(ctx, '2026-11-01');
    expect(rows.map((t) => [t.name, t.minutes, t.totalCents])).toEqual([['Ethan Poon', 150, 7500], ['Varun Baskaran', 60, 0]]);
    expect(tutorPeriod(ctx, 'ethan', '2026-11-16')).toMatchObject({ periodEnd: '2026-11-30', totalCents: 3000 });
  });

  test('information for the CPA: a status per period, never paid or unpaid', () => {
    const ctx = ctxOf(list());
    expect(periodStatus(ctx, tutorPeriod(ctx, 'ethan', '2026-11-01'))).toMatchObject({ key: 'complete', label: 'Complete' });
    expect(periodStatus(ctx, tutorPeriod(ctx, 'ethan', '2026-11-16'))).toMatchObject({ key: 'open', label: 'In progress' });
    expect(periodStatus(ctx, tutorPeriod(ctx, 'ethan', '2026-12-01'))).toMatchObject({ key: 'future', label: 'Upcoming' });
    // an ended session without attendance: check it before sending the period on
    const open = ctxOf([...list(), session('2026-11-12', '16:00', '17:00')]);
    expect(periodStatus(open, tutorPeriod(open, 'ethan', '2026-11-01'))).toMatchObject({ key: 'check', label: 'Check first' });
    // payouts recorded under the old Payroll tab change nothing
    const payout = { id: 1, kind: 'tutor', tutor_id: 'ethan', period_start: '2026-11-01', amount_cents: 100, paid_on: '2026-11-20', lines: [] };
    const old = ctxOf(list(), { payouts: [payout] });
    expect(tutorPeriod(old, 'ethan', '2026-11-01').totalCents).toBe(7500);
    expect(rangeTotals(old, '2026-11-01', '2026-11-30')).not.toHaveProperty('paidOut');
  });

  test('bonuses and deductions count in their period', () => {
    const ctx = ctxOf(list(), { adjustments: [{ id: 9, party: 'tutor', party_id: 'ethan', period: '2026-11-16', amount_cents: 2000, label: 'bonus' }] });
    expect(tutorPeriod(ctx, 'ethan', '2026-11-16')).toMatchObject({ realizedCents: 3000, adjustmentCents: 2000, totalCents: 5000 });
    expect(periodRows(ctx, '2026-12-01')).toEqual([]);
  });

  test('year to date is what they earned this year, through today', () => {
    // Nov 3, Nov 10 and Nov 17 happened by Nov 18: 3.5 hours at $30, plus a $20 bonus
    const ctx = ctxOf(list(), { adjustments: [{ id: 9, party: 'tutor', party_id: 'ethan', period: '2026-11-16', amount_cents: 2000, label: 'bonus' }] });
    expect(yearToDate(ctx, 'ethan')).toBe(12500);
    expect(yearToDate(ctx, 'ethan', 2025)).toBe(0);
  });
});

describe('totals', () => {
  test('expected, realized, collected and net', () => {
    const list = [
      session('2026-11-03', '16:00', '17:00', { attendance: 'present' }),
      session('2026-11-24', '16:00', '17:00'),
      session('2026-11-05', '16:00', '17:00', { student_id: 'amy', attendance: 'present' }),
    ];
    const ctx = ctxOf(list, {
      payments: [{ parent_id: 'ryan', period: '2026-11-01', amount_cents: 6000, received_on: '2026-11-06', lines: [] }],
    });
    const t = rangeTotals(ctx, '2026-11-01', '2026-11-30');
    expect(t.revenueExpected).toBe(15000);
    expect(t.revenueRealized).toBe(10500);
    expect(t.collected).toBe(6000);
    expect(t.tutorExpected).toBe(9000);
    expect(t.tutorRealized).toBe(6000);
    // a custom range counts payments by the day they arrived
    expect(rangeTotals(ctx, '2026-11-07', '2026-11-30').collected).toBe(0);
    expect(t.netExpected).toBe(t.revenueExpected - t.tutorExpected);
    expect(t.netRealized).toBe(10500 - 6000);
    expect(t.studentMinutes).toBe(180);
  });
});

describe('needs attention and the gates', () => {
  test('unconfirmed blocks the family and the tutor until confirmed or accepted', () => {
    const s = session('2026-11-10', '16:00', '17:00');
    const ctx = ctxOf([s]);
    expect(familyBlockers(ctx, 'alan', '2026-11-01').ok).toBe(false);
    expect(tutorBlockers(ctx, 'ethan', '2026-11-01').ok).toBe(false);
    const accepted = ctxOf([s], { sessionBilling: [{ session_id: s.id, reviewed_at: at('2026-11-12', '09:00') }] });
    expect(isAccepted(accepted, accepted.rows[0])).toBe(true);
    expect(familyBlockers(accepted, 'alan', '2026-11-01').ok).toBe(true);
    // an edit after the Accept reopens it
    const reopened = ctxOf([s], {
      sessionBilling: [{ session_id: s.id, reviewed_at: at('2026-11-12', '09:00') }],
      edits: [{ session_id: s.id, action: 'update', at: at('2026-11-13', '09:00'), old_ends_at: s.ends_at, new_ends_at: s.ends_at, old_starts_at: s.starts_at, new_starts_at: s.starts_at, editor: 'ethan', old_status: 'scheduled', new_status: 'scheduled' }],
    });
    expect(isAccepted(reopened, reopened.rows[0])).toBe(false);
  });

  test('added late, lengthened late, altered after it ended, short notice', () => {
    const late = session('2026-11-10', '16:00', '17:00', { attendance: 'present', created_at: at('2026-11-11', '09:00') });
    const longer = session('2026-11-11', '16:00', '18:00', { attendance: 'present', series_id: 'r1' });
    const movedBack = session('2026-11-14', '16:00', '17:00', { attendance: 'present' });
    const cancelledLater = session('2026-11-12', '16:00', '17:00', { status: 'cancelled', cancelled_at: at('2026-11-13', '09:00') });
    const shortNotice = session('2026-11-13', '16:00', '17:00', { status: 'cancelled', cancelled_at: at('2026-11-13', '10:00') });
    const ctx = ctxOf([late, longer, cancelledLater, shortNotice, movedBack], {
      edits: [
        { session_id: cancelledLater.id, action: 'update', at: at('2026-11-13', '09:00'), editor: 'ethan',
          old_starts_at: cancelledLater.starts_at, new_starts_at: cancelledLater.starts_at, old_ends_at: cancelledLater.ends_at,
          new_ends_at: cancelledLater.ends_at, old_status: 'scheduled', new_status: 'cancelled' },
        // made an hour longer a week before it happened
        { session_id: longer.id, action: 'update', at: at('2026-11-04', '09:00'), editor: 'ethan',
          old_starts_at: longer.starts_at, new_starts_at: longer.starts_at, old_ends_at: at('2026-11-11', '17:00'), new_ends_at: longer.ends_at },
        // a December session moved back into a past day of November
        { session_id: movedBack.id, action: 'update', at: at('2026-11-16', '09:00'), editor: 'ethan',
          old_starts_at: at('2026-12-05', '16:00'), new_starts_at: movedBack.starts_at, old_ends_at: at('2026-12-05', '17:00'), new_ends_at: movedBack.ends_at },
      ],
    });
    const flags = ctx.rows.map((r) => flagsFor(ctx, r));
    expect(flags[0]).toContain('added_late');
    expect(flags[1]).toContain('longer');
    expect(flags[2]).toContain('altered');
    expect(flags[3]).toContain('short_notice');
    expect(flags[4]).toContain('altered');
    // the admin's own change is not flagged as altered
    const byAdmin = ctxOf([cancelledLater], { edits: [{ ...ctx.edits[0], editor: 'varun' }] });
    expect(flagsFor(byAdmin, byAdmin.rows[0])).not.toContain('altered');
    // short notice is settled by an exception percentage
    const decided = ctxOf([shortNotice], { sessionBilling: [{ session_id: shortNotice.id, charge_pct: 50, reason: 'late_cancel' }] });
    expect(flagsFor(decided, decided.rows[0])).not.toContain('short_notice');
  });

  test('no tutor rate blocks only that tutor; overdue and older counts inform', () => {
    const s = session('2026-11-10', '16:00', '17:00', { tutor_id: 'marcus', attendance: 'present' });
    const ctx = ctxOf([s]);
    expect(tutorBlockers(ctx, 'marcus', '2026-11-01').ok).toBe(false);
    expect(familyBlockers(ctx, 'alan', '2026-11-01').ok).toBe(true);
    const later = buildContext({ sessions: [s], billing: billing({ tutorRates: [trate('marcus', 2000)] }), now: new Date(zonedIso('2026-12-20', '12:00')) });
    const { byKind } = needsAttention(later, '2026-12-01', '2026-12-31');
    expect(byKind.get('overdue')?.[0]).toMatchObject({ parentId: 'alan', cents: 4500 });
    const old = buildContext({ sessions: [session('2026-11-10', '16:00', '17:00')], billing: billing(), now: new Date(zonedIso('2026-12-20', '12:00')) });
    expect(needsAttention(old, '2026-12-01', '2026-12-31').byKind.get('older_unconfirmed')?.[0].count).toBe(1);
  });

  test('a session a tutor deleted after it happened is listed for review (not the admin\u2019s own)', () => {
    const del = (editor) => ({ session_id: 999, student_id: 'kevin', tutor_id: 'ethan', editor, action: 'delete', at: at('2026-11-12', '09:00'),
      old_starts_at: at('2026-11-10', '16:00'), old_ends_at: at('2026-11-10', '17:00'), old_status: 'scheduled', old_attendance: 'present' });
    const byTutor = needsAttention(ctxOf([], { edits: [del('ethan')] }), '2026-11-01', '2026-11-30').byKind.get('deleted_late');
    expect(byTutor).toHaveLength(1);
    expect(byTutor[0]).toMatchObject({ tutorId: 'ethan', studentId: 'kevin', day: '2026-11-10', by: 'ethan' });
    expect(needsAttention(ctxOf([], { edits: [del('varun')] }), '2026-11-01', '2026-11-30').byKind.get('deleted_late')).toBeUndefined();
    // a session deleted before it happened is just a cancellation of plans
    const early = { ...del('ethan'), at: at('2026-11-09', '09:00') };
    expect(needsAttention(ctxOf([], { edits: [early] }), '2026-11-01', '2026-11-30').byKind.get('deleted_late')).toBeUndefined();
  });

  test('students with no paying parent', () => {
    const ctx = ctxOf([session('2026-11-10', '16:00', '17:00', { student_id: 'amy', attendance: 'present' })], { parentLinks: [] });
    expect(needsAttention(ctx, '2026-11-01', '2026-11-30').byKind.get('no_payer')?.[0].studentId).toBe('amy');
  });
});

describe('snapshots and the drawer line', () => {
  test('snapshots carry what was priced', () => {
    const s = session('2026-11-03', '16:00', '17:00', { attendance: 'present' });
    const ctx = ctxOf([s]);
    const f = familyMonth(ctx, 'alan', '2026-11-01');
    expect(familySnapshot(f)[0]).toMatchObject({ session_id: String(s.id), day: '2026-11-03', student_id: 'kevin', amount_cents: 4500, rate_cents: 4500 });
  });

  test('billing fact is for the admin only', () => {
    const s = session('2026-11-03', '16:00', '17:00', { attendance: 'present' });
    const ctx = ctxOf([s], { payments: [{ parent_id: 'alan', period: '2026-11-01', amount_cents: 4500, received_on: '2026-11-05', lines: [] }] });
    expect(billingFact(ctx, s, 'tutor')).toBeNull();
    expect(billingFact(ctx, s, 'parent')).toBeNull();
    expect(billingFact(ctx, s, 'admin')).toBe('Counted in November 2026: $45.00 family, $30.00 tutor; family paid $45.00 on Nov 5');
    expect(inPaidPeriod(ctx, s)).toBe(true);
  });

  test('statement number', () => {
    expect(statementNumber('a1b2c3d4-0000-0000-0000-000000000000', '2026-11-01')).toBe('2026-11-A1B2C3');
  });
});

describe('words and files', () => {
  test('policy paragraph follows the numbers', () => {
    expect(policyText(POLICY, SETTINGS)).toContain('billed to the family and paid to the tutor in full');
    expect(policyText({ ...POLICY, absent_family_pct: 50, absent_tutor_pct: 0 }, SETTINGS)).toContain('billed at 50 percent and paid to the tutor at 0 percent');
    expect(policyText(POLICY, SETTINGS)).toContain('with the bill dated the 1st of the next month and due on the 15th');
    expect(policyText(POLICY, SETTINGS)).toContain('the 1st to the 15th and the 16th to the end of the month');
    expect(policyText(POLICY, { ...SETTINGS, due_day: 1 })).toContain('due on the 1st');
  });

  test('statement and payout text', () => {
    const list = [session('2026-11-03', '16:00', '17:00', { attendance: 'present' }), session('2026-11-11', '16:00', '17:00', { attendance: 'absent' })];
    const ctx = ctxOf(list);
    const text = statementText(ctx, familyMonth(ctx, 'alan', '2026-11-01'), { previousCents: 1000 });
    expect(text).toContain('Statement 2026-11-ALAN for Alan Wang');
    expect(text).toContain('November 2026, dated Tue, Dec 1, due');
    expect(text).toContain('Tue, Nov 3, Math, with Ethan Poon, 1.00 hr: $45.00');
    expect(text).toContain('(no-show)');
    expect(text).toContain('Amount due: $100.00');
    expect(text).toContain('Zelle: pay@vp.test');
    const slip = payoutText(ctx, tutorPeriod(ctx, 'ethan', '2026-11-01'));
    expect(slip).toContain('Pay for Ethan Poon, Nov 1 to Nov 15');
    expect(slip).not.toContain('Pay day');
    expect(slip).toContain('Total: $60.00');
    expect(payrollCsv(periodRows(ctx, '2026-11-01'))).toContain('Ethan Poon,2026-11-01,2026-11-15,2.00,30.00,60.00,0.00,60.00');
  });

  test('a sent statement is saved as a snapshot of family amounts only', () => {
    const list = [session('2026-11-03', '16:00', '17:00', { attendance: 'present' }), session('2026-11-11', '16:00', '17:00', { attendance: 'absent' })];
    const ctx = ctxOf(list);
    const f = familyMonth(ctx, 'alan', '2026-11-01');
    const snap = statementSnapshot(ctx, f, { previousCents: 1000, sentOn: '2026-12-01' });
    expect(snap).toMatchObject({
      v: 1, number: '2026-11-ALAN', name: 'Alan Wang', month: '2026-11-01', bill_date: '2026-12-01', due_date: '2026-12-15',
      previous_cents: 1000, month_cents: 9000, due_cents: 10000, pay_note: 'Zelle: pay@vp.test',
    });
    expect(snap.lines).toHaveLength(2);
    expect(snap.lines[0]).toMatchObject({ day: '2026-11-03', student: 'Kevin Wang', subject: 'Math', tutor: 'Ethan Poon', minutes: 60, rate_cents: 4500, amount_cents: 4500, note: null });
    expect(snap.lines[1].note).toBe('no-show');
    // nothing about tutor pay travels with it
    expect(JSON.stringify(snap)).not.toMatch(/tutorRe|tutor_rate|3000/);
  });

  test('where a sent statement stands for the parent', () => {
    const snap = { due_cents: 10000, due_date: '2026-12-15', payments: [{ amount_cents: 2000 }] };
    expect(statementStatus({ due_cents: 10000, paid_cents: 2000, snapshot: snap }, '2026-12-05')).toMatchObject({ key: 'due', label: 'Due Dec 15' });
    expect(statementStatus({ due_cents: 10000, paid_cents: 2000, snapshot: snap }, '2026-12-16')).toMatchObject({ key: 'overdue', tone: 'danger' });
    expect(statementStatus({ due_cents: 10000, paid_cents: 6000, snapshot: snap }, '2026-12-16')).toMatchObject({ key: 'partial', label: 'Paid $40.00 of $100.00' });
    expect(statementStatus({ due_cents: 10000, paid_cents: 12000, snapshot: snap }, '2026-12-16')).toMatchObject({ key: 'paid', label: 'Paid' });
    expect(statementStatus({ due_cents: 0, paid_cents: 0, snapshot: {} }, '2026-12-16')).toMatchObject({ key: 'paid', label: 'Nothing due' });
    expect(statementStatus({ due_cents: -500, paid_cents: 0, snapshot: {} }, '2026-12-16')).toMatchObject({ key: 'credit', label: 'Credit $5.00' });
  });

  test('CSV quotes and neutralizes formulas', () => {
    expect(csvText(['a', 'b'], [['x,y', '=SUM(A1)'], ['-12.50', 'He said "hi"']])).toBe('a,b\r\n"x,y",\'=SUM(A1)\r\n-12.50,"He said ""hi"""\r\n');
    const ctx = ctxOf([session('2026-11-03', '16:00', '17:00', { attendance: 'present' })]);
    expect(familiesCsv(familyRows(ctx, '2026-11-01'))).toContain('Alan Wang,1,1.00,45.00,0.00,45.00,Unpaid');
  });
});

describe('paste rates', () => {
  test('reads the scheduler lines', () => {
    const { rates, errors } = parseRateLines('Amy (Ryan): Math $45\nJayden (Stella): Ethan Math $45, Math $60\nLexi (Christine): AP Euro $60.50/hr\n\nnonsense');
    expect(rates.map((r) => [r.student, r.parent, r.subject, r.cents])).toEqual([
      ['Amy', 'Ryan', 'Math', 4500], ['Jayden', 'Stella', 'Ethan Math', 4500], ['Jayden', 'Stella', 'Math', 6000], ['Lexi', 'Christine', 'AP Euro', 6050],
    ]);
    expect(errors).toHaveLength(1);
  });

  test('matches students, tells two Jasons apart by parent, turns "Ethan Math" into a tutor rate', () => {
    const students = [{ id: 'j1', full_name: 'Jason Lee' }, { id: 'j2', full_name: 'Jason Shum' }, { id: 'jay', full_name: 'Jayden Chu' }, { id: 'amy', full_name: 'Amy Li' }];
    const parents = [{ id: 'regina', full_name: 'Regina Shum' }, { id: 'merlot', full_name: 'Merlot Lee' }, { id: 'stella', full_name: 'Stella Chu' }];
    const parentLinks = [{ parent_id: 'regina', student_id: 'j2' }, { parent_id: 'merlot', student_id: 'j1' }, { parent_id: 'stella', student_id: 'jay' }];
    const tutors = [{ id: 'ethan', full_name: 'Ethan Poon' }];
    const links = [{ tutor_id: 'ethan', student_id: 'jay' }];
    const existing = [{ student_id: 'amy', subject: 'math', tutor_id: null, effective_from: '2026-11-01' }];
    const { rates } = parseRateLines('Jason (Regina Shum): Math $65\nJayden (Stella): Ethan Math $45, Math $60\nAmy (Ryan): Math $45\nZed (Nobody): Math $45');
    const m = matchRates(rates, { students, parents, parentLinks, links, tutors, existing, effectiveFrom: '2026-11-01' });
    expect(m.ready.map((r) => [r.student_id, r.subject, r.tutor_id, r.cents])).toEqual([
      ['j2', 'Math', null, 6500], ['jay', 'Math', 'ethan', 4500], ['jay', 'Math', null, 6000],
    ]);
    expect(m.already.map((r) => r.student_id)).toEqual(['amy']);
    expect(m.problems.map((p) => p.reason)).toEqual(['No student named Zed']);
  });
});
