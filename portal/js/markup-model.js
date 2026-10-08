// Pure logic for marking up a worksheet in the portal (markup.js draws it):
// the strokes on each page, undo and redo, the eraser's hit test, stroke
// simplification, the two-finger zoom, and what is saved on the device.
//
// Points are in page points (a Letter page is 612 x 792), so a stroke stays in
// place at any zoom and draws the same on the 200 dpi page that is handed in.
//
// A stroke: { id, tool: 'pen' | 'highlighter', color, width, points: [[x, y, pressure], ...] }
// A document: { pages: [[stroke, ...], ...], undo: [action], redo: [action], nextId }
// An action: { type: 'add', page, stroke } or
//            { type: 'remove' | 'clear', page, removed: [{ stroke, index }] }

export const TOOLS = Object.freeze(['pen', 'highlighter', 'eraser']);
export const COLORS = Object.freeze([
  Object.freeze({ value: '#1f2328', label: 'Black' }),
  Object.freeze({ value: '#1d4ed8', label: 'Blue' }),
  Object.freeze({ value: '#c62828', label: 'Red' }),
]);
export const PEN_WIDTH = 1.8;            // points; a pen with pressure goes 0.5x to 1.5x
export const HIGHLIGHT_WIDTH = 12;
export const HIGHLIGHT_ALPHA = 0.3;
export const ERASER_RADIUS = 7;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const SIMPLIFY_TOLERANCE = 0.3;   // points: well under a pen's width
export const SAVE_PREFIX = 'vb-markup:';
export const SAVE_VERSION = 1;
const MAX_POINTS = 4000;                 // per stroke, after simplification

// ---------------------------------------------------------------------------
// The document

export function createDoc(pageCount) {
  return { pages: Array.from({ length: Math.max(1, pageCount) }, () => []), undo: [], redo: [], nextId: 1 };
}

const pageOf = (doc, page) => {
  if (!Number.isInteger(page) || page < 0 || page >= doc.pages.length) throw new Error(`No page ${page}`);
  return doc.pages[page];
};

// Adds a finished stroke (given an id) -> the stroke
export function addStroke(doc, page, stroke) {
  const strokes = pageOf(doc, page);
  const made = { ...stroke, id: doc.nextId++ };
  strokes.push(made);
  doc.undo.push({ type: 'add', page, stroke: made });
  doc.redo = [];
  return made;
}

function take(doc, page, ids, type) {
  const strokes = pageOf(doc, page);
  const wanted = new Set(ids);
  const removed = [];
  strokes.forEach((stroke, index) => {
    if (wanted.has(stroke.id)) removed.push({ stroke, index });
  });
  if (!removed.length) return [];
  doc.pages[page] = strokes.filter((s) => !wanted.has(s.id));
  doc.undo.push({ type, page, removed });
  doc.redo = [];
  return removed.map((r) => r.stroke);
}

// The eraser: removes these strokes as one step -> the strokes removed
export function removeStrokes(doc, page, ids) {
  return take(doc, page, ids, 'remove');
}

// Clears a page as one step (undo brings it all back)
export function clearPage(doc, page) {
  return take(doc, page, pageOf(doc, page).map((s) => s.id), 'clear');
}

function putBack(doc, page, removed) {
  const strokes = [...doc.pages[page]];
  for (const { stroke, index } of [...removed].sort((a, b) => a.index - b.index)) {
    strokes.splice(Math.min(index, strokes.length), 0, stroke);
  }
  doc.pages[page] = strokes;
}

// -> the page that changed, or null when there is nothing to undo
export function undo(doc) {
  const action = doc.undo.pop();
  if (!action) return null;
  if (action.type === 'add') doc.pages[action.page] = doc.pages[action.page].filter((s) => s.id !== action.stroke.id);
  else putBack(doc, action.page, action.removed);
  doc.redo.push(action);
  return action.page;
}

export function redo(doc) {
  const action = doc.redo.pop();
  if (!action) return null;
  if (action.type === 'add') doc.pages[action.page].push(action.stroke);
  else {
    const ids = new Set(action.removed.map((r) => r.stroke.id));
    doc.pages[action.page] = doc.pages[action.page].filter((s) => !ids.has(s.id));
  }
  doc.undo.push(action);
  return action.page;
}

export const canUndo = (doc) => doc.undo.length > 0;
export const canRedo = (doc) => doc.redo.length > 0;
export const hasInk = (doc) => doc.pages.some((strokes) => strokes.length > 0);

// ---------------------------------------------------------------------------
// Strokes

// The pressure to keep: a pen's own (0.1 to 1), 0.5 for a finger or a mouse
export function pressureOf(pointerType, pressure) {
  if (pointerType !== 'pen') return 0.5;
  const p = Number(pressure);
  if (!Number.isFinite(p) || p <= 0) return 0.5;
  return Math.min(1, Math.max(0.1, p));
}

