import { describe, test, expect } from 'vitest';
import {
  normalize, prepareQuery, score, rank, browse, group, remember, parseRecent, resolveRecent,
  isApple, shortcutHint, isEditable, shortcutAction, GROUP_LABELS,
} from '../../portal/js/palette-model.js';

const item = (title, extra = {}) => ({ key: `k:${title}`, type: 'page', title, ...extra });

describe('normalize', () => {
  test('lower case, no accents, one space between words', () => {
    expect(normalize('  Zoë   MÜLLER ')).toBe('zoe muller');
    expect(normalize('Café Crème')).toBe('cafe creme');
    expect(normalize('Señor Núñez')).toBe('senor nunez');
  });

  test('apostrophes join letters, other symbols break words', () => {
    expect(normalize('O’Brien')).toBe('obrien');
    expect(normalize("o'brien")).toBe('obrien');
    expect(normalize('Smith-Jones, Jr.')).toBe('smith jones jr');
    expect(normalize('Algebra 2 (Honors)')).toBe('algebra 2 honors');
    expect(normalize('a/b_c')).toBe('a b c');
  });

  test('letters with no accent form are spelled out', () => {
    expect(normalize('Straße')).toBe('strasse');
    expect(normalize('Øystein Łukasz Đorđe')).toBe('oystein lukasz dorde');
    expect(normalize('Æther')).toBe('aether');
  });

  test('numbers and other scripts stay; empty input gives an empty string', () => {
    expect(normalize('SAT 1600')).toBe('sat 1600');
    expect(normalize('数学 homework')).toBe('数学 homework');
    expect(normalize('')).toBe('');
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
    expect(normalize('---')).toBe('');
    expect(normalize(42)).toBe('42');
  });

  test('is idempotent', () => {
    const once = normalize('Zoë O’Brien-Müller');
    expect(normalize(once)).toBe(once);
  });
});

describe('prepareQuery', () => {
  test('splits into normalized words', () => {
    expect(prepareQuery('  Maya  CHEN ')).toEqual({ raw: '  Maya  CHEN ', norm: 'maya chen', tokens: ['maya', 'chen'] });
    expect(prepareQuery('').tokens).toEqual([]);
    expect(prepareQuery('   ').tokens).toEqual([]);
    expect(prepareQuery(null).tokens).toEqual([]);
  });

  test('a prepared query passes through', () => {
    const q = prepareQuery('maya');
    expect(prepareQuery(q)).toBe(q);
  });
});

