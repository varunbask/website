// The Account page's money rules, in one place, with no DOM and no network.
// Every number on the page comes from the sessions on the calendar priced by
// the rates and policy the admin set (supabase/migrations/20261010120000_billing.sql).
// Nothing here writes; the views call these and render the result.
//
// Money is integer cents. Days are Pacific 'YYYY-MM-DD' keys (dates.js). A
// month is the key of its first day ('2026-11-01'); a pay period is the key of
// its first Sunday. A session belongs to the month and the pay period of the
// Pacific day it starts on and is never split.
//
//   ctx = buildContext({ sessions, links, rules, billing, now, adminIds })
//     sessions  every session from the ledger start (store.getAllSessions)
//     links     tutor_students rows (tutor_id, student_id, subject)
//     rules     session_series rows (id, start_time, end_time)
//     billing   store.getBilling(): settings, policies, familyRates, tutorRates,
//               sessionBilling, edits, payments, payouts, adjustments, contacts,
//               statements, parentLinks, names
//     adminIds  ids of admins, so their own edits are not flagged

import { dayKey, addDays, daysBetween, parseKey, weekday } from './dates.js';
import { durationMinutes } from './sessions-model.js';

export const MINUTES_PER_HOUR = 60;
export const SHORT_NOTICE_HOURS = 24;
export const STATEMENT_GRACE_DAYS = 14;
const HOUR_MS = 3_600_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ms = (iso) => Date.parse(iso);
const same = (a, b) => String(a) === String(b);
const live = (row) => !row?.voided_at;
const sum = (list, f) => (list ?? []).reduce((t, x) => t + (f ? f(x) : x), 0);

// ---------------------------------------------------------------------------
// Money and hours

// 4500 -> '$45.00', -1250 -> '-$12.50', 123456 -> '$1,234.56'
export function money(cents) {
  const n = Math.round(Number(cents) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

// '+$45.00' or '-$12.50' for a difference
export function signedMoney(cents) {
  return cents > 0 ? `+${money(cents)}` : money(cents);
}

// 105 -> '1.75'
export function hoursText(minutes) {
  return (Math.round((Number(minutes) || 0) / 60 * 100) / 100).toFixed(2);
}

// '45', '45.5', '$1,200.50' -> cents; null when it is not a usable amount.
// allowNegative for refunds and deductions; zero only when allowZero.
export function parseMoney(text, { allowNegative = false, allowZero = false, max = 10_000_000 } = {}) {
  const raw = String(text ?? '').trim().replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) return null;
  const negative = raw.startsWith('-');
  if (negative && !allowNegative) return null;
  const [whole, frac = ''] = raw.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isFinite(cents) || cents > max) return null;
  if (cents === 0 && !allowZero) return null;
  return negative ? -cents : cents;
}

// Minutes at an hourly rate, at a percentage, rounded to the cent
export function amountFor(minutes, rateCents, pct = 100) {
  return Math.round((minutes * rateCents * pct) / (MINUTES_PER_HOUR * 100));
}

// ---------------------------------------------------------------------------
// Months and pay periods

export function monthOf(day) {
  return `${day.slice(0, 7)}-01`;
}

// '2026-11' or '2026-11-01' -> '2026-11-01'; anything else -> null
export function monthParam(value) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(-01)?$/.exec(String(value ?? ''));
  return m ? `${m[1]}-${m[2]}-01` : null;
}

