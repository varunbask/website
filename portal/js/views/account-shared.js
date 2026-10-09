// Pieces every Account tab shares: the tab bar, the month picker, loading the
// priced calendar, tables that stack on phones, CSV downloads, and the one way
// a tab writes (check the rows that came back, toast, reload the billing data).

import { sb } from '../supabase.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { button, iconButton, linkTabs, errorCallout, skeletonRows, field } from '../ui.js';
import { todayKey } from '../dates.js';
import { buildContext, monthOf, monthParam, addMonths, monthName, money } from '../billing-model.js';
import { writeSessionBilling } from '../session-billing.js';

export const TABS = [
  { view: 'dashboard', label: 'Dashboard' },
  { view: 'families', label: 'Families' },
  { view: 'payroll', label: 'Payroll' },
  { view: 'rates', label: 'Rates' },
];

// The month on screen: ?month=YYYY-MM, else this month
export function monthFrom(route, now = new Date()) {
  return monthParam(route?.params?.month) ?? monthOf(todayKey(now));
}

export function setHeader(ctx, view, { lede, month } = {}) {
  const q = month ? `?month=${month.slice(0, 7)}` : '';
  const tabs = linkTabs(TABS.map((t) => ({ label: t.label, href: `#/${t.view}${q}`, current: t.view === view })), { label: 'Account' });
  return ctx.setHeader({ title: 'Account', lede, tabs });
}

// Previous / month / next, plus This month
export function monthPicker(ctx, month, { extra = [] } = {}) {
  const go = (m) => ctx.setParams({ month: m.slice(0, 7), from: null, to: null, year: null }, { replace: true });
  const thisMonth = monthOf(todayKey(ctx.now));
  return h('div', { class: 'acct-month' },
    iconButton({ icon: 'caret-left', label: `Previous month, ${monthName(addMonths(month, -1))}`, onClick: () => go(addMonths(month, -1)) }),
    h('h2', { class: 'acct-month-title', 'aria-live': 'polite' }, monthName(month)),
    iconButton({ icon: 'caret-right', label: `Next month, ${monthName(addMonths(month, 1))}`, onClick: () => go(addMonths(month, 1)) }),
    month !== thisMonth ? button({ label: 'This month', size: 'sm', variant: 'ghost', onClick: () => go(thisMonth) }) : null,
    ...extra);
}

// Loads the billing data and prices the calendar: { ctx: billingCtx, data } or null after showing an error
export async function loadPriced(ctx, root, { first = true } = {}) {
  if (first) root.replaceChildren(skeletonRows(5));
  try {
    const data = await ctx.store.getBilling();
    const priced = buildContext({
      sessions: data.sessions, links: data.links, rules: data.rules, billing: data.billing, now: new Date(),
    });
    return { b: priced, data };
  } catch (error) {
    console.error(error);
    if (!ctx.alive()) return null;
    const missing = /billing_|does not exist|not set up/i.test(String(error?.message ?? ''));
    root.replaceChildren(errorCallout({
      title: missing ? 'Billing is not set up yet.' : 'We couldn’t load the Account page.',
      text: missing ? 'The billing tables are not in the database yet. Apply the billing migration, then try again.' : 'Check your connection and try again.',
      onRetry: () => { ctx.store.invalidateBilling(); },
    }));
    return null;
  }
}

// A table that stacks into labelled rows on phones.
// columns: [{ key, label, num?, className? }]; rows: [{ cells: { key: Node|string }, className?, after?: Node }]
export function table({ label, columns, rows, foot = null, className = '' }) {
  const head = h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col', class: c.num ? 'num' : null }, c.label))));
  const body = h('tbody', {}, rows.flatMap((r) => {
    const tr = h('tr', { class: r.className ?? null, dataset: r.focusKey ? { focusKey: r.focusKey } : undefined },
      columns.map((c, i) => {
        const v = r.cells[c.key];
        const tag = i === 0 ? 'th' : 'td';
        return h(tag, { scope: i === 0 ? 'row' : null, class: [c.num ? 'num' : null, c.className].filter(Boolean).join(' ') || null, 'data-label': c.label }, v ?? '');
      }));
    if (!r.after) return [tr];
    return [tr, h('tr', { class: 'acct-detail-row' }, h('td', { colspan: String(columns.length) }, r.after))];
  }));
  const tfoot = foot ? h('tfoot', {}, h('tr', {}, columns.map((c, i) => h(i === 0 ? 'th' : 'td', { scope: i === 0 ? 'row' : null, class: c.num ? 'num' : null, 'data-label': c.label }, foot[c.key] ?? '')))) : null;
  return h('div', { class: `acct-table-wrap ${className}`.trim() },
    h('table', { class: 'acct-table', 'aria-label': label }, head, body, tfoot));
}