describe('score', () => {
  test('no match is 0, and an empty query matches nothing', () => {
    expect(score('zebra', item('Maya Chen'))).toBe(0);
    expect(score('', item('Maya Chen'))).toBe(0);
    expect(score('   ', item('Maya Chen'))).toBe(0);
    expect(score('maya', null)).toBe(0);
  });

  test('case and accent insensitive', () => {
    expect(score('MAYA', item('maya chen'))).toBeGreaterThan(0);
    expect(score('zoe', item('Zoë Park'))).toBeGreaterThan(0);
    expect(score('zoë', item('Zoe Park'))).toBeGreaterThan(0);
    expect(score('obrien', item('Liam O’Brien'))).toBeGreaterThan(0);
  });

  test('a whole word beats a word start, which beats inside a word, which beats scattered letters', () => {
    const whole = score('chen', item('Maya Chen'));
    const start = score('che', item('Maya Chen'));
    const inside = score('hen', item('Maya Chen'));
    const scattered = score('mcn', item('Maya Chen'));
    expect(whole).toBeGreaterThan(start);
    expect(start).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(scattered);
    expect(scattered).toBeGreaterThan(0);
  });

  test('the middle of a word needs three letters', () => {
    expect(score('gr', item('Overview', { keywords: 'progress' }))).toBe(0);
    expect(score('ogr', item('Overview', { keywords: 'progress' }))).toBeGreaterThan(0);
    expect(score('he', item('Maya Chen'))).toBe(0);
    expect(score('hen', item('Maya Chen'))).toBeGreaterThan(0);
  });

  test('typing more of a word scores higher than less of it', () => {
    expect(score('matr', item('Matrix'))).toBeGreaterThan(score('ma', item('Matrix')));
  });

  test('an earlier word counts more than a later one', () => {
    expect(score('chen', item('Chen Maya'))).toBeGreaterThan(score('chen', item('Maya Chen')));
  });

  test('a single letter matches word starts only, never scattered letters or the middle of a word', () => {
    expect(score('m', item('Maya'))).toBeGreaterThan(0);
    expect(score('a', item('Maya'))).toBe(0);
    expect(score('y', item('Maya Chen'))).toBe(0);
    expect(score('c', item('Maya Chen'))).toBeGreaterThan(0);
  });

  test('scattered letters work as an abbreviation when compact', () => {
    expect(score('rq', item('Review queue'))).toBeGreaterThan(0);
    expect(score('mth', item('Math tutoring'))).toBeGreaterThan(0);
    expect(score('tutr', item('Tutoring'))).toBeGreaterThan(0);
  });

  test('scattered letters must start at the start of a word', () => {
    expect(score('cal', item('Decimals practice'))).toBe(0);
    expect(score('sat', item('Quadratics: factoring'))).toBe(0);
    expect(score('mth', item('Smooth'))).toBe(0);
    expect(score('mth', item('Math'))).toBeGreaterThan(0);
    expect(score('cal', item('Calendar'))).toBeGreaterThan(score('cal', item('Bring graphing calculator')));
  });

  test('scattered letters only count in the title, never the second line or keywords', () => {
    expect(score('mth', item('Zebra', { meta: 'Math tutoring' }))).toBe(0);
    expect(score('mth', item('Zebra', { keywords: 'math tutoring' }))).toBe(0);
    expect(score('mth', item('Math tutoring'))).toBeGreaterThan(0);
  });

  test('letters strewn across a long title do not match', () => {
    expect(score('mxz', item('Maya prepares extra zebra notes'))).toBe(0);
    expect(score('ab', item('Alpha beta gamma delta epsilon zeta eta theta bees'))).toBeGreaterThan(0);
    expect(score('zq', item('Zebra and quiet'))).toBe(0);
  });

  test('letters out of order do not match', () => {
    expect(score('nyam', item('Maya Chen'))).toBe(0);
    expect(score('nc', item('Maya Chen'))).toBe(0);
  });

  test('every word of the query must match somewhere (AND)', () => {
    expect(score('maya chen', item('Maya Chen'))).toBeGreaterThan(0);
    expect(score('chen maya', item('Maya Chen'))).toBeGreaterThan(0);
    expect(score('maya zebra', item('Maya Chen'))).toBe(0);
  });

  test('words can match in different fields', () => {
    const essay = item('Essay draft', { meta: 'Maya Chen, Assignment, due Oct 9' });
    expect(score('maya essay', essay)).toBeGreaterThan(0);
    expect(score('essay maya', essay)).toBeGreaterThan(0);
    expect(score('maya poem', essay)).toBe(0);
  });

  test('keywords match but count least', () => {
    const page = item('Assignments', { keywords: 'homework' });
    expect(score('homework', page)).toBeGreaterThan(0);
    expect(score('homework', item('Homework help'))).toBeGreaterThan(score('homework', page));
  });

  test('a title match beats the same word in the meta', () => {
    const inTitle = item('Chen');
    const inMeta = item('Zebra', { meta: 'Chen' });
    expect(score('chen', inTitle)).toBeGreaterThan(score('chen', inMeta));
  });

  test('a title that is, or starts with, the query gets a bonus', () => {
    const exact = score('today', item('Today'));
    const starts = score('today', item('Today and tomorrow'));
    const later = score('today', item('Notes for today'));
    expect(exact).toBeGreaterThan(starts);
    expect(starts).toBeGreaterThan(later);
    expect(score('review q', item('Review queue'))).toBeGreaterThan(score('review q', item('Queue review', { keywords: 'review queue' })));
  });

  test('weight breaks near ties', () => {
    expect(score('maya', item('Maya', { weight: 4 }))).toBe(score('maya', item('Maya')) + 4);
  });

  test('a match is always at least 1', () => {
    expect(score('mcn', item('Maya Chen'))).toBeGreaterThanOrEqual(1);
  });

  test('re-scoring an item whose title changed uses the new title', () => {
    const it = item('Old name');
    expect(score('old', it)).toBeGreaterThan(0);
    it.title = 'Fresh name';
    expect(score('old', it)).toBe(0);
    expect(score('fresh', it)).toBeGreaterThan(0);
    it.meta = 'Old again';
    expect(score('old', it)).toBeGreaterThan(0);
  });

  test('a missing title, meta and keywords is fine', () => {
    expect(score('x', { key: 'a', type: 'page' })).toBe(0);
    expect(score('x', { key: 'a', type: 'page', title: null, meta: null })).toBe(0);
  });
});

