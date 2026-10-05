// "Submit your work" in the item drawer (spec 5.6, section 3). Students only.
//
// submitWorkSection(dctx, item, { onSubmitted }) -> section.drawer-section
//   dctx         the drawer context (me, store, signal, alive)
//   item         a derived Item the student may still submit to (item.canSubmit)
//   onSubmitted  called after the submission row exists and grading was started;
//                it redraws (invalidate) and shows the success message. Without
//                it, the store is invalidated and a toast says the work is in.
//
// The answer is written first, in the document editor (answer-editor.js),
// with formatting; a file (PDF, photo or text file) is optional, and either
// one alone is enough. What the student writes is kept as a draft on their
// account (submission_drafts) as they type, so it is there on any device
// until they submit. The section carries data-task-id, data-attempts and
// data-sending so the drawer can keep it (with the answer, the chosen file
// and the note) across refresh paints.
// Files dropped anywhere on the section, or an image pasted into it (a
// screenshot), take the dropzone's path.
//
// Order: validate, then (only with a file) prepareUpload, storagePath and the
// storage upload (upsert false), then the submissions insert, startGrading
// (not awaited), then the redraw.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, field, busy } from './ui.js';
import { validateUpload, prepareUpload, storagePath, ACCEPT } from './upload.js';
import { startGrading } from './grading.js';
import { sb } from './supabase.js';
import { MAX_SUBMISSIONS } from './buckets.js';
import { toast } from './overlays.js';
import { openAnswerEditor, MAX_ANSWER_CHARS } from './answer-editor.js';
import { normalizeDoc, docToText, wordCount, isEmptyDoc } from './rich-doc.js';
import { docNodes } from './rich-doc-dom.js';

export { MAX_ANSWER_CHARS };

const SUCCESS = 'Work submitted. Your tutor will review it soon.';
// The work is saved even when grading could not start (rate limit, network);
// the daily sweep grades it, so the student must not spend another attempt.
const GRADING_LATER = 'Your work is saved, but grading could not start yet. It will be graded within a day, so you don’t need to submit again.';
const AT_LIMIT = `You’ve used all ${MAX_SUBMISSIONS} attempts for this assignment. Message your tutor if you need to send another answer.`;
const NOTHING = 'Write your answer, or attach a file.';
const TOO_LONG = `Your answer is too long to submit. Keep it under ${MAX_ANSWER_CHARS.toLocaleString('en-US')} characters, or attach the rest as a file.`;
const FAILED = 'Your work could not be submitted. Try again, or email it to your tutor.';

// "340 KB", "2.4 MB"
function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

function fileIcon(type) {
  if (type === 'application/pdf') return 'file-pdf';
  if (String(type).startsWith('image/')) return 'image-square';
  return 'file-text';
}

// The message a failed submission shows (spec 5.6: errors unchanged)
function failureText(error) {
  const message = error?.message ?? '';
  if (atLimit(error)) return AT_LIMIT;
  return message.startsWith('This photo') ? message : FAILED;
}

// The database refused a submission over the cap: the trigger in
// 20261001120000_submission_cap.sql, or the insert policy's can_submit check
// when this page's attempt count was out of date.
function atLimit(error) {
  return error?.code === 'P0001' && /submission limit/.test(error?.message ?? '');
}

