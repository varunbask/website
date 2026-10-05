// Account > Payroll (account.html, admin). Tutors are paid every two weeks,
// Sunday to Saturday from the anchor in Settings. One card per pay period
// that overlaps the month, with one row per tutor: the sessions behind the amount, bonuses and deductions, differences carried
// from earlier periods, and Mark paid (blocked while the period has open items).

import { sb } from '../supabase.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { button, pill, select, emptyState, busy, drawerHref } from '../ui.js';
import { todayKey } from '../dates.js';
import { timeRange } from '../sessions-model.js';
import {
  money, signedMoney, hoursText, parseMoney, monthEnd, periodsOverlapping, payPeriodEnd, payDay, periodText,
  periodRows, periodStatus, tutorBlockers, tutorSnapshot, yearToDate, dayText, shortDate, ATTENTION,
} from '../billing-model.js';
import { payoutText, payrollCsv, labelText, methodText, stateText, METHODS, LABELS } from '../billing-text.js';
import {
  setHeader, monthFrom, monthPicker, loadPriced, table, cents, csvButton, act, clientKey, note, tabHref, askReason,
} from './account-shared.js';

const TUTOR_METHODS = ['zelle', 'venmo', 'check', 'cash', 'payroll', 'other'];
const TUTOR_LABELS = ['bonus', 'reimbursement', 'deduction', 'other'];

