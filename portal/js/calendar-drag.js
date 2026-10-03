// Drag to move on the calendar: one element's mouse or pen press that travels
// DRAG_THRESHOLD_PX becomes a drag. Touch is left alone, so a finger still
// scrolls the calendar (phones and tablets keep using Edit). Escape or a
// cancelled pointer ends a drag without a drop, and the click a drag would
// leave behind is swallowed, so letting go never opens the drawer too.

import { DRAG_THRESHOLD_PX } from './calendar-drag-model.js';

// One drag at a time. A view refresh waits for it (whenDragEnds), so the
// calendar is not redrawn under the pointer.
let active = 0;
let waiting = [];
export const dragInProgress = () => active > 0;
export function whenDragEnds(fn) {
  if (!active) fn();
  else waiting.push(fn);
}
function dragEnded() {
  active = Math.max(active - 1, 0);
  if (active) return;
  const run = waiting;
  waiting = [];
  for (const fn of run) fn();
}

// handlers: start(event) -> state or null (null turns the drag down),
// move(event, state), drop(event, state), end(state) after either a drop or a
// cancel (tidy the ghost there). signal ends the wiring with the view; a drag
// under way when it aborts is cancelled.
export function pointerDrag(el, { start, move, drop, end }, { signal } = {}) {
  // A link or image dragged natively would fight the pointer drag
  el.setAttribute('draggable', 'false');
  el.addEventListener('dragstart', (e) => e.preventDefault(), { signal });

  el.addEventListener('pointerdown', (down) => {
    if (down.button !== 0 || (down.pointerType !== 'mouse' && down.pointerType !== 'pen')) return;
    const x0 = down.clientX;
    const y0 = down.clientY;
    let state = null;
    let dragging = false;

    const finish = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      document.removeEventListener('keydown', onKey, true);
      signal?.removeEventListener('abort', onAbort);
      document.documentElement.classList.remove('is-cal-dragging');
      try {
        if (el.hasPointerCapture?.(down.pointerId)) el.releasePointerCapture(down.pointerId);
      } catch {
        // the element left the page mid-drag
      }
    };
    // dropped: the button came up (its click follows now). Otherwise the drag
    // was cancelled with the button still down, so the click comes later, on
    // the release: that one is swallowed instead.
    const stop = (dropped, e) => {
      const was = dragging;
      dragging = false;
      finish();
      if (!was) return;
      if (dropped) swallowNextClick();
      else if (e?.type !== 'pointercancel') swallowClickOnRelease(down.pointerId);
      try {
        if (dropped) drop(e, state);
      } finally {
        end?.(state);
        dragEnded();
      }
    };
    function onMove(e) {
      if (e.pointerId !== down.pointerId) return;
      if (!dragging) {
        if (Math.hypot(e.clientX - x0, e.clientY - y0) < DRAG_THRESHOLD_PX) return;
        state = start(down);
        if (!state) {
          finish();
          return;
        }
        dragging = true;
        active += 1;
        document.documentElement.classList.add('is-cal-dragging');
        window.getSelection?.()?.removeAllRanges();
        try {
          el.setPointerCapture?.(down.pointerId);
        } catch {
          // capture is a nicety; the window listeners still follow the pointer
        }
      }
      e.preventDefault();
      move(e, state);
    }
    function onUp(e) {
      if (e.pointerId === down.pointerId) stop(true, e);
    }
    function onCancel(e) {
      if (e.pointerId === down.pointerId) stop(false, e);
    }
    function onKey(e) {
      if (e.key !== 'Escape' || !dragging) return;
      e.preventDefault();
      e.stopPropagation();
      stop(false, e);
    }
    function onAbort() {
      stop(false, { type: 'abort' });
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    document.addEventListener('keydown', onKey, true);
  }, { signal });
}

// The click that follows a drag lands on whatever was under the pointer: stop
// it once. A drag with no click (released outside the window) leaves nothing
// behind, so the guard lapses on its own.
function swallowNextClick() {
  const guard = (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.removeEventListener('click', guard, true);
  };
  window.addEventListener('click', guard, true);
  setTimeout(() => window.removeEventListener('click', guard, true), 0);
}

// A drag cancelled while the button is down: the click the release makes
// later is swallowed too (once, for that pointer)
function swallowClickOnRelease(pointerId) {
  const onUp = (e) => {
    if (e.pointerId !== pointerId) return;
    window.removeEventListener('pointerup', onUp, true);
    swallowNextClick();
  };
  window.addEventListener('pointerup', onUp, true);
}

// The element under a point that matches selector (ghosts have
// pointer-events: none, so they are never the hit), or null
export function hitAt(x, y, selector) {
  return document.elementFromPoint(x, y)?.closest?.(selector) ?? null;
}
