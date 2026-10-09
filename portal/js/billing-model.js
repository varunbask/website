// The Account page's money rules, in one place, with no DOM and no network.
// Every number on the page comes from the sessions on the calendar priced by
// the rates and policy the admin set (supabase/migrations/20261010120000_billing.sql).
// The calendar is the source of truth: a session is priced as it stands today,
// with no audit trail to clear first. A session added, moved, lengthened or
// deleted after it happened simply changes the numbers. Only what makes a
// number impossible to work out (no family rate, no tutor pay rate) is listed
// and holds anything back. Nothing here writes; the views call these and
// render the result.
//
// Money is integer cents. Days are Pacific 'YYYY-MM-DD' keys (dates.js). A
// month is the key of its first day ('2026-11-01'); a pay period is the key of
// its first Sunday. A session belongs to the month and the pay period of the
// Pacific day it starts on and is never split.
//
//   ctx = buildContext({ sessions, links, rules, billing, now })
//     sessions  every session from the ledger start (store.getAllSessions)
//     links     tutor_students rows (tutor_id, student_id, subject)
//     rules     session_series rows (id, start_time, end_time)
//     billing   store.getBilling(): settings, policies, familyRates, tutorRates,
//               sessionBilling, payments, payouts, adjustments, contacts,
//               statements, parentLinks, names, fullNames (the store also loads
//               session_edits; nothing here reads it)

import { dayKey, addDays, parseKey, weekday } from './dates.js';
import { durationMinutes } from './sessions-model.js';

export const MINUTES_PER_HOUR = 60;
export const STATEMENT_GRACE_DAYS = 14;
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

// Tutor pay periods are twice a month: the 1st to the 15th, and the 16th to the
// last day. The first day of the period holding `day`:
export function payPeriodStart(day) {
  return `${day.slice(0, 8)}${Number(day.slice(8, 10)) <= 15 ? '01' : '16'}`;
}

export function payPeriodEnd(start) {
  return start.endsWith('-01') ? `${start.slice(0, 8)}15` : monthEnd(start);
}

// Every pay period overlapping [from, to], earliest first
export function periodsOverlapping(from, to) {
  const out = [];
  for (let p = payPeriodStart(from); p <= to; p = addDays(payPeriodEnd(p), 1)) out.push(p);
  return out;
}

// A month's bill is dated the 1st of the next month (October 1 bills September)
export function billDate(month) {
  return addMonths(monthOf(month), 1);
}

// 'Nov 1 to Nov 14'
export function periodText(start) {
  const end = payPeriodEnd(start);
  return `${shortDate(start)} to ${shortDate(end, start)}`;
}

// The day a pay period is paid, as the old scheduler had it: the 1st to the
// 15th is paid on the 15th, the 16th to the end of the month on the 1st of the
// next month. A label only: the page records no payouts (the CPA runs payroll).
export function payDate(start) {
  return start.endsWith('-01') ? `${start.slice(0, 8)}15` : addMonths(monthOf(start), 1);
}

// 'Pays Oct 15', 'Pays Nov 1' (with the year when it is not the period's own: 'Pays Jan 1, 2027')
export function payDateText(start) {
  return `Pays ${shortDate(payDate(start), start)}`;
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
  expected: 'Upcoming',
  attended: 'Attended',
  noshow: 'No-show',
  unconfirmed: 'No attendance yet',
});

// A cancelled session is cancelled, whatever attendance says. One that ended
// without attendance counts as held (the policy can switch that off).
export function stateOf(session, now) {
  const ended = ms(session.ends_at) <= now.getTime();
  if (session.status === 'cancelled') return 'cancelled';
  if (!ended) return 'expected';
  if (session.attendance === 'present' || session.attendance === 'late') return 'attended';
  if (session.attendance === 'absent') return 'noshow';
  return 'unconfirmed';
}

