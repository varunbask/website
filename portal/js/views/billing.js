// Billing (parent.html, #/billing): the statements the business has released to
// this parent, newest first, from my_statements() (billing tables stay
// admin-only). A month appears here only once the admin releases it, so nothing
// about an unreleased month is on any family page. Each row opens the statement
// as it was released, laid out for printing. Bills go to the paying parent; the
// other parent of the same children (mom and dad) sees the same statements,
// marked with who pays them, and a parent with no statements sees an explanation.

import { sb } from '../supabase.js';
import { h } from '../dom.js';
import { button, pill, emptyState, errorCallout, skeletonRows } from '../ui.js';
import { todayKey } from '../dates.js';
import { money, monthName, shortDate, dayText, hoursText } from '../billing-model.js';
import { statementStatuses } from '../billing-text.js';

const TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
const timeRange = (a, b) => `${TIME.format(new Date(a)).toLowerCase()} to ${TIME.format(new Date(b)).toLowerCase()}`;

export function mount(ctx) {
  const period = /^\d{4}-\d{2}$/.test(ctx.route.params?.month ?? '') ? `${ctx.route.params.month}-01` : null;
  // Which paying parent's statement, when a parent sees two for one month
  const from = /^[0-9a-f-]{36}$/i.test(ctx.route.params?.from ?? '') ? ctx.route.params.from.toLowerCase() : null;
  ctx.setHeader({ title: period ? 'Statement' : 'Billing' });
  const root = h('div', { class: 'bill-root' });
  ctx.host.append(root);
  root.replaceChildren(skeletonRows(3));

  return (async () => {
    const { data, error } = await sb.rpc('my_statements');
    if (!ctx.alive()) return;
    if (error) {
      root.replaceChildren(errorCallout({ title: 'We couldn’t load your statements.', onRetry: () => location.reload() }));
      return;
    }
    const rows = data ?? [];
    const today = todayKey(ctx.now);
    // Only the newest statement is live; each older one was settled by the next
    const statuses = statementStatuses(rows, today);
    if (period) {
      const inMonth = (r) => String(r.period).slice(0, 10) === period;
      const found = rows.findIndex((r) => inMonth(r) && from !== null && String(r.payer_id ?? '').toLowerCase() === from);
      const at = found >= 0 ? found : rows.findIndex(inMonth);
      root.replaceChildren(at >= 0 ? statement(rows[at], statuses[at], today) : emptyState({ icon: 'receipt', text: 'This statement isn’t available.', action: { label: 'All statements', href: '#/billing' } }));
      return;
    }
    if (!rows.length) {
      root.replaceChildren(
        h('p', { class: 'bill-intro' }, 'Bills go to the parent who pays. If that is someone else in your family, they will see them here.'),
        emptyState({ icon: 'receipt', text: 'Your bill for a month appears here once we release it, usually on the 1st of the next month.' }));
      return;
    }
    root.replaceChildren(
      h('p', { class: 'bill-intro' }, introText(rows)),
      h('ul', { class: 'bill-list', 'aria-label': 'Statements' }, rows.map((r, i) => {
        const snap = r.snapshot ?? {};
        const status = statuses[i];
        const month = String(r.period).slice(0, 7);
        return h('li', {},
          h('a', { class: 'bill-row', href: `#/billing?month=${month}${r.own === false && r.payer_id ? `&from=${r.payer_id}` : ''}` },
            h('span', {},
              h('span', { class: 'bill-month' }, monthName(`${month}-01`)),
              h('span', { class: 'bill-date' }, `Dated ${dayText(snap.bill_date ?? `${month}-01`)}${snap.number ? `, statement ${snap.number}` : ''}${paidByText(r)}`)),
            h('span', { class: 'bill-amount num' }, money(Math.max(0, r.due_cents ?? snap.due_cents ?? 0))),
            pill({ label: status.label, tone: status.tone })));
      })));
  })();
}

// Who pays a statement another parent sent to: ", billed to Grace Lin"
function paidByText(r) {
  const name = String(r.payer_name ?? '').trim();
  return r.own === false && name ? `, billed to ${name}` : '';
}

