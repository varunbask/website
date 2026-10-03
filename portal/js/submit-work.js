// "Submit your work" in the item drawer (spec 5.6, section 3). Students only.
//
// submitWorkSection(dctx, item, { onSubmitted }) -> section.drawer-section
//   dctx         the drawer context (me, store, signal, alive)
//   item         a derived Item the student may still submit to (item.canSubmit)
//   onSubmitted  called after the submission row exists and grading was started;
//                it redraws (invalidate) and shows the success message. Without
//                it, the store is invalidated and a toast says the work is in.
//
// The answer is typed text first; a file (PDF, photo or text file) is
// optional, and either one alone is enough. The section carries
// data-task-id, data-attempts and data-sending so the drawer can keep it
// (with the typed answer, the chosen file and the note) across refresh paints.
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

const SUCCESS = 'Work submitted. Your tutor will review it soon.';
// The work is saved even when grading could not start (rate limit, network);
// the daily sweep grades it, so the student must not spend another attempt.
const GRADING_LATER = 'Your work is saved, but grading could not start yet. It will be graded within a day, so you don’t need to submit again.';
const AT_LIMIT = `You’ve used all ${MAX_SUBMISSIONS} attempts for this assignment. Message your tutor if you need to send another answer.`;
const NOTHING = 'Type your answer, or attach a file.';
export const MAX_ANSWER_CHARS = 20000;
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

  // The answer: typed text is the main way to respond
  const answer = h('textarea', {
    class: 'input textarea asg-answer-input',
    name: 'answer',
    rows: '8',
    maxlength: String(MAX_ANSWER_CHARS),
    placeholder: 'Type your answer here. Show your work for each question.',
  });
  const answerField = field({
    label: 'Your answer',
    hint: 'You can also attach a file below, like a photo of handwritten work.',
    control: answer,
  });

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

  answer.addEventListener('input', () => {
    if (answer.value.trim()) setError('');
  });

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
  let sending = false;
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

  // A pasted image (a screenshot) becomes the attached file. Pasted text
  // goes into the answer box as usual.
  section.addEventListener('paste', (e) => {
    if (sending) return;
    const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type === 'image/png' || f.type === 'image/jpeg');
    if (!image) return;
    e.preventDefault();
    const named = image.name && image.name !== 'image.png'
      ? image
      : new File([image], `Screenshot.${image.type === 'image/png' ? 'png' : 'jpg'}`, { type: image.type });
    try {
      const dt = new DataTransfer();
      dt.items.add(named);
      input.files = dt.files;
    } catch {
      setError('That screenshot could not be added. Save it and choose it with the file picker instead.');
      return;
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const setSending = (on) => {
    sending = on;
    section.dataset.sending = on ? 'true' : 'false';
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;
    const file = input.files?.[0] ?? null;
    const text = answer.value.trim();
    if (!text && !file) {
      setError(NOTHING);
      answer.focus();
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
    answer.readOnly = true;
    note.readOnly = true;
    removeBtn.disabled = true;
    try {
      await busy(submit, file ? 'Uploading…' : 'Submitting…', async () => {
        try {
          const row = { task_id: task.id, body: text || null, note: note.value.trim() || null };
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
      answer.readOnly = false;
      note.readOnly = false;
      removeBtn.disabled = false;
    }
  });

  return section;
}
