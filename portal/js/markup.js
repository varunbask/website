// "Mark up": the worksheet in a full-screen view, with a pen, a highlighter
// and an eraser on top, and Hand in for students. Loaded with import() from
// the worksheet section (worksheet-ui.js). The strokes, undo and the math
// live in markup-model.js; the pages are drawn by worksheet.js.
//
// openMarkup({ title, details, dueAt, taskId, studentId, viewerId, canHandIn,
//   attemptText, onHandIn, confirm, returnFocus }) -> { closed } once the view
//   is showing; closed resolves with { handedIn } when it closes
//   onHandIn(file) -> { ok: true } or { error } (string or nodes): hands the
//   flattened PDF in through submit-work.js's sendWork, like any other file
//
// Input: a pen (with pressure), one finger or the mouse draws; two fingers
// scroll and zoom. Hand mode (touch screens) lets one finger scroll instead.
// Every change is saved on this device (localStorage, per viewer, student and
// assignment) so the work is there when the student comes back; handing in
// clears it.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, iconButton, busy } from './ui.js';
import { buildLayout, renderPage, worksheetPdf, canvasJpeg } from './worksheet.js';
import { PAGE } from './worksheet-model.js';
import {
  COLORS, HIGHLIGHT_ALPHA, ERASER_RADIUS, MIN_ZOOM, MAX_ZOOM,
  createDoc, addStroke, removeStrokes, clearPage, undo, redo, canUndo, canRedo, hasInk,
  pressureOf, widthAt, newStroke, simplify, roundPoints, strokesAt, toPagePoint, clampZoom, pinch,
  markupKey, toSaved, fromSaved,
} from './markup-model.js';

const TOOL_LABELS = { pen: 'Pen', highlighter: 'Highlighter', eraser: 'Eraser' };
const MAX_INK_PX = 2400;          // an ink canvas is never wider than this
const SAVE_DELAY_MS = 400;
const ZOOM_STEP = 1.25;

