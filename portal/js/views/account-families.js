// Account > Families (account.html, admin). Monthly billing: one row per paying
// parent with the month's sessions, adjustments and payments, a running
// balance, a one-click Mark paid (and Undo once paid in full) on the row,
// Record payment for odd amounts, the statement, Copy as text and Release.
// Mark paid, Record payment and Release wait only for a rate on every session.
// A parent sees nothing about a month until it is released: Release bills at
// the top does every ready family at once, and each family has its own Release
// (and Release again) too.

import { sb } from '../supabase.js';
import { h } from '../dom.js';
import { isPlaceholderEmail } from '../format.js';
import { icon } from '../icons.js';
import { button, pill, segmented, select, emptyState, busy, drawerHref } from '../ui.js';
import { todayKey } from '../dates.js';
import { timeRange } from '../sessions-model.js';
import {
  money, hoursText, parseMoney, monthEnd, monthName, familyRows, familyBlockers, familyBalanceBefore, needsAttention,
  dueDate, billDate, dayText, shortDate, statementNumber,
} from '../billing-model.js';
import { statementText, sendAction, familiesCsv, labelText, methodText, stateText, METHODS, LABELS } from '../billing-text.js';
import { releasePlan, releaseDoneText, releaseLabel } from '../billing-release.js';
import {
  FAMILY_METHODS, paidControl, paymentRow, paymentOutcome, markPaidText, markPaidLabel, undoLabel, undoDoneText, heldNote, UNDO_REASON,
} from '../billing-paid.js';
import {
  setHeader, monthFrom, monthPicker, loadPriced, table, cents, csvButton, act, saveSessionBilling, clientKey, askReason,
} from './account-shared.js';
import { releaseBar, releaseDialog, statementColumns, writeStatement } from './account-release.js';

const FAMILY_LABELS = ['late_fee', 'discount', 'credit', 'other'];
const REASONS = { late_cancel: 'Late cancellation', no_show_forgiven: 'No-show forgiven', trial: 'Trial lesson (free)', other: 'Other' };
const STATE_TONES = { attended: 'success', noshow: 'warning', unconfirmed: 'neutral', expected: 'neutral', cancelled: 'neutral' };

// Voids a row (kept on record, stops counting), with the reason
const voidQuery = (tableName, id, reason) => sb.from(tableName).update({ voided_at: new Date().toISOString(), void_reason: reason }).eq('id', id).select('id');