export function addMonths(month, n) {
  const { y, m } = parseKey(month);
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

export function monthEnd(month) {
  return addDays(addMonths(month, 1), -1);
}

// 'November 2026'
export function monthName(month) {
  const { y, m } = parseKey(month);
  return `${MONTHS[m - 1]} ${y}`;
}

// 'Nov 3' (with the year when it differs from refDay's)
export function shortDate(day, refDay = null) {
  const { y, m, d } = parseKey(day);
  const year = refDay && parseKey(refDay).y !== y ? `, ${y}` : '';
  return `${SHORT_MONTHS[m - 1]} ${d}${year}`;
}

// 'Tue, Nov 3'
export function dayText(day, refDay = null) {
  return `${DAYS[weekday(day)]}, ${shortDate(day, refDay)}`;
}

// The first day of the 14-day pay period holding `day`, counted from the anchor
// Sunday (days before the anchor fall in earlier periods)
export function payPeriodStart(day, anchor) {
  return addDays(anchor, 14 * Math.floor(daysBetween(anchor, day) / 14));
}

export function payPeriodEnd(start) {
  return addDays(start, 13);
}

export function payDay(start, lagDays) {
  return addDays(payPeriodEnd(start), lagDays);
}

// Every pay period overlapping [from, to], earliest first
export function periodsOverlapping(from, to, anchor) {
  const out = [];
  for (let p = payPeriodStart(from, anchor); p <= to; p = addDays(p, 14)) out.push(p);
  return out;
}

// 'Nov 1 to Nov 14'
export function periodText(start) {
  const end = payPeriodEnd(start);
  return `${shortDate(start)} to ${shortDate(end, start)}`;
}

// ---------------------------------------------------------------------------
// Rates and policy

const subjectKey = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// The policy in force on a day: the latest effective_from on or before it
export function policyFor(day, policies) {
  let best = null;
  for (const p of policies ?? []) {
    if (p.effective_from <= day && (!best || p.effective_from > best.effective_from)) best = p;
  }
  return best ?? { effective_from: null, absent_family_pct: 100, absent_tutor_pct: 100, count_unconfirmed: true };
}

// The family rate for a session: among the student's live rows in force on
// the day, the most specific match wins (subject and tutor, subject, tutor,
// neither), and within a level the latest effective_from. The session's own
// subject is tried first, then the subject on the tutor-student link.
export function familyRateFor({ studentId, tutorId, subject, day, linkSubject = null }, rates) {
  const rows = (rates ?? []).filter((r) => live(r) && same(r.student_id, studentId) && r.effective_from <= day);
  if (!rows.length) return null;
  const latest = (list) => list.reduce((best, r) => (!best || r.effective_from > best.effective_from ? r : best), null);
  const forSubject = (subj) => {
    const k = subjectKey(subj);
    if (!k) return null;
    return latest(rows.filter((r) => r.subject && subjectKey(r.subject) === k && r.tutor_id && same(r.tutor_id, tutorId)))
      ?? latest(rows.filter((r) => r.subject && subjectKey(r.subject) === k && !r.tutor_id));
  };
  return forSubject(subject)
    ?? (subjectKey(linkSubject) !== subjectKey(subject) ? forSubject(linkSubject) : null)
    ?? latest(rows.filter((r) => !r.subject && r.tutor_id && same(r.tutor_id, tutorId)))
    ?? latest(rows.filter((r) => !r.subject && !r.tutor_id));
}

export function tutorRateFor(tutorId, day, rates) {
  let best = null;
  for (const r of rates ?? []) {
    if (live(r) && same(r.tutor_id, tutorId) && r.effective_from <= day && (!best || r.effective_from > best.effective_from)) best = r;
  }
  return best;
}

// ---------------------------------------------------------------------------
// One session

export const STATES = Object.freeze({
  cancelled: 'Cancelled',
  conflict: 'Cancelled after attendance',
  expected: 'Upcoming',
  attended: 'Attended',
  noshow: 'No-show',
  unconfirmed: 'No attendance yet',
});

export function stateOf(session, now) {
  const ended = ms(session.ends_at) <= now.getTime();
  if (session.status === 'cancelled') {
    return session.attendance === 'present' || session.attendance === 'late' ? 'conflict' : 'cancelled';
  }
  if (!ended) return 'expected';
  if (session.attendance === 'present' || session.attendance === 'late') return 'attended';
  if (session.attendance === 'absent') return 'noshow';
  return 'unconfirmed';
}

// The percentages for a state: { expected, realized } for the family and for the tutor
function percentages(state, policy, exception) {
  const base = {
    cancelled: [0, 0, 0, 0],
    conflict: [0, 0, 0, 0],
    expected: [100, 0, 100, 0],
    attended: [100, 100, 100, 100],
    noshow: [policy.absent_family_pct, policy.absent_family_pct, policy.absent_tutor_pct, policy.absent_tutor_pct],
    unconfirmed: [100, policy.count_unconfirmed ? 100 : 0, 100, policy.count_unconfirmed ? 100 : 0],
  }[state];
  let [fe, fr, te, tr] = base;
  const ended = state !== 'expected';
  if (exception?.charge_pct !== null && exception?.charge_pct !== undefined) {
    fe = exception.charge_pct;
    fr = ended ? exception.charge_pct : 0;
  }
  if (exception?.pay_pct !== null && exception?.pay_pct !== undefined) {
    te = exception.pay_pct;
    tr = ended ? exception.pay_pct : 0;
  }
  return { familyExpected: fe, familyRealized: fr, tutorExpected: te, tutorRealized: tr };
}

// Everything the page needs about one session's money
export function sessionMoney(session, ctx) {
  const day = dayKey(session.starts_at);
  const minutes = Math.max(0, durationMinutes(session));
  const policy = policyFor(day, ctx.policies);
  const exception = ctx.sessionBilling.get(String(session.id)) ?? null;
  const state = stateOf(session, ctx.now);
  const pct = percentages(state, policy, exception);
  const linkSubj = ctx.linkSubject(session.tutor_id, session.student_id);
  const familyRate = familyRateFor({
    studentId: session.student_id, tutorId: session.tutor_id, subject: session.subject, day, linkSubject: linkSubj,
  }, ctx.familyRates);
  const tutorRate = tutorRateFor(session.tutor_id, day, ctx.tutorRates);
  const fRate = familyRate?.rate_cents ?? 0;
  const tRate = tutorRate?.rate_cents ?? 0;
  return {
    id: String(session.id),
    session,
    day,
    month: monthOf(day),
    periodStart: payPeriodStart(day, ctx.settings.payroll_anchor),
    minutes,
    state,
    pct,
    exception,
    groupKey: exception?.group_key ?? null,
    subject: session.subject ?? linkSubj ?? null,
    familyRate,
    tutorRate,
    familyExpected: amountFor(minutes, fRate, pct.familyExpected),
    familyRealized: amountFor(minutes, fRate, pct.familyRealized),
    tutorExpected: amountFor(minutes, tRate, pct.tutorExpected),
    tutorRealized: amountFor(minutes, tRate, pct.tutorRealized),
    unpriced: !familyRate && state !== 'cancelled',
    noTutorRate: !tutorRate,
    payerId: ctx.payerOf(session.student_id),
  };
}

// ---------------------------------------------------------------------------
// Context

export function buildContext({ sessions = [], links = [], rules = [], billing, now = new Date(), adminIds = [] }) {
  const settings = billing.settings;
  const payer = new Map();
  const payerCount = new Map();
  for (const l of billing.parentLinks ?? []) {
    if (!l.bills) continue;
    payer.set(String(l.student_id), String(l.parent_id));
    payerCount.set(String(l.student_id), (payerCount.get(String(l.student_id)) ?? 0) + 1);
  }
  const linkMap = new Map((links ?? []).map((l) => [`${l.tutor_id}|${l.student_id}`, l.subject ?? null]));
  const ctx = {
    now,
    settings,
    policies: billing.policies ?? [],
    familyRates: billing.familyRates ?? [],
    tutorRates: billing.tutorRates ?? [],
    sessionBilling: new Map((billing.sessionBilling ?? []).map((r) => [String(r.session_id), r])),
    edits: billing.edits ?? [],
    payments: (billing.payments ?? []).filter(live),
    payouts: (billing.payouts ?? []).filter(live),
    adjustments: (billing.adjustments ?? []).filter(live),
    contacts: new Map((billing.contacts ?? []).map((c) => [String(c.parent_id), c])),
    statements: billing.statements ?? [],
    names: billing.names ?? new Map(),
    rules: new Map((rules ?? []).map((r) => [String(r.id), r])),
    adminIds: new Set((adminIds ?? []).map(String)),
    links: links ?? [],
    parentLinks: billing.parentLinks ?? [],
    payerOf: (studentId) => payer.get(String(studentId)) ?? null,
    payerCount: (studentId) => payerCount.get(String(studentId)) ?? 0,
    linkSubject: (tutorId, studentId) => {
      const s = linkMap.get(`${tutorId}|${studentId}`);
      return s && String(s).trim() ? String(s).trim() : null;
    },
    nameOf: (id) => (billing.names?.get?.(String(id)) ?? '').trim() || 'Unknown',
  };
  ctx.rows = (sessions ?? [])
    .filter((s) => dayKey(s.starts_at) >= settings.ledger_start)
    .map((s) => sessionMoney(s, ctx))
    .sort((a, b) => (ms(a.session.starts_at) - ms(b.session.starts_at)) || (Number(a.id) - Number(b.id)));
  return ctx;
}

const inRange = (row, from, to) => row.day >= from && row.day <= to;

// ---------------------------------------------------------------------------
// Tutor pay: groups are paid once

// Rows of one tutor -> slots. Sessions with the same group key on the same day
// are one slot: paid once, for the longest payable member, at the highest
// percentage. Everything else is its own slot.
export function groupSlots(rows) {
  const slots = [];
  const groups = new Map();
  for (const r of rows) {
    if (!r.groupKey) {
      slots.push({
        key: r.id, rows: [r], minutes: r.minutes, tutorExpected: r.tutorExpected, tutorRealized: r.tutorRealized,
        payableMinutes: r.pct.tutorRealized > 0 ? r.minutes : 0,
      });
      continue;
    }
    const k = `${r.session.tutor_id}|${r.groupKey}|${r.day}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [k, members] of groups) {
    const rate = members.find((m) => m.tutorRate)?.tutorRate?.rate_cents ?? 0;
    const longest = (list) => list.reduce((t, m) => Math.max(t, m.minutes), 0);
    const maxPct = (list, f) => list.reduce((t, m) => Math.max(t, f(m)), 0);
    const exp = members.filter((m) => m.pct.tutorExpected > 0);
    const real = members.filter((m) => m.pct.tutorRealized > 0);
    slots.push({
      key: k,
      rows: members,
      minutes: longest(members),
      tutorExpected: exp.length ? amountFor(longest(exp), rate, maxPct(exp, (m) => m.pct.tutorExpected)) : 0,
      tutorRealized: real.length ? amountFor(longest(real), rate, maxPct(real, (m) => m.pct.tutorRealized)) : 0,
      payableMinutes: real.length ? longest(real) : 0,
    });
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Families (monthly)

export function familyAdjustments(ctx, parentId, month) {
  return ctx.adjustments.filter((a) => a.party === 'family' && same(a.party_id, parentId) && a.period === month);
}

export function familyPayments(ctx, parentId, month) {
  const from = month;
  const to = monthEnd(month);
  return ctx.payments.filter((p) => same(p.parent_id, parentId)
    && (p.period === month || (!p.period && p.received_on >= from && p.received_on <= to)));
}

// Session ids already paid by another family's payment for the month (after a relink)
function paidElsewhere(ctx, parentId, month) {
  const map = new Map();
  for (const p of ctx.payments) {
    if (same(p.parent_id, parentId) || p.period !== month) continue;
    for (const l of p.lines ?? []) if (l.session_id !== undefined) map.set(String(l.session_id), p.payer_name || ctx.nameOf(p.parent_id));
  }
  return map;
}

// One family's month
export function familyMonth(ctx, parentId, month) {
  const elsewhere = paidElsewhere(ctx, parentId, month);
  const rows = ctx.rows.filter((r) => r.month === month && same(r.payerId, parentId));
  const lines = rows.map((r) => ({ ...r, paidBy: elsewhere.get(r.id) ?? null }));
  const counted = lines.filter((l) => !l.paidBy);
  const adjustments = familyAdjustments(ctx, parentId, month);
  const payments = familyPayments(ctx, parentId, month);
  const adjustmentCents = sum(adjustments, (a) => a.amount_cents);
  const realizedCents = sum(counted, (l) => l.familyRealized);
  const expectedCents = sum(counted, (l) => l.familyExpected);
  const paidCents = sum(payments, (p) => p.amount_cents);
  const owedCents = realizedCents + adjustmentCents;
  const students = [...new Set(rows.map((r) => String(r.session.student_id)))];
  const minutes = sum(counted.filter((l) => l.familyRealized > 0 || l.familyExpected > 0), (l) => l.minutes);
  const lastPayment = payments.reduce((best, p) => (!best || p.received_on > best.received_on ? p : best), null);
  const snapshot = payments.filter((p) => p.period === month).reduce((best, p) => (!best || p.created_at > best.created_at ? p : best), null);
  return {
    parentId: String(parentId),
    name: ctx.nameOf(parentId),
    month,
    students,
    lines,
    adjustments,
    payments,
    minutes,
    expectedCents: expectedCents + adjustmentCents,
    realizedCents,
    adjustmentCents,
    owedCents,
    paidCents,
    dueCents: owedCents - paidCents,
    lastPayment,
    snapshot,
    changedSincePayment: Boolean(snapshot) && snapshot.owed_cents !== owedCents,
    sentOn: ctx.statements.find((s) => same(s.parent_id, parentId) && s.period === month)?.sent_on ?? null,
    contact: ctx.contacts.get(String(parentId)) ?? null,
  };
}

// Every paying parent with something in the month (sessions, adjustments or payments)
export function familyRows(ctx, month) {
  const ids = new Set();
  for (const r of ctx.rows) if (r.month === month && r.payerId) ids.add(r.payerId);
  for (const a of ctx.adjustments) if (a.party === 'family' && a.period === month) ids.add(String(a.party_id));
  for (const p of ctx.payments) if (p.period === month) ids.add(String(p.parent_id));
  return [...ids].map((id) => {
    const f = familyMonth(ctx, id, month);
    return { ...f, balanceCents: familyBalance(ctx, id), status: familyStatus(ctx, f) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// What a family owes across every month from the ledger start to this one
// (positive = owes us, negative = credit)
export function familyBalance(ctx, parentId, throughMonth = monthOf(dayKey(ctx.now))) {
  const months = new Set();
  for (const r of ctx.rows) if (same(r.payerId, parentId) && r.month <= throughMonth) months.add(r.month);
  for (const a of ctx.adjustments) if (a.party === 'family' && same(a.party_id, parentId) && a.period <= throughMonth) months.add(a.period);
  const owed = sum([...months], (m) => familyMonthOwed(ctx, parentId, m));
  const paid = sum(ctx.payments.filter((p) => same(p.parent_id, parentId)
    && ((p.period && p.period <= throughMonth) || (!p.period && monthOf(p.received_on) <= throughMonth))), (p) => p.amount_cents);
  return owed - paid;
}

function familyMonthOwed(ctx, parentId, month) {
  const elsewhere = paidElsewhere(ctx, parentId, month);
  return sum(ctx.rows.filter((r) => r.month === month && same(r.payerId, parentId) && !elsewhere.has(r.id)), (r) => r.familyRealized)
    + sum(familyAdjustments(ctx, parentId, month), (a) => a.amount_cents);
}

// The balance brought into a month (everything before it)
export function familyBalanceBefore(ctx, parentId, month) {
  return familyBalance(ctx, parentId, addMonths(month, -1));
}

// The due date of a month's statement: due_day of the following month, or 14
// days after it was sent when that is later
export function dueDate(ctx, month, sentOn = null) {
  const due = addDays(addMonths(month, 1), (ctx.settings.due_day ?? 15) - 1);
  const grace = sentOn ? addDays(sentOn, STATEMENT_GRACE_DAYS) : null;
  return grace && grace > due ? grace : due;
}

export function familyStatus(ctx, f) {
  const today = dayKey(ctx.now);
  if (f.changedSincePayment) return { key: 'changed', label: 'Changed since payment', tone: 'danger' };
  if (f.paidCents > 0 && f.dueCents <= 0) {
    if (f.dueCents < 0) return { key: 'credit', label: `Credit ${money(-f.dueCents)}`, tone: 'info' };
    return { key: 'paid', label: f.lastPayment ? `Paid ${shortDate(f.lastPayment.received_on, today)}` : 'Paid', tone: 'success' };
  }
  if (f.paidCents > 0) return { key: 'partial', label: `Paid ${money(f.paidCents)} of ${money(f.owedCents)}`, tone: 'warning' };
  if (f.owedCents <= 0 && f.expectedCents > 0) return { key: 'upcoming', label: 'Upcoming', tone: 'neutral' };
  if (f.owedCents <= 0) return { key: 'nothing', label: 'Nothing owed', tone: 'neutral' };
  if (f.month < monthOf(today) && today > dueDate(ctx, f.month, f.sentOn)) return { key: 'overdue', label: 'Overdue', tone: 'danger' };
  if (f.sentOn) return { key: 'sent', label: `Sent ${shortDate(f.sentOn, today)}`, tone: 'neutral' };
  return { key: 'unpaid', label: 'Unpaid', tone: 'neutral' };
}

// Total owed by every family across all months (credits do not offset others' debts)
export function allOutstanding(ctx) {
  const ids = new Set(ctx.rows.map((r) => r.payerId).filter(Boolean));
  for (const p of ctx.payments) ids.add(String(p.parent_id));
  for (const a of ctx.adjustments) if (a.party === 'family') ids.add(String(a.party_id));
  return sum([...ids], (id) => Math.max(0, familyBalance(ctx, id)));
}

// Students whose sessions have no paying parent
export function studentsWithoutPayer(ctx, from, to) {
  const ids = new Set();
  for (const r of ctx.rows) if (inRange(r, from, to) && !r.payerId && r.state !== 'cancelled') ids.add(String(r.session.student_id));
  return [...ids];
}

// ---------------------------------------------------------------------------
// Tutors (biweekly)

export function tutorAdjustments(ctx, tutorId, periodStart) {
  return ctx.adjustments.filter((a) => a.party === 'tutor' && same(a.party_id, tutorId) && a.period === periodStart);
}

export function tutorPayouts(ctx, tutorId, periodStart) {
  return ctx.payouts.filter((p) => p.kind === 'tutor' && same(p.tutor_id, tutorId) && p.period_start === periodStart);
}

function periodOwed(ctx, tutorId, periodStart) {
  const rows = ctx.rows.filter((r) => r.periodStart === periodStart && same(r.session.tutor_id, tutorId));
  return sum(groupSlots(rows), (s) => s.tutorRealized) + sum(tutorAdjustments(ctx, tutorId, periodStart), (a) => a.amount_cents);
}

// The difference left by earlier paid periods (paid less or more than they
// came to), carried into this one
export function carriedInto(ctx, tutorId, periodStart) {
  const paidStarts = new Set(ctx.payouts.filter((p) => p.kind === 'tutor' && same(p.tutor_id, tutorId) && p.period_start < periodStart).map((p) => p.period_start));
  return sum([...paidStarts], (start) => periodOwed(ctx, tutorId, start) - sum(tutorPayouts(ctx, tutorId, start), (p) => p.amount_cents));
}

export function tutorPeriod(ctx, tutorId, periodStart) {
  const rows = ctx.rows.filter((r) => r.periodStart === periodStart && same(r.session.tutor_id, tutorId));
  const slots = groupSlots(rows);
  const adjustments = tutorAdjustments(ctx, tutorId, periodStart);
  const payouts = tutorPayouts(ctx, tutorId, periodStart);
  const adjustmentCents = sum(adjustments, (a) => a.amount_cents);
  const carriedCents = carriedInto(ctx, tutorId, periodStart);
  const realizedCents = sum(slots, (s) => s.tutorRealized);
  const expectedCents = sum(slots, (s) => s.tutorExpected);
  const owedCents = realizedCents + adjustmentCents + carriedCents;
  const paidCents = sum(payouts, (p) => p.amount_cents);
  const rate = tutorRateFor(tutorId, payPeriodEnd(periodStart), ctx.tutorRates);
  const snapshot = payouts.reduce((best, p) => (!best || p.created_at > best.created_at ? p : best), null);
  return {
    tutorId: String(tutorId),
    name: ctx.nameOf(tutorId),
    periodStart,
    rows,
    slots,
    adjustments,
    payouts,
    rate,
    minutes: sum(slots, (s) => s.minutes),
    payableMinutes: sum(slots, (s) => s.payableMinutes),
    expectedCents: expectedCents + adjustmentCents,
    realizedCents,
    adjustmentCents,
    carriedCents,
    owedCents,
    paidCents,
    dueCents: owedCents - paidCents,
    snapshot,
    changedSincePayout: Boolean(snapshot) && snapshot.owed_cents !== owedCents,
  };
}

// Everyone with sessions, adjustments or payouts in the period
export function periodRows(ctx, periodStart) {
  const ids = new Set();
  for (const r of ctx.rows) if (r.periodStart === periodStart) ids.add(String(r.session.tutor_id));
  for (const a of ctx.adjustments) if (a.party === 'tutor' && a.period === periodStart) ids.add(String(a.party_id));
  for (const p of ctx.payouts) if (p.kind === 'tutor' && p.period_start === periodStart) ids.add(String(p.tutor_id));
  return [...ids].map((id) => tutorPeriod(ctx, id, periodStart)).sort((a, b) => a.name.localeCompare(b.name));
}

export function periodStatus(ctx, t) {
  const today = dayKey(ctx.now);
  if (t.periodStart > today) return { key: 'future', label: 'Upcoming', tone: 'neutral' };
  if (t.changedSincePayout) return { key: 'changed', label: 'Changed since payout', tone: 'danger' };
  if (t.payouts.length && t.dueCents === 0) return { key: 'paid', label: `Paid ${shortDate(t.payouts.at(-1).paid_on, today)}`, tone: 'success' };
  if (t.payouts.length) return { key: 'partial', label: `Paid ${money(t.paidCents)} of ${money(t.owedCents)}`, tone: 'warning' };
  if (t.owedCents === 0 && t.payableMinutes === 0) return { key: 'nothing', label: 'Nothing owed', tone: 'neutral' };
  if (payPeriodEnd(t.periodStart) >= today) return { key: 'open', label: 'In progress', tone: 'neutral' };
  return { key: 'unpaid', label: 'Unpaid', tone: 'neutral' };
}

// Paid to a tutor this year: payouts by paid_on, opening balance included
export function yearToDate(ctx, tutorId, year = parseKey(dayKey(ctx.now)).y) {
  return sum(ctx.payouts.filter((p) => p.kind !== 'referral' && same(p.tutor_id, tutorId) && p.paid_on.startsWith(`${year}-`)), (p) => p.amount_cents);
}

// The referral fee for a period: taught (paid) minutes of tutors with a
// referral rate, by slot, at their per-hour fee, with the minimum applied
export function referralLine(ctx, periodStart) {
  const payee = ctx.settings.referral_payee;
  if (!payee) return null;
  const rows = ctx.rows.filter((r) => r.periodStart === periodStart);
  const byTutor = new Map();
  for (const r of rows) {
    const k = String(r.session.tutor_id);
    if (!byTutor.has(k)) byTutor.set(k, []);
    byTutor.get(k).push(r);
  }
  let minutes = 0;
  let expectedMinutes = 0;
  let computed = 0;
  let expectedComputed = 0;
  for (const [tutorId, list] of byTutor) {
    const fee = tutorRateFor(tutorId, payPeriodEnd(periodStart), ctx.tutorRates)?.referral_cents ?? 0;
    if (!fee) continue;
    for (const s of groupSlots(list)) {
      const realizedMin = s.tutorRealized > 0 ? s.minutes : 0;
      const expectedMin = s.tutorExpected > 0 ? s.minutes : 0;
      minutes += realizedMin;
      expectedMinutes += expectedMin;
      computed += amountFor(realizedMin, fee);
      expectedComputed += amountFor(expectedMin, fee);
    }
  }
  const min = ctx.settings.referral_min_cents ?? 0;
  const payouts = ctx.payouts.filter((p) => p.kind === 'referral' && p.period_start === periodStart);
  const owedCents = Math.max(computed, min);
  const paidCents = sum(payouts, (p) => p.amount_cents);
  return {
    payee,
    periodStart,
    minutes,
    expectedMinutes,
    computedCents: computed,
    minimumCents: min,
    minimumApplies: computed < min,
    owedCents,
    expectedCents: Math.max(expectedComputed, min),
    paidCents,
    dueCents: owedCents - paidCents,
    payouts,
  };
}

// ---------------------------------------------------------------------------
// Totals for a range

// Payout money in [from, to], by the days of the lines it covered (the
// remainder, such as adjustments, on the period's last day)
export function allocatePayout(payout) {
  const out = new Map();
  let lined = 0;
  for (const l of payout.lines ?? []) {
    if (!l.day || typeof l.amount_cents !== 'number') continue;
    out.set(l.day, (out.get(l.day) ?? 0) + l.amount_cents);
    lined += l.amount_cents;
  }
  const rest = payout.amount_cents - lined;
  if (rest) {
    const end = payout.kind === 'tutor' ? payPeriodEnd(payout.period_start) : payout.period_start;
    out.set(end, (out.get(end) ?? 0) + rest);
  }
  return out;
}

export function rangeTotals(ctx, from, to) {
  const rows = ctx.rows.filter((r) => inRange(r, from, to));
  const byTutor = new Map();
  for (const r of rows) {
    const k = String(r.session.tutor_id);
    if (!byTutor.has(k)) byTutor.set(k, []);
    byTutor.get(k).push(r);
  }
  const slots = [...byTutor.values()].flatMap(groupSlots);
  const familyAdj = sum(ctx.adjustments.filter((a) => a.party === 'family' && a.period >= monthOf(from) && a.period <= to), (a) => a.amount_cents);
  const tutorAdj = sum(ctx.adjustments.filter((a) => a.party === 'tutor' && payPeriodEnd(a.period) >= from && a.period <= to), (a) => a.amount_cents);
  const revenueExpected = sum(rows, (r) => r.familyExpected) + familyAdj;
  const revenueRealized = sum(rows, (r) => r.familyRealized) + familyAdj;
  const collected = sum(ctx.payments.filter((p) => p.received_on >= from && p.received_on <= to), (p) => p.amount_cents);
  const tutorExpected = sum(slots, (s) => s.tutorExpected) + tutorAdj;
  const tutorRealized = sum(slots, (s) => s.tutorRealized) + tutorAdj;
  let paidOut = 0;
  for (const p of ctx.payouts.filter((x) => x.kind === 'tutor')) {
    for (const [day, cents] of allocatePayout(p)) if (day >= from && day <= to) paidOut += cents;
  }
  const periods = periodsOverlapping(from, to, ctx.settings.payroll_anchor);
  let referralExpected = 0;
  let referralRealized = 0;
  let referralPaid = 0;
  for (const p of periods) {
    const line = referralLine(ctx, p);
    if (!line) continue;
    // A period partly in range counts by the share of its days in range
    const days = Math.max(0, daysBetween(p < from ? from : p, payPeriodEnd(p) > to ? to : payPeriodEnd(p)) + 1);
    const share = days / 14;
    referralExpected += Math.round(line.expectedCents * share);
    referralRealized += Math.round(line.owedCents * share);
    referralPaid += Math.round(line.paidCents * share);
  }
  const studentMinutes = sum(rows.filter((r) => r.familyExpected > 0), (r) => r.minutes);
  const slotMinutes = sum(slots.filter((s) => s.tutorExpected > 0), (s) => s.minutes);
  const netExpected = revenueExpected - tutorExpected - referralExpected;
  const netRealized = revenueRealized - tutorRealized - referralRealized;
  return {
    from,
    to,
    revenueExpected,
    revenueRealized,
    collected,
    tutorExpected,
    tutorRealized,
    paidOut,
    referralExpected,
    referralRealized,
    referralPaid,
    netExpected,
    netRealized,
    marginPct: revenueExpected > 0 ? Math.round((netExpected / revenueExpected) * 100) : null,
    studentMinutes,
    slotMinutes,
    sessions: rows.length,
  };
}

// Twelve months of totals, with cash-basis figures for the bookkeeper
export function yearRows(ctx, year) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}-01`;
    const t = rangeTotals(ctx, month, monthEnd(month));
    return { month, ...t };
  });
}

