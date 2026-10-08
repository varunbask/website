// Pure layout for an assignment's worksheet: the printable problem set a
// student can fill in on paper or mark up in the portal. No DOM: text widths
// come from measure(text, fontKey), formula sizes from measureMath(tex,
// display, fontKey) -> { width, ascent, descent } (MathJax in the browser,
// fakes in tests), and everything is in PDF points (72 to the inch).
//
// layoutWorksheet({ title, details, dueText, appendix }, measure, measureMath, { colors })
//   -> { pages: [{ items, text }], problemCount }
// The details are read with homework-doc.js. The design follows the owner's
// homework spec (memory: homework-assignment-design): a branded header band
// with the company and the title; Name, Date and Period fields; objective,
// time, materials and due "chips"; a heading bar for each section with its
// directions; a shaded worked-example box with numbered steps; each problem
// with a number badge, its prompt, multiple-choice bubbles, a hint, and work
// space by its kind (short: an answer line, medium: 4 ruled lines, long: 8,
// grid: a dotted 0.25 in grid); and a footer with the title and Page N of M.
// A problem never splits from its work space, and a section heading never
// ends a page. Text a tutor typed (not in the format) keeps the old layout:
// its text, then its numbered problems, or one large work area.
//
// appendix { heading, text } is added on new pages at the end; only staff code
// passes one (the answer key, read with parseKey), never anything a family opens.
//
// items: { type: 'text', x, y, text, font, color }   (y is the baseline)
//        { type: 'math', x, y, tex, display, width, ascent, descent, font, color }
//        { type: 'rect', x, y, w, h, r, fill, stroke }
//        { type: 'circle', cx, cy, r, fill, stroke }
//        { type: 'rule', x1, y1, x2, y2, color, width }
//        { type: 'grid', x, y, w, h, step, color }

import { parseHomework, parseKey, splitMath } from './homework-doc.js';

export const PAGE = Object.freeze({ width: 612, height: 792, margin: 43.2 });   // Letter, 0.6 in margins
export const DPI = 200;
export const BRAND = 'VP Education Group';

export const FONTS = Object.freeze({
  brand: Object.freeze({ weight: 600, size: 9 }),
  title: Object.freeze({ weight: 600, size: 19 }),
  field: Object.freeze({ weight: 500, size: 10 }),
  chipLabel: Object.freeze({ weight: 600, size: 8.5 }),
  chip: Object.freeze({ weight: 400, size: 9.5 }),
  heading: Object.freeze({ weight: 600, size: 12 }),
  directions: Object.freeze({ weight: 400, size: 10 }),
  body: Object.freeze({ weight: 400, size: 11 }),
  problem: Object.freeze({ weight: 400, size: 11.5 }),
  badge: Object.freeze({ weight: 600, size: 9.5 }),
  choice: Object.freeze({ weight: 400, size: 11 }),
  bubble: Object.freeze({ weight: 600, size: 7.5 }),
  hint: Object.freeze({ weight: 400, size: 9.5 }),
  label: Object.freeze({ weight: 600, size: 8.5 }),
  keyHeading: Object.freeze({ weight: 600, size: 11 }),
  footer: Object.freeze({ weight: 400, size: 8 }),
});

export const DEFAULT_COLORS = Object.freeze({
  accent: '#0F6E66', accentSoft: '#E3F1EE', accentText: '#0B5E57', onAccent: '#FFFFFF',
  ink: '#1f2328', muted: '#5b616e', line: '#c9cdd4', faint: '#e3e6ea', dots: '#aab1bb',
});

const LEADING = 1.38;
const CW = PAGE.width - PAGE.margin * 2;
const LEFT = PAGE.margin;
const TOP = PAGE.margin;
const FOOTER_TOP = PAGE.height - PAGE.margin + 4;
const BOTTOM = PAGE.height - PAGE.margin - 8;       // content stops here
const INDENT = 28;                                  // problem text starts this far right of the margin
const RULE_GAP = 22;
export const SPACE_HEIGHTS = Object.freeze({ none: 0, short: 30, medium: 4 * RULE_GAP + 8, long: 8 * RULE_GAP + 8, grid: 180 });

export const lineHeight = (key) => FONTS[key].size * LEADING;
const size = (key) => FONTS[key].size;

// ---------------------------------------------------------------------------
// Rich text: words and formulas on lines