// Draws one stroke on a context whose page is `scale` pixels per point
export function drawStroke(ctx, stroke, scale) {
  const pts = stroke.points;
  if (!pts.length) return;
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (stroke.tool === 'highlighter') {
    // One path, so the color is even where the stroke crosses itself; multiply
    // keeps the printed text under it dark
    ctx.globalAlpha = HIGHLIGHT_ALPHA;
    ctx.globalCompositeOperation = 'multiply';
    ctx.lineWidth = stroke.width * scale;
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * scale, pts[0][1] * scale);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x * scale, y * scale);
    if (pts.length === 1) ctx.lineTo(pts[0][0] * scale + 0.1, pts[0][1] * scale);
    ctx.stroke();
  } else if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0] * scale, pts[0][1] * scale, (widthAt(stroke, pts[0][2]) * scale) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    for (let i = 1; i < pts.length; i += 1) {
      const [x0, y0, p0] = pts[i - 1];
      const [x1, y1, p1] = pts[i];
      ctx.lineWidth = widthAt(stroke, ((p0 ?? 0.5) + (p1 ?? 0.5)) / 2) * scale;
      ctx.beginPath();
      ctx.moveTo(x0 * scale, y0 * scale);
      ctx.lineTo(x1 * scale, y1 * scale);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function readSaved(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function openMarkup({
  title, details, dueAt = null, taskId, studentId, viewerId,
  canHandIn = false, attemptText = '', onHandIn = null, confirm = null, returnFocus = null,
} = {}) {
  const layout = await buildLayout({ title, details, dueAt });
  const pageCount = layout.pages.length;
  const key = markupKey({ viewerId, studentId, taskId });
  const doc = fromSaved(readSaved(key), pageCount) ?? createDoc(pageCount);

  const state = {
    tool: 'pen', color: COLORS[0].value, zoom: 1, hand: false, current: 0,
    drawing: null,                 // { page, stroke, pointerId, pointerType, startedAt } or an erase
    touches: new Map(),            // touch pointer id -> { x, y }
    gesture: null,                 // two fingers: { a0, b0, ids, zoom, fx, fy }
    saveTimer: null,
    closed: false,
  };
  const urls = [];
  const titleId = uid('mk-title');
  const touchScreen = (navigator.maxTouchPoints ?? 0) > 0;

  // The pages ----------------------------------------------------------------
  const pagesEl = h('div', { class: 'mk-pages' });
  const scroller = h('div', { class: 'mk-scroll' }, pagesEl);
  const pages = layout.pages.map((page, i) => {
    const descId = uid('mk-desc');
    const bg = h('img', { class: 'mk-bg', alt: '', decoding: 'async', draggable: 'false' });
    const ink = h('canvas', {
      class: 'mk-ink',
      role: 'img',
      'aria-label': `Page ${i + 1} of ${pageCount}, drawing area. Draw with a pen, a finger or the mouse.`,
      'aria-describedby': descId,
      dataset: { page: String(i) },
    });
    const el = h('div', { class: 'mk-page is-loading', dataset: { page: String(i) } },
      bg, ink, h('p', { class: 'visually-hidden', id: descId }, page.text));
    pagesEl.append(el);
    return { el, bg, ink };
  });

  // The toolbar --------------------------------------------------------------
  const status = h('p', { class: 'mk-status', role: 'status', 'aria-live': 'polite' });
  const problem = h('div', { class: 'mk-problem' });
  const toolButtons = Object.entries(TOOL_LABELS).map(([tool, label]) => button({
    label, size: 'sm', className: 'mk-tool', onClick: () => setTool(tool),
  }));
  toolButtons.forEach((b, i) => { b.dataset.tool = Object.keys(TOOL_LABELS)[i]; });
  const colorButtons = COLORS.map((c) => {
    const b = h('button', {
      type: 'button', class: 'mk-color', 'aria-label': c.label, title: c.label, dataset: { color: c.value },
      onClick: () => setColor(c.value),
    }, h('span', { class: `mk-swatch is-${c.label.toLowerCase()}`, 'aria-hidden': 'true' }));
    return b;
  });
  const undoBtn = button({ label: 'Undo', icon: 'arrow-counter-clockwise', size: 'sm', onClick: () => step(undo) });
  const redoBtn = button({ label: 'Redo', icon: 'arrow-counter-clockwise', size: 'sm', className: 'mk-redo', onClick: () => step(redo) });
  const clearBtn = button({ label: 'Clear page', icon: 'trash', size: 'sm', variant: 'ghost', onClick: () => clearCurrent() });
  const zoomOut = button({ label: '−', size: 'sm', ariaLabel: 'Zoom out', className: 'mk-zoom-btn', onClick: () => zoomBy(1 / ZOOM_STEP) });
  const zoomIn = button({ label: '+', size: 'sm', ariaLabel: 'Zoom in', className: 'mk-zoom-btn', onClick: () => zoomBy(ZOOM_STEP) });
  const zoomText = h('span', { class: 'mk-zoom num', 'aria-live': 'polite' }, '100%');
  const handBtn = touchScreen
    ? button({ label: 'Hand mode', size: 'sm', className: 'mk-hand', onClick: () => setHand(!state.hand) })
    : null;
  const handInBtn = canHandIn
    ? button({ label: 'Hand in', icon: 'upload-simple', variant: 'primary', size: 'sm', className: 'mk-handin', onClick: () => handIn() })
    : null;

  const tools = h('div', { class: 'mk-tools', role: 'toolbar', 'aria-label': 'Markup tools' },
    h('div', { class: 'mk-group', role: 'group', 'aria-label': 'Tool' }, toolButtons),
    h('div', { class: 'mk-group', role: 'group', 'aria-label': 'Color' }, colorButtons),
    h('div', { class: 'mk-group', role: 'group', 'aria-label': 'Undo' }, undoBtn, redoBtn, clearBtn),
    h('div', { class: 'mk-group', role: 'group', 'aria-label': 'Zoom' }, zoomOut, zoomText, zoomIn, handBtn),
    handInBtn ? h('div', { class: 'mk-group mk-group-end' }, handInBtn) : null);

  const closeBtn = iconButton({ icon: 'x', label: 'Close. Your marks stay saved on this device.', tip: 'left', onClick: () => dialog.close() });
  const dialog = h('dialog', { class: 'markup', 'aria-labelledby': titleId },
    h('div', { class: 'mk-inner' },
      h('div', { class: 'mk-bar' },
        h('div', { class: 'mk-heading' },
          h('h2', { class: 'mk-title', id: titleId }, 'Mark up'),
          h('p', { class: 'mk-name' }, title || 'Worksheet')),
        status,
        closeBtn),
      h('p', { class: 'mk-hint' }, touchScreen
        ? 'Draw with a pen or one finger. Use two fingers to scroll and zoom, or turn on Hand mode.'
        : 'Draw with the mouse or a pen. Ctrl or Command with Z undoes.'),
      problem,
      scroller,
      tools));
  document.body.append(dialog);

  // State and painting -------------------------------------------------------
  function paintTools() {
    for (const b of toolButtons) b.setAttribute('aria-pressed', String(b.dataset.tool === state.tool));
    for (const b of colorButtons) b.setAttribute('aria-pressed', String(b.dataset.color === state.color));
    for (const b of colorButtons) b.disabled = state.tool === 'eraser';
    undoBtn.disabled = !canUndo(doc);
    redoBtn.disabled = !canRedo(doc);
    clearBtn.disabled = !(doc.pages[state.current]?.length);
    zoomOut.disabled = state.zoom <= MIN_ZOOM;
    zoomIn.disabled = state.zoom >= MAX_ZOOM;
    zoomText.textContent = `${Math.round(state.zoom * 100)}%`;
    if (handBtn) handBtn.setAttribute('aria-pressed', String(state.hand));
    dialog.classList.toggle('is-hand', state.hand);
    dialog.classList.toggle('is-eraser', state.tool === 'eraser');
  }
  const setTool = (tool) => { state.tool = tool; paintTools(); };
  const setColor = (color) => { state.color = color; if (state.tool === 'eraser') state.tool = 'pen'; paintTools(); };
  const setHand = (on) => { state.hand = on; paintTools(); say(on ? 'Hand mode on: one finger scrolls.' : 'Hand mode off: one finger draws.'); };

  function say(text) {
    status.textContent = text;
  }

  function redraw(i) {
    const { ink } = pages[i];
    const ctx = ink.getContext('2d');
    ctx.clearRect(0, 0, ink.width, ink.height);
    const scale = ink.width / PAGE.width;
    const hidden = state.drawing?.erase && state.drawing.page === i ? state.drawing.ids : null;
    for (const stroke of doc.pages[i]) if (!hidden?.has(stroke.id)) drawStroke(ctx, stroke, scale);
    if (state.drawing?.stroke && state.drawing.page === i) drawStroke(ctx, state.drawing.stroke, scale);
  }

  // Page size: the width that fits, times the zoom; each ink canvas matches its
  // shown size (and the screen's pixel ratio), up to MAX_INK_PX
  function sizePages() {
    const fit = Math.max(200, Math.min(scroller.clientWidth - 24, 880));
    const width = Math.round(fit * state.zoom);
    pagesEl.style.setProperty('--mk-page-w', `${width}px`);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.min(MAX_INK_PX, Math.round(width * ratio));
    pages.forEach((p, i) => {
      if (p.ink.width !== px) {
        p.ink.width = px;
        p.ink.height = Math.round((px * PAGE.height) / PAGE.width);
      }
      redraw(i);
    });
  }

  function zoomTo(zoom, anchor = null) {
    const next = clampZoom(zoom);
    if (next === state.zoom) return;
    const box = scroller.getBoundingClientRect();
    const ax = anchor ? anchor.x - box.left : scroller.clientWidth / 2;
    const ay = anchor ? anchor.y - box.top : scroller.clientHeight / 2;
    const fx = (scroller.scrollLeft + ax) / Math.max(1, scroller.scrollWidth);
    const fy = (scroller.scrollTop + ay) / Math.max(1, scroller.scrollHeight);
    state.zoom = next;
    sizePages();
    scroller.scrollLeft = fx * scroller.scrollWidth - ax;
    scroller.scrollTop = fy * scroller.scrollHeight - ay;
    paintTools();
  }
  const zoomBy = (factor) => zoomTo(state.zoom * factor);

  function save() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    try {
      if (hasInk(doc)) localStorage.setItem(key, JSON.stringify(toSaved(doc)));
      else localStorage.removeItem(key);
      say('Saved on this device.');
    } catch {
      say('Not saved: this browser does not allow saving here. Hand it in before you close it.');
    }
  }
  const saveSoon = () => {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(save, SAVE_DELAY_MS);
  };

  function changed(page) {
    if (page !== null && page !== undefined) redraw(page);
    paintTools();
    saveSoon();
  }
  function step(fn) {
    const page = fn(doc);
    if (page === null) return;
    changed(page);
    say(fn === undo ? 'Undone.' : 'Redone.');
  }

  async function clearCurrent() {
    const page = state.current;
    if (!doc.pages[page]?.length) return;
    const ok = confirm
      ? await confirm({ title: `Clear page ${page + 1}?`, body: `This removes everything you drew on page ${page + 1}. Undo brings it back.`, confirmLabel: 'Clear page', tone: 'danger' })
      : true;
    if (!ok || state.closed) return;
    clearPage(doc, page);
    changed(page);
    say(`Page ${page + 1} cleared.`);
  }

  // Which page is most in view
  function trackPage() {
    const box = scroller.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    let best = 0;
    let bestDist = Infinity;
    pages.forEach((p, i) => {
      const r = p.el.getBoundingClientRect();
      const d = middle < r.top ? r.top - middle : middle > r.bottom ? middle - r.bottom : 0;
      if (d < bestDist) { best = i; bestDist = d; }
    });
    if (best !== state.current) {
      state.current = best;
      paintTools();
    }
  }

  // Drawing --------------------------------------------------------------------
  const pointOf = (ev, ink) => {
    const [x, y] = toPagePoint(ev.clientX, ev.clientY, ink.getBoundingClientRect(), PAGE.width, PAGE.height);
    return [x, y, pressureOf(ev.pointerType, ev.pressure)];
  };

  function startGesture() {
    const [[idA, a], [idB, b]] = [...state.touches.entries()];
    state.gesture = { ids: [idA, idB], a0: { ...a }, b0: { ...b }, zoom: state.zoom };
  }

  function onDown(ev) {
    const ink = ev.currentTarget;
    const page = Number(ink.dataset.page);
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (ev.pointerType === 'touch') {
      if (state.hand) return;                       // Hand mode: one finger scrolls
      state.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (state.touches.size >= 2) {
        // A second finger: this is a scroll or a zoom, not a line. A line the
        // first finger started a moment ago is dropped.
        if (state.drawing?.pointerType === 'touch') {
          const was = state.drawing.page;
          state.drawing = null;
          redraw(was);
        }
        startGesture();
        ev.preventDefault();
        return;
      }
    }
    if (state.drawing) return;
    ev.preventDefault();
    try { ink.setPointerCapture(ev.pointerId); } catch { /* the pointer is gone */ }
    state.current = page;
    if (state.tool === 'eraser') {
      state.drawing = { erase: true, page, ids: new Set(), pointerId: ev.pointerId, pointerType: ev.pointerType };
      erase(ev, ink);
    } else {
      const stroke = newStroke(state.tool, state.color);
      stroke.points.push(pointOf(ev, ink));
      state.drawing = { page, stroke, pointerId: ev.pointerId, pointerType: ev.pointerType, startedAt: performance.now() };
      redraw(page);
    }
  }

  function erase(ev, ink) {
    const d = state.drawing;
    const [x, y] = pointOf(ev, ink);
    const before = d.ids.size;
    for (const id of strokesAt(doc.pages[d.page], [x, y], ERASER_RADIUS)) d.ids.add(id);
    if (d.ids.size !== before) redraw(d.page);
  }

  function onMove(ev) {
    const ink = ev.currentTarget;
    if (ev.pointerType === 'touch' && state.touches.has(ev.pointerId)) {
      state.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const g = state.gesture;
      if (g && g.ids.includes(ev.pointerId)) {
        ev.preventDefault();
        const a1 = state.touches.get(g.ids[0]);
        const b1 = state.touches.get(g.ids[1]);
        if (!a1 || !b1) return;
        const move = pinch(g.a0, g.b0, a1, b1);
        zoomTo(g.zoom * move.scale, { x: move.cx, y: move.cy });
        scroller.scrollLeft -= move.dx - (g.dx ?? 0);
        scroller.scrollTop -= move.dy - (g.dy ?? 0);
        g.dx = move.dx;
        g.dy = move.dy;
        return;
      }
    }
    const d = state.drawing;
    if (!d || d.pointerId !== ev.pointerId) return;
    ev.preventDefault();
    const events = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    const list = events.length ? events : [ev];
    if (d.erase) {
      for (const e of list) erase(e, ink);
      return;
    }
    for (const e of list) d.stroke.points.push(pointOf(e, ink));
    redraw(d.page);
  }

  function onUp(ev) {
    if (ev.pointerType === 'touch') {
      state.touches.delete(ev.pointerId);
      if (state.gesture?.ids.includes(ev.pointerId)) {
        state.gesture = null;
        sizePages();
        return;
      }
    }
    const d = state.drawing;
    if (!d || d.pointerId !== ev.pointerId) return;
    state.drawing = null;
    if (ev.type === 'pointercancel') {
      redraw(d.page);
      return;
    }
    if (d.erase) {
      if (d.ids.size) {
        const removed = removeStrokes(doc, d.page, [...d.ids]);
        say(`${removed.length === 1 ? '1 mark' : `${removed.length} marks`} erased.`);
      }
      changed(d.page);
      return;
    }
    d.stroke.points = roundPoints(simplify(d.stroke.points));
    addStroke(doc, d.page, d.stroke);
    changed(d.page);
  }

  for (const p of pages) {
    p.ink.addEventListener('pointerdown', onDown);
    p.ink.addEventListener('pointermove', onMove);
    p.ink.addEventListener('pointerup', onUp);
    p.ink.addEventListener('pointercancel', onUp);
    p.ink.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  scroller.addEventListener('scroll', trackPage, { passive: true });

  // Ctrl or Command + Z undoes, with Shift (or Y) redoes
  dialog.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); step(undo); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); step(redo); }
  });

  // Hand in ----------------------------------------------------------------------
  async function handIn() {
    problem.replaceChildren();
    if (!hasInk(doc)) {
      problem.replaceChildren(h('p', { class: 'field-error', role: 'alert' }, icon('warning-circle'),
        h('span', {}, 'Write or draw your answers on the worksheet before you hand it in.')));
      return;
    }
    const ok = confirm
      ? await confirm({ title: 'Hand in this worksheet?', body: `It goes to your tutor as a PDF of these pages, with your marks. ${attemptText}`.trim(), confirmLabel: 'Hand in', tone: 'primary' })
      : true;
    if (!ok || state.closed) return;
    save();
    await busy(handInBtn, 'Handing in…', async () => {
      let result;
      try {
        const bytes = await worksheetPdf(layout, {
          inkFor: (i, ctx, scale) => { for (const stroke of doc.pages[i]) drawStroke(ctx, stroke, scale); },
        });
        const file = new File([bytes], 'worksheet.pdf', { type: 'application/pdf' });
        result = await onHandIn(file);
      } catch (error) {
        console.error(error);
        result = { error: 'Your worksheet could not be handed in. Try again.' };
      }
      if (state.closed) return;
      if (result?.ok) {
        try { localStorage.removeItem(key); } catch { /* nothing saved */ }
        state.handedIn = true;
        dialog.close();
        return;
      }
      problem.replaceChildren(h('p', { class: 'field-error', role: 'alert' }, icon('warning-circle'), h('span', {}, result?.error ?? 'Try again.')));
    });
  }

  // Open and close -----------------------------------------------------------------
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => sizePages()) : null;
  const closed = new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      state.closed = true;
      if (!state.handedIn && state.saveTimer) save();
      resize?.disconnect();
      for (const url of urls) URL.revokeObjectURL(url);
      dialog.remove();
      returnFocus?.focus?.();
      resolve({ handedIn: Boolean(state.handedIn) });
    }, { once: true });
  });

  dialog.showModal();
  paintTools();
  sizePages();
  resize?.observe(scroller);
  (toolButtons[0]).focus();
  if (hasInk(doc)) say('Your saved marks are back.');

  // Page backgrounds, one at a time (each is a 200 dpi page), after the view shows
  (async () => {
    const canvas = document.createElement('canvas');
    for (let i = 0; i < pageCount && !state.closed; i += 1) {
      renderPage(layout, i, { canvas });
      let bytes;
      try {
        ({ bytes } = await canvasJpeg(canvas));
      } catch (error) {
        // A browser that will not read back a canvas with a formula image: TeX as text
        if (error?.name !== 'SecurityError') throw error;
        layout.mathAsText = true;
        renderPage(layout, i, { canvas });
        ({ bytes } = await canvasJpeg(canvas));
      }
      if (state.closed) break;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      urls.push(url);
      pages[i].bg.src = url;
      pages[i].el.classList.remove('is-loading');
    }
    canvas.width = 0;
    canvas.height = 0;
  })().catch((error) => console.error(error));
  return { closed };
}