// ---------------------------------------------------------------------------
// Needs attention

export const ATTENTION = Object.freeze({
  unconfirmed: { title: 'Ended without attendance', blocks: true },
  added_late: { title: 'Added after it happened', blocks: true },
  longer: { title: 'Longer than its series', blocks: true },
  altered: { title: 'Changed after it ended', blocks: true },
  conflict: { title: 'Cancelled after attendance was recorded', blocks: true },
  short_notice: { title: 'Cancelled on short notice', blocks: true },
  overlap: { title: 'Same tutor, same time: group or clash?', blocks: true },
  unpriced: { title: 'No family rate', blocks: true },
  no_tutor_rate: { title: 'No tutor pay rate', blocks: true },
  no_payer: { title: 'No paying parent', blocks: false },
  overdue: { title: 'Overdue families', blocks: false },
  changed_paid: { title: 'Paid, then changed on the calendar', blocks: false },
  older_unconfirmed: { title: 'Older sessions without attendance', blocks: false },
});

// Accepted on the list, with no edit to the session since
export function isAccepted(ctx, row) {
  const at = row.exception?.reviewed_at;
  if (!at) return false;
  return !ctx.edits.some((e) => same(e.session_id, row.id) && e.at > at);
}

function editsOf(ctx, id) {
  return ctx.edits.filter((e) => same(e.session_id, id));
}

