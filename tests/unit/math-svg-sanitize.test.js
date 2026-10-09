import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sanitizeSvg } from '../../portal/js/math.js';

// A tiny element tree with just what sanitizeSvg uses
class El {
  constructor(tag, attrs = {}, kids = []) {
    this.localName = tag;
    this.attrs = new Map(Object.entries(attrs));
    this.childNodes = [];
    this.parent = null;
    for (const k of kids) this.append(k);
  }
  get attributes() { return [...this.attrs.keys()].map((name) => ({ name })); }
  get children() { return this.childNodes.filter((n) => n instanceof El); }
  append(n) { n.parent = this; this.childNodes.push(n); }
  removeAttribute(name) { this.attrs.delete(name); }
  remove() { this.parent.childNodes = this.parent.childNodes.filter((n) => n !== this); }
  replaceWith(...nodes) {
    const i = this.parent.childNodes.indexOf(this);
    for (const n of nodes) n.parent = this.parent;
    this.parent.childNodes.splice(i, 1, ...nodes);
  }
}
const tags = (el) => [el.localName, ...el.children.flatMap(tags)];
const names = (el) => [...el.attrs.keys(), ...el.children.flatMap(names)];

describe('formula svgs are only pictures', () => {
  test('a link from \\href is unwrapped: its drawing stays, the link goes', () => {
    const path = new El('path', { d: 'M0 0L1 1', 'data-c': '78' });
    const svg = new El('svg', { viewBox: '0 -750 1000 1000' }, [
      new El('g', { 'data-mml-node': 'math' }, [new El('a', { href: 'javascript:alert(1)', 'xlink:href': 'javascript:x' }, [path])]),
    ]);
    sanitizeSvg(svg);
    expect(tags(svg)).toEqual(['svg', 'g', 'path']);
    expect(names(svg)).not.toContain('href');
    expect(names(svg)).not.toContain('xlink:href');
    expect(path.attrs.get('d')).toBe('M0 0L1 1');
  });

  test('styles, classes, ids and event attributes are dropped everywhere', () => {
    const g = new El('g', { style: 'fill:red', class: 'x', id: 'y', onclick: 'x()', 'data-mml-node': 'mi' });
    const svg = new El('svg', { style: 'vertical-align:-1ex', onload: 'x()' }, [g]);
    sanitizeSvg(svg);
    expect(names(svg).sort()).toEqual(['data-mml-node']);
  });

  test('anything that is not drawing is removed', () => {
    const svg = new El('svg', {}, [new El('script'), new El('foreignObject'), new El('image', { href: 'x' }), new El('use', { href: '#p' }), new El('rect', { width: '1' })]);
    sanitizeSvg(svg);
    expect(tags(svg)).toEqual(['svg', 'rect']);
  });

  test('MathJax loads without the html package, and texToSvg sanitizes every formula', () => {
    const src = readFileSync(fileURLToPath(new URL('../../portal/js/math.js', import.meta.url)), 'utf8');
    expect(src).toContain("tex: { packages: { '[-]': ['html'] } }");
    expect(src).toMatch(/merror[\s\S]{0,200}sanitizeSvg\(svg\);/);
  });
});
