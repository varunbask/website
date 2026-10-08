// Profile (#/profile). One page, three uses:
//   student  their own photo and profile: grade, school, pronouns, hobbies and
//            interests, favorite subjects, goals and how they learn best
//   parent   the same for the child on screen (?child=), photo included
//   staff    a tutor's or the admin's own photo and the few lines families
//            read: about me, subjects I teach, school or university, hobbies
//
// The photo saves on its own (photo-upload.js): choosing a picture resizes it
// on the device, uploads it and switches the profile to it. The details save
// with the Save button. Neither redraws the page: the checklist, the photo and
// the nav dot update in place, so a half-typed form is never lost. Text typed
// and not saved is also kept here while the page is redrawn for another reason.

import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import { button, field, select, setFieldError, busy, errorCallout, initials, visuallyHidden } from '../ui.js';
import { displayName, firstName } from '../format.js';
import {
  STUDENT_FIELDS, STAFF_FIELDS, STUDENT_LIMITS, STAFF_LIMITS, LONG_FIELDS, GRADE_OPTIONS, OTHER_GRADE,
  gradeChoice, gradeValue, studentFieldText, staffFieldText, checkFields, fieldsDraft, fieldsChanged,
  profileProgress, progressText, profileKind,
} from '../profile-model.js';
import { PHOTO_STEPS } from '../photo-model.js';
import { loadStudentFields, saveStudentFields, loadStaffFields, saveStaffFields } from '../profile-data.js';
import { savePhoto, removePhoto, PhotoError } from '../photo-upload.js';
import { ensurePhotos, photoUrl, photoPath } from '../photos.js';
import { stepList } from '../profile-nudge.js';

// Typed and not saved, by person id: { values, grade: { choice, other } }
const drafts = new Map();

// Whose profile this page is, and how it speaks
function targetOf(ctx) {
  if (ctx.page === 'parent') {
    const child = ctx.scope?.student ?? null;
    return child ? { kind: 'student', person: child, own: false, first: firstName(child.full_name || displayName(child)) } : null;
  }
  const kind = profileKind(ctx.me.role);
  return { kind, person: ctx.me, own: true, first: firstName(ctx.me.full_name || displayName(ctx.me)) };
}

function headerText({ kind, own, first }) {
  if (kind === 'staff') {
    return { title: 'Your profile', lede: 'Families of the students you teach see your photo and these details.' };
  }
  if (own) return { title: 'Your profile', lede: 'Your tutors read this to get to know you. Change it any time.' };
  return { title: `${first}’s profile`, lede: `${first}’s tutors read this to get to know ${first}. ${first} can change it too.` };
}

function progressTitle({ kind, own, first }, complete) {
  if (kind === 'staff') return complete ? 'Your tutor profile is ready' : 'Finish your tutor profile';
  if (own) return complete ? 'Your profile is ready' : 'Finish your profile';
  return complete ? `${first}’s profile is ready` : `Finish ${first}’s profile`;
}

function photoNote({ kind, own, first }) {
  const after = 'Photos are stored privately, made smaller, and location data is removed before they are saved.';
  if (kind === 'staff') return `Students and families you teach, other staff and the admin see your photo. ${after}`;
  if (own) return `You, your parents, your tutors and the admin see your photo. ${after}`;
  return `${first}, you, ${first}’s tutors and the admin see this photo. ${after}`;
}

