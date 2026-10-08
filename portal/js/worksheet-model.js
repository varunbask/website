// Pure layout for an assignment's worksheet: the printable page a student can
// fill in on paper or mark up in the portal. No DOM: text widths come from a
// measure(text, fontKey) function (canvas measureText in the browser, a fake
// one in tests), and everything is in PDF points (72 to the inch).
//
// parseDetails(details) -> { intro, problems: [{ number, text }] }
//   The intro is everything before the first numbered line ("1." or "1)");
//   each numbered line starts a problem, and the lines after it (a hint, more
//   text) belong to it until the next number. Numbers must start at 1 and go
//   up by one, so a stray "10." in the middle of a sentence stays text. With
//   no numbered lines, the whole text is the intro.
//
// layoutWorksheet({ title, details, dueText, appendix }, measure) ->
//   { pages: [{ items, text }], problemCount }
//   items  { type: 'text', x, y, text, font, color } (y is the baseline),
//          { type: 'rule', x1, y1, x2, y2 } and { type: 'box', x, y, w, h }
//   text   the page's words in reading order (for screen readers)
//   US Letter, 0.6 in margins. Page 1 starts with the header (company, Name
//   and Date lines, title, due date, instructions). Each problem is its
//   number and text, then a blank work area: about 3 in each for up to 3
//   problems, 2.5 in for up to 6, 2 in for more; one problem gets the rest of
//   the page. A problem and its work area never split across pages. With no
//   numbered problems, the instructions are followed by one large work area.
//   Every page ends with "Page N of M".
//   appendix { heading, text } is added on new pages at the end; only staff
//   code passes one (the answer key), never anything a family opens.

export const PAGE = Object.freeze({ width: 612, height: 792, margin: 43.2 });   // Letter, 0.6 in margins
export const DPI = 200;
export const BRAND = 'VP Education Group';

export const FONTS = Object.freeze({
  brand: Object.freeze({ weight: 600, size: 10 }),
  label: Object.freeze({ weight: 400, size: 11 }),
  title: Object.freeze({ weight: 600, size: 18 }),
  meta: Object.freeze({ weight: 400, size: 11 }),
  body: Object.freeze({ weight: 400, size: 11.5 }),
  number: Object.freeze({ weight: 600, size: 12 }),
  problem: Object.freeze({ weight: 400, size: 12 }),
  heading: Object.freeze({ weight: 600, size: 14 }),
  footer: Object.freeze({ weight: 400, size: 9 }),
});
export const COLORS = Object.freeze({ ink: '#1f2328', muted: '#5b616e', line: '#9aa0aa', box: '#c9cdd4' });

const LEADING = 1.35;
const NUMBER_GAP = 22;            // the problem text starts this far right of its number
const BOX_GAP = 8;                // between a problem's text and its work area
const BLOCK_GAP = 16;             // between problems
const MIN_BOX = 54;               // 0.75 in: the least work area a problem ever gets
const FOOTER_BASELINE = PAGE.height - PAGE.margin * 0.55;
const CONTENT_TOP = PAGE.margin;
const CONTENT_BOTTOM = PAGE.height - PAGE.margin;
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

export const lineHeight = (key) => FONTS[key].size * LEADING;

// ---------------------------------------------------------------------------
// Parsing

const NUMBERED = /^\s*(\d{1,3})[.)]\s+(\S.*)$/;

// Strips the indent the lines share, so "   Hint: ..." under a problem keeps
// its place without carrying the details' spaces into the worksheet
function dedent(lines) {
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut).replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function parseDetails(details) {
  const lines = String(details ?? '').replace(/\r\n?/g, '\n').split('\n');
  const starts = [];
  let expect = 1;
  lines.forEach((line, i) => {
    const m = NUMBERED.exec(line);
    if (m && Number(m[1]) === expect) {
      starts.push(i);
      expect += 1;
    }
  });
  if (!starts.length) return { intro: dedent(lines), problems: [] };
  const intro = dedent(lines.slice(0, starts[0]));
  const problems = starts.map((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const first = NUMBERED.exec(lines[start]);
    const rest = lines.slice(start + 1, end);
    const restText = dedent(rest);
    return { number: k + 1, text: [first[2].trim(), restText].filter(Boolean).join('\n') };
  });
  return { intro, problems };
}

// ---------------------------------------------------------------------------
// Wrapping

// Lines of at most `width`, keeping the text's own line breaks; a word longer
// than the line is broken between characters
export function wrapText(text, width, measure, font) {
  const out = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next, font) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      if (measure(word, font) <= width) {
        line = word;
        continue;
      }
      // One word wider than the line: break it
      let piece = '';
      for (const ch of word) {
        if (piece && measure(piece + ch, font) > width) {
          out.push(piece);
          piece = ch;
        } else {
          piece += ch;
        }
      }
      line = piece;
    }
    out.push(line);
  }
  // No blank lines at the ends
  while (out.length && !out[0]) out.shift();
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

// The work area each problem gets (a single problem: the rest of its page)
export function workHeight(count) {
  if (count <= 3) return 216;     // 3 in
  if (count <= 6) return 180;     // 2.5 in
  return 144;                     // 2 in
}

// ---------------------------------------------------------------------------
// Layout

