// The assignment as its document, for staff: the worksheet pages (the same
// ones the PDF and Mark up use) shown inline in the form's Preview, and in a
// full-screen viewer with zoom and page navigation. Nothing opens a new tab.
// Staff only: loaded by the staff form (item-form.js) and, with import(), by
// staff paths of the drawer; families never download it.
//
// documentPreview({ getSource, getKeyText, toast }) ->
//   { root, refresh(), flush(), destroy() }
//   getSource   () -> { title, details, dueAt } as the form holds them now
//   getKeyText  async () -> the answer key text, or null (the toggle shows only with one)
// openDocViewer({ source, keyText, withKey, returnFocus, toast }) -> Promise (closed)
//
// Each page is a canvas with role="img" and "Page N of M of <title>"; a
// visually hidden outline of the document (headings and lists, math as TeX)
// lets screen readers read the content.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, iconButton, segmented, setSegmented, busy } from './ui.js';
import { buildLayout, renderPage, worksheetPdf, downloadPdf, printPdf } from './worksheet.js';
import { worksheetFileName } from './worksheet-model.js';
import { parseHomework, parseKey, plainMath } from './homework-doc.js';
import { homeworkView } from './homework-view.js';
import {
  PAGE_CSS_WIDTH, PAGE_RATIO, PRESETS, RENDER_DELAY_MS, clampZoom, fitZoom, zoomIn, zoomOut, zoomLabel, clampPage, nextPage,
  prevPage, pageLabel, renderDpi, pageInView, previewKey, createDebounce,
} from './doc-viewer-model.js';

export const KEY_HEADING = 'Answer key (staff only)';
// Fit width stops here on a wide screen, so a page stays readable at a glance
const FIT_MAX = 1.25;
const MODES = [{ value: 'student', label: 'Student copy' }, { value: 'key', label: 'With answer key' }];

// ---------------------------------------------------------------------------
// The document behind both views: its layouts, built once per mode

function documentOf(source, keyText) {
  const layouts = new Map();
  const hasKey = Boolean(String(keyText ?? '').trim());
  return {
    source,
    hasKey,
    keyText,
    layout(mode) {
      const m = mode === 'key' && hasKey ? 'key' : 'student';
      if (!layouts.has(m)) {
        layouts.set(m, buildLayout({
          title: source.title, details: source.details, dueAt: source.dueAt ?? null,
          appendix: m === 'key' ? { heading: KEY_HEADING, text: keyText } : null,
        }));
      }
      return layouts.get(m);
    },
  };
}

// Headings and lists of the document, math as its TeX, for screen readers
export function documentOutline(source, { keyText = null, withKey = false } = {}) {
  const doc = parseHomework(source.details);
  const text = (t) => plainMath(t);
  const out = h('div', { class: 'visually-hidden dv-outline' }, h('h3', {}, text(source.title || 'Assignment')));
  const facts = [doc.objective ? `Objective: ${text(doc.objective)}` : null, doc.time ? `Time: ${doc.time}` : null, doc.materials ? `Materials: ${text(doc.materials)}` : null].filter(Boolean);
  if (facts.length) out.append(h('ul', {}, facts.map((f) => h('li', {}, f))));
  for (const sec of doc.sections) {
    if (sec.heading) out.append(h('h4', {}, text(sec.heading)));
    if (sec.directions) out.append(h('p', {}, text(sec.directions)));
    for (const para of sec.text) out.append(h('p', {}, text(para)));
    if (sec.example) {
      out.append(h('p', {}, `Worked example: ${text(sec.example.problem)}`),
        h('ol', {}, sec.example.steps.map((st) => h('li', {}, text(st)))),
        sec.example.answer ? h('p', {}, `Answer: ${text(sec.example.answer)}`) : null);
    }
    if (sec.problems.length) {
      out.append(h('ol', {}, sec.problems.map((p) => h('li', {}, text(p.prompt),
        p.choices?.length ? h('ul', {}, p.choices.map((c, i) => h('li', {}, `${'ABCDEF'[i]}: ${text(c)}`))) : null,
        p.hint ? h('p', {}, `Hint: ${text(p.hint)}`) : null))));
    }
  }
  const groups = withKey && keyText ? parseKey(keyText) : null;
  if (groups) {
    out.append(h('h4', {}, KEY_HEADING));
    for (const g of groups) {
      if (g.heading) out.append(h('h5', {}, text(g.heading)));
      out.append(h('ul', {}, g.entries.map((e) => h('li', {}, `${e.ref}: ${text(e.answer)}`))));
    }
  }
  return out;
}

