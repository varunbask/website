// "Draft from lesson photos": the panel inside the staff create form
// (item-form.js). Staff only: item-form.js is imported with import() on staff
// paths (item-drawer.js), so student.html and parent.html never fetch this
// module; a test walks their static imports to keep it that way.
//
// draftPanel(dctx, { getStudentId, getContext, onFill, onDiscard, onBusy, attachRoom }) ->
//   { opener, root, open(), peek(), attachFiles(), attachCount(), photoCount(), studentChanged() }
//   opener        the button that opens the panel (the form places it)
//   root          the panel (hidden until opened)
//   getStudentId  () -> the form's student id now, or null
//   getContext    async (studentId) -> { subject, grade } sent as context
//   onFill        ({ title, details, answerKey }) when a draft is ready or opened
//   onDiscard     () -> whether the form still holds an earlier draft
//   onBusy        (on) while a draft for this form runs (the form locks its student)
//   attachRoom    () -> how many photos may still be attached (MAX_ATTACHMENTS less the files)
//   onPreview     async () opens the worksheet the form would make (Preview worksheet)
//   attachFiles   the photos as JPEG files when "Attach these photos" is ticked
//
// Photos are shrunk here (homework-draft-model.js has the numbers), kept in
// memory and sent once. The draft runs on the server as a background job:
// POST /api/grade { action: 'draft_homework' } answers 202 with an id, and the
// panel asks { action: 'draft_status', id } every few seconds until it is
// ready or failed. It stops asking when the drawer closes; reopening the form
// shows Recent drafts (read from homework_drafts) and picks up a draft for
// this student that is still drafting. Nothing is saved as an assignment
// until the tutor creates it with the form's own button.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { sb } from './supabase.js';
import { button, iconButton, field, select, pill, setFieldError, busy } from './ui.js';
import { fileDrop } from './file-drop.js';
import { relativeTime } from './dates.js';
import { displayName } from './format.js';
import {
  MAX_PHOTOS, SHRINK_TRIES, MIN_PROBLEMS, MAX_PROBLEMS, DEFAULT_PROBLEMS, MAX_NOTES, DIFFICULTIES, POLL_MS, RECENT_DAYS,
  DRAFTING_TEXT, READY_TEXT, GONE_ERROR,
  fitSize, isImageFile, fitsBudget, overBudgetText, photoProblems, checkOptions, draftRequest, contextText,
  formFromDraft, draftState, elapsedText, recentDrafts, optionsText, activeDraft, shouldReopen,
  pollOutcome, tokenNeedsRefresh, elsewhereText,
} from './homework-draft-model.js';

const LIST_FIELDS = 'id, student_id, status, options, error, created_at, finished_at, title:result->title';
const START_FAILED = 'We couldn’t start the draft. Check your connection and try again.';

// ---------------------------------------------------------------------------
// The API (the same function as grading)

// A fresh sign-in token for each call: refreshed when it is about to expire,
// or after the last call came back 401. A draft can run for minutes, and the
// tab may sit open far longer.
let refreshNext = false;
async function bearer() {
  let { data: { session } } = await sb.auth.getSession();
  if (tokenNeedsRefresh(session, Date.now(), { forced: refreshNext }) && typeof sb.auth.refreshSession === 'function') {
    try {
      const { data, error } = await sb.auth.refreshSession();
      if (!error && data?.session) session = data.session;
    } catch {
      /* keep the token we have; the next call tries again */
    }
  }
  refreshNext = false;
  return session?.access_token ?? '';
}

async function callApi(body) {
  try {
    const token = await bearer();
    const response = await fetch('/api/grade', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 401) refreshNext = true;
    const json = await response.json().catch(() => ({}));
    return { status: response.status, body: json };
  } catch {
    return { status: 0, body: {} };
  }
}

export const startDraft = (body) => callApi(body);
export const draftStatus = (id) => callApi({ action: 'draft_status', id });

// ---------------------------------------------------------------------------
// Photos

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

