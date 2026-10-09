import { describe, test, expect } from 'vitest';
import {
  COLORS, PEN_WIDTH, HIGHLIGHT_WIDTH, ERASER_RADIUS, MIN_ZOOM, MAX_ZOOM,
  createDoc, addStroke, removeStrokes, clearPage, undo, redo, canUndo, canRedo, hasInk,
  pressureOf, widthAt, newStroke, simplify, roundPoints, hitStroke, strokesAt, toPagePoint, clampZoom, pinch,
  markupKey, toSaved, fromSaved,
} from '../../portal/js/markup-model.js';

const BLACK = COLORS[0].value;
const line = (x0, y0, x1, y1, n = 10) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 0.5]);
const pen = (points) => ({ ...newStroke('pen', BLACK), points });

describe('strokes, undo and redo', () => {
  test('adding gives ids; undo and redo walk back and forth', () => {
    const doc = createDoc(2);
    const a = addStroke(doc, 0, pen(line(0, 0, 10, 0)));
    const b = addStroke(doc, 1, pen(line(0, 0, 0, 10)));
    expect([a.id, b.id]).toEqual([1, 2]);
    expect(hasInk(doc)).toBe(true);
    expect(undo(doc)).toBe(1);
    expect(doc.pages[1]).toEqual([]);
    expect(canRedo(doc)).toBe(true);
    expect(redo(doc)).toBe(1);
    expect(doc.pages[1].map((s) => s.id)).toEqual([2]);
    undo(doc);
    undo(doc);
    expect(hasInk(doc)).toBe(false);
    expect(undo(doc)).toBeNull();
    expect(canUndo(doc)).toBe(false);
  });

  test('a new stroke after an undo drops what could be redone', () => {
    const doc = createDoc(1);
    addStroke(doc, 0, pen(line(0, 0, 1, 1)));
    undo(doc);
    addStroke(doc, 0, pen(line(2, 2, 3, 3)));
    expect(canRedo(doc)).toBe(false);
    expect(redo(doc)).toBeNull();
  });

  test('the eraser removes whole strokes as one step, and undo puts them back in place', () => {
    const doc = createDoc(1);
    const a = addStroke(doc, 0, pen(line(0, 0, 100, 0)));
    const b = addStroke(doc, 0, pen(line(0, 50, 100, 50)));
    const c = addStroke(doc, 0, pen(line(0, 100, 100, 100)));
    expect(removeStrokes(doc, 0, [a.id, c.id]).map((s) => s.id)).toEqual([a.id, c.id]);
    expect(doc.pages[0].map((s) => s.id)).toEqual([b.id]);
    undo(doc);
    expect(doc.pages[0].map((s) => s.id)).toEqual([a.id, b.id, c.id]);
    redo(doc);
    expect(doc.pages[0].map((s) => s.id)).toEqual([b.id]);
    expect(removeStrokes(doc, 0, [999])).toEqual([]);
  });

  test('clear page is one step too', () => {
    const doc = createDoc(2);
    addStroke(doc, 0, pen(line(0, 0, 1, 1)));
    addStroke(doc, 0, pen(line(1, 1, 2, 2)));
    addStroke(doc, 1, pen(line(1, 1, 2, 2)));
    clearPage(doc, 0);
    expect(doc.pages[0]).toEqual([]);
    expect(doc.pages[1]).toHaveLength(1);
    expect(undo(doc)).toBe(0);
    expect(doc.pages[0]).toHaveLength(2);
    expect(() => clearPage(doc, 5)).toThrow();
  });
});

describe('pen, highlighter and eraser', () => {
  test('a pen keeps its pressure; a finger or a mouse draws at an even 0.5', () => {
    expect(pressureOf('pen', 0.8)).toBe(0.8);
    expect(pressureOf('pen', 0)).toBe(0.5);
    expect(pressureOf('pen', 0.01)).toBe(0.1);
    expect(pressureOf('touch', 0.9)).toBe(0.5);
    expect(pressureOf('mouse', 1)).toBe(0.5);
    const p = newStroke('pen', BLACK);
    expect(p.width).toBe(PEN_WIDTH);
    expect(widthAt(p, 0.5)).toBe(PEN_WIDTH);
    expect(widthAt(p, 1)).toBeCloseTo(PEN_WIDTH * 1.5);
    const hl = newStroke('highlighter', BLACK);
    expect(hl.width).toBe(HIGHLIGHT_WIDTH);
    expect(widthAt(hl, 1)).toBe(HIGHLIGHT_WIDTH);
  });

  test('the eraser hits a stroke within its radius plus half the stroke', () => {
    const s = pen(line(0, 0, 100, 0));
    expect(hitStroke(s, [50, ERASER_RADIUS], ERASER_RADIUS)).toBe(true);
    expect(hitStroke(s, [50, ERASER_RADIUS + PEN_WIDTH], ERASER_RADIUS)).toBe(false);
    expect(hitStroke(s, [110, 0], ERASER_RADIUS)).toBe(false);
    expect(hitStroke(pen([[5, 5, 0.5]]), [7, 7], ERASER_RADIUS)).toBe(true);
    const strokes = [{ ...s, id: 1 }, { ...pen(line(0, 40, 100, 40)), id: 2 }];
    expect(strokesAt(strokes, [10, 39])).toEqual([2]);
  });
});

