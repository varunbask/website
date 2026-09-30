// Pure status decisions: one place picks the pill label, tone, icon and row glyph
// for every item and submission, for families (students, parents) and staff.
// Families never see "AI draft", "Grading", "Edited" or any draft state.

import { staffStatus, familyStatus } from './labels.js';

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

// Status of one submission attempt (drawer history, review page, in-review rows)
export function submissionStatus(sub, grade, { audience = 'family' } = {}) {
  if (audience === 'staff') {
    const { text, tone } = staffStatus(sub, grade);
    const [key, icon] = STAFF[text];
    return make(key, text, TONE_OF[tone], icon, { dashed: tone === 'draft' });
  }
  const { tone } = familyStatus(sub, grade);
  if (tone === 'done') return make('graded', 'Graded', 'success', 'check-circle');
  if (tone === 'alert') return make('needs-attention', 'Needs attention', 'danger', 'x-circle');
  return make('submitted', 'Submitted', 'info', 'hourglass-medium');
}

// To do, Due soon or Overdue, from the item's due state
function openStatus(dueState) {
  if (dueState === 'overdue') return make('overdue', 'Overdue', 'danger', 'warning-circle');
  if (dueState === 'soon') return make('soon', 'Due soon', 'warning', 'clock');
  return make('todo', 'To do', 'neutral', 'circle');
}

const ARCHIVE_GLYPH = { icon: 'archive', tone: 'neutral' };

// Status of a derived Item (see buckets.js deriveItems)
export function itemStatus(item, { audience = 'family' } = {}) {
  if (item.task.kind === 'task') {
    if (item.dueState === 'done') return make('done', 'Done', 'neutral', 'check-circle', { struck: true });
    return openStatus(item.dueState);
  }
  switch (item.bucket) {
    case 'in-review':
      return submissionStatus(item.latest, item.grade, { audience });
    case 'graded':
      return make('graded', audience === 'staff' ? 'Released' : 'Graded', 'success', 'check-circle');
    case 'archived':
      if (item.archiveReason === 'graded') {
        return make('graded', audience === 'staff' ? 'Released' : 'Graded', 'success', 'check-circle', { glyph: ARCHIVE_GLYPH });
      }
      return make('not-turned-in', 'Not turned in', 'neutral', 'minus-circle', { glyph: ARCHIVE_GLYPH });
    default:
      return openStatus(item.dueState);
  }
}
