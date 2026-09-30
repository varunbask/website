import { sb } from './supabase.js';
import { h, clear } from './dom.js';
import { formatDate } from './format.js';
import { completionStats, scoreSeries, average, percent, chartModel } from './progress.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  for (const child of children) if (child) el.append(child);
  return el;
}

function stat(label, value) {
  return h('div', {}, h('dt', {}, label), h('dd', {}, value));
}

function scoreChart(series) {
  const model = chartModel(series);
  if (!model) return h('p', { class: 'meta chart' }, 'Scores appear here once graded work is released.');
  const first = model.points[0];
  const last = model.points[model.points.length - 1];
  const picture = svg('svg', {
    viewBox: `0 0 ${model.width} ${model.height + 24}`,
    role: 'img',
    'aria-labelledby': 'score-chart-caption',
  },
  ...model.gridlines.flatMap((g) => [
    svg('line', { class: 'chart-grid', x1: 0, x2: model.width, y1: g.y, y2: g.y }),
    svg('text', { class: 'chart-label', x: 0, y: g.y - 4 }, String(g.score)),
  ]),
  svg('path', { class: 'chart-line', d: model.path }),
  ...model.points.map((p) => svg('circle', { class: 'chart-dot', cx: p.x, cy: p.y, r: 4 },
    svg('title', {}, `${formatDate(p.date)}: ${p.score}`))),
  svg('text', { class: 'chart-label', x: first.x, y: model.height + 18, 'text-anchor': model.points.length > 1 ? 'start' : 'middle' }, formatDate(first.date)),
  model.points.length > 1
    ? svg('text', { class: 'chart-label', x: last.x, y: model.height + 18, 'text-anchor': 'end' }, formatDate(last.date))
    : null);

  const table = h('table', { class: 'visually-hidden' },
    h('caption', {}, 'Released scores'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'Score'))),
    h('tbody', {}, series.map((p) => h('tr', {}, h('td', {}, formatDate(p.date)), h('td', {}, String(p.score))))));

  const count = `${series.length} graded ${series.length === 1 ? 'assignment' : 'assignments'}`;
  return h('figure', { class: 'chart' },
    picture,
    h('figcaption', { id: 'score-chart-caption' }, `Scores over time, ${count}. Latest: ${last.score} on ${formatDate(last.date)}.`),
    table);
}

// Loads and draws one student's progress. Only released grades count.
export async function renderProgress(container, studentId) {
  clear(container).append(h('p', { class: 'meta' }, 'Loading progress...'));
  const [tasks, grades] = await Promise.all([
    sb.from('tasks').select('due_at, completed_at').eq('student_id', studentId),
    sb.from('grades').select('score, released_at').eq('student_id', studentId).not('released_at', 'is', null),
  ]);
  if (tasks.error || grades.error) {
    clear(container).append(h('p', { class: 'form-message error' }, 'Progress could not be loaded. Refresh to try again.'));
    return;
  }
  const stats = completionStats(tasks.data);
  const series = scoreSeries(grades.data);
  const avg = average(series);
  clear(container).append(
    h('dl', { class: 'stats' },
      stat('Completed', stats.total ? `${stats.done} of ${stats.total}` : 'None yet'),
      stat('On time', percent(stats.onTimeRate) ?? 'None due yet'),
      stat('Overdue', String(stats.overdue)),
      stat('Average score', avg === null ? 'None yet' : String(Math.round(avg)))),
    scoreChart(series));
}
