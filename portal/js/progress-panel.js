// Progress panel and score chart (spec 5.3, 6). Shared by the parent Overview
// and the staff student Overview.
//
// progressPanel({ items, tasks, grades, name, now }) -> section.card
//   items   derived Items (buckets.deriveItems) for the "Due this week" metric
//   tasks   raw task rows (due_at, completed_at) for "On time"
//   grades  grade rows ({ score, released_at }); only released ones ever count,
//           for every role, including staff
//   name    the student's first name, for the chart caption
// scoreChart(series, { name }) -> figure (or a note with fewer than 2 points)
//   series  scoreSeries(grades): [{ date, score }] oldest first

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { scoreSeries, chartModel } from './progress.js';
import { averageMetric, onTimeMetric, dueMetric, weekCounts, shortDay } from './overview-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PLOT_HEIGHT = 168;
const AXIS_HEIGHT = 28;
const GUTTER = 28;          // room for the 0 / 50 / 100 labels
const PAD_X = 48;
const PAD_Y = 14;
const DEFAULT_WIDTH = 640;

let chartCount = 0;

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

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

export function progressPanel({ items = [], tasks = [], grades = [], name = '', now = new Date() } = {}) {
  const released = (grades ?? []).filter((g) => g?.released_at);
  const titleId = uid('ovw-progress');
  return h('section', { class: 'card ovw-progress', 'aria-labelledby': titleId },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: titleId }, 'Progress')),
    h('dl', { class: 'ovw-metrics' },
      metric('Average score, last 30 days', averageMetric(released, now)),
      metric('On time', onTimeMetric(tasks, now)),
      metric('Due this week', dueMetric(weekCounts(items, now)))),
    h('div', { class: 'ovw-chart-block' },
      h('p', { class: 'ovw-chart-title' }, 'Score history'),
      scoreChart(scoreSeries(released), { name, now })));
}

// ---------------------------------------------------------------------------
// Score chart

function captionText(series, name, now) {
  const last = series[series.length - 1];
  const who = name ? `${name}’s released scores` : 'Released scores';
  const n = series.length;
  return `${who} over time, ${n} graded ${n === 1 ? 'assignment' : 'assignments'}. Latest: ${last.score} out of 100 on ${shortDay(last.date, now)}.`;
}

function dataTable(series, now) {
  return h('table', { class: 'visually-hidden' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Released'), h('th', { scope: 'col' }, 'Score'))),
    h('tbody', {}, series.map((p) => h('tr', {},
      h('td', {}, shortDay(p.date, now)),
      h('td', {}, `${p.score} out of 100`)))));
}

// Which points get a date under the x axis: first, middle and last
function axisIndexes(n) {
  return [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
}

function draw(series, width, captionId, now) {
  const model = chartModel(series, { width, height: PLOT_HEIGHT, padX: PAD_X, padY: PAD_Y });
  const last = model.points.length - 1;
  const grid = model.gridlines.map((g) => svg('g', { class: 'ovw-chart-guide' },
    svg('line', { x1: GUTTER, x2: width, y1: g.y, y2: g.y }),
    svg('text', { x: 0, y: g.y, dy: '0.32em' }, String(g.score))));

  const points = model.points.map((p, i) => {
    const isLast = i === last;
    return svg('g', { class: isLast ? 'ovw-chart-pt is-latest' : 'ovw-chart-pt' },
      svg('title', {}, `${shortDay(p.date, now)}: ${p.score}`),
      svg('circle', { class: 'ovw-chart-hit', cx: p.x, cy: p.y, r: 12 }),
      svg('circle', { class: 'ovw-chart-dot', cx: p.x, cy: p.y, r: isLast ? 3 : 2 }));
  });

  const end = model.points[last];
  // Above the latest point, or below it when it sits near the top guide
  const valueY = end.y - 12 < 10 ? end.y + 22 : end.y - 12;
  const value = svg('text', { class: 'ovw-chart-value', x: end.x, y: valueY, 'text-anchor': 'middle' }, String(end.score));

  const dates = axisIndexes(model.points.length).map((i) => {
    const p = model.points[i];
    return svg('text', { class: 'ovw-chart-date', x: p.x, y: PLOT_HEIGHT + 20, 'text-anchor': 'middle' }, shortDay(p.date, now));
  });

  return svg('svg', {
    class: 'ovw-chart-svg',
    viewBox: `0 0 ${width} ${PLOT_HEIGHT + AXIS_HEIGHT}`,
    width,
    height: PLOT_HEIGHT + AXIS_HEIGHT,
    role: 'img',
    'aria-labelledby': captionId,
    focusable: 'false',
  },
  grid,
  svg('path', { class: 'ovw-chart-line', d: model.path }),
  points,
  value,
  dates);
}

export function scoreChart(series, { name = '', now = new Date() } = {}) {
  const points = (series ?? []).filter((p) => p && Number.isFinite(Number(p.score)));
  if (points.length < 2) {
    return h('p', { class: 'note ovw-chart-note' }, icon('chart-line-up'), h('span', {}, 'The chart appears after two graded assignments.'));
  }
  chartCount += 1;
  const captionId = `chart-caption-${chartCount}`;
  const plot = h('div', { class: 'ovw-chart-plot' });
  let drawnWidth = 0;
  const render = (width) => {
    const w = Math.max(240, Math.round(width));
    if (w === drawnWidth) return;
    drawnWidth = w;
    plot.replaceChildren(draw(points, w, captionId, now));
  };
  render(DEFAULT_WIDTH);

  // Redraw at the real width so the labels stay 12px at every size
  if (typeof ResizeObserver !== 'undefined') {
    let seen = false;
    const observer = new ResizeObserver((entries) => {
      if (!plot.isConnected) {
        if (seen) observer.disconnect();
        return;
      }
      seen = true;
      const width = entries[entries.length - 1]?.contentRect?.width ?? 0;
      if (width > 0) render(width);
    });
    observer.observe(plot);
  }

  return h('figure', { class: 'ovw-chart' },
    plot,
    h('figcaption', { class: 'visually-hidden', id: captionId }, captionText(points, name, now)),
    dataTable(points, now));
}
