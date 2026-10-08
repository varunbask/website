// The worksheet in the browser: lays it out (worksheet-model.js), draws each
// page on a canvas, and makes the PDF (pdf-writer.js). Loaded with import()
// when someone opens, prints, downloads or marks up a worksheet.
//
// Pages are drawn on a canvas, not written with a PDF font, so whatever the
// text holds (x², √, −, accents) shows as the portal's font draws it. The
// portal's UI font (Geist) is loaded first; a character it lacks falls back to
// the next font in the stack, as text on the page does. LaTeX between dollar
// signs is typeset with MathJax (math.js, loaded only when there is math):
// each formula's SVG is drawn on the canvas through an image from a blob,
// sized to the text and sitting on its baseline. The colors are the portal's
// own (its CSS tokens, as in the light theme).
//
// buildLayout({ title, details, dueAt, appendix }) -> layout (after fonts and math load)
// renderPage(layout, index, { dpi, canvas }) -> canvas (white page, 200 dpi)
// worksheetPdf(layout, { inkFor }) -> Uint8Array; inkFor(index, ctx, scale)
//   draws marks on a page before it is encoded (markup.js)
// openPdf(bytes, win), printPdf(bytes, host), downloadPdf(bytes, name, host)

import { h } from './dom.js';
import { dayKey, longDate } from './dates.js';
import { PAGE, DPI, FONTS, DEFAULT_COLORS, layoutWorksheet } from './worksheet-model.js';
import { writePdf, JPEG_QUALITY, MAX_PAGE_BYTES } from './pdf-writer.js';
import { mathIn } from './homework-doc.js';
import { loadMathJax, texToSvg, svgMetrics, svgImage } from './math.js';

export const FONT_STACK = 'Geist, "Helvetica Neue", Helvetica, Arial, "Segoe UI Symbol", "Apple Symbols", "Noto Sans Math", sans-serif';
const REVOKE_AFTER_MS = 5 * 60_000;

const cssFont = (key, scale = 1) => `${FONTS[key].weight} ${FONTS[key].size * scale}px ${FONT_STACK}`;

// The portal font in the weights the worksheet uses, before anything is measured
export async function fontsReady() {
  try {
    await Promise.all(['problem', 'field', 'title'].map((key) => document.fonts.load(cssFont(key))));
    await document.fonts.ready;
  } catch {
    /* the fallback fonts measure and draw just as well */
  }
}

// measure(text, fontKey) in points, with canvas measureText
export function canvasMeasure() {
  const ctx = document.createElement('canvas').getContext('2d');
  return (text, key) => {
    ctx.font = cssFont(key);
    return ctx.measureText(text).width;
  };
}

// "Due Friday, October 16", or null
export function dueText(dueAt) {
  return dueAt ? `Due ${longDate(dayKey(dueAt))}` : null;
}

// The portal's colors for paper: its accent tokens as the light theme sets them
export function paperColors() {
  const root = document.documentElement;
  const dark = root.dataset.theme === 'dark';
  if (dark) root.dataset.theme = 'light';
  try {
    const css = getComputedStyle(root);
    const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return {
      ...DEFAULT_COLORS,
      accent: token('--accent', DEFAULT_COLORS.accent),
      accentSoft: token('--accent-soft', DEFAULT_COLORS.accentSoft),
      accentText: token('--accent-text', DEFAULT_COLORS.accentText),
    };
  } finally {
    if (dark) root.dataset.theme = 'dark';
  }
}

const mathKey = (tex, display) => `${display ? 'D' : 'I'}:${tex}`;