// Flags on one session (kinds above that apply to it), before Accept
export function flagsFor(ctx, row) {
  const s = row.session;
  const flags = [];
  if (row.state === 'unconfirmed') flags.push('unconfirmed');
  if (row.state === 'conflict') flags.push('conflict');
  if (s.created_at && ms(s.created_at) > ms(s.ends_at) && row.state !== 'cancelled') flags.push('added_late');
  const rule = s.series_id ? ctx.rules.get(String(s.series_id)) : null;
  const ruleMinutes = rule ? timeMinutes(rule.end_time) - timeMinutes(rule.start_time) : null;
  const edits = editsOf(ctx, row.id);
  const byAdmin = (e) => Boolean(e.editor) && ctx.adminIds.has(String(e.editor));
  const lengthenedLate = edits.some((e) => e.action === 'update' && e.old_ends_at && e.new_ends_at && !byAdmin(e)
    && ms(e.new_ends_at) > ms(e.old_ends_at) && ms(e.at) > ms(e.old_ends_at));
  if (row.state !== 'cancelled' && ((ruleMinutes && row.minutes > ruleMinutes) || lengthenedLate)) flags.push('longer');
  const alteredLate = edits.some((e) => e.action === 'update' && e.old_ends_at && ms(e.at) > ms(e.old_ends_at) && !byAdmin(e)
    && ((e.new_status && e.new_status !== e.old_status)
      || ms(e.new_starts_at) !== ms(e.old_starts_at) || ms(e.new_ends_at) !== ms(e.old_ends_at)));
  if (alteredLate) flags.push('altered');
  if ((row.state === 'cancelled' || row.state === 'conflict') && s.cancelled_at
    && ms(s.cancelled_at) > ms(s.starts_at) - SHORT_NOTICE_HOURS * HOUR_MS
    && (row.exception?.charge_pct === null || row.exception?.charge_pct === undefined)
    && (row.exception?.pay_pct === null || row.exception?.pay_pct === undefined)) {
    flags.push('short_notice');
  }
  if (row.unpriced) flags.push('unpriced');
  return flags;
}

