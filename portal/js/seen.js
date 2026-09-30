// "New" markers for students and parents: the last time a viewer opened Graded
// or Updates for a student, kept in localStorage. All storage access is wrapped;
// when storage is unavailable, nothing ever shows as new.

export const FIRST_VISIT_DAYS = 7;
const DAY = 86_400_000;

// kind is 'graded' or 'updates'
export function seenKey(kind, viewerId, studentId) {
  return `vb-seen-${kind}-${viewerId}-${studentId}`;
}

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

// The stored ISO time, null when never seen, or undefined when storage is unavailable
export function getSeen(kind, viewerId, studentId, storage = defaultStorage()) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return undefined;
    const value = storage.getItem(seenKey(kind, viewerId, studentId));
    return value && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return undefined;
  }
}

// Stores now; returns whether it was saved
export function markSeen(kind, viewerId, studentId, now = new Date(), storage = defaultStorage()) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false;
    storage.setItem(seenKey(kind, viewerId, studentId), new Date(now).toISOString());
    return true;
  } catch {
    return false;
  }
}

// Is a timestamp new, given what getSeen returned? First visits count the last 7 days.
export function isNewSince(iso, seen, now = new Date()) {
  if (!iso || seen === undefined) return false;
  const t = Date.parse(iso);
  if (seen === null) return new Date(now).getTime() - t <= FIRST_VISIT_DAYS * DAY;
  return t > Date.parse(seen);
}

export function hasNewSince(isoList, seen, now = new Date()) {
  return (isoList ?? []).some((iso) => isNewSince(iso, seen, now));
}
