import { describe, test, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

// i18n.js is a classic browser script, so it is run here the way the browser
// runs it: translations.js and i18n.js in one shared global scope, with just
// enough of a page around them for the start-up code to finish.

const read = (name) => readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), 'utf8');
const TRANSLATIONS = read('translations.js');
const I18N = read('i18n.js');

function load({ search = '', saved = null, languages = ['en-US'], throwOnStorage = false } = {}) {
  const noop = () => {};
  const element = () => ({
    hidden: true,
    textContent: '',
    querySelector: element,
    querySelectorAll: () => [],
    setAttribute: noop,
    addEventListener: noop,
    contains: () => false,
    focus: noop,
  });
  const setItem = vi.fn();
  const replaceState = vi.fn();
  const documentStub = {
    body: {},
    title: 'Title',
    documentElement: { dataset: {}, lang: 'en' },
    getElementById: element,
    createTreeWalker: () => ({ nextNode: () => null }),
    querySelectorAll: () => [],
    addEventListener: noop,
    dispatchEvent: noop,
  };
  const context = createContext({
    document: documentStub,
    NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
    CustomEvent,
    URL,
    URLSearchParams,
    navigator: { languages },
    location: { search, href: `https://www.varunbaskaran.com/${search}` },
    history: { state: null, replaceState },
    localStorage: {
      getItem: () => { if (throwOnStorage) throw new Error('blocked'); return saved; },
      setItem,
    },
  });
  context.window = context;
  runInContext(TRANSLATIONS, context);
  runInContext(I18N, context);
  return { i18n: context.window.VB_I18N, doc: documentStub, setItem, replaceState };
}

describe('?lang= in the address', () => {
  const { i18n } = load();

  test.each([
    ['?lang=zh', 'zh'], ['?lang=es', 'es'], ['?lang=fr', 'fr'], ['?lang=ko', 'ko'], ['?lang=en', 'en'],
    ['?lang=ZH', 'zh'], ['?lang=zh-CN', 'zh'], ['?lang=zh_Hans', 'zh'], ['?lang=%20fr%20', 'fr'],
    ['?a=1&lang=ko&b=2', 'ko'],
  ])('%s picks %s', (search, expected) => {
    expect(i18n.langFromQuery(search)).toBe(expected);
  });

  test.each([
    '', '?', '?lang=', '?lang=de', '?lang=english', '?lang=zzz', '?lang=constructor', '?lang=__', '?language=zh', '?lang=1',
  ])('%j is not a language we have', (search) => {
    expect(i18n.langFromQuery(search)).toBeNull();
  });
});

describe('the starting language', () => {
  const { i18n } = load();

  test('a link beats the saved choice and the browser', () => {
    expect(i18n.pickLang({ search: '?lang=zh', saved: 'fr', languages: ['ko'] })).toEqual({ lang: 'zh', fromLink: true });
  });

  test('the saved choice beats the browser', () => {
    expect(i18n.pickLang({ search: '', saved: 'fr', languages: ['ko'] })).toEqual({ lang: 'fr', fromLink: false });
  });

  test('then the first browser language we have, matched on its first two letters', () => {
    expect(i18n.pickLang({ search: '', saved: null, languages: ['de-DE', 'ES-mx', 'ko'] })).toEqual({ lang: 'es', fromLink: false });
  });

  test('otherwise English', () => {
    expect(i18n.pickLang({ search: '', saved: null, languages: ['de'] })).toEqual({ lang: 'en', fromLink: false });
    expect(i18n.pickLang({ search: '', saved: null, languages: [] })).toEqual({ lang: 'en', fromLink: false });
    expect(i18n.pickLang({ search: '', saved: null })).toEqual({ lang: 'en', fromLink: false });
  });

  test('an unknown link or a junk saved value falls through to the next source', () => {
    expect(i18n.pickLang({ search: '?lang=de', saved: 'ko', languages: ['fr'] })).toEqual({ lang: 'ko', fromLink: false });
    expect(i18n.pickLang({ search: '', saved: 'constructor', languages: ['fr'] })).toEqual({ lang: 'fr', fromLink: false });
  });
});

describe('loading the page', () => {
  test('a ?lang= link shows that language but does not save it', () => {
    const { doc, setItem } = load({ search: '?lang=zh', saved: 'fr' });
    expect(doc.documentElement.dataset.lang).toBe('zh');
    expect(doc.documentElement.lang).toBe('zh-CN');
    expect(setItem).not.toHaveBeenCalled();
  });

  test('without a link the language is saved, as before', () => {
    const { doc, setItem } = load({ languages: ['fr-CA'] });
    expect(doc.documentElement.dataset.lang).toBe('fr');
    expect(setItem).toHaveBeenCalledWith('vb-lang', 'fr');
  });

  test('blocked storage still gives a language', () => {
    const { doc } = load({ throwOnStorage: true, languages: ['ko'] });
    expect(doc.documentElement.dataset.lang).toBe('ko');
  });

  test('picking a language later saves it', () => {
    const { i18n, doc, setItem } = load({ search: '?lang=zh' });
    i18n.applyLanguage('es');
    expect(doc.documentElement.dataset.lang).toBe('es');
    expect(setItem).toHaveBeenCalledWith('vb-lang', 'es');
  });
});