function timeMinutes(t) {
  const [h, m] = String(t ?? '0:0').split(':').map(Number);
  return h * 60 + m;
}

// Payable sessions of one tutor that overlap without sharing a group key
export function overlapsOf(rows) {
  const out = new Set();
  const payable = rows.filter((r) => r.state !== 'cancelled' && r.state !== 'conflict');
  for (let i = 0; i < payable.length; i += 1) {
    for (let j = i + 1; j < payable.length; j += 1) {
      const a = payable[i];
      const b = payable[j];
      if (ms(b.session.starts_at) >= ms(a.session.ends_at)) continue;
      if (ms(a.session.starts_at) >= ms(b.session.ends_at)) continue;
      if (a.groupKey && a.groupKey === b.groupKey) continue;
      out.add(a.id);
      out.add(b.id);
    }
  }
  return out;
}

// Everything that needs a decision in [from, to]: { items, byKind }
// Each item: { kind, rowId?, row?, tutorId?, studentId?, parentId?, month?, periodStart?, cents?, count? }
// sessionsOnly skips the family-wide and paid-period checks (for the gates).
export function needsAttention(ctx, from, to, { sessionsOnly = false } = {}) {
  const items = [];
  const rows = ctx.rows.filter((r) => inRange(r, from, to));
  for (const r of rows) {
    if (isAccepted(ctx, r)) continue;
    for (const kind of flagsFor(ctx, r)) {
      items.push({ kind, rowId: r.id, row: r, tutorId: String(r.session.tutor_id), studentId: String(r.session.student_id), parentId: r.payerId });
    }
  }
  const byTutor = new Map();
  for (const r of rows) {
    const k = String(r.session.tutor_id);
    if (!byTutor.has(k)) byTutor.set(k, []);
    byTutor.get(k).push(r);
  }
  for (const [tutorId, list] of byTutor) {
    for (const id of overlapsOf(list)) {
      const r = list.find((x) => x.id === id);
      if (!isAccepted(ctx, r)) items.push({ kind: 'overlap', rowId: id, row: r, tutorId, studentId: String(r.session.student_id), parentId: r.payerId });
    }
    if (list.some((r) => r.noTutorRate && r.state !== 'cancelled')) items.push({ kind: 'no_tutor_rate', tutorId });
  }
  if (sessionsOnly) return group(items);
  for (const studentId of studentsWithoutPayer(ctx, from, to)) items.push({ kind: 'no_payer', studentId });
  // Families with money owed past their due date
  const today = dayKey(ctx.now);
  for (let m = monthOf(ctx.settings.ledger_start); m < monthOf(today); m = addMonths(m, 1)) {
    for (const f of familyRows(ctx, m)) {
      if (f.dueCents > 0 && today > dueDate(ctx, m, f.sentOn)) items.push({ kind: 'overdue', parentId: f.parentId, month: m, cents: f.dueCents });
      if (f.changedSincePayment) items.push({ kind: 'changed_paid', parentId: f.parentId, month: m, cents: f.owedCents - f.snapshot.owed_cents });
    }
  }
  for (const start of new Set(ctx.payouts.filter((p) => p.kind === 'tutor').map((p) => p.period_start))) {
    for (const t of periodRows(ctx, start)) {
      if (t.changedSincePayout) items.push({ kind: 'changed_paid', tutorId: t.tutorId, periodStart: start, cents: t.owedCents - t.snapshot.owed_cents });
    }
  }
  const older = ctx.rows.filter((r) => r.day < from && r.state === 'unconfirmed' && !isAccepted(ctx, r)).length;
  if (older) items.push({ kind: 'older_unconfirmed', count: older });
  return group(items);
}