// Lines of at most `width`, keeping the text's own line breaks; a word longer
// than the line is broken between characters (plain text, no formulas)
export function wrapText(text, width, measure, font) {
  return layoutRich(text, width, measure, null, font).lines
    .map((line) => line.items.map((it) => (it.type === 'text' ? it.text : `$${it.tex}$`)).join('').trim());
}

// Breaks text and formulas into lines -> { lines: [{ items, width, ascent, descent, height, center }], height }
// items: { type: 'text', dx, text } | { type: 'math', dx, tex, display, width, ascent, descent }
export function layoutRich(text, width, measure, measureMath, font) {
  const fs = size(font);
  const mathBox = (tex, display) => {
    const m = measureMath ? measureMath(tex, display, font) : null;
    if (m && m.width > 0) return m;
    return { width: measure(display ? `$$${tex}$$` : `$${tex}$`, font), ascent: fs * 0.78, descent: fs * 0.22, fallback: true };
  };
  // Tokens: groups of words and formulas with no space between them (never broken), spaces, breaks, display math
  const tokens = [];
  let group = [];
  const endGroup = () => {
    if (group.length) tokens.push({ kind: 'group', parts: group });
    group = [];
  };
  for (const part of splitMath(text)) {
    if (part.type === 'math') {
      if (part.display) {
        endGroup();
        tokens.push({ kind: 'display', tex: part.value });
      } else {
        group.push({ type: 'math', tex: part.value });
      }
      continue;
    }
    const pieces = part.value.split(/(\n|[^\S\n]+)/);
    for (const piece of pieces) {
      if (!piece) continue;
      if (piece === '\n') {
        endGroup();
        tokens.push({ kind: 'break' });
      } else if (/^\s+$/.test(piece)) {
        endGroup();
        tokens.push({ kind: 'space' });
      } else {
        group.push({ type: 'text', text: piece });
      }
    }
  }
  endGroup();

  const lines = [];
  let line = null;
  let pendingSpace = false;
  const spaceW = measure(' ', font);
  const newLine = (center = false) => {
    line = { items: [], width: 0, ascent: fs * 0.78, descent: fs * 0.22, center };
    lines.push(line);
    pendingSpace = false;
  };
  const place = (piece) => {
    if (piece.type === 'math') {
      const box = mathBox(piece.tex, false);
      line.items.push({ type: 'math', dx: line.width, tex: piece.tex, display: false, width: box.width, ascent: box.ascent, descent: box.descent, fallback: box.fallback });
      line.width += box.width;
      line.ascent = Math.max(line.ascent, box.ascent);
      line.descent = Math.max(line.descent, box.descent);
      return;
    }
    const last = line.items[line.items.length - 1];
    if (last && last.type === 'text') {
      last.text += piece.text;
    } else {
      line.items.push({ type: 'text', dx: line.width, text: piece.text });
    }
    line.width += measure(piece.text, font);
  };
  const pieceWidth = (piece) => (piece.type === 'math' ? mathBox(piece.tex, false).width : measure(piece.text, font));

  newLine();
  for (const token of tokens) {
    if (token.kind === 'break') {
      newLine();
      continue;
    }
    if (token.kind === 'space') {
      if (line.items.length) pendingSpace = true;
      continue;
    }
    if (token.kind === 'display') {
      if (line.items.length) newLine(true);
      else line.center = true;
      const box = mathBox(token.tex, true);
      line.items.push({ type: 'math', dx: 0, tex: token.tex, display: true, width: box.width, ascent: box.ascent, descent: box.descent, fallback: box.fallback });
      line.width = box.width;
      line.ascent = Math.max(line.ascent, box.ascent);
      line.descent = Math.max(line.descent, box.descent);
      newLine();
      continue;
    }
    const groupW = token.parts.reduce((w, p) => w + pieceWidth(p), 0);
    const lead = pendingSpace ? spaceW : 0;
    if (line.items.length && line.width + lead + groupW > width) newLine();
    else if (pendingSpace && line.items.length) {
      const last = line.items[line.items.length - 1];
      if (last.type === 'text') last.text += ' ';
      else line.items.push({ type: 'text', dx: line.width, text: ' ' });
      line.width += spaceW;
    }
    pendingSpace = false;
    for (const piece of token.parts) {
      const w = pieceWidth(piece);
      if (piece.type === 'text' && line.width + w > width && w > width) {
        // A word wider than the line: break it between characters
        for (const ch of piece.text) {
          if (line.items.length && line.width + measure(ch, font) > width) newLine();
          place({ type: 'text', text: ch });
        }
        continue;
      }
      if (line.items.length && line.width + w > width && w <= width) newLine();
      place(piece);
    }
  }
  // No empty lines at the ends
  while (lines.length && !lines[lines.length - 1].items.length) lines.pop();
  while (lines.length && !lines[0].items.length) lines.shift();
  for (const l of lines) l.height = Math.max(fs * LEADING, l.ascent + l.descent + 4);
  return { lines, height: lines.reduce((h, l) => h + l.height, 0) };
}