export function layoutWorksheet({ title = '', details = '', dueText = null, appendix = null } = {}, measure) {
  const { intro, problems } = parseDetails(details);
  const pages = [];
  let page = null;
  let y = CONTENT_TOP;

  const newPage = () => {
    page = { items: [], text: [] };
    pages.push(page);
    y = CONTENT_TOP;
  };
  const text = (value, x, font, color = COLORS.ink) => {
    page.items.push({ type: 'text', x, y, text: value, font, color });
    if (value) page.text.push(value);
  };
  // Writes wrapped lines from the current y, moving to a new page when one
  // does not fit (only the instructions and the appendix ever do this)
  const flow = (lines, x, font, color) => {
    for (const line of lines) {
      if (y + lineHeight(font) > CONTENT_BOTTOM) newPage();
      y += lineHeight(font);
      text(line, x, font, color);
    }
  };

  newPage();

  // Header: company, Name and Date, title, due date, instructions
  y += lineHeight('brand');
  text(BRAND, PAGE.margin, 'brand', COLORS.muted);
  y += lineHeight('label') + 10;
  const nameW = measure('Name', 'label');
  const dateX = PAGE.margin + CONTENT_WIDTH * 0.62;
  const dateW = measure('Date', 'label');
  text('Name', PAGE.margin, 'label');
  page.items.push({ type: 'rule', x1: PAGE.margin + nameW + 6, y1: y + 2, x2: dateX - 18, y2: y + 2 });
  text('Date', dateX, 'label');
  page.items.push({ type: 'rule', x1: dateX + dateW + 6, y1: y + 2, x2: PAGE.width - PAGE.margin, y2: y + 2 });
  y += 14;
  const titleLines = wrapText(title || 'Assignment', CONTENT_WIDTH, measure, 'title');
  flow(titleLines, PAGE.margin, 'title');
  if (dueText) flow([dueText], PAGE.margin, 'meta', COLORS.muted);
  y += 8;
  page.items.push({ type: 'rule', x1: PAGE.margin, y1: y, x2: PAGE.width - PAGE.margin, y2: y });
  y += 6;
  if (intro) {
    flow(wrapText(intro, CONTENT_WIDTH, measure, 'body'), PAGE.margin, 'body');
    y += 10;
  }

  if (!problems.length) {
    // One large work area: the rest of this page, or a whole new page
    if (CONTENT_BOTTOM - y < 216) newPage();
    page.items.push({ type: 'box', x: PAGE.margin, y: y + BOX_GAP, w: CONTENT_WIDTH, h: CONTENT_BOTTOM - y - BOX_GAP });
    y = CONTENT_BOTTOM;
  }

  const single = problems.length === 1;
  const base = workHeight(problems.length);
  const textX = PAGE.margin + NUMBER_GAP;
  const textW = CONTENT_WIDTH - NUMBER_GAP;
  for (const problem of problems) {
    const lines = wrapText(problem.text, textW, measure, 'problem');
    const textH = Math.max(1, lines.length) * lineHeight('problem');
    const fullPage = CONTENT_BOTTOM - CONTENT_TOP;
    let box = single ? Math.max(216, CONTENT_BOTTOM - y - textH - BOX_GAP) : base;
    if (y + textH + BOX_GAP + box > CONTENT_BOTTOM && y > CONTENT_TOP) {
      newPage();
      if (single) box = Math.max(MIN_BOX, CONTENT_BOTTOM - y - textH - BOX_GAP);
    }
    // A problem too tall for a whole page with its full work area keeps a smaller one
    if (textH + BOX_GAP + box > fullPage) box = Math.max(MIN_BOX, fullPage - textH - BOX_GAP);
    if (textH + BOX_GAP + box > fullPage) {
      // Only text longer than a page gets here: it flows on, and the work area follows it
      lines.forEach((line, i) => {
        if (y + lineHeight('problem') > CONTENT_BOTTOM) newPage();
        y += lineHeight('problem');
        if (i === 0) text(`${problem.number}.`, PAGE.margin, 'number');
        text(line, textX, 'problem');
      });
      if (y + BOX_GAP + MIN_BOX > CONTENT_BOTTOM) newPage();
      box = Math.min(base, CONTENT_BOTTOM - y - BOX_GAP);
    } else {
      lines.forEach((line, i) => {
        y += lineHeight('problem');
        if (i === 0) text(`${problem.number}.`, PAGE.margin, 'number');
        text(line, textX, 'problem');
      });
    }
    page.items.push({ type: 'box', x: textX, y: y + BOX_GAP, w: textW, h: box });
    y += BOX_GAP + box + BLOCK_GAP;
  }

  // The appendix (staff only): its own pages at the end
  if (appendix && String(appendix.text ?? '').trim()) {
    newPage();
    flow([appendix.heading || ''], PAGE.margin, 'heading');
    y += 6;
    flow(wrapText(appendix.text, CONTENT_WIDTH, measure, 'body'), PAGE.margin, 'body');
  }

  // Footers, now that the page count is known
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.items.push({ type: 'text', x: (PAGE.width - measure(label, 'footer')) / 2, y: FOOTER_BASELINE, text: label, font: 'footer', color: COLORS.muted });
    p.text.push(label);
  });

  return { pages: pages.map((p) => ({ items: p.items, text: p.text.join('\n') })), problemCount: problems.length };
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