export function mount(ctx) {
  const month = monthFrom(ctx.route, ctx.now);
  setHeader(ctx, 'payroll', { month, lede: 'Tutors are paid every two weeks, Sunday to Saturday.' });
  const root = h('div', { class: 'acct-root' });
  ctx.host.append(root);
  const open = new Set();

  return (async () => {
    const loaded = await loadPriced(ctx, root);
    if (!loaded || !ctx.alive()) return;
    const { b } = loaded;
    const today = todayKey(ctx.now);
    const periods = periodsOverlapping(month, monthEnd(month), b.settings.payroll_anchor)
      .filter((p) => payPeriodEnd(p) >= b.settings.ledger_start);
    const year = today.slice(0, 4);
    const ytdNames = new Set(b.rows.map((r) => String(r.session.tutor_id)));
    for (const p of b.payouts) if (p.tutor_id) ytdNames.add(String(p.tutor_id));
    const ytd = [...ytdNames].map((id) => ({ id, name: b.nameOf(id), cents: yearToDate(b, id) })).filter((x) => x.cents)
      .sort((a, c) => a.name.localeCompare(c.name));
    setHeader(ctx, 'payroll', {
      month,
      lede: ytd.length ? `Paid in ${year}: ${ytd.map((x) => `${x.name} ${money(x.cents)}`).join(', ')}.` : 'Tutors are paid every two weeks, Sunday to Saturday.',
    });

    const cards = h('div', { class: 'acct-periods' });
    function paint() {
      cards.replaceChildren(...(periods.length ? periods.map(periodCard) : [emptyState({ icon: 'users-three', text: `Billing starts ${shortDate(b.settings.ledger_start, today)}.` })]));
    }

    function periodCard(start) {
      const end = payPeriodEnd(start);
      const rows = periodRows(b, start);
      const future = start > today;
      const current = start <= today && end >= today;
      const gateAll = rows.map((t) => tutorBlockers(b, t.tutorId, start)).flatMap((g) => g.items);
      const total = (k) => rows.reduce((s, t) => s + t[k], 0);
      return h('section', { class: 'card acct-card acct-period', 'aria-label': `Pay period ${periodText(start)}` },
        h('div', { class: 'card-head' },
          h('h2', { class: 'card-title' }, `${dayText(start)} to ${dayText(end, start)}`),
          h('span', { class: 'card-meta' }, `Pays ${dayText(payDay(start, b.settings.pay_lag_days))}${future ? ', upcoming' : current ? ', in progress' : ''}`),
          h('div', { class: 'card-actions' }, csvButton(ctx, `payroll-${start}.csv`, () => payrollCsv(rows)))),
        !future && gateAll.length ? blockedNote(gateAll) : null,
        rows.length ? table({
          label: `Tutors, ${periodText(start)}`,
          columns: [
            { key: 'name', label: 'Tutor' }, { key: 'hours', label: 'Hours', num: true }, { key: 'rate', label: 'Rate', num: true },
            { key: 'owed', label: future ? 'Expected' : 'Owed', num: true }, { key: 'paid', label: 'Paid', num: true },
            { key: 'status', label: 'Status' }, { key: 'more', label: '' },
          ],
          rows: rows.map((t) => {
            const key = `${start}|${t.tutorId}`;
            const status = periodStatus(b, t);
            return {
              focusKey: `pay-${key}`,
              cells: {
                name: t.name,
                hours: hoursText(t.minutes),
                rate: t.rate ? `${money(t.rate.rate_cents)}` : h('span', { class: 'acct-missing' }, 'None'),
                owed: cents(future ? t.expectedCents : t.owedCents),
                paid: cents(t.paidCents),
                status: pill(status),
                more: button({
                  label: open.has(key) ? 'Hide' : 'Details', size: 'sm', variant: 'ghost',
                  ariaLabel: `${open.has(key) ? 'Hide' : 'Show'} details for ${t.name}`,
                  onClick: () => { if (open.has(key)) open.delete(key); else open.add(key); paint(); },
                }),
              },
              after: open.has(key) ? details(t, future) : null,
            };
          }),
          foot: {
            name: 'Total', hours: hoursText(total('minutes')), rate: '',
            owed: cents(future ? total('expectedCents') : total('owedCents')), paid: cents(total('paidCents')), status: '', more: '',
          },
        }) : h('p', { class: 'card-meta' }, 'No sessions in this period.'));
    }

    function blockedNote(items) {
      const kinds = [...new Set(items.map((it) => ATTENTION[it.kind].title))];
      return h('div', { class: 'callout tone-warning acct-gate' },
        icon('lock-simple', { size: 20 }),
        h('div', { class: 'callout-body' },
          h('p', { class: 'callout-title' }, `${items.length} ${items.length === 1 ? 'item needs' : 'items need'} a decision before these tutors can be marked paid`),
          h('p', { class: 'callout-text' }, kinds.join('; '), '. ', h('a', { href: tabHref('dashboard', month) }, 'Open Needs attention'), '.')));
    }

    function details(t, future) {
      const gate = tutorBlockers(b, t.tutorId, t.periodStart);
      const lines = t.slots.map((s) => {
        const r = s.rows[0];
        const who = s.rows.map((x) => b.nameOf(x.session.student_id)).join(', ');
        return h('li', { class: `acct-line${r.state === 'cancelled' ? ' is-cancelled' : ''}` },
          h('a', { class: 'acct-line-what', href: drawerHref(location.hash, `s${r.id}`) },
            h('span', { class: 'acct-line-when' }, `${dayText(r.day)}, ${timeRange(r.session)}`),
            h('span', {}, `${who}, ${r.subject || 'Tutoring'}, ${hoursText(s.minutes)} hr`)),
          pill({ label: s.rows.length > 1 ? `Group of ${s.rows.length}` : stateText(r.state), tone: s.rows.length > 1 ? 'info' : r.state === 'attended' ? 'success' : r.state === 'unconfirmed' ? 'danger' : 'neutral' }),
          h('span', { class: 'acct-line-amount num' }, money(future ? s.tutorExpected : s.tutorRealized)));
      });
      const changed = t.changedSincePayout
        ? note(`Paid ${money(t.snapshot.amount_cents)} when the period came to ${money(t.snapshot.owed_cents)}; it now comes to ${money(t.ownCents)} (${signedMoney(t.ownCents - t.snapshot.owed_cents)}). ${t.settledLater ? 'A later payout settled the difference.' : 'The difference is carried into the next period.'}`, 'warning-circle')
        : null;
      const due = t.dueCents;
      return h('div', { class: 'acct-details' },
        h('div', { class: 'acct-details-main' },
          h('ul', { class: 'acct-lines' }, lines),
          t.carriedCents ? h('p', { class: 'acct-carried' }, 'Adjustments from earlier periods: ', h('span', { class: 'num' }, money(t.carriedCents))) : null,
          adjustments(t),
          payouts(t)),
        h('aside', { class: 'acct-details-side' },
          h('dl', { class: 'acct-summary' },
            sumRow('Sessions', money(future ? t.expectedCents - t.adjustmentCents : t.realizedCents)),
            t.adjustmentCents ? sumRow('Adjustments', money(t.adjustmentCents)) : null,
            t.carriedCents ? sumRow('Carried', money(t.carriedCents)) : null,
            sumRow('Paid', money(-t.paidCents)),
            sumRow('Due', money(future ? 0 : due), 'is-total')),
          changed,
          future ? note('This period has not started; pay is shown as expected.')
            : !gate.ok ? blockedNote(gate.items)
              : !t.payouts.length && (due !== 0 || t.payableMinutes > 0) ? markPaidForm({
                label: `Mark ${t.name} paid`,
                amountCents: due,
                allowZero: t.payableMinutes > 0,
                onSave: (fields) => sb.from('payouts').insert({
                  ...fields, kind: 'tutor', tutor_id: t.tutorId, period_start: t.periodStart,
                  minutes: t.payableMinutes, owed_cents: t.ownCents, lines: tutorSnapshot(t),
                }).select('id'),
                done: (c) => `${money(c)} to ${t.name} recorded.`,
              }) : null,
          h('div', { class: 'acct-side-actions' },
            button({ label: 'Pay slip', size: 'sm', icon: 'printer', href: `#/payslip/${t.tutorId}?period=${t.periodStart}` }),
            button({ label: 'Copy as text', size: 'sm', icon: 'copy', variant: 'ghost', onClick: () => copy(payoutText(b, t)) }))));
    }

    function sumRow(label, value, cls) {
      return h('div', { class: cls ? `acct-summary-row ${cls}` : 'acct-summary-row' }, h('dt', {}, label), h('dd', { class: 'num' }, value));
    }

    function markPaidForm({ label, amountCents, allowZero = false, onSave, done }) {
      const key = clientKey();
      const amount = h('input', { class: 'input acct-money-input', inputmode: 'decimal', value: (amountCents / 100).toFixed(2), 'aria-label': 'Amount paid' });
      const on = h('input', { type: 'date', class: 'input', value: today, 'aria-label': 'Paid on' });
      const methodWrap = select({ label: 'Method', options: TUTOR_METHODS.map((m) => ({ value: m, label: METHODS[m] })), value: 'zelle' });
      const ref = h('input', { class: 'input', maxlength: '120', placeholder: 'Reference', 'aria-label': 'Reference' });
      const save = button({ label, variant: 'primary', size: 'sm', icon: 'check' });
      save.addEventListener('click', () => busy(save, 'Saving…', async () => {
        const c = parseMoney(amount.value, { allowNegative: true, allowZero });
        if (c === null) { ctx.toast({ text: 'Enter the amount paid, like 690.' }); amount.focus(); return; }
        await act(ctx, () => onSave({
          client_key: key, amount_cents: c, method: methodWrap.querySelector('select').value, paid_on: on.value || today, reference: ref.value.trim() || null,
        }), { done: done(c) });
      }));
      return h('div', { class: 'acct-pay-form' },
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'Amount'), amount),
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'Paid on'), on),
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'Method'), methodWrap),
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'Reference'), ref),
        save);
    }

    function adjustments(t) {
      const label = select({ label: 'Kind', options: TUTOR_LABELS.map((l) => ({ value: l, label: LABELS[l] })), value: 'bonus' });
      const amount = h('input', { class: 'input acct-money-input', inputmode: 'decimal', placeholder: '20', 'aria-label': 'Amount' });
      const why = h('input', { class: 'input', maxlength: '300', placeholder: 'Note', 'aria-label': 'Note' });
      const key = clientKey();
      const add = button({ label: 'Add', size: 'sm' });
      add.addEventListener('click', () => busy(add, 'Adding…', async () => {
        const kind = label.querySelector('select').value;
        let c = parseMoney(amount.value);
        if (c === null) { ctx.toast({ text: 'Enter an amount, like 20.' }); return; }
        if (kind === 'deduction') c = -c;
        await act(ctx, () => sb.from('billing_adjustments').insert({
          client_key: key, party: 'tutor', party_id: t.tutorId, period: t.periodStart, amount_cents: c, label: kind, note: why.value.trim() || null,
        }).select('id'), { done: `${LABELS[kind]} of ${money(Math.abs(c))} added.` });
      }));
      return h('div', { class: 'acct-block' },
        h('h4', {}, 'Bonuses, reimbursements and deductions'),
        t.adjustments.length ? h('ul', { class: 'acct-lines' }, t.adjustments.map((a) => h('li', { class: 'acct-line' },
          h('span', { class: 'acct-line-what' }, `${labelText(a.label)}${a.note ? `: ${a.note}` : ''}`),
          h('span', { class: 'acct-line-amount num' }, money(a.amount_cents)),
          button({ label: 'Void', size: 'sm', variant: 'ghost', onClick: () => voidRow('billing_adjustments', a.id, 'Adjustment voided.') })))) : null,
        h('div', { class: 'acct-inline-form is-tight' }, label, amount, why, add));
    }

    function payouts(t) {
      if (!t.payouts.length) return null;
      return h('div', { class: 'acct-block' },
        h('h4', {}, 'Paid'),
        h('ul', { class: 'acct-lines' }, t.payouts.map((p) => h('li', { class: 'acct-line' },
          h('span', { class: 'acct-line-what' }, `${shortDate(p.paid_on, today)}, ${methodText(p.method)}${p.reference ? ` (${p.reference})` : ''}`),
          h('span', { class: 'acct-line-amount num' }, money(p.amount_cents)),
          button({ label: 'Void', size: 'sm', variant: 'ghost', onClick: () => voidRow('payouts', p.id, 'Payout voided.') })))));
    }

    async function voidRow(tableName, id, done) {
      const reason = await askReason('Void this?', 'It stays on record and stops counting. This can’t be undone. Say why, for the record.');
      if (!reason || !ctx.alive()) return;
      await act(ctx, () => sb.from(tableName).update({ voided_at: new Date().toISOString(), void_reason: reason }).eq('id', id).select('id'), { done });
    }

    async function copy(text) {
      try {
        await navigator.clipboard.writeText(text);
        ctx.toast({ text: 'Pay slip copied.' });
      } catch {
        ctx.toast({ text: 'Your browser blocked copying. Open the pay slip and copy from there.' });
      }
    }

    paint();
    root.replaceChildren(monthPicker(ctx, month), cards);
  })();
}

