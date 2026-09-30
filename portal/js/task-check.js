// Stub with its final signature (foundation F10). U2 replaces this file.
// taskCheck(item, ctx, { size }) -> the Tasks checkbox (students and staff) or
// a done glyph (parents).
import { h } from './dom.js';
import { icon } from './icons.js';
import { visuallyHidden } from './ui.js';

export function taskCheck(item, ctx, { size = 'md' } = {}) {
  const done = Boolean(item?.task?.completed_at);
  return h('span', { class: `glyph tone-neutral is-${size}` },
    icon(done ? 'check-circle' : 'circle'),
    visuallyHidden(done ? 'Done' : 'Not done yet'));
}