// Every formula in the worksheet, typeset: Map(key -> { width, ascent, descent (em), image })
async function prepareMath(texts, color) {
  const wanted = new Map();
  for (const text of texts) for (const m of mathIn(text)) wanted.set(mathKey(m.tex, m.display), m);
  const out = new Map();
  if (!wanted.size) return out;
  let MathJax;
  try {
    MathJax = await loadMathJax();
  } catch (error) {
    console.error(error);
    return out;   // the TeX is drawn as text instead
  }
  await Promise.all([...wanted].map(async ([key, m]) => {
    const svg = texToSvg(MathJax, m.tex, { display: m.display });
    if (!svg) return;
    try {
      out.set(key, { ...svgMetrics(svg), image: await svgImage(svg, { color, px: 96 }) });
    } catch (error) {
      console.error(error);
    }
  }));
  return out;
}

export async function buildLayout({ title, details, dueAt = null, appendix = null }) {
  await fontsReady();
  const colors = paperColors();
  const math = await prepareMath([title, details, appendix?.text ?? ''], colors.ink);
  const measureMath = (tex, display, key) => {
    const m = math.get(mathKey(tex, display));
    if (!m) return null;
    const em = FONTS[key].size;
    return { width: m.width * em, ascent: m.ascent * em, descent: m.descent * em };
  };
  const layout = layoutWorksheet({ title, details, dueText: dueText(dueAt), appendix }, canvasMeasure(), measureMath, { colors });
  layout.math = math;
  layout.mathAsText = false;
  return layout;
}

