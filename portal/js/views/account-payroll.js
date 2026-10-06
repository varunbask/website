// Account > Payroll (account.html, admin). Information for the CPA, who runs
// payroll: tutor pay is counted twice a month, the 1st to the 15th and the 16th
// to the last day. One card per pay period that overlaps the month, with one
// row per tutor: the sessions behind the total, bonuses and deductions, the
// pay summary and the CSV. Check first marks a period with open items.

import { sb } from '../supabase.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { button, pill, select, emptyState, busy, drawerHref } from '../ui.js';
import { todayKey } from '../dates.js';
import { timeRange } from '../sessions-model.js';
import {
  money, hoursText, parseMoney, monthEnd, periodsOverlapping, payPeriodEnd, periodText,
  periodRows, periodStatus, tutorBlockers, yearToDate, dayText, shortDate, ATTENTION,
} from '../billing-model.js';
import { payoutText, payrollCsv, labelText, stateText, LABELS } from '../billing-text.js';
import {
  setHeader, monthFrom, monthPicker, loadPriced, table, cents, csvButton, act, clientKey, note, tabHref, askReason,
} from './account-shared.js';

const TUTOR_LABELS = ['bonus', 'reimbursement', 'deduction', 'other'];
const LEDE = 'Tutor pay for your CPA, counted the 1st to the 15th and the 16th to the end of the month.';

