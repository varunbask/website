// Progress panel (spec 5.3, 6). Shared by the student and parent Overview and
// the staff student Overview.
//
// progressPanel({ items, tasks, submissions, now }) -> section.card
//   items        derived Items (buckets.deriveItems) for the "Due this week" metric
//   tasks        raw task rows (due_at, completed_at) for "On time"; with
//                submissions, also the completion count
//   submissions  submission rows with their grade embed; only released
//                results ever count, for every role, including staff
//                (completionCounts in results.js)

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { completionMetric, onTimeMetric, dueMetric, weekCounts } from './overview-model.js';

// ---------------------------------------------------------------------------
// Metrics

function metric(label, m) {
  const value = h('dd', { class: m.isText ? 'ovw-metric-value is-text' : 'ovw-metric-value' },
    h('span', {}, m.value),
    m.suffix ? h('span', { class: 'ovw-metric-suffix' }, ` ${m.suffix}`) : null);
  let line = null;
  if (m.line) {
    let glyph = null;
    if (m.danger) glyph = icon('warning-circle');
    else if (m.trend === 'up') glyph = icon('trend-up');
    else if (m.trend === 'down') glyph = icon('trend-down');
    line = h('dd', { class: m.danger ? 'ovw-metric-line is-danger' : 'ovw-metric-line' }, glyph, h('span', {}, m.line));
  }
  return h('div', { class: 'ovw-metric' }, h('dt', { class: 'ovw-metric-label' }, label), value, line);
}

export function progressPanel({ items = [], tasks = [], submissions = [], now = new Date() } = {}) {
  const titleId = uid('ovw-progress');
  return h('section', { class: 'card ovw-progress', 'aria-labelledby': titleId },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: titleId }, 'Progress')),
    h('dl', { class: 'ovw-metrics' },
      metric('Completed, last 30 days', completionMetric(tasks, submissions, now)),
      metric('On time', onTimeMetric(tasks, now)),
      metric('Due this week', dueMetric(weekCounts(items, now)))));
}
