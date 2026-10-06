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
// Several photos can be attached as the pages of one piece of handwritten
// work. They show as a list of pages (thumbnails, move and remove buttons;
// the rules are in pages-model.js) and are combined into one PDF in the
// browser when the work is submitted (upload.js, pdf-pack.js), so a
// submission still holds one file and costs one attempt. One photo alone is
// sent as a photo, as before.
// Files dropped anywhere on the section, or images pasted into it (a
// screenshot), take the dropzone's path.
//
// Order: validate, then (only with a file) prepareUpload (or preparePagesPdf
// for two or more photos), storagePath and the storage upload (upsert false),
// then the submissions insert, startGrading (not awaited), then the redraw.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, iconButton, field, busy } from './ui.js';
import { validateUpload, prepareUpload, preparePagesPdf, storagePath, UploadProblem, ACCEPT } from './upload.js';
import { addFiles, removeAt, moveBy, isPhoto, isPages, pagesText, said, MAX_PAGES } from './pages-model.js';
import { startGrading } from './grading.js';
import { sb } from './supabase.js';
import { MAX_SUBMISSIONS } from './buckets.js';
import { SUPPORT_EMAIL, supportMailto } from './help-model.js';
import { toast } from './overlays.js';
import { openAnswerEditor, MAX_ANSWER_CHARS } from './answer-editor.js';
import { normalizeDoc, docToText, wordCount, isEmptyDoc } from './rich-doc.js';
import { docNodes } from './rich-doc-dom.js';

export { MAX_ANSWER_CHARS };

