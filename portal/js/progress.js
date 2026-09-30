// Progress numbers for one student. Pure functions: no DOM, no network.

const time = (iso) => Date.parse(iso);

// items: tasks rows { due_at, completed_at }
export function completionStats(items, now = new Date()) {
  const t = now.getTime();
  const done = items.filter((i) => i.completed_at);
  // judged: work whose deadline has passed, or that is already done
  const judged = items.filter((i) => i.due_at && (i.completed_at || time(i.due_at) < t));
  const onTime = judged.filter((i) => i.completed_at && time(i.completed_at) <= time(i.due_at));
  const overdue = items.filter((i) => !i.completed_at && i.due_at && time(i.due_at) < t);
  return {
    total: items.length,
    done: done.length,
    completionRate: items.length ? done.length / items.length : null,
    judged: judged.length,
    onTime: onTime.length,
    onTimeRate: judged.length ? onTime.length / judged.length : null,
    overdue: overdue.length,
  };
}

// grades rows { score, released_at } -> released numeric scores, oldest first
export function scoreSeries(grades) {
  return grades
    .filter((g) => g.released_at && g.score !== null && g.score !== undefined && Number.isFinite(Number(g.score)))
    .map((g) => ({ date: g.released_at, score: Number(g.score) }))
    .sort((a, b) => time(a.date) - time(b.date));
}

export function average(series) {
  return series.length ? series.reduce((sum, p) => sum + p.score, 0) / series.length : null;
}

export function percent(rate) {
  return rate === null || rate === undefined ? null : `${Math.round(rate * 100)}%`;
}

const round1 = (v) => Math.round(v * 10) / 10;

// Coordinates for an SVG line chart of 0 to 100 scores in a width x height box
export function chartModel(series, { width = 640, height = 220, padX = 40, padY = 20 } = {}) {
  if (!series.length) return null;
  const n = series.length;
  const x = (i) => (n === 1 ? width / 2 : padX + (i * (width - 2 * padX)) / (n - 1));
  const y = (score) => padY + ((100 - score) * (height - 2 * padY)) / 100;
  const points = series.map((p, i) => ({ x: round1(x(i)), y: round1(y(p.score)), score: p.score, date: p.date }));
  return {
    width,
    height,
    points,
    path: points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' '),
    gridlines: [0, 50, 100].map((score) => ({ score, y: round1(y(score)) })),
  };
}