function group(items) {
  const byKind = new Map();
  for (const it of items) {
    if (!byKind.has(it.kind)) byKind.set(it.kind, []);
    byKind.get(it.kind).push(it);
  }
  return { items, byKind };
}

const FAMILY_BLOCKS = new Set(['unconfirmed', 'added_late', 'longer', 'altered', 'conflict', 'short_notice', 'unpriced']);
const TUTOR_BLOCKS = new Set(['unconfirmed', 'added_late', 'longer', 'altered', 'conflict', 'short_notice', 'overlap']);

// Whether Record payment may be used for a family's month: { ok, items }
export function familyBlockers(ctx, parentId, month) {
  const f = familyMonth(ctx, parentId, month);
  const ids = new Set(f.lines.filter((l) => !l.paidBy).map((l) => l.id));
  const { items } = needsAttention(ctx, month, monthEnd(month), { sessionsOnly: true });
  const blocking = items.filter((it) => FAMILY_BLOCKS.has(it.kind) && ids.has(it.rowId));
  return { ok: blocking.length === 0, items: blocking };
}

// Whether Mark paid may be used for a tutor's period: { ok, items }
export function tutorBlockers(ctx, tutorId, periodStart) {
  const end = payPeriodEnd(periodStart);
  const { items } = needsAttention(ctx, periodStart, end, { sessionsOnly: true });
  const blocking = items.filter((it) => (TUTOR_BLOCKS.has(it.kind) && same(it.tutorId, tutorId))
    || (it.kind === 'no_tutor_rate' && same(it.tutorId, tutorId)));
  return { ok: blocking.length === 0, items: blocking };
}

