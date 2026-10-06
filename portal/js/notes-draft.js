// Unsaved session notes, kept in memory per session id so closing the drawer
// (Escape, the backdrop, a refresh render) does not lose what was typed. The
// same pattern as the composer drafts in views/updates.js: a Map, never
// written to storage. No DOM.
//
// A draft is { attendance, recap }. It is only kept while it differs from what
// the session already has, so an untouched form leaves nothing behind.

const drafts = new Map();

const key = (sessionId) => String(sessionId);

// The values a session has saved, in the form's shape
export function savedNotes(session) {
  return { attendance: session?.attendance ?? null, recap: session?.recap ?? '' };
}

// Does the typed text differ from the saved values? (surrounding whitespace is not a change)
export function differsFromSaved(values, session) {
  const saved = savedNotes(session);
  return (values?.attendance ?? null) !== saved.attendance
    || String(values?.recap ?? '').trim() !== String(saved.recap).trim();
}

// Keeps the typed values for a session, or drops the draft when they match
// what is saved. Returns whether a draft is now kept.
export function rememberDraft(session, values, store = drafts) {
  if (!session || !differsFromSaved(values, session)) {
    if (session) store.delete(key(session.id));
    return false;
  }
  store.set(key(session.id), { attendance: values.attendance ?? null, recap: String(values.recap ?? '') });
  return true;
}

// The kept draft for a session (a copy), or null; a draft that no longer
// differs from the session (saved elsewhere meanwhile) is dropped
export function recallDraft(session, store = drafts) {
  if (!session) return null;
  const draft = store.get(key(session.id));
  if (!draft) return null;
  if (!differsFromSaved(draft, session)) {
    store.delete(key(session.id));
    return null;
  }
  return { ...draft };
}

// After a successful save, or when the person discards it
export function forgetDraft(sessionId, store = drafts) {
  store.delete(key(sessionId));
}

// How many drafts are kept (tests)
export function draftCount(store = drafts) {
  return store.size;
}
