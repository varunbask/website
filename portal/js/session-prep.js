// "Before you start" in the staff session drawer: what happened last lesson, the
// homework since then and what waits for the tutor. prep-model.js decides what
// goes in; this file draws it with the drawer's own section, row and pill
// pieces. session-drawer.js calls prepSection() for a lesson that has not ended.
//
//   section.drawer-section.ses-prep > h3 + div.ses-prep-group ...
//     group "Last lesson":       h4.ses-prep-label + div.well.ses-prep-last
//     group "Homework ...":      h4.ses-prep-label + div.ses-homework > ul.row-list + p.ses-prep-more
//     group "Waiting for you":   h4.ses-prep-label + ul.ses-prep-wait > li (icon, text, link)

import { h } from './dom.js';
import { icon } from './icons.js';
import { button, itemRow, rowList, drawerHref } from './ui.js';
import { moreText, recapMayOverflow, studentWorkHref } from './prep-model.js';

// Last-lesson ids whose recap the tutor opened, so a refresh keeps it open
const recapOpen = new Set();

const WAIT_ICONS = { drafts: 'pencil-simple-line', failed: 'x-circle' };

// Clamps the recap to three lines with a Full recap toggle. The toggle is built only
// when the text may run long, then confirmed by measuring once the recap has a
// size (it can be laid out off screen first, so the observer waits for one).
function recapBlock(last) {
  const open = recapOpen.has(String(last.id));
  const recap = h('p', { class: open ? 'read is-pre ses-prep-recap is-open' : 'read is-pre ses-prep-recap', id: `ses-prep-recap-${last.id}` }, last.recap);
  if (!recapMayOverflow(last.recap)) return { recap, toggle: null };

  // One static name; aria-expanded carries the state and the caret turns over
  const toggle = button({
    label: 'Full recap',
    variant: 'ghost',
    size: 'sm',
    iconEnd: 'caret-down',
    focusKey: 'ses-prep-more',
    className: 'ses-prep-toggle',
    onClick: () => {
      const now = !recap.classList.contains('is-open');
      recap.classList.toggle('is-open', now);
      if (now) recapOpen.add(String(last.id));
      else recapOpen.delete(String(last.id));
      toggle.setAttribute('aria-expanded', String(now));
    },
  });
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-controls', recap.id);
  // Until measured, assume the guess was right; once measured, hide a toggle that
  // has nothing to reveal (a closed recap that fits its three lines)
  toggle.hidden = false;
  if (typeof ResizeObserver !== 'undefined') {
    const watch = new ResizeObserver(() => {
      if (!recap.clientHeight) return;
      watch.disconnect();
      if (recap.classList.contains('is-open')) return;
      toggle.hidden = recap.scrollHeight <= recap.clientHeight + 1;
    });
    watch.observe(recap);
  }
  return { recap, toggle };
}

function lastLessonGroup(last, { hash, names, pillFor }) {
  const head = h('div', { class: 'ses-prep-lasthead' },
    h('p', { class: 'ses-prep-when' },
      h('span', { class: 'ses-prep-date' }, last.when),
      last.ago ? h('span', { class: 'ses-prep-ago' }, last.ago) : null),
    last.attendance ? pillFor(last.attendance) : null);

  // Only when it was not the same subject and tutor, so the tutor is not misled
  const tutor = names?.get?.(String(last.tutorId)) || null;
  const mismatch = [];
  if (!last.sameSubject) mismatch.push(last.subject);
  if (!last.sameTutor && tutor) mismatch.push(`with ${tutor}`);

  const parts = [head];
  if (mismatch.length) parts.push(h('p', { class: 'ses-prep-with' }, mismatch.join(' ')));

  let toggle = null;
  if (last.recap) {
    const block = recapBlock(last);
    parts.push(block.recap);
    toggle = block.toggle;
  } else {
    parts.push(h('p', { class: 'ses-muted' }, last.hasNotes ? 'No recap was written.' : 'No notes were written for this lesson.'));
  }

  const link = button({
    label: 'Open lesson',
    variant: 'ghost',
    size: 'sm',
    iconEnd: 'caret-right',
    href: drawerHref(hash, `s${last.id}`),
    focusKey: 'ses-prep-open',
    className: 'ses-prep-open',
  });
  parts.push(h('div', { class: 'ses-prep-actions' }, toggle, link));

  return h('div', { class: 'ses-prep-group' },
    h('h4', { class: 'ses-prep-label' }, 'Last lesson'),
    h('div', { class: 'well ses-prep-last' }, parts));
}

function homeworkGroup(homework, { hasLast, studentId, hash, now }) {
  const label = hasLast ? 'Homework since then' : 'Overdue';
  const listLabel = hasLast ? 'Homework since the last lesson' : 'Overdue work';
  const list = h('div', { class: 'ses-homework' },
    rowList(homework.rows.map((item) => itemRow(item, { audience: 'staff', now, href: drawerHref(hash, item.task.id) })),
      { label: listLabel }));
  const more = homework.more && studentId !== null && studentId !== undefined
    ? h('p', { class: 'ses-prep-more' },
      button({ label: `See ${moreText(homework)}`, variant: 'ghost', size: 'sm', iconEnd: 'caret-right', href: studentWorkHref(studentId), focusKey: 'ses-prep-all' }))
    : null;
  return h('div', { class: 'ses-prep-group' },
    h('h4', { class: 'ses-prep-label' }, label),
    list,
    more);
}

function waitingGroup(waiting) {
  const items = waiting.notes.map((note) => h('li', { class: `ses-prep-note is-${note.key}` },
    icon(WAIT_ICONS[note.key] ?? 'info'),
    h('span', { class: 'ses-prep-note-text' }, note.text),
    button({ label: note.linkLabel, variant: 'ghost', size: 'sm', iconEnd: 'caret-right', href: note.href, focusKey: `ses-prep-${note.key}` })));
  return h('div', { class: 'ses-prep-group' },
    h('h4', { class: 'ses-prep-label' }, 'Waiting for you'),
    h('ul', { class: 'ses-prep-wait', 'aria-label': 'Waiting for you' }, items));
}

// The finished section, or null when there is nothing to show.
//   prep      buildPrep() output
//   options   { studentId, hash, now, names, pillFor(attendance) }
export function prepSection(prep, { studentId = null, hash = '', now = new Date(), names = null, pillFor } = {}) {
  if (!prep) return null;
  const groups = [];
  if (prep.last) groups.push(lastLessonGroup(prep.last, { hash, names, pillFor }));
  if (prep.homework.rows.length) groups.push(homeworkGroup(prep.homework, { hasLast: Boolean(prep.last), studentId, hash, now }));
  if (prep.waiting.notes.length) groups.push(waitingGroup(prep.waiting));
  if (!groups.length) return null;
  return h('section', { class: 'drawer-section ses-prep' }, h('h3', {}, 'Before you start'), groups);
}
