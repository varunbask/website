import { describe, test, expect } from 'vitest';
import { frontMatter, mdInlines, markdownToDoc, guideFromMarkdown } from '../../tools/sat/lib/markdown.mjs';

describe('study-guide Markdown -> SAT doc', () => {
  test('front matter', () => {
    const { meta, body } = frontMatter('---\nskill: alg-made-up\ndomain: algebra\ntitle: "Made Up"\nposition: 3\n---\nText');
    expect(meta).toEqual({ skill: 'alg-made-up', domain: 'algebra', title: 'Made Up', position: 3 });
    expect(body).toBe('Text');
  });

  test('inline marks, math, code and links', () => {
    expect(mdInlines('A **bold** and *italic* word, $x^2$, `code`, [a link](https://example.com).')).toEqual([
      { x: 'A ' }, { x: 'bold', m: ['b'] }, { x: ' and ' }, { x: 'italic', m: ['i'] }, { x: ' word, ' }, { tex: 'x^2' },
      { x: ', code, a link.' },
    ]);
    expect(mdInlines('Costs \\$5 and snake_case stays')).toEqual([{ x: 'Costs $5 and snake_case stays' }]);
  });

  test('headings, paragraphs, lists, display math, tables and callouts', () => {
    const doc = markdownToDoc([
      '## Big idea',
      'First line',
      'joins the paragraph.',
      '',
      '### Small idea',
      '- one',
      '- two with $y$',
      '',
      '1. first',
      '2. second',
      '',
      '$$a^2+b^2=c^2$$',
      '',
      '| Term | Means |',
      '|---|---|',
      '| *slope* | rise over run |',
      '',
      '> **Tip:** predict first.',
      '> Then check.',
    ].join('\n'));
    expect(doc).toEqual({
      v: 1,
      blocks: [
        { t: 'h3', c: [{ x: 'Big idea' }] },
        { t: 'p', c: [{ x: 'First line joins the paragraph.' }] },
        { t: 'p', c: [{ x: 'Small idea', m: ['b'] }] },
        { t: 'ul', items: [[{ x: 'one' }], [{ x: 'two with ' }, { tex: 'y' }]] },
        { t: 'ol', items: [[{ x: 'first' }], [{ x: 'second' }]] },
        { t: 'math', tex: 'a^2+b^2=c^2' },
        { t: 'table', head: true, rows: [[[{ x: 'Term' }], [{ x: 'Means' }]], [[{ x: 'slope', m: ['i'] }], [{ x: 'rise over run' }]]] },
        { t: 'quote', c: [{ x: 'Tip:', m: ['b'] }, { x: ' predict first. Then check.' }] },
      ],
    });
  });

  test('multi-line display math', () => {
    expect(markdownToDoc('$$\nx = 1\n+ 2\n$$').blocks).toEqual([{ t: 'math', tex: 'x = 1 + 2' }]);
  });

  test('a whole guide', () => {
    const g = guideFromMarkdown('---\nskill: s\ndomain: algebra\ntitle: T\nposition: 1\n---\n## H\nBody.');
    expect(g.meta.skill).toBe('s');
    expect(g.body.blocks).toHaveLength(2);
  });
});
