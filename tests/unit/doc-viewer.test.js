import { describe, test, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PAGE_CSS_WIDTH, ZOOM_STEPS, MIN_ZOOM, MAX_ZOOM, PRESETS, clampZoom, fitZoom, zoomIn, zoomOut, zoomLabel, clampPage, nextPage, prevPage,
  pageLabel, renderDpi, pageInView, previewKey, createDebounce,
} from '../../portal/js/doc-viewer-model.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
afterEach(() => vi.useRealTimers());

describe('zoom', () => {
  test('steps from 50% to 300%, presets fit width, 100% and 150%', () => {
    expect(ZOOM_STEPS).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2, 3]);
    expect([MIN_ZOOM, MAX_ZOOM]).toEqual([0.5, 3]);
    expect(PRESETS.map((p) => p.value)).toEqual(['fit', 1, 1.5]);
    expect(PAGE_CSS_WIDTH).toBe(816);
  });

  test('plus and minus go to the next step, from any zoom, and stop at the ends', () => {
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomIn(1.1)).toBe(1.25);
    expect(zoomIn(3)).toBe(3);
    expect(zoomOut(1)).toBe(0.75);
    expect(zoomOut(0.9)).toBe(0.75);
    expect(zoomOut(0.5)).toBe(0.5);
    expect(zoomOut(0.42)).toBe(0.5);
  });

  test('clamped between 50% and 300%; labels', () => {
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(9)).toBe(3);
    expect(clampZoom('x')).toBe(1);
    expect(zoomLabel(1.25)).toBe('125%');
    expect(zoomLabel(0.8, 'fit')).toBe('Fit width');
  });

  test('fit width: the page as wide as the space less a gutter, up to a limit', () => {
    expect(fitZoom(816 + 32)).toBeCloseTo(1);
    expect(fitZoom(375, { gutter: 24 })).toBeCloseTo(351 / 816);
    expect(fitZoom(4000, { max: 1.5 })).toBe(1.5);
    expect(fitZoom(0)).toBe(0.5);
  });

  test('pages are drawn sharp for the width shown and the screen', () => {
    expect(renderDpi(816, 1)).toBe(96);
    expect(renderDpi(816, 2)).toBe(192);
    expect(renderDpi(816, 3)).toBe(192);
    expect(renderDpi(2448, 2)).toBe(250);
    expect(renderDpi(100, 1)).toBe(72);
  });
});

describe('pages', () => {
  test('next and previous stay inside the document', () => {
    expect(nextPage(0, 4)).toBe(1);
    expect(nextPage(3, 4)).toBe(3);
    expect(prevPage(0, 4)).toBe(0);
    expect(prevPage(2, 4)).toBe(1);
    expect(clampPage(9, 4)).toBe(3);
    expect(clampPage(-2, 4)).toBe(0);
    expect(clampPage(1, 0)).toBe(0);
  });

  test('the page in view follows the scroll', () => {
    const tops = [0, 1100, 2200, 3300];
    expect(pageInView(tops, 0, 900)).toBe(0);
    expect(pageInView(tops, 900, 900)).toBe(1);
    expect(pageInView(tops, 3300, 900)).toBe(3);
    expect(pageInView([], 0, 900)).toBe(0);
  });

  test('each page is labelled for screen readers', () => {
    expect(pageLabel(1, 4, 'Factoring practice')).toBe('Page 2 of 4 of Factoring practice');
    expect(pageLabel(0, 1, '')).toBe('Page 1 of 1 of the assignment');
  });
});

describe('re-rendering the preview', () => {
  test('the same source is the same preview; an edit or the key copy is not', () => {
    const a = previewKey({ title: 'T', details: '1. x', dueAt: null });
    expect(previewKey({ title: 'T', details: '1. x', dueAt: null })).toBe(a);
    expect(previewKey({ title: 'T', details: '1. y', dueAt: null })).not.toBe(a);
    expect(previewKey({ title: 'T', details: '1. x', withKey: true, keyText: 'A1. 2' })).not.toBe(a);
    expect(previewKey({ title: 'T', details: '1. x', withKey: false, keyText: 'A1. 2' })).toBe(a);
  });

  test('the debounce waits for the edits to settle, then draws once', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebounce(fn, 250);
    d.trigger(1);
    vi.advanceTimersByTime(200);
    d.trigger(2);
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    expect(d.waiting).toBe(true);
    vi.advanceTimersByTime(60);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2);
    d.trigger(3);
    d.flush();
    expect(fn).toHaveBeenLastCalledWith(3);
    d.trigger(4);
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('wiring', () => {
  const viewer = read('portal/js/doc-viewer.js');
  const ui = read('portal/js/worksheet-ui.js');

  test('the key copy shows only with a key, and only staff paths load the viewer', () => {
    expect(viewer).toContain('keyToggle.hidden = !shownKey;');
    expect(viewer).toMatch(/const modeToggle = doc\.hasKey\n\s*\? segmented/);
    // the drawer: staff get Preview (the viewer), families keep Open (a new tab)
    expect(ui).toMatch(/const openBtn = staff\n\s*\? button\(\{ label: 'Preview'/);
    expect(ui).toMatch(/if \(staff\) \{\n\s*const \{ openDocViewer \} = await loadViewer\(\);/);
    expect(read('portal/js/item-drawer.js')).toContain('keyText: staff ? found.answerKey?.body ?? null : null,');
    expect(viewer).not.toMatch(/from '\.\/answer-key\.js'/);
  });

  test('accessibility: page canvases are images with "Page N of M of title", and a hidden outline holds the text', () => {
    expect(viewer).toContain("canvas.setAttribute('role', 'img');");
    expect(viewer).toContain("canvas.setAttribute('aria-label', pageLabel(i, count, title));");
    expect(viewer).toContain("const out = h('div', { class: 'visually-hidden dv-outline' }");
    expect(viewer).toMatch(/h\('ol', \{\}, sec\.problems\.map/);
  });

  test('the viewer: a modal dialog (Esc closes, focus stays in it and goes back), zoom keys, no new tab', () => {
    expect(viewer).toContain('dialog.showModal();');
    expect(viewer).toContain('back?.focus?.();');
    expect(viewer).toMatch(/if \(e\.key === '\+' \|\| e\.key === '='\)/);
    expect(viewer).not.toMatch(/window\.open/);
    expect(read('portal/css/assignments.css')).toContain('touch-action: pan-x pan-y pinch-zoom;');
  });

  test('the form Preview is the document, redrawn after edits, with the card view a link away', () => {
    const form = read('portal/js/item-form.js');
    expect(form).toContain('docPreview.refresh();');
    expect(viewer).toContain("const viewLink = h('button', { type: 'button', class: 'link dv-view-link' }, 'Show as the portal view');");
    expect(viewer).toContain('const debounced = createDebounce(() => { render(); }, RENDER_DELAY_MS);');
    expect(viewer).toContain('pages.replaceChildren(...skeletonPages());');
  });
});
