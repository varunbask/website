// How old cached data may get before it is fetched again. Pure, no DOM.
//
// The app refreshes the current student when a tab comes back after STALE_MS
// (app.js). A parent's "Your children" row and a switch to a sibling read the
// same store, so they follow the same window: a sibling's cache older than
// this is dropped quietly (no change event) and loaded again.

export const STALE_MS = 5 * 60 * 1000;

const asMs = (v) => (v instanceof Date ? v.getTime() : Number(v));

// Is data loaded at `loadedAt` (ms or Date) older than maxAge at `now`? Nothing
// cached (null, undefined or not a time) is not stale: there is nothing to
// refresh, the next read loads it. A clock that went backwards is not stale.
export function isStale(loadedAt, now = Date.now(), maxAge = STALE_MS) {
  if (loadedAt === null || loadedAt === undefined || loadedAt === '') return false;
  const at = asMs(loadedAt);
  if (!Number.isFinite(at)) return false;
  return asMs(now) - at > maxAge;
}

// The earliest of several load times, ignoring ones still loading (undefined)
// or unusable; null when none is known. A student's cache is as old as its
// oldest piece (data, sessions, updates, tutors, materials).
export function oldestStamp(stamps) {
  const times = (stamps ?? []).map((v) => (v === null || v === undefined ? NaN : asMs(v))).filter(Number.isFinite);
  return times.length ? Math.min(...times) : null;
}
