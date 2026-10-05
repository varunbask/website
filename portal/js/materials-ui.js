// The materials section of a drawer: slides, handouts and links on a session,
// or worksheets on an assignment (materials-model.js holds the rules).
//
// materialsSection(dctx, { studentId, sessionId | taskId, items, canEdit,
//   heading, emptyText, keyPrefix }) -> HTMLElement | null
//
// Everyone who can see the student opens what is there; staff who may change
// the session or assignment (canEdit) add files and links and remove them.
// Files open from short-lived signed links, signed again when they are stale.
// Each change invalidates the student's data, so the drawer redraws from the
// store; null comes back when there is nothing to show a family.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { sb } from './supabase.js';
import { button, iconButton, field, setFieldError, busy } from './ui.js';
import {
  MATERIALS_BUCKET, MATERIAL_ACCEPT, SIGN_SECONDS, RESIGN_AFTER_MS,
  materialType, validateMaterialFile, materialPath, titleFromFile, validateLink,
  isLink, materialIcon, materialMeta, downloadName,
} from './materials-model.js';

// Office files download (a browser cannot show them), so their copy is named
// after the title; PDFs and images open in the tab
const PREVIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg']);

async function sign(material) {
  const options = PREVIEWABLE.has(material.file_type) ? undefined : { download: downloadName(material) };
  const { data, error } = await sb.storage.from(MATERIALS_BUCKET).createSignedUrl(material.storage_path, SIGN_SECONDS, options);
  if (error) throw error;
  return data.signedUrl;
}

// Uploads files to the materials bucket and adds a material row for each, on
// a session ({ session_id }) or an assignment ({ task_id }). A file that fails
// is reported, never half added: its upload is removed when the row fails.
// -> { added, problems: ['name: what went wrong'], rows: [the rows added] }
export async function uploadMaterialFiles({ studentId, owner, files }) {
  const problems = [];
  const rows = [];
  let added = 0;
  for (const file of files) {
    const message = validateMaterialFile(file);
    if (message) {
      problems.push(`${file.name}: ${message}`);
      continue;
    }
    const mime = materialType(file);
    const path = materialPath(studentId, mime);
    // storage-js sends a File with its own type and ignores contentType, and
    // some systems give Office files none: re-wrap it with the type we chose
    const body = file.type === mime ? file : new Blob([file], { type: mime });
    const up = await sb.storage.from(MATERIALS_BUCKET).upload(path, body, { contentType: mime, upsert: false });
    if (up.error) {
      problems.push(`${file.name}: the upload failed.`);
      continue;
    }
    const row = {
      student_id: studentId, ...owner,
      title: titleFromFile(file.name), storage_path: path, file_type: mime, size_bytes: file.size,
    };
    const ins = await sb.from('materials').insert(row).select('id');
    if (ins.error || !ins.data?.length) {
      sb.storage.from(MATERIALS_BUCKET).remove([path]).catch(() => {});
      problems.push(`${file.name}: it could not be added.`);
      continue;
    }
    added += 1;
    rows.push(row);
  }
  return { added, problems, rows };
}

// Copies files already added (rows from uploadMaterialFiles) onto more
// assignments: the copies of a repeating one. Each copy is its own file,
// copied inside storage (nothing uploads again), so removing one assignment
// or its file never touches the others. A copy that fails is reported; its
// file is removed when its row cannot be added.
// owners: [{ task_id }]  -> { added, problems: ['name: what went wrong'] }
export async function copyMaterialFiles({ studentId, rows, owners }) {
  const bucket = sb.storage.from(MATERIALS_BUCKET);
  const jobs = owners.flatMap((owner) => rows.map((row) => ({ owner, row })));
  const failed = new Map();   // title -> copies that failed
  const fail = (row) => failed.set(row.title, (failed.get(row.title) ?? 0) + 1);
  const made = [];
  // A few at a time, so a long series does not flood storage with requests
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { owner, row } = jobs[next++];
      const path = materialPath(studentId, row.file_type);
      const copy = await bucket.copy(row.storage_path, path).catch((error) => ({ error }));
      if (copy.error) {
        fail(row);
        continue;
      }
      made.push({ ...row, ...owner, storage_path: path });
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
  let added = 0;
  if (made.length) {
    const ins = await sb.from('materials').insert(made).select('id');
    if (ins.error || (ins.data?.length ?? 0) !== made.length) {
      bucket.remove(made.map((m) => m.storage_path)).catch(() => {});
      for (const m of made) fail(m);
    } else {
      added = made.length;
    }
  }
  const problems = [...failed].map(([title, n]) => `${title}: ${n === 1 ? '1 copy' : `${n} copies`} could not be added.`);
  return { added, problems };
}