// Draws every page of a layout as a figure: the canvas and "Page N of M"
function pageFigures(layout, { cssWidth, title }) {
  const dpi = renderDpi(cssWidth, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  const count = layout.pages.length;
  return layout.pages.map((_, i) => {
    const canvas = renderPage(layout, i, { dpi });
    canvas.className = 'dv-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', pageLabel(i, count, title));
    return h('figure', { class: 'dv-page', dataset: { page: String(i) } },
      canvas, h('figcaption', { class: 'dv-caption', 'aria-hidden': 'true' }, `Page ${i + 1} of ${count}`));
  });
}

const skeletonPages = (n = 2) => Array.from({ length: n }, () => h('div', { class: 'dv-page dv-skeleton skeleton', 'aria-hidden': 'true' }));

function pdfActions(getDoc, getMode, { toast, host }) {
  const download = button({ label: 'Download PDF', icon: 'file-pdf', size: 'sm', className: 'dv-download' });
  const print = button({ label: 'Print', icon: 'printer', size: 'sm', className: 'dv-print' });
  const bytesNow = async () => {
    const doc = getDoc();
    return { doc, bytes: await worksheetPdf(await doc.layout(getMode())) };
  };
  const name = (doc) => worksheetFileName(getMode() === 'key' ? `${doc.source.title} answer key` : doc.source.title);
  download.addEventListener('click', async () => {
    try {
      await busy(download, 'Preparing…', async () => {
        const { doc, bytes } = await bytesNow();
        downloadPdf(bytes, name(doc), host());
      });
    } catch (error) {
      console.error(error);
      toast?.({ text: 'We couldn’t make the PDF. Try again.' });
    }
  });
  print.addEventListener('click', async () => {
    try {
      await busy(print, 'Preparing…', async () => {
        const { doc, bytes } = await bytesNow();
        const how = await printPdf(bytes, { host: host(), name: name(doc) });
        if (how === 'downloaded') toast?.({ text: 'The PDF downloaded. Print it from your files.' });
      });
    } catch (error) {
      console.error(error);
      toast?.({ text: 'We couldn’t print it. Try Download PDF.' });
    }
  });
  return [download, print];
}

// ---------------------------------------------------------------------------
// Inline: the form's Preview

export function documentPreview({ getSource, getKeyText = async () => null, toast = null } = {}) {
  let mode = 'student';
  let doc = null;
  let shownKey = null;
  let card = false;
  let destroyed = false;
  let seq = 0;

  const pages = h('div', { class: 'dv-pages' });
  const paper = h('div', { class: 'dv-paper', 'aria-busy': 'false' }, pages);
  const outlineSlot = h('div', { class: 'dv-outline-slot' });
  const portal = h('div', { class: 'dv-portal', hidden: true });
  const status = h('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  const keyToggle = segmented({
    label: 'Copy to show', options: MODES, value: 'student', className: 'dv-mode',
    onChange: (value) => { mode = value; refresh({ now: true }); },
  });
  keyToggle.hidden = true;
  const fullBtn = button({ label: 'Full screen', icon: 'corners-out', size: 'sm', className: 'dv-full', focusKey: 'dv-full' });
  fullBtn.addEventListener('click', async () => {
    const source = getSource();
    await openDocViewer({ source, keyText: shownKey, withKey: mode === 'key', returnFocus: fullBtn, toast });
  });
  // The PDF is made from the form as it is now, edits since the last drawing included
  const [download, print] = pdfActions(() => documentOf(getSource(), shownKey), () => mode, { toast, host: () => root });
  const viewLink = h('button', { type: 'button', class: 'link dv-view-link' }, 'Show as the portal view');
  viewLink.addEventListener('click', () => {
    card = !card;
    viewLink.textContent = card ? 'Show as the document' : 'Show as the portal view';
    paper.hidden = card;
    portal.hidden = !card;
    if (card) portal.replaceChildren(homeworkView(getSource().details));
    else refresh({ now: true });
  });

  const root = h('div', { class: 'dv-preview' },
    h('div', { class: 'dv-toolbar', role: 'toolbar', 'aria-label': 'Document' }, keyToggle, fullBtn, download, print),
    paper, portal, outlineSlot, status,
    h('p', { class: 'dv-view-row' }, viewLink));

  let lastKey = null;
  async function render() {
    if (destroyed || card) return;
    const my = ++seq;
    const source = getSource();
    let keyText = null;
    try {
      keyText = await getKeyText();
    } catch {
      keyText = null;
    }
    if (destroyed || my !== seq) return;
    shownKey = String(keyText ?? '').trim() ? keyText : null;
    keyToggle.hidden = !shownKey;
    if (!shownKey && mode === 'key') {
      mode = 'student';
      setSegmented(keyToggle, 'student');
    }
    const k = previewKey({ ...source, withKey: mode === 'key', keyText: shownKey ?? '' });
    if (k === lastKey && pages.childElementCount && !pages.querySelector('.dv-skeleton')) return;
    if (!String(source.details ?? '').trim()) {
      pages.replaceChildren(h('p', { class: 'dv-empty' }, 'Nothing to preview yet. Write the instructions first.'));
      lastKey = k;
      return;
    }
    pages.replaceChildren(...skeletonPages());
    paper.setAttribute('aria-busy', 'true');
    try {
      doc = documentOf(source, shownKey);
      const layout = await doc.layout(mode);
      if (destroyed || my !== seq) return;
      const width = Math.max(200, Math.min(PAGE_CSS_WIDTH, (paper.clientWidth || 400) - 24));
      pages.replaceChildren(...pageFigures(layout, { cssWidth: width, title: source.title }));
      outlineSlot.replaceChildren(documentOutline(source, { keyText: shownKey, withKey: mode === 'key' }));
      status.textContent = `Preview ready: ${layout.pages.length} ${layout.pages.length === 1 ? 'page' : 'pages'}.`;
      lastKey = k;
    } catch (error) {
      console.error(error);
      if (my === seq) pages.replaceChildren(h('p', { class: 'dv-empty' }, 'We couldn’t draw the preview. Try again.'));
    } finally {
      if (my === seq) paper.setAttribute('aria-busy', 'false');
    }
  }

  const debounced = createDebounce(() => { render(); }, RENDER_DELAY_MS);
  function refresh({ now = false } = {}) {
    if (card) {
      portal.replaceChildren(homeworkView(getSource().details));
      return;
    }
    if (!pages.childElementCount) pages.replaceChildren(...skeletonPages());
    debounced.trigger();
    if (now) debounced.flush();
  }

  return {
    root,
    refresh,
    flush: () => debounced.flush(),
    destroy() {
      destroyed = true;
      debounced.cancel();
    },
  };
}