const SUCCESS = 'Work submitted. Your tutor will review it soon.';
// The work is saved even when grading could not start (rate limit, network);
// the daily sweep grades it, so the student must not spend another attempt.
const GRADING_LATER = 'Your work is saved, but grading could not start yet. It will be graded within a day, so you don’t need to submit again.';
// The portal has no messaging: these lines point to the support address (also
// on the Help page). Each is a sentence with a mail link, built where it is shown.
const mailLink = (subject) => h('a', { class: 'link', href: supportMailto(subject) }, SUPPORT_EMAIL);
const atLimitText = () => [
  `You’ve used all ${MAX_SUBMISSIONS} attempts for this assignment. If you need to send another answer, ask your tutor or email `,
  mailLink('Another attempt on an assignment'),
  '.',
];
const NOTHING = 'Write your answer, or attach a file.';
const TOO_LONG = `Your answer is too long to submit. Keep it under ${MAX_ANSWER_CHARS.toLocaleString('en-US')} characters, or attach the rest as a file.`;
const failedText = () => ['Your work could not be submitted. Try again, or email it to ', mailLink('Work that would not submit'), '.'];

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
  if (atLimit(error)) return atLimitText();
  return error instanceof UploadProblem || message.startsWith('This photo') ? message : failedText();
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

  // What is attached: one file, or the photos that become the pages of one PDF
  let files = [];
  const photoUrls = new Map();   // photo File -> object URL for its thumbnail

  // Dropzone: a label around a visually hidden (still focusable) file input.
  // The input only picks files; `files` is what is attached.
  const input = h('input', {
    type: 'file',
    name: 'file',
    accept: ACCEPT,
    multiple: true,
    class: 'visually-hidden',
  });
  const dropTitle = h('span', { class: 'asg-drop-title' });
  const dropHint = h('span', { class: 'asg-drop-hint' });
  const dropzone = h('label', { class: 'asg-dropzone' },
    input,
    h('span', { class: 'asg-drop-icon' }, icon('upload-simple', { size: 20 })),
    dropTitle,
    dropHint);

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
      files = [];
      setError('');
      paint();
      input.focus();
    },
  });
  const chosen = h('div', { class: 'asg-file', hidden: true },
    fileIconSlot,
    h('span', { class: 'asg-file-main' }, fileName, fileMeta),
    removeBtn);

  // Photos: one row per page, in the order they will have in the PDF
  const pagesCount = h('p', { class: 'asg-pages-count', tabindex: '-1' });
  const pagesHint = h('p', { class: 'asg-pages-hint' }, 'Pages are combined into one PDF when you submit.');
  const pagesList = h('ol', { class: 'asg-pages-list', role: 'list', 'aria-label': 'Pages' });
  const pagesBox = h('div', { class: 'asg-pages', hidden: true },
    h('div', { class: 'asg-pages-head' }, pagesCount, pagesHint),
    pagesList);
  // Spoken when the pages change (focus alone does not say how many there are)
  const live = h('p', { class: 'visually-hidden', role: 'status' });
  let liveTimer = null;
  const say = (text) => {
    clearTimeout(liveTimer);
    live.textContent = '';
    liveTimer = setTimeout(() => { live.textContent = text; }, 60);
  };

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
    answerField, h('div', { class: 'asg-attach' }, attachLabel, chosen, pagesBox, dropzone, live), noteField, error, actions);

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

  // The single file (a PDF or text file): its name and size, in place of the dropzone
  function showChosen(file) {
    if (!file) {
      chosen.hidden = true;
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
  }

  // Thumbnails are object URLs: made when a page first shows, revoked when it
  // is removed or replaced, and all of them once the work is in, or this section
  // has left the page (the drawer closed or showed another item)
  function urlFor(file) {
    if (!photoUrls.has(file)) photoUrls.set(file, URL.createObjectURL(file));
    return photoUrls.get(file);
  }
  function releaseUnused() {
    for (const [file, url] of photoUrls) {
      if (files.includes(file)) continue;
      URL.revokeObjectURL(url);
      photoUrls.delete(file);
    }
  }
  function releaseAll() {
    for (const url of photoUrls.values()) URL.revokeObjectURL(url);
    photoUrls.clear();
    goneWatcher?.disconnect();
    goneWatcher = null;
  }
  // The drawer keeps this section across refresh paints, each with a new signal
  // that this section never sees, so a signal cannot say when it is gone. Watch
  // the drawer (or the page, before the section is in one) instead, for as long
  // as there are thumbnails to release. The check waits a moment: a refresh
  // moves the section out of the old body and into the new one a little before
  // the new one is on screen, and that is not leaving the page.
  let goneWatcher = null;
  function watchForRemoval() {
    if (goneWatcher || !photoUrls.size) return;
    let timer = null;
    const check = () => {
      timer = null;
      const dialog = section.closest('dialog');
      if (section.isConnected && !(dialog && !dialog.open)) return;
      releaseAll();
    };
    goneWatcher = new MutationObserver(() => { timer ??= setTimeout(check, 400); });
    goneWatcher.observe(section.closest('dialog') ?? document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['open'],
    });
  }

  // One row per page: thumbnail, "Page 2", the file's name and size, and
  // Move up, Move down, Remove, each named for its page
  let rows = [];   // the buttons of each row, for moving focus
  function pageRow(file, index, total) {
    const n = index + 1;
    const mk = (name, label, onClick, extra = {}) => {
      const el = iconButton({ icon: name, label, onClick, tip: false, className: `asg-page-btn ${extra.className ?? ''}`.trim() });
      el.title = label;
      el.disabled = Boolean(extra.disabled) || sending;
      return el;
    };
    const up = mk('caret-down', `Move page ${n} up`, () => movePage(index, -1), { className: 'asg-page-up', disabled: index === 0 });
    const down = mk('caret-down', `Move page ${n} down`, () => movePage(index, 1), { disabled: index === total - 1 });
    const remove = mk('x', `Remove page ${n}`, () => removePage(index));
    rows.push({ up, down, remove });
    return h('li', { class: 'asg-page' },
      h('img', { class: 'asg-page-thumb', src: urlFor(file), alt: '', width: '48', height: '64' }),
      h('span', { class: 'asg-page-main' },
        h('span', { class: 'asg-page-label' }, `Page ${n}`),
        h('span', { class: 'asg-page-meta' }, h('span', { class: 'asg-page-name' }, file.name || 'Photo'), h('span', { class: 'num' }, fileSize(file.size)))),
      h('span', { class: 'asg-page-actions' }, up, down, remove));
  }

  // Which control shows what, for the files now attached
  function paint() {
    const pages = isPages(files);
    const single = files.length === 1 && !pages ? files[0] : null;
    showChosen(single);
    pagesBox.hidden = !pages;
    if (pages) {
      rows = [];
      pagesCount.textContent = pagesText(files.length);
      pagesHint.hidden = files.length < 2;
      pagesList.replaceChildren(...files.map((file, i) => pageRow(file, i, files.length)));
    } else {
      pagesList.replaceChildren();
      rows = [];
    }
    releaseUnused();
    watchForRemoval();
    dropzone.hidden = Boolean(single) || (pages && files.length >= MAX_PAGES);
    dropzone.classList.toggle('is-compact', pages);
    dropTitle.textContent = pages ? 'Add another page' : 'Attach files, drop them here, or paste a screenshot';
    dropHint.textContent = pages
      ? `Choose or drop more photos. Up to ${MAX_PAGES} pages.`
      : `Optional. PDF, text file, or up to ${MAX_PAGES} photos (JPG or PNG). Up to 20 MB.`;
  }
  paint();

  // After a change, focus must not be left on something that is now hidden
  function settleFocus() {
    const active = document.activeElement;
    const stranded = Boolean(active && section.contains(active) && active.closest('[hidden]'));
    if (files.length === 1 && !isPhoto(files[0])) {
      if (active === input || !section.contains(active) || stranded) removeBtn.focus();
    } else if (!files.length) {
      if (stranded) input.focus();
    } else if (stranded) {
      (dropzone.hidden ? pagesCount : input).focus();
    }
  }

  // Focus the named button of the page at `index`; if it is disabled (the page
  // reached an end of the list) the next best one gets it
  function focusPageButton(index, prefer) {
    const row = rows[index];
    if (!row) return;
    const order = { up: [row.up, row.down, row.remove], down: [row.down, row.up, row.remove], remove: [row.remove, row.up, row.down] }[prefer];
    order.find((el) => !el.disabled)?.focus();
  }

  function movePage(index, delta) {
    if (sending) return;
    const moved = moveBy(files, index, delta);
    if (moved.files === files) return;
    files = moved.files;
    paint();
    focusPageButton(moved.index, delta < 0 ? 'up' : 'down');
    say(said.moved(moved.index, files.length));
  }

  function removePage(index) {
    if (sending) return;
    files = removeAt(files, index);
    setError('');
    paint();
    if (files.length) focusPageButton(Math.min(index, files.length - 1), 'remove');
    else input.focus();
    say(said.removed(index, files.length));
  }

  // Chosen, dropped and pasted files take this one path. Returns true when
  // something was attached. A refusal is shown under the form (and, from the
  // editor, which is in front of it, in a toast too).
  function takeFiles(incoming, { fromEditor = false } = {}) {
    if (sending) return false;
    const result = addFiles(files, incoming);
    if (result.problem) {
      setError(result.problem);
      if (fromEditor) toast({ text: result.problem });
      return false;
    }
    if (!result.added) return false;
    setError('');
    files = result.files;
    paint();
    settleFocus();
    if (isPages(files)) say(said.added(result.added, files.length));
    return true;
  }

  input.addEventListener('change', () => {
    const picked = [...(input.files ?? [])];
    input.value = '';   // so the same photo can be chosen again after removing it
    takeFiles(picked);
  });

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
    takeFiles([...e.dataTransfer.files]);
  });

  // A pasted image (a screenshot) is attached like a chosen photo, here or in
  // the editor, which hands over any file pasted or dropped in. The editor is a
  // dialog in front of this section, so what happened is said in a toast too.
  // Returns true when the file is attached.
  const shotName = (file, n) => {
    if (!isPhoto(file) || (file.name && file.name !== 'image.png')) return file;
    const ext = file.type === 'image/png' ? 'png' : 'jpg';
    return new File([file], n ? `Screenshot ${n}.${ext}` : `Screenshot.${ext}`, { type: file.type });
  };
  function attachFile(file, { fromEditor = false } = {}) {
    if (sending) return false;
    const named = shotName(file);
    if (!takeFiles([named], { fromEditor })) return false;
    if (fromEditor) {
      toast({ text: isPhoto(named)
        ? 'Images can’t go inside the answer, so it was attached to your work.'
        : `${named.name || 'The file'} was attached to your work.` });
    }
    return true;
  }
  section.addEventListener('paste', (e) => {
    const images = [...(e.clipboardData?.files ?? [])].filter(isPhoto);
    if (!images.length) return;
    e.preventDefault();
    takeFiles(images.map((image, i) => shotName(image, images.length > 1 ? i + 1 : 0)));
  });

  const setSending = (on) => {
    sending = on;
    section.dataset.sending = on ? 'true' : 'false';
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;
    const attached = files;
    const asPages = attached.length > 1;   // two or more photos become one PDF
    const text = docToText(doc).trim();
    if (!text && !attached.length) {
      setError(NOTHING);
      answerBtn.focus();
      return;
    }
    if (text.length > MAX_ANSWER_CHARS) {
      setError(TOO_LONG);
      answerBtn.focus();
      return;
    }
    const problem = attached.map((file) => validateUpload(file)).find(Boolean) ?? null;
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
    for (const button of pagesBox.querySelectorAll('button')) button.disabled = true;
    const label = submit.querySelector('.btn-label');
    try {
      await busy(submit, asPages ? 'Preparing pages…' : attached.length ? 'Uploading…' : 'Submitting…', async () => {
        try {
          // The plain text is what grading reads; the document keeps the formatting
          const row = { task_id: task.id, body: text || null, body_doc: text ? doc : null, note: note.value.trim() || null };
          if (attached.length) {
            if (asPages) say(`Combining your ${attached.length} pages into one PDF.`);
            const { body, type } = asPages
              ? await preparePagesPdf(attached, {
                onProgress: ({ page, of, smaller }) => {
                  label.textContent = smaller ? `Making pages smaller, ${page} of ${of}…` : `Preparing page ${page} of ${of}…`;
                },
              })
              : await prepareUpload(attached[0]);
            if (asPages) label.textContent = 'Uploading…';
            const path = storagePath(studentId, type);
            const uploaded = await sb.storage.from('homework').upload(path, body, { contentType: type, upsert: false });
            if (uploaded.error) throw uploaded.error;
            row.storage_path = path;
            row.file_type = type;
          }
          const inserted = await sb.from('submissions').insert(row).select('id').single();
          if (inserted.error) throw inserted.error;
          files = [];
          releaseAll();
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
          if (section.isConnected) setError(failureText(err));
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
      paint();   // the page buttons, enabled again (the thumbnails come back if they were released)
    }
  });

  return section;
}
