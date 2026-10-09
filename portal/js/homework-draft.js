// "Draft homework from lesson materials": the panel inside the staff create
// form (item-form.js). Staff only: item-form.js is imported with import() on
// staff paths (item-drawer.js), so student.html and parent.html never fetch
// this module; a test walks their static imports to keep it that way.
//
// draftPanel(dctx, { getStudentId, getContext, onFill, onDiscard, onBusy, attachRoom }) ->
//   { opener, root, open(), peek(), attachFiles(), attachCount(), sourceCount(), studentChanged() }
//   opener        the button that opens the panel (the form places it)
//   root          the panel (hidden until opened)
//   getStudentId  () -> the form's student id now, or null
//   getContext    async (studentId) -> { subject, grade } sent as context
//   onFill        ({ title, details, answerKey }) when a draft is ready or opened
//   onDiscard     () -> whether the form still holds an earlier draft
//   onBusy        (on) while a draft for this form runs (the form locks its student)
//   attachRoom    () -> how many lesson files may still be attached (MAX_ATTACHMENTS less the files)
//   onPreview     async () opens the worksheet the form would make (Preview worksheet)
//   attachFiles   the files to attach when "Attach these to the assignment" is
//                 ticked: photos (as the JPEGs they became), PDFs, Word and
//                 PowerPoint files; the other kinds can't be attachments
//
// The tutor adds photos, PDFs, Word, PowerPoint, Excel, OpenDocument and text
// files (draft-sources-model.js has the kinds and limits), or pastes lesson
// notes. Photos are shrunk here; a PDF's pages are counted here. On Draft,
// each file is uploaded to the private draft-sources bucket under the tutor's
// own folder, with progress, and the paths go to POST /api/grade { action:
// 'draft_homework' }. The server reads the files, drafts, and deletes them;
// it answers 202 with an id, and the panel asks { action: 'draft_status', id }
// every few seconds ("Reading your files…", then "Drafting…") until the draft
// is ready or failed. It stops asking when the drawer closes; reopening the
// form shows Recent drafts (read from homework_drafts) and picks up a draft
// for this student that is still drafting. Nothing is saved as an assignment
// until the tutor creates it with the form's own button.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { sb } from './supabase.js';
import { SUPABASE_ANON_KEY } from './config.js';
import { button, iconButton, field, select, pill, setFieldError, busy } from './ui.js';
import { fileDrop } from './file-drop.js';
import { relativeTime } from './dates.js';
import { displayName } from './format.js';
import { materialType } from './materials-model.js';
import {
  SHRINK, MIN_PROBLEMS, MAX_PROBLEMS, DEFAULT_PROBLEMS, MAX_NOTES, DIFFICULTIES, POLL_MS, RECENT_DAYS,
  READY_TEXT, GONE_ERROR, SLOW_TEXT,
  fitSize, photoFileName, stageText, checkOptions, draftRequest, contextText,
  formFromDraft, draftState, elapsedText, recentDrafts, optionsText, activeDraft, shouldReopen,
  pollOutcome, tokenNeedsRefresh, elsewhereText,
} from './homework-draft-model.js';
import {
  SOURCE_BUCKET, SOURCE_ACCEPT, SOURCE_KINDS, MAX_SOURCE_FILES, MAX_PASTED_NOTES, REFUSED,
  classifyFile, fileProblem, sourcesProblem, sizeText, pagesText, draftKey, sourcePath,
} from './draft-sources-model.js';
import { pdfFacts } from './pdf-pages.js';

const LIST_FIELDS = 'id, student_id, status, options, error, created_at, finished_at, title:result->title';
const START_FAILED = 'We couldn’t start the draft. Check your connection and try again.';
const UPLOAD_FAILED = 'This file could not be uploaded. Check your connection and try again.';

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
// Files

