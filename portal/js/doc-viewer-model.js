// Pure logic for showing an assignment as its document (the worksheet pages)
// in the staff form's Preview and in the full-screen viewer (doc-viewer.js):
// zoom steps, fit width, page navigation, the resolution pages are drawn at,
// labels, and a debounce for re-rendering. No DOM.

export const PAGE_CSS_WIDTH = 816;          // a Letter page at 100% (8.5 in at 96 px to the inch)
export const PAGE_RATIO = 792 / 612;        // height over width
export const ZOOM_STEPS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2, 3]);
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
export const PRESETS = Object.freeze([
  Object.freeze({ value: 'fit', label: 'Fit width' }),
  Object.freeze({ value: 1, label: '100%' }),
  Object.freeze({ value: 1.5, label: '150%' }),
]);
export const MIN_DPI = 72;
export const MAX_DPI = 250;
export const RENDER_DELAY_MS = 250;

const EPS = 1e-6;

export function clampZoom(zoom) {
  const z = Number(zoom);
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

// The zoom that makes a page as wide as the space, less a gutter, up to `max`
export function fitZoom(containerWidth, { gutter = 32, max = MAX_ZOOM } = {}) {
  const w = Number(containerWidth) - gutter;
  if (!Number.isFinite(w) || w <= 0) return MIN_ZOOM;
  return Math.min(max, Math.max(0.2, w / PAGE_CSS_WIDTH));
}

// The next step up or down from any zoom (a fit-width zoom between steps too)
export function zoomIn(zoom) {
  const z = Number(zoom) || 1;
  return ZOOM_STEPS.find((s) => s > z + EPS) ?? MAX_ZOOM;
}
export function zoomOut(zoom) {
  const z = Number(zoom) || 1;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - EPS) ?? MIN_ZOOM;
}

// "Fit width" or "125%"
export function zoomLabel(zoom, mode = null) {
  if (mode === 'fit') return 'Fit width';
  return `${Math.round((Number(zoom) || 1) * 100)}%`;
}

export function clampPage(index, count) {
  if (!count) return 0;
  const i = Math.round(Number(index) || 0);
  return Math.min(count - 1, Math.max(0, i));
}
export const nextPage = (index, count) => clampPage(index + 1, count);
export const prevPage = (index, count) => clampPage(index - 1, count);

// What screen readers hear for a page: "Page 2 of 4 of Factoring practice"
export function pageLabel(index, count, title) {
  return `Page ${index + 1} of ${count} of ${String(title ?? '').trim() || 'the assignment'}`;
}

// The resolution a page is drawn at to look sharp at a shown width (CSS px)
export function renderDpi(cssWidth, devicePixelRatio = 1) {
  const ratio = Math.min(Math.max(Number(devicePixelRatio) || 1, 1), 2);
  const dpi = ((Number(cssWidth) || PAGE_CSS_WIDTH) * ratio) / 8.5;
  return Math.round(Math.min(MAX_DPI, Math.max(MIN_DPI, dpi)));
}

// The page that is most in view: the first whose middle is below the top of the view
export function pageInView(tops, scrollTop, viewHeight) {
  if (!tops.length) return 0;
  const middle = scrollTop + viewHeight / 3;
  let best = 0;
  tops.forEach((top, i) => { if (top <= middle) best = i; });
  return best;
}

// What a preview shows: the same source drawn twice is drawn once
export function previewKey({ title = '', details = '', dueAt = null, withKey = false, keyText = '' } = {}) {
  return JSON.stringify([title, details, dueAt, withKey ? keyText : '']);
}

// Calls fn once things settle: trigger() waits `wait` ms after the last call;
// flush() runs it now if one is waiting; cancel() drops it
export function createDebounce(fn, wait = RENDER_DELAY_MS, timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (t) => clearTimeout(t) }) {
  let timer = null;
  let pending = null;
  return {
    trigger(...args) {
      pending = args;
      if (timer !== null) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => {
        timer = null;
        const a = pending;
        pending = null;
        fn(...a);
      }, wait);
    },
    flush() {
      if (timer === null) return;
      timers.clearTimeout(timer);
      timer = null;
      const a = pending;
      pending = null;
      fn(...a);
    },
    cancel() {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      pending = null;
    },
    get waiting() { return timer !== null; },
  };
}
