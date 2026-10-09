import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { satDoc, satDocNodes, satInlineNodes, satDocText } from '../../portal/js/sat-doc.js';

// A small stand-in for the DOM calls h() and sat-doc.js make
class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.classes = new Set();
    const self = this;
    this.classList = {
      add: (...c) => c.forEach((x) => self.classes.add(x)),
      contains: (c) => self.classes.has(c),
      remove: (...c) => c.forEach((x) => self.classes.delete(x)),
    };
  }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(v) { this.children = [String(v)]; }
  get textContent() { return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  append(...nodes) { this.children.push(...nodes); }
  // <tag.class>children</tag>, for compact assertions
  toString() {
    const cls = this.className ? `.${[...this.classes].join('.')}` : '';
    return `<${this.tagName.toLowerCase()}${cls}>${this.children.map(String).join('')}</${this.tagName.toLowerCase()}>`;
  }
  find(pred) {
    for (const c of this.children) {
      if (!(c instanceof FakeElement)) continue;
      if (pred(c)) return c;
      const deeper = c.find(pred);
      if (deeper) return deeper;
    }
    return null;
  }
}

beforeEach(() => {
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  globalThis.Node = FakeElement;
});
afterEach(() => {
  delete globalThis.document;
  delete globalThis.Node;
});

const str = (nodes) => nodes.map(String).join('');
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('inline runs', () => {
  test('text with marks, in a fixed order; breaks, blanks and math', () => {
    const out = satInlineNodes([
      { x: 'The ' }, { x: 'underlined', m: ['u'] }, { x: ' and ', m: [] }, { x: 'both', m: ['i', 'b'] }, { br: true },
      { x: '2', m: ['sup'] }, { blank: true }, { tex: 'x^2' },
    ]);
    expect(str(out)).toBe('The <u>underlined</u> and <strong><em>both</em></strong><br></br><sup>2</sup>'
      + '<span.sat-blank><span.visually-hidden>blank</span></span><span.hw-math>x^2</span>');
    expect(out.at(-1).dataset.tex).toBe('x^2');
  });

  test('unknown runs and empty text are dropped, never shown as markup', () => {
    expect(str(satInlineNodes([{ x: '' }, null, 'raw', { y: 1 }, { x: '<b>hi</b>' }]))).toBe('<b>hi</b>');
    // the markup above is one text string, not an element
    expect(satInlineNodes([{ x: '<b>hi</b>' }])[0]).toBe('<b>hi</b>');
    expect(satInlineNodes('nope')).toEqual([]);
  });
});

