// Pure status decisions: one place picks the pill label, tone, icon and row glyph
// for every item and submission, for families (students, parents) and staff.
// Families never see "AI draft", "Grading", "Edited" or any draft state.
//
// A released grade shows its result: Completed (success), Missing (danger) or
// Extended (warning). An assignment past due with nothing handed in is Missing
// too; a task past due stays Overdue.

import { staffStatus, familyStatus } from './labels.js';
import { resultOf, RESULT_LABELS } from './results.js';
import { shortDay } from './dates.js';

// labels.js tones to status tones
export const TONE_OF = Object.freeze({ done: 'success', wait: 'info', draft: 'warning', alert: 'danger' });

// Builds a status; the row glyph defaults to the pill's icon and tone
function make(key, label, tone, icon, { dashed = false, struck = false, glyph = null } = {}) {
  return { key, label, tone, icon, dashed, struck, glyph: glyph ?? { icon, tone } };
}

// Keyed by staffStatus text
const STAFF = {
  Released: ['graded', 'check-circle'],
  Submitted: ['submitted', 'hourglass-medium'],
  Grading: ['grading', 'hourglass-medium'],
  'Edited, not released': ['edited', 'note-pencil'],
  'Could not grade': ['failed', 'x-circle'],
  'AI draft': ['draft', 'pencil-simple-line'],
};

// Pill look of each result: [tone, icon]
const RESULT_LOOK = Object.freeze({
  completed: ['success', 'check-circle'],
  missing: ['danger', 'minus-circle'],
  extended: ['warning', 'clock'],
});

// A result as a status: Completed, Missing or Extended. A released grade
// without a result (none should exist) falls back to "Graded" (staff: "Released").
export function resultStatus(result, { audience = 'family', glyph = null } = {}) {
  const look = RESULT_LOOK[result];
  if (!look) return make('graded', audience === 'staff' ? 'Released' : 'Graded', 'success', 'check-circle', { glyph });
  return make(result, RESULT_LABELS[result], look[0], look[1], { glyph });
}

// Status of one submission attempt (drawer history, review page, in-review
// rows). Staff see where the grade stands (Released, AI draft, ...); families
// see a released grade's result.
export function submissionStatus(sub, grade, { audience = 'family' } = {}) {
  if (audience === 'staff') {
    const { text, tone } = staffStatus(sub, grade);
    const [key, icon] = STAFF[text];
    return make(key, text, TONE_OF[tone], icon, { dashed: tone === 'draft' });
  }
  const { tone } = familyStatus(sub, grade);
  if (tone === 'done') return resultStatus(resultOf(grade));
  if (tone === 'alert') return make('needs-attention', 'Needs attention', 'danger', 'x-circle');
  return make('submitted', 'Submitted', 'info', 'hourglass-medium');
}

// To do, Due soon or Overdue, from the item's due state. An assignment past
// due is Missing (a task stays Overdue); one on an extension says so until its
// new date passes.
function openStatus(item, now) {
  const assignment = item.task.kind !== 'task';
  if (item.dueState === 'overdue') return make('overdue', assignment ? 'Missing' : 'Overdue', 'danger', 'warning-circle');
  if (assignment && item.extended) {
    const due = item.task.due_at;
    return make('extended', due ? `Extended to ${shortDay(due, now)}` : 'Extended', 'warning', 'clock');
  }
  if (item.dueState === 'soon') return make('soon', 'Due soon', 'warning', 'clock');
  return make('todo', 'To do', 'neutral', 'circle');
}

const ARCHIVE_GLYPH = { icon: 'archive', tone: 'neutral' };

// Status of a derived Item (see buckets.js deriveItems). `now` only sets
// whether "Extended to Oct 12" needs a year.
export function itemStatus(item, { audience = 'family', now = new Date() } = {}) {
  if (item.task.kind === 'task') {
    if (item.dueState === 'done') return make('done', 'Done', 'neutral', 'check-circle', { struck: true });
    return openStatus(item, now);
  }
  switch (item.bucket) {
    case 'in-review':
      return submissionStatus(item.latest, item.grade, { audience });
    case 'graded':
      return resultStatus(resultOf(item.grade), { audience });
    case 'archived':
      if (item.archiveReason === 'graded') return resultStatus(resultOf(item.grade), { audience, glyph: ARCHIVE_GLYPH });
      return make('missing', 'Missing', 'danger', 'minus-circle', { glyph: ARCHIVE_GLYPH });
    default:
      return openStatus(item, now);
  }
}
