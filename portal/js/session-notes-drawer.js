// The session notes form on its own, in the drawer: open=notes-s<id>. Today's
// "Write notes" buttons open it, so a tutor goes from the list straight to the
// recap without the session's detail page in between. Staff only. The form
// itself (attendance, recap, unsaved text kept in memory) is sessionNotesForm.
//
//   renderSessionNotes(dctx)  dctx.taskId 'notes-s<id>'
//
// Saving or cancelling closes the drawer, which goes back to where it opened.

import { h } from './dom.js';
import { pill, emptyState, errorCallout } from './ui.js';
import { sessionState } from './sessions-model.js';
import { displayName } from './format.js';
import { notesDrawerSession, notesBlockedText } from './schedule-summary.js';
import { sessionNotesForm } from './session-form.js';

const sameId = (a, b) => String(a) === String(b);
const TITLE = 'Session notes';

function paint(dctx, ...nodes) {
  dctx.header.replaceChildren();
  dctx.headerActions.replaceChildren();
  dctx.setFooter(null);
  dctx.body.replaceChildren(h('h2', { class: 'drawer-title', tabindex: '-1' }, TITLE), ...nodes);
  dctx.setTitle(TITLE);
}

function paintMessage(dctx, text) {
  paint(dctx, emptyState({ icon: 'info', text, action: { label: 'Close', onClick: () => dctx.close() } }));
}

// { session, student, ws } or null. The workspace says which student the
// session belongs to; that student's own list is the fresh copy of the row.
async function locate(dctx) {
  const id = notesDrawerSession(dctx.taskId);
  const ws = await dctx.store.getWorkspace();
  const summary = (ws.sessions ?? []).find((s) => sameId(s.id, id));
  if (!summary) return null;
  const list = await dctx.store.getSessions(summary.student_id);
  const session = (list ?? []).find((s) => sameId(s.id, id)) ?? null;
  if (!session) return null;
  const student = (ws.students ?? []).find((s) => sameId(s.id, summary.student_id)) ?? null;
  return { session, student, ws };
}

export async function renderSessionNotes(dctx) {
  if (dctx.audience !== 'staff' || dctx.readOnly) {
    paintMessage(dctx, 'This session isn’t available. It may have been cancelled or removed.');
    return;
  }
  // Keep what the tutor typed through any store change
  dctx.onRefresh(() => {});

  let found;
  try {
    found = await locate(dctx);
  } catch (error) {
    if (!dctx.alive()) return;
    console.error(error);
    paint(dctx, errorCallout({
      title: 'We couldn’t load this session.',
      text: 'Check your connection and try again.',
      onRetry: () => dctx.store.invalidate(null),
    }));
    return;
  }
  if (!dctx.alive()) return;

  const blocked = notesBlockedText(found?.session, dctx.me, { links: found?.ws?.links ?? null, now: new Date() });
  if (blocked) {
    paintMessage(dctx, blocked);
    return;
  }

  const { session, student } = found;
  const form = sessionNotesForm(dctx, {
    session,
    studentName: student ? displayName(student) : null,
    onCancel: () => dctx.close(),
    onSaved: () => dctx.close(),
  });
  const state = sessionState(session, new Date());
  dctx.header.replaceChildren(pill({ tone: state.tone, label: state.label }));
  dctx.headerActions.replaceChildren();
  dctx.body.replaceChildren(form);
  dctx.setTitle(form.dataset.title);

  // Attendance already chosen (a one-tap button, or an earlier draft): straight to the recap
  const chosen = form.querySelector('.segmented button[aria-pressed="true"]');
  (chosen ? form.querySelector('textarea') : form.querySelector('.segmented button'))?.focus();
}