export function mount(ctx) {
  const month = monthFrom(ctx.route, ctx.now);
  setHeader(ctx, 'payroll', { month, lede: LEDE });
  const root = h('div', { class: 'acct-root' });
  ctx.host.append(root);
  const open = new Set();

  return (async () => {
    const loaded = await loadPriced(ctx, root);
    if (!loaded || !ctx.alive()) return;
    const { b } = loaded;
    const today = todayKey(ctx.now);
    const periods = periodsOverlapping(month, monthEnd(month)).filter((p) => payPeriodEnd(p) >= b.settings.ledger_start);
    const year = today.slice(0, 4);
    const ytd = [...new Set(b.rows.map((r) => String(r.session.tutor_id)))]
      .map((id) => ({ id, name: b.nameOf(id), cents: yearToDate(b, id) })).filter((x) => x.cents)
      .sort((a, c) => a.name.localeCompare(c.name));
    setHeader(ctx, 'payroll', {
      month,
      lede: ytd.length ? `${LEDE} Earned in ${year} so far: ${ytd.map((x) => `${x.name} ${money(x.cents)}`).join(', ')}.` : LEDE,
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
      const ended = end < today;
      // Until a period ends, its hours and pay are what is planned for all of it
      const planned = !ended;
      const gateAll = rows.map((t) => tutorBlockers(b, t.tutorId, start)).flatMap((g) => g.items);
      const total = (k) => rows.reduce((s, t) => s + t[k], 0);
      return h('section', { class: 'card acct-card acct-period', 'aria-label': `Pay period ${periodText(start)}` },
        h('div', { class: 'card-head' },
          h('h2', { class: 'card-title' }, `${dayText(start)} to ${dayText(end, start)}`),
          h('span', { class: 'card-meta' }, future ? 'Upcoming' : current ? 'In progress' : gateAll.length ? 'Check first' : 'Complete'),
          h('div', { class: 'card-actions' }, csvButton(ctx, `payroll-${start}.csv`, () => payrollCsv(rows)))),
        ended && gateAll.length ? checkNote(gateAll) : null,
        rows.length ? table({
          label: `Tutors, ${periodText(start)}`,
          columns: [
            { key: 'name', label: 'Tutor' }, { key: 'hours', label: 'Hours', num: true }, { key: 'rate', label: 'Rate', num: true },
            { key: 'total', label: planned ? 'Expected' : 'Total', num: true }, { key: 'status', label: 'Status' }, { key: 'more', label: '' },
          ],
          rows: rows.map((t) => {
            const key = `${start}|${t.tutorId}`;
            return {
              focusKey: `pay-${key}`,
              cells: {
                name: t.name,
                hours: hoursText(t.minutes),
                rate: t.rate ? `${money(t.rate.rate_cents)}` : h('span', { class: 'acct-missing' }, 'None'),
                total: cents(planned ? t.expectedCents : t.totalCents),
                status: pill(periodStatus(b, t)),
                more: button({
                  label: open.has(key) ? 'Hide' : 'Details', size: 'sm', variant: 'ghost',
                  ariaLabel: `${open.has(key) ? 'Hide' : 'Show'} details for ${t.name}`,
                  onClick: () => { if (open.has(key)) open.delete(key); else open.add(key); paint(); },
                }),
              },
              after: open.has(key) ? details(t, planned) : null,
            };
          }),
          foot: {
            name: 'Total', hours: hoursText(total('minutes')), rate: '',
            total: cents(planned ? total('expectedCents') : total('totalCents')), status: '', more: '',
          },
        }) : h('p', { class: 'card-meta' }, 'No sessions in this period.'));
    }

    function checkNote(items) {
      const kinds = [...new Set(items.map((it) => ATTENTION[it.kind].title))];
      return h('div', { class: 'callout tone-warning acct-gate' },
        icon('warning-circle', { size: 20 }),
        h('div', { class: 'callout-body' },
          h('p', { class: 'callout-title' }, `${items.length} ${items.length === 1 ? 'item to check' : 'items to check'} before you send this period to your CPA`),
          h('p', { class: 'callout-text' }, kinds.join('; '), '. ', h('a', { href: tabHref('dashboard', month) }, 'Open Needs attention'), '.')));
    }

    function details(t, planned) {
      const gate = tutorBlockers(b, t.tutorId, t.periodStart);
      const lines = t.slots.map((s) => {
        const r = s.rows[0];
        const who = s.rows.map((x) => b.nameOf(x.session.student_id)).join(', ');
        return h('li', { class: `acct-line${r.state === 'cancelled' ? ' is-cancelled' : ''}` },
          h('a', { class: 'acct-line-what', href: drawerHref(location.hash, `s${r.id}`) },
            h('span', { class: 'acct-line-when' }, `${dayText(r.day)}, ${timeRange(r.session)}`),
            h('span', {}, `${who}, ${r.subject || 'Tutoring'}, ${hoursText(s.minutes)} hr`)),
          pill({ label: s.rows.length > 1 ? `Group of ${s.rows.length}` : stateText(r.state), tone: s.rows.length > 1 ? 'info' : r.state === 'attended' ? 'success' : r.state === 'unconfirmed' ? 'danger' : 'neutral' }),
          h('span', { class: 'acct-line-amount num' }, money(planned ? s.tutorExpected : s.tutorRealized)));
      });
      return h('div', { class: 'acct-details' },
        h('div', { class: 'acct-details-main' },
          h('ul', { class: 'acct-lines' }, lines),
          adjustments(t)),
        h('aside', { class: 'acct-details-side' },
          h('dl', { class: 'acct-summary' },
            sumRow('Sessions', money(planned ? t.expectedCents - t.adjustmentCents : t.realizedCents)),
            t.adjustmentCents ? sumRow('Adjustments', money(t.adjustmentCents)) : null,
            sumRow(planned ? 'Expected' : 'Total', money(planned ? t.expectedCents : t.totalCents), 'is-total')),
          planned ? note('This period has not ended; pay is shown as planned for all of it.')
            : !gate.ok ? checkNote(gate.items) : null,
          h('div', { class: 'acct-side-actions' },
            button({ label: 'Pay summary', size: 'sm', icon: 'printer', href: `#/payslip/${t.tutorId}?period=${t.periodStart}` }),
            button({ label: 'Copy as text', size: 'sm', icon: 'copy', variant: 'ghost', onClick: () => copy(payoutText(b, t)) }))));
    }

    function sumRow(label, value, cls) {
      return h('div', { class: cls ? `acct-summary-row ${cls}` : 'acct-summary-row' }, h('dt', {}, label), h('dd', { class: 'num' }, value));
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

    async function voidRow(tableName, id, done) {
      const reason = await askReason('Void this?', 'It stays on record and stops counting. This can’t be undone. Say why, for the record.');
      if (!reason || !ctx.alive()) return;
      await act(ctx, () => sb.from(tableName).update({ voided_at: new Date().toISOString(), void_reason: reason }).eq('id', id).select('id'), { done });
    }

    async function copy(text) {
      try {
        await navigator.clipboard.writeText(text);
        ctx.toast({ text: 'Pay summary copied.' });
      } catch {
        ctx.toast({ text: 'Your browser blocked copying. Open the pay summary and copy from there.' });
      }
    }

    paint();
    root.replaceChildren(monthPicker(ctx, month), cards);
  })();
}
