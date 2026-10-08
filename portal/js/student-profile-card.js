// The student profile on the Overview.
//
//   staffProfileCards(ctx, student, loaded)  [Profile card, Staff notes card] for
//       the staff Overview. `loaded` is loadStaffProfile() (student-profile-data.js),
//       awaited by the view next to its own data, so a refresh never flashes a
//       skeleton. Each card shows its own error with a retry; one failing never
//       blanks the page or the other card.
//   familyAboutCard(ctx, student)            a small read-only About card for a
//       student or parent: the student's photo and every profile field but the
//       learning notes, read through family_profile() (families cannot read the
//       table, which holds the learning notes), with an Edit link to #/profile.
//       It stays hidden until the profile loads, and for good when there is
//       nothing to show.
//
// The Profile card's Edit button opens the drawer (open=profile,
// student-profile-drawer.js). While the student's own profile is not finished
// (profile-model.js), the card says so, with what is missing, so a tutor can
// nudge them. Notes are added and deleted in place.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, iconButton, field, setFieldError, busy, pill } from './ui.js';
import { buildHash, DRAWER_PARAMS } from './router.js';
import { displayName, firstName } from './format.js';
import {
  LIMITS, PROFILE_DRAWER, NOTES_SHOWN, isBlankProfile, profileFacts, aboutFacts, subjectChips, updatedText, parentContacts,
  checkNote, sortNotes, notesWindow, authorName, canDeleteNote, sinceText,
} from './student-profile-model.js';
import { loadFamilyProfile, addNote, deleteNote } from './student-profile-data.js';
import { profileProgress, PROFILE_HREF } from './profile-model.js';
import { personAvatar, photoPath } from './photos.js';

// A note typed but not saved, kept while the view refreshes (a store change or
// coming back to the tab re-renders the page); studentId -> text
const drafts = new Map();

// The current route with the drawer opened on the profile editor
export function profileHref(route) {
  const params = { ...(route?.params ?? {}) };
  for (const key of DRAWER_PARAMS) delete params[key];
  return buildHash({
    view: route?.view ?? 'overview',
    sub: route?.sub ?? null,
    id: route?.id ?? null,
    params: { ...params, open: PROFILE_DRAWER },
  });
}

// ---------------------------------------------------------------------------
// Small pieces

function head(titleId, title, iconName, ...after) {
  return h('div', { class: 'card-head' },
    h('h2', { class: 'card-title', id: titleId }, icon(iconName), h('span', {}, title)),
    ...after);
}

// The same quiet in-card lines the other Overview cards use (overview.css)
function quietEmpty(text, iconName) {
  return h('div', { class: 'ovw-card-empty' },
    h('span', { class: 'ovw-card-empty-icon' }, icon(iconName)),
    h('p', {}, text));
}

function quietError(text, onRetry) {
  return h('div', { class: 'ovw-card-empty ovw-card-error', role: 'alert' },
    h('span', { class: 'ovw-card-empty-icon' }, icon('warning-circle')),
    h('p', {}, text),
    button({ label: 'Try again', size: 'sm', variant: 'ghost', icon: 'arrow-counter-clockwise', onClick: onRetry }));
}

// What the "Profile not filled in" line calls each missing field
const DUE_WORDS = { grade_level: 'grade', school: 'school', interests: 'hobbies' };

