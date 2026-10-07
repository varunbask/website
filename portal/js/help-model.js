// Pure content for the Help view (#/help): who to contact and short, practical
// answers per role. No DOM here; views/help.js turns these sections into markup.
//
// helpSections(role) -> [{ id, title, blocks }]
//   blocks, in reading order:
//     { type: 'p', parts }          a paragraph
//     { type: 'steps', items }      a numbered list, one parts array per step
//     { type: 'list', items }       a bulleted list
//     { type: 'actions', actions }  buttons: [{ label, href, icon, variant }]
//   parts is a string, or an array of strings and links ({ text, href }), so a
//   sentence can carry a mail link without any markup in the text.
//
// The support address lives here once. item-drawer.js and submit-work.js import
// it for the "email us" lines that used to say "Message your tutor" (the portal
// has no messaging).

import { MAX_SUBMISSIONS } from './buckets.js';
import { MAX_UPLOAD_BYTES } from './upload.js';

export const SUPPORT_EMAIL = 'vbmgroupsllc@gmail.com';
export const PRIVACY_PATH = '/privacy.html';

// mailto:vbmgroupsllc@gmail.com, or with a subject line
export function supportMailto(subject) {
  return subject ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}` : `mailto:${SUPPORT_EMAIL}`;
}

// A link inside a sentence: parts = ['Email ', link(SUPPORT_EMAIL, supportMailto())]
export const link = (text, href) => ({ text, href });
const mail = () => link(SUPPORT_EMAIL, supportMailto());

const STUDENT = 'student';
const PARENT = 'parent';
const STAFF_ROLES = new Set(['tutor', 'admin']);

export const isStaffRole = (role) => STAFF_ROLES.has(role);

const uploadMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

function contact(role) {
  const staff = isStaffRole(role);
  return {
    id: 'contact',
    title: 'Contact us',
    blocks: [
      {
        type: 'p',
        parts: staff
          ? ['Something not working, or a question about a family or a schedule? Email ', mail(), '.']
          : ['Questions about lessons, scheduling or billing? Email ', mail(), '.'],
      },
      { type: 'actions', actions: [{ label: 'Email us', href: supportMailto('Portal question'), icon: 'envelope-simple', variant: 'primary' }] },
    ],
  };
}

function homework(role) {
  const parent = role === PARENT;
  const steps = parent
    ? [
      'Your child opens an assignment under Assignments and submits their own answer. You can see everything here, but only they can submit.',
      `They can write the answer in the portal or attach a file (PDF, JPG or PNG photo, or text file, up to ${uploadMb} MB). A photo of handwritten work is fine.`,
      `Each assignment can be submitted up to ${MAX_SUBMISSIONS} times, so a better answer can be sent again.`,
      'An AI assistant drafts a grade and feedback. Their tutor checks every grade before anyone sees it, and may change it.',
      ['Once the tutor releases it, the score and feedback appear under ', link('Graded', '#/assignments/graded'), '. Until then the assignment shows as In review.'],
    ]
    : [
      ['Open an assignment from ', link('Assignments', '#/assignments/todo'), '.'],
      `Choose Write your answer to type it in the portal, or attach a file (PDF, JPG or PNG photo, or text file, up to ${uploadMb} MB). A photo of handwritten work is fine.`,
      `Choose Submit work. You can submit up to ${MAX_SUBMISSIONS} times for each assignment, so you can improve your answer and send it again.`,
      'An AI assistant drafts a grade and feedback. Your tutor checks every grade before you see it, and may change it.',
      ['Once your tutor releases it, the score and feedback appear under ', link('Graded', '#/assignments/graded'), '. Until then the assignment shows as In review.'],
    ];
  return { id: 'homework', title: 'How homework works', blocks: [{ type: 'steps', items: steps }] };
}

function schedule(role) {
  const parent = role === PARENT;
  const notice = parent
    ? 'Need to reschedule or cancel a lesson? Tell your child’s tutor or email us. There is no charge for cancelling.'
    : 'Need to reschedule or cancel a lesson? Tell your tutor or email us. There is no charge for cancelling.';
  const items = [
    [parent ? 'Your child’s lessons are on the ' : 'Your lessons are on the ', link('Calendar', '#/calendar'), '. Open one for the time, the place or meeting link, and the tutor’s notes once the lesson has happened.'],
    'When a lesson moves or is cancelled, Calendar shows a New marker until you have looked.',
    parent
      ? 'Google Calendar invites are for students. Your child can turn them on from the Calendar page when they sign in.'
      : 'To get lessons in your own calendar, choose Get Google Calendar invites on Calendar (or on Overview, under Your tutors) and sign in with Google. Google then sends you invitations and updates for your lessons. Only your email address is shared with us, never your calendar. Choose Stop invites any time.',
  ];
  return {
    id: 'schedule',
    title: parent ? 'Your child’s schedule' : 'Your schedule',
    blocks: [{ type: 'list', items }, { type: 'p', parts: [notice] }],
  };
}

const notes = {
  id: 'notes',
  title: 'After each lesson',
  blocks: [{
    type: 'list',
    items: [
      'Open the lesson from Calendar or Today and choose Write session notes. Add attendance and a short recap.',
      'The family reads your notes, so keep them clear and kind. You can edit them later.',
      ['To post an update to a family, open ', link('Students', '#/students'), ', choose a student, then Updates.'],
    ],
  }],
};

const grading = {
  id: 'grading',
  title: 'Grading and the review queue',
  blocks: [{
    type: 'list',
    items: [
      [link('Review queue', '#/review'), ' lists submissions the AI has graded, oldest first. Work it could not grade is there too, marked Could not grade.'],
      'Open one, check the score and feedback, edit them if you like, then choose Release to family. Save draft keeps your edits private.',
      'Students and families see nothing until you release. If you release by mistake, Edit or unrelease takes it back.',
    ],
  }],
};

const googleSync = {
  id: 'google',
  title: 'Google Calendar sync',
  blocks: [{
    type: 'list',
    items: [
      ['On ', link('Calendar', '#/calendar?scope=all'), ', turn on the Google Calendar switch and sign in with Google.'],
      'Your lessons then sync both ways with a calendar called VP Education sessions. A move or cancellation in either place updates the other.',
      'Your own Google events show beside your lessons (private ones as Busy), and a new lesson warns you if it overlaps one.',
      'If the switch says Reconnect needed, choose Reconnect Google Calendar. The menu beside the switch has Sync now and Disconnect.',
    ],
  }],
};

const keyboard = {
  id: 'keyboard',
  title: 'Keyboard tips',
  blocks: [{
    type: 'list',
    items: [
      'On the month calendar, the arrow keys move between days. Home and End jump to the start and end of the week, Page Up and Page Down change the month, and Shift with them changes the year.',
      'On a computer you can drag a lesson to move it. Press Escape while dragging to cancel. On a phone or tablet, use Edit.',
      'In a form, Enter in a single-line field saves. Escape closes a drawer or dialog.',
    ],
  }],
};

const adminTips = {
  id: 'admin',
  title: 'For admins',
  blocks: [{
    type: 'list',
    items: [
      'People is where you approve people waiting for access, change roles, and add students or parents who do not have an account yet.',
      'Account shows billing and payroll, worked out from the sessions on the calendar.',
    ],
  }],
};

const install = {
  id: 'install',
  title: 'Add the portal to your home screen',
  blocks: [{
    type: 'list',
    items: [
      'iPhone or iPad (Safari): tap Share, then Add to Home Screen.',
      'Android (Chrome): open the menu, then Add to Home screen.',
    ],
  }],
};

const privacy = {
  id: 'privacy',
  title: 'Privacy',
  blocks: [
    { type: 'p', parts: ['Our privacy policy explains what information we collect on the website and in the portal, how we use it, and the choices you have.'] },
    { type: 'actions', actions: [{ label: 'Read the privacy policy', href: PRIVACY_PATH, icon: 'arrow-square-out', variant: 'secondary' }] },
  ],
};

// The sections for a role, in reading order
export function helpSections(role) {
  if (isStaffRole(role)) {
    return [
      contact(role), notes, grading, googleSync, keyboard,
      ...(role === 'admin' ? [adminTips] : []),
      install, privacy,
    ];
  }
  const family = role === PARENT ? PARENT : STUDENT;
  return [contact(family), homework(family), schedule(family), install, privacy];
}

// The lede under the Help title
export function helpLede(role) {
  if (isStaffRole(role)) return 'Quick tips for tutors and admins, and how to reach us.';
  if (role === PARENT) return 'How the portal works for your family, and how to reach us.';
  return 'How the portal works, and how to reach us.';
}

// A sentence as plain text: links become their text. For tests and announcements.
export function partsText(parts) {
  return [].concat(parts ?? []).map((p) => (typeof p === 'string' ? p : p.text)).join('');
}