// A pen's width at a pressure: half to one and a half times its width
export function widthAt(stroke, pressure = 0.5) {
  if (stroke.tool === 'highlighter') return stroke.width;
  return stroke.width * (0.5 + pressure);
}

export function newStroke(tool, color) {
  return { tool, color, width: tool === 'highlighter' ? HIGHLIGHT_WIDTH : PEN_WIDTH, points: [] };
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

// Ramer-Douglas-Peucker: fewer points along the same line (pressure kept per point)
export function simplify(points, tolerance = SIMPLIFY_TOLERANCE) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1;
    let farDist = tolerance;
    for (let i = a + 1; i < b; i += 1) {
      const d = segmentDistance(points[i][0], points[i][1], points[a][0], points[a][1], points[b][0], points[b][1]);
      if (d > farDist) {
        far = i;
        farDist = d;
      }
    }
    if (far !== -1) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out = points.filter((_, i) => keep[i]);
  if (out.length <= MAX_POINTS) return out;
  const step = Math.ceil(out.length / MAX_POINTS);
  return out.filter((_, i) => i % step === 0 || i === out.length - 1);
}

// Points rounded to a tenth of a point, as kept
export function roundPoints(points) {
  return points.map(([x, y, p]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round((p ?? 0.5) * 100) / 100]);
}

// Whether the eraser at `point` touches the stroke
export function hitStroke(stroke, [px, py], radius = ERASER_RADIUS) {
  const reach = radius + stroke.width / 2;
  const pts = stroke.points;
  if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]) <= reach;
  for (let i = 1; i < pts.length; i += 1) {
    if (segmentDistance(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= reach) return true;
  }
  return false;
}

// The ids of the strokes the eraser touches
export function strokesAt(strokes, point, radius = ERASER_RADIUS) {
  return strokes.filter((s) => hitStroke(s, point, radius)).map((s) => s.id);
}

// ---------------------------------------------------------------------------
// The view

// A client point on a page drawn at `rect` (its box on screen) -> page points
export function toPagePoint(clientX, clientY, rect, pageWidth = 612, pageHeight = 792) {
  return [
    ((clientX - rect.left) / rect.width) * pageWidth,
    ((clientY - rect.top) / rect.height) * pageHeight,
  ];
}

export function clampZoom(zoom) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(zoom) || MIN_ZOOM));
}

// Two fingers moving from (a0, b0) to (a1, b1): how much to scale and pan
// -> { scale, dx, dy, cx, cy } (cx, cy: the midpoint now)
export function pinch(a0, b0, a1, b1) {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y) || 1;
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  return { scale: d1 / d0, dx: m1.x - m0.x, dy: m1.y - m0.y, cx: m1.x, cy: m1.y };
}

// ---------------------------------------------------------------------------
// Saved on the device (localStorage), per viewer, student and assignment

export function markupKey({ viewerId, studentId, taskId }) {
  return `${SAVE_PREFIX}${viewerId}:${studentId}:${taskId}`;
}

// What is kept: the strokes only, compact
export function toSaved(doc, { savedAt = new Date().toISOString() } = {}) {
  return {
    v: SAVE_VERSION,
    savedAt,
    pages: doc.pages.map((strokes) => strokes.map((s) => ({ t: s.tool, c: s.color, w: s.width, p: roundPoints(s.points) }))),
  };
}

const COLOR_VALUES = new Set(COLORS.map((c) => c.value));

// A document from what was saved, or null when it is missing or not ours.
// A worksheet with fewer pages than before keeps the strokes that still fit.
export function fromSaved(saved, pageCount) {
  if (!saved || typeof saved !== 'object' || saved.v !== SAVE_VERSION || !Array.isArray(saved.pages)) return null;
  const doc = createDoc(pageCount);
  for (let page = 0; page < Math.min(pageCount, saved.pages.length); page += 1) {
    const list = Array.isArray(saved.pages[page]) ? saved.pages[page] : [];
    for (const s of list) {
      if (!s || !['pen', 'highlighter'].includes(s.t) || !COLOR_VALUES.has(s.c) || !Array.isArray(s.p)) continue;
      const points = s.p.filter((pt) => Array.isArray(pt) && pt.length >= 2 && pt.every((n) => Number.isFinite(n)));
      if (!points.length) continue;
      const width = Number.isFinite(s.w) && s.w > 0 && s.w <= 40 ? s.w : (s.t === 'highlighter' ? HIGHLIGHT_WIDTH : PEN_WIDTH);
      doc.pages[page].push({ id: doc.nextId++, tool: s.t, color: s.c, width, points });
    }
  }
  return doc;
}