// One photo drawn on a canvas as a JPEG at most SHRINK.maxEdge on the long
// edge. Drawing drops everything but the pixels, EXIF and location included.
// A HEIC photo works where the browser can open it (Safari).
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = fitSize(bitmap.width, bitmap.height, SHRINK.maxEdge);
  const offscreen = typeof OffscreenCanvas !== 'undefined';
  const canvas = offscreen ? new OffscreenCanvas(width, height) : h('canvas', { width, height });
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';   // transparent areas become white, not black
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = offscreen
    ? await canvas.convertToBlob({ type: 'image/jpeg', quality: SHRINK.quality })
    : await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', SHRINK.quality));
  if (!blob || blob.type !== 'image/jpeg') throw new Error('not a JPEG');
  return blob;
}

// zlib inflate in the browser, for the compressed parts of a PDF (at most max bytes)
async function inflate(bytes, max) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    let step;
    try {
      step = await reader.read();
    } catch (error) {
      // Bytes after the end of the data (a line end before endstream): keep what came out
      if (size) break;
      throw error;
    }
    const { done, value } = step;
    if (done) break;
    size += value.length;
    if (size > max) {
      reader.cancel().catch(() => {});
      throw new Error('too large');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/**
 * Uploads one file to the draft-sources bucket with progress. On the live
 * site this is a request to Storage (supabase-js has no upload progress);
 * the local demo's client has no Storage address, so it goes through
 * sb.storage there.
 */
async function uploadSource(path, blob, contentType, onProgress) {
  const base = sb.storage?.url;
  if (typeof base !== 'string' || !/^https:\/\//.test(base) || typeof XMLHttpRequest !== 'function') {
    const { error } = await sb.storage.from(SOURCE_BUCKET).upload(path, blob, { contentType, upsert: false, onProgress });
    if (error) throw new Error(error.message || 'upload failed');
    onProgress?.(1);
    return;
  }
  const token = await bearer();
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base}/object/${SOURCE_BUCKET}/${path}`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('content-type', contentType);
    xhr.setRequestHeader('cache-control', 'max-age=3600');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status === 401) refreshNext = true;
      if (xhr.status >= 200 && xhr.status < 300) { onProgress?.(1); resolve(); } else reject(new Error(`status ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.onabort = () => reject(new Error('aborted'));
    xhr.send(blob);
  });
}

async function removeUploaded(paths) {
  if (!paths.length) return;
  try {
    await sb.storage.from(SOURCE_BUCKET).remove(paths);
  } catch {
    /* the server's daily sweep removes them */
  }
}

// ---------------------------------------------------------------------------

