// A clock and a timer queue a test moves by hand: now(), setTimer(fn, ms),
// clearTimer(id), advance(ms) (runs every timer that falls due, in order)
export function fakeClock() {
  let at = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => at,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, due: at + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      const end = at + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!due) break;
        timers.delete(due[0]);
        at = due[1].due;
        due[1].fn();
      }
      at = end;
    },
    count: () => timers.size,
  };
}
