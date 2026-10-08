// "Finish your profile": the friendly card at the top of the student and parent
// Overview and the staff Today page while a profile is not finished, and the
// checklist it shares with the Profile page.
//
//   loadNudge(ctx, { kind, person }) -> Promise<status | null>
//       the person's profile status from the store (never rejects: a failure
//       just means no card)
//   profileNudge(ctx, { kind, person, status, parent }) -> section | null
//       null once the profile is complete (or when it could not load)
//   stepList(progress) -> ul.prf-steps
//
// profile-model.js decides what counts as finished; the Profile page is where
// it is filled in.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button } from './ui.js';
import { displayName, firstName } from './format.js';
import { profileProgress, progressText, nudgeCopy, PROFILE_HREF } from './profile-model.js';
import { personAvatar } from './photos.js';

export async function loadNudge(ctx, { kind, person }) {
  if (!person?.id) return null;
  try {
    return await ctx.store.getProfileStatus(kind, person.id);
  } catch (error) {
    console.error(error);
    return null;
  }
}

// Each step with a tick or an empty circle; the photo is marked Optional
export function stepList(progress, { label = 'Profile steps' } = {}) {
  return h('ul', { class: 'prf-steps', 'aria-label': label }, progress.steps.map((step) => {
    const glyph = icon(step.done ? 'check-circle' : 'circle', { size: 16 });
    glyph.classList.add('prf-step-icon');
    return h('li', { class: step.done ? 'prf-step is-done' : 'prf-step' },
      glyph,
      h('span', { class: 'prf-step-label' }, step.label),
      step.required ? null : h('span', { class: 'prf-step-tag' }, 'Optional'),
      h('span', { class: 'visually-hidden' }, step.done ? ', done' : ', to do'));
  }));
}

export function profileNudge(ctx, { kind, person, status, parent = false, className = 'span-12' }) {
  if (!status || !person) return null;
  const progress = profileProgress(kind, status);
  if (progress.complete) return null;
  const name = displayName(person);
  const copy = nudgeCopy(kind, { parent, first: firstName(person.full_name || name) });
  const titleId = uid('prf-nudge');
  return h('section', { class: ['card', 'prf-nudge', className].filter(Boolean).join(' '), 'aria-labelledby': titleId },
    h('div', { class: 'prf-nudge-lead' }, personAvatar(person.id, name, { size: 40, staff: kind === 'staff' })),
    h('div', { class: 'prf-nudge-main' },
      h('h2', { class: 'prf-nudge-title', id: titleId }, copy.title),
      h('p', { class: 'prf-nudge-text' }, copy.text),
      stepList(progress)),
    h('div', { class: 'prf-nudge-side' },
      h('p', { class: 'prf-nudge-count num' }, progressText(progress)),
      button({ label: copy.action, variant: 'primary', iconEnd: 'caret-right', href: PROFILE_HREF, focusKey: 'profile-nudge' })));
}
