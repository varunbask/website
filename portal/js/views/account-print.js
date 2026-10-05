// Account > printable statement (#/statement/<parent id>?month=YYYY-MM) and
// pay slip (#/payslip/<tutor id>?period=YYYY-MM-DD). The same lines as the
// Families and Payroll tabs, laid out for paper: Print hides everything else
// (account.css @media print). Only ids and the period are in the address,
// never amounts.

import { h } from '../dom.js';
import { button } from '../ui.js';
import { todayKey } from '../dates.js';
import { timeRange } from '../sessions-model.js';
import {
  money, hoursText, monthName, familyMonth, familyBalanceBefore, tutorPeriod, dueDate, dayText, shortDate,
  statementNumber, periodText, payDay, monthParam, payPeriodStart,
} from '../billing-model.js';
import { labelText, methodText, stateText } from '../billing-text.js';
import { loadPriced } from './account-shared.js';

export function mount(ctx) {
  const isSlip = ctx.route.view === 'payslip';
  const id = ctx.route.id;
  ctx.setHeader({ title: isSlip ? 'Pay slip' : 'Statement' });
  const root = h('div', { class: 'acct-root acct-print-root' });
  ctx.host.append(root);

  return (async () => {
    const loaded = await loadPriced(ctx, root);
    if (!loaded || !ctx.alive()) return;
    const { b } = loaded;
    const today = todayKey(ctx.now);
    const s = b.settings;
    const toolbar = h('div', { class: 'acct-print-bar' },
      button({ label: 'Print or save as PDF', icon: 'printer', variant: 'primary', onClick: () => window.print() }),
      button({ label: isSlip ? 'Back to payroll' : 'Back to families', variant: 'ghost', href: isSlip ? '#/payroll' : '#/families' }),
      h('p', { class: 'field-hint' }, 'In the print dialog, turn off headers and footers so the page address is not printed.'));

    if (isSlip) {
      const start = /^\d{4}-\d{2}-\d{2}$/.test(ctx.route.params?.period ?? '') ? payPeriodStart(ctx.route.params.period, s.payroll_anchor) : null;
      if (!start) { root.replaceChildren(h('p', {}, 'This pay slip link is missing its period.')); return; }
      const t = tutorPeriod(b, id, start);
      root.replaceChildren(toolbar, h('article', { class: 'acct-statement' },
        h('header', { class: 'acct-statement-head' },
          h('div', {}, h('p', { class: 'acct-statement-org' }, s.business_name), h('h1', {}, `Pay slip: ${t.name}`)),
          h('dl', { class: 'acct-statement-meta' },
            meta('Period', periodText(start)), meta('Pay day', dayText(payDay(start, s.pay_lag_days))), meta('Issued', dayText(today)))),
        h('table', { class: 'acct-statement-lines' },
          h('thead', {}, h('tr', {}, ['Date', 'Student', 'Subject', 'Hours', 'Amount'].map((x, i) => h('th', { class: i > 2 ? 'num' : null }, x)))),
          h('tbody', {}, t.slots.map((slot) => {
            const r = slot.rows[0];
            return h('tr', {},
              h('td', {}, `${dayText(r.day)}, ${timeRange(r.session)}`),
              h('td', {}, slot.rows.map((x) => b.nameOf(x.session.student_id)).join(', ')),
              h('td', {}, `${r.subject || 'Tutoring'}${slot.rows.length > 1 ? ' (group)' : r.state !== 'attended' ? ` (${stateText(r.state).toLowerCase()})` : ''}`),
              h('td', { class: 'num' }, hoursText(slot.minutes)),
              h('td', { class: 'num' }, money(slot.tutorRealized)));
          }), t.adjustments.map((a) => h('tr', {}, h('td', { colspan: '4' }, `${labelText(a.label)}${a.note ? `: ${a.note}` : ''}`), h('td', { class: 'num' }, money(a.amount_cents)))),
          t.carriedCents ? h('tr', {}, h('td', { colspan: '4' }, 'Adjustments from earlier periods'), h('td', { class: 'num' }, money(t.carriedCents))) : null),
          h('tfoot', {},
            h('tr', {}, h('th', { colspan: '3' }, 'Total'), h('td', { class: 'num' }, hoursText(t.minutes)), h('td', { class: 'num' }, money(t.owedCents))),
            t.payouts.map((p) => h('tr', {}, h('td', { colspan: '4' }, `Paid ${shortDate(p.paid_on, today)} by ${methodText(p.method)}${p.reference ? ` (${p.reference})` : ''}`), h('td', { class: 'num' }, money(-p.amount_cents)))),
            h('tr', { class: 'is-total' }, h('th', { colspan: '4' }, 'Still owed'), h('td', { class: 'num' }, money(t.dueCents))))),
        t.rate ? h('p', { class: 'acct-statement-note' }, `Rate: ${money(t.rate.rate_cents)} an hour.`) : null));
      return;
    }

    const month = monthParam(ctx.route.params?.month);
    if (!month) { root.replaceChildren(h('p', {}, 'This statement link is missing its month.')); return; }
    const f = familyMonth(b, id, month);
    const previous = familyBalanceBefore(b, id, month);
    const due = previous + f.owedCents - f.paidCents;
    root.replaceChildren(toolbar, h('article', { class: 'acct-statement' },
      h('header', { class: 'acct-statement-head' },
        h('div', {}, h('p', { class: 'acct-statement-org' }, s.business_name), h('h1', {}, `Statement for ${f.name}`)),
        h('dl', { class: 'acct-statement-meta' },
          meta('Statement', statementNumber(id, month)), meta('Month', monthName(month)), meta('Issued', dayText(f.sentOn ?? today)),
          meta('Due', dayText(dueDate(b, month, f.sentOn))))),
      h('table', { class: 'acct-statement-lines' },
        h('thead', {}, h('tr', {}, ['Date', 'Student', 'Subject and tutor', 'Hours', 'Rate', 'Amount'].map((x, i) => h('th', { class: i > 2 ? 'num' : null }, x)))),
        h('tbody', {}, f.lines.map((l) => {
          const amount = l.paidBy ? 0 : (l.state === 'expected' ? l.familyExpected : l.familyRealized);
          const tag = l.paidBy ? ` (paid by ${l.paidBy})` : l.state === 'attended' ? '' : ` (${stateText(l.state).toLowerCase()}${l.exception?.charge_pct != null ? `, ${l.exception.charge_pct}%` : ''})`;
          return h('tr', { class: l.state === 'cancelled' ? 'is-cancelled' : null },
            h('td', {}, `${dayText(l.day)}, ${timeRange(l.session)}`),
            h('td', {}, b.nameOf(l.session.student_id)),
            h('td', {}, `${l.subject || 'Tutoring'} with ${b.nameOf(l.session.tutor_id)}${tag}`),
            h('td', { class: 'num' }, hoursText(l.minutes)),
            h('td', { class: 'num' }, l.familyRate ? money(l.familyRate.rate_cents) : ''),
            h('td', { class: 'num' }, money(amount)));
        }), f.adjustments.map((a) => h('tr', {}, h('td', { colspan: '5' }, `${labelText(a.label)}${a.note ? `: ${a.note}` : ''}`), h('td', { class: 'num' }, money(a.amount_cents))))),
        h('tfoot', {},
          previous ? h('tr', {}, h('th', { colspan: '5' }, 'Brought forward'), h('td', { class: 'num' }, money(previous))) : null,
          h('tr', {}, h('th', { colspan: '5' }, `${monthName(month)} total`), h('td', { class: 'num' }, money(f.owedCents))),
          f.payments.map((p) => h('tr', {}, h('td', { colspan: '5' }, `Paid ${shortDate(p.received_on, today)} by ${methodText(p.method)}${p.reference ? ` (${p.reference})` : ''}`), h('td', { class: 'num' }, money(-p.amount_cents)))),
          h('tr', { class: 'is-total' }, h('th', { colspan: '5' }, due < 0 ? 'Credit' : 'Amount due'), h('td', { class: 'num' }, money(Math.abs(due)))))),
      s.pay_note ? h('p', { class: 'acct-statement-note' }, s.pay_note) : null,
      h('p', { class: 'acct-statement-note' }, `Please include ${statementNumber(id, month)} with your payment.`)));
  })();

  function meta(label, value) {
    return h('div', {}, h('dt', {}, label), h('dd', {}, value));
  }
}