export function submitWorkSection(dctx, item, { onSubmitted } = {}) {
  const task = item.task;
  const again = item.attempts > 0;
  const attempt = item.attempts + 1;
  const studentId = task.student_id ?? dctx.me?.id;
  const headingId = uid('submit-heading');
  let sending = false;

  // Dropzone: a label around a visually hidden (still focusable) file input
  const input = h('input', {
    type: 'file',
    name: 'file',
    accept: ACCEPT,
    class: 'visually-hidden',
  });
  const dropzone = h('label', { class: 'asg-dropzone' },
    input,
    h('span', { class: 'asg-drop-icon' }, icon('upload-simple', { size: 20 })),
    h('span', { class: 'asg-drop-title' }, 'Attach a file, drop it here, or paste a screenshot'),
    h('span', { class: 'asg-drop-hint' }, 'Optional. PDF, photo (JPG or PNG) or text file, up to 20 MB.'));

  // The answer: written in the editor, shown here as a preview. The draft
  // loads from the student's account; until it arrives the card says so.
  let doc = normalizeDoc(null);
  let draftState = 'loading'; // 'loading' | 'ready' | 'failed'
  let unsaved = false;        // the last save of the draft did not go through
  const preview = h('div', { class: 'asg-answer-preview doc-view read' });
  const answerMeta = h('span', { class: 'asg-answer-meta' });
  const answerBtn = button({ label: 'Write your answer', variant: 'secondary', icon: 'pencil-simple', onClick: () => openEditor() });
  const answer = h('div', { class: 'asg-answer is-empty' },
    preview,
    h('div', { class: 'asg-answer-foot' }, answerBtn, answerMeta));
  const answerField = field({
    label: 'Your answer',
    hint: 'Format it like a document: headings, lists, x², math symbols. You can also attach a file below, like a photo of handwritten work.',
    control: answer,
  });

  // Until the saved draft is in, the answer cannot be opened (it would start
  // blank and save over the draft); if it could not load, the button tries again
  function paintAnswer() {
    const empty = isEmptyDoc(doc);
    answer.classList.toggle('is-empty', empty);
    let placeholder = 'Nothing written yet.';
    if (draftState === 'loading') placeholder = 'Loading your draft…';
    if (draftState === 'failed') placeholder = 'Your saved draft could not be loaded.';
    preview.replaceChildren(...(empty ? [h('p', { class: 'asg-answer-placeholder' }, placeholder)] : docNodes(doc)));
    let label = empty ? 'Write your answer' : 'Edit your answer';
    if (draftState === 'failed') label = 'Load your draft again';
    answerBtn.querySelector('.btn-label')?.replaceChildren(label);
    answerBtn.disabled = draftState === 'loading' || sending;
    const words = wordCount(doc);
    if (unsaved) answerMeta.textContent = 'Not saved to your account yet. It will try again.';
    else answerMeta.textContent = empty ? '' : `${words.toLocaleString('en-US')} ${words === 1 ? 'word' : 'words'}, draft saved to your account`;
    answerMeta.classList.toggle('is-warning', unsaved);
  }

  // The draft: one row per student and assignment. An empty answer removes it.
  async function saveDraft(next) {
    const text = docToText(next);
    const result = isEmptyDoc(next)
      ? await sb.from('submission_drafts').delete().eq('task_id', task.id)
      : await sb.from('submission_drafts').upsert(
        { task_id: task.id, body_doc: next, body: text.slice(0, MAX_ANSWER_CHARS * 2) },
        { onConflict: 'student_id,task_id' },
      );
    if (result.error) throw result.error;
  }

  // The draft as saved on the account; resolves true when it was read
  async function loadDraft() {
    try {
      const result = await sb.from('submission_drafts').select('body_doc').eq('task_id', task.id).maybeSingle();
      if (result.error) throw result.error;
      // Work not saved yet (a failed save) stays; otherwise the account's copy wins
      if (!unsaved) doc = normalizeDoc(result.data?.body_doc ?? null);
      draftState = 'ready';
      return true;
    } catch (err) {
      console.error('Draft did not load', err);
      draftState = 'failed';
      return false;
    } finally {
      paintAnswer();
    }
  }

  // A save that did not go through tries again a few times, while this
  // section is still on the page
  let retryTimer = null;
  function retrySave(tries = 0) {
    clearTimeout(retryTimer);
    if (!unsaved || tries >= 5) return;
    retryTimer = setTimeout(async () => {
      if (!section.isConnected) return;
      try {
        await saveDraft(doc);
        unsaved = false;
        paintAnswer();
      } catch {
        retrySave(tries + 1);
      }
    }, 5000 * (tries + 1));
  }

  paintAnswer();
  loadDraft();

  // Opening reads the draft again first, so an answer written on another
  // device since this page loaded is the one that opens
  async function openEditor() {
    if (sending) return;
    if (draftState === 'failed' || !unsaved) {
      const ok = await busy(answerBtn, 'Opening…', loadDraft);
      paintAnswer(); // busy() put the old label back
      if (!ok || dctx.alive?.() === false) return;
    }
    openAnswerEditor({
      title: task.title || 'Your answer',
      doc,
      save: saveDraft,
      canSubmit: true,
      signal: dctx.signal,
      onFile: (file) => attachFile(file, { fromEditor: true }),
      onClose: (next) => {
        doc = normalizeDoc(next);
        if (doc.blocks.length) setError('');
        paintAnswer();
      },
      onSaved: (ok) => {
        unsaved = !ok;
        paintAnswer();
        retrySave();
      },
      onSubmit: () => form.requestSubmit(),
    });
  }

  // The chosen file, shown in place of the dropzone
  const fileIconSlot = h('span', { class: 'asg-file-icon' });
  const fileName = h('span', { class: 'asg-file-name' });
  const fileMeta = h('span', { class: 'asg-file-meta num' });
  const removeBtn = button({
    label: 'Remove',
    variant: 'ghost',
    size: 'sm',
    onClick: () => {
      input.value = '';
      setError('');
      showChosen(null);
      input.focus();
    },
  });
  const chosen = h('div', { class: 'asg-file', hidden: true },
    fileIconSlot,
    h('span', { class: 'asg-file-main' }, fileName, fileMeta),
    removeBtn);

  const note = h('textarea', { class: 'input textarea asg-note-input', name: 'note', rows: '2', maxlength: '1000' });
  const noteField = field({ label: 'Note for your tutor', optional: true, control: note });

  const error = h('div', { class: 'asg-submit-error', role: 'alert' });
  const submit = button({
    label: 'Submit work',
    variant: 'primary',
    type: 'submit',
    icon: 'upload-simple',
    focusKey: `submit-${task.id}`,
  });
  const actions = h('div', { class: 'asg-submit-actions' },
    submit,
    h('span', { class: 'asg-attempt num' }, `Attempt ${attempt} of ${MAX_SUBMISSIONS}`));

  const progress = h('div', { class: 'asg-progress', 'aria-hidden': 'true' }, h('span', { class: 'asg-progress-bar' }));
  const attachLabel = h('p', { class: 'field-label asg-attach-label' }, 'Attach a file', h('span', { class: 'field-optional' }, 'Optional'));
  const form = h('form', { class: 'asg-submit-form', novalidate: true, 'aria-labelledby': headingId },
    answerField, h('div', { class: 'asg-attach' }, attachLabel, dropzone, chosen), noteField, error, actions);

  const section = h('section', {
    class: 'drawer-section asg-submit',
    'aria-labelledby': headingId,
    dataset: { taskId: String(task.id), attempts: String(item.attempts), sending: 'false' },
  },
    progress,
    h('h3', { id: headingId }, again ? 'Submit another version' : 'Submit your work'),
    form);

  function setError(text) {
    error.replaceChildren();
    if (!text) return;
    error.append(h('p', { class: 'field-error' }, icon('warning-circle'), h('span', {}, text)));
  }

  function showChosen(file) {
    if (!file) {
      chosen.hidden = true;
      dropzone.hidden = false;
      removeBtn.removeAttribute('aria-label');
      return;
    }
    fileIconSlot.replaceChildren(icon(fileIcon(file.type), { size: 20 }));
    fileName.textContent = file.name || 'Your file';
    fileName.title = file.name || '';
    fileMeta.textContent = fileSize(file.size);
    // Focus lands here after choosing: the name says which file it was
    removeBtn.setAttribute('aria-label', `Remove ${file.name || 'your file'}`);
    chosen.hidden = false;
    dropzone.hidden = true;
  }

  input.addEventListener('change', () => {
    const file = input.files?.[0] ?? null;
    if (!file) {
      showChosen(null);
      return;
    }
    const problem = validateUpload(file);
    if (problem) {
      input.value = '';
      showChosen(null);
      setError(problem);
      return;
    }
    setError('');
    showChosen(file);
    // Focus followed the file picker into a now hidden dropzone: move it on
    if (document.activeElement === input || !section.contains(document.activeElement)) removeBtn.focus();
  });

  // Dropped and chosen files take the same path: assign, then fire change.
  // The dropzone lights up; a drop anywhere on the section counts, so a near
  // miss (or a drop on the chosen file row) never opens the file in the tab.
  let depth = 0;
  const over = (on) => dropzone.classList.toggle('is-over', on);
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  dropzone.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    over(true);
  });
  dropzone.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) over(false);
  });
  section.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = sending ? 'none' : 'copy';
  });
  section.addEventListener('drop', (e) => {
    if (!hasFiles(e) && !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    depth = 0;
    over(false);
    if (sending || !e.dataTransfer?.files?.length) return;
    try {
      input.files = e.dataTransfer.files;
    } catch {
      setError('That file could not be added. Choose it with the file picker instead.');
      return;
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // A pasted image (a screenshot) becomes the attached file, here or in the
  // editor, which hands over any file pasted or dropped in. The editor is a
  // dialog in front of this section, so what happened is said in a toast too.
  // Returns true when the file is attached.
  function attachFile(file, { fromEditor = false } = {}) {
    if (sending) return false;
    const shot = file.type === 'image/png' || file.type === 'image/jpeg';
    const named = !shot || (file.name && file.name !== 'image.png')
      ? file
      : new File([file], `Screenshot.${file.type === 'image/png' ? 'png' : 'jpg'}`, { type: file.type });
    const problem = validateUpload(named);
    if (problem) {
      setError(problem);
      if (fromEditor) toast({ text: problem });
      return false;
    }
    try {
      const dt = new DataTransfer();
      dt.items.add(named);
      input.files = dt.files;
    } catch {
      const text = 'That file could not be added. Save it and choose it with the file picker instead.';
      setError(text);
      if (fromEditor) toast({ text });
      return false;
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (fromEditor) {
      toast({ text: shot
        ? 'Images can’t go inside the answer, so it was attached as your file.'
        : `${named.name || 'The file'} was attached to your work.` });
    }
    return true;
  }
  section.addEventListener('paste', (e) => {
    const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type === 'image/png' || f.type === 'image/jpeg');
    if (!image) return;
    e.preventDefault();
    attachFile(image);
  });

  const setSending = (on) => {
    sending = on;
    section.dataset.sending = on ? 'true' : 'false';
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;
    const file = input.files?.[0] ?? null;
    const text = docToText(doc).trim();
    if (!text && !file) {
      setError(NOTHING);
      answerBtn.focus();
      return;
    }
    if (text.length > MAX_ANSWER_CHARS) {
      setError(TOO_LONG);
      answerBtn.focus();
      return;
    }
    const problem = file ? validateUpload(file) : null;
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setSending(true);
    section.classList.add('is-busy');
    input.disabled = true;
    answerBtn.disabled = true;
    note.readOnly = true;
    removeBtn.disabled = true;
    try {
      await busy(submit, file ? 'Uploading…' : 'Submitting…', async () => {
        try {
          // The plain text is what grading reads; the document keeps the formatting
          const row = { task_id: task.id, body: text || null, body_doc: text ? doc : null, note: note.value.trim() || null };
          if (file) {
            const { body, type } = await prepareUpload(file);
            const path = storagePath(studentId, type);
            const uploaded = await sb.storage.from('homework').upload(path, body, { contentType: type, upsert: false });
            if (uploaded.error) throw uploaded.error;
            row.storage_path = path;
            row.file_type = type;
          }
          const inserted = await sb.from('submissions').insert(row).select('id').single();
          if (inserted.error) throw inserted.error;
          // Not awaited: the work is in. If grading could not start, say so once it answers.
          startGrading(inserted.data.id, { keepalive: true })
            .then((problem) => { if (problem) toast({ text: GRADING_LATER }); })
            .catch(() => toast({ text: GRADING_LATER }));
          if (onSubmitted) onSubmitted({ submissionId: inserted.data.id });
          else {
            dctx.store?.invalidate(studentId);
            dctx.toast?.({ text: SUCCESS });
          }
        } catch (err) {
          console.error('Submission failed', err);
          if (dctx.alive?.() !== false) setError(failureText(err));
          // A stale attempt count: reload so the drawer shows the limit instead of the form
          if (atLimit(err)) dctx.store?.invalidate(studentId);
        }
      });
    } finally {
      setSending(false);
      section.classList.remove('is-busy');
      input.disabled = false;
      answerBtn.disabled = false;
      note.readOnly = false;
      removeBtn.disabled = false;
    }
  });

  return section;
}