// One photo drawn on a canvas as a JPEG at most maxEdge on the long edge.
// Drawing drops everything but the pixels, EXIF and location included.
async function shrinkPhoto(file, { maxEdge, quality }) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = fitSize(bitmap.width, bitmap.height, maxEdge);
  const offscreen = typeof OffscreenCanvas !== 'undefined';
  const canvas = offscreen ? new OffscreenCanvas(width, height) : h('canvas', { width, height });
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';   // transparent areas become white, not black
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = offscreen
    ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
    : await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob || blob.type !== 'image/jpeg') throw new Error('not a JPEG');
  const dataUrl = await blobToDataUrl(blob);
  return { blob, dataUrl, chars: dataUrl.length - dataUrl.indexOf(',') - 1, width, height };
}

// ---------------------------------------------------------------------------

export function draftPanel(dctx, {
  getStudentId = () => null, getContext = async () => ({}), onFill, onDiscard, onBusy, attachRoom = () => Infinity, onPreview = null,
} = {}) {
  const headingId = uid('hwd-head');
  const photos = [];           // { blob, dataUrl, chars, url, name }
  let active = null;           // { id, studentId, startedAt } while a draft of this panel is drafting
  let filled = false;          // the form holds a draft
  let adding = false;
  const queue = [];            // files chosen while earlier ones are still being shrunk
  let starting = false;        // a draft request is on its way (one at a time)
  let recent = [];
  let names = new Map();
  let pollTimer = null;
  let tickTimer = null;
  let recentLoad = null;       // the Recent drafts query, once per form
  const alive = () => dctx.alive?.() !== false;

  // Photos ------------------------------------------------------------------
  const fileInput = h('input', {
    type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true',
    dataset: { draftInput: 'photos' },
  });
  const cameraInput = h('input', {
    type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true',
  });
  const thumbs = h('ul', { class: 'hwd-thumbs', 'aria-label': 'Lesson photos', hidden: true });
  const photoProblem = h('div', { class: 'hwd-photo-problem' });
  const addBtn = button({ label: 'Add photos', icon: 'image-square', size: 'sm', onClick: () => fileInput.click(), focusKey: 'hwd-add' });
  const cameraBtn = button({ label: 'Take a photo', icon: 'upload-simple', size: 'sm', className: 'hwd-camera', onClick: () => cameraInput.click() });
  const photoField = h('div', { class: 'field hwd-photos' },
    h('span', { class: 'field-label', id: `${headingId}-photos` }, 'Lesson photos'),
    thumbs,
    h('div', { class: 'hwd-photo-actions' }, addBtn, cameraBtn, fileInput, cameraInput),
    h('p', { class: 'field-hint' }, `1 to ${MAX_PHOTOS} photos of the whiteboard, worksheet or notes. They are made smaller in your browser, sent for this draft only, and not kept. You can also drag photos here or paste a screenshot.`),
    photoProblem);

  // Options -----------------------------------------------------------------
  const countInput = h('input', {
    type: 'number', class: 'input hwd-count', name: 'draft_count', inputmode: 'numeric',
    min: String(MIN_PROBLEMS), max: String(MAX_PROBLEMS), value: String(DEFAULT_PROBLEMS),
  });
  const countField = field({ label: 'Practice problems (Part B)', control: countInput });
  const levelWrap = select({ name: 'draft_difficulty', options: DIFFICULTIES.map((d) => ({ value: d.value, label: d.label })), value: 'same' });
  const levelSelect = levelWrap.querySelector('select');
  const levelField = field({ label: 'Difficulty', control: levelWrap });
  const hintsBox = h('input', { type: 'checkbox', class: 'checkbox', name: 'draft_hints' });
  const challengeBox = h('input', { type: 'checkbox', class: 'checkbox', name: 'draft_challenge', checked: true });
  const notesInput = h('textarea', { class: 'input textarea', name: 'draft_notes', rows: '2', maxlength: String(MAX_NOTES) });
  const notesField = field({
    label: 'Notes for the draft', optional: true, control: notesInput,
    hint: 'For example: focus on factoring with negative coefficients.',
  });
  const contextNote = h('p', { class: 'note hwd-context', hidden: true }, icon('info'), h('span', {}));
  const attachBox = h('input', { type: 'checkbox', class: 'checkbox', name: 'draft_attach', disabled: true });

  // Action, status and result -----------------------------------------------
  const draftBtn = button({ label: 'Draft homework', variant: 'primary', icon: 'note-pencil', focusKey: 'hwd-draft', onClick: () => start() });
  // What is announced (once per change) goes in a hidden live region; the
  // box shows the same words with a running timer that is not announced
  const timer = h('span', { class: 'hwd-timer num', 'aria-hidden': 'true' });
  const status = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  const statusBox = h('div', { class: 'hwd-status-box', hidden: true, 'aria-hidden': 'true' },
    h('span', { class: 'hwd-spinner' }), h('span', { class: 'hwd-status-text' }, DRAFTING_TEXT), timer);
  const errorSlot = h('div', { class: 'hwd-error' });
  // Staff only: problems the server left out to fit the assignment
  const noticeText = h('span', {});
  const noticeBox = h('p', { class: 'note hwd-notice', hidden: true }, icon('info'), noticeText);
  const elsewhere = h('p', { class: 'note hwd-elsewhere', hidden: true }, icon('info'), h('span', {}));
  const resultBar = h('div', { class: 'hwd-result', hidden: true },
    h('p', { class: 'note' }, icon('check-circle'), h('span', {}, READY_TEXT)),
    noticeBox,
    h('div', { class: 'hwd-result-actions' },
      onPreview ? previewButton() : null,
      button({ label: 'Try again', size: 'sm', icon: 'arrow-counter-clockwise', onClick: () => tryAgain(), focusKey: 'hwd-again' }),
      button({ label: 'Discard draft', size: 'sm', variant: 'ghost', icon: 'trash', onClick: () => discard(), focusKey: 'hwd-discard' })));
  // Preview worksheet: the page the student will print or mark up, from the form as it is now
  function previewButton() {
    const btn = button({
      label: 'Preview worksheet', icon: 'arrow-square-out', size: 'sm', focusKey: 'hwd-preview',
      ariaLabel: 'Preview worksheet, opens in a new tab',
    });
    btn.addEventListener('click', async () => {
      try {
        await busy(btn, 'Preparing…', () => onPreview());
      } catch (error) {
        console.error(error);
        showError('We couldn’t make the worksheet preview. Try again.', { retry: false });
      }
    });
    return btn;
  }

  const recentList = h('ul', { class: 'hwd-recent-list' });
  const recentBox = h('div', { class: 'hwd-recent', hidden: true },
    h('h4', { class: 'hwd-recent-title' }, 'Recent drafts'),
    recentList);

  const closeBtn = iconButton({ icon: 'x', label: 'Close the draft panel', tip: 'left', onClick: () => close() });
  const root = h('section', { class: 'hwd-panel', 'aria-labelledby': headingId, hidden: true },
    h('div', { class: 'hwd-head' },
      h('h3', { class: 'hwd-title', id: headingId, tabindex: '-1' }, 'Draft homework from lesson photos'),
      closeBtn),
    h('p', { class: 'hwd-lede' }, 'The AI writes a full problem set on the skills in your lesson: a warm-up, a worked example, practice, a word problem, a challenge and a reflection, with an answer key only staff see. Nothing is saved until you create the assignment.'),
    photoField,
    h('div', { class: 'hwd-options' },
      h('div', { class: 'hwd-option-row' }, countField, levelField),
      h('label', { class: 'check' }, hintsBox, h('span', {}, 'Include worked hints')),
      h('label', { class: 'check' }, challengeBox, h('span', {}, 'Include a challenge problem')),
      notesField),
    contextNote,
    h('label', { class: 'check hwd-attach' }, attachBox, h('span', {}, 'Attach these photos to the assignment for the student')),
    h('div', { class: 'hwd-actions' }, draftBtn),
    status, statusBox, errorSlot, elsewhere, resultBar, recentBox);

  const opener = button({
    label: 'Draft with AI from lesson photos', icon: 'note-pencil', size: 'sm', className: 'hwd-opener', focusKey: 'hwd-open',
    onClick: () => open({ focus: true }),
  });

  // Enter in a panel field never submits the form around it
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    e.stopPropagation();
  });
  // A screenshot pasted into the panel is a lesson photo, not an attachment
  root.addEventListener('paste', (e) => {
    const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    e.preventDefault();
    e.stopPropagation();
    addPhotos(images);
  });
  fileDrop(photoField, { onFiles: (files) => addPhotos(files), label: 'Drop photos to add them', iconName: 'image-square' });
  for (const input of [fileInput, cameraInput]) {
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      input.value = '';
      if (files.length) addPhotos(files);
    });
  }
  // Ticking "Attach these photos" must leave room within the assignment's attachments
  attachBox.addEventListener('change', () => {
    if (!attachBox.checked) return;
    const room = attachRoom();
    if (photos.length <= room) {
      showPhotoProblem('');
      return;
    }
    attachBox.checked = false;
    showPhotoProblem(room > 0
      ? `Only ${room} more ${room === 1 ? 'attachment fits' : 'attachments fit'} on this assignment (at most 10 in all). Remove a file under Attachments or a photo here, then tick it again.`
      : 'This assignment already has 10 attachments, the most it can have. Remove a file under Attachments to attach these photos.');
  });
  countInput.addEventListener('input', () => setFieldError(countField, ''));
  notesInput.addEventListener('input', () => setFieldError(notesField, ''));
  dctx.signal?.addEventListener('abort', stop, { once: true });

  function renderPhotos() {
    thumbs.replaceChildren(...photos.map((p, i) => h('li', { class: 'hwd-thumb' },
      h('img', { src: p.url, alt: `Lesson photo ${i + 1}`, width: '72', height: '72', decoding: 'async' }),
      iconButton({
        icon: 'x', label: `Remove lesson photo ${i + 1}`, tip: 'top', className: 'hwd-thumb-remove',
        onClick: () => {
          const [gone] = photos.splice(i, 1);
          URL.revokeObjectURL(gone.url);
          renderPhotos();
          showPhotoProblem('');
          addBtn.focus();
        },
      }))));
    thumbs.hidden = photos.length === 0;
    attachBox.disabled = photos.length === 0;
    if (!photos.length) attachBox.checked = false;
    addBtn.disabled = photos.length >= MAX_PHOTOS;
    cameraBtn.disabled = photos.length >= MAX_PHOTOS;
  }

  function showPhotoProblem(text) {
    photoProblem.replaceChildren(text ? h('p', { class: 'field-error', role: 'alert' }, icon('warning-circle'), h('span', {}, text)) : '');
  }

  // Files chosen while others are still being shrunk wait their turn
  async function addPhotos(files) {
    queue.push(...files);
    if (adding) return;
    adding = true;
    root.setAttribute('aria-busy', 'true');
    const notImages = [];
    const unreadable = [];
    let tooMany = 0;
    let overBudget = '';
    try {
      while (queue.length && alive()) {
        const file = queue.shift();
        if (!isImageFile(file)) { notImages.push(file.name || 'A file'); continue; }
        if (photos.length >= MAX_PHOTOS) { tooMany += 1; continue; }
        let shot = null;
        try {
          for (const tryOptions of SHRINK_TRIES) {
            shot = await shrinkPhoto(file, tryOptions);
            if (fitsBudget(photos, shot.chars)) break;
          }
        } catch {
          unreadable.push(file.name || 'A photo');
          continue;
        }
        if (!fitsBudget(photos, shot.chars)) {
          overBudget = overBudgetText(photos, shot.chars);
          continue;
        }
        // The drawer may have closed while it was shrunk: no link to free later
        if (!alive()) break;
        photos.push({ ...shot, name: file.name, url: URL.createObjectURL(shot.blob) });
      }
    } finally {
      adding = false;
      root.removeAttribute('aria-busy');
    }
    if (!alive()) {
      // stop() ran while photos were being added: free every link, the late ones too
      queue.length = 0;
      for (const p of photos) URL.revokeObjectURL(p.url);
      return;
    }
    renderPhotos();
    showPhotoProblem(photoProblems({ notImages, unreadable, tooMany, overBudget }));
  }

  // Context, shown before it is sent ----------------------------------------
  async function paintContext() {
    const studentId = getStudentId();
    let ctx = {};
    try {
      ctx = studentId ? await getContext(studentId) : {};
    } catch {
      ctx = {};
    }
    const text = contextText(ctx);
    contextNote.hidden = !text;
    contextNote.lastChild.textContent = text ? `Sent with the photos: ${text}.` : '';
    return ctx;
  }

  // Open and close ----------------------------------------------------------
  function open({ focus = false } = {}) {
    root.hidden = false;
    opener.hidden = true;
    paintContext();
    ensureRecent();
    if (focus) root.querySelector('.hwd-title')?.focus();
  }

  function close() {
    root.hidden = true;
    opener.hidden = false;
    opener.focus();
  }

  function stop() {
    clearTimeout(pollTimer);
    clearInterval(tickTimer);
    pollTimer = null;
    tickTimer = null;
    for (const p of photos) URL.revokeObjectURL(p.url);
  }

  // Drafting ----------------------------------------------------------------
  function setDrafting(on) {
    draftBtn.disabled = on;
    if (on) draftBtn.setAttribute('aria-busy', 'true');
    else draftBtn.removeAttribute('aria-busy');
    draftBtn.querySelector('.btn-label').textContent = on ? 'Drafting…' : 'Draft homework';
    statusBox.hidden = !on;
    onBusy?.(on);
    clearInterval(tickTimer);
    tickTimer = null;
    if (on && active) {
      const tick = () => { timer.textContent = elapsedText(Date.now() - active.startedAt); };
      tick();
      tickTimer = setInterval(tick, 1000);
    }
  }

  function showError(text, { retry = true } = {}) {
    const glyph = icon('warning-circle', { size: 20 });
    glyph.classList.add('callout-icon');
    errorSlot.replaceChildren(h('div', { class: 'callout tone-danger', role: 'alert' },
      glyph,
      h('div', { class: 'callout-body' },
        h('p', { class: 'callout-title' }, 'No draft this time.'),
        h('p', { class: 'callout-text' }, text),
        retry ? h('div', { class: 'callout-actions' }, button({ label: 'Try again', size: 'sm', icon: 'arrow-counter-clockwise', onClick: () => tryAgain() })) : null)));
  }

  async function start() {
    if (active || adding || starting) return;
    starting = true;
    try {
      await startOnce();
    } finally {
      starting = false;
    }
  }

  async function startOnce() {
    errorSlot.replaceChildren();
    const checked = checkOptions({
      count: countInput.value, difficulty: levelSelect.value, hints: hintsBox.checked, challenge: challengeBox.checked, notes: notesInput.value,
    });
    setFieldError(countField, checked.errors.count ?? '');
    setFieldError(notesField, checked.errors.notes ?? '');
    if (!photos.length) {
      showPhotoProblem(adding ? 'Wait for the photos to finish adding.' : 'Add at least one photo of the lesson.');
      addBtn.focus();
      return;
    }
    if (checked.errors.count) { countInput.focus(); return; }
    if (checked.errors.notes) { notesInput.focus(); return; }
    const studentId = getStudentId();
    const context = await paintContext();
    draftBtn.disabled = true;
    const res = await startDraft(draftRequest({ photos, options: checked.values, context, studentId }));
    if (!alive()) return;
    draftBtn.disabled = false;
    if (res.status !== 202 || !Number.isSafeInteger(res.body?.id)) {
      showError(res.body?.error || START_FAILED, { retry: false });
      return;
    }
    active = { id: res.body.id, studentId, startedAt: Date.now() };
    elsewhere.hidden = true;
    recent = [{ id: res.body.id, student_id: studentId, status: 'drafting', options: { ...checked.values, photos: photos.length }, error: null, created_at: res.body.created_at ?? new Date().toISOString(), title: null }, ...recent.filter((r) => r.id !== res.body.id)];
    resultBar.hidden = true;
    announce(DRAFTING_TEXT);
    setDrafting(true);
    renderRecent();
    schedulePoll(true);
  }

  function tryAgain() {
    if (!photos.length) {
      showError('Add the lesson photos again to draft again. Photos are not kept after the form closes.', { retry: false });
      addBtn.focus();
      return;
    }
    start();
  }

  // Puts back what the fields held before the last fill; after a second
  // fill that is the first draft, which stays (with its Discard)
  function discard() {
    const earlier = Boolean(onDiscard?.());
    filled = earlier;
    resultBar.hidden = !earlier;
    noticeText.textContent = '';
    noticeBox.hidden = true;
    announce(earlier ? 'Draft discarded. The form has the earlier draft again.' : 'Draft discarded.');
    (earlier ? resultBar.querySelector('[data-focus-key="hwd-discard"]') : draftBtn)?.focus();
  }

  function fill(result, { announceIt = true } = {}) {
    const values = formFromDraft(result);
    if (!values.title && !values.details) {
      showError('This draft is empty. Try again.');
      return;
    }
    onFill?.(values);
    filled = true;
    resultBar.hidden = false;
    noticeText.textContent = values.notice ?? '';
    noticeBox.hidden = !values.notice;
    errorSlot.replaceChildren();
    if (announceIt) announce(`Draft ready. ${values.notice ? `${values.notice} ` : ''}${READY_TEXT}`);
  }

  // The live region is filled a moment after it is cleared, so the same
  // sentence is announced again
  function announce(text) {
    status.textContent = '';
    setTimeout(() => { if (status.isConnected) status.textContent = text; }, 50);
  }

  // Polling: the active draft and any of the caller's drafts the server last
  // reported as drafting (the server decides when one has run too long)
  function watched() {
    const ids = new Set(recent.filter((r) => draftState(r) === 'drafting').map((r) => r.id));
    if (active) ids.add(active.id);
    return [...ids];
  }

  function schedulePoll(soon = false) {
    clearTimeout(pollTimer);
    pollTimer = null;
    if (!alive() || !watched().length) return;
    pollTimer = setTimeout(pollOnce, soon ? Math.min(POLL_MS, 2000) : POLL_MS);
  }

  // Only a 404 means the draft is gone; anything else that is not a 200
  // (offline, 400, 401, 403, 429, 5xx) is asked about again next time
  async function pollOnce() {
    pollTimer = null;
    for (const id of watched()) {
      if (!alive()) return;
      const res = await draftStatus(id);
      if (!alive()) return;
      const outcome = pollOutcome(res.status);
      if (outcome === 'retry') continue;
      const next = outcome === 'apply' ? res.body : { status: 'failed', error: GONE_ERROR };
      const status = draftState(next);
      const row = recent.find((r) => r.id === id);
      if (row) Object.assign(row, { status, error: next.error ?? null, title: next.result?.title ?? row.title ?? null });
      if (active?.id === id && status !== 'drafting') finish(active, status, next);
    }
    renderRecent();
    schedulePoll();
  }

  // The panel's own draft is done. It fills the form only while the form is
  // still on the student it was drafted for; otherwise it waits in Recent drafts.
  function finish(job, status, next) {
    active = null;
    setDrafting(false);
    const here = getStudentId();
    const sameStudent = job.studentId === null || job.studentId === undefined
      ? !here
      : here !== null && here !== undefined && String(here) === String(job.studentId);
    if (status === 'ready' && !sameStudent) {
      const text = elsewhereText(names.get(String(job.studentId)) ?? null);
      elsewhere.lastChild.textContent = text;
      elsewhere.hidden = false;
      announce(text);
      return;
    }
    if (status === 'ready') fill(next.result);
    else showError(next.error || 'The draft did not finish. Try again.');
  }

  // Recent drafts -----------------------------------------------------------
  function ensureRecent() {
    recentLoad ??= loadRecent().then((ok) => {
      if (!ok) recentLoad = null;
      return ok;
    }, (error) => {
      console.error(error);
      recentLoad = null;
      return false;
    });
    return recentLoad;
  }

  // -> true when the list loaded
  async function loadRecent() {
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
    const [list, ws] = await Promise.all([
      sb.from('homework_drafts').select(LIST_FIELDS).eq('created_by', dctx.me?.id).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(20),
      dctx.store?.getWorkspace?.().catch(() => null) ?? null,
    ]);
    if (!alive()) return false;
    if (list.error) {
      console.error(list.error);
      return false;
    }
    names = new Map((ws?.students ?? []).map((s) => [String(s.id), displayName(s)]));
    const known = new Set(recent.map((r) => r.id));
    recent = [...recent, ...(list.data ?? []).filter((r) => !known.has(r.id))];
    // A draft for this student still drafting (the form was closed while it ran) is picked up again
    if (!active) {
      const again = activeDraft(recent, { studentId: getStudentId() });
      if (again) {
        active = { id: again.id, studentId: again.student_id ?? null, startedAt: Date.parse(again.created_at) || Date.now() };
        announce(DRAFTING_TEXT);
        setDrafting(true);
      }
    }
    renderRecent();
    schedulePoll(true);
    return true;
  }

  async function openDraft(row, trigger) {
    trigger.disabled = true;
    const res = await draftStatus(row.id);
    if (!alive()) return;
    trigger.disabled = false;
    if (res.status === 200 && res.body.status === 'ready') {
      elsewhere.hidden = true;
      fill(res.body.result);
      return;
    }
    showError(res.body?.error || 'This draft could not be opened.', { retry: false });
  }

  async function removeDraft(row) {
    const ok = await dctx.confirm?.({
      title: 'Delete this draft?',
      body: 'It is removed from Recent drafts. An assignment you already created from it stays.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok === false || !alive()) return;
    const result = await sb.from('homework_drafts').delete().eq('id', row.id).select('id');
    if (!alive()) return;
    if (result.error) {
      console.error(result.error);
      showError('We couldn’t delete that draft. Try again.', { retry: false });
      return;
    }
    if (active?.id === row.id) {
      active = null;
      setDrafting(false);
    }
    elsewhere.hidden = true;
    recent = recent.filter((r) => r.id !== row.id);
    renderRecent();
    announce('Draft deleted.');
    draftBtn.focus();
  }

  function renderRecent() {
    const now = new Date();
    const rows = recentDrafts(recent, { studentId: getStudentId(), now });
    recentBox.hidden = rows.length === 0;
    recentList.replaceChildren(...rows.map((row) => {
      const state = draftState(row);
      const who = names.get(String(row.student_id)) ?? null;
      const title = state === 'ready' && row.title ? String(row.title)
        : state === 'drafting' ? 'New draft' : state === 'failed' ? 'No draft' : 'Draft';
      const meta = [who, optionsText(row.options ?? {}), relativeTime(row.created_at, now).text].filter(Boolean).join(', ');
      const tone = state === 'ready' ? { tone: 'success', icon: 'check-circle', label: 'Ready' }
        : state === 'drafting' ? { tone: 'info', icon: 'hourglass-medium', label: 'Drafting' }
          : { tone: 'danger', icon: 'warning-circle', label: 'Failed' };
      const openBtn = state === 'ready'
        ? button({ label: 'Open', size: 'sm', ariaLabel: `Open the draft ${title}`, onClick: (e) => openDraft(row, e.currentTarget) })
        : null;
      const why = state === 'failed' ? row.error : null;
      return h('li', { class: 'hwd-recent-item' },
        h('span', { class: 'hwd-recent-main' },
          h('span', { class: 'hwd-recent-name' }, title),
          h('span', { class: 'hwd-recent-meta' }, meta),
          why ? h('span', { class: 'hwd-recent-why' }, why) : null),
        pill(tone),
        h('span', { class: 'hwd-recent-actions' },
          openBtn,
          iconButton({ icon: 'trash', label: `Delete the draft from ${relativeTime(row.created_at, now).text}`, tip: 'left', onClick: () => removeDraft(row) })));
    }));
  }

  renderPhotos();
  return {
    opener,
    root,
    open,
    // The photos as files to attach to the assignment, when the box is ticked
    attachFiles() {
      if (!attachBox.checked) return [];
      return photos.map((p, i) => new File([p.blob], `Lesson photo ${i + 1}.jpg`, { type: 'image/jpeg' }));
    },
    photoCount: () => photos.length,
    // How many photos will be attached (0 unless the box is ticked)
    attachCount: () => (attachBox.checked ? photos.length : 0),
    // When the form opens: a draft for this student still drafting, or one
    // just finished, opens the panel by itself (the tutor left while it ran)
    async peek() {
      if (!(await ensureRecent()) || !alive() || !root.hidden) return;
      if (shouldReopen(recent, { studentId: getStudentId() })) open();
    },
    hasDraft: () => filled,
    // The student changed in the form: the context and the list order follow
    studentChanged() {
      if (root.hidden) return;
      paintContext();
      renderRecent();
    },
  };
}