describe('blocks', () => {
  test('paragraphs, headings, quotes and lists', () => {
    const nodes = satDocNodes({
      v: 1,
      blocks: [
        { t: 'h3', c: [{ x: 'Method' }] },
        { t: 'p', c: [{ x: 'Solve it.' }] },
        { t: 'quote', c: [{ x: 'A clue.' }] },
        { t: 'ol', items: [[{ x: 'One' }], [{ x: 'Two' }]] },
        { t: 'ul', items: [[{ x: 'Dot' }]] },
        { t: 'p', c: [] },
        { t: 'mystery', c: [{ x: 'Kept as a paragraph' }] },
      ],
    });
    expect(str(nodes)).toBe('<h3.sat-h>Method</h3><p>Solve it.</p><blockquote.sat-quote>A clue.</blockquote>'
      + '<ol.sat-list><li>One</li><li>Two</li></ol><ul.sat-list><li>Dot</li></ul><p>Kept as a paragraph</p>');
  });

  test('a table with a header row', () => {
    const [wrap] = satDocNodes({ v: 1, blocks: [{ t: 'table', head: true, rows: [[[{ x: 'h' }], [{ x: 'C' }]], [[{ x: '1' }], [{ x: '18' }]]] }] });
    expect(String(wrap)).toBe('<div.sat-table-wrap><table.sat-table><thead><tr><th>h</th><th>C</th></tr></thead>'
      + '<tbody><tr><td>1</td><td>18</td></tr></tbody></table></div>');
    expect(wrap.find((e) => e.tagName === 'TH').attrs.scope).toBe('col');
    expect(satDocNodes({ v: 1, blocks: [{ t: 'table', rows: [] }] })).toEqual([]);
  });

  test('a passage with its label, and display math', () => {
    const nodes = satDocNodes({ v: 1, blocks: [
      { t: 'passage', label: 'Text 1', blocks: [{ t: 'p', c: [{ x: 'First.' }] }] },
      { t: 'passage', label: null, blocks: [{ t: 'p', c: [{ x: 'Second.' }] }] },
      { t: 'math', tex: 'x = \\frac{7}{2}' },
    ] });
    expect(str(nodes)).toBe('<section.sat-passage><p.sat-passage-label>Text 1</p><p>First.</p></section>'
      + '<section.sat-passage><p>Second.</p></section>'
      + '<div.sat-math><span.hw-math.is-display>x = \\frac{7}{2}</span></div>');
    expect(nodes[0].attrs['aria-label']).toBe('Text 1');
    expect(nodes[1].attrs['aria-label']).toBe('Passage');
  });

  test('a figure is sized before it loads (w and h in CSS pixels), from a signed link', async () => {
    const asked = [];
    const [fig] = satDocNodes({ v: 1, blocks: [{ t: 'img', src: 'figures/geo-01.png', w: 390, h: 227, alt: 'A rectangle' }] }, {
      figure: async (src) => { asked.push(src); return `blob:${src}`; },
    });
    const img = fig.children[0];
    expect(img.attrs).toMatchObject({ alt: 'A rectangle', width: '390', height: '227' });
    expect(img.attrs.src).toBeUndefined();
    await tick();
    await tick();
    expect(asked).toEqual(['figures/geo-01.png']);
    expect(img.attrs.src).toBe('blob:figures/geo-01.png');
  });

  test('a figure that cannot load says what it shows', async () => {
    const [fig] = satDocNodes({ v: 1, blocks: [{ t: 'img', src: 'figures/x.png', w: 10, h: 10, alt: 'A triangle' }] }, {
      figure: async () => { throw new Error('denied'); },
    });
    await tick();
    await tick();
    expect(fig.classList.contains('is-missing')).toBe(true);
    expect(fig.textContent).toBe('Figure could not load: A triangle');
    const [none] = satDocNodes({ v: 1, blocks: [{ t: 'img', src: 'figures/y.png', alt: '' }] });
    expect(none.classList.contains('is-missing')).toBe(true);
  });

  test('passages nest only so deep', () => {
    let block = { t: 'p', c: [{ x: 'deep' }] };
    for (let i = 0; i < 8; i += 1) block = { t: 'passage', label: null, blocks: [block] };
    expect(String(satDocNodes({ v: 1, blocks: [block] })[0]).includes('deep')).toBe(false);
  });

  test('the wrapper, plain text and loose input', () => {
    const el = satDoc({ v: 1, blocks: [{ t: 'p', c: [{ x: 'Hi' }] }] }, { className: 'read' });
    expect(String(el)).toBe('<div.sat-doc.read><p>Hi</p></div>');
    expect(str(satDocNodes('Plain text'))).toBe('<p>Plain text</p>');
    expect(satDocNodes(null)).toEqual([]);
    expect(satDocNodes({ blocks: 'nope' })).toEqual([]);
    expect(satDocText({ v: 1, blocks: [
      { t: 'passage', label: 'Text 1', blocks: [{ t: 'p', c: [{ x: 'It ' }, { blank: true }, { x: ' ran.' }] }] },
      { t: 'p', c: [{ x: 'If ' }, { tex: '3x = 6' }, { x: '?' }] },
      { t: 'table', rows: [[[{ x: 'a' }], [{ x: 'b' }]]] },
      { t: 'img', alt: 'A graph' },
    ] })).toBe('Text 1\nIt ____ ran.\n\nIf 3x = 6?\n\na | b\n\n[A graph]');
  });
});
