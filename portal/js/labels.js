// Status wording for a submission. `grade` is the embedded grades row: staff
// see drafts, while students and parents only ever receive released rows.

export const FILE_LABELS = { 'application/pdf': 'PDF', 'image/png': 'Photo', 'image/jpeg': 'Photo', 'text/plain': 'Text' };

// What a submission holds: "Typed answer", "PDF", or "Typed answer and photo"
export function workLabel(sub) {
  const typed = typeof sub?.body === 'string' && sub.body.trim() !== '';
  const file = sub?.file_type ? (FILE_LABELS[sub.file_type] ?? 'File') : null;
  if (typed && file) return `Typed answer and ${file.toLowerCase()}`;
  if (typed) return 'Typed answer';
  return file ?? 'File';
}

// The icon for a submission: its file's, or a note for a typed answer alone
export function workIcon(sub) {
  if (sub?.file_type === 'application/pdf') return 'file-pdf';
  if (String(sub?.file_type ?? '').startsWith('image/')) return 'image-square';
  if (!sub?.file_type) return 'note-pencil';
  return 'file-text';
}

export function staffStatus(sub, grade) {
  if (grade?.released_at) return { text: 'Released', tone: 'done' };
  if (sub.status === 'pending') return { text: 'Submitted', tone: 'wait' };
  if (sub.status === 'grading') return { text: 'Grading', tone: 'wait' };
  if (grade?.reviewed_at) return { text: 'Edited, not released', tone: 'draft' };
  if (sub.status === 'failed') return { text: 'Could not grade', tone: 'alert' };
  return { text: 'AI draft', tone: 'draft' };
}

// Anything unreleased is simply waiting on the tutor. Families never hear how
// grading works: work the grader could not read waits for review like the rest.
export function familyStatus(sub, grade) {
  if (grade?.released_at) return { text: 'Graded', tone: 'done' };
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