// The items for rich text laid out at (x, top) -> bottom y
function emitRich(items, rich, x, top, width, font, color) {
  let y = top;
  for (const line of rich.lines) {
    const baseline = y + (line.height - (line.ascent + line.descent)) / 2 + line.ascent;
    const offset = line.center ? Math.max(0, (width - line.width) / 2) : 0;
    for (const it of line.items) {
      if (it.type === 'text') {
        if (it.text.trim()) items.push({ type: 'text', x: x + offset + it.dx, y: baseline, text: it.text.replace(/\s+$/, ''), font, color });
      } else {
        items.push({
          type: 'math', x: x + offset + it.dx, y: baseline, tex: it.tex, display: it.display,
          width: it.width, ascent: it.ascent, descent: it.descent, font, color, fallback: Boolean(it.fallback),
        });
      }
    }
    y += line.height;
  }
  return y;
}

const plainOf = (text) => splitMath(text).map((p) => (p.type === 'math' ? p.value : p.value)).join('').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Blocks: each knows its height and draws itself at a top y

// The work space under a problem
export function spaceFor(problem, { kind = null, count = 1 } = {}) {
  if (problem.space) return problem.space;
  if (problem.choices?.length) return 'none';
  if (kind === 'legacy') return count <= 3 ? 'long' : count <= 6 ? 'medium' : 'short';
  return 'medium';
}

function drawSpace(items, space, x, top, w, colors) {
  if (space === 'short') {
    const y = top + 22;
    items.push({ type: 'text', x, y, text: 'Answer', font: 'label', color: colors.muted });
    items.push({ type: 'rule', x1: x + 44, y1: y + 2, x2: Math.min(x + w, x + 300), y2: y + 2, color: colors.line, width: 0.8 });
    return;
  }
  if (space === 'medium' || space === 'long') {
    const n = space === 'medium' ? 4 : 8;
    for (let i = 1; i <= n; i += 1) {
      const y = top + i * RULE_GAP;
      items.push({ type: 'rule', x1: x, y1: y, x2: x + w, y2: y, color: colors.line, width: 0.6 });
    }
    return;
  }
  if (space === 'grid') {
    items.push({ type: 'rect', x, y: top + 6, w, h: SPACE_HEIGHTS.grid - 8, r: 4, fill: null, stroke: colors.faint });
    items.push({ type: 'grid', x, y: top + 6, w, h: SPACE_HEIGHTS.grid - 8, step: 18, color: colors.dots });
  }
}

