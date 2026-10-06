// The profile editor, shown in the drawer (open=profile on the staff Overview).
// Staff only: grade, school, goals and learning notes. The form keeps what was
// typed through any store change, and on save asks the Overview to reload.
//
// renderProfileDrawer(dctx) -> Promise

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, field, setFieldError, busy, emptyState, errorCallout } from './ui.js';
import { displayName, firstName } from './format.js';
import { LIMITS, PROFILE_FIELDS, checkProfile, profileDraft, profileChanged } from './student-profile-model.js';
import { loadProfile, saveProfile } from './student-profile-data.js';

function clearChrome(dctx) {
  dctx.header.replaceChildren();
  dctx.headerActions.replaceChildren();
  dctx.setFooter(null);
}

function paintMissing(dctx) {
  clearChrome(dctx);
  dctx.body.replaceChildren(
    h('h2', { class: 'drawer-title', tabindex: '-1' }, 'Not available'),
    emptyState({
      icon: 'info',
      text: 'The profile isn’t available here. Open a student you teach and try again.',
      action: { label: 'Close', onClick: () => dctx.close() },
    }),
  );
  dctx.setTitle('Not available');
}

function paintError(dctx, onRetry) {
  clearChrome(dctx);
  dctx.body.replaceChildren(
    h('h2', { class: 'drawer-title', tabindex: '-1' }, 'Profile'),
    errorCallout({ title: 'We couldn’t load the profile.', text: 'Check your connection and try again.', onRetry }),
  );
  dctx.setTitle('Profile');
}

function dangerCallout(title, text) {
  const glyph = icon('warning-circle', { size: 20 });
  glyph.classList.add('callout-icon');
  return h('div', { class: 'callout tone-danger', role: 'alert' },
    glyph,
    h('div', { class: 'callout-body' },
      h('p', { class: 'callout-title' }, title),
      text ? h('p', { class: 'callout-text' }, text) : null));
}

// A textarea with a quiet "n of max" under it, so a paste that is too long is
// never cut off without a word
function counted(textarea, max) {
  const count = h('p', { class: 'sp-count num', 'aria-hidden': 'true' });
  const update = () => {
    count.textContent = `${Array.from(textarea.value).length} of ${max}`;
  };
  textarea.addEventListener('input', update);
  update();
  return h('div', { class: 'sp-area' }, textarea, count);
}

export async function renderProfileDrawer(dctx) {
  const student = dctx.scope?.student ?? null;
  if (dctx.audience !== 'staff' || dctx.readOnly || !student) {
    paintMissing(dctx);
    return;
  }
  let row;
  try {
    row = await loadProfile(student.id);
  } catch (error) {
    if (!dctx.alive()) return;
    console.error(error);
    paintError(dctx, () => dctx.store.invalidate(student.id));
    return;
  }
  if (!dctx.alive()) return;
  // Keep what the tutor typed through any store change
  dctx.onRefresh(() => {});
  clearChrome(dctx);
  const form = profileForm(dctx, student, row);
  dctx.body.replaceChildren(form);
  dctx.setTitle(form.dataset.title);
}

function profileForm(dctx, student, row) {
  const formId = uid('profile-form');
  const name = displayName(student);
  const first = firstName(name);
  const draft = profileDraft(row);
  const title = row ? 'Edit profile' : 'Add profile';

  const grade = h('input', {
    type: 'text', class: 'input', name: 'grade_level', maxlength: String(LIMITS.grade_level), autocomplete: 'off',
    placeholder: '9th grade', value: draft.grade_level,
  });
  const school = h('input', {
    type: 'text', class: 'input', name: 'school', maxlength: String(LIMITS.school), autocomplete: 'off',
    placeholder: 'Arcadia High School', value: draft.school,
  });
  const goals = h('textarea', { class: 'input textarea', name: 'goals', rows: '4', maxlength: String(LIMITS.goals) }, draft.goals);
  const notes = h('textarea', { class: 'input textarea', name: 'learning_notes', rows: '5', maxlength: String(LIMITS.learning_notes) }, draft.learning_notes);

  const fields = {
    grade_level: field({ label: 'Grade', control: grade }),
    school: field({ label: 'School', control: school }),
    goals: field({
      label: 'Goals',
      hint: `What ${first} and the family want from tutoring. ${first} and the parents can read this.`,
      control: counted(goals, LIMITS.goals),
    }),
    learning_notes: field({
      label: 'Learning notes',
      hint: 'Accommodations, what works, what to avoid. Shown to tutors and the admin, not on the family pages.',
      control: counted(notes, LIMITS.learning_notes),
    }),
  };
  const inputs = { grade_level: grade, school, goals, learning_notes: notes };
  const errorSlot = h('div', { class: 'sp-form-errors' });

  const form = h('form', { class: 'sp-form', id: formId, novalidate: true },
    h('div', { class: 'sp-form-pair' }, fields.grade_level, fields.school),
    fields.goals, fields.learning_notes, errorSlot);
  const root = h('div', { class: 'sp-form-wrap', dataset: { title } },
    h('h2', { class: 'drawer-title', tabindex: '-1' }, title),
    h('p', { class: 'sp-form-lede' }, `For ${name}. Every tutor who teaches ${first} can see and change this.`),
    form);

  const save = button({ label: 'Save profile', variant: 'primary', type: 'submit', focusKey: 'save-profile' });
  save.setAttribute('form', formId);
  dctx.setFooter([button({ label: 'Cancel', variant: 'ghost', onClick: () => dctx.close() }), save]);

  for (const key of PROFILE_FIELDS) {
    inputs[key].addEventListener('input', () => setFieldError(fields[key], ''));
  }
  // Enter in a single-line field saves (a textarea keeps its new lines)
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    form.requestSubmit(save);
  });

  let saving = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    errorSlot.replaceChildren();
    const { values, errors } = checkProfile(Object.fromEntries(PROFILE_FIELDS.map((key) => [key, inputs[key].value])));
    let firstInvalid = null;
    for (const key of PROFILE_FIELDS) {
      setFieldError(fields[key], errors[key] ?? '');
      if (errors[key]) firstInvalid ??= inputs[key];
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }
    // Nothing changed (or nothing to create): there is nothing to save
    if (!profileChanged(row, values)) {
      dctx.close();
      return;
    }
    saving = true;
    try {
      await busy(save, 'Saving…', async () => {
        try {
          await saveProfile(student.id, values, { exists: Boolean(row) });
        } catch (error) {
          console.error(error);
          if (dctx.alive?.() === false) return;
          errorSlot.append(dangerCallout('We couldn’t save the profile.', 'Check your connection and try again.'));
          errorSlot.scrollIntoView?.({ block: 'nearest' });
          return;
        }
        // Saved: the Overview reloads the profile, even if the drawer has closed meanwhile
        dctx.store.invalidate(student.id);
        dctx.toast({ text: 'Profile saved.' });
        if (dctx.alive?.() !== false) dctx.close();
      });
    } finally {
      saving = false;
    }
  });

  return root;
}