describe('simplification', () => {
  test('a straight line keeps its ends; a corner keeps the corner', () => {
    expect(simplify(line(0, 0, 100, 0, 50))).toEqual([[0, 0, 0.5], [100, 0, 0.5]]);
    const corner = [...line(0, 0, 50, 0, 20), ...line(50, 0, 50, 50, 20).slice(1)];
    expect(simplify(corner)).toEqual([[0, 0, 0.5], [50, 0, 0.5], [50, 50, 0.5]]);
    expect(simplify([[1, 1, 0.5]])).toEqual([[1, 1, 0.5]]);
  });

  test('a wiggle bigger than the tolerance survives', () => {
    const wiggle = [[0, 0, 0.5], [10, 3, 0.5], [20, 0, 0.5]];
    expect(simplify(wiggle)).toHaveLength(3);
    expect(simplify([[0, 0, 0.5], [10, 0.1, 0.5], [20, 0, 0.5]])).toHaveLength(2);
  });

  test('points are kept to a tenth of a point', () => {
    expect(roundPoints([[1.234, 5.678, 0.4567]])).toEqual([[1.2, 5.7, 0.46]]);
  });
});

describe('the view', () => {
  test('a client point maps to page points at any zoom', () => {
    const rect = { left: 100, top: 50, width: 306, height: 396 };   // half size
    expect(toPagePoint(100, 50, rect)).toEqual([0, 0]);
    expect(toPagePoint(406, 446, rect)).toEqual([612, 792]);
    expect(toPagePoint(253, 248, rect)).toEqual([306, 396]);
  });

  test('zoom stays between 100% and 400%', () => {
    expect([MIN_ZOOM, MAX_ZOOM]).toEqual([1, 4]);
    expect(clampZoom(0.5)).toBe(1);
    expect(clampZoom(9)).toBe(4);
    expect(clampZoom(2.5)).toBe(2.5);
    expect(clampZoom('x')).toBe(1);
  });

  test('two fingers: spreading zooms in, moving together pans', () => {
    const spread = pinch({ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 });
    expect(spread.scale).toBe(2);
    expect([spread.dx, spread.dy]).toEqual([0, 0]);
    const pan = pinch({ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 110, y: 130 }, { x: 210, y: 130 });
    expect(pan.scale).toBe(1);
    expect([pan.dx, pan.dy, pan.cx, pan.cy]).toEqual([10, 30, 160, 130]);
  });
});

describe('saved on the device', () => {
  test('one key per viewer, student and assignment', () => {
    expect(markupKey({ viewerId: 'u-maya', studentId: 'u-maya', taskId: 12 })).toBe('vb-markup:u-maya:u-maya:12');
  });

  test('strokes round-trip; undo history does not', () => {
    const doc = createDoc(2);
    addStroke(doc, 0, pen([[1.26, 2.34, 0.555], [3, 4, 0.5]]));
    addStroke(doc, 1, { ...newStroke('highlighter', COLORS[2].value), points: [[10, 10, 0.5], [40, 10, 0.5]] });
    const saved = JSON.parse(JSON.stringify(toSaved(doc, { savedAt: '2026-10-08T00:00:00Z' })));
    expect(saved).toEqual({
      v: 1,
      savedAt: '2026-10-08T00:00:00Z',
      pages: [
        [{ t: 'pen', c: BLACK, w: PEN_WIDTH, p: [[1.3, 2.3, 0.56], [3, 4, 0.5]] }],
        [{ t: 'highlighter', c: COLORS[2].value, w: HIGHLIGHT_WIDTH, p: [[10, 10, 0.5], [40, 10, 0.5]] }],
      ],
    });
    const back = fromSaved(saved, 2);
    expect(back.pages.map((p) => p.map((s) => s.tool))).toEqual([['pen'], ['highlighter']]);
    expect(back.undo).toEqual([]);
    expect(back.nextId).toBe(3);
  });

  test('anything not ours is ignored; fewer pages keep what fits', () => {
    expect(fromSaved(null, 1)).toBeNull();
    expect(fromSaved({ v: 2, pages: [] }, 1)).toBeNull();
    expect(fromSaved('x', 1)).toBeNull();
    const saved = { v: 1, pages: [[{ t: 'pen', c: BLACK, w: 2, p: [[1, 1]] }, { t: 'laser', c: BLACK, p: [[1, 1]] }, { t: 'pen', c: '#ff00ff', p: [[1, 1]] }, { t: 'pen', c: BLACK, p: [['x', 1]] }], [{ t: 'pen', c: BLACK, p: [[2, 2]] }]] };
    const doc = fromSaved(saved, 1);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]).toHaveLength(1);
    expect(fromSaved(saved, 3).pages.map((p) => p.length)).toEqual([1, 1, 0]);
  });
});
