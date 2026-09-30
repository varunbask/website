// Stub with its final signature (foundation F10). U4 replaces this file.
// progressPanel({ items, tasks, grades, name, now }) -> the three-metric card
// scoreChart(series) -> the score chart SVG with its data table
import { h } from './dom.js';
import { emptyState } from './ui.js';

export function progressPanel({ items, tasks, grades, name, now } = {}) {
  return h('section', { class: 'card' }, emptyState({ icon: 'chart-line-up', text: 'This view is being built.' }));
}

export function scoreChart(series) {
  return h('div', {}, emptyState({ icon: 'chart-line-up', text: 'This view is being built.' }));
}