// "grade, school and hobbies"
function listText(items) {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

// One labelled fact: dt over dd. A missing value reads "Not added".
function fact({ label, value, long = false, node = null }) {
  const body = node ?? (value === null || value === undefined
    ? h('span', { class: 'sp-empty' }, 'Not added')
    : value);
  return h('div', { class: long ? 'sp-fact is-long' : 'sp-fact' }, h('dt', {}, label), h('dd', { class: long ? 'sp-text' : null }, body));
}

// ---------------------------------------------------------------------------
// Staff: Profile

function subjectsNode(chips) {
  return h('ul', { class: 'sp-subjects', 'aria-label': 'Subjects' }, chips.map((c) => h('li', {
    class: `ovw-subj ${c.tone}`,
    title: c.tutors.length ? `Taught by ${c.tutors.join(', ')}` : undefined,
  }, c.subject)));
}

function parentsPart(ctx, studentId, parents) {
  const part = h('div', { class: 'sp-parents' }, h('h3', { class: 'sp-sub' }, 'Parents'));
  if (!parents.ok) {
    part.append(quietError('We couldn’t load the parents.', () => ctx.store.invalidate(studentId)));
    return part;
  }
  const list = parentContacts(parents.data);
  if (!list.length) {
    part.append(h('p', { class: 'sp-quiet' }, 'No parent is linked yet. The admin links parents on the People page.'));
    return part;
  }
  part.append(h('ul', { class: 'sp-parent-list', 'aria-label': 'Parents' }, list.map((p) => h('li', { class: 'sp-parent' },
    h('span', { class: 'sp-parent-name' }, p.name),
    h('span', { class: 'sp-parent-links' },
      p.mailto ? h('a', { class: 'link', href: p.mailto }, p.email) : (p.email ? h('span', {}, p.email) : null),
      p.phone ? (p.tel ? h('a', { class: 'link num', href: p.tel }, p.phone) : h('span', { class: 'num' }, p.phone)) : null,
      !p.email && !p.phone ? h('span', { class: 'sp-quiet' }, 'No contact details yet') : null)))));
  return part;
}

function profileCard(ctx, student, { profile, parents, tutors, names }) {
  const titleId = uid('sp-profile');
  const first = firstName(displayName(student));
  const card = h('section', { class: 'card sp-card sp-profile span-7', 'aria-labelledby': titleId });
  const row = profile.ok ? profile.data : null;
  const blank = profile.ok && isBlankProfile(row);

  const edit = profile.ok
    ? button({
      label: blank ? 'Add profile' : 'Edit',
      variant: blank ? 'secondary' : 'ghost',
      size: 'sm',
      icon: 'pencil-simple',
      href: profileHref(ctx.route),
      ariaLabel: `${blank ? 'Add' : 'Edit'} profile for ${first}`,
      focusKey: `row-${PROFILE_DRAWER}`,
      className: 'sp-edit',
    })
    : null;
  // Not finished by the family yet (grade, school, hobbies): say so, and what is missing
  const progress = profile.ok ? profileProgress('student', { profile: row, avatarPath: photoPath(student.id) }) : null;
  const due = progress && !progress.complete;
  card.append(head(titleId, 'Profile', 'identification-badge',
    due ? pill({ label: 'Profile not filled in', tone: 'warning', icon: 'info' }) : null,
    edit));
  if (due) {
    const missing = progress.steps.filter((s) => s.required && !s.done).map((s) => DUE_WORDS[s.key] ?? s.label.toLowerCase());
    card.append(h('div', { class: 'sp-due' },
      personAvatar(student.id, displayName(student), { size: 40 }),
      h('p', { class: 'sp-due-text' },
        `Still to add: ${listText(missing)}. Ask ${first} or a parent to finish it on their Profile page, or add it here.`)));
  }

  if (!profile.ok) {
    card.append(quietError('We couldn’t load the profile.', () => ctx.store.invalidate(student.id)));
  } else {
    if (blank && !due) {
      card.append(quietEmpty(`Add ${first}’s grade, school and goals so every tutor knows who they are teaching.`, 'identification-badge'));
    }
    const chips = tutors.ok ? subjectChips(tutors.data, names) : [];
    const subjects = () => fact({ label: 'Subjects', long: true, node: subjectsNode(chips) });
    const rows = [];
    // An empty profile is the one line above, not four "Not added" rows
    if (!blank) {
      for (const f of profileFacts(row)) {
        rows.push(fact(f));
        if (f.key === 'school' && chips.length) rows.push(subjects());
      }
    } else if (chips.length) {
      rows.push(subjects());
    }
    if (rows.length) card.append(h('dl', { class: 'sp-facts' }, rows));
  }

  card.append(parentsPart(ctx, student.id, parents));

  // The family fills in their part too: "Updated by Maya" or "by Grace", not "by Staff"
  const editors = new Map(names ?? []);
  editors.set(String(student.id), displayName(student));
  for (const p of parents.ok ? parents.data ?? [] : []) if (p.full_name) editors.set(String(p.parent_id), p.full_name);
  const updated = profile.ok && row ? updatedText(row, editors, ctx.now) : null;
  if (updated) card.append(h('div', { class: 'card-foot sp-foot' }, h('p', { class: 'sp-updated' }, updated)));
  return card;
}

// ---------------------------------------------------------------------------
// Staff: notes

function notesCard(ctx, student, { notes, names }) {
  const titleId = uid('sp-notes');
  const first = firstName(displayName(student));
  const key = String(student.id);
  const card = h('section', { class: 'card sp-card sp-notes span-5', 'aria-labelledby': titleId },
    head(titleId, 'Staff notes', 'note-pencil',
      h('span', { class: 'card-meta sp-lock' }, icon('lock-simple', { size: 14 }), h('span', {}, 'Staff only'))));
  if (!notes.ok) {
    card.append(quietError('We couldn’t load the notes.', () => ctx.store.invalidate(student.id)));
    return card;
  }

  let list = sortNotes(notes.data);
  let showAll = false;

  // Add a note
  const input = h('textarea', {
    class: 'input textarea sp-note-input',
    name: 'note',
    rows: '3',
    maxlength: String(LIMITS.note),
    placeholder: 'What worked, what to try next',
    dataset: { focusKey: 'staff-note' },
  }, drafts.get(key) ?? '');
  const noteField = field({
    label: 'Add a note',
    hint: `Tutors and the admin see these. ${first}’s family never does.`,
    control: input,
  });
  const save = button({ label: 'Save note', variant: 'primary', size: 'sm', type: 'submit' });
  const form = h('form', { class: 'sp-note-form', novalidate: true }, noteField, h('div', { class: 'sp-note-actions' }, save));

  input.addEventListener('input', () => {
    if (input.value.trim()) drafts.set(key, input.value);
    else drafts.delete(key);
    if (noteField.querySelector('.field-error')) setFieldError(noteField, '');
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  let saving = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    const { value, error } = checkNote(input.value);
    setFieldError(noteField, error);
    if (error) {
      input.focus();
      return;
    }
    saving = true;
    try {
      await busy(save, 'Saving…', async () => {
        try {
          const row = await addNote(student.id, value);
          list = [row, ...list];
          drafts.delete(key);
          input.value = '';
          paint();
          ctx.toast({ text: 'Note added.' });
        } catch (err) {
          console.error(err);
          setFieldError(noteField, 'We couldn’t save this note. Check your connection and try again.');
        }
      });
    } finally {
      saving = false;
    }
  });

  // The list
  const listHost = h('div', { class: 'sp-note-host' });

  async function remove(note, trigger) {
    const ok = await ctx.confirm({
      title: 'Delete this note?',
      body: `Every tutor of ${first} loses it. This cannot be undone.`,
      confirmLabel: 'Delete note',
    });
    if (!ok) return;
    trigger.disabled = true;
    try {
      await deleteNote(note.id);
    } catch (err) {
      console.error(err);
      trigger.disabled = false;
      ctx.toast({ text: 'We couldn’t delete that note. Try again.' });
      return;
    }
    list = list.filter((n) => String(n.id) !== String(note.id));
    paint();
    ctx.toast({ text: 'Note deleted.' });
    input.focus();
  }

  function noteItem(note) {
    const by = authorName(note.author_id, names);
    const when = sinceText(note.created_at, ctx.now);
    const del = canDeleteNote(note, ctx.me)
      ? iconButton({
        icon: 'trash',
        label: `Delete note by ${by}, ${when.text}`,
        tip: 'left',
        className: 'sp-note-del',
        onClick: (e) => remove(note, e.currentTarget),
      })
      : null;
    return h('li', { class: 'sp-note', tabindex: '-1' },
      h('p', { class: 'sp-note-body' }, note.body),
      h('div', { class: 'sp-note-foot' },
        h('span', { class: 'sp-note-by' },
          h('span', { class: 'sp-note-author' }, by), ', ',
          h('time', { datetime: when.iso, title: when.full }, when.text)),
        del));
  }

  function paint() {
    const { shown, hidden } = notesWindow(list, { all: showAll });
    const nodes = [];
    nodes.push(list.length
      ? h('ul', { class: 'sp-note-list', 'aria-label': 'Staff notes' }, shown.map(noteItem))
      : quietEmpty(`No notes yet. Write down what works in a lesson or what to try next. Every tutor of ${first} can read them.`, 'note-pencil'));
    if (hidden) {
      nodes.push(button({
        label: `Show ${hidden} older ${hidden === 1 ? 'note' : 'notes'}`,
        variant: 'ghost',
        size: 'sm',
        className: 'sp-more',
        onClick: () => {
          showAll = true;
          paint();
          // The button is gone: land on the first note that was hidden
          listHost.querySelectorAll('.sp-note')[NOTES_SHOWN]?.focus();
        },
      }));
    }
    listHost.replaceChildren(...nodes);
  }
  paint();

  card.append(form, listHost);
  return card;
}

// loaded: loadStaffProfile() result for this student
export function staffProfileCards(ctx, student, loaded) {
  return [profileCard(ctx, student, loaded), notesCard(ctx, student, loaded)];
}

// ---------------------------------------------------------------------------
// Family: About

export function familyAboutCard(ctx, student) {
  const card = h('section', { class: 'card sp-card sp-about span-12', hidden: true });
  loadFamilyProfile(student.id).then((row) => {
    if (!ctx.alive()) return;
    const facts = aboutFacts(row);
    if (!facts.length) return;
    const titleId = uid('sp-about');
    const name = displayName(student);
    const first = firstName(name);
    const own = ctx.me?.role === 'student';
    card.setAttribute('aria-labelledby', titleId);
    card.append(
      head(titleId, own ? 'About you' : `About ${first}`, 'identification-badge',
        h('a', { class: 'link card-link', href: PROFILE_HREF, 'aria-label': own ? 'Edit your profile' : `Edit ${first}’s profile` }, 'Edit')),
      h('div', { class: 'sp-about-body' },
        personAvatar(student.id, name, { size: 40 }),
        h('dl', { class: 'sp-facts' }, facts.map((f) => fact({ label: own && f.key === 'learning_style' ? 'How I learn best' : f.label, value: f.value, long: f.long })))));
    card.hidden = false;
  }).catch((error) => console.error(error));   // a quiet extra: no profile, no card
  return card;
}
