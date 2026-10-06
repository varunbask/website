// Unsaved session notes, kept in memory per session id so closing the drawer
// (Escape, the backdrop, a refresh render) does not lose what was typed. The
// same pattern as the composer drafts in views/updates.js: a Map, never
// written to storage. No DOM.
//
// A draft holds the typed recap and, only when the person actually chose an
// attendance in the form, that choice. An attendance they never touched is not
// part of the draft: the session's own value is used when the form reopens, so
// a mark made elsewhere meanwhile (a one-tap button on Today, another tab, an
// admin) is never written over by an old copy. A chosen attendance also
// remembers what the session had at that moment (base); if the session has a
// different value by the time the form reopens, someone else changed it and
// the choice is dropped.
//
// The draft is only kept while it differs from what the session has saved, so
// an untouched form leaves nothing behind.

const drafts = new Map();

const key = (sessionId) => String(sessionId);
const norm = (v) => (v === undefined || v === '' ? null : v);

// The values a session has saved, in the form's shape
export function savedNotes(session) {
  return { attendance: norm(session?.attendance) ?? null, recap: session?.recap ?? '' };
}

// Do the typed values differ from what the session has? values:
// { attendance, recap, touched }. Attendance only counts when the person
// touched it; surrounding whitespace in the recap is not a change.
export function differsFromSaved(values, session) {
  const saved = savedNotes(session);
  const attendanceChanged = values?.touched === true && (norm(values.attendance) ?? null) !== saved.attendance;
  return attendanceChanged || String(values?.recap ?? '').trim() !== String(saved.recap).trim();
}

// Keeps the typed values for a session, or drops the draft when they match
// what is saved. Returns whether a draft is now kept.
export function rememberDraft(session, values, store = drafts) {
  if (!session || !differsFromSaved(values, session)) {
    if (session) store.delete(key(session.id));
    return false;
  }
  const saved = savedNotes(session);
  const chose = values.touched === true && (norm(values.attendance) ?? null) !== saved.attendance;
  store.set(key(session.id), {
    recap: String(values.recap ?? ''),
    chose,
    attendance: chose ? (norm(values.attendance) ?? null) : null,
    base: saved.attendance,
  });
  return true;
}

// The kept draft for a session as the form should start: { attendance, recap,
// touched }, or null. attendance is the person's own choice while the session
// still has what it had then; otherwise the session's current value. A draft
// that no longer differs from the session (saved elsewhere meanwhile) is dropped.
export function recallDraft(session, store = drafts) {
  if (!session) return null;
  const draft = store.get(key(session.id));
  if (!draft) return null;
  const saved = savedNotes(session);
  const keepsChoice = draft.chose && draft.base === saved.attendance;
  const result = {
    attendance: keepsChoice ? draft.attendance : saved.attendance,
    recap: draft.recap,
    touched: keepsChoice,
  };
  if (!differsFromSaved(result, session)) {
    store.delete(key(session.id));
    return null;
  }
  return result;
}

// After a successful save, or when the person discards it
export function forgetDraft(sessionId, store = drafts) {
  store.delete(key(sessionId));
}

// How many drafts are kept (tests)
export function draftCount(store = drafts) {
  return store.size;
}