describe('rank', () => {
  const items = [
    item('Chen essay'),
    item('Maya Chen'),
    item('Chen'),
    item('Unrelated'),
    item('Essay by Chen', { meta: 'Maya' }),
  ];

  test('best first, non-matches dropped', () => {
    const out = rank(items, 'chen');
    expect(out.map((e) => e.item.title)).toEqual(['Chen', 'Chen essay', 'Maya Chen', 'Essay by Chen']);
    expect(out.every((e) => e.score > 0)).toBe(true);
    for (let i = 1; i < out.length; i += 1) expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
  });

  test('equal scores keep their original order', () => {
    const same = [item('Alpha one'), item('Alpha two'), item('Alpha three')];
    expect(rank(same, 'alpha').map((e) => e.item.title)).toEqual(['Alpha one', 'Alpha two', 'Alpha three']);
  });

  test('an empty query ranks nothing', () => {
    expect(rank(items, '')).toEqual([]);
    expect(rank(items, '  ')).toEqual([]);
    expect(rank(null, 'a')).toEqual([]);
  });

  test('entries carry the item, its score and its index', () => {
    const [first] = rank(items, 'chen');
    expect(first).toEqual({ item: items[2], score: expect.any(Number), index: 2 });
  });

  test('a typo-free query finds a student ahead of work that merely mentions them', () => {
    const list = [
      { key: 'task:1', type: 'assignment', title: 'Read chapter 4', meta: 'Maya Chen, Assignment, due Oct 9', keywords: 'assignment homework' },
      { key: 'student:1', type: 'student', title: 'Maya Chen', weight: 2 },
    ];
    expect(rank(list, 'maya chen').map((e) => e.item.key)).toEqual(['student:1', 'task:1']);
  });
});

describe('browse', () => {
  const items = [
    item('Today', { key: 'page:today', browse: true }),
    item('Deep page', { key: 'page:deep' }),
    item('Students', { key: 'page:students', browse: true }),
    item('New session', { key: 'action:new', type: 'action', browse: true }),
  ];

  test('lists the browse items in order', () => {
    expect(browse(items).map((e) => e.item.key)).toEqual(['page:today', 'page:students', 'action:new']);
  });

  test('recent picks come first, in the Recent group, and are not repeated', () => {
    const out = browse(items, { recent: [items[2], items[1]] });
    expect(out.map((e) => e.item.key)).toEqual(['page:students', 'page:deep', 'page:today', 'action:new']);
    expect(out[0].item.group).toBe('recent');
    expect(out[1].item.group).toBe('recent');
    expect(out[2].item.group).toBeUndefined();
    // the originals are not changed
    expect(items[2].group).toBeUndefined();
  });

  test('shows at most maxRecent recents', () => {
    const many = Array.from({ length: 9 }, (_, i) => item(`R${i}`, { key: `r:${i}` }));
    const out = browse(items, { recent: many, maxRecent: 3 });
    expect(out.filter((e) => e.item.group === 'recent')).toHaveLength(3);
  });

  test('entries have a score of 0 and a running index', () => {
    expect(browse(items).map((e) => [e.score, e.index])).toEqual([[0, 0], [0, 1], [0, 2]]);
  });
});

