// Updates view, #/updates (spec 5.12). Families read the feed; staff also get
// a composer above it (focused with ?compose=1) and can delete their own
// updates (admins any). Opening the view marks updates seen for families (4.9).

import { h } from '../dom.js';
import { sb } from '../supabase.js';
import { button, busy, field, setFieldError, emptyState, errorCallout, visuallyHidden } from '../ui.js';
import { staffNames, updateItem, updateList } from '../updates-feed.js';
import { getSeen, markSeen, isNewSince } from '../seen.js';
import { firstName } from '../format.js';

const TITLES = { student: 'Notes from your tutor', parent: 'Updates from your tutor' };
const MAX_BODY = 10000;
const ENTRY_ITEMS = 8;
const POST_FAILED = 'We couldn’t post that update. Try again.';

// Unsent composer text per student. A refresh re-render (another tab posting,
// returning to the tab) builds a new composer; the draft carries over.
const drafts = new Map();

// What getSeen returned when the view was opened, per viewer and student, so a
// refresh keeps showing "New" on the items that were new at that moment
const seenAtOpen = new Map();

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function feedSkeleton(n = 3) {
  const items = Array.from({ length: n }, () => h('div', { class: 'upd-skel', 'aria-hidden': 'true' },
    h('span', { class: 'skeleton upd-sk-avatar' }),
    h('span', { class: 'upd-sk-lines' },
      h('span', { class: 'skeleton upd-sk-line is-head' }),
      h('span', { class: 'skeleton upd-sk-line' }),
      h('span', { class: 'skeleton upd-sk-line is-short' }))));
  return h('div', { class: 'upd-skeleton', 'aria-busy': 'true' }, items, visuallyHidden('Loading…'));
}