// One toast line for files that were not added
export function problemsText(problems) {
  return problems.length === 1 ? `Not added. ${problems[0]}` : `${problems.length} files were not added. ${problems[0]}`;
}

// A pasted screenshot arrives as "image.png"; give it a name worth showing
export function namePastedImage(file, n = 1) {
  if (file.name && file.name !== 'image.png' && file.name !== 'image.jpg') return file;
  const ext = file.type === 'image/png' ? 'png' : 'jpg';
  return new File([file], `Screenshot${n > 1 ? ` ${n}` : ''}.${ext}`, { type: file.type });
}

export function materialsSection(dctx, {
  studentId, sessionId = null, taskId = null, items = [], canEdit = false,
  heading = 'Slides and materials', emptyText = 'No slides or files yet.', keyPrefix = 'mat',
} = {}) {
  if (!canEdit && !items.length) return null;
  const headingId = uid('mat-head');
  const errorSlot = h('div', { class: 'mat-error' });
  const owner = sessionId !== null ? { session_id: sessionId } : { task_id: taskId };

  const showError = (text) => errorSlot.replaceChildren(text
    ? h('p', { class: 'field-error', role: 'alert' }, icon('warning-circle'), h('span', {}, text))
    : '');

  // ---- Rows ----------------------------------------------------------------

  function row(m) {
    const glyph = h('span', { class: 'mat-icon', 'aria-hidden': 'true' }, icon(materialIcon(m), { size: 20 }));
    const open = h('a', {
      class: 'mat-open',
      target: '_blank',
      rel: 'noopener noreferrer',
      href: isLink(m) ? m.url : undefined,
      dataset: { focusKey: `${keyPrefix}-open-${m.id}` },
    }, h('span', { class: 'mat-title' }, m.title), h('span', { class: 'mat-meta' }, materialMeta(m)));

    if (!isLink(m)) {
      // Signed now so a plain click (or middle click) just works; signed again
      // on click once the link is older than 8 minutes
      let signedAt = 0;
      const refresh = async () => {
        const url = await sign(m);
        open.href = url;
        signedAt = Date.now();
        return url;
      };
      const stale = () => !signedAt || Date.now() - signedAt >= RESIGN_AFTER_MS;
      refresh().catch(() => { /* signed on click instead */ });
      // Middle-click and "Open in new tab" use the href as it is, so a stale
      // link is signed again when the pointer or focus reaches it
      const warm = () => { if (stale()) refresh().catch(() => {}); };
      open.addEventListener('pointerenter', warm);
      open.addEventListener('focus', warm);
      open.addEventListener('click', async (event) => {
        if (!stale()) return;
        event.preventDefault();
        try {
          window.open(await refresh(), '_blank', 'noopener');
        } catch (error) {
          console.error(error);
          showError('This file could not be opened. Try again.');
        }
      });
    }

    const remove = canEdit
      ? iconButton({
        icon: 'trash',
        label: `Remove ${m.title}`,
        tip: 'left',
        className: 'mat-remove',
        focusKey: `${keyPrefix}-remove-${m.id}`,
        onClick: () => removeMaterial(m),
      })
      : null;
    return h('li', { class: 'mat-item' }, glyph, open, remove);
  }

  // ---- Changes -------------------------------------------------------------

  async function removeMaterial(m) {
    const ok = await dctx.confirm({
      title: `Remove “${m.title}”?`,
      body: 'The student and family will no longer see it.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok || !dctx.alive()) return;
    const { data, error } = await sb.from('materials').delete().eq('id', m.id).select('id');
    if (error || !data?.length) {
      showError(error ? 'That didn’t remove. Try again.' : 'This was changed or removed. Refresh the page and try again.');
      return;
    }
    // The row is gone, so nobody can open the file; clearing it is best effort
    if (m.storage_path) sb.storage.from(MATERIALS_BUCKET).remove([m.storage_path]).catch(() => {});
    dctx.toast({ text: 'Removed' });
    dctx.store.invalidate(studentId);
  }

  const fileInput = h('input', { type: 'file', multiple: true, accept: MATERIAL_ACCEPT, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });

  async function addFiles(files, btn) {
    let result = { added: 0, problems: [] };
    await busy(btn, 'Uploading…', async () => {
      result = await uploadMaterialFiles({ studentId, owner, files });
    });
    const { added, problems } = result;
    // Saved files must show next time even if the drawer closed meanwhile
    if (added) dctx.store.invalidate(studentId);
    if (!dctx.alive()) return;
    if (problems.length) {
      // The redraw replaces this section, so the problems go in a toast
      dctx.toast({ text: problemsText(problems) });
    }
    if (added) dctx.toast({ text: added === 1 ? 'File added' : `${added} files added` });
  }

  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (files.length) addFiles(files, addFilesBtn);
  });

  const addFilesBtn = canEdit ? button({
    label: 'Add files',
    icon: 'upload-simple',
    size: 'sm',
    focusKey: `${keyPrefix}-add-files`,
    onClick: () => fileInput.click(),
  }) : null;

  // The link form opens in place of the buttons
  const linkSlot = h('div', { class: 'mat-link-slot' });
  const addLinkBtn = canEdit ? button({
    label: 'Add a link',
    icon: 'link-simple',
    size: 'sm',
    focusKey: `${keyPrefix}-add-link`,
    onClick: () => openLinkForm(),
  }) : null;
  const actions = canEdit ? h('div', { class: 'mat-actions' }, addFilesBtn, addLinkBtn, fileInput) : null;

  function openLinkForm() {
    const urlInput = h('input', { class: 'input', type: 'url', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'https://', maxlength: '1000' });
    const titleInput = h('input', { class: 'input', type: 'text', autocomplete: 'off', maxlength: '200' });
    const urlField = field({ label: 'Link', control: urlInput, hint: 'Google Slides, Canva, a video or any https link.' });
    const titleField = field({ label: 'Title', optional: true, control: titleInput });
    const save = button({ label: 'Add link', variant: 'primary', size: 'sm', type: 'submit' });
    const cancel = button({ label: 'Cancel', variant: 'ghost', size: 'sm', onClick: close });
    const form = h('form', { class: 'mat-link-form', novalidate: true }, urlField, titleField,
      h('div', { class: 'mat-link-buttons' }, save, cancel));

    function close() {
      linkSlot.replaceChildren();
      actions.hidden = false;
      addLinkBtn.focus();
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const { ok, errors, values } = validateLink({ url: urlInput.value, title: titleInput.value });
      setFieldError(urlField, errors.url ?? '');
      setFieldError(titleField, errors.title ?? '');
      if (!ok) {
        (errors.url ? urlInput : titleInput).focus();
        return;
      }
      let failed = false;
      await busy(save, 'Adding…', async () => {
        const { data, error } = await sb.from('materials')
          .insert({ student_id: studentId, ...owner, title: values.title, url: values.url })
          .select('id');
        failed = Boolean(error || !data?.length);
      });
      if (!failed) dctx.store.invalidate(studentId);
      if (!dctx.alive()) return;
      if (failed) {
        setFieldError(urlField, 'The link could not be added. Try again.');
        return;
      }
      dctx.toast({ text: 'Link added' });
    });
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    });

    actions.hidden = true;
    linkSlot.replaceChildren(form);
    urlInput.focus();
  }

  // ---- Section -------------------------------------------------------------

  const list = items.length
    ? h('ul', { class: 'mat-list', 'aria-labelledby': headingId }, items.map(row))
    : h('p', { class: 'mat-empty' }, emptyText);
  const hint = canEdit
    ? h('p', { class: 'mat-hint' }, 'PDF, PowerPoint, Word or images, up to 25 MB each, or a link.')
    : null;

  return h('section', { class: 'drawer-section mat-section', 'aria-labelledby': headingId },
    h('h3', { id: headingId }, heading, items.length ? h('span', { class: 'mat-count num' }, String(items.length)) : null),
    list,
    errorSlot,
    actions,
    linkSlot,
    hint);
}