describe('recents', () => {
  test('remember puts the newest first, drops repeats, and caps the list', () => {
    expect(remember(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
    expect(remember(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(remember(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
    expect(remember(null, 'a')).toEqual(['a']);
    expect(remember(['a'], '')).toEqual(['a']);
  });

  test('parseRecent keeps only a list of text keys', () => {
    expect(parseRecent('["a","b","a"]')).toEqual(['a', 'b']);
    expect(parseRecent('["a",3,null,"","b"]')).toEqual(['a', 'b']);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent('not json')).toEqual([]);
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent(undefined)).toEqual([]);
    expect(parseRecent(JSON.stringify(Array.from({ length: 20 }, (_, i) => `k${i}`)), 5)).toHaveLength(5);
  });

  test('resolveRecent maps keys to items, newest first, skipping what is gone', () => {
    const items = [item('A', { key: 'a' }), item('B', { key: 'b' })];
    expect(resolveRecent(['b', 'gone', 'a'], items).map((i) => i.key)).toEqual(['b', 'a']);
    expect(resolveRecent([], items)).toEqual([]);
    expect(resolveRecent(null, items)).toEqual([]);
    expect(resolveRecent(['a'], null)).toEqual([]);
  });
});

describe('group', () => {
  const entry = (type, title, score, extra = {}) => ({ item: { key: `${type}:${title}`, type, title, ...extra }, score, index: 0 });

  test('groups come in the order their best entry appeared', () => {
    const out = group([
      entry('student', 'A', 90), entry('page', 'B', 80), entry('student', 'C', 70), entry('session', 'D', 60),
    ]);
    expect(out.groups.map((g) => g.key)).toEqual(['student', 'page', 'session']);
    expect(out.groups[0].entries.map((e) => e.item.title)).toEqual(['A', 'C']);
  });

  test('labels come from the group, a groupLabel wins', () => {
    const out = group([entry('student', 'A', 9), entry('page', 'B', 8, { groupLabel: 'Maya’s pages' }), entry('weird', 'C', 7)]);
    expect(out.groups.map((g) => g.label)).toEqual(['Students', 'Maya’s pages', 'weird']);
    expect(GROUP_LABELS.session).toBe('Upcoming sessions');
  });

  test('an item group overrides its type', () => {
    const out = group([entry('page', 'A', 0, { group: 'recent' })]);
    expect(out.groups[0]).toMatchObject({ key: 'recent', label: 'Recent' });
  });

  test('at most perGroup per group, keeping the best', () => {
    const entries = Array.from({ length: 12 }, (_, i) => entry('student', `S${i}`, 100 - i));
    const out = group(entries, { perGroup: 8 });
    expect(out.groups[0].entries).toHaveLength(8);
    expect(out.groups[0].entries.map((e) => e.item.title)).toEqual(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
    expect(out.count).toBe(8);
    expect(out.hidden).toBe(4);
  });

  test('at most total overall, cut by score across groups', () => {
    const entries = [];
    for (let i = 0; i < 10; i += 1) entries.push(entry(['student', 'task', 'session', 'assignment'][i % 4], `X${i}`, 100 - i));
    const out = group(entries, { perGroup: 8, total: 6 });
    expect(out.count).toBe(6);
    expect(out.groups.flatMap((g) => g.entries).map((e) => e.item.title).sort()).toEqual(['X0', 'X1', 'X2', 'X3', 'X4', 'X5']);
    expect(out.hidden).toBe(4);
  });

  test('a full group does not stop other groups filling the total', () => {
    const entries = [
      ...Array.from({ length: 10 }, (_, i) => entry('student', `S${i}`, 100 - i)),
      entry('page', 'P', 5),
    ];
    const out = group(entries, { perGroup: 8, total: 30 });
    expect(out.groups.map((g) => [g.key, g.entries.length])).toEqual([['student', 8], ['page', 1]]);
  });

  test('every entry gets its position in the flat list, in display order', () => {
    const out = group([entry('student', 'A', 9), entry('page', 'B', 8), entry('student', 'C', 7)]);
    const flat = out.groups.flatMap((g) => g.entries);
    expect(flat.map((e) => e.item.title)).toEqual(['A', 'C', 'B']);
    expect(flat.map((e) => e.position)).toEqual([0, 1, 2]);
  });

  test('the defaults are 8 per group and 30 in all', () => {
    const entries = [];
    for (const type of ['student', 'assignment', 'task', 'session', 'page']) {
      for (let i = 0; i < 9; i += 1) entries.push(entry(type, `${type}${i}`, 100 - entries.length));
    }
    const out = group(entries);
    expect(out.groups.every((g) => g.entries.length <= 8)).toBe(true);
    expect(out.count).toBeLessThanOrEqual(30);
    expect(out.count).toBe(30);
  });

  test('nothing in, nothing out', () => {
    expect(group([])).toEqual({ groups: [], count: 0, hidden: 0 });
    expect(group(null)).toEqual({ groups: [], count: 0, hidden: 0 });
  });

  test('does not change the entries it is given', () => {
    const e = entry('student', 'A', 9);
    group([e]);
    expect(e.position).toBeUndefined();
  });
});

describe('keyboard', () => {
  test('isApple', () => {
    expect(isApple('MacIntel')).toBe(true);
    expect(isApple('macOS')).toBe(true);
    expect(isApple('iPhone')).toBe(true);
    expect(isApple('iPad')).toBe(true);
    expect(isApple('Win32')).toBe(false);
    expect(isApple('Linux x86_64')).toBe(false);
    expect(isApple('')).toBe(false);
    expect(isApple(undefined)).toBe(false);
  });

  test('the hint chip text', () => {
    expect(shortcutHint(true)).toBe('⌘K');
    expect(shortcutHint(false)).toBe('Ctrl K');
  });

  test('isEditable', () => {
    expect(isEditable({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isEditable({ tagName: 'input', type: 'search' })).toBe(true);
    expect(isEditable({ tagName: 'INPUT' })).toBe(true);
    expect(isEditable({ tagName: 'INPUT', type: 'email' })).toBe(true);
    expect(isEditable({ tagName: 'INPUT', type: 'date' })).toBe(true);
    expect(isEditable({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditable({ tagName: 'SELECT' })).toBe(true);
    expect(isEditable({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditable({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isEditable({ tagName: 'INPUT', type: 'radio' })).toBe(false);
    expect(isEditable({ tagName: 'INPUT', type: 'file' })).toBe(false);
    expect(isEditable({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(isEditable({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditable({ tagName: 'A' })).toBe(false);
    expect(isEditable({ tagName: 'BODY' })).toBe(false);
    expect(isEditable(null)).toBe(false);
  });

  const key = (k, extra = {}) => ({ key: k, target: { tagName: 'BODY' }, ...extra });

  test('Cmd+K opens on Apple devices, and Ctrl+K does not', () => {
    expect(shortcutAction(key('k', { metaKey: true }), { apple: true })).toBe('open');
    expect(shortcutAction(key('K', { metaKey: true }), { apple: true })).toBe('open');
    expect(shortcutAction(key('k', { ctrlKey: true }), { apple: true })).toBeNull();
    expect(shortcutAction(key('k', { metaKey: true, ctrlKey: true }), { apple: true })).toBeNull();
  });

  test('Ctrl+K opens elsewhere, and Cmd+K does not', () => {
    expect(shortcutAction(key('k', { ctrlKey: true }), { apple: false })).toBe('open');
    expect(shortcutAction(key('k', { ctrlKey: true }))).toBe('open');
    expect(shortcutAction(key('k', { metaKey: true }), { apple: false })).toBeNull();
  });

  test('the chord works even when focus is in a field', () => {
    const field = { tagName: 'INPUT', type: 'text' };
    expect(shortcutAction(key('k', { ctrlKey: true, target: field }))).toBe('open');
  });

  test('other modifiers or keys do not open it', () => {
    expect(shortcutAction(key('k'))).toBeNull();
    expect(shortcutAction(key('k', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(shortcutAction(key('k', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(shortcutAction(key('j', { ctrlKey: true }))).toBeNull();
    expect(shortcutAction(key('Enter'))).toBeNull();
    expect(shortcutAction(null)).toBeNull();
  });

  test('"/" opens it when focus is not in a text field', () => {
    expect(shortcutAction(key('/'))).toBe('open');
    expect(shortcutAction(key('/', { target: { tagName: 'BUTTON' } }))).toBe('open');
    expect(shortcutAction(key('/', { target: { tagName: 'INPUT', type: 'checkbox' } }))).toBe('open');
    expect(shortcutAction(key('/', { shiftKey: true }))).toBe('open');
  });

  test('"/" types a slash in text fields and editors', () => {
    expect(shortcutAction(key('/', { target: { tagName: 'INPUT', type: 'text' } }))).toBeNull();
    expect(shortcutAction(key('/', { target: { tagName: 'TEXTAREA' } }))).toBeNull();
    expect(shortcutAction(key('/', { target: { tagName: 'DIV', isContentEditable: true } }))).toBeNull();
  });

  test('"/" with Ctrl, Cmd or Alt is left alone', () => {
    expect(shortcutAction(key('/', { ctrlKey: true }))).toBeNull();
    expect(shortcutAction(key('/', { metaKey: true }))).toBeNull();
    expect(shortcutAction(key('/', { altKey: true }))).toBeNull();
  });

  test('nothing opens while an input method is composing', () => {
    expect(shortcutAction(key('/', { isComposing: true }))).toBeNull();
    expect(shortcutAction(key('k', { ctrlKey: true, isComposing: true }))).toBeNull();
  });
});
