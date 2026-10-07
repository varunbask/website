// Account > Dashboard (account.html, admin). Revenue, tutor pay and what is
// left for a month, a custom range or a year; the Needs attention list (a
// missing rate, a tutor at two places at once, a student with no payer, an
// overdue family, each with its one-click fix); and who owes and who is owed.
// Every number comes from the calendar as it stands, through billing-model.js.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { button, pill, emptyState, drawerHref } from '../ui.js';
import { todayKey } from '../dates.js';
import { timeRange } from '../sessions-model.js';
import {
  money, hoursText, monthEnd, monthName, rangeTotals, familyRows, tutorRangeRows, allOutstanding, yearRows,
  needsAttention, ATTENTION, dayText, monthOf,
} from '../billing-model.js';
import { familiesCsv, yearCsv } from '../billing-text.js';
import {
  setHeader, monthFrom, monthPicker, loadPriced, table, cents, card, csvButton, act, saveSessionBilling, tabHref,
} from './account-shared.js';

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function mount(ctx) {
  const params = ctx.route.params ?? {};
  const year = /^\d{4}$/.test(params.year ?? '') ? Number(params.year) : null;
  const ranged = KEY_RE.test(params.from ?? '') && KEY_RE.test(params.to ?? '') && params.from <= params.to;
  const month = monthFrom(ctx.route, ctx.now);
  const from = ranged ? params.from : month;
  const to = ranged ? params.to : monthEnd(month);
  setHeader(ctx, 'dashboard', { month, lede: 'Revenue, tutor pay and what is left, from the sessions on the calendar.' });

  const root = h('div', { class: 'acct-root' });
  ctx.host.append(root);

  return (async () => {
    const loaded = await loadPriced(ctx, root);
    if (!loaded || !ctx.alive()) return;
    const { b } = loaded;
    if (year) {
      root.replaceChildren(yearView(b, year));
      return;
    }
    const t = rangeTotals(b, from, to);
    const families = familyRows(b, month);
    const tutors = tutorRangeRows(b, from, to);
    const attention = needsAttention(b, from, to);
    const outstandingMonth = families.reduce((s, f) => s + Math.max(0, f.dueCents), 0);

    const picker = ranged
      ? h('div', { class: 'acct-month' },
        h('h2', { class: 'acct-month-title' }, `${dayText(from)} to ${dayText(to)}`),
        button({ label: 'Back to months', size: 'sm', variant: 'ghost', onClick: () => ctx.setParams({ from: null, to: null }, { replace: true }) }))
      : monthPicker(ctx, month, {
        extra: [button({ label: `Year ${month.slice(0, 4)}`, size: 'sm', variant: 'ghost', onClick: () => ctx.setParams({ year: month.slice(0, 4), month: null }, { replace: true }) })],
      });

    root.replaceChildren(
      picker,
      h('div', { class: 'grid-12 acct-tiles' },
        tile('Revenue', 'receipt', [
          ['Expected', t.revenueExpected], ['Realized', t.revenueRealized], ['Collected', t.collected],
        ], ranged ? `${hoursText(t.studentMinutes)} student hours` : `Families owe ${money(outstandingMonth)} this month, ${money(allOutstanding(b))} in all. ${hoursText(t.studentMinutes)} student hours.`),
        tile('Tutor pay', 'users-three', [
          ['Expected', t.tutorExpected], ['Realized', t.tutorRealized],
        ], `${hoursText(t.slotMinutes)} hours taught. Your CPA runs payroll from the Payroll tab.`),
        tile('Net', 'chart-line-up', [
          ['Expected', t.netExpected], ['Realized', t.netRealized],
        ], `${t.marginPct === null ? 'No revenue yet' : `${t.marginPct}% margin`}. Revenue less tutor pay; no other expenses are tracked.`, true)),
      rangeCard(),
      attentionCard(b, attention),
      h('div', { class: 'grid-12' },
        h('div', { class: 'span-7' }, familiesCard(b, families)),
        h('div', { class: 'span-5' }, tutorsCard(b, tutors))),
    );
  })();

  // -------------------------------------------------------------------------

  function tile(title, iconName, figures, meta, accent = false) {
    return h('section', { class: `card acct-tile span-4${accent ? ' is-net' : ''}` },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, icon(iconName), h('span', {}, title))),
      h('dl', { class: 'acct-figures' }, figures.map(([label, value], i) => h('div', { class: i === 0 ? 'acct-figure is-main' : 'acct-figure' },
        h('dt', {}, label), h('dd', { class: i === 0 ? 't-figure num' : 'num' }, money(value))))),
      h('p', { class: 'card-meta acct-tile-meta' }, meta));
  }

  function rangeCard() {
    const a = h('input', { type: 'date', class: 'input', name: 'from', value: from, 'aria-label': 'From' });
    const z = h('input', { type: 'date', class: 'input', name: 'to', value: to, 'aria-label': 'To' });
    const show = button({ label: 'Show range', size: 'sm', onClick: () => {
      if (!KEY_RE.test(a.value) || !KEY_RE.test(z.value) || a.value > z.value) {
        ctx.toast({ text: 'Pick a start date on or before the end date.' });
        return;
      }
      ctx.setParams({ from: a.value, to: z.value, month: null }, { replace: true });
    } });
    return h('details', { class: 'card acct-range', open: ranged },
      h('summary', { class: 'acct-range-summary' }, 'Custom range'),
      h('div', { class: 'acct-range-row' },
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'From'), a),
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'To'), z),
        show));
  }

  // -------------------------------------------------------------------------
  // Needs attention

  function sessionLine(b, r) {
    const href = drawerHref(location.hash, `s${r.id}`);
    return h('a', { class: 'acct-session-link', href },
      h('span', { class: 'acct-session-when' }, `${dayText(r.day)}, ${timeRange(r.session)}`),
      h('span', {}, `${b.nameOf(r.session.student_id)}, ${r.subject || 'Tutoring'}, with ${b.nameOf(r.session.tutor_id)}`));
  }

  function attentionCard(b, attention) {
    const groups = [...attention.byKind].map(([kind, items]) => attentionGroup(b, kind, items, ATTENTION[kind]));
    if (!groups.length) {
      return h('section', { class: 'card acct-attention is-clear' },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, icon('check-circle'), h('span', {}, 'Nothing needs attention'))),
        h('p', { class: 'card-meta' }, 'Every lesson in this range has a family rate and a tutor pay rate, and every student has a paying parent.'));
    }
    return h('section', { class: 'card acct-attention' },
      h('div', { class: 'card-head' },
        h('h2', { class: 'card-title' }, icon('warning-circle'), h('span', {}, 'Needs attention')),
        h('span', { class: 'card-meta' }, 'The calendar is priced as it stands. A lock marks a missing rate: it holds back that family’s bill or that tutor’s pay period until you add one. The rest is for information.')),
      h('div', { class: 'acct-attention-groups' }, groups));
  }

  function attentionGroup(b, kind, items, meta) {
    const body = [];
    if (kind === 'overdue') {
      body.push(h('ul', { class: 'acct-attention-list' }, items.map((it) => h('li', {},
        h('a', { href: tabHref('families', it.month) }, `${b.nameOf(it.parentId)}: ${money(it.cents)} for ${monthName(it.month)}`)))));
    } else if (kind === 'no_payer') {
      body.push(h('p', {}, items.map((it) => b.nameOf(it.studentId)).join(', '), '. ',
        h('a', { href: '/portal/people.html#/everyone' }, 'Link a parent on People'), ' (the first parent linked pays).'));
    } else if (kind === 'no_tutor_rate') {
      body.push(h('p', {}, items.map((it) => b.nameOf(it.tutorId)).join(', '), '. ',
        h('a', { href: '#/rates' }, 'Set a pay rate on Rates'), '.'));
    } else {
      if (kind === 'overlap') {
        body.push(h('p', { class: 'card-meta' }, 'Nothing is held back. If this is one group lesson, mark it as a group so the tutor is paid once.'));
      }
      body.push(h('ul', { class: 'acct-attention-list' }, items.map((it) => h('li', { class: 'acct-attention-item', dataset: { focusKey: `att-${kind}-${it.rowId}` } },
        sessionLine(b, it.row),
        h('div', { class: 'acct-attention-actions' }, fixes(b, kind, it))))));
    }
    return h('details', { class: 'group acct-attention-group', open: items.length <= 6 },
      h('summary', { class: 'group-header' },
        icon('caret-right'),
        meta.blocks ? icon('lock-simple') : null,
        h('span', { class: 'group-title' }, meta.title),
        h('span', { class: 'group-count num' }, String(items.length))),
      body);
  }

  // The fix for a listed session: add the missing rate, or say two overlapping
  // lessons are one group (or a real clash, which stops it being listed)
  function fixes(b, kind, it) {
    const r = it.row;
    if (kind === 'unpriced') return [button({ label: 'Add rate', size: 'sm', href: `#/rates?student=${r.session.student_id}` })];
    // One key per lesson: the subject and its start time, so two group lessons on a day stay apart
    const key = `${r.subject || 'Group'} ${timeRange(r.session).split(' to ')[0]}`.slice(0, 40);
    return [
      button({ label: 'Mark as group', size: 'sm', onClick: () => markGroup(b, r, key) }),
      button({ label: 'Accept', size: 'sm', variant: 'ghost', icon: 'check', onClick: () => act(ctx, () => saveSessionBilling(r.id, { reviewed_at: new Date().toISOString(), reviewed_by: ctx.me.id }), { done: 'Accepted.' }) }),
    ];
  }

  // Every payable session of this tutor overlapping this one on the same day gets the same group key
  async function markGroup(b, r, key) {
    const t0 = Date.parse(r.session.starts_at);
    const t1 = Date.parse(r.session.ends_at);
    const members = b.rows.filter((x) => String(x.session.tutor_id) === String(r.session.tutor_id) && x.day === r.day
      && Date.parse(x.session.starts_at) < t1 && Date.parse(x.session.ends_at) > t0 && x.state !== 'cancelled');
    let ok = true;
    for (const m of members) {
      const res = await saveSessionBilling(m.id, { group_key: key });
      if (res.error || !res.data?.length) { ok = false; break; }
    }
    if (!ctx.alive()) return;
    ctx.toast({ text: ok ? `${members.length} sessions marked as one group: the tutor is paid once.` : 'That didn’t save. Refresh the page and try again.' });
    ctx.store.invalidateBilling();
  }

  // -------------------------------------------------------------------------
  // Families and tutors

  function familiesCard(b, families) {
    if (!families.length) {
      return card({ title: 'Families', body: [emptyState({ icon: 'receipt', text: `No sessions for paying families in ${monthName(month)} yet.` })] });
    }
    const total = (k) => families.reduce((s, f) => s + f[k], 0);
    return card({
      title: `Families, ${monthName(month)}`,
      meta: `${families.filter((f) => f.status.key === 'paid' || f.status.key === 'credit').length} of ${families.length} paid`,
      actions: [csvButton(ctx, `families-${month.slice(0, 7)}.csv`, () => familiesCsv(families)), button({ label: 'Open Families', size: 'sm', href: tabHref('families', month) })],
      body: [table({
        label: `Families, ${monthName(month)}`,
        columns: [
          { key: 'name', label: 'Family' }, { key: 'hours', label: 'Hours', num: true }, { key: 'owed', label: 'Owed', num: true },
          { key: 'paid', label: 'Paid', num: true }, { key: 'status', label: 'Status' },
        ],
        rows: families.map((f) => ({
          cells: {
            name: h('a', { href: tabHref('families', month, `&family=${f.parentId}`) }, f.name),
            hours: hoursText(f.minutes), owed: cents(f.owedCents), paid: cents(f.paidCents), status: pill(f.status),
          },
        })),
        foot: { name: 'Total', hours: hoursText(total('minutes')), owed: cents(total('owedCents')), paid: cents(total('paidCents')), status: '' },
      })],
    });
  }

  function tutorsCard(b, tutors) {
    if (!tutors.length) return card({ title: 'Tutor pay', body: [emptyState({ icon: 'users-three', text: 'No sessions in this range yet.' })] });
    const total = (k) => tutors.reduce((s, x) => s + x[k], 0);
    return card({
      title: 'Tutor pay',
      meta: ranged ? `${dayText(from)} to ${dayText(to)}` : monthName(month),
      actions: [button({ label: 'Open Payroll', size: 'sm', href: tabHref('payroll', month) })],
      body: [table({
        label: 'Tutor pay',
        columns: [
          { key: 'name', label: 'Tutor' }, { key: 'hours', label: 'Hours', num: true }, { key: 'owed', label: 'Earned', num: true },
          { key: 'ytd', label: 'This year', num: true },
        ],
        rows: tutors.map((x) => ({ cells: { name: x.name, hours: hoursText(x.minutes), owed: cents(x.realizedCents), ytd: cents(x.ytdCents) } })),
        foot: { name: 'Total', hours: hoursText(total('minutes')), owed: cents(total('realizedCents')), ytd: '' },
      })],
    });
  }

  function yearView(b, y) {
    const rows = yearRows(b, y);
    const total = (k) => rows.reduce((s, r) => s + r[k], 0);
    const thisMonth = monthOf(todayKey(ctx.now));
    const back = thisMonth.startsWith(String(y)) ? thisMonth : `${y}-01-01`;
    return h('div', {},
      h('div', { class: 'acct-month' },
        h('h2', { class: 'acct-month-title' }, String(y)),
        button({ label: 'Back to months', size: 'sm', variant: 'ghost', onClick: () => ctx.setParams({ year: null, month: back.slice(0, 7) }, { replace: true }) })),
      card({
        title: `Month by month, ${y}`,
        meta: 'Revenue and tutor pay by the month of the session; Collected by the day money came in.',
        actions: [csvButton(ctx, `account-${y}.csv`, () => yearCsv(rows))],
        body: [table({
          label: `Month by month, ${y}`,
          columns: [
            { key: 'month', label: 'Month' }, { key: 'rev', label: 'Revenue', num: true }, { key: 'col', label: 'Collected', num: true },
            { key: 'pay', label: 'Tutor pay', num: true }, { key: 'net', label: 'Net', num: true },
          ],
          rows: rows.map((r) => ({
            cells: {
              month: h('a', { href: `#/dashboard?month=${r.month.slice(0, 7)}` }, monthName(r.month).split(' ')[0]),
              rev: cents(r.revenueRealized), col: cents(r.collected), pay: cents(r.tutorRealized), net: cents(r.netRealized),
            },
          })),
          foot: {
            month: 'Total', rev: cents(total('revenueRealized')), col: cents(total('collected')), pay: cents(total('tutorRealized')),
            net: cents(total('netRealized')),
          },
        })],
      }));
  }
}
