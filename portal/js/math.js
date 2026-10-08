// Typeset math (LaTeX between dollar signs, homework-doc.js splitMath) with
// MathJax 3, vendored at /portal/vendor/mathjax/tex-svg-full.js (about 2.2 MB,
// Apache 2.0). It loads with a same-origin script tag the first time a page
// shows math, and never otherwise.
//
// MathJax only converts here: nothing on the page is typeset by it
// (startup.typeset false) and there is no shared font cache (svg.fontCache
// 'none'). Its document is a detached one whose head is an element never
// attached anywhere (mathJaxDocument), so the stylesheets its context menu
// adds are never applied, and the portal's policy (no inline styles) never
// has to refuse them. It needs no CSP exception. Each formula becomes a plain
// <svg role="img"> whose aria-label is its TeX, moved into the page.
//
// loadMathJax() -> Promise<MathJax>
// texToSvg(MathJax, tex, { display }) -> SVGElement (null when TeX cannot be read)
// svgMetrics(svg) -> { width, ascent, descent } in em
// svgImage(svg, { color }) -> Promise<HTMLImageElement> (for drawing on a canvas)
// typesetIn(root) -> replaces every span.hw-math[data-tex] under root

export const MATHJAX_SRC = '/portal/vendor/mathjax/tex-svg-full.js';

let loading = null;

// The document MathJax works in: detached, with a head that is never part of
// any page, so a <style> put there is never applied or checked
export function mathJaxDocument() {
  const doc = document.implementation.createHTMLDocument('MathJax');
  const head = doc.createElement('div');
  Object.defineProperty(doc, 'head', { configurable: true, get: () => head });
  return doc;
}

export function loadMathJax() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.MathJax?.tex2svg) return Promise.resolve(window.MathJax);
  loading ??= new Promise((resolve, reject) => {
    window.MathJax = {
      startup: {
        typeset: false,
        ready() {
          // A detached document: MathJax's own styles go there, never into the
          // page. Set here, after MathJax read its configuration (a document
          // in the configuration itself would be merged as if it were one).
          const config = window.MathJax.config?.startup;
          if (config) config.document = mathJaxDocument();
          window.MathJax.startup.defaultReady();
          window.MathJax.startup.promise.then(() => resolve(window.MathJax), reject);
        },
      },
      svg: { fontCache: 'none' },
      options: { enableMenu: false, enableAssistiveMml: false, enableEnrichment: false, enableExplorer: false },
    };
    const script = document.createElement('script');
    script.src = MATHJAX_SRC;
    script.async = true;
    script.dataset.mathjax = 'portal';
    script.addEventListener('error', () => {
      loading = null;
      reject(new Error('MathJax could not load'));
    });
    document.head.append(script);
  });
  return loading;
}

// The svg of one formula, labelled with its TeX for screen readers
export function texToSvg(MathJax, tex, { display = false } = {}) {
  let node;
  try {
    node = MathJax.tex2svg(tex, { display });
  } catch {
    return null;
  }
  const svg = node?.querySelector?.('svg');
  if (!svg || svg.querySelector('[data-mjx-error], merror, [data-mml-node="merror"]')) return null;
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', tex);
  svg.setAttribute('focusable', 'false');
  svg.removeAttribute('aria-hidden');
  // Sizes in em from the viewBox (the text's own size); the baseline is set
  // where it is shown (placeSvg), as a style the page itself applies
  const { width, ascent, descent } = svgMetrics(svg);
  svg.removeAttribute('style');
  svg.setAttribute('width', `${width.toFixed(3)}em`);
  svg.setAttribute('height', `${(ascent + descent).toFixed(3)}em`);
  return svg;
}

// Width, height above the baseline and depth below it, in em: MathJax's
// viewBox is 1000 units to the em with the baseline at y = 0
export function svgMetrics(svg) {
  const box = String(svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || box.some((n) => !Number.isFinite(n))) return { width: 0, ascent: 0, descent: 0 };
  const [, minY, w, hgt] = box;
  return { width: w / 1000, ascent: -minY / 1000, descent: (hgt + minY) / 1000 };
}

// The formula as an image for a canvas: drawn in `color`, at `px` pixels to
// the em. A plain SVG (no foreignObject) from a same-origin blob, so drawing
// it leaves the canvas readable.
export async function svgImage(svg, { color = '#1f2328', px = 100 } = {}) {
  const { width, ascent, descent } = svgMetrics(svg);
  const copy = svg.cloneNode(true);
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', `${Math.max(1, width * px)}`);
  copy.setAttribute('height', `${Math.max(1, (ascent + descent) * px)}`);
  copy.removeAttribute('style');
  copy.removeAttribute('role');
  copy.removeAttribute('aria-label');
  const markup = new XMLSerializer().serializeToString(copy).replace(/currentColor/g, color);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } finally {
    // The decoded image keeps its pixels; the link is not needed after decode
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

// Typesets the formulas a renderer left as span.hw-math[data-tex] (showing
// the TeX until then). A formula MathJax cannot read keeps its TeX.
export async function typesetIn(root) {
  const spots = [...root.querySelectorAll('.hw-math[data-tex]:not(.is-typeset)')];
  if (!spots.length) return 0;
  let MathJax;
  try {
    MathJax = await loadMathJax();
  } catch (error) {
    console.error(error);
    return 0;
  }
  let done = 0;
  for (const spot of spots) {
    const svg = texToSvg(MathJax, spot.dataset.tex, { display: spot.classList.contains('is-display') });
    if (!svg) continue;
    const shown = spot.ownerDocument?.importNode ? spot.ownerDocument.importNode(svg, true) : svg;
    // The formula's baseline on the text's: shift it down by its depth
    if (shown.style) shown.style.verticalAlign = `${(-svgMetrics(svg).descent).toFixed(3)}em`;
    spot.replaceChildren(shown);
    spot.classList.add('is-typeset');
    done += 1;
  }
  return done;
}
