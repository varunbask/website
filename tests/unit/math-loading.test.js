import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

// math.js loads MathJax with a same-origin script tag, and only when a page
// has math to show. These tests stand in for the browser with small stubs.
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

let appended;
function fakeSpot(tex, display = false) {
  return {
    dataset: { tex },
    classList: { added: [], contains: (c) => c === 'is-display' && display, add(c) { this.added.push(c); } },
    children: null,
    replaceChildren(...nodes) { this.children = nodes; },
  };
}
const fakeRoot = (spots) => ({ querySelectorAll: () => spots });

beforeEach(() => {
  appended = [];
  globalThis.window = {};
  globalThis.document = {
    head: { append: (el) => appended.push(el) },
    createElement: (tag) => ({ tag, dataset: {}, listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } }),
  };
});
afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

describe('MathJax loads only when there is math', () => {
  test('no formulas: nothing is fetched', async () => {
    const { typesetIn } = await import('../../portal/js/math.js?none');
    expect(await typesetIn(fakeRoot([]))).toBe(0);
    expect(appended).toEqual([]);
    expect(globalThis.window.MathJax).toBeUndefined();
  });

  test('formulas: one same-origin script, configured not to typeset the page or add a font cache', async () => {
    const { typesetIn, MATHJAX_SRC } = await import('../../portal/js/math.js?some');
    const spots = [fakeSpot('x^2 + 1'), fakeSpot('\\frac{a}{b}', true), fakeSpot('\\frac{x}{5} = 3')];
    const done = typesetIn(fakeRoot(spots));
    await Promise.resolve();
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ tag: 'script', src: MATHJAX_SRC, async: true });
    expect(MATHJAX_SRC).toBe('/portal/vendor/mathjax/tex-svg-full.js');
    const config = globalThis.window.MathJax;
    expect(config.startup.typeset).toBe(false);
    expect(config.svg).toEqual({ fontCache: 'none' });
    expect(config.options).toMatchObject({ enableMenu: false, enableAssistiveMml: false });

    // The script arrives: MathJax replaces the config and calls ready()
    const made = [];
    const svg = (tex) => {
      const attrs = {};
      return {
        tex, attrs, setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; }, querySelector: () => null,
        getAttribute: (k) => (k === 'viewBox' ? '0 -750 2000 1000' : attrs[k] ?? null),
      };
    };
    Object.assign(config, {
      tex2svg: (tex, { display }) => { made.push([tex, display]); const s = svg(tex); return { querySelector: () => s }; },
    });
    config.startup.defaultReady = () => {};
    config.startup.promise = Promise.resolve();
    config.startup.ready();
    expect(await done).toBe(3);
    // an inline fraction is set in display style; display math as it is
    expect(made).toEqual([['x^2 + 1', false], ['\\frac{a}{b}', true], ['\\displaystyle \\frac{x}{5} = 3', false]]);
    // the label keeps the TeX as written
    expect(spots[2].children[0].attrs['aria-label']).toBe('\\frac{x}{5} = 3');
    // each formula is an image labelled with its TeX
    expect(spots[0].children[0].attrs).toMatchObject({ role: 'img', 'aria-label': 'x^2 + 1', focusable: 'false', width: '2.000em', height: '1.000em' });
    expect(spots[1].classList.added).toContain('is-typeset');

    // a second page of math loads nothing more
    expect(await typesetIn(fakeRoot([fakeSpot('y')]))).toBe(1);
    expect(appended).toHaveLength(1);
  });

  test('the renderers ask for it only when the text has math', () => {
    expect(read('portal/js/homework-view.js')).toContain('if (hasMath(details)) typesetIn(root)');
    expect(read('portal/js/homework-view.js')).toContain('if (hasMath(details)) typesetIn(plain)');
    expect(read('portal/js/answer-key.js')).toContain('if (hasMath(body)) typesetIn(node)');
    const ws = read('portal/js/worksheet.js');
    expect(ws).toMatch(/async function prepareMath\(texts, color\) \{[\s\S]*?if \(!wanted\.size\) return out;\n\s*let MathJax;/);
  });

  test('no page loads MathJax up front, and it is never loaded from another origin', () => {
    for (const page of ['staff.html', 'student.html', 'parent.html', 'account.html', 'people.html']) {
      expect(read(`portal/${page}`), page).not.toMatch(/mathjax/i);
    }
    // the only URL in it is the SVG namespace
    expect(read('portal/js/math.js').match(/https?:\/\/[^'"`\s]+/g)).toEqual(['http://www.w3.org/2000/svg']);
  });
});

describe('formula sizes from MathJax', () => {
  test('the viewBox is 1000 units to the em, with the baseline at 0', async () => {
    const { svgMetrics } = await import('../../portal/js/math.js?metrics');
    const svg = { getAttribute: () => '0 -833.9 2290.4 1050.9' };
    const m = svgMetrics(svg);
    expect(m.width).toBeCloseTo(2.2904);
    expect(m.ascent).toBeCloseTo(0.8339);
    expect(m.descent).toBeCloseTo(0.217);
    expect(svgMetrics({ getAttribute: () => null })).toEqual({ width: 0, ascent: 0, descent: 0 });
  });
});
