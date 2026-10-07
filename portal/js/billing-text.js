// Words and files for the Account page: the policy paragraph, statements and
// tutor pay summaries as plain text (Copy as text), CSV downloads, and the Paste
// rates importer that reads the old scheduler's "Kid (Parent): Math $45" lines.
// No DOM, no network.

import {
  money, hoursText, monthName, shortDate, dayText, periodText, payPeriodEnd, payDate, payDateText, dueDate, billDate, statementNumber, STATES,
} from './billing-model.js';

const same = (a, b) => String(a) === String(b);

// ---------------------------------------------------------------------------
// Policy

// The paragraph printed under the Policy card, generated from the row in force
// so the words always match the numbers
export function policyText(policy, settings) {
  const noShow = policy.absent_family_pct === 100 && policy.absent_tutor_pct === 100
    ? 'No-shows (attendance marked Absent) are billed to the family and paid to the tutor in full.'
    : `No-shows (attendance marked Absent) are billed at ${policy.absent_family_pct} percent and paid to the tutor at ${policy.absent_tutor_pct} percent.`;
  const unconfirmed = policy.count_unconfirmed
    ? 'Lessons without attendance count as held.'
    : 'Lessons without attendance are not billed or paid until someone records them.';
  return [
    'The Account page prices every lesson on the calendar as it stands, so changing the calendar changes the numbers. Only a lesson with no family rate holds a family’s bill back, and only a tutor with no pay rate marks a pay period Check first.',
    'Cancelled lessons are not billed and not paid. There is no cancellation policy: families cancel or reschedule whenever they need to.',
    noShow,
    unconfirmed,
    `Families are billed by calendar month, with the bill dated the 1st of the next month and due on the ${ordinal(settings.due_day)}. A parent sees a month’s bill in the portal only after you release it, usually on the 1st (Families, Release bills). Tutor pay is counted twice a month, the 1st to the 15th and the 16th to the end of the month, for payroll, and paid on the 15th and on the 1st of the next month.`,
  ].join(' ');
}