// ---------------------------------------------------------------------------
// Snapshots written with a payment or payout (the page's own lines, as data)

export function familySnapshot(f) {
  return [
    ...f.lines.filter((l) => !l.paidBy).map((l) => ({
      session_id: l.id,
      day: l.day,
      student_id: String(l.session.student_id),
      subject: l.subject,
      tutor_id: String(l.session.tutor_id),
      minutes: l.minutes,
      state: l.state,
      pct: l.pct.familyRealized,
      rate_id: l.familyRate?.id ?? null,
      rate_cents: l.familyRate?.rate_cents ?? 0,
      amount_cents: l.familyRealized,
      exception: l.exception?.reason ?? null,
    })),
    ...f.adjustments.map((a) => ({ adjustment_id: a.id, day: a.period, label: a.label, amount_cents: a.amount_cents })),
  ];
}

export function tutorSnapshot(t) {
  return [
    ...t.slots.map((s) => ({
      session_id: s.rows[0].id,
      session_ids: s.rows.map((r) => r.id),
      day: s.rows[0].day,
      student_id: String(s.rows[0].session.student_id),
      minutes: s.minutes,
      state: s.rows[0].state,
      group_key: s.rows[0].groupKey,
      tutor_rate_id: s.rows[0].tutorRate?.id ?? null,
      rate_cents: s.rows[0].tutorRate?.rate_cents ?? 0,
      amount_cents: s.tutorRealized,
    })),
    ...t.adjustments.map((a) => ({ adjustment_id: a.id, day: payPeriodEnd(a.period), label: a.label, amount_cents: a.amount_cents })),
  ];
}

