// Staff review rows (spec 5.8). Markup follows the row API in app.css
// (ul.row-list > li > a.row); review.css adds the two-part meta line.
//
// queueRow(sub, { studentName, taskTitle, attempt, total, newer, now, filter, showStudent })
//   -> an <li> for a ul.row-list.lead-32, linking to the review page.
//   showStudent: false (a single student's Overview) leads with the status
//   glyph and titles the row by the assignment; use a list without lead-32.
// releasedRow(sub, { studentName, taskTitle, now })
//   -> an <li> for Today's "Recently released" list.

import { h } from './dom.js';
import { icon } from './icons.js';
import { avatar, pill, draftChip } from './ui.js';
import { one } from './format.js';
import { submissionStatus, resultStatus } from './status.js';
import { resultOf } from './results.js';
import { relativeTime } from './dates.js';
import { MAX_SUBMISSIONS } from './buckets.js';
import { waitingLabel, reviewHref } from './review-model.js';

function caret() {
  const el = icon('caret-right');
  el.classList.add('row-caret');
  return el;
}

// Draft chip for unreleased work that has a result (AI draft or edited)
function draftOf(grade) {
  return grade && !grade.released_at ? draftChip(grade) : null;
}

export function queueRow(sub, {
  studentName = '', taskTitle = '', attempt, total = MAX_SUBMISSIONS, newer = false, now = new Date(), filter,
  showStudent = true,
} = {}) {
  const grade = one(sub.grade);
  const status = submissionStatus(sub, grade, { audience: 'staff' });
  const wait = waitingLabel(sub, now);
  const name = studentName || 'Student';
  const title = taskTitle || 'Assignment';
  const attemptText = attempt ? `Attempt ${attempt} of ${total}` : null;
  const draft = draftOf(grade);

  const label = [
    showStudent ? name : null, title, attemptText, newer ? 'Newer attempt submitted' : null,
    wait.text, draft ? draft.textContent : null, status.label,
  ].filter(Boolean).join(', ');

  return h('li', {}, h('a', {
    class: 'row rvw-row',
    href: reviewHref(sub.id, filter),
    'aria-label': label,
    dataset: { focusKey: `sub-${sub.id}` },
  },
  showStudent
    ? h('span', { class: 'row-lead' }, avatar(name, { size: 32 }))
    : h('span', { class: `row-lead tone-${status.glyph?.tone ?? status.tone}` }, icon(status.glyph?.icon ?? status.icon)),
  h('span', { class: 'row-main' },
    h('span', { class: 'row-title' }, showStudent ? name : title),
    h('span', { class: 'row-meta rvw-row-meta' },
      showStudent ? h('span', { class: 'rvw-row-task' }, title) : null,
      attemptText ? h('span', { class: 'rvw-row-fact num' }, attemptText) : null,
      newer ? h('span', { class: 'rvw-row-fact rvw-row-newer' }, 'Newer attempt submitted') : null)),
  h('span', { class: 'row-aside' },
    h('span', {
      class: ['row-due', 'num', wait.tone === 'warning' ? 'is-warning' : null].filter(Boolean).join(' '),
      title: wait.full || undefined,
    }, wait.text),
    h('span', { class: 'row-status' }, draft, pill(status))),
  caret()));
}

// "Released 2 days ago", "Released just now", "Released Oct 5"
function releasedText(iso, now) {
  const r = relativeTime(iso, now);
  const text = r.text === 'Just now' || r.text === 'Yesterday' ? r.text.toLowerCase() : r.text;
  return { text: `Released ${text}`, full: `Released ${r.full}` };
}

export function releasedRow(sub, { studentName = '', taskTitle = '', now = new Date() } = {}) {
  const grade = one(sub.grade);
  const name = studentName || 'Student';
  const title = taskTitle || 'Assignment';
  const when = grade?.released_at ? releasedText(grade.released_at, now) : null;
  const result = grade?.released_at ? resultStatus(resultOf(grade), { audience: 'staff' }) : null;

  const label = [name, title, result?.label, when?.text]
    .filter(Boolean).join(', ');

  return h('li', {}, h('a', {
    class: 'row rvw-row',
    href: reviewHref(sub.id),
    'aria-label': label,
    dataset: { focusKey: `sub-${sub.id}` },
  },
  h('span', { class: 'row-lead' }, avatar(name, { size: 32 })),
  h('span', { class: 'row-main' },
    h('span', { class: 'row-title' }, name),
    h('span', { class: 'row-meta rvw-row-meta' }, h('span', { class: 'rvw-row-task' }, title))),
  h('span', { class: 'row-aside' },
    when ? h('span', { class: 'row-due num', title: when.full }, when.text) : null,
    h('span', { class: 'row-status' }, result ? pill(result) : null)),
  caret()));
}