// The line above the list. When every statement is billed to someone else
// (the other parent pays), say so; when some are, the rows say whose.
export function introText(rows) {
  const base = 'Each month is billed on the 1st of the next month, and a new one appears here when we release it. Open one to see every lesson or to print it.';
  const shared = rows.filter((r) => r.own === false);
  const payers = [...new Set(shared.map((r) => String(r.payer_name ?? '').trim()).filter(Boolean))];
  if (shared.length && shared.length === rows.length && payers.length === 1) {
    return `Your family’s monthly statements, as we released them. ${payers[0]} gets the bill and pays it; you see the same statements here. ${base}`;
  }
  if (shared.length) return `Your family’s monthly statements, as we released them, including ones billed to another parent of your children. ${base}`;
  return `Your monthly statements, as we released them. ${base}`;
}

// The statement exactly as saved when it was released
function statement(row, status, today) {
  const s = row.snapshot ?? {};
  const lines = s.lines ?? [];
  const due = s.due_cents ?? row.due_cents ?? 0;
  const meta = (label, value) => h('div', {}, h('dt', {}, label), h('dd', {}, value));
  return h('div', { class: 'bill-root' },
    h('div', { class: 'acct-print-bar' },
      button({ label: 'Print or save as PDF', icon: 'printer', variant: 'primary', onClick: () => window.print() }),
      button({ label: 'All statements', variant: 'ghost', href: '#/billing' }),
      pill({ label: status.label, tone: status.tone })),
    h('article', { class: 'acct-statement' },
      h('header', { class: 'acct-statement-head' },
        h('div', {}, h('p', { class: 'acct-statement-org' }, s.business ?? 'VP Education Group'), h('h1', {}, `Statement for ${s.name ?? ''}`)),
        h('dl', { class: 'acct-statement-meta' },
          meta('Statement', s.number ?? ''), meta('Month', monthName(s.month ?? row.period)),
          meta('Bill date', s.bill_date ? dayText(s.bill_date) : ''), meta('Due', s.due_date ? dayText(s.due_date) : ''))),
      h('table', { class: 'acct-statement-lines' },
        h('thead', {}, h('tr', {}, ['Date', 'Student', 'Subject and tutor', 'Hours', 'Rate', 'Amount'].map((x, i) => h('th', { class: i > 2 ? 'num' : null }, x)))),
        h('tbody', {},
          lines.map((l) => h('tr', { class: l.cancelled ? 'is-cancelled' : null },
            h('td', {}, `${dayText(l.day)}${l.starts_at && l.ends_at ? `, ${timeRange(l.starts_at, l.ends_at)}` : ''}`),
            h('td', {}, l.student),
            h('td', {}, `${l.subject} with ${l.tutor}${l.note ? ` (${l.note})` : ''}`),
            h('td', { class: 'num' }, hoursText(l.minutes ?? 0)),
            h('td', { class: 'num' }, l.rate_cents !== null && l.rate_cents !== undefined ? money(l.rate_cents) : ''),
            h('td', { class: 'num' }, money(l.amount_cents ?? 0)))),
          (s.adjustments ?? []).map((a) => h('tr', {}, h('td', { colspan: '5' }, `${a.label}${a.note ? `: ${a.note}` : ''}`), h('td', { class: 'num' }, money(a.amount_cents))))),
        h('tfoot', {},
          s.previous_cents ? h('tr', {}, h('th', { colspan: '5' }, 'Brought forward'), h('td', { class: 'num' }, money(s.previous_cents))) : null,
          h('tr', {}, h('th', { colspan: '5' }, `${monthName(s.month ?? row.period)} total`), h('td', { class: 'num' }, money(s.month_cents ?? 0))),
          (s.payments ?? []).map((p) => h('tr', {}, h('td', { colspan: '5' }, `Paid ${shortDate(p.received_on, today)} by ${p.method}${p.reference ? ` (${p.reference})` : ''}`), h('td', { class: 'num' }, money(-p.amount_cents)))),
          h('tr', { class: 'is-total' }, h('th', { colspan: '5' }, due < 0 ? 'Credit' : 'Amount due'), h('td', { class: 'num' }, money(Math.abs(due)))))),
      s.pay_note ? h('p', { class: 'acct-statement-note' }, s.pay_note) : null,
      s.number ? h('p', { class: 'acct-statement-note' }, `Please include ${s.number} with your payment.`) : null,
      closing(status)));
}

// A line under the statement for where it stands now
function closing(status) {
  const note = (text) => h('p', { class: 'acct-statement-note' }, text);
  if (status.key === 'paid') return note('Paid in full. Thank you.');
  if (status.key === 'partial') return note(`${status.label}. ${money(status.leftCents)} left to pay.`);
  if (status.key === 'carried') return note(`This balance was carried forward to the ${monthName(status.carriedTo).split(' ')[0]} statement.`);
  return null;
}