export async function mount(ctx) {
  const staff = ctx.audience === 'staff';
  const title = staff ? 'Updates' : (TITLES[ctx.role] ?? 'Updates');
  ctx.setHeader({ title });

  const student = ctx.scope?.student ?? null;
  if (!student) {
    ctx.host.append(emptyState({ icon: 'chat-circle-text', text: 'Choose a student to see their updates.' }));
    ctx.announce(title);
    return;
  }

  const studentId = student.id;
  const first = student.full_name?.trim() ? firstName(student.full_name) : null;
  const familyOf = first ? `${first}’s family` : 'the student’s family';
  const canPost = staff && !ctx.readOnly;
  const canDelete = (u) => canPost && (ctx.role === 'admin' || String(u.author_id) === String(ctx.me.id));

  const composer = canPost ? buildComposer() : null;
  const feedHost = h('div', { class: 'upd-feed-host' }, feedSkeleton());
  ctx.host.append(h('div', { class: 'upd-layout' }, composer?.form, feedHost));

  const compose = ctx.route.params?.compose;
  if (composer && !ctx.isRefresh && compose && compose !== '0') {
    composer.textarea.focus({ preventScroll: true });
  }

  // -------------------------------------------------------------------------
  // Feed

  let updates;
  let names;
  try {
    [updates, names] = await Promise.all([ctx.store.getUpdates(studentId), staffNames()]);
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    feedHost.replaceChildren(errorCallout({
      title: 'We couldn’t load updates.',
      text: 'Check your connection and try again.',
      onRetry: () => ctx.store.invalidate(studentId),
    }));
    ctx.announce(`${title}. We couldn’t load updates.`);
    return;
  }
  if (!ctx.alive()) return;
  updates = updates ?? [];

  // Anything typed into the old composer while this refresh loaded is in the
  // draft, not in the new textarea yet
  if (composer && ctx.isRefresh) composer.syncFromDraft();

  // "New" for students and parents only; staff never see it
  let seen;
  if (!staff) {
    const key = `${ctx.me.id}-${studentId}`;
    if (ctx.isRefresh && seenAtOpen.has(key)) seen = seenAtOpen.get(key);
    else {
      seen = getSeen('updates', ctx.me.id, studentId);
      seenAtOpen.set(key, seen);
    }
    markSeen('updates', ctx.me.id, studentId, ctx.now);
  }

  if (!updates.length) {
    feedHost.replaceChildren(emptyState({
      icon: 'chat-circle-text',
      text: staff
        ? 'No updates yet. Post one to keep the family in the loop.'
        : 'No updates yet. Notes from your tutor will appear here.',
    }));
  } else {
    const items = updates.map((u, i) => {
      const li = updateItem(u, names, {
        showAudience: staff,
        staff,
        studentFirstName: first,
        isNew: !staff && isNewSince(u.created_at, seen, ctx.now),
        now: ctx.now,
        onDelete: canDelete(u) ? () => remove(u, li) : null,
      });
      if (!ctx.isRefresh && i < ENTRY_ITEMS) {
        li.classList.add('enter');
        li.style.setProperty('--i', String(i));
      }
      return li;
    });
    feedHost.replaceChildren(updateList(items, { label: title }));
  }

  ctx.announce(`${title}, ${updates.length ? plural(updates.length, 'update', 'updates') : 'no updates yet'}`);

  // -------------------------------------------------------------------------
  // Composer (staff)

  function buildComposer() {
    const textarea = h('textarea', {
      class: 'input textarea upd-textarea',
      name: 'body',
      rows: 6,
      maxlength: MAX_BODY,
      placeholder: first ? `How is ${first} doing this week?` : 'How is the week going?',
      dataset: { focusKey: 'upd-body' },
    });
    const fieldEl = field({ label: `Write an update for ${familyOf}`, control: textarea });

    const shared = h('input', { type: 'checkbox', class: 'checkbox', name: 'visible_to_student', dataset: { focusKey: 'upd-shared' } });
    const sharedLabel = h('label', { class: 'check upd-share' }, shared, h('span', {}, `Also show to ${first || 'the student'}`));

    const post = button({ label: 'Post update', variant: 'primary', type: 'submit', focusKey: 'upd-post', className: 'upd-post' });

    const form = h('form', { class: 'card upd-composer', novalidate: true, 'aria-label': 'New update' },
      fieldEl,
      h('div', { class: 'upd-composer-foot' }, sharedLabel, post));

    const saveDraft = () => {
      if (textarea.value || shared.checked) {
        drafts.set(String(studentId), {
          body: textarea.value,
          shared: shared.checked,
          start: textarea.selectionStart,
          end: textarea.selectionEnd,
        });
      } else {
        drafts.delete(String(studentId));
      }
    };
    // Fills the composer from the saved draft, caret included
    const syncFromDraft = () => {
      const d = drafts.get(String(studentId));
      const body = d?.body ?? '';
      if (textarea.value !== body) textarea.value = body;
      shared.checked = Boolean(d?.shared);
      if (d && Number.isInteger(d.start) && Number.isInteger(d.end)) {
        try { textarea.setSelectionRange(d.start, d.end); } catch { /* not focusable yet */ }
      }
    };
    syncFromDraft();
    textarea.addEventListener('input', () => {
      saveDraft();
      if (textarea.getAttribute('aria-invalid') === 'true' && textarea.value.trim()) setFieldError(fieldEl, '');
    });
    // Caret moves without typing still count, so a refresh puts it back
    textarea.addEventListener('select', saveDraft);
    textarea.addEventListener('keyup', saveDraft);
    textarea.addEventListener('pointerup', saveDraft);
    shared.addEventListener('change', saveDraft);

    let posting = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (posting) return;
      const body = textarea.value.trim();
      if (!body) {
        setFieldError(fieldEl, 'Write something first.');
        textarea.focus();
        return;
      }
      setFieldError(fieldEl, '');
      posting = true;
      let failed = false;
      try {
        await busy(post, 'Posting…', async () => {
          const { error } = await sb.from('updates').insert({
            student_id: studentId,
            body,
            visible_to_student: shared.checked,
          });
          if (error) {
            console.error(error);
            failed = true;
            if (ctx.alive()) setFieldError(fieldEl, POST_FAILED);
            // The field error is not a live region; the toast is, so a
            // screen reader hears the failure
            ctx.toast({ text: POST_FAILED });
            return;
          }
          drafts.delete(String(studentId));
          if (ctx.alive()) {
            textarea.value = '';
            shared.checked = false;
          }
          ctx.toast({ text: 'Update posted.' });
          ctx.store.invalidate(studentId);
        });
      } finally {
        posting = false;
      }
      // busy() hands focus back to the button; the text to fix is in the field
      if (failed && ctx.alive()) textarea.focus();
    });

    return { form, textarea, shared, syncFromDraft };
  }

  // -------------------------------------------------------------------------
  // Delete (authors and admins)

  // Where focus goes once an item is gone: the next item's menu, the previous
  // one's, or the composer. The refresh keeps it there by data-focus-key.
  function focusAfterRemoval(li) {
    const pick = (el) => el?.querySelector?.('[data-focus-key]');
    let target = null;
    for (let s = li.nextElementSibling; s && !target; s = s.nextElementSibling) target = pick(s);
    for (let s = li.previousElementSibling; s && !target; s = s.previousElementSibling) target = pick(s);
    target ??= ctx.host.querySelector('[data-focus-key="upd-body"]');
    target?.focus({ preventScroll: true });
  }

  async function remove(update, li) {
    const ok = await ctx.confirm({
      title: 'Delete this update?',
      body: `It will be removed for ${familyOf}. This can’t be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    // A refresh may have swapped this view out while the dialog was open; the
    // delete still runs, only the DOM work needs the view
    if (ctx.alive()) {
      // The finished entry animation fills forwards and would hold opacity at 1
      li.classList.remove('enter');
      li.classList.add('is-removing');
      li.setAttribute('aria-busy', 'true');
    }

    // .select() so a delete that RLS quietly skipped counts as a failure
    const { data, error } = await sb.from('updates').delete().eq('id', update.id).select('id');
    if (error || !data?.length) {
      if (error) console.error(error);
      if (ctx.alive()) {
        li.classList.remove('is-removing');
        li.removeAttribute('aria-busy');
      }
      ctx.toast({ text: 'We couldn’t delete that update. Try again.' });
      return;
    }
    if (ctx.alive()) focusAfterRemoval(li);
    ctx.toast({ text: 'Update deleted.' });
    ctx.store.invalidate(studentId);
  }
}