export const cents = (v) => h('span', { class: 'num' }, money(v));

// A card with a heading and optional meta and actions
export function card({ title, meta, actions = [], body = [], className = '', level = 2 }) {
  return h('section', { class: `card acct-card ${className}`.trim() },
    h('div', { class: 'card-head' },
      h(`h${level}`, { class: 'card-title' }, title),
      meta ? h('span', { class: 'card-meta' }, meta) : null,
      actions.length ? h('div', { class: 'card-actions' }, actions) : null),
    h('div', { class: 'card-body' }, body));
}

// Saves a CSV file from the browser (no server)
export function downloadCsv(host, fileName, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = h('a', { href: url, download: fileName, hidden: true });
  host.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvButton(ctx, fileName, make) {
  return button({ label: 'Download CSV', size: 'sm', variant: 'ghost', icon: 'arrow-square-out', onClick: () => downloadCsv(ctx.host, fileName, make()) });
}

// Runs a write that returns rows (.select('id')). An error or no rows (row
// security refused it) shows a toast; success reloads the billing data.
// `done` is the toast text, or a function of the result that returns the toast
// ({ text, action }), for a write that offers an Undo.
// Returns true on success.
export async function act(ctx, run, { done, failed = 'That didn’t save. Refresh the page and try again.', expect: count = null } = {}) {
  let result;
  try {
    result = await run();
  } catch (error) {
    result = { error };
  }
  if (!ctx.alive()) return false;
  const rows = Array.isArray(result?.data) ? result.data.length : (result?.data ? 1 : 0);
  // A retried form whose first send already landed comes back as a duplicate key: it is saved
  const duplicate = result?.error?.code === '23505' && /client_key/.test(String(result.error.message ?? result.error.details ?? ''));
  if ((result?.error && !duplicate) || (!duplicate && rows === 0) || (count !== null && !duplicate && rows !== count)) {
    if (result?.error) console.error(result.error);
    ctx.toast({ text: result?.error?.message && /paid period|happened|frozen|priced a paid/.test(result.error.message) ? `${result.error.message.charAt(0).toUpperCase()}${result.error.message.slice(1)}.` : failed });
    return false;
  }
  if (done) ctx.toast(typeof done === 'function' ? done(result) : { text: done });
  ctx.store.invalidateBilling();
  return true;
}

// The exception row for a session: insert or update (no upsert)
export const saveSessionBilling = writeSessionBilling;

// A text input bound to a label, for inline forms
export function input({ name, label, type = 'text', value = '', inputmode, placeholder, maxlength, required = false, className = '' }) {
  const el = h('input', {
    type, name, class: `input ${className}`.trim(), value, inputmode, placeholder, maxlength, required, autocomplete: 'off',
  });
  return el;
}

export function note(text, iconName = 'info') {
  return h('p', { class: 'note' }, icon(iconName), h('span', {}, text));
}

// '#/families?month=2026-11' style link for the same month on another tab
export function tabHref(view, month, extra = '') {
  return `#/${view}?month=${month.slice(0, 7)}${extra}`;
}

// A short-lived uuid for one form instance, reused if the same form is sent again
export function clientKey() {
  return crypto.randomUUID();
}

// Asks for a required reason (voids keep one on record). Resolves the text, or null.
export function askReason(title, body, { confirmLabel = 'Void' } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', maxlength: '300', 'aria-label': 'Reason', placeholder: 'Typo, wrong family, refunded…' });
    const dialog = h('dialog', { class: 'confirm acct-reason' });
    const done = (v) => { if (dialog.open) dialog.close(); dialog.remove(); resolve(v); };
    const ok = button({ label: confirmLabel, variant: 'danger', onClick: () => {
      if (!input.value.trim()) { input.focus(); return; }
      done(input.value.trim());
    } });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
    dialog.append(h('div', { class: 'confirm-inner' },
      h('h2', { class: 'confirm-title' }, title),
      h('p', { class: 'confirm-body' }, body),
      field({ label: 'Reason', control: input }),
      h('div', { class: 'confirm-actions' }, button({ label: 'Cancel', variant: 'secondary', onClick: () => done(null) }), ok)));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}
