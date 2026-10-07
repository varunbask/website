// One-click Mark paid on Account > Families: who gets the button, for how
// much, what the row says afterwards, and the one row that is written (the
// same one the Record payment form writes). No DOM, no network: the page
// passes the write in.
//
// A month is marked paid for exactly what the family's row shows as due for
// that month (what the calendar prices it at, less what was already paid
// toward it). Odd amounts, prepayments and several months at once stay on the
// full Record payment form.

import { money, familySnapshot } from './billing-model.js';
import { methodText } from './billing-text.js';

// The methods a family can pay by (the payments table allows these and no others)
export const FAMILY_METHODS = Object.freeze(['zelle', 'venmo', 'check', 'cash', 'card', 'other']);

// The family's usual way to pay (billing_contacts.preferred_method), else Zelle
export function paidMethod(contact) {
  return FAMILY_METHODS.includes(contact?.preferred_method) ? contact.preferred_method : 'zelle';
}

// Why a row has no Mark paid button, or the amount and method when it has one.
//   f     a familyRows() row (dueCents is the month's price less what was paid for it)
//   held  true when a session in the month has no family rate (familyBlockers not ok)
// -> { ok: true, cents, method } or { ok: false, reason: 'no_payer' | 'held' | 'nothing_due' | 'covered' }
// A family whose earlier credit already covers the month is not asked to pay again.
export function markPaidPlan(f, { held = false } = {}) {
  if (!f?.parentId) return { ok: false, reason: 'no_payer' };
  if (held) return { ok: false, reason: 'held' };
  if (!(f.dueCents > 0)) return { ok: false, reason: 'nothing_due' };
  if (f.status?.key === 'covered') return { ok: false, reason: 'covered' };
  return { ok: true, cents: f.dueCents, method: paidMethod(f.contact) };
}

// The newest live payment toward a row, so Undo takes back the last thing that was recorded
export function latestPayment(payments) {
  return (payments ?? []).reduce((best, p) => {
    if (!best) return p;
    const a = String(p.created_at ?? '');
    const b = String(best.created_at ?? '');
    if (a !== b) return a > b ? p : best;
    return Number(p.id) > Number(best.id) ? p : best;
  }, null);
}

// What a family row offers: Mark paid, Undo for a month paid in full, or nothing
// -> { kind: 'mark', cents, method } | { kind: 'undo', payment } | { kind: null }
export function paidControl(f, { held = false } = {}) {
  if (f.status?.key === 'paid') {
    const payment = latestPayment(f.payments);
    return payment ? { kind: 'undo', payment } : { kind: null };
  }
  const plan = markPaidPlan(f, { held });
  return plan.ok ? { kind: 'mark', cents: plan.cents, method: plan.method } : { kind: null };
}

// The payments row, for the Record payment form and for Mark paid alike.
//   key         client_key: one per form or button, so a resend never records twice
//   loose       a prepayment or a payment for several months: no month, no lines
export function paymentRow(f, { key, month, cents, method, receivedOn, reference = null, loose = false }) {
  return {
    client_key: key,
    parent_id: f.parentId,
    period: loose ? null : month,
    amount_cents: cents,
    method,
    received_on: receivedOn,
    reference,
    lines: loose ? [] : familySnapshot(f),
    owed_cents: loose ? 0 : f.owedCents,
  };
}

// How an insert came back: { ok, id }. A duplicate client_key is a resend whose
// first send landed: saved (ok), but there is no id to undo with.
export function paymentOutcome(result) {
  if (result?.error) {
    const duplicate = result.error.code === '23505' && /client_key/.test(String(result.error.message ?? result.error.details ?? ''));
    return { ok: duplicate, id: null, duplicate };
  }
  const row = Array.isArray(result?.data) ? result.data[0] : result?.data;
  return row ? { ok: true, id: row.id ?? null, duplicate: false } : { ok: false, id: null, duplicate: false };
}

// Words
export const UNDO_REASON = 'Undone right after Mark paid';

// "Grace Chen marked paid: $1,275.00 by Zelle."
export function markPaidText({ name, cents, method }) {
  return `${name} marked paid: ${money(cents)} by ${methodText(method)}.`;
}

export function undoDoneText(name) {
  return `Payment from ${name} undone.`;
}

export function markPaidLabel({ name, cents }) {
  return `Mark ${name} paid, ${money(cents)}`;
}

// The row's Undo: which payment it takes back
export function undoLabel({ name, payment }) {
  return `Undo the ${money(payment.amount_cents)} payment from ${name}`;
}

// The callout in a held family's details: what to do about a session with no rate
export function heldNote(gate) {
  const n = gate.items.length;
  return {
    title: `${n} ${n === 1 ? 'session has' : 'sessions have'} no family rate`,
    text: 'Add a rate on Rates before marking the month paid, recording a payment or releasing the bill.',
  };
}