// ---------------------------------------------------------------------------
// The session drawer's Billing line (admin only)

export function billingFact(ctx, session, role) {
  if (role !== 'admin' || !ctx) return null;
  const row = ctx.rows.find((r) => same(r.id, session.id));
  if (!row) return null;
  const parts = [];
  if (row.state === 'expected') parts.push(`Upcoming: ${money(row.familyExpected)} family, ${money(row.tutorExpected)} tutor`);
  else if (row.state === 'cancelled' && !row.familyRealized && !row.tutorRealized) parts.push('Cancelled: not billed, not paid');
  else parts.push(`Counted in ${monthName(row.month)}: ${money(row.familyRealized)} family, ${money(row.tutorRealized)} tutor`);
  const familyPaid = row.payerId && ctx.payments.find((p) => same(p.parent_id, row.payerId) && p.period === row.month);
  if (familyPaid) parts.push(`family paid ${money(familyPaid.amount_cents)} on ${shortDate(familyPaid.received_on)}`);
  const tutorPaid = ctx.payouts.find((p) => p.kind === 'tutor' && same(p.tutor_id, row.session.tutor_id) && p.period_start === row.periodStart);
  if (tutorPaid) parts.push(`tutor paid ${shortDate(tutorPaid.paid_on)}`);
  if (row.groupKey) parts.push(`group: ${row.groupKey}`);
  if (row.unpriced) parts.push('no family rate yet');
  return parts.join('; ');
}

// True when a session sits in a month or pay period that money has moved for
export function inPaidPeriod(ctx, session) {
  const row = ctx?.rows?.find((r) => same(r.id, session.id));
  if (!row) return false;
  return ctx.payments.some((p) => same(p.parent_id, row.payerId) && p.period === row.month)
    || ctx.payouts.some((p) => p.kind === 'tutor' && same(p.tutor_id, row.session.tutor_id) && p.period_start === row.periodStart);
}

// 'Nov 2026 · ABC123' style statement number: month plus six characters of the parent id
export function statementNumber(parentId, month) {
  return `${month.slice(0, 7)}-${String(parentId).replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