function cardHead(titleId, title, iconName, ...after) {
  return h('div', { class: 'card-head' },
    h('h2', { class: 'card-title', id: titleId }, icon(iconName), h('span', {}, title)),
    ...after);
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

// A textarea with a quiet "n of max" under it
function counted(textarea, max) {
  const count = h('p', { class: 'prf-count num', 'aria-hidden': 'true' });
  const update = () => {
    count.textContent = `${Array.from(textarea.value).length} of ${max}`;
  };
  textarea.addEventListener('input', update);
  update();
  return h('div', { class: 'prf-area' }, textarea, count);
}

function loading() {
  return h('div', { class: 'prf-grid', 'aria-busy': 'true' },
    h('div', { class: 'card prf-sk', 'aria-hidden': 'true' },
      h('span', { class: 'skeleton prf-sk-photo' }),
      h('span', { class: 'skeleton prf-sk-line' })),
    h('div', { class: 'card prf-sk', 'aria-hidden': 'true' },
      h('span', { class: 'skeleton prf-sk-line' }),
      h('span', { class: 'skeleton prf-sk-line' }),
      h('span', { class: 'skeleton prf-sk-line is-short' })),
    visuallyHidden('Loading…'));
}

export async function mount(ctx) {
  const target = targetOf(ctx);
  if (!target) return;
  const { kind, person } = target;
  const name = displayName(person);
  const head = headerText(target);
  ctx.setHeader({ title: head.title, lede: head.lede, docTitle: head.title });
  const body = loading();
  ctx.host.append(body);

  let saved;
  try {
    [saved] = await Promise.all([
      kind === 'staff' ? loadStaffFields(person.id) : loadStudentFields(person.id),
      ensurePhotos([person.id]),
    ]);
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    body.replaceWith(errorCallout({
      title: 'We couldn’t load the profile.',
      text: 'Check your connection and try again.',
      onRetry: () => ctx.store.invalidateProfile(),
    }));
    ctx.announce(`${head.title}, could not load`);
    return;
  }
  if (!ctx.alive()) return;

  let avatarPath = photoPath(person.id) ?? null;

  // The checklist at the top, repainted after each save
  const progressHost = h('section', { class: 'card prf-progress', 'aria-labelledby': uid('prf-progress') });
  const progressTitleId = progressHost.getAttribute('aria-labelledby');
  function paintProgress() {
    const progress = profileProgress(kind, { profile: saved, avatarPath });
    progressHost.classList.toggle('is-complete', progress.complete);
    progressHost.replaceChildren(...[
      h('div', { class: 'card-head' },
        h('h2', { class: 'card-title', id: progressTitleId },
          icon(progress.complete ? 'check-circle' : 'user'),
          h('span', {}, progressTitle(target, progress.complete))),
        h('span', { class: 'card-meta num' }, progressText(progress))),
      progress.complete && kind === 'student' && !target.own
        ? h('p', { class: 'prf-progress-text' }, `Thank you. ${target.first}’s tutors can see this now.`)
        : null,
      progress.complete && (kind === 'staff' || target.own)
        ? h('p', { class: 'prf-progress-text' }, kind === 'staff' ? 'Families can see this now. Thank you.' : 'Thank you. Your tutors can see this now.')
        : null,
      stepList(progress),
    ].filter(Boolean));
  }
  paintProgress();

  // Saves made here: the nav dot and the Overview cards follow without a redraw
  const afterSave = () => {
    ctx.store.invalidateProfile({ quiet: true });
    ctx.refreshNav();
    paintProgress();
  };

  const photo = photoCard(ctx, target, name, {
    onChange(path) {
      avatarPath = path;
      afterSave();
    },
  });
  const details = detailsCard(ctx, target, saved, {
    onSaved(row) {
      saved = row;
      afterSave();
    },
  });

  // Wide screens: the checklist and the photo beside the form; phones: one column
  body.replaceWith(h('div', { class: 'prf-grid' }, h('div', { class: 'prf-side' }, progressHost, photo), details));
  ctx.announce(head.title);
}

// ---------------------------------------------------------------------------
// Photo

function photoCard(ctx, target, name, { onChange }) {
  const { person, own, first } = target;
  const titleId = uid('prf-photo');
  const alt = own ? 'Your profile photo' : `${first}’s profile photo`;
  const preview = h('div', { class: 'prf-photo' });
  const status = h('p', { class: 'prf-photo-status', role: 'status', 'aria-live': 'polite' });
  const errorSlot = h('div', { class: 'prf-photo-error' });

  function paintPreview() {
    const url = photoUrl(person.id);
    if (url) {
      const img = h('img', { src: url, alt, width: '112', height: '112', decoding: 'async' });
      img.addEventListener('error', () => {
        preview.replaceChildren(h('span', { class: 'prf-initials', 'aria-hidden': 'true' }, initials(name)), visuallyHidden(alt));
      }, { once: true });
      preview.replaceChildren(img);
    } else {
      preview.replaceChildren(
        h('span', { class: 'prf-initials', 'aria-hidden': 'true' }, initials(name)),
        visuallyHidden(own ? 'No photo yet' : `No photo of ${first} yet`));
    }
  }
  paintPreview();

  // The file picker: visually hidden, out of the tab order, opened by the button
  const inputId = uid('prf-file');
  const input = h('input', { type: 'file', accept: 'image/*', id: inputId, class: 'visually-hidden', tabindex: '-1' });
  const label = h('label', { class: 'visually-hidden', for: inputId }, own ? 'Choose a profile photo' : `Choose a profile photo for ${first}`);
  const hasPhoto = () => Boolean(photoPath(person.id));
  const choose = button({
    label: hasPhoto() ? 'Change photo' : 'Add a photo',
    variant: hasPhoto() ? 'secondary' : 'primary',
    icon: 'image-square',
    focusKey: 'prf-choose',
    onClick: () => input.click(),
  });
  const remove = button({
    label: 'Remove photo',
    variant: 'danger-ghost',
    icon: 'trash',
    focusKey: 'prf-remove',
    onClick: () => removeNow(),
  });

  function paintButtons() {
    const has = hasPhoto();
    choose.querySelector('.btn-label').textContent = has ? 'Change photo' : 'Add a photo';
    choose.className = choose.className.replace(/btn-(primary|secondary)/, has ? 'btn-secondary' : 'btn-primary');
    remove.hidden = !has;
  }
  paintButtons();

  let working = false;
  function setWorking(on) {
    working = on;
    choose.disabled = on;
    remove.disabled = on;
    choose.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  function showError(error) {
    console.error(error);
    const text = error instanceof PhotoError
      ? error.message
      : 'We couldn’t save the photo. Check your connection and try again.';
    errorSlot.replaceChildren(dangerCallout('The photo was not saved.', text));
    status.textContent = '';
  }

  input.addEventListener('change', async () => {
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file || working) return;
    errorSlot.replaceChildren();
    setWorking(true);
    try {
      const path = await savePhoto(person.id, file, { onStep: (step) => { status.textContent = PHOTO_STEPS[step] ?? ''; } });
      if (!ctx.alive()) return;
      status.textContent = 'Photo saved.';
      paintPreview();
      paintButtons();
      onChange(path);
      ctx.toast({ text: own ? 'Your photo is saved.' : `${first}’s photo is saved.` });
    } catch (error) {
      if (!ctx.alive()) return;
      showError(error);
    } finally {
      setWorking(false);
      if (choose.isConnected && (!document.activeElement || document.activeElement === document.body)) choose.focus();
    }
  });

  async function removeNow() {
    if (working) return;
    const ok = await ctx.confirm({
      title: 'Remove this photo?',
      body: own ? 'Your initials show in its place. You can add a new photo any time.' : `${first}’s initials show in its place. You can add a new photo any time.`,
      confirmLabel: 'Remove photo',
    });
    if (!ok) return;
    errorSlot.replaceChildren();
    setWorking(true);
    status.textContent = PHOTO_STEPS.removing;
    try {
      await removePhoto(person.id);
      if (!ctx.alive()) return;
      status.textContent = 'Photo removed.';
      paintPreview();
      paintButtons();
      onChange(null);
      choose.focus();
    } catch (error) {
      if (!ctx.alive()) return;
      console.error(error);
      errorSlot.replaceChildren(dangerCallout('The photo was not removed.', 'Check your connection and try again.'));
      status.textContent = '';
    } finally {
      setWorking(false);
    }
  }

  return h('section', { class: 'card prf-photo-card', 'aria-labelledby': titleId },
    cardHead(titleId, 'Photo', 'image-square'),
    h('div', { class: 'prf-photo-row' },
      preview,
      h('div', { class: 'prf-photo-side' },
        h('div', { class: 'prf-photo-actions' }, choose, remove, label, input),
        status)),
    errorSlot,
    h('p', { class: 'prf-photo-note' }, icon('lock-simple', { size: 14 }), h('span', {}, photoNote(target))));
}

// ---------------------------------------------------------------------------
// Details

function detailsCard(ctx, target, saved, { onSaved }) {
  const { kind, person, own, first } = target;
  const parent = !own && kind === 'student';
  const fields = kind === 'staff' ? STAFF_FIELDS : STUDENT_FIELDS;
  const limits = kind === 'staff' ? STAFF_LIMITS : STUDENT_LIMITS;
  const words = (key) => (kind === 'staff' ? staffFieldText(key) : studentFieldText(key, { parent, first }));
  const key = String(person.id);
  const draft = drafts.get(key);
  let row = saved;
  const start = draft?.values ?? fieldsDraft(kind, row);
  const titleId = uid('prf-details');
  const formId = uid('prf-form');

  const controls = {};
  const wraps = {};
  let gradeSelect = null;
  let gradeOther = null;
  let otherWrap = null;

  for (const name of fields) {
    const text = words(name);
    if (kind === 'student' && name === 'grade_level') {
      const choice = draft?.grade ?? gradeChoice(row?.grade_level);
      const wrap = select({
        name: 'grade_level',
        options: [{ value: '', label: 'Choose a grade' }, ...GRADE_OPTIONS.map((o) => ({ value: o, label: o }))],
        value: choice.choice,
      });
      gradeSelect = wrap.querySelector('select');
      gradeSelect.dataset.focusKey = 'prf-grade_level';
      wraps[name] = field({ label: text.label, control: wrap });
      gradeOther = h('input', {
        type: 'text', class: 'input', name: 'grade_other', maxlength: String(limits.grade_level), autocomplete: 'off',
        placeholder: 'Homeschool, gap year', value: choice.other, dataset: { focusKey: 'prf-grade_other' },
      });
      otherWrap = field({ label: own ? 'Your grade' : `${first}’s grade`, optional: true, control: gradeOther });
      otherWrap.hidden = choice.choice !== OTHER_GRADE;
      gradeSelect.addEventListener('change', () => {
        otherWrap.hidden = gradeSelect.value !== OTHER_GRADE;
        if (!otherWrap.hidden) gradeOther.focus();
        remember();
      });
      gradeOther.addEventListener('input', remember);
      continue;
    }
    const long = LONG_FIELDS.has(name);
    const control = long
      ? h('textarea', {
        class: 'input textarea', name, rows: name === 'bio' ? '5' : '3', maxlength: String(limits[name]),
        placeholder: text.placeholder || undefined, dataset: { focusKey: `prf-${name}` },
      }, start[name] ?? '')
      : h('input', {
        type: 'text', class: 'input', name, maxlength: String(limits[name]), autocomplete: 'off',
        placeholder: text.placeholder || undefined, value: start[name] ?? '', dataset: { focusKey: `prf-${name}` },
      });
    controls[name] = control;
    wraps[name] = field({ label: text.label, hint: text.hint || undefined, optional: text.optional, control: long ? counted(control, limits[name]) : control });
    control.addEventListener('input', () => {
      setFieldError(wraps[name], '');
      remember();
    });
  }

  // The form shows what was saved (trimmed, spacing tidied)
  function fill(saved) {
    for (const name of fields) {
      if (name === 'grade_level' && gradeSelect) {
        const choice = gradeChoice(saved?.grade_level);
        gradeSelect.value = choice.choice;
        gradeOther.value = choice.other;
        otherWrap.hidden = choice.choice !== OTHER_GRADE;
        continue;
      }
      const control = controls[name];
      const value = saved?.[name] ?? '';
      if (control.value !== value) {
        control.value = value;
        control.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    drafts.delete(key);
  }

  function current() {
    const raw = {};
    for (const name of fields) {
      if (name === 'grade_level' && gradeSelect) raw[name] = gradeValue(gradeSelect.value, gradeOther.value) ?? '';
      else raw[name] = controls[name].value;
    }
    return raw;
  }

  // What was typed, kept until it is saved
  function remember() {
    drafts.set(key, {
      values: current(),
      grade: gradeSelect ? { choice: gradeSelect.value, other: gradeOther.value } : null,
    });
  }

  const errorSlot = h('div', { class: 'prf-form-errors' });
  const save = button({ label: 'Save profile', variant: 'primary', type: 'submit', focusKey: 'prf-save' });
  const savedNote = h('p', { class: 'prf-saved', role: 'status', 'aria-live': 'polite' });
  const order = kind === 'student'
    ? [wraps.grade_level, otherWrap, wraps.school, wraps.pronouns, wraps.interests, wraps.favorite_subjects, wraps.goals, wraps.learning_style]
    : fields.map((n) => wraps[n]);
  const form = h('form', { class: 'prf-form', id: formId, novalidate: true },
    ...order,
    errorSlot,
    h('div', { class: 'prf-form-foot' }, save, savedNote));

  // Enter in a one-line field saves (a textarea keeps its new lines)
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
    savedNote.textContent = '';
    const { values, errors } = checkFields(kind, current());
    let firstInvalid = null;
    for (const name of fields) {
      if (!controls[name]) continue;
      setFieldError(wraps[name], errors[name] ?? '');
      if (errors[name]) firstInvalid ??= controls[name];
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }
    if (!fieldsChanged(kind, row, values)) {
      drafts.delete(key);
      savedNote.textContent = 'Nothing new to save.';
      return;
    }
    saving = true;
    try {
      await busy(save, 'Saving…', async () => {
        try {
          const next = kind === 'staff' ? await saveStaffFields(person.id, values) : await saveStudentFields(person.id, values);
          row = next ?? { ...(row ?? {}), ...values };
          drafts.delete(key);
          if (!ctx.alive()) return;
          fill(row);
          savedNote.textContent = 'Saved.';
          onSaved(row);
          ctx.toast({ text: own ? 'Your profile is saved.' : `${first}’s profile is saved.` });
        } catch (error) {
          console.error(error);
          if (!ctx.alive()) return;
          errorSlot.append(dangerCallout('We couldn’t save the profile.', 'Check your connection and try again.'));
          errorSlot.scrollIntoView?.({ block: 'nearest' });
        }
      });
    } finally {
      saving = false;
    }
  });

  const title = own ? 'About you' : `About ${first}`;
  return h('section', { class: 'card prf-details', 'aria-labelledby': titleId },
    cardHead(titleId, title, 'identification-badge'),
    form);
}