function ordinal(n) {
  const k = n % 100;
  if (k >= 11 && k <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th'}`;
}

// ---------------------------------------------------------------------------
// Statements and payout slips as text

// A family's month: header, sessions by student, adjustments, payments, balance
export function statementText(ctx, f, { previousCents = 0 } = {}) {
  const s = ctx.settings;
  const lines = [];
  lines.push(`${s.business_name}`);
  lines.push(`Statement ${statementNumber(f.parentId, f.month)} for ${f.name}`);
  lines.push(`${monthName(f.month)}, dated ${dayText(billDate(f.month))}, due ${dayText(dueDate(ctx, f.month, f.sentOn))}`);
  lines.push('');
  const byStudent = new Map();
  for (const l of f.lines) {
    const k = String(l.session.student_id);
    if (!byStudent.has(k)) byStudent.set(k, []);
    byStudent.get(k).push(l);
  }
  for (const [studentId, list] of byStudent) {
    lines.push(ctx.nameOf(studentId));
    for (const l of list) {
      const what = [dayText(l.day), l.subject || 'Tutoring', `with ${ctx.nameOf(l.session.tutor_id)}`, `${hoursText(l.minutes)} hr`].join(', ');
      const note = l.paidBy ? ` (paid by ${l.paidBy})` : noteFor(l);
      lines.push(`  ${what}${note}: ${money(l.paidBy ? 0 : (l.state === 'expected' ? l.familyExpected : l.familyRealized))}`);
    }
  }
  for (const a of f.adjustments) lines.push(`${labelText(a.label)}${a.note ? ` (${a.note})` : ''}: ${money(a.amount_cents)}`);
  lines.push('');
  if (previousCents) lines.push(`Previous balance: ${money(previousCents)}`);
  lines.push(`This month: ${money(f.owedCents)}`);
  for (const p of f.payments) lines.push(`Paid ${shortDate(p.received_on)} by ${methodText(p.method)}: ${money(-p.amount_cents)}`);
  lines.push(`Amount due: ${money(previousCents + f.owedCents - f.paidCents)}`);
  if (s.pay_note) {
    lines.push('');
    lines.push(s.pay_note);
  }
  return lines.join('\n');
}

function noteFor(l) {
  if (l.state === 'expected') return ' (upcoming)';
  if (l.state === 'cancelled') return l.familyRealized ? ` (late cancellation, ${l.pct.familyRealized}%)` : ' (cancelled)';
  if (l.state === 'noshow') return l.pct.familyRealized === 100 ? ' (no-show)' : ` (no-show, ${l.pct.familyRealized}%)`;
  if (l.exception?.reason === 'trial') return ' (free trial)';
  return '';
}

// What a released statement said, saved with it (statements.snapshot) so the
// paying parent can read it in the portal exactly as it was released: family
// amounts only, never tutor pay or admin notes. sentOn is the day it was
// released (it sets the due date), and paid_total_cents is every payment from
// this parent as of now, so the portal can tell what was paid after release. A tutor
// or student with no full name reads "your tutor" / "your student" here, never
// the email nameOf falls back to.
export function statementSnapshot(ctx, f, { previousCents = 0, sentOn } = {}) {
  const s = ctx.settings;
  const who = (id, fallback) => ctx.fullNameOf?.(id) ?? fallback;
  const amount = (l) => (l.paidBy ? 0 : (l.state === 'expected' ? l.familyExpected : l.familyRealized));
  const lines = f.lines.map((l) => ({
    day: l.day,
    starts_at: l.session.starts_at,
    ends_at: l.session.ends_at,
    student: who(l.session.student_id, 'your student'),
    subject: l.subject || 'Tutoring',
    tutor: who(l.session.tutor_id, 'your tutor'),
    minutes: l.minutes,
    rate_cents: l.familyRate?.rate_cents ?? null,
    amount_cents: amount(l),
    note: (l.paidBy ? `paid by ${l.paidBy}` : noteFor(l).trim().replace(/^\((.*)\)$/, '$1')) || null,
    cancelled: l.state === 'cancelled',
  }));
  const payments = f.payments.map((p) => ({ received_on: p.received_on, method: methodText(p.method), reference: p.reference ?? null, amount_cents: p.amount_cents }));
  // ctx.payments leaves out voided payments; every month and loose payments count
  const paidTotal = ctx.payments.filter((p) => same(p.parent_id, f.parentId)).reduce((t, p) => t + p.amount_cents, 0);
  return {
    v: 1,
    number: statementNumber(f.parentId, f.month),
    business: s.business_name,
    pay_note: s.pay_note ?? null,
    name: f.name,
    month: f.month,
    bill_date: billDate(f.month),
    due_date: dueDate(ctx, f.month, sentOn ?? null),
    lines,
    adjustments: f.adjustments.map((a) => ({ label: labelText(a.label), note: a.note ?? null, amount_cents: a.amount_cents })),
    previous_cents: previousCents,
    month_cents: f.owedCents,
    payments,
    due_cents: previousCents + f.owedCents - f.paidCents,
    paid_total_cents: paidTotal,
  };
}

// What Families offers for a family's month, and how it is written:
//   kind     'mark'  not released yet (the control reads Release)
//            'save'  marked sent before the portal kept snapshots (no snapshot yet)
//            'again' released, and the month's charges or the balance brought
//                    forward changed since (a payment recorded later is no change:
//                    the parent's status follows payments by itself)
//            null    nothing to do
//   blocked  a session in the month has no family rate, the same gate as Mark paid and
//            Record payment; the buttons stay off until a rate is added so a parent
//            never sees $0.00 lines
//   sentOn   the day that goes into the snapshot: a statement sent before
//            snapshots keeps the day it really went out (its due date must not
//            slide forward), a deliberate Release again counts from today
// sent is the row from the page's ledger: { sent_on, month_cents, previous_cents }
// (the last two lifted from the snapshot, null without one).
export function sendAction(sent, f, previousCents, gate, today) {
  const saved = sent && sent.month_cents !== null && sent.month_cents !== undefined;
  let kind = null;
  if (!sent) kind = 'mark';
  else if (!saved) kind = 'save';
  else if (sent.month_cents !== f.owedCents || (sent.previous_cents ?? 0) !== previousCents) kind = 'again';
  return { kind, blocked: kind !== null && !gate.ok, sentOn: kind === 'save' ? sent.sent_on : today };
}

// The statements columns to write for a snapshot. Only a deliberate Release
// again moves sent_on; saving a legacy statement leaves it alone.
export function sendColumns(action, snap, today) {
  const columns = { snapshot: snap, due_cents: snap.due_cents };
  if (action.kind === 'again') columns.sent_on = today;
  return columns;
}

// Where a released statement stands for the parent. A row is from my_statements():
// { period, due_cents, paid_total_cents (all the parent's payments to date), snapshot }.
//
// Only the newest released statement is live: what has been paid since it was released
// is the parent's payments now less the total saved in its snapshot (negative
// after a void, so a voided payment reopens it), which also covers a balance
// carried into a later month and paid there, and loose payments.
//
// An older statement is settled by the one after it (`newer`): when that one
// brought a balance forward, this one was carried to it; otherwise it was paid.
// It is never overdue.
export function statementStatus(row, today, newer = null) {
  const snap = row.snapshot ?? {};
  const due = row.due_cents ?? snap.due_cents ?? 0;
  if (newer) return settledStatus(due, newer);
  const paidNow = Number(row.paid_total_cents ?? 0);
  const atSend = Number.isFinite(snap.paid_total_cents) ? snap.paid_total_cents : paidNow;
  const since = paidNow - atSend;
  const left = due - since;
  if (left <= 0) {
    if (due < 0) return { key: 'credit', label: `Credit ${money(-left)}`, tone: 'info', leftCents: 0 };
    if (due === 0 && since === 0) return { key: 'nothing', label: 'Nothing due', tone: 'success', leftCents: 0 };
    return { key: 'paid', label: 'Paid', tone: 'success', leftCents: 0 };
  }
  if (since > 0) return { key: 'partial', label: `Paid ${money(since)} of ${money(due)}`, tone: 'warning', leftCents: left };
  if (snap.due_date && today > snap.due_date) return { key: 'overdue', label: 'Overdue', tone: 'danger', leftCents: left };
  return { key: 'due', label: snap.due_date ? `Due ${shortDate(snap.due_date, today)}` : 'Due', tone: 'neutral', leftCents: left };
}

function settledStatus(due, newer) {
  const month = String(newer.period).slice(0, 10);
  // Nothing is carried from a statement that owed nothing
  if (due > 0 && (newer.snapshot?.previous_cents ?? 0) > 0) {
    return { key: 'carried', label: `Carried to ${monthName(month).split(' ')[0]}`, tone: 'neutral', leftCents: 0, carriedTo: month };
  }
  if (due <= 0) return { key: 'settled', label: 'Settled', tone: 'neutral', leftCents: 0 };
  return { key: 'paid', label: 'Paid', tone: 'success', leftCents: 0 };
}

// Every row's status, in the order given (my_statements() lists newest first)
export function statementStatuses(rows, today) {
  const day = (r) => String(r.period).slice(0, 10);
  const order = rows.map((_, i) => i).sort((a, b) => day(rows[b]).localeCompare(day(rows[a])));
  const out = new Array(rows.length);
  order.forEach((index, rank) => {
    out[index] = statementStatus(rows[index], today, rank === 0 ? null : rows[order[rank - 1]]);
  });
  return out;
}

// A tutor's pay period, for payroll
export function payoutText(ctx, t) {
  const s = ctx.settings;
  const lines = [];
  lines.push(`${s.business_name}`);
  lines.push(`Pay for ${t.name}, ${periodText(t.periodStart)}`);
  lines.push(payDateText(t.periodStart));
  lines.push('');
  for (const slot of t.slots) {
    const r = slot.rows[0];
    const who = slot.rows.map((x) => ctx.nameOf(x.session.student_id)).join(', ');
    const tag = slot.rows.length > 1 ? ' (group)' : noteFor(r);
    lines.push(`${dayText(r.day)}, ${who}, ${r.subject || 'Tutoring'}, ${hoursText(slot.minutes)} hr${tag}: ${money(slot.tutorRealized || slot.tutorExpected)}`);
  }
  for (const a of t.adjustments) lines.push(`${labelText(a.label)}${a.note ? ` (${a.note})` : ''}: ${money(a.amount_cents)}`);
  lines.push('');
  lines.push(`Hours: ${hoursText(t.minutes)}${t.rate ? ` at ${money(t.rate.rate_cents)}/hr` : ''}`);
  lines.push(`Total: ${money(t.totalCents)}`);
  return lines.join('\n');
}

export const METHODS = Object.freeze({
  zelle: 'Zelle', venmo: 'Venmo', check: 'Check', cash: 'Cash', card: 'Card', payroll: 'Payroll', other: 'Other',
});
export function methodText(m) {
  return METHODS[m] ?? 'Other';
}

export const LABELS = Object.freeze({
  late_fee: 'Late fee', discount: 'Discount', credit: 'Credit', bonus: 'Bonus',
  reimbursement: 'Reimbursement', deduction: 'Deduction', other: 'Adjustment',
});
export function labelText(l) {
  return LABELS[l] ?? 'Adjustment';
}

export function stateText(state) {
  return STATES[state] ?? state;
}

// ---------------------------------------------------------------------------
// CSV

function cell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Formulas are neutralized so a spreadsheet never runs a name as a formula
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvText(header, rows) {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const dollars = (cents) => (Math.round(cents) / 100).toFixed(2);

// Status here is about payment (a bill waiting for release or for payment is
// Unpaid); Released is the day the bill went to the parent, blank before that
const UNPAID_KEYS = new Set(['unpaid', 'released', 'sent']);

export function familiesCsv(rows) {
  return csvText(
    ['Family', 'Students', 'Hours', 'Owed', 'Paid', 'Balance', 'Status', 'Released'],
    rows.map((f) => [f.name, f.studentNames ?? f.students.length, hoursText(f.minutes), dollars(f.owedCents), dollars(f.paidCents), dollars(f.balanceCents ?? f.dueCents),
      UNPAID_KEYS.has(f.status?.key) ? 'Unpaid' : (f.status?.label ?? ''), f.released ? f.sentOn : '']),
  );
}

// One pay period, one row per tutor, for the CPA
export function payrollCsv(rows) {
  return csvText(
    ['Tutor', 'Period start', 'Period end', 'Pay date', 'Hours', 'Rate', 'Sessions', 'Adjustments', 'Total'],
    rows.map((t) => [t.name, t.periodStart, payPeriodEnd(t.periodStart), payDate(t.periodStart), hoursText(t.minutes), t.rate ? dollars(t.rate.rate_cents) : '',
      dollars(t.realizedCents), dollars(t.adjustmentCents), dollars(t.totalCents)]),
  );
}

export function sessionsCsv(ctx, rows) {
  return csvText(
    ['Date', 'Student', 'Tutor', 'Subject', 'Minutes', 'State', 'Family rate', 'Family amount', 'Tutor rate', 'Tutor amount'],
    rows.map((r) => [r.day, ctx.nameOf(r.session.student_id), ctx.nameOf(r.session.tutor_id), r.subject ?? '', r.minutes, stateText(r.state),
      r.familyRate ? dollars(r.familyRate.rate_cents) : '', dollars(r.familyRealized || r.familyExpected),
      r.tutorRate ? dollars(r.tutorRate.rate_cents) : '', dollars(r.tutorRealized || r.tutorExpected)]),
  );
}

export function yearCsv(rows) {
  return csvText(
    ['Month', 'Revenue expected', 'Revenue realized', 'Collected', 'Tutor pay', 'Net'],
    rows.map((r) => [monthName(r.month), dollars(r.revenueExpected), dollars(r.revenueRealized), dollars(r.collected),
      dollars(r.tutorRealized), dollars(r.netRealized)]),
  );
}

// ---------------------------------------------------------------------------
// Paste rates: "Kevin (Alan): Math $45", "Jayden (Stella): Ethan Math $45, Math $60"

// -> [{ line, student, parent, subject, cents }] and [{ line, error }]
export function parseRateLines(text) {
  const rates = [];
  const errors = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.+?)(?:\s*\((.+)\))?\s*:\s*(.+)$/.exec(line);
    if (!m) {
      errors.push({ line, error: 'Write it as Name (Parent): Subject $45' });
      continue;
    }
    const student = m[1].trim();
    const parent = m[2]?.trim() ?? null;
    const parts = m[3].split(',').map((p) => p.trim()).filter(Boolean);
    let ok = 0;
    for (const part of parts) {
      const pm = /^(.*?)\s*\$\s*(\d+(?:\.\d{1,2})?)\s*(?:\/\s*h(?:ou)?r)?$/i.exec(part);
      if (!pm || !pm[1].trim()) {
        errors.push({ line, error: `Could not read "${part}"` });
        continue;
      }
      const [whole, frac = ''] = pm[2].split('.');
      rates.push({ line, student, parent, subject: pm[1].trim().replace(/\s+/g, ' '), cents: Number(whole) * 100 + Number(frac.padEnd(2, '0')) });
      ok += 1;
    }
    if (!ok && !parts.length) errors.push({ line, error: 'No subject and price' });
  }
  return { rates, errors };
}

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const first = (s) => norm(s).split(' ')[0];

