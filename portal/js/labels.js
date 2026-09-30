// Status wording for a submission. `grade` is the embedded grades row: staff
// see drafts, while students and parents only ever receive released rows.

export const FILE_LABELS = { 'application/pdf': 'PDF', 'image/png': 'Photo', 'image/jpeg': 'Photo', 'text/plain': 'Text' };

export function staffStatus(sub, grade) {
  if (grade?.released_at) return { text: 'Released', tone: 'done' };
  if (sub.status === 'pending') return { text: 'Submitted', tone: 'wait' };
  if (sub.status === 'grading') return { text: 'Grading', tone: 'wait' };
  if (grade?.reviewed_at) return { text: 'Edited, not released', tone: 'review' };
  if (sub.status === 'failed') return { text: 'Could not grade', tone: 'alert' };
  return { text: 'AI draft', tone: 'review' };
}

// Anything unreleased is simply waiting on the tutor
export function familyStatus(sub, grade) {
  if (grade?.released_at) return { text: 'Graded', tone: 'done' };
  if (sub.status === 'failed' && sub.error) return { text: 'Needs attention', tone: 'alert' };
  return { text: 'Submitted, waiting for review', tone: 'wait' };
}

// Staff may restart grading for failed work, pending work nobody picked up, or stuck grading
export function canRetry(sub, now = new Date()) {
  const age = now.getTime() - Date.parse(sub.status_changed_at ?? sub.created_at);
  if (sub.status === 'failed') return true;
  if (sub.status === 'pending') return age > 5 * 60 * 1000;
  if (sub.status === 'grading') return age > 10 * 60 * 1000;
  return false;
}
