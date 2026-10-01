import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Re-checks the colour pairs in section 2.3 of the portal UI spec against the
// token blocks in portal/css/app.css, using the WCAG 2 contrast formula.

const CSS = readFileSync(fileURLToPath(new URL('../../portal/css/app.css', import.meta.url)), 'utf8');

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
const THEMES = { light, dark };

// Resolves var() chains to a #RRGGBB value
function hex(tokens, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`Token cycle at ${name}`);
  seen.add(name);
  const value = tokens[name];
  if (value === undefined) throw new Error(`Missing token ${name}`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (ref) return hex(tokens, ref[1], seen);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is not an opaque hex colour: ${value}`);
  return value;
}

function luminance(color) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, minimum ratio]
const PAIRS = [
  ...['--frame', '--surface-2', '--raised', '--weekend'].map((bg) => ['--text-3', bg, 4.5]),
  ...['--canvas', '--surface', '--surface-2'].map((bg) => ['--control', bg, 3]),
  ...['--frame', '--canvas', '--surface-2'].map((bg) => ['--accent', bg, 4.5]),
  ['--on-accent', '--accent', 4.5],
  ['--on-accent', '--accent-hover', 4.5],
  ['--accent-text', '--accent-soft', 4.5],
  ['--text-3', '--accent-soft', 4.5],
  ...['neutral', 'info', 'warning', 'danger', 'success'].map((t) => [`--${t}-text`, `--${t}-bg`, 4.5]),
  ...['neutral', 'info', 'warning', 'danger', 'success'].map((t) => [`--${t}-solid`, '--surface', 3]),
  ['--warning-text', '--surface', 4.5],
  ['--danger-text', '--surface', 4.5],
  ['--on-inverse', '--inverse', 4.5],
  ['--inverse-action', '--inverse', 4.5],
  ['--on-danger', '--danger-fill', 4.5],
  ['--on-danger', '--danger-fill-hover', 4.5],
];

test('the WCAG formula matches known values', () => {
  expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
});

test('both token blocks define the same colour tokens', () => {
  const darkOnly = declarations(block(':root[data-theme="dark"]'));
  const colourTokens = (tokens) => Object.keys(tokens).filter((k) => /^#[0-9a-f]{6,8}$/i.test(tokens[k])).sort();
  expect(colourTokens(darkOnly)).toEqual(colourTokens(light));
});

for (const [theme, tokens] of Object.entries(THEMES)) {
  test(`every section 2.3 pair meets its threshold in the ${theme} theme`, () => {
    for (const [fg, bg, need] of PAIRS) {
      const ratio = contrast(hex(tokens, fg), hex(tokens, bg));
      expect(ratio, `${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}, needs ${need}`).toBeGreaterThanOrEqual(need);
    }
  });

  test(`body text reads on every surface in the ${theme} theme`, () => {
    for (const fg of ['--text', '--text-2', '--text-3']) {
      for (const bg of ['--frame', '--canvas', '--surface', '--surface-2', '--raised']) {
        const ratio = contrast(hex(tokens, fg), hex(tokens, bg));
        expect(ratio, `${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
}