function problemBlock(problem, { measure, measureMath, colors, kind, count, fill = null }) {
  const x = LEFT + INDENT;
  const w = CW - INDENT;
  const prompt = layoutRich(problem.prompt, w, measure, measureMath, 'problem');
  const choiceCols = problem.choices?.length
    ? (problem.choices.every((c) => layoutRich(c, w / 2 - 26, measure, measureMath, 'choice').lines.length <= 1) ? 2 : 1)
    : 0;
  const choices = (problem.choices ?? []).map((c) => layoutRich(c, (choiceCols === 2 ? w / 2 : w) - 26, measure, measureMath, 'choice'));
  const choiceRows = [];
  for (let i = 0; i < choices.length; i += choiceCols || 1) choiceRows.push(choices.slice(i, i + (choiceCols || 1)));
  const choicesH = choiceRows.reduce((hgt, row) => hgt + Math.max(...row.map((c) => Math.max(c.height, 18))) + 4, 0);
  const hint = problem.hint ? layoutRich(`Hint: ${problem.hint}`, w, measure, measureMath, 'hint') : null;
  const space = spaceFor(problem, { kind, count });
  const spaceH = fill ?? SPACE_HEIGHTS[space];
  const height = prompt.height + (choicesH ? choicesH + 6 : 0) + (hint ? hint.height + 4 : 0) + spaceH + 14;
  return {
    height,
    keepWithNext: false,
    text: [`${problem.number}. ${plainOf(problem.prompt)}`, ...(problem.choices ?? []).map((c, i) => `(${'ABCDEF'[i]}) ${plainOf(c)}`)],
    draw(items, top, room = null) {
      // Number badge beside the first line
      const first = prompt.lines[0];
      const baseline = top + (first ? (first.height - (first.ascent + first.descent)) / 2 + first.ascent : size('problem'));
      const cy = baseline - size('problem') * 0.34;
      items.push({ type: 'circle', cx: LEFT + 9.5, cy, r: 9.5, fill: colors.accent, stroke: null });
      const label = String(problem.number);
      items.push({ type: 'text', x: LEFT + 9.5 - measure(label, 'badge') / 2, y: cy + size('badge') * 0.36, text: label, font: 'badge', color: colors.onAccent });
      let y = emitRich(items, prompt, x, top, w, 'problem', colors.ink);
      if (choiceRows.length) {
        y += 6;
        let letter = 0;
        for (const row of choiceRows) {
          const rowH = Math.max(...row.map((c) => Math.max(c.height, 18)));
          row.forEach((c, k) => {
            const cx = x + k * (w / 2) + 8;
            const midline = y + rowH / 2;
            items.push({ type: 'circle', cx, cy: midline, r: 7, fill: null, stroke: colors.muted });
            const L = 'ABCDEF'[letter];
            items.push({ type: 'text', x: cx - measure(L, 'bubble') / 2, y: midline + size('bubble') * 0.36, text: L, font: 'bubble', color: colors.muted });
            emitRich(items, c, cx + 14, midline - c.height / 2, (choiceCols === 2 ? w / 2 : w) - 26, 'choice', colors.ink);
            letter += 1;
          });
          y += rowH + 4;
        }
      }
      if (hint) {
        y += 4;
        y = emitRich(items, hint, x, y, w, 'hint', colors.muted);
      }
      const spaceHeight = room ?? spaceH;
      if (fill !== null || room !== null) {
        const n = Math.max(1, Math.floor((spaceHeight - 8) / RULE_GAP));
        for (let i = 1; i <= n; i += 1) items.push({ type: 'rule', x1: x, y1: y + i * RULE_GAP, x2: x + w, y2: y + i * RULE_GAP, color: colors.line, width: 0.6 });
      } else {
        drawSpace(items, space, x, y, w, colors);
      }
    },
  };
}

function headingBlock(heading, directions, { measure, measureMath, colors }) {
  const title = layoutRich(heading, CW - 24, measure, measureMath, 'heading');
  const barH = Math.max(24, title.height + 8);
  const dir = directions ? layoutRich(directions, CW - 4, measure, measureMath, 'directions') : null;
  return {
    height: barH + (dir ? dir.height + 6 : 0) + 8,
    keepWithNext: true,
    text: [plainOf(heading), directions ? plainOf(directions) : null].filter(Boolean),
    draw(items, top) {
      items.push({ type: 'rect', x: LEFT, y: top, w: CW, h: barH, r: 5, fill: colors.accentSoft, stroke: null });
      items.push({ type: 'rect', x: LEFT, y: top, w: 4, h: barH, r: 2, fill: colors.accent, stroke: null });
      emitRich(items, title, LEFT + 14, top + (barH - title.height) / 2, CW - 24, 'heading', colors.accentText);
      if (dir) emitRich(items, dir, LEFT + 2, top + barH + 6, CW - 4, 'directions', colors.muted);
    },
  };
}