// Resolve parsed rates against the portal's people.
//   students: [{ id, full_name }]  parents: [{ id, full_name }]
//   parentLinks: [{ parent_id, student_id }]  links: tutor_students rows
//   tutors: [{ id, full_name }]  existing: family_rates rows
// -> { ready: [{ ...rate, student_id, tutor_id, subject }], problems: [{ ...rate, reason }], already: [...] }
export function matchRates(parsed, { students = [], parents = [], parentLinks = [], links = [], tutors = [], existing = [], effectiveFrom }) {
  const ready = [];
  const problems = [];
  const already = [];
  for (const r of parsed) {
    let cands = students.filter((s) => norm(s.full_name) === norm(r.student));
    if (!cands.length) cands = students.filter((s) => first(s.full_name) === first(r.student) && norm(r.student).split(' ').length === 1);
    if (cands.length > 1 && r.parent) {
      const parentIds = parents.filter((p) => norm(p.full_name) === norm(r.parent) || first(p.full_name) === first(r.parent)).map((p) => String(p.id));
      cands = cands.filter((s) => parentLinks.some((l) => same(l.student_id, s.id) && parentIds.includes(String(l.parent_id))));
    }
    if (cands.length !== 1) {
      problems.push({ ...r, reason: cands.length ? `More than one student named ${r.student}` : `No student named ${r.student}` });
      continue;
    }
    const student = cands[0];
    // "Ethan Math": a linked tutor's first name before the subject makes a tutor-specific rate
    let subject = r.subject;
    let tutorId = null;
    const words = r.subject.split(' ');
    if (words.length > 1) {
      const linked = links.filter((l) => same(l.student_id, student.id)).map((l) => tutors.find((t) => same(t.id, l.tutor_id))).filter(Boolean);
      const tutor = linked.find((t) => first(t.full_name) === norm(words[0]));
      if (tutor) {
        tutorId = String(tutor.id);
        subject = words.slice(1).join(' ');
      }
    }
    const row = { ...r, student_id: String(student.id), tutor_id: tutorId, subject };
    const dup = existing.some((e) => !e.voided_at && same(e.student_id, student.id) && norm(e.subject) === norm(subject)
      && String(e.tutor_id ?? '') === String(tutorId ?? '') && e.effective_from === effectiveFrom);
    if (dup) already.push(row);
    else ready.push(row);
  }
  // The same student, subject and tutor twice in one paste: keep the first, flag the rest
  const seen = new Set();
  const unique = [];
  for (const r of ready) {
    const k = `${r.student_id}|${norm(r.subject)}|${r.tutor_id ?? ''}`;
    if (seen.has(k)) problems.push({ ...r, reason: `${r.student} has ${r.subject} twice` });
    else {
      seen.add(k);
      unique.push(r);
    }
  }
  return { ready: unique, problems, already };
}
