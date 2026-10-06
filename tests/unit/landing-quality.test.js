import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guards for the marketing pages: colour contrast of the tokens in styles.css
// (WCAG 2) and a few markup rules that are easy to undo by accident.

const read = (name) => readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), 'utf8');
const CSS = read('styles.css');

// Body of the first top-level rule whose selector line is exactly `selector {`
function block(selector) {
  const start = CSS.indexOf(`\n${selector} {`);
  if (start === -1) throw new Error(`No token block for ${selector}`);
  const open = CSS.indexOf('{', start);
  const close = CSS.indexOf('}', open);
  return CSS.slice(open + 1, close);
}

function declarations(body) {
  const out = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

const light = declarations(block(':root'));
const dark = { ...light, ...declarations(block(':root[data-theme="dark"]')) };

function luminance(color) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each([['light', light], ['dark', dark]])('%s theme tokens', (_, tokens) => {
  test('control borders reach 3:1 against the page (WCAG 1.4.11)', () => {
    expect(contrast(tokens['--field-border'], tokens['--paper'])).toBeGreaterThanOrEqual(3);
  });

  test('white button text reaches 4.5:1 on the button and on its hover colour', () => {
    expect(contrast(tokens['--btn-fg'], tokens['--btn-bg'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens['--btn-fg'], tokens['--btn-bg-hover'])).toBeGreaterThanOrEqual(4.5);
  });

  test('the red accent text reaches 4.5:1 on the page', () => {
    expect(contrast(tokens['--pen'], tokens['--paper'])).toBeGreaterThanOrEqual(4.5);
  });
});

test('the hairline colour is still decorative, so control borders do not use it', () => {
  expect(contrast(light['--rule'], light['--paper'])).toBeLessThan(3);
  for (const selector of ['.lang-toggle,\n.theme-toggle', '.refer-choice']) {
    const rule = CSS.slice(CSS.indexOf(`\n${selector} {`)).split('}')[0];
    expect(rule, selector).toContain('var(--field-border)');
    expect(rule, selector).not.toContain('var(--rule)');
  }
});

describe('the marketing pages', () => {
  const pages = ['index.html', 'privacy.html', 'review.html'];
  const versionOf = (html, file) => new RegExp(`${file.replace('.', '\\.')}\\?v=(\\d+)`).exec(html)?.[1];

  test('link the same version of each shared file', () => {
    for (const file of ['styles.css', 'theme.js', 'i18n.js', 'translations.js']) {
      const versions = pages.map((p) => versionOf(read(p), file)).filter(Boolean);
      expect(new Set(versions).size, file).toBeLessThanOrEqual(1);
    }
    expect(pages.map((p) => versionOf(read(p), 'styles.css'))).toEqual(Array(pages.length).fill(expect.any(String)));
  });

  test('index.html has no inline event handlers (the CSP carries no unsafe-hashes for them)', () => {
    expect(read('index.html')).not.toMatch(/\son\w+="/);
  });

  test('the review counts start empty and are filled by script.js', () => {
    const html = read('index.html');
    expect(html).toMatch(/id="count-parents"[^>]*><\/span>/);
    expect(html).toMatch(/id="count-students"[^>]*><\/span>/);
  });

  test('every language option says which language it is in', () => {
    for (const page of ['index.html', 'review.html']) {
      const options = [...read(page).matchAll(/<li role="option"([^>]*)>/g)].map((m) => m[1]);
      expect(options).toHaveLength(5);
      for (const attrs of options) expect(attrs).toMatch(/\slang="[a-zA-Z-]+"/);
    }
  });
});