function exampleBlock(ex, { measure, measureMath, colors }) {
  const pad = 12;
  const w = CW - pad * 2 - 4;
  const problem = layoutRich(ex.problem, w - 56, measure, measureMath, 'body');
  const steps = ex.steps.map((s) => layoutRich(s, w - 22, measure, measureMath, 'body'));
  const answer = ex.answer ? layoutRich(ex.answer, w - 56, measure, measureMath, 'body') : null;
  const inner = problem.height + 6 + steps.reduce((hgt, s) => hgt + s.height + 2, 0) + (answer ? answer.height + 8 : 0);
  const boxH = inner + pad * 2 + 14;
  return {
    height: boxH + 12,
    keepWithNext: false,
    text: ['Worked example', plainOf(ex.problem), ...ex.steps.map((s, i) => `Step ${i + 1}: ${plainOf(s)}`), ex.answer ? `Answer: ${plainOf(ex.answer)}` : null].filter(Boolean),
    draw(items, top) {
      items.push({ type: 'rect', x: LEFT, y: top, w: CW, h: boxH, r: 8, fill: '#F6F8F9', stroke: colors.line });
      items.push({ type: 'rect', x: LEFT, y: top, w: 4, h: boxH, r: 2, fill: colors.accent, stroke: null });
      const x = LEFT + pad + 4;
      let y = top + pad;
      items.push({ type: 'text', x, y: y + 8, text: 'WORKED EXAMPLE', font: 'label', color: colors.accentText });
      y += 14;
      items.push({ type: 'text', x, y: y + size('body') * 1.0, text: 'Problem', font: 'label', color: colors.muted });
      y = emitRich(items, problem, x + 56, y, w - 56, 'body', colors.ink) + 6;
      steps.forEach((s, i) => {
        const first = s.lines[0];
        const base = y + (first ? (first.height - (first.ascent + first.descent)) / 2 + first.ascent : size('body'));
        items.push({ type: 'text', x, y: base, text: `${i + 1}.`, font: 'label', color: colors.accentText });
        y = emitRich(items, s, x + 22, y, w - 22, 'body', colors.ink) + 2;
      });
      if (answer) {
        y += 6;
        items.push({ type: 'rect', x: x - 4, y: y - 2, w: w + 8, h: answer.height + 4, r: 4, fill: colors.accentSoft, stroke: null });
        const first = answer.lines[0];
        const base = y + (first ? (first.height - (first.ascent + first.descent)) / 2 + first.ascent : size('body'));
        items.push({ type: 'text', x, y: base, text: 'Answer', font: 'label', color: colors.accentText });
        emitRich(items, answer, x + 56, y, w - 56, 'body', colors.ink);
      }
    },
  };
}

function paragraphBlock(text, { measure, measureMath, colors }, font = 'body') {
  const rich = layoutRich(text, CW, measure, measureMath, font);
  return {
    height: rich.height + 8,
    keepWithNext: false,
    splittable: rich,
    text: [plainOf(text)],
    draw(items, top) { emitRich(items, rich, LEFT, top, CW, font, colors.ink); },
  };
}

// ---------------------------------------------------------------------------
// The page

function headerItems(items, { title, doc, dueText }, { measure, measureMath, colors }) {
  const titleRich = layoutRich(title || 'Assignment', CW - 32, measure, measureMath, 'title');
  const bandH = 16 + 12 + titleRich.height + 14;
  items.push({ type: 'rect', x: LEFT, y: TOP, w: CW, h: bandH, r: 10, fill: colors.accent, stroke: null });
  items.push({ type: 'text', x: LEFT + 16, y: TOP + 16 + 6, text: BRAND.toUpperCase(), font: 'brand', color: '#D7EFEA' });
  emitRich(items, titleRich, LEFT + 16, TOP + 30, CW - 32, 'title', colors.onAccent);
  let y = TOP + bandH + 24;

  // Name, Date, Period
  const fields = [['Name', 0.52], ['Date', 0.27], ['Period', 0.21]];
  let x = LEFT;
  for (const [label, share] of fields) {
    const w = CW * share;
    items.push({ type: 'text', x, y, text: label, font: 'field', color: colors.muted });
    items.push({ type: 'rule', x1: x + measure(label, 'field') + 6, y1: y + 2, x2: x + w - 14, y2: y + 2, color: colors.line, width: 0.8 });
    x += w;
  }
  y += 16;

  // The objective as a box, then small chips: time, materials, due
  if (doc.objective) {
    const rich = layoutRich(doc.objective, CW - 24 - 66, measure, measureMath, 'chip');
    const hgt = Math.max(22, rich.height + 10);
    items.push({ type: 'rect', x: LEFT, y, w: CW, h: hgt, r: hgt / 2 > 12 ? 8 : hgt / 2, fill: colors.accentSoft, stroke: null });
    const first = rich.lines[0];
    const base = y + 5 + (first ? (first.height - (first.ascent + first.descent)) / 2 + first.ascent : size('chip'));
    items.push({ type: 'text', x: LEFT + 12, y: base, text: 'OBJECTIVE', font: 'chipLabel', color: colors.accentText });
    emitRich(items, rich, LEFT + 12 + 66, y + 5, CW - 24 - 66, 'chip', colors.ink);
    y += hgt + 6;
  }
  const chips = [
    doc.time ? ['TIME', doc.time.replace(/^about\s+/i, 'About ')] : null,
    doc.materials ? ['MATERIALS', doc.materials] : null,
    dueText ? ['DUE', dueText.replace(/^Due\s+/, '')] : null,
  ].filter(Boolean);
  let cx = LEFT;
  for (const [label, value] of chips) {
    const lw = measure(label, 'chipLabel');
    const vw = Math.min(measure(value, 'chip'), CW - lw - 30);
    const w = lw + vw + 26;
    if (cx + w > LEFT + CW && cx > LEFT) {
      cx = LEFT;
      y += 26;
    }
    items.push({ type: 'rect', x: cx, y, w, h: 20, r: 10, fill: null, stroke: colors.line });
    items.push({ type: 'text', x: cx + 10, y: y + 13.5, text: label, font: 'chipLabel', color: colors.accentText });
    items.push({ type: 'text', x: cx + 16 + lw, y: y + 13.5, text: value, font: 'chip', color: colors.ink });
    cx += w + 6;
  }
  if (chips.length) y += 26;
  return y + 8;
}

