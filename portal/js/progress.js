// Progress numbers for one student. Pure functions: no DOM, no network.
// Completion by result (Completed, Missing, Extended) lives in results.js.

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

export function percent(rate) {
  return rate === null || rate === undefined ? null : `${Math.round(rate * 100)}%`;
}
