import { test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TUTOR_COLORS } from '../../portal/js/tutor-colors-model.js';

// Every color name has soft fill, text and solid tokens in both themes and a
// .tc-NAME class that hands them to the lesson, and the words read on the fill.

const PORTAL = fileURLToPath(new URL('../../portal', import.meta.url));
const CSS = readFileSync(join(PORTAL, 'css/app.css'), 'utf8');

function block(selector) {
  const start = CSS.indexOf(`\n${selector} {`);
  if (start === -1) throw new Error(`No token block for ${selector}`);
  const open = CSS.indexOf('{', start);
  return CSS.slice(open + 1, CSS.indexOf('}', open));
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
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test.each(TUTOR_COLORS)('%s has its three tokens in both themes', (name) => {
  for (const [theme, tokens] of Object.entries({ light, dark })) {
    for (const part of ['bg', 'text', 'solid']) {
      expect(tokens[`--tc-${name}-${part}`], `${theme} --tc-${name}-${part}`).toMatch(/^#[0-9A-F]{6}$/i);
    }
  }
});

test.each(TUTOR_COLORS)('%s has a class that hands the tokens to the lesson', (name) => {
  expect(CSS).toContain(`.tc-${name} { --subj-bg: var(--tc-${name}-bg); --subj-text: var(--tc-${name}-text); --subj-solid: var(--tc-${name}-solid); }`);
});

test('there is a neutral class for a lesson with no tutor', () => {
  expect(CSS).toContain('.tc-none { --subj-bg: var(--neutral-bg); --subj-text: var(--neutral-text); --subj-solid: var(--neutral-solid); }');
});

for (const [theme, tokens] of Object.entries({ light, dark })) {
  test(`the words read on every tone in the ${theme} theme`, () => {
    for (const name of TUTOR_COLORS) {
      const ratio = contrast(tokens[`--tc-${name}-text`], tokens[`--tc-${name}-bg`]);
      expect(ratio, `${theme} ${name} text on its fill is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test('the solid edge stands out from the page in the dark theme', () => {
  for (const name of TUTOR_COLORS) {
    const ratio = contrast(dark[`--tc-${name}-solid`], dark['--surface']);
    expect(ratio, `dark ${name} edge on the surface is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
  }
});

test("the old scheduler's colors are the solid shades", () => {
  const owner = {
    red: '#EF4444', violet: '#8B5CF6', blue: '#3B82F6', lime: '#84CC16', indigo: '#6366F1', pink: '#EC4899', teal: '#14B8A6',
  };
  for (const [name, hex] of Object.entries(owner)) expect(light[`--tc-${name}-solid`].toUpperCase()).toBe(hex);
});

test('nothing in the portal still colors by subject', () => {
  const files = (dir) => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
  for (const file of files(PORTAL).filter((f) => /\.(js|css|html)$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    expect(text, file).not.toMatch(/subj-[0-5]\b|subj-none|subjectTone|subjectLegend|rememberSubjects|buildPalette/);
  }
});