function roundRect(ctx, x, y, w, hgt, r) {
  const rr = Math.max(0, Math.min(r, w / 2, hgt / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, rr);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, rr);
  ctx.arcTo(x, y + hgt, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Draws page `index` on a canvas the size of the page at `dpi`
export function renderPage(layout, index, { dpi = DPI, canvas = document.createElement('canvas') } = {}) {
  const scale = dpi / 72;
  canvas.width = Math.round(PAGE.width * scale);
  canvas.height = Math.round(PAGE.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'alphabetic';
  for (const item of layout.pages[index].items) {
    if (item.type === 'text') {
      ctx.font = cssFont(item.font, scale);
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, item.x * scale, item.y * scale);
    } else if (item.type === 'math') {
      const m = layout.mathAsText ? null : layout.math?.get(mathKey(item.tex, item.display));
      if (m?.image) {
        ctx.drawImage(m.image, item.x * scale, (item.y - item.ascent) * scale, item.width * scale, (item.ascent + item.descent) * scale);
      } else {
        ctx.font = cssFont(item.font, scale);
        ctx.fillStyle = item.color;
        ctx.fillText(item.display ? `$$${item.tex}$$` : `$${item.tex}$`, item.x * scale, item.y * scale);
      }
    } else if (item.type === 'rule') {
      ctx.strokeStyle = item.color ?? '#9aa0aa';
      ctx.lineWidth = Math.max(1, (item.width ?? 0.75) * scale);
      ctx.beginPath();
      ctx.moveTo(item.x1 * scale, item.y1 * scale);
      ctx.lineTo(item.x2 * scale, item.y2 * scale);
      ctx.stroke();
    } else if (item.type === 'rect') {
      roundRect(ctx, item.x * scale, item.y * scale, item.w * scale, item.h * scale, (item.r ?? 0) * scale);
      if (item.fill) {
        ctx.fillStyle = item.fill;
        ctx.fill();
      }
      if (item.stroke) {
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = Math.max(1, 0.75 * scale);
        ctx.stroke();
      }
    } else if (item.type === 'circle') {
      ctx.beginPath();
      ctx.arc(item.cx * scale, item.cy * scale, item.r * scale, 0, Math.PI * 2);
      if (item.fill) {
        ctx.fillStyle = item.fill;
        ctx.fill();
      }
      if (item.stroke) {
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = Math.max(1, 0.8 * scale);
        ctx.stroke();
      }
    } else if (item.type === 'grid') {
      ctx.fillStyle = item.color;
      const r = Math.max(1, 0.7 * scale);
      for (let gx = item.x + item.step; gx < item.x + item.w - 1; gx += item.step) {
        for (let gy = item.y + item.step; gy < item.y + item.h - 1; gy += item.step) {
          ctx.beginPath();
          ctx.arc(gx * scale, gy * scale, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  return canvas;
}

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The page could not be encoded.'))), 'image/jpeg', quality);
  });
}

// A JPEG of the canvas at quality 0.9, lower when the page would pass MAX_PAGE_BYTES
export async function canvasJpeg(canvas, { quality = JPEG_QUALITY, maxBytes = MAX_PAGE_BYTES } = {}) {
  let q = quality;
  let blob = await toBlob(canvas, q);
  while (blob.size > maxBytes && q > 0.55) {
    q = Math.round((q - 0.1) * 100) / 100;
    blob = await toBlob(canvas, q);
  }
  if (blob.type !== 'image/jpeg') throw new Error('This browser could not make a JPEG.');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height, quality: q };
}

// The PDF: each page drawn at 200 dpi (plus any marks), one at a time so only
// one page-sized canvas is held at once
export async function worksheetPdf(layout, { inkFor = null, dpi = DPI } = {}) {
  const pages = [];
  const canvas = document.createElement('canvas');
  for (let i = 0; i < layout.pages.length; i += 1) {
    renderPage(layout, i, { dpi, canvas });
    if (inkFor) inkFor(i, canvas.getContext('2d'), dpi / 72);
    try {
      pages.push(await canvasJpeg(canvas));
    } catch (error) {
      // A browser that will not read back a canvas with a formula image on it:
      // draw the formulas as their TeX instead, for this page and the rest
      if (error?.name !== 'SecurityError' || layout.mathAsText) throw error;
      console.error(error);
      layout.mathAsText = true;
      renderPage(layout, i, { dpi, canvas });
      if (inkFor) inkFor(i, canvas.getContext('2d'), dpi / 72);
      pages.push(await canvasJpeg(canvas));
    }
  }
  canvas.width = 0;
  canvas.height = 0;
  return writePdf(pages);
}

const pdfUrl = (bytes) => URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
const revokeLater = (url) => setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);

// Shows the PDF in `win` (a tab opened at the click, before the PDF was made,
// so pop-up blockers allow it) or a new one. -> false when no tab could open.
export function openPdf(bytes, win = null) {
  const url = pdfUrl(bytes);
  revokeLater(url);
  if (win && !win.closed) {
    win.location.href = url;
    return true;
  }
  const opened = window.open(url, '_blank');
  return Boolean(opened);
}

// Saves the PDF as `name` (a link inside `host`: an open modal dialog makes the
// rest of the page inert)
export function downloadPdf(bytes, name, host = document.body) {
  const url = pdfUrl(bytes);
  const link = h('a', { href: url, download: name, hidden: true });
  host.append(link);
  link.click();
  link.remove();
  revokeLater(url);
}

// Prints the PDF from a hidden same-origin frame. When the frame cannot print
// it (some browsers will not print a PDF in a frame), the PDF opens instead so
// it can be printed from there; when no tab may open, it downloads.
// -> 'printed' | 'opened' | 'downloaded'
export function printPdf(bytes, { host = document.body, name = 'worksheet.pdf', timeoutMs = 6000 } = {}) {
  const url = pdfUrl(bytes);
  return new Promise((resolve) => {
    const frame = h('iframe', { class: 'ws-print-frame', src: url, title: 'Worksheet for printing', 'aria-hidden': 'true', tabindex: '-1' });
    let done = false;
    const finish = (how) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setTimeout(() => frame.remove(), 60_000);
      revokeLater(url);
      resolve(how);
    };
    const fallback = () => {
      if (done) return;
      if (openPdf(bytes)) finish('opened');
      else {
        downloadPdf(bytes, name, host);
        finish('downloaded');
      }
    };
    const timer = setTimeout(fallback, timeoutMs);
    frame.addEventListener('load', () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        finish('printed');
      } catch {
        fallback();
      }
    }, { once: true });
    host.append(frame);
  });
}
