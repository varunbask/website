import { describe, test, expect } from 'vitest';
import {
  emptyDoc, safeHref, normalizeInlines, normalizeDoc, isEmptyDoc, docToText, wordCount, textToDoc,
  escapeHtml, docToHtml, MAX_BLOCKS,
} from '../../portal/js/rich-doc.js';

const doc = (...blocks) => ({ v: 1, blocks });
const p = (...c) => ({ t: 'p', c });

describe('links', () => {
  test('only web and mail links', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHref('http://example.com')).toBe('http://example.com/');
    expect(safeHref('mailto:tutor@example.com')).toBe('mailto:tutor@example.com');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'JAVASCRIPT:alert(1)', 'ftp://x', 'nope', '', 'https://a b', null]) {
      expect(safeHref(bad), String(bad)).toBeNull();
    }
    expect(safeHref(`https://example.com/${'a'.repeat(2001)}`)).toBeNull();
  });
});

describe('normalizing', () => {
  test('marks are checked, ordered and never sup with sub', () => {
    expect(normalizeInlines([{ x: 'a', m: ['sub', 'b', 'bogus', 'sup', 'i'] }])).toEqual([{ x: 'a', m: ['b', 'i', 'sup'] }]);
  });

  test('neighbours that look alike join; empty runs and trailing breaks go', () => {
    expect(normalizeInlines([{ x: 'x' }, { x: '' }, { x: 'y' }, { x: '2', m: ['sup'] }, { br: true }])).toEqual([
      { x: 'xy' }, { x: '2', m: ['sup'] },
    ]);
  });

  test('unsafe links are dropped but their text stays', () => {
    expect(normalizeInlines([{ x: 'click', a: 'javascript:alert(1)' }])).toEqual([{ x: 'click' }]);
    expect(normalizeInlines([{ x: 'site', a: 'https://example.com' }])).toEqual([{ x: 'site', a: 'https://example.com/' }]);
  });

  test('control characters go, tabs become spaces, newlines inside a run become spaces', () => {
    expect(normalizeInlines([{ x: 'a\u0000b\tc\nd' }])).toEqual([{ x: 'ab c d' }]);
  });

  test('unknown blocks become paragraphs; empty lists and junk go', () => {
    expect(normalizeDoc(doc({ t: 'h1', c: [{ x: 'Title' }] }, { t: 'ul', items: [[{ x: ' ' }]] }, null, 'x')))
      .toEqual(doc(p({ x: 'Title' })));
  });

  test('empty paragraphs space things out, but never twice and never at the ends', () => {
    expect(normalizeDoc(doc(p(), p({ x: 'a' }), p(), p(), p({ x: 'b' }), p())))
      .toEqual(doc(p({ x: 'a' }), p(), p({ x: 'b' })));
  });

  test('anything that is not a document is empty', () => {
    for (const junk of [null, undefined, 'text', 7, [], { blocks: 'x' }]) expect(normalizeDoc(junk)).toEqual(emptyDoc());
    expect(isEmptyDoc(doc(p({ x: '   ' })))).toBe(true);
    expect(isEmptyDoc(doc(p({ x: 'hi' })))).toBe(false);
  });

  test('at most MAX_BLOCKS blocks', () => {
    const many = Array.from({ length: MAX_BLOCKS + 10 }, (_, i) => p({ x: String(i) }));
    expect(normalizeDoc(doc(...many)).blocks).toHaveLength(MAX_BLOCKS);
  });
});

describe('plain text', () => {
  test('headings, quotes, lists and math read naturally', () => {
    const d = doc(
      { t: 'h2', c: [{ x: 'Question 1' }] },
      p({ x: 'x' }, { x: '2', m: ['sup'] }, { x: ' + H' }, { x: '2', m: ['sub'] }, { x: 'O and e' }, { x: 'iπ', m: ['sup'] }),
      { t: 'ol', items: [[{ x: 'First' }], [{ x: 'Second', m: ['b'] }]] },
      { t: 'ul', items: [[{ x: 'dot' }]] },
      { t: 'quote', c: [{ x: 'line one' }, { br: true }, { x: 'line two' }] },
      { t: 'h3', c: [{ x: 'Work' }] },
    );
    expect(docToText(d)).toBe([
      '## Question 1',
      'x^2 + H_2O and e^(iπ)',
      '1. First\n2. Second',
      '- dot',
      '> line one\n> line two',
      '### Work',
    ].join('\n\n'));
  });

  test('word count leaves markers out', () => {
    expect(wordCount(doc({ t: 'h2', c: [{ x: 'Two words' }] }, { t: 'ol', items: [[{ x: 'three more words' }]] }))).toBe(5);
    expect(wordCount(emptyDoc())).toBe(0);
  });

  test('plain text becomes paragraphs and breaks', () => {
    expect(textToDoc('one\ntwo\n\nthree')).toEqual(doc(p({ x: 'one' }, { br: true }, { x: 'two' }), p({ x: 'three' })));
    expect(docToText(textToDoc('a\n\n\n\nb'))).toBe('a\n\nb');
  });
});

describe('HTML for pasting', () => {
  test('everything is escaped', () => {
    expect(escapeHtml('<b>"x" & \'y\'</b>')).toBe('&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
    expect(docToHtml(doc(p({ x: '<img src=x onerror=alert(1)>' })))).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });

  test('only the allowed tags, with marks nested in order', () => {
    expect(docToHtml(doc(
      p({ x: 'bold', m: ['b', 'i'] }, { x: 'link', a: 'https://example.com' }),
      { t: 'ul', items: [[{ x: 'a' }]] },
      p(),
      { t: 'quote', c: [{ x: 'q' }] },
    ))).toBe('<p><strong><em>bold</em></strong><a href="https://example.com/">link</a></p><ul><li>a</li></ul><p><br></p><blockquote>q</blockquote>');
    expect(docToHtml(doc(p({ x: 'a' }), p(), p({ x: 'b' })))).toBe('<p>a</p><p><br></p><p>b</p>');
  });
});
