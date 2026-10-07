// Account > Families: releasing bills. The month-level bar and its confirm
// dialog, and the one write a release is (a statements row with its snapshot),
// shared with each family's own Release button. The planning and the words live
// in billing-release.js; this file draws them and talks to the database.

import { sb } from '../supabase.js';
import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import { button } from '../ui.js';
import { statementSnapshot, sendColumns } from '../billing-text.js';
import { releaseHeadline, releaseCounts, releaseCopy, releaseAll, releaseResultCopy } from '../billing-release.js';

// What to save for a ready family: its snapshot and the statements columns
export function statementColumns(b, today, { f, previous, action }) {
  const snap = statementSnapshot(b, f, { previousCents: previous, sentOn: action.sentOn });
  return { snap, columns: sendColumns(action, snap, today) };
}

// A first release inserts the row; saving a copy for a statement marked sent
// before snapshots, or releasing again, updates it
export function writeStatement(month, kind, parentId, columns) {
  const query = kind === 'mark'
    ? sb.from('statements').insert({ parent_id: parentId, period: month, ...columns })
    : sb.from('statements').update(columns).eq('parent_id', parentId).eq('period', month);
  return query.select('parent_id');
}

// The strip under the month picker: where the month stands, and the button
export function releaseBar(plan, { onOpen }) {
  const head = releaseHeadline(plan);
  const c = releaseCounts(plan);
  // Students with no paying parent cannot be released, so they never keep the button on
  const finished = !c.ready && !c.heldFamilies;
  return h('section', { class: `acct-release is-${head.tone}`, 'aria-label': 'Release bills' },
    icon(finished ? 'check-circle' : 'envelope-simple', { size: 20 }),
    h('div', { class: 'acct-release-text' },
      h('p', { class: 'acct-release-title' }, head.title),
      h('p', { class: 'acct-release-meta' }, head.meta)),
    finished ? null : button({ label: 'Release bills', variant: 'primary', icon: 'envelope-simple', focusKey: 'release-bills', onClick: onOpen }));
}

// The confirm dialog: who will be released, who is already out, who is held
// back and why, a warning for a month that has not ended, then progress and
// the result. Resolves when it closes.
export function releaseDialog({ ctx, b, plan, month, today }) {
  return new Promise((resolve) => {
    const copy = releaseCopy(plan);
    const titleId = uid('release-title');
    const dialog = h('dialog', { class: 'confirm acct-release-dialog', role: 'alertdialog', 'aria-labelledby': titleId });
    const inner = h('div', { class: 'confirm-inner' });
    dialog.append(inner);
    let running = false;

    const close = () => {
      if (running) return;
      if (dialog.open) dialog.close();
      dialog.remove();
      document.querySelector('[data-focus-key="release-bills"]')?.focus();
      resolve();
    };
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    const closeButton = (label = 'Close', variant = 'secondary') => button({ label, variant, onClick: close });

    const lines = (list) => h('div', { class: 'acct-release-lines' }, list.map((t) => h('p', { class: 'confirm-body' }, t)));
    const listOf = (title, items, className) => (items.length
      ? h('div', { class: `acct-release-held ${className ?? ''}`.trim() },
        h('p', { class: 'acct-release-held-title' }, title),
        h('ul', { class: 'acct-release-held-list' }, items.map((t) => h('li', {}, t))))
      : null);

    function showConfirm() {
      const warn = copy.warning
        ? h('div', { class: 'confirm-warning', role: 'note' }, icon('warning-circle', { size: 16 }),
          h('div', {}, h('p', { class: 'confirm-warning-title' }, copy.warning.title), h('p', {}, copy.warning.text)))
        : null;
      const go = copy.confirmLabel ? button({ label: copy.confirmLabel, variant: 'primary', onClick: run }) : null;
      const cancel = closeButton(go ? 'Cancel' : 'Close');
      inner.replaceChildren(...[
        h('h2', { class: 'confirm-title', id: titleId }, copy.title),
        lines(copy.lines),
        warn,
        listOf(copy.heldTitle, copy.held),
        h('div', { class: 'confirm-actions' }, cancel, go),
      ].filter(Boolean));
    }

    async function run() {
      running = true;
      const total = plan.ready.length;
      const bar = h('progress', { class: 'acct-release-progress', max: String(total), value: '0', 'aria-label': 'Release progress' });
      const status = h('p', { class: 'confirm-body', role: 'status', 'aria-live': 'polite' }, `Releasing 0 of ${total}`);
      inner.replaceChildren(
        h('h2', { class: 'confirm-title', id: titleId }, copy.runningTitle),
        bar,
        status);
      const result = await releaseAll(plan.ready, (item) => {
        const { columns } = statementColumns(b, today, item);
        return writeStatement(month, item.action.kind, item.parentId, columns);
      }, {
        onProgress: ({ done, item }) => {
          bar.value = done;
          status.textContent = `Releasing ${done} of ${total}: ${item.name}`;
        },
      });
      running = false;
      for (const x of result.failed) console.error(`Release failed for ${x.name}: ${x.message}`);
      // One reload for the whole run: the page behind shows the new states
      if (result.released.length || result.skipped.length) ctx.store.invalidateBilling();
      showResult(releaseResultCopy(result, plan));
    }

    function showResult(r) {
      const done = closeButton('Close', 'primary');
      inner.replaceChildren(...[
        h('h2', { class: 'confirm-title', id: titleId }, r.title),
        lines(r.lines),
        listOf(`Not released (${r.failed.length})`, r.failed, 'is-failed'),
        h('div', { class: 'confirm-actions' }, done),
      ].filter(Boolean));
      done.focus();
    }

    document.body.append(dialog);
    showConfirm();
    dialog.showModal();
    inner.querySelector('.confirm-actions .btn')?.focus();
  });
}
