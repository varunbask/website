// The "Worksheet" section of the item drawer, for an assignment with written
// details: Open, Print and Download the worksheet as a PDF, and Mark up (the
// student, who can hand it in from there, and staff, as a preview). Parents
// open, print and download. The worksheet code (worksheet.js, markup.js) loads
// with import() on the first click, so a drawer that never uses it never
// downloads it. Staff add buttons of their own through `extra` (the version
// with the answer key comes from answer-key.js, which only staff load).
//
// worksheetSection(dctx, { task, studentId, canMarkUp, canHandIn, attemptText,
//   onHandedIn, extra }) -> section.drawer-section

import { h } from './dom.js';
import { icon } from './icons.js';
import { button, busy } from './ui.js';
import { worksheetFileName, isAppleTouch } from './worksheet-model.js';
import { sendWork, handInFailure } from './submit-work.js';
import { validateUpload } from './upload.js';

const loadWorksheet = () => import('./worksheet.js');
const loadMarkup = () => import('./markup.js');
// Staff only: the document viewer (families keep Open, which opens a tab)
const loadViewer = () => import('./doc-viewer.js');
const FAILED = 'We couldn’t make the worksheet. Try again.';

// The PDF bytes for a task (and an appendix, for staff), built in the browser
export async function worksheetBytes(task, { appendix = null } = {}) {
  const ws = await loadWorksheet();
  const layout = await ws.buildLayout({ title: task.title, details: task.details, dueAt: task.due_at, appendix });
  return { ws, bytes: await ws.worksheetPdf(layout) };
}

// Opens a worksheet PDF in a new tab. The tab opens at the click (so a pop-up
// blocker lets it through) and gets the PDF once it is ready; without one, the
// PDF downloads instead. -> 'opened' | 'downloaded'
export async function openWorksheet(task, { appendix = null, host = document.body } = {}) {
  let win = null;
  try {
    win = window.open('', '_blank');
    if (win) win.document.title = 'Worksheet';
  } catch {
    win = null;
  }
  try {
    const { ws, bytes } = await worksheetBytes(task, { appendix });
    if (ws.openPdf(bytes, win)) return 'opened';
    ws.downloadPdf(bytes, worksheetFileName(task.title), host);
    return 'downloaded';
  } catch (error) {
    win?.close();
    throw error;
  }
}

function lineFor(role, canHandIn) {
  if (role === 'parent') return 'Print it so your child can fill it in on paper, then they take a photo or scan it to hand it in.';
  if (role === 'staff') return 'What the student sees. Print it for a lesson, or mark it up to try it out.';
  return canHandIn
    ? 'Print it and fill it in on paper, then take a photo or scan to hand it in. Or mark it up here.'
    : 'Print it and fill it in on paper, or open it to look over the problems.';
}

export function worksheetSection(dctx, {
  task, studentId, role = 'student', canMarkUp = false, canHandIn = false, attemptText = '', onHandedIn = null, extra = [], keyText = null,
} = {}) {
  const problem = h('div', { class: 'ws-problem' });
  const host = dctx.body ?? document.body;
  const fail = (error) => {
    console.error(error);
    if (problem.isConnected) {
      problem.replaceChildren(h('p', { class: 'field-error', role: 'alert' }, icon('warning-circle'), h('span', {}, FAILED)));
    }
  };
  const run = (btn, label, action) => async () => {
    problem.replaceChildren();
    try {
      await busy(btn, label, action);
    } catch (error) {
      fail(error);
    }
  };

  // Staff: Preview shows the document in the portal's own viewer; families: Open, in a new tab
  const staff = role === 'staff';
  const openBtn = staff
    ? button({ label: 'Preview', icon: 'corners-out', size: 'sm', focusKey: 'ws-open' })
    : button({ label: 'Open', icon: 'arrow-square-out', size: 'sm', focusKey: 'ws-open', ariaLabel: 'Open the worksheet, opens in a new tab' });
  openBtn.addEventListener('click', run(openBtn, 'Preparing…', async () => {
    if (staff) {
      const { openDocViewer } = await loadViewer();
      openDocViewer({
        source: { title: task.title, details: task.details, dueAt: task.due_at }, keyText, returnFocus: openBtn, toast: dctx.toast,
      });
      return;
    }
    const how = await openWorksheet(task, { host });
    if (how === 'downloaded') dctx.toast?.({ text: 'The worksheet downloaded, because a new tab could not open.' });
  }));

  const printBtn = button({ label: 'Print', icon: 'printer', size: 'sm', focusKey: 'ws-print' });
  printBtn.addEventListener('click', run(printBtn, 'Preparing…', async () => {
    const { ws, bytes } = await worksheetBytes(task);
    const how = await ws.printPdf(bytes, { host, name: worksheetFileName(task.title) });
    if (how === 'opened') dctx.toast?.({ text: 'The worksheet opened in a new tab. Print it from there.' });
    if (how === 'downloaded') dctx.toast?.({ text: 'The worksheet downloaded. Print it from your files.' });
  }));

  const downloadBtn = button({ label: 'Download', icon: 'file-pdf', size: 'sm', focusKey: 'ws-download' });
  downloadBtn.addEventListener('click', run(downloadBtn, 'Preparing…', async () => {
    const { ws, bytes } = await worksheetBytes(task);
    ws.downloadPdf(bytes, worksheetFileName(task.title), host);
  }));

  let markBtn = null;
  if (canMarkUp) {
    markBtn = button({ label: 'Mark up', icon: 'pencil-simple', size: 'sm', variant: canHandIn ? 'primary' : 'secondary', focusKey: 'ws-markup' });
    markBtn.addEventListener('click', run(markBtn, 'Opening…', async () => {
      const { openMarkup } = await loadMarkup();
      const view = await openMarkup({
        title: task.title,
        details: task.details,
        dueAt: task.due_at,
        taskId: task.id,
        studentId,
        viewerId: dctx.me?.id ?? 'anyone',
        canHandIn,
        attemptText,
        confirm: dctx.confirm,
        returnFocus: markBtn,
        onHandIn: canHandIn ? async (file) => {
          const problemText = validateUpload(file);
          if (problemText) return { error: problemText };
          try {
            await sendWork({ taskId: task.id, studentId, upload: { body: file, type: 'application/pdf' } });
            return { ok: true };
          } catch (error) {
            console.error('Hand in failed', error);
            return { error: handInFailure(error) };
          }
        } : null,
      });
      // The drawer redraws (and says the work is in) after a hand-in
      view.closed.then((result) => { if (result?.handedIn) onHandedIn?.(); });
    }));
  }

  const apple = role === 'student' && canHandIn && isAppleTouch({
    userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints,
  });

  return h('section', { class: 'drawer-section ws-section' },
    h('h3', {}, 'Worksheet'),
    h('p', { class: 'ws-line' }, lineFor(role, canHandIn)),
    h('div', { class: 'ws-actions' }, markBtn, openBtn, printBtn, downloadBtn, ...extra),
    apple
      ? h('p', { class: 'note ws-apple' }, icon('info'),
        h('span', {}, 'On iPad or iPhone, Open also lets you write on it with Markup from the Share menu. Save it, then add the file with Submit work.'))
      : null,
    problem);
}