export function layoutWorksheet({ title = '', details = '', dueText = null, appendix = null } = {}, measure, measureMath = null, { colors = DEFAULT_COLORS } = {}) {
  const ctx = { measure, measureMath, colors };
  const doc = parseHomework(details);
  const pages = [];
  let page = null;
  let y = TOP;
  const newPage = () => {
    page = { items: [], text: [] };
    pages.push(page);
    y = TOP;
  };
  newPage();
  y = headerItems(page.items, { title, doc, dueText }, ctx);
  page.text.push(BRAND, title, 'Name', 'Date', 'Period');
  if (doc.objective) page.text.push(`Objective: ${plainOf(doc.objective)}`);
  if (doc.time) page.text.push(`Time: ${doc.time}`);
  if (doc.materials) page.text.push(`Materials: ${doc.materials}`);
  if (dueText) page.text.push(dueText);

  // The blocks, in reading order
  const problemCount = doc.sections.reduce((n, sec) => n + sec.problems.length, 0);
  const legacy = !doc.structured;
  const blocks = [];
  for (const sec of doc.sections) {
    if (sec.heading) blocks.push(headingBlock(sec.heading, sec.directions, ctx));
    else if (sec.directions) blocks.push(paragraphBlock(sec.directions, ctx, 'directions'));
    for (const para of sec.text) blocks.push(paragraphBlock(para, ctx));
    if (sec.example) blocks.push(exampleBlock(sec.example, ctx));
    for (const p of sec.problems) {
      blocks.push(problemBlock(p, { ...ctx, kind: legacy ? 'legacy' : null, count: problemCount }));
    }
  }
  const lastProblem = legacy && problemCount === 1 ? blocks[blocks.length - 1] : null;

  const fits = (hgt) => y + hgt <= BOTTOM;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    // A heading keeps its next block with it
    let need = block.height;
    if (block.keepWithNext && blocks[i + 1]) need += Math.min(blocks[i + 1].height, BOTTOM - TOP - block.height);
    if (!fits(need) && y > TOP) newPage();
    if (block === lastProblem) {
      // One problem typed by a tutor: its work area is the rest of the page
      const room = Math.max(SPACE_HEIGHTS.long, BOTTOM - y - (block.height - SPACE_HEIGHTS[spaceFor({ space: null }, { kind: 'legacy', count: 1 })]));
      block.draw(page.items, y, room);
      y = BOTTOM;
    } else if (block.height > BOTTOM - TOP && block.splittable) {
      // A paragraph longer than a page flows on, line by line
      for (const line of block.splittable.lines) {
        if (!fits(line.height)) newPage();
        emitRich(page.items, { lines: [line] }, LEFT, y, CW, 'body', ctx.colors.ink);
        y += line.height;
      }
      y += 8;
    } else {
      block.draw(page.items, y);
      y += block.height;
    }
    page.text.push(...block.text);
  }

  // Nothing numbered: one large work area
  if (!problemCount) {
    if (BOTTOM - y < 216) newPage();
    page.items.push({ type: 'rect', x: LEFT, y: y + 6, w: CW, h: BOTTOM - y - 6, r: 6, fill: null, stroke: ctx.colors.line });
  }

  // The appendix (staff only): its own pages at the end
  if (appendix && String(appendix.text ?? '').trim()) {
    newPage();
    const head = headingBlock(appendix.heading || '', null, ctx);
    head.draw(page.items, y);
    y += head.height;
    page.text.push(appendix.heading || '');
    const groups = parseKey(appendix.text);
    if (!groups) {
      for (const para of String(appendix.text).split(/\n{2,}/)) {
        const block = paragraphBlock(para, ctx);
        for (const line of block.splittable.lines) {
          if (!fits(line.height)) newPage();
          emitRich(page.items, { lines: [line] }, LEFT, y, CW, 'body', ctx.colors.ink);
          y += line.height;
        }
        y += 8;
        page.text.push(...block.text);
      }
    } else {
      for (const g of groups) {
        if (g.heading) {
          const rich = layoutRich(g.heading, CW, measure, measureMath, 'keyHeading');
          if (!fits(rich.height + 30)) newPage();
          y = emitRich(page.items, rich, LEFT, y + 4, CW, 'keyHeading', ctx.colors.accentText) + 4;
          page.text.push(plainOf(g.heading));
        }
        for (const e of g.entries) {
          const answer = layoutRich(e.answer, CW - 44, measure, measureMath, 'body');
          const steps = e.steps.map((s, k) => layoutRich(`${k + 1}. ${s}`, CW - 56, measure, measureMath, 'hint'));
          const hgt = answer.height + steps.reduce((t, s) => t + s.height, 0) + 8;
          if (!fits(hgt)) newPage();
          const first = answer.lines[0];
          const base = y + (first ? (first.height - (first.ascent + first.descent)) / 2 + first.ascent : size('body'));
          page.items.push({ type: 'rect', x: LEFT, y: base - 11, w: 32, h: 15, r: 4, fill: ctx.colors.accent, stroke: null });
          page.items.push({ type: 'text', x: LEFT + 16 - measure(e.ref, 'badge') / 2, y: base, text: e.ref, font: 'badge', color: ctx.colors.onAccent });
          let yy = emitRich(page.items, answer, LEFT + 44, y, CW - 44, 'body', ctx.colors.ink);
          for (const s of steps) yy = emitRich(page.items, s, LEFT + 56, yy, CW - 56, 'hint', ctx.colors.muted);
          y = yy + 8;
          page.text.push(`${e.ref}. ${plainOf(e.answer)}`, ...e.steps.map((s, k) => `${k + 1}. ${plainOf(s)}`));
        }
      }
    }
  }

  // Footers, now that the page count is known: the title, and Page N of M
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.items.push({ type: 'rule', x1: LEFT, y1: FOOTER_TOP, x2: LEFT + CW, y2: FOOTER_TOP, color: ctx.colors.faint, width: 0.6 });
    let name = plainOf(title || 'Assignment');
    if (measure(name, 'footer') > CW * 0.6) {
      const words = name.split(' ');
      while (words.length > 1 && measure(`${words.join(' ')}…`, 'footer') > CW * 0.6) words.pop();
      name = `${words.join(' ')}…`;
    }
    p.items.push({ type: 'text', x: LEFT, y: FOOTER_TOP + 13, text: name, font: 'footer', color: ctx.colors.muted });
    p.items.push({ type: 'text', x: LEFT + CW - measure(label, 'footer'), y: FOOTER_TOP + 13, text: label, font: 'footer', color: ctx.colors.muted });
    p.text.push(label);
  });

  return { pages: pages.map((p) => ({ items: p.items, text: p.text.filter(Boolean).join('\n') })), problemCount };
}

// ---------------------------------------------------------------------------
// Small helpers for the page around it

// "factoring-trinomials-set-1-worksheet.pdf"
export function worksheetFileName(title) {
  const slug = String(title ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return `${slug || 'assignment'}-worksheet.pdf`;
}

// Whether the details make a worksheet: anything written at all
export function hasWorksheet(task) {
  return Boolean(task) && task.kind !== 'task' && String(task.details ?? '').trim().length > 0;
}

// iPhone, iPad (which says it is a Mac), or iPod: where Open also offers Markup
export function isAppleTouch({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}
