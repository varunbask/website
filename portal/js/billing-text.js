// Words and files for the Account page: the policy paragraph, statements and
// payout slips as plain text (Copy as text), CSV downloads, and the Paste
// rates importer that reads the old scheduler's "Kid (Parent): Math $45" lines.
// No DOM, no network.

import {
  money, hoursText, monthName, shortDate, dayText, periodText, payDay, dueDate, statementNumber, STATES,
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
    ? 'A session that ended without attendance counts as attended on this page until someone records it, but no payment or payout can be recorded for its month or pay period until it is confirmed or accepted.'
    : 'A session that ended without attendance counts for nothing until someone records it, and no payment or payout can be recorded for its month or pay period until it is confirmed or accepted.';
  const lag = settings.pay_lag_days === 0 ? 'on the last day of the period' : `${settings.pay_lag_days} ${settings.pay_lag_days === 1 ? 'day' : 'days'} after it ends`;
  return [
    'Cancelled sessions are not billed and not paid, unless you set a percentage on that one session (for example a late cancellation charged at 50 percent).',
    noShow,
    unconfirmed,
    `Families are billed by calendar month, due on the ${ordinal(settings.due_day)} of the next month. Tutors are paid every two weeks, Sunday to Saturday, ${lag}.`,
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
  lines.push(`${monthName(f.month)}, due ${dayText(dueDate(ctx, f.month, f.sentOn))}`);
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
      lines.push(`  ${what}${note}: ${money(l.paidBy ? 0 : l.familyRealized || l.familyExpected)}`);
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
  if (l.state === 'cancelled' || l.state === 'conflict') return l.familyRealized ? ` (late cancellation, ${l.pct.familyRealized}%)` : ' (cancelled)';
  if (l.state === 'noshow') return l.pct.familyRealized === 100 ? ' (no-show)' : ` (no-show, ${l.pct.familyRealized}%)`;
  if (l.exception?.reason === 'trial') return ' (trial)';
  return '';
}

// A tutor's pay period
export function payoutText(ctx, t) {
  const s = ctx.settings;
  const lines = [];
  lines.push(`${s.business_name}`);
  lines.push(`Pay for ${t.name}, ${periodText(t.periodStart)}`);
  lines.push(`Pay day ${dayText(payDay(t.periodStart, s.pay_lag_days))}`);
  lines.push('');
  for (const slot of t.slots) {
    const r = slot.rows[0];
    const who = slot.rows.map((x) => ctx.nameOf(x.session.student_id)).join(', ');
    const tag = slot.rows.length > 1 ? ' (group)' : noteFor(r);
    lines.push(`${dayText(r.day)}, ${who}, ${r.subject || 'Tutoring'}, ${hoursText(slot.minutes)} hr${tag}: ${money(slot.tutorRealized || slot.tutorExpected)}`);
  }
  for (const a of t.adjustments) lines.push(`${labelText(a.label)}${a.note ? ` (${a.note})` : ''}: ${money(a.amount_cents)}`);
  if (t.carriedCents) lines.push(`Adjustments from earlier periods: ${money(t.carriedCents)}`);
  lines.push('');
  lines.push(`Hours: ${hoursText(t.minutes)}${t.rate ? ` at ${money(t.rate.rate_cents)}/hr` : ''}`);
  lines.push(`Total: ${money(t.owedCents)}`);
  for (const p of t.payouts) lines.push(`Paid ${shortDate(p.paid_on)} by ${methodText(p.method)}: ${money(p.amount_cents)}`);
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

export function familiesCsv(rows) {
  return csvText(
    ['Family', 'Students', 'Hours', 'Owed', 'Paid', 'Balance', 'Status'],
    rows.map((f) => [f.name, f.studentNames ?? f.students.length, hoursText(f.minutes), dollars(f.owedCents), dollars(f.paidCents), dollars(f.balanceCents ?? f.dueCents), f.status?.label ?? '']),
  );
}

export function payrollCsv(rows) {
  return csvText(
    ['Tutor', 'Period', 'Hours', 'Rate', 'Owed', 'Paid'],
    rows.map((t) => [t.name, periodText(t.periodStart), hoursText(t.minutes), t.rate ? dollars(t.rate.rate_cents) : '', dollars(t.owedCents), dollars(t.paidCents)]),
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
    ['Month', 'Revenue expected', 'Revenue realized', 'Collected', 'Tutor pay', 'Paid out', 'Referral', 'Net'],
    rows.map((r) => [monthName(r.month), dollars(r.revenueExpected), dollars(r.revenueRealized), dollars(r.collected),
      dollars(r.tutorRealized), dollars(r.paidOut), dollars(r.referralRealized), dollars(r.netRealized)]),
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