export function draftPanel(dctx, {
  getStudentId = () => null, getContext = async () => ({}), onFill, onDiscard, onBusy, attachRoom = () => Infinity, onPreview = null,
} = {}) {
  const headingId = uid('hwd-head');
  // Each file: { id, name, kind, blob, mime, bytes, pages, url (photo thumbnail), error, progress, path }
  const items = [];
  let active = null;           // { id, studentId, startedAt, stage } while a draft of this panel is drafting
  let filled = false;          // the form holds a draft
  let adding = false;
  const queue = [];            // files chosen while earlier ones are still being read
  let starting = false;        // a draft is being uploaded or requested (one at a time)
  let recent = [];
  let names = new Map();
  let pollTimer = null;
  let tickTimer = null;
  let recentLoad = null;       // the Recent drafts query, once per form
  const alive = () => dctx.alive?.() !== false;
  const usable = () => items.filter((it) => !it.error);

  // Files --------------------------------------------------------------------
  const fileInput = h('input', {
    type: 'file', accept: SOURCE_ACCEPT, multiple: true, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true',
    dataset: { draftInput: 'files' },
  });
  const cameraInput = h('input', {
    type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true',
  });
  const chips = h('ul', { class: 'hwd-chips', 'aria-label': 'Lesson files', hidden: true });
  const fileProblemSlot = h('div', { class: 'hwd-photo-problem' });
  const addBtn = button({ label: 'Add files', icon: 'paperclip', size: 'sm', onClick: () => fileInput.click(), focusKey: 'hwd-add' });
  const cameraBtn = button({ label: 'Take a photo', icon: 'image-square', size: 'sm', className: 'hwd-camera', onClick: () => cameraInput.click() });
  const sourceField = h('div', { class: 'field hwd-photos' },
    h('span', { class: 'field-label', id: `${headingId}-files` }, 'Lesson materials'),
    chips,
    h('div', { class: 'hwd-photo-actions' }, addBtn, cameraBtn, fileInput, cameraInput),
    h('p', { class: 'field-hint' }, `Photos of the whiteboard or worksheet, PDFs, Word, PowerPoint, Excel or text files: up to ${MAX_SOURCE_FILES}, 25 MB in all. Photos are made smaller in your browser. Files are read for this draft only and deleted right after. You can also drag files here or paste a screenshot.`),
    fileProblemSlot);

  const pastedInput = h('textarea', { class: 'input textarea hwd-pasted', name: 'draft_lesson_notes', rows: '4', maxlength: String(MAX_PASTED_NOTES) });
  const pastedField = field({
    label: 'Or paste lesson notes', optional: true, control: pastedInput,
    hint: `Text from a Google Doc, your notes or the lesson plan, up to ${MAX_PASTED_NOTES.toLocaleString('en-US')} characters.`,
  });

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
  const statusText = h('span', { class: 'hwd-status-text' }, stageText('drafting'));
  const statusBox = h('div', { class: 'hwd-status-box', hidden: true, 'aria-hidden': 'true' },
    h('span', { class: 'hwd-spinner' }),
    h('span', { class: 'hwd-status-words' }, statusText, h('span', { class: 'hwd-status-sub' }, SLOW_TEXT)),
    timer);
  const errorSlot = h('div', { class: 'hwd-error' });
  // Staff only: problems the server left out to fit the assignment, and parts of files it could not use
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
    const btn = button({ label: 'Preview worksheet', icon: 'corners-out', size: 'sm', focusKey: 'hwd-preview' });
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
      h('h3', { class: 'hwd-title', id: headingId, tabindex: '-1' }, 'Draft homework from lesson materials'),
      closeBtn),
    h('p', { class: 'hwd-lede' }, 'The AI writes a full problem set on the skills in your lesson: a warm-up, a worked example, practice, a word problem, a challenge and a reflection, with an answer key only staff see. Nothing is saved until you create the assignment.'),
    sourceField,
    pastedField,
    h('div', { class: 'hwd-options' },
      h('div', { class: 'hwd-option-row' }, countField, levelField),
      h('label', { class: 'check' }, hintsBox, h('span', {}, 'Include worked hints')),
      h('label', { class: 'check' }, challengeBox, h('span', {}, 'Include a challenge problem')),
      notesField),
    contextNote,
    h('label', { class: 'check hwd-attach' }, attachBox, h('span', {}, 'Attach these to the assignment for the student (photos, PDFs, Word and PowerPoint files)')),
    h('div', { class: 'hwd-actions' }, draftBtn),
    status, statusBox, errorSlot, elsewhere, resultBar, recentBox);

  const opener = button({
    label: 'Draft with AI from lesson materials', icon: 'note-pencil', size: 'sm', className: 'hwd-opener', focusKey: 'hwd-open',
    onClick: () => open({ focus: true }),
  });

  // Enter in a panel field never submits the form around it
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    e.stopPropagation();
  });
  // A file or screenshot pasted into the panel is a lesson file, not an
  // attachment; pasted text still goes into the field
  root.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    addFiles(files);
  });
  fileDrop(sourceField, { onFiles: (files) => addFiles(files), enabled: () => !starting, label: 'Drop files to add them', iconName: 'paperclip' });
  for (const input of [fileInput, cameraInput]) {
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      input.value = '';
      if (files.length) addFiles(files);
    });
  }
  // Ticking "Attach these" must leave room within the assignment's attachments
  attachBox.addEventListener('change', () => {
    renderChips();
    if (!attachBox.checked) return;
    const room = attachRoom();
    const want = attachable().length;
    if (want <= room) {
      showFileProblem('');
      return;
    }
    attachBox.checked = false;
    renderChips();
    showFileProblem(room > 0
      ? `Only ${room} more ${room === 1 ? 'attachment fits' : 'attachments fit'} on this assignment (at most 10 in all). Remove a file under Attachments or a lesson file here, then tick it again.`
      : 'This assignment already has 10 attachments, the most it can have. Remove a file under Attachments to attach these.');
  });
  countInput.addEventListener('input', () => setFieldError(countField, ''));
  notesInput.addEventListener('input', () => setFieldError(notesField, ''));
  pastedInput.addEventListener('input', () => setFieldError(pastedField, ''));
  dctx.signal?.addEventListener('abort', stop, { once: true });

  // The kinds an assignment can hold as attachments (materials-model.js)
  const canAttach = (it) => Boolean(materialType({ type: it.mime, name: it.name }));
  const attachable = () => usable().filter(canAttach);

  function metaText(it) {
    return [SOURCE_KINDS[it.kind]?.label, it.bytes ? sizeText(it.bytes) : '', it.kind === 'pdf' ? pagesText(it.pages) : ''].filter(Boolean).join(', ');
  }

  function renderChips() {
    chips.replaceChildren(...items.map((it) => {
      const lead = it.url
        ? h('img', { class: 'hwd-chip-thumb', src: it.url, alt: '', width: '36', height: '36', decoding: 'async' })
        : h('span', { class: 'hwd-chip-icon' }, icon(it.error ? 'warning-circle' : SOURCE_KINDS[it.kind]?.icon ?? 'file-text', { size: 20 }));
      const uploading = typeof it.progress === 'number';
      const bar = uploading
        ? h('span', {
          class: 'hwd-chip-bar', role: 'progressbar', 'aria-label': `Uploading ${it.name}`,
          'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(it.progress * 100)),
        }, h('span', { class: 'hwd-chip-fill' }))
        : null;
      if (bar) bar.firstChild.style.setProperty('--hwd-progress', String(it.progress));
      it.bar = bar;
      const note = attachBox.checked && !it.error && !canAttach(it) ? h('span', { class: 'hwd-chip-note' }, 'Can’t be attached') : null;
      return h('li', { class: `hwd-chip${it.error ? ' is-error' : ''}`, dataset: { kind: it.kind ?? 'unknown' } },
        lead,
        h('span', { class: 'hwd-chip-main' },
          h('span', { class: 'hwd-chip-name', title: it.name }, it.name),
          h('span', { class: 'hwd-chip-meta' }, it.error ? '' : metaText(it)),
          bar,
          note,
          it.error ? h('span', { class: 'hwd-chip-error' }, it.error) : null),
        iconButton({
          icon: 'x', label: `Remove ${it.name}`, tip: 'top', className: 'hwd-chip-remove',
          onClick: () => removeItem(it),
        }));
    }));
    chips.hidden = items.length === 0;
    const count = usable().length;
    attachBox.disabled = attachable().length === 0;
    if (attachBox.disabled) attachBox.checked = false;
    addBtn.disabled = count >= MAX_SOURCE_FILES || starting;
    cameraBtn.disabled = count >= MAX_SOURCE_FILES || starting;
  }

  function removeItem(it) {
    if (starting) return;
    const i = items.indexOf(it);
    if (i < 0) return;
    items.splice(i, 1);
    if (it.url) URL.revokeObjectURL(it.url);
    renderChips();
    showFileProblem('');
    addBtn.focus();
  }

  function showFileProblem(text) {
    fileProblemSlot.replaceChildren(text ? h('p', { class: 'field-error', role: 'alert' }, icon('warning-circle'), h('span', {}, text)) : '');
  }

  // One chosen file -> an item, with an error when it can't be used
  async function readFile(file) {
    const name = file.name || 'Pasted picture';
    const kind = classifyFile(file);
    if (kind.refused) return { id: uid('hwd-file'), name, kind: null, error: kind.refused };
    const base = { id: uid('hwd-file'), name, kind: kind.kind, error: null, pages: null, url: null };
    const tooBig = fileProblem(file, kind.kind);
    if (tooBig) return { ...base, error: tooBig };
    if (kind.kind === 'image') {
      try {
        const blob = await shrinkPhoto(file);
        return { ...base, blob, mime: 'image/jpeg', bytes: blob.size, url: URL.createObjectURL(blob) };
      } catch {
        return { ...base, error: kind.heic ? REFUSED.heic : 'This photo could not be opened. Try a JPG or PNG.' };
      }
    }
    const mime = SOURCE_KINDS[kind.kind].mime;
    const blob = new Blob([file], { type: mime });
    if (kind.kind === 'pdf') {
      try {
        const facts = await pdfFacts(new Uint8Array(await file.arrayBuffer()), { inflate });
        if (facts.encrypted) return { ...base, error: REFUSED.encrypted };
        return { ...base, blob, mime, bytes: file.size, pages: facts.pages };
      } catch {
        return { ...base, error: 'This PDF could not be opened. Save a new copy and add it again.' };
      }
    }
    return { ...base, blob, mime, bytes: file.size };
  }

  // Files chosen while others are still being read wait their turn
  async function addFiles(files) {
    if (starting) return;
    queue.push(...files);
    if (adding) return;
    adding = true;
    root.setAttribute('aria-busy', 'true');
    let tooMany = 0;
    try {
      while (queue.length && alive()) {
        const file = queue.shift();
        if (usable().length >= MAX_SOURCE_FILES) { tooMany += 1; continue; }
        const item = await readFile(file);
        // The drawer may have closed while it was read: no link to free later
        if (!alive()) { if (item.url) URL.revokeObjectURL(item.url); break; }
        if (!item.error) {
          const together = sourcesProblem([...usable(), item]);
          if (together) item.error = together;
        }
        if (item.error && item.url) { URL.revokeObjectURL(item.url); item.url = null; }
        items.push(item);
        renderChips();
      }
    } finally {
      adding = false;
      root.removeAttribute('aria-busy');
    }
    if (!alive()) {
      // stop() ran while files were being added: free every link, the late ones too
      queue.length = 0;
      for (const it of items) if (it.url) URL.revokeObjectURL(it.url);
      return;
    }
    renderChips();
    const refused = items.filter((it) => it.error).length;
    showFileProblem([
      tooMany ? `Add at most ${MAX_SOURCE_FILES} files to one draft.` : '',
      refused ? `${refused === 1 ? 'One file' : `${refused} files`} can’t be used. ${refused === 1 ? 'It says' : 'Each says'} why; remove ${refused === 1 ? 'it' : 'them'} or add another.` : '',
    ].filter(Boolean).join(' '));
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
    contextNote.lastChild.textContent = text ? `Sent with the files: ${text}.` : '';
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
    for (const it of items) if (it.url) URL.revokeObjectURL(it.url);
  }

  // Drafting ----------------------------------------------------------------
  function showStage(stage) {
    statusText.textContent = stageText(stage);
  }

  function setDrafting(on, stage = 'drafting') {
    draftBtn.disabled = on;
    if (on) draftBtn.setAttribute('aria-busy', 'true');
    else draftBtn.removeAttribute('aria-busy');
    draftBtn.querySelector('.btn-label').textContent = on ? 'Drafting…' : 'Draft homework';
    statusBox.hidden = !on;
    showStage(stage);
    onBusy?.(on);
    clearInterval(tickTimer);
    tickTimer = null;
    if (on && active) {
      const tick = () => { timer.textContent = elapsedText(Date.now() - active.startedAt); };
      tick();
      tickTimer = setInterval(tick, 1000);
    } else {
      timer.textContent = '';
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
      for (const it of items) delete it.progress;
      if (alive()) renderChips();
    }
  }

  // Uploads every usable file into a new folder of the tutor's -> the sources, or null (shown why)
  async function uploadAll() {
    const me = dctx.me?.id;
    const key = draftKey();
    const list = usable();
    const done = [];
    list.forEach((it) => { it.progress = 0; });
    renderChips();
    for (const [i, it] of list.entries()) {
      const path = sourcePath(me, key, i + 1, it.kind === 'image' ? photoFileName(it.name, i + 1) : it.name);
      try {
        await uploadSource(path, it.blob, it.mime, (p) => {
          it.progress = Math.max(0, Math.min(1, Number(p) || 0));
          it.bar?.setAttribute('aria-valuenow', String(Math.round(it.progress * 100)));
          it.bar?.firstChild.style.setProperty('--hwd-progress', String(it.progress));
        });
      } catch {
        await removeUploaded(done.map((s) => s.path));
        if (!alive()) return null;
        it.error = UPLOAD_FAILED;
        renderChips();
        return null;
      }
      if (!alive()) {
        await removeUploaded([...done.map((s) => s.path), path]);
        return null;
      }
      done.push({ path, name: it.name, kind: it.kind });
    }
    return done;
  }

  async function startOnce() {
    errorSlot.replaceChildren();
    const checked = checkOptions({
      count: countInput.value, difficulty: levelSelect.value, hints: hintsBox.checked, challenge: challengeBox.checked, notes: notesInput.value,
    });
    setFieldError(countField, checked.errors.count ?? '');
    setFieldError(notesField, checked.errors.notes ?? '');
    const pasted = pastedInput.value.trim();
    if (!usable().length && !pasted) {
      showFileProblem(adding ? 'Wait for the files to finish adding.' : 'Add at least one lesson file or photo, or paste lesson notes.');
      addBtn.focus();
      return;
    }
    if (pasted.length > MAX_PASTED_NOTES) {
      setFieldError(pastedField, `Keep the pasted notes under ${MAX_PASTED_NOTES.toLocaleString('en-US')} characters.`);
      pastedInput.focus();
      return;
    }
    const together = sourcesProblem(usable());
    if (together) { showFileProblem(together); addBtn.focus(); return; }
    if (checked.errors.count) { countInput.focus(); return; }
    if (checked.errors.notes) { notesInput.focus(); return; }
    showFileProblem('');
    const studentId = getStudentId();
    const context = await paintContext();
    draftBtn.disabled = true;
    statusBox.hidden = false;
    showStage('uploading');
    timer.textContent = '';
    renderChips();
    announce(stageText('uploading'));
    const sources = usable().length ? await uploadAll() : [];
    if (!alive()) return;
    if (!sources) {
      statusBox.hidden = true;
      draftBtn.disabled = false;
      showError(UPLOAD_FAILED, { retry: true });
      return;
    }
    const res = await startDraft(draftRequest({ sources, notesText: pasted, options: checked.values, context, studentId }));
    if (!alive()) return;
    draftBtn.disabled = false;
    if (res.status !== 202 || !Number.isSafeInteger(res.body?.id)) {
      statusBox.hidden = true;
      await removeUploaded(sources.map((s) => s.path));
      showError(res.body?.error || START_FAILED, { retry: false });
      return;
    }
    const stage = res.body.stage === 'reading' ? 'reading' : 'drafting';
    active = { id: res.body.id, studentId, startedAt: Date.now(), stage };
    elsewhere.hidden = true;
    recent = [{ id: res.body.id, student_id: studentId, status: 'drafting', options: { ...checked.values, files: sources.length }, error: null, created_at: res.body.created_at ?? new Date().toISOString(), title: null }, ...recent.filter((r) => r.id !== res.body.id)];
    resultBar.hidden = true;
    announce(stageText(stage));
    setDrafting(true, stage);
    renderRecent();
    schedulePoll(true);
  }

  function tryAgain() {
    if (!usable().length && !pastedInput.value.trim()) {
      showError('Add the lesson files again to draft again. Files are not kept after the form closes.', { retry: false });
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
      if (active?.id === id && status === 'drafting' && next.stage && next.stage !== active.stage) {
        active.stage = next.stage;
        showStage(next.stage);
        announce(stageText(next.stage));
      }
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
    if (!active && !starting) {
      const again = activeDraft(recent, { studentId: getStudentId() });
      if (again) {
        active = { id: again.id, studentId: again.student_id ?? null, startedAt: Date.parse(again.created_at) || Date.now(), stage: 'drafting' };
        announce(stageText('drafting'));
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

  renderChips();
  return {
    opener,
    root,
    open,
    // The lesson files to attach to the assignment, when the box is ticked:
    // photos as the JPEGs they became, and the PDFs, Word and PowerPoint files
    attachFiles() {
      if (!attachBox.checked) return [];
      return attachable().map((it, i) => new File([it.blob], it.kind === 'image' ? photoFileName(it.name, i + 1) : it.name, { type: it.mime }));
    },
    sourceCount: () => usable().length,
    // How many lesson files will be attached (0 unless the box is ticked)
    attachCount: () => (attachBox.checked ? attachable().length : 0),
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