// ---------------------------------------------------------------------------
// Full screen

export function openDocViewer({ source, keyText = null, withKey = false, returnFocus = null, toast = null } = {}) {
  const doc = documentOf(source, keyText);
  let mode = withKey && doc.hasKey ? 'key' : 'student';
  let zoomMode = 'fit';
  let zoom = 1;
  let current = 0;
  let count = 0;
  let seq = 0;
  const titleId = uid('dv-title');

  const pages = h('div', { class: 'dv-pages' });
  const scroller = h('div', { class: 'dv-scroll', tabindex: '0', 'aria-label': 'Pages' }, pages);
  const outlineSlot = h('div', { class: 'dv-outline-slot' });
  const pageText = h('span', { class: 'dv-page-count num', 'aria-live': 'polite' }, 'Page 1');
  const prevBtn = iconButton({ icon: 'caret-left', label: 'Previous page', onClick: () => goTo(prevPage(current, count)) });
  const nextBtn = iconButton({ icon: 'caret-right', label: 'Next page', onClick: () => goTo(nextPage(current, count)) });
  // From the zoom shown now (fit width is a zoom too)
  const effective = () => (zoomMode === 'fit' ? fitZoom(scroller.clientWidth, { gutter: 24, max: FIT_MAX }) : zoom);
  const zoomOutBtn = iconButton({ icon: 'minus-circle', label: 'Zoom out', onClick: () => setZoom(zoomOut(effective())) });
  const zoomInBtn = iconButton({ icon: 'plus', label: 'Zoom in', onClick: () => setZoom(zoomIn(effective())) });
  const zoomText = h('span', { class: 'dv-zoom num', 'aria-live': 'polite' }, 'Fit width');
  const presets = segmented({
    label: 'Zoom', options: PRESETS.map((p) => ({ value: String(p.value), label: p.label })), value: 'fit', className: 'dv-presets',
    onChange: (value) => (value === 'fit' ? setZoom('fit') : setZoom(Number(value))),
  });
  const modeToggle = doc.hasKey
    ? segmented({ label: 'Copy to show', options: MODES, value: mode, className: 'dv-mode', onChange: (value) => { mode = value; paint(); } })
    : null;
  const [download, print] = pdfActions(() => doc, () => mode, { toast, host: () => dialog });
  const closeBtn = iconButton({ icon: 'x', label: 'Close the document', tip: 'left', onClick: () => dialog.close() });

  const dialog = h('dialog', { class: 'dv-viewer', 'aria-labelledby': titleId },
    h('div', { class: 'dv-inner' },
      h('div', { class: 'dv-bar' },
        h('h2', { class: 'dv-title', id: titleId }, plainMath(source.title || 'Assignment')),
        closeBtn),
      h('div', { class: 'dv-controls', role: 'toolbar', 'aria-label': 'Document' },
        h('div', { class: 'dv-group' }, prevBtn, pageText, nextBtn),
        h('div', { class: 'dv-group' }, zoomOutBtn, zoomText, zoomInBtn, presets),
        modeToggle ? h('div', { class: 'dv-group' }, modeToggle) : null,
        h('div', { class: 'dv-group dv-group-end' }, download, print)),
      scroller,
      outlineSlot));
  document.body.append(dialog);

  const shownWidth = () => effective() * PAGE_CSS_WIDTH;

  function paintControls() {
    pageText.textContent = count ? `Page ${current + 1} of ${count}` : 'Page';
    prevBtn.disabled = current <= 0;
    nextBtn.disabled = current >= count - 1;
    const z = effective();
    zoomText.textContent = zoomLabel(z, zoomMode);
    zoomOutBtn.disabled = z <= 0.5 + 1e-6;
    zoomInBtn.disabled = z >= 3 - 1e-6;
    setSegmented(presets, zoomMode === 'fit' ? 'fit' : String(zoom));
  }

  function applyWidth() {
    pages.style.setProperty('--dv-page-w', `${Math.round(shownWidth())}px`);
  }

  // Sharper pages once the zoom settles
  const redraw = createDebounce(() => { paint({ keepScroll: true }); }, RENDER_DELAY_MS);

  function setZoom(next) {
    const before = scroller.scrollTop / Math.max(1, scroller.scrollHeight);
    if (next === 'fit') zoomMode = 'fit';
    else {
      zoomMode = 'zoom';
      zoom = clampZoom(next);
    }
    applyWidth();
    scroller.scrollTop = before * scroller.scrollHeight;
    paintControls();
    redraw.trigger();
  }

  function goTo(index) {
    current = clampPage(index, count);
    const top = pageTops()[current];
    if (top !== undefined) scroller.scrollTop = Math.max(0, top - 12);
    paintControls();
  }

  async function paint({ keepScroll = false } = {}) {
    const my = ++seq;
    const at = scroller.scrollTop / Math.max(1, scroller.scrollHeight);
    if (!keepScroll) pages.replaceChildren(...skeletonPages(2));
    applyWidth();
    try {
      const layout = await doc.layout(mode);
      if (my !== seq || !dialog.isConnected) return;
      count = layout.pages.length;
      pages.replaceChildren(...pageFigures(layout, { cssWidth: shownWidth(), title: source.title }));
      outlineSlot.replaceChildren(documentOutline(source, { keyText: doc.keyText, withKey: mode === 'key' }));
      if (keepScroll) scroller.scrollTop = at * scroller.scrollHeight;
      current = clampPage(current, count);
      paintControls();
    } catch (error) {
      console.error(error);
      if (my === seq) pages.replaceChildren(h('p', { class: 'dv-empty' }, 'We couldn’t draw the document. Try again.'));
    }
  }

  // Each page's top within the scrolled content
  const pageTops = () => {
    const box = scroller.getBoundingClientRect();
    return [...pages.querySelectorAll('.dv-page')].map((p) => p.getBoundingClientRect().top - box.top + scroller.scrollTop);
  };
  scroller.addEventListener('scroll', () => {
    const tops = pageTops();
    const next = pageInView(tops, scroller.scrollTop, scroller.clientHeight);
    if (next !== current) {
      current = next;
      paintControls();
    }
  }, { passive: true });

  // Ctrl or Command with + or - zooms the document, not the page; 0 fits the width
  dialog.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoomIn(effective())); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(zoomOut(effective())); }
    else if (e.key === '0') { e.preventDefault(); setZoom('fit'); }
  });

  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (zoomMode === 'fit') { applyWidth(); paintControls(); redraw.trigger(); } }) : null;
  const closed = new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      redraw.cancel();
      resize?.disconnect();
      dialog.remove();
      // Back to the control that opened it, or its redrawn copy
      const key = returnFocus?.dataset?.focusKey;
      const back = returnFocus?.isConnected ? returnFocus : (key ? document.querySelector(`[data-focus-key="${key}"]`) : null);
      back?.focus?.();
      resolve();
    }, { once: true });
  });

  dialog.showModal();
  closeBtn.focus();
  resize?.observe(scroller);
  paint();
  return closed;
}