// The percentages for a state: { expected, realized } for the family and for the tutor.
// An exception changes only what the family pays.
function percentages(state, policy, exception) {
  const base = {
    cancelled: [0, 0, 0, 0],
    expected: [100, 0, 100, 0],
    attended: [100, 100, 100, 100],
    noshow: [policy.absent_family_pct, policy.absent_family_pct, policy.absent_tutor_pct, policy.absent_tutor_pct],
    unconfirmed: [100, policy.count_unconfirmed ? 100 : 0, 100, policy.count_unconfirmed ? 100 : 0],
  }[state];
  let [fe, fr] = base;
  // Tutors are paid their standard rate by what happened; no per-lesson override
  const [, , te, tr] = base;
  const ended = state !== 'expected';
  if (exception?.charge_pct !== null && exception?.charge_pct !== undefined) {
    fe = exception.charge_pct;
    fr = ended ? exception.charge_pct : 0;
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
    periodStart: payPeriodStart(day),
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

export function buildContext({ sessions = [], links = [], rules = [], billing, now = new Date() }) {
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
    payments: (billing.payments ?? []).filter(live),
    payouts: (billing.payouts ?? []).filter(live),
    adjustments: (billing.adjustments ?? []).filter(live),
    contacts: new Map((billing.contacts ?? []).map((c) => [String(c.parent_id), c])),
    statements: billing.statements ?? [],
    names: billing.names ?? new Map(),
    rules: new Map((rules ?? []).map((r) => [String(r.id), r])),
    links: links ?? [],
    parentLinks: billing.parentLinks ?? [],
    payerOf: (studentId) => payer.get(String(studentId)) ?? null,
    payerCount: (studentId) => payerCount.get(String(studentId)) ?? 0,
    linkSubject: (tutorId, studentId) => {
      const s = linkMap.get(`${tutorId}|${studentId}`);
      return s && String(s).trim() ? String(s).trim() : null;
    },
    nameOf: (id) => (billing.names?.get?.(String(id)) ?? '').trim() || 'Unknown',
    // The person's real full name, or null: nameOf falls back to an email, which
    // must never be printed on a statement the parent reads
    fullNameOf: (id) => (billing.fullNames?.get?.(String(id)) ?? '').trim() || null,
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
// whose times overlap are one slot: paid once, for the longest payable member,
// at the highest percentage. Everything else is its own slot (two separate
// group lessons on one day stay two slots even with the same key).
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
  const clusters = [];
  for (const [k, list] of groups) {
    const sorted = [...list].sort((a, b) => ms(a.session.starts_at) - ms(b.session.starts_at));
    let current = null;
    let end = -Infinity;
    for (const r of sorted) {
      if (!current || ms(r.session.starts_at) >= end) {
        current = [];
        clusters.push([`${k}|${r.id}`, current]);
        end = -Infinity;
      }
      current.push(r);
      end = Math.max(end, ms(r.session.ends_at));
    }
  }
  for (const [k, members] of clusters) {
    const rate = members.find((m) => m.tutorRate)?.tutorRate?.rate_cents ?? 0;
    const longest = (list) => list.reduce((t, m) => Math.max(t, m.minutes), 0);
    const maxPct = (list, f) => list.reduce((t, m) => Math.max(t, f(m)), 0);
    const exp = members.filter((m) => m.pct.tutorExpected > 0);
    const real = members.filter((m) => m.pct.tutorRealized > 0);
    slots.push({
      key: k,
      rows: members,
      // cancelled members do not add hours
      minutes: longest(exp.length ? exp : members),
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

// Who a session is billed to. A payment's lines say who paid for which
// sessions in its month, so moving the bill to another parent later never
// moves a month that was already paid; everything else goes to the student's
// current payer.
export function payerFor(ctx, row) {
  ctx.billedTo ??= new Map();
  if (!ctx.billedTo.has(row.month)) {
    const map = new Map();
    const paid = ctx.payments.filter((p) => p.period === row.month).sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
    for (const p of paid) for (const l of p.lines ?? []) if (l.session_id !== undefined && l.session_id !== null) map.set(String(l.session_id), String(p.parent_id));
    ctx.billedTo.set(row.month, map);
  }
  return ctx.billedTo.get(row.month).get(row.id) ?? row.payerId;
}

// One family's month
export function familyMonth(ctx, parentId, month) {
  const rows = ctx.rows.filter((r) => r.month === month && same(payerFor(ctx, r), parentId));
  const lines = rows.map((r) => ({ ...r, paidBy: null }));
  const counted = lines;
  const adjustments = familyAdjustments(ctx, parentId, month);
  const payments = familyPayments(ctx, parentId, month);
  const adjustmentCents = sum(adjustments, (a) => a.amount_cents);
  const realizedCents = sum(counted, (l) => l.familyRealized);
  const expectedCents = sum(counted, (l) => l.familyExpected);
  const paidCents = sum(payments, (p) => p.amount_cents);
  const owedCents = realizedCents + adjustmentCents;
  const students = [...new Set(rows.map((r) => String(r.session.student_id)))];
  const minutes = sum(counted.filter((l) => l.familyRealized > 0 || l.familyExpected > 0), (l) => l.minutes);
  const statement = ctx.statements.find((x) => same(x.parent_id, parentId) && x.period === month);
  const lastPayment = payments.reduce((best, p) => (!best || p.received_on > best.received_on ? p : best), null);
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
    // Everything owed through this month, after every payment (loose ones too)
    balanceThrough: familyBalance(ctx, parentId, month),
    // The day the bill was released (statements.sent_on), and whether the portal
    // keeps a copy a parent can read (month_cents is lifted from the snapshot,
    // null for a statement marked sent before snapshots existed)
    sentOn: statement?.sent_on ?? null,
    released: Boolean(statement) && statement.month_cents !== null && statement.month_cents !== undefined,
    contact: ctx.contacts.get(String(parentId)) ?? null,
  };
}

// Every paying parent with something in the month (sessions, adjustments or payments)
export function familyRows(ctx, month) {
  const ids = new Set();
  for (const r of ctx.rows) if (r.month === month && payerFor(ctx, r)) ids.add(payerFor(ctx, r));
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
  for (const r of ctx.rows) if (r.month <= throughMonth && same(payerFor(ctx, r), parentId)) months.add(r.month);
  for (const a of ctx.adjustments) if (a.party === 'family' && same(a.party_id, parentId) && a.period <= throughMonth) months.add(a.period);
  const owed = sum([...months], (m) => familyMonthOwed(ctx, parentId, m));
  const paid = sum(ctx.payments.filter((p) => same(p.parent_id, parentId)
    && ((p.period && p.period <= throughMonth) || (!p.period && monthOf(p.received_on) <= throughMonth))), (p) => p.amount_cents);
  return owed - paid;
}

function familyMonthOwed(ctx, parentId, month) {
  return sum(ctx.rows.filter((r) => r.month === month && same(payerFor(ctx, r), parentId)), (r) => r.familyRealized)
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
  if (f.paidCents > 0 && f.dueCents <= 0) {
    if (f.dueCents < 0) return { key: 'credit', label: `Credit ${money(-f.dueCents)}`, tone: 'info' };
    return { key: 'paid', label: f.lastPayment ? `Paid ${shortDate(f.lastPayment.received_on, today)}` : 'Paid', tone: 'success' };
  }
  if (f.owedCents > 0 && f.balanceThrough <= 0) return { key: 'covered', label: 'Covered by credit', tone: 'success' };
  if (f.paidCents > 0) return { key: 'partial', label: `Paid ${money(f.paidCents)} of ${money(f.owedCents)}`, tone: 'warning' };
  if (f.owedCents <= 0 && f.expectedCents > 0) return { key: 'upcoming', label: 'Upcoming', tone: 'neutral' };
  if (f.owedCents <= 0) return { key: 'nothing', label: 'Nothing owed', tone: 'neutral' };
  if (f.month < monthOf(today) && today > dueDate(ctx, f.month, f.sentOn)) return { key: 'overdue', label: 'Overdue', tone: 'danger' };
  // A parent sees nothing of a month until it is released, so an unpaid family
  // is either waiting for the release or released and waiting for payment
  if (f.released) return { key: 'released', label: `Released ${shortDate(f.sentOn, today)}`, tone: 'neutral' };
  // marked sent before the portal kept copies: the family was told, the portal has nothing yet
  if (f.sentOn) return { key: 'sent', label: `Sent ${shortDate(f.sentOn, today)}`, tone: 'neutral' };
  return { key: 'unpaid', label: 'Not released yet', tone: 'neutral' };
}

// Total owed by every family across all months (credits do not offset others' debts)
export function allOutstanding(ctx) {
  const ids = new Set(ctx.rows.map((r) => payerFor(ctx, r)).filter(Boolean));
  for (const p of ctx.payments) ids.add(String(p.parent_id));
  for (const a of ctx.adjustments) if (a.party === 'family') ids.add(String(a.party_id));
  return sum([...ids], (id) => Math.max(0, familyBalance(ctx, id)));
}

// Students whose sessions have no paying parent
// A free lesson (a trial, or any 0% exception) bills nobody, so a student
// whose only lessons are free (a trial before the parent joins) is not listed
export function studentsWithoutPayer(ctx, from, to) {
  const ids = new Set();
  for (const r of ctx.rows) {
    if (inRange(r, from, to) && !payerFor(ctx, r) && r.state !== 'cancelled' && r.exception?.charge_pct !== 0) {
      ids.add(String(r.session.student_id));
    }
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Tutors (twice a month). Information only: the CPA runs payroll, so the page
// shows what each tutor earned in each period and records no payouts.

export function tutorAdjustments(ctx, tutorId, periodStart) {
  return ctx.adjustments.filter((a) => a.party === 'tutor' && same(a.party_id, tutorId) && a.period === periodStart);
}

export function tutorPeriod(ctx, tutorId, periodStart) {
  const rows = ctx.rows.filter((r) => r.periodStart === periodStart && same(r.session.tutor_id, tutorId));
  const slots = groupSlots(rows);
  const adjustments = tutorAdjustments(ctx, tutorId, periodStart);
  const adjustmentCents = sum(adjustments, (a) => a.amount_cents);
  const realizedCents = sum(slots, (s) => s.tutorRealized);
  const expectedCents = sum(slots, (s) => s.tutorExpected);
  return {
    tutorId: String(tutorId),
    name: ctx.nameOf(tutorId),
    periodStart,
    periodEnd: payPeriodEnd(periodStart),
    rows,
    slots,
    adjustments,
    rate: tutorRateFor(tutorId, payPeriodEnd(periodStart), ctx.tutorRates),
    minutes: sum(slots, (s) => s.minutes),
    payableMinutes: sum(slots, (s) => s.payableMinutes),
    expectedCents: expectedCents + adjustmentCents,
    realizedCents,
    adjustmentCents,
    // What the tutor earned for the period: sessions that happened plus adjustments
    totalCents: realizedCents + adjustmentCents,
  };
}

// Everyone with sessions or adjustments in the period
export function periodRows(ctx, periodStart) {
  const ids = new Set();
  for (const r of ctx.rows) if (r.periodStart === periodStart) ids.add(String(r.session.tutor_id));
  for (const a of ctx.adjustments) if (a.party === 'tutor' && a.period === periodStart) ids.add(String(a.party_id));
  return [...ids].map((id) => tutorPeriod(ctx, id, periodStart)).sort((a, b) => a.name.localeCompare(b.name));
}

// Upcoming, In progress, Check first (open items in it), or Complete (ready for the CPA)
export function periodStatus(ctx, t) {
  const today = dayKey(ctx.now);
  if (t.periodStart > today) return { key: 'future', label: 'Upcoming', tone: 'neutral' };
  if (t.periodEnd >= today) return { key: 'open', label: 'In progress', tone: 'neutral' };
  if (!tutorBlockers(ctx, t.tutorId, t.periodStart).ok) return { key: 'check', label: 'Check first', tone: 'warning' };
  return { key: 'complete', label: 'Complete', tone: 'success' };
}

// Every tutor with sessions in [from, to]: hours, expected and realized pay,
// and what they have earned so far this year
export function tutorRangeRows(ctx, from, to) {
  const byTutor = new Map();
  for (const r of ctx.rows) {
    if (!inRange(r, from, to)) continue;
    const k = String(r.session.tutor_id);
    if (!byTutor.has(k)) byTutor.set(k, []);
    byTutor.get(k).push(r);
  }
  return [...byTutor].map(([tutorId, rows]) => {
    const slots = groupSlots(rows);
    return {
      tutorId,
      name: ctx.nameOf(tutorId),
      minutes: sum(slots.filter((s) => s.tutorExpected > 0 || s.payableMinutes > 0), (s) => s.minutes),
      expectedCents: sum(slots, (s) => s.tutorExpected),
      realizedCents: sum(slots, (s) => s.tutorRealized),
      ytdCents: yearToDate(ctx, tutorId, parseKey(to).y),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// Earned by a tutor this year, through today: sessions that happened plus adjustments
export function yearToDate(ctx, tutorId, year = parseKey(dayKey(ctx.now)).y) {
  const from = `${year}-01-01`;
  const to = [dayKey(ctx.now), `${year}-12-31`].sort()[0];
  const rows = ctx.rows.filter((r) => same(r.session.tutor_id, tutorId) && r.day >= from && r.day <= to);
  const adj = ctx.adjustments.filter((a) => a.party === 'tutor' && same(a.party_id, tutorId) && a.period >= from && a.period <= to);
  return sum(groupSlots(rows), (s) => s.tutorRealized) + sum(adj, (a) => a.amount_cents);
}

// ---------------------------------------------------------------------------
// Totals for a range

// Totals for [from, to]. For a whole month (byMonth), Collected is what came in
// for that month's bills (plus payments not tied to a month received in it);
// for any other range it is what came in on those days.
export function rangeTotals(ctx, from, to, { byMonth = from === monthOf(from) && to === monthEnd(from), cash = false } = {}) {
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
  const collected = byMonth && !cash
    ? sum(ctx.payments.filter((p) => p.period === from || (!p.period && p.received_on >= from && p.received_on <= to)), (p) => p.amount_cents)
    : sum(ctx.payments.filter((p) => p.received_on >= from && p.received_on <= to), (p) => p.amount_cents);
  const tutorExpected = sum(slots, (s) => s.tutorExpected) + tutorAdj;
  const tutorRealized = sum(slots, (s) => s.tutorRealized) + tutorAdj;
  const studentMinutes = sum(rows.filter((r) => r.familyExpected > 0), (r) => r.minutes);
  const slotMinutes = sum(slots.filter((s) => s.tutorExpected > 0), (s) => s.minutes);
  const netExpected = revenueExpected - tutorExpected;
  const netRealized = revenueRealized - tutorRealized;
  return {
    from,
    to,
    revenueExpected,
    revenueRealized,
    collected,
    tutorExpected,
    tutorRealized,
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
    const t = rangeTotals(ctx, month, monthEnd(month), { cash: true });
    return { month, ...t };
  });
}

// ---------------------------------------------------------------------------
// Needs attention
//
// Only what makes a number impossible to work out, each with its fix:
//   unpriced       a session with no family rate (Add rate): holds that family's
//                  month back from Mark paid and Release
//   no_tutor_rate  a tutor with no pay rate (Set it on Rates): marks their pay
//                  period Check first
//   overlap        one tutor, two students at the same time (Mark as group so the
//                  tutor is paid once): information, never holds anything back
//   no_payer       a student with no paying parent (Link a parent): information
//   overdue        a family past its due date: information
// Everything else (attendance never recorded, a session added or changed after
// it happened, a cancellation, a deletion, a month edited after it was paid)
// just changes the numbers.

export const ATTENTION = Object.freeze({
  unpriced: { title: 'No family rate', blocks: true },
  no_tutor_rate: { title: 'No tutor pay rate', blocks: true },
  overlap: { title: 'Same tutor, same time', blocks: false },
  no_payer: { title: 'No paying parent', blocks: false },
  overdue: { title: 'Overdue families', blocks: false },
});

// An overlap the admin chose to Accept on the list (session_billing.reviewed_at): it is a real clash, not a group
export function isAccepted(row) {
  return Boolean(row.exception?.reviewed_at);
}

// Flags on one session: only a missing family rate. A free lesson (a trial)
// needs no rate, and a cancelled session is never priced.
export function flagsFor(ctx, row) {
  return row.unpriced && row.exception?.charge_pct !== 0 ? ['unpriced'] : [];
}

// Payable sessions of one tutor that overlap without sharing a group key
export function overlapsOf(rows) {
  const out = new Set();
  const payable = rows.filter((r) => r.state !== 'cancelled');
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

// Everything worth a look in [from, to]: { items, byKind }
// Each item: { kind, rowId?, row?, tutorId?, studentId?, parentId?, month?, cents? }
// sessionsOnly skips the family-wide checks (no payer, overdue), for the gates.
export function needsAttention(ctx, from, to, { sessionsOnly = false } = {}) {
  const items = [];
  const rows = ctx.rows.filter((r) => inRange(r, from, to));
  for (const r of rows) {
    for (const kind of flagsFor(ctx, r)) {
      items.push({ kind, rowId: r.id, row: r, tutorId: String(r.session.tutor_id), studentId: String(r.session.student_id), parentId: payerFor(ctx, r) });
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
      if (!isAccepted(r)) items.push({ kind: 'overlap', rowId: id, row: r, tutorId, studentId: String(r.session.student_id), parentId: payerFor(ctx, r) });
    }
    if (list.some((r) => r.noTutorRate && r.state !== 'cancelled')) items.push({ kind: 'no_tutor_rate', tutorId });
  }
  if (sessionsOnly) return group(items);
  for (const studentId of studentsWithoutPayer(ctx, from, to)) items.push({ kind: 'no_payer', studentId });
  // Families with money owed past their due date
  const today = dayKey(ctx.now);
  for (let m = monthOf(ctx.settings.ledger_start); m < monthOf(today); m = addMonths(m, 1)) {
    for (const f of familyRows(ctx, m)) {
      if (f.dueCents > 0 && f.balanceThrough > 0 && today > dueDate(ctx, m, f.sentOn)) {
        items.push({ kind: 'overdue', parentId: f.parentId, month: m, cents: Math.min(f.dueCents, f.balanceThrough) });
      }
    }
  }
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

// Whether Mark paid and Release may be used for a family's
// month: { ok, items }. Only a session with no family rate holds it back.
// `attention` is needsAttention(ctx, month, monthEnd(month), { sessionsOnly: true }),
// passed in when many families are checked in one go so it is worked out once.
export function familyBlockers(ctx, parentId, month, { attention = null } = {}) {
  const f = familyMonth(ctx, parentId, month);
  const ids = new Set(f.lines.filter((l) => !l.paidBy).map((l) => l.id));
  const { items } = attention ?? needsAttention(ctx, month, monthEnd(month), { sessionsOnly: true });
  const blocking = items.filter((it) => it.kind === 'unpriced' && ids.has(it.rowId));
  return { ok: blocking.length === 0, items: blocking };
}

// Whether a tutor's period is ready for the CPA: { ok, items }. Only a missing
// pay rate holds it back (the period then reads Check first).
export function tutorBlockers(ctx, tutorId, periodStart) {
  const end = payPeriodEnd(periodStart);
  const { items } = needsAttention(ctx, periodStart, end, { sessionsOnly: true });
  const blocking = items.filter((it) => it.kind === 'no_tutor_rate' && same(it.tutorId, tutorId));
  return { ok: blocking.length === 0, items: blocking };
}

// ---------------------------------------------------------------------------
// Snapshot written with a payment (the page's own lines, as data)

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
  const payer = payerFor(ctx, row);
  const familyPaid = payer && ctx.payments.find((p) => same(p.parent_id, payer) && p.period === row.month);
  if (familyPaid) parts.push(`family paid ${money(familyPaid.amount_cents)} on ${shortDate(familyPaid.received_on)}`);
  if (row.groupKey) parts.push(`group: ${row.groupKey}`);
  if (row.exception?.reason === 'trial') parts.push('free trial');
  else if (row.unpriced && row.exception?.charge_pct !== 0) parts.push('no family rate yet');
  return parts.join('; ');
}

// True when a session sits in a month its family has paid for
export function inPaidPeriod(ctx, session) {
  const row = ctx?.rows?.find((r) => same(r.id, session.id));
  if (!row) return false;
  const payer = payerFor(ctx, row);
  return ctx.payments.some((p) => same(p.parent_id, payer) && p.period === row.month);
}

// 'Nov 2026 · ABC123' style statement number: month plus six characters of the parent id
export function statementNumber(parentId, month) {
  return `${month.slice(0, 7)}-${String(parentId).replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

