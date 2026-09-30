// Stub with its final signature (foundation F10). U6 replaces this file.
// queueRow(sub, { studentName, taskTitle, attempt, total, newer, now, filter })
// -> an <li> for a ul.row-list, linking to the review page.
import { h } from './dom.js';
import { icon } from './icons.js';
import { avatar } from './ui.js';

export function queueRow(sub, { studentName = '', taskTitle = '', attempt, total, newer = false, now = new Date(), filter } = {}) {
  const href = `#/review/${encodeURIComponent(sub.id)}${filter ? `?filter=${encodeURIComponent(filter)}` : ''}`;
  return h('li', {}, h('a', { class: 'row', href, dataset: { focusKey: `sub-${sub.id}` } },
    h('span', { class: 'row-lead' }, avatar(studentName, { size: 32 })),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, studentName || 'Student'),
      h('span', { class: 'row-meta' }, taskTitle)),
    h('span', { class: 'row-aside' }),
    icon('caret-right')));
}