export function mount(ctx) {
  const month = monthFrom(ctx.route, ctx.now);
  const filter = ['unpaid', 'paid'].includes(ctx.route.params?.filter) ? ctx.route.params.filter : 'all';
  const open = new Set(ctx.route.params?.family ? [String(ctx.route.params.family)] : []);
  setHeader(ctx, 'families', { month, lede: 'Monthly bills, from the sessions on the calendar.' });
  const root = h('div', { class: 'acct-root' });
  ctx.host.append(root);
  let query = '';

  return (async () => {
    const loaded = await loadPriced(ctx, root);
    if (!loaded || !ctx.alive()) return;
    const { b, data } = loaded;
    const today = todayKey(ctx.now);
    const all = familyRows(b, month);
    // A session with no family rate is the only thing that holds a family back;
    // worked out once for the whole month
    const attention = needsAttention(b, month, monthEnd(month), { sessionsOnly: true });
    const gateOf = (f) => familyBlockers(b, f.parentId, month, { attention });
    // People added without a login: their bill is released like the others and
    // reaches them as copied text or a printout
    const noLogin = new Set((data.people ?? []).filter((p) => isPlaceholderEmail(p.email)).map((p) => String(p.id)));
    const plan = releasePlan(b, month, today, { families: all, noLogin });
    const paidCount = all.filter((f) => f.status.key === 'paid' || f.status.key === 'credit').length;
    const owedThisMonth = all.reduce((s, f) => s + Math.max(0, f.dueCents), 0);
    setHeader(ctx, 'families', {
      month,
      lede: all.length
        ? `${monthName(month)}, billed ${dayText(billDate(month))}: ${paidCount} of ${all.length} ${all.length === 1 ? 'family' : 'families'} paid, ${money(owedThisMonth)} outstanding.`
        : `Monthly bills, from the sessions on the calendar, dated the 1st of the next month.`,
    });

    const list = h('div', { class: 'acct-families' });
    const search = h('input', { type: 'search', class: 'input', placeholder: 'Find a family', 'aria-label': 'Find a family' });
    search.addEventListener('input', () => { query = search.value; paint(); });

    function paint() {
      const q = query.trim().toLowerCase();
      const rows = all
        .filter((f) => filter === 'all' || (filter === 'paid' ? ['paid', 'credit'].includes(f.status.key) : !['paid', 'credit', 'nothing'].includes(f.status.key)))
        .filter((f) => !q || f.name.toLowerCase().includes(q) || f.students.some((id) => b.nameOf(id).toLowerCase().includes(q)));
      if (!rows.length) {
        list.replaceChildren(emptyState({
          icon: 'receipt',
          text: all.length ? 'No families match.' : `No sessions for paying families in ${monthName(month)}. A student needs a linked parent and sessions on the calendar.`,
        }));
        return;
      }
      const total = (k) => rows.reduce((s, f) => s + f[k], 0);
      list.replaceChildren(table({
        label: `Families, ${monthName(month)}`,
        className: 'acct-families-table',
        columns: [
          { key: 'name', label: 'Family' }, { key: 'students', label: 'Students' }, { key: 'hours', label: 'Hours', num: true },
          { key: 'owed', label: 'This month', num: true }, { key: 'paid', label: 'Paid', num: true }, { key: 'balance', label: 'Balance', num: true },
          { key: 'status', label: 'Status' }, { key: 'more', label: '' },
        ],
        rows: rows.map((f) => ({
          focusKey: `fam-${f.parentId}`,
          cells: {
            name: f.name,
            students: f.students.map((id) => b.nameOf(id)).join(', '),
            hours: hoursText(f.minutes),
            owed: cents(f.owedCents),
            paid: cents(f.paidCents),
            balance: h('span', { class: f.balanceCents > 0 ? 'num acct-owes' : 'num' }, money(f.balanceCents)),
            status: pill(f.status),
            more: h('span', { class: 'acct-row-actions' },
              paidAction(f),
              button({
                label: open.has(f.parentId) ? 'Hide' : 'Details', size: 'sm', variant: 'ghost',
                ariaLabel: `${open.has(f.parentId) ? 'Hide' : 'Show'} details for ${f.name}`,
                onClick: () => { if (open.has(f.parentId)) open.delete(f.parentId); else open.add(f.parentId); paint(); },
              })),
          },
          after: open.has(f.parentId) ? details(f) : null,
        })),
        foot: { name: 'Total', students: '', hours: hoursText(total('minutes')), owed: cents(total('owedCents')), paid: cents(total('paidCents')), balance: '', status: '', more: '' },
      }));
    }

    // ---------------------------------------------------------------------
    // One family's month

    function details(f) {
      const gate = gateOf(f);
      const previous = familyBalanceBefore(b, f.parentId, month);
      const byStudent = new Map();
      for (const l of f.lines) {
        const k = String(l.session.student_id);
        if (!byStudent.has(k)) byStudent.set(k, []);
        byStudent.get(k).push(l);
      }
      const sessions = [...byStudent].map(([studentId, lines]) => h('div', { class: 'acct-student-block' },
        h('h4', { class: 'acct-student-name' }, b.nameOf(studentId)),
        h('ul', { class: 'acct-lines' }, lines.map((l) => lineRow(l)))));
      return h('div', { class: 'acct-details' },
        h('div', { class: 'acct-details-main' },
          sessions.length ? sessions : h('p', { class: 'card-meta' }, 'No sessions this month.'),
          adjustments(f),
          payments(f)),
        h('aside', { class: 'acct-details-side' },
          summary(f, previous),
          contact(f),
          gate.ok ? recordPayment(f, previous) : blocked(gate),
          h('div', { class: 'acct-side-actions' },
            button({ label: 'Statement', size: 'sm', icon: 'printer', href: `#/statement/${f.parentId}?month=${month.slice(0, 7)}` }),
            button({ label: 'Copy as text', size: 'sm', icon: 'copy', variant: 'ghost', onClick: () => copy(statementText(b, f, { previousCents: previous }), 'Statement copied. Paste it into a message or a Zelle request.') }),
            sentControls(f, previous, gate))));
    }

    // Releasing a month's bill saves what the statement says, and only then can
    // the paying parent read it under Billing in the portal. A month whose
    // charges or brought forward changed after it was released can be released
    // again (the parent then sees the new version); a payment recorded later is
    // no change. Like Record payment, it waits for the month's open items to be
    // resolved.
    function sentControls(f, previous, gate) {
      const sent = b.statements.find((x) => String(x.parent_id) === f.parentId && x.period === month);
      const action = sendAction(sent, f, previous, gate, today);
      const hasLogin = !noLogin.has(f.parentId);
      const write = ({ label, icon: iconName, again = false }) => {
        const btn = button({ label, size: 'sm', variant: 'ghost', icon: iconName, disabled: action.blocked, onClick: () => {
          const { snap, columns } = statementColumns(b, today, { f, previous, action });
          return act(ctx, () => writeStatement(month, action.kind, f.parentId, columns),
            { done: releaseDoneText({ name: f.name, noLogin: !hasLogin, dueDay: dayText(snap.due_date), again }) });
        } });
        if (action.blocked) btn.title = blockedTitle(gate);
        return btn;
      };
      if (action.kind === 'mark') {
        return h('span', { class: 'acct-release-row' },
          h('span', { class: 'card-meta' }, releaseLabel(null, today)),
          write({ label: 'Release', icon: 'envelope-simple' }));
      }
      const number = statementNumber(f.parentId, month);
      if (action.kind === 'save') {
        // sent before the portal kept copies: the family has it, the portal does not
        return h('span', { class: 'acct-release-row' },
          h('span', { class: 'card-meta' }, `Sent ${shortDate(sent.sent_on, today)} (${number}), not in the portal yet`),
          write({ label: 'Release to the portal', icon: 'repeat' }));
      }
      const label = h('span', { class: 'card-meta' }, `${releaseLabel(sent, today)} (${number})${action.kind ? ', changed since' : ''}`);
      if (!action.kind) return label;
      return h('span', { class: 'acct-release-row' }, label, write({ label: 'Release again', icon: 'repeat', again: true }));
    }

    function lineRow(l) {
      const r = l;
      const amount = l.paidBy ? 0 : (l.state === 'expected' ? l.familyExpected : l.familyRealized);
      const rate = l.familyRate ? `${money(l.familyRate.rate_cents)}/hr` : 'No rate';
      const exceptionText = l.exception?.charge_pct !== null && l.exception?.charge_pct !== undefined
        ? `${REASONS[l.exception.reason] ?? 'Exception'}: ${l.exception.charge_pct}%` : null;
      const form = h('div', { class: 'acct-exception', hidden: true });
      const toggle = button({ label: 'Exception', size: 'sm', variant: 'ghost', onClick: () => {
        form.hidden = !form.hidden;
        if (!form.hidden && !form.childNodes.length) form.append(...exceptionForm(l));
      } });
      return h('li', { class: `acct-line${l.state === 'cancelled' ? ' is-cancelled' : ''}` },
        h('a', { class: 'acct-line-what', href: drawerHref(location.hash, `s${r.id}`) },
          h('span', { class: 'acct-line-when' }, `${dayText(l.day)}, ${timeRange(l.session)}`),
          h('span', {}, `${l.subject || 'Tutoring'} with ${b.nameOf(l.session.tutor_id)}, ${hoursText(l.minutes)} hr`)),
        pill({ label: l.paidBy ? `Paid by ${l.paidBy}` : stateText(l.state), tone: l.paidBy ? 'info' : STATE_TONES[l.state] }),
        exceptionText ? pill({ label: exceptionText, tone: 'info' }) : null,
        l.exception?.group_key ? pill({ label: `Group: ${l.exception.group_key}`, tone: 'neutral' }) : null,
        h('span', { class: l.familyRate ? 'acct-line-rate' : 'acct-line-rate acct-missing' }, rate),
        h('span', { class: 'acct-line-amount num' }, money(amount)),
        toggle,
        form);
    }

    // What the family pays for one lesson. Tutors are always paid their standard
    // rate for what happened, so a free trial lesson (any tutor's) costs the
    // family nothing and still pays the tutor.
    function exceptionForm(l) {
      const ex = l.exception ?? {};
      // No cancellation policy: Late cancellation is not offered (an old exception keeps its label)
      const reasons = Object.entries(REASONS).filter(([value]) => value !== 'late_cancel' || ex.reason === 'late_cancel');
      const fam = h('input', { type: 'number', class: 'input acct-num-input', min: '0', max: '100', value: ex.charge_pct ?? '', placeholder: 'policy', 'aria-label': 'Family pays (percent)' });
      const reasonWrap = select({ label: 'Reason', options: [{ value: '', label: 'Reason' }, ...reasons.map(([value, label]) => ({ value, label }))], value: ex.reason ?? '' });
      const reasonSelect = reasonWrap.querySelector('select');
      reasonSelect.addEventListener('change', () => { if (reasonSelect.value === 'trial') fam.value = '0'; });
      const save = button({ label: 'Save', size: 'sm', variant: 'primary' });
      save.addEventListener('click', () => busy(save, 'Saving…', async () => {
        const cp = fam.value.trim() === '' ? null : Number(fam.value);
        if (cp !== null && (!Number.isInteger(cp) || cp < 0 || cp > 100)) { ctx.toast({ text: 'The percentage is a whole number from 0 to 100, or blank to follow the policy.' }); return; }
        const reason = reasonSelect.value || null;
        if (cp !== null && !reason) { ctx.toast({ text: 'Pick a reason for the exception.' }); return; }
        if (reason === 'trial' && cp !== 0) { ctx.toast({ text: 'A trial lesson is free: the family pays 0 percent.' }); return; }
        await act(ctx, () => saveSessionBilling(l.id, { charge_pct: cp, reason: cp === null ? null : reason }), { done: reason === 'trial' ? 'Marked as a free trial lesson.' : 'Exception saved.' });
      }));
      return [
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'Family pays %'), fam),
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'Reason'), reasonWrap),
        save,
      ];
    }

    function summary(f, previous) {
      const due = previous + f.owedCents - f.paidCents;
      return h('dl', { class: 'acct-summary' },
        previous ? row('Brought forward', money(previous)) : null,
        row(`${monthName(month)}`, money(f.owedCents)),
        f.expectedCents !== f.owedCents ? row('Still to come this month', money(f.expectedCents - f.owedCents)) : null,
        row('Paid', money(-f.paidCents)),
        row('Due now', money(due), 'is-total'),
        row('Bill date', dayText(billDate(month))),
        row('Due by', dayText(dueDate(b, month, f.sentOn))));
      function row(label, value, cls) {
        return h('div', { class: cls ? `acct-summary-row ${cls}` : 'acct-summary-row' }, h('dt', {}, label), h('dd', { class: 'num' }, value));
      }
    }

    const blockedTitle = (gate) => `${heldNote(gate).title}. ${heldNote(gate).text}`;

    function blocked(gate) {
      const note = heldNote(gate);
      const studentId = gate.items[0]?.row?.session.student_id;
      return h('div', { class: 'callout tone-warning acct-gate' },
        icon('lock-simple', { size: 20 }),
        h('div', { class: 'callout-body' },
          h('p', { class: 'callout-title' }, note.title),
          h('p', { class: 'callout-text' }, note.text, ' ', h('a', { href: studentId ? `#/rates?student=${studentId}` : '#/rates' }, 'Add a rate'), '.')));
    }

    function recordPayment(f, previous) {
      const key = clientKey();
      const dueNow = Math.max(0, previous + f.owedCents - f.paidCents);
      const amount = h('input', { class: 'input acct-money-input', inputmode: 'decimal', value: dueNow ? (dueNow / 100).toFixed(2) : '', 'aria-label': 'Amount received' });
      const on = h('input', { type: 'date', class: 'input', value: today, 'aria-label': 'Received on' });
      const methodWrap = select({ label: 'Method', options: FAMILY_METHODS.map((m) => ({ value: m, label: METHODS[m] })), value: f.contact?.preferred_method ?? 'zelle' });
      const ref = h('input', { class: 'input', maxlength: '120', placeholder: 'Confirmation or check number', 'aria-label': 'Reference' });
      const loose = h('input', { type: 'checkbox', class: 'checkbox' });
      const save = button({ label: 'Record payment', variant: 'primary', size: 'sm', icon: 'check' });
      save.addEventListener('click', () => busy(save, 'Saving…', async () => {
        const c = parseMoney(amount.value, { allowNegative: true });
        if (c === null) { ctx.toast({ text: 'Enter the amount received, like 450 (a refund is negative).' }); amount.focus(); return; }
        await act(ctx, () => sb.from('payments').insert(paymentRow(f, {
          key,
          month,
          cents: c,
          method: methodWrap.querySelector('select').value,
          receivedOn: on.value || today,
          reference: ref.value.trim() || null,
          loose: loose.checked,
        })).select('id'), { done: `${money(c)} from ${f.name} recorded.` });
      }));
      return h('div', { class: 'acct-pay-form' },
        h('h4', {}, 'Record payment'),
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'Amount'), amount),
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'Received'), on),
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'Method'), methodWrap),
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'Reference'), ref),
        h('label', { class: 'check' }, loose, h('span', {}, 'Not for one month (a prepayment or several months)')),
        save);
    }

    function adjustments(f) {
      const label = select({ label: 'Kind', options: FAMILY_LABELS.map((l) => ({ value: l, label: LABELS[l] })), value: 'late_fee' });
      const amount = h('input', { class: 'input acct-money-input', inputmode: 'decimal', placeholder: '25', 'aria-label': 'Amount' });
      const why = h('input', { class: 'input', maxlength: '300', placeholder: 'Note', 'aria-label': 'Note' });
      const key = clientKey();
      const add = button({ label: 'Add', size: 'sm' });
      add.addEventListener('click', () => busy(add, 'Adding…', async () => {
        const kind = label.querySelector('select').value;
        let c = parseMoney(amount.value);
        if (c === null) { ctx.toast({ text: 'Enter an amount, like 25.' }); return; }
        if (kind === 'discount' || kind === 'credit') c = -c;
        await act(ctx, () => sb.from('billing_adjustments').insert({
          client_key: key, party: 'family', party_id: f.parentId, period: month, amount_cents: c, label: kind, note: why.value.trim() || null,
        }).select('id'), { done: `${LABELS[kind]} of ${money(Math.abs(c))} added.` });
      }));
      return h('div', { class: 'acct-block' },
        h('h4', {}, 'Fees, discounts and credits'),
        f.adjustments.length
          ? h('ul', { class: 'acct-lines' }, f.adjustments.map((a) => h('li', { class: 'acct-line' },
            h('span', { class: 'acct-line-what' }, `${labelText(a.label)}${a.note ? `: ${a.note}` : ''}`),
            h('span', { class: 'acct-line-amount num' }, money(a.amount_cents)),
            button({ label: 'Void', size: 'sm', variant: 'ghost', onClick: () => voidRow('billing_adjustments', a.id, 'Adjustment voided.') }))))
          : null,
        h('div', { class: 'acct-inline-form is-tight' }, label, amount, why, add),
        h('p', { class: 'field-hint' }, 'Discounts and credits lower what is owed; they are not payments.'));
    }

    function payments(f) {
      if (!f.payments.length) return null;
      return h('div', { class: 'acct-block' },
        h('h4', {}, 'Payments'),
        h('ul', { class: 'acct-lines' }, f.payments.map((p) => h('li', { class: 'acct-line' },
          h('span', { class: 'acct-line-what' }, `${shortDate(p.received_on, today)}, ${methodText(p.method)}${p.reference ? ` (${p.reference})` : ''}${p.period ? '' : ', not for one month'}`),
          h('span', { class: 'acct-line-amount num' }, money(p.amount_cents)),
          button({ label: 'Void', size: 'sm', variant: 'ghost', onClick: () => voidRow('payments', p.id, 'Payment voided.') })))));
    }

    function contact(f) {
      const c = f.contact;
      const phone = h('input', { class: 'input', value: c?.phone ?? '', maxlength: '40', 'aria-label': 'Phone' });
      const handle = h('input', { class: 'input', value: c?.pay_handle ?? '', maxlength: '120', placeholder: 'Zelle email or phone, Venmo handle', 'aria-label': 'Pays from' });
      const pref = select({ label: 'Usually pays by', options: [{ value: '', label: 'Usually pays by' }, ...FAMILY_METHODS.map((m) => ({ value: m, label: METHODS[m] }))], value: c?.preferred_method ?? '' });
      const save = button({ label: 'Save contact', size: 'sm', variant: 'ghost' });
      save.addEventListener('click', () => busy(save, 'Saving…', async () => {
        const fields = { phone: phone.value.trim() || null, pay_handle: handle.value.trim() || null, preferred_method: pref.querySelector('select').value || null };
        await act(ctx, () => (c
          ? sb.from('billing_contacts').update(fields).eq('parent_id', f.parentId).select('parent_id')
          : sb.from('billing_contacts').insert({ parent_id: f.parentId, ...fields }).select('parent_id')), { done: 'Contact saved.' });
      }));
      return h('details', { class: 'acct-contact' },
        h('summary', {}, c?.pay_handle ? `Pays from ${c.pay_handle}` : 'Contact and payment details'),
        h('div', { class: 'acct-inline-form' }, phone, handle, pref, save));
    }

    async function voidRow(tableName, id, done, ask = {}) {
      const reason = await askReason(ask.title ?? 'Void this?', ask.body ?? 'It stays on record and stops counting. This can’t be undone. Say why, for the record.', { confirmLabel: ask.confirmLabel ?? 'Void' });
      if (!reason || !ctx.alive()) return;
      await act(ctx, () => voidQuery(tableName, id, reason), { done });
    }

    // ---------------------------------------------------------------------
    // Mark paid and Undo, on the family's row

    // One payment for the month, for exactly what is due, the way the family
    // usually pays, received today (Pacific). The toast can take it back.
    function paidAction(f) {
      const gate = gateOf(f);
      const control = paidControl(f, { held: !gate.ok });
      if (control.kind === 'mark') return markPaidButton(f, control);
      if (control.kind === 'undo') {
        return button({
          label: 'Undo', size: 'sm', variant: 'ghost', ariaLabel: undoLabel({ name: f.name, payment: control.payment }), focusKey: `undo-${f.parentId}`,
          onClick: () => voidRow('payments', control.payment.id, 'Payment voided.', {
            title: 'Undo this payment?',
            body: `The ${money(control.payment.amount_cents)} payment from ${f.name} stays on record and stops counting, so the month goes back to what is due. Say why, for the record.`,
            confirmLabel: 'Undo payment',
          }),
        });
      }
      if (gate.ok) return null;
      const studentId = gate.items[0]?.row?.session.student_id;
      const add = button({ label: 'Add rate', size: 'sm', variant: 'ghost', href: studentId ? `#/rates?student=${studentId}` : '#/rates' });
      add.title = blockedTitle(gate);
      return add;
    }

    function markPaidButton(f, control) {
      // one key per button: pressed again after a send that landed, it records nothing new
      const key = clientKey();
      const btn = button({
        label: 'Mark paid', size: 'sm', icon: 'check', focusKey: `markpaid-${f.parentId}`,
        ariaLabel: markPaidLabel({ name: f.name, cents: control.cents }),
      });
      btn.title = `${money(control.cents)} by ${methodText(control.method)}, received today`;
      btn.addEventListener('click', () => busy(btn, 'Saving…', async () => {
        const row = paymentRow(f, { key, month, cents: control.cents, method: control.method, receivedOn: todayKey(new Date()) });
        await act(ctx, () => sb.from('payments').insert(row).select('id'), {
          done: (result) => {
            const { id } = paymentOutcome(result);
            return {
              text: markPaidText({ name: f.name, cents: control.cents, method: control.method }),
              action: id ? { label: 'Undo', run: () => undoPaid(f.name, id) } : undefined,
            };
          },
        });
      }));
      return btn;
    }

    // The toast's Undo: void that payment the way Void does. The page has
    // redrawn since, so this reports through the toast and the store, not the view.
    async function undoPaid(name, id) {
      let result;
      try {
        result = await voidQuery('payments', id, UNDO_REASON);
      } catch (error) {
        result = { error };
      }
      const ok = !result?.error && Array.isArray(result?.data) && result.data.length > 0;
      if (result?.error) console.error(result.error);
      ctx.toast({ text: ok ? undoDoneText(name) : 'That didn’t undo. Open Details and void the payment there.' });
      if (ok) ctx.store.invalidateBilling();
    }

    async function copy(text, done) {
      try {
        await navigator.clipboard.writeText(text);
        ctx.toast({ text: done });
      } catch {
        ctx.toast({ text: 'Your browser blocked copying. Open the statement and copy from there.' });
      }
    }

    paint();
    const filterGroup = segmented({
      label: 'Show',
      options: [{ value: 'all', label: 'All' }, { value: 'unpaid', label: 'Unpaid' }, { value: 'paid', label: 'Paid' }],
      value: filter,
      onChange: (v) => ctx.setParams({ filter: v === 'all' ? null : v }, { replace: true }),
    });
    root.replaceChildren(...[
      monthPicker(ctx, month),
      all.length ? releaseBar(plan, { onOpen: () => releaseDialog({ ctx, b, plan, month, today }) }) : null,
      h('div', { class: 'acct-toolbar' }, filterGroup, search, csvButton(ctx, `families-${month.slice(0, 7)}.csv`, () => familiesCsv(all))),
      list,
    ].filter(Boolean));
  })();
}
