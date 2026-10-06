import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

// translations.js is a plain script: it defines UI (English text -> the other languages)
const UI = runInNewContext(`${read('translations.js')}; UI;`);
const OTHERS = ['zh', 'es', 'fr', 'ko'];
const html = read('index.html');

const normalize = (s) => s.replace(/\s+/g, ' ').trim();
const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// The text people read in one part of the page: text nodes and placeholders
function visibleStrings(fragment) {
  const withoutScripts = fragment.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  // the language picker's names are the same in every language
  const withoutPicker = withoutScripts
    .replace(/<(select|div|ul)\b[^>]*data-no-translate[\s\S]*?<\/\1>/g, '')
    .replace(/<div class="refer-trap"[\s\S]*?<\/div>/g, '');
  const placeholders = [...withoutPicker.matchAll(/\splaceholder="([^"]+)"/g)].map((m) => m[1]);
  const text = withoutPicker.replace(/<[^>]+>/g, '\n').split('\n');
  return [...text, ...placeholders].map((t) => normalize(unescape(t))).filter(Boolean);
}

const between = (start, end) => html.slice(html.indexOf(start), html.indexOf(end));

describe('translations', () => {
  test('every entry has all four other languages, and no dashes in any language', () => {
    for (const [key, entry] of Object.entries(UI)) {
      expect(key, key).not.toMatch(/[–—]/);
      for (const lang of OTHERS) {
        expect(typeof entry[lang], `${lang}: ${key}`).toBe('string');
        expect(entry[lang].trim(), `${lang}: ${key}`).not.toBe('');
        expect(entry[lang], `${lang}: ${key}`).not.toMatch(/[–—]/);
      }
    }
  });

  test('the booking section has a translation for every string on it', () => {
    const strings = visibleStrings(between('<section class="refer book"', '<section class="refer" id="refer"'));
    expect(strings.length).toBeGreaterThan(30);
    for (const s of strings) expect(UI, s).toHaveProperty([s]);
  });

  test('the header, including the short button label and the menu Log in, is translated', () => {
    const strings = visibleStrings(between('<header class="site-header">', '<main id="main">'));
    for (const s of strings) if (!['VP', 'Education Group'].includes(s)) expect(UI, s).toHaveProperty([s]);
    expect(html).toContain('class="btn btn-primary header-cta header-cta-full i18n-w" href="#book"');
    expect(html).toContain('class="btn btn-primary header-cta header-cta-short i18n-w" href="#book"');
    expect(html).toContain('class="header-login i18n-w" href="portal/"');
    expect(html).toContain('class="nav-login i18n-w" href="portal/"');
  });

  test('the booking form gives every grade its own translation', () => {
    const select = html.match(/<select id="book-grade"[\s\S]*?<\/select>/)[0];
    const options = [...select.matchAll(/<option value="([^"]*)">([^<]+)<\/option>/g)];
    expect(options.length).toBe(16);
    for (const [, value, label] of options) {
      if (value) expect(value).toBe(label);
      expect(UI[label], label).toBeDefined();
    }
  });
});

describe('the booking links', () => {
  test('every Book button goes to the booking section, and none opens a mail program', () => {
    const buttons = [...html.matchAll(/<a [^>]*class="btn btn-primary[^>]*>[^<]*<\/a>/g)].map((m) => m[0]).filter((a) => /Book|consultation/.test(a));
    expect(buttons.length).toBe(5);   // header (full and short), hero, closing note, sticky bar
    for (const b of buttons) expect(b).toContain('href="#book"');
    expect(html).not.toMatch(/<a [^>]*class="btn[^>]*href="mailto:/);
  });

  test('the email fallback is a mailto with the prompts written in', () => {
    const link = html.match(/<a class="i18n-h" href="(mailto:[^"]+)"><span>Prefer email\?[^<]*<\/span><\/a>/)[1];
    const url = new URL(unescape(link));
    expect(url.pathname).toBe('vbmgroupsllc@gmail.com');
    const body = url.searchParams.get('body');
    for (const prompt of ["Student's grade:", 'Subjects:', 'Goal:', 'Best time to reach you:']) expect(body).toContain(prompt);
  });

  test('the asset versions on the pages that link them agree', () => {
    for (const page of ['index.html', 'review.html', 'privacy.html']) {
      expect(read(page), page).toMatch(/styles\.css\?v=11"/);
    }
    expect(read('api/_lib/referral-review.js')).toContain('/styles.css?v=11');
  });
});
