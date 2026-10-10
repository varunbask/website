import { describe, test, expect } from 'vitest';
import {
  DOMAINS, SECTIONS, MODULE_TIMING, domainOf, sectionOf, moduleSection, originLabel,
  sprClean, sprValue, sprValid, sprInput, sprCorrect, sprLimit, mcValid, isCorrect, validAnswer, answerText, sprParts, sprForms,
  formatClock, clockWords, remainingMs, timerTone, timerAnnouncement, minutesText, timeUsed,
  satPage, satTitle, satCrumbs, practiceHref, testHref, reviewHref, learnHref,
  setCounts, countsText, practiceSetsFor, skillsByDomain, testGroups, modulesOf, nextModule, libraryGroups, skillFiles, fileSkillMatches,
  bankSkill, SHARED_BANK,
  pct, progressFrom, attemptCounts, practiceLine, scoreText, bestAndLast, continueList, sittings, sittingNext, fullScore,
  domainBreakdown, filterReview, unansweredCount, submitConfirmText, attemptLabel, attemptResult, lastText,
  isOpen, firstAttemptIds,
} from '../../portal/js/sat-model.js';

describe('domains and sections', () => {
  test('eight domains, four in each section, with the official names', () => {
    expect(DOMAINS.map((d) => d.slug)).toEqual([
      'information-and-ideas', 'craft-and-structure', 'expression-of-ideas', 'standard-english-conventions',
      'algebra', 'advanced-math', 'problem-solving-and-data-analysis', 'geometry-and-trigonometry',
    ]);
    expect(DOMAINS.filter((d) => d.section === 'rw')).toHaveLength(4);
    expect(SECTIONS.map((s) => s.name)).toEqual(['Reading and Writing', 'Math']);
    expect(domainOf('problem-solving-and-data-analysis').name).toBe('Problem-Solving and Data Analysis');
    expect(sectionOf('boundaries')).toBeNull();
    expect(sectionOf('standard-english-conventions')).toBe('rw');
  });

  test('module timing: 27 questions in 32 minutes, 22 in 35', () => {
    expect(MODULE_TIMING).toEqual({ rw: { questions: 27, minutes: 32 }, math: { questions: 22, minutes: 35 } });
    expect(moduleSection('rw2')).toBe('rw');
    expect(moduleSection('m1')).toBe('math');
    expect(moduleSection('m', { domain: 'craft-and-structure' })).toBe('rw');
    expect(moduleSection('m', { domain: 'algebra' })).toBe('math');
  });

  test('practice set labels never name a person', () => {
    expect(originLabel('vp')).toBe('Skill Builder');
    expect(originLabel('matthew')).toBe('Guide practice');
    expect(originLabel(undefined)).toBe('Guide practice');
  });
});

describe('grid-in scoring (mirrors private.sat_spr_correct)', () => {
  test('cleaning: trimmed, spaces and a leading + dropped', () => {
    expect(sprClean('  + 3 / 4 ')).toBe('3/4');
    expect(sprClean('+-2')).toBe('-2');
  });

  test('valid forms: integers, decimals (.5 too), fractions with b not 0', () => {
    expect(sprValue('7')).toBe(7);
    expect(sprValue('-3')).toBe(-3);
    expect(sprValue('.5')).toBe(0.5);
    expect(sprValue('-.5')).toBe(-0.5);
    expect(sprValue('3.')).toBe(3);
    expect(sprValue('7/2')).toBe(3.5);
    expect(sprValue('-7/2')).toBe(-3.5);
    for (const bad of ['', '-', '.', '1/0', '1.5/2', '3/-4', '2x', '1,000', '--1', '1/2/3', 'abc']) expect(sprValue(bad), bad).toBeNull();
  });

  test('equal values are correct, unreduced fractions included', () => {
    expect(sprCorrect('3.5', '7/2', [])).toBe(true);
    expect(sprCorrect('7/2', '3.5', [])).toBe(true);
    expect(sprCorrect('6/4', '3/2', [])).toBe(true);
    expect(sprCorrect('0.5', '1/2', [])).toBe(true);
    expect(sprCorrect('.5', '1/2', [])).toBe(true);
    expect(sprCorrect('+3', '3', [])).toBe(true);
    expect(sprCorrect('-3', '3', [])).toBe(false);
    expect(sprCorrect('4', '3', [])).toBe(false);
  });

  test('a rounded or cut-off repeating decimal counts only when listed', () => {
    const accept = ['.6666', '.6667', '0.666', '0.667'];
    expect(sprCorrect('2/3', '2/3', accept)).toBe(true);
    for (const a of accept) expect(sprCorrect(a, '2/3', accept), a).toBe(true);
    expect(sprCorrect('.6666', '2/3', [])).toBe(false);
    expect(sprCorrect('.67', '2/3', accept)).toBe(false);
    expect(sprCorrect('0.66', '2/3', accept)).toBe(false);
  });

  test('alternative answers in accept (a second root)', () => {
    expect(sprCorrect('-2', '3', ['-2'])).toBe(true);
    expect(sprCorrect('5', '3', ['-2'])).toBe(false);
  });

  test('5 characters, 6 with a minus sign; longer is wrong', () => {
    expect(sprLimit('3')).toBe(5);
    expect(sprLimit('-3')).toBe(6);
    expect(sprCorrect('.6666', '2/3', ['.6666'])).toBe(true);
    expect(sprCorrect('0.6666', '2/3', ['0.6666'])).toBe(false);
    expect(sprCorrect('-.6666', '-2/3', ['-.6666'])).toBe(true);
    expect(sprCorrect('-0.6666', '-2/3', ['-0.6666'])).toBe(false);
    expect(sprCorrect('12345', '12345', [])).toBe(true);
    expect(sprCorrect('123456', '123456', [])).toBe(false);
    expect(sprValid('-12345')).toBe(true);
    expect(sprValid('12345.')).toBe(false);
  });

  test('anything else is wrong, and a bad accept list is ignored', () => {
    expect(sprCorrect('', '3', [])).toBe(false);
    expect(sprCorrect(null, '3', [])).toBe(false);
    expect(sprCorrect('3', '3', null)).toBe(true);
    expect(sprCorrect('3', 'x', ['3'])).toBe(true);
    expect(sprCorrect('3', 'x', 'nope')).toBe(false);
  });

  test('exact forms match by value; listed roundings match only as typed (a repeating decimal must fill the box)', () => {
    const yes = (r, a, acc) => expect(sprCorrect(r, a, acc), `${r} for ${a}`).toBe(true);
    const no = (r, a, acc) => expect(sprCorrect(r, a, acc), `${r} for ${a}`).toBe(false);
    const A817 = ['.4705', '.4706', '0.470', '0.471'];
    for (const r of ['8/17', '16/34', '.4705', '.4706', '0.470', '0.471']) yes(r, '8/17', A817);
    // ".47" has the value of "0.470" but is too short; ".4710" is not what was listed; "0.4706" is 6 characters
    for (const r of ['.47', '0.47', '.4710', '0.4706']) no(r, '8/17', A817);
    const A23 = ['.6666', '.6667', '0.666', '0.667'];
    for (const r of ['2/3', '.6666', '.6667', '0.666', '0.667']) yes(r, '2/3', A23);
    for (const r of ['.67', '0.67', '.666', '0.6667']) no(r, '2/3', A23);
    for (const r of ['3.5', '3.50', '14/4', '7/2']) yes(r, '7/2', ['3.5']);
    const AN = ['-.6666', '-.6667', '-0.666', '-0.667'];
    for (const r of [...AN, '-2/3']) yes(r, '-2/3', AN);
    no('-.67', '-2/3', AN);
    for (const r of ['12', '12.0', '24/2', '+12']) yes(r, '12', []);
    no('12.5', '12', []);
  });

  test('several correct answers are all exact forms (two roots), with their own roundings', () => {
    expect(sprCorrect('-2', '3', ['-2'])).toBe(true);
    expect(sprCorrect('-4/2', '3', ['-2'])).toBe(true);
    expect(sprCorrect('-2.0', '3', ['-2'])).toBe(true);
    // a decimal second root is exact too
    expect(sprCorrect('2.50', '3', ['2.5'])).toBe(true);
    const acc = ['1/3', '.3333'];
    expect(sprCorrect('1/3', '3', acc)).toBe(true);
    expect(sprCorrect('2/6', '3', acc)).toBe(true);
    expect(sprCorrect('.3333', '3', acc)).toBe(true);
    expect(sprCorrect('.33', '3', acc)).toBe(false);
    const forms = sprForms('3', acc);
    expect(forms.approx).toEqual(['.3333']);
    expect(forms.exact.map((x) => `${x.num}/${x.den}`)).toEqual(['3/1', '1/3']);
  });

  test('entries as exact fractions', () => {
    expect(sprParts('3.50')).toEqual({ num: 350n, den: 100n });
    expect(sprParts('-.5')).toEqual({ num: -5n, den: 10n });
    expect(sprParts('3.')).toEqual({ num: 3n, den: 1n });
    expect(sprParts('-7/2')).toEqual({ num: -7n, den: 2n });
    expect(sprParts('+ 6 / 4')).toEqual({ num: 6n, den: 4n });
    for (const bad of ['', '-', '.', '1/0', '1.5/2', 'x']) expect(sprParts(bad), bad).toBeNull();
  });

  test('the box keeps digits, one point, one slash and a leading minus, cut to the limit', () => {
    expect(sprInput('3.5.1')).toBe('3.51');
    expect(sprInput('7//2')).toBe('7/2');
    expect(sprInput('12-3')).toBe('123');
    expect(sprInput('-12')).toBe('-12');
    expect(sprInput('abc1.2')).toBe('1.2');
    expect(sprInput('1234567')).toBe('12345');
    expect(sprInput('-1234567')).toBe('-12345');
    // a typographic minus or a dash counts as the minus sign
    for (const dash of ['\u2212', '\u2013', '\u2012', '\u2014']) expect(sprInput(`${dash}3/4`), dash).toBe('-3/4');
  });

  test('either kind, and the answers the admin may release with', () => {
    expect(isCorrect('mc', ' b ', 'B')).toBe(true);
    expect(isCorrect('mc', 'C', 'B')).toBe(false);
    expect(isCorrect('mc', '', 'B')).toBe(false);
    expect(isCorrect('spr', '3.5', '7/2', [])).toBe(true);
    expect(isCorrect('spr', '3.5', null, [])).toBe(false);
    expect(mcValid('d')).toBe(true);
    expect(mcValid('E')).toBe(false);
    expect(validAnswer('mc', 'A')).toBe(true);
    expect(validAnswer('spr', '7/2')).toBe(true);
    expect(validAnswer('spr', '0.66667')).toBe(false);
  });

  test('answers in words', () => {
    expect(answerText('mc', 'b')).toBe('B');
    expect(answerText('spr', '7/2', ['3.5'])).toBe('7/2 (also accepted: 3.5)');
    expect(answerText('spr', '4', [])).toBe('4');
    expect(answerText('spr', null)).toBe('');
  });
});

describe('the timer', () => {
  test('clock text and words', () => {
    expect(formatClock(32 * 60_000)).toBe('32:00');
    expect(formatClock(61_500)).toBe('1:02');
    expect(formatClock(999)).toBe('0:01');
    expect(formatClock(-5000)).toBe('0:00');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(clockWords(65_000)).toBe('1 minute, 5 seconds left');
    expect(clockWords(120_000)).toBe('2 minutes left');
    expect(clockWords(0)).toBe('0 seconds left');
  });

  test('time left on the server clock, amber in the last five minutes', () => {
    const deadline = '2026-10-14T12:30:00.000Z';
    const now = Date.parse('2026-10-14T12:00:00.000Z');
    expect(remainingMs(deadline, now)).toBe(30 * 60_000);
    // the device is 2 minutes slow: the server is 2 minutes ahead
    expect(remainingMs(deadline, now, 120_000)).toBe(28 * 60_000);
    expect(remainingMs('nope', now)).toBeNull();
    expect(timerTone(5 * 60_000 + 1)).toBe('normal');
    expect(timerTone(5 * 60_000)).toBe('warning');
    expect(timerTone(null)).toBe('normal');
  });

  test('announced once at 5 minutes and at 1 minute', () => {
    expect(timerAnnouncement(300_400, 299_900)).toBe('5 minutes left.');
    expect(timerAnnouncement(299_900, 299_400)).toBeNull();
    expect(timerAnnouncement(60_300, 59_800)).toBe('1 minute left.');
    expect(timerAnnouncement(600_000, 599_000)).toBeNull();
  });

  test('minutes and time used', () => {
    expect(minutesText(32)).toBe('32 min');
    expect(minutesText(134)).toBe('2 h 14 min');
    expect(minutesText(120)).toBe('2 h');
    expect(timeUsed({ started_at: '2026-10-14T12:00:00Z', submitted_at: '2026-10-14T12:18:20Z' })).toBe('18 min');
    expect(timeUsed({ started_at: '2026-10-14T12:00:00Z', submitted_at: '2026-10-14T12:00:20Z' })).toBe('under a minute');
    expect(timeUsed({ started_at: '2026-10-14T12:00:00Z', submitted_at: null })).toBeNull();
  });

  test('when something last happened', () => {
    const now = new Date('2026-10-14T19:00:00Z');
    expect(lastText('2026-10-14T18:59:50Z', now)).toBe('just now');
    expect(lastText('2026-10-14T18:30:00Z', now)).toBe('30 minutes ago');
    expect(lastText('2026-09-01T18:30:00Z', now)).toBe('on Sep 1');
    expect(lastText(null, now)).toBe('');
  });
});

describe('routes', () => {
  const r = (sub = null, id = null, params = {}) => ({ view: 'sat', sub, id, params });

  test('each #/sat page', () => {
    expect(satPage(r()).page).toBe('home');
    expect(satPage(r('learn'))).toMatchObject({ page: 'learn', id: null });
    expect(satPage(r('learn', 'boundaries'))).toMatchObject({ page: 'skill', id: 'boundaries' });
    expect(satPage(r('practice'))).toMatchObject({ page: 'practice' });
    expect(satPage(r('practice', 'alg-ch1'))).toMatchObject({ page: 'practice-run', id: 'alg-ch1' });
    expect(satPage(r('tests'))).toMatchObject({ page: 'tests' });
    expect(satPage(r('test', 'full-01', { module: 'rw2', sitting: 'abc' }))).toMatchObject({ page: 'test-run', id: 'full-01', module: 'rw2', sitting: 'abc' });
    expect(satPage(r('test'))).toMatchObject({ page: 'tests' });
    expect(satPage(r('review', '42', { show: 'wrong' }))).toMatchObject({ page: 'review', id: '42', show: 'wrong' });
    expect(satPage(r('review', '42', { show: 'bogus' })).show).toBe('all');
    expect(satPage(r('library', null, { tab: 'bank' })).tab).toBe('bank');
    expect(satPage(r('library', null, { tab: 'nope' })).tab).toBe('lessons');
    expect(satPage(r('nope')).page).toBe('home');
  });

  test('titles and breadcrumbs', () => {
    expect(satTitle(r())).toBe('SAT');
    expect(satTitle(r('library'))).toBe('SAT library');
    expect(satTitle(r('test', 'x'))).toBe('SAT test');
    expect(satCrumbs(r())).toEqual([{ label: 'SAT' }]);
    expect(satCrumbs(r('practice'))).toEqual([{ label: 'SAT', href: '#/sat' }, { label: 'Practice', href: '#/sat/practice' }]);
    expect(satCrumbs(r('test', 'full-01'), { title: 'Full Practice Test 1' })).toEqual([
      { label: 'SAT', href: '#/sat' }, { label: 'Tests', href: '#/sat/tests' }, { label: 'Full Practice Test 1' },
    ]);
  });

  test('links', () => {
    expect(practiceHref('alg-ch1')).toBe('#/sat/practice/alg-ch1');
    expect(learnHref('boundaries')).toBe('#/sat/learn/boundaries');
    expect(reviewHref(42)).toBe('#/sat/review/42');
    expect(reviewHref(42, 'wrong')).toBe('#/sat/review/42?show=wrong');
    expect(testHref('alg-t1')).toBe('#/sat/test/alg-t1');
    expect(testHref('full-01', { module: 'rw2', sitting: 's-1' })).toBe('#/sat/test/full-01?module=rw2&sitting=s-1');
  });
});

// ---------------------------------------------------------------------------

const SETS = [
  { id: 'alg-ch1', kind: 'practice', domain: 'algebra', skill: 'alg-lin', title: 'Linear', position: 1, origin: 'matthew', modules: [] },
  { id: 'alg-sb1', kind: 'practice', domain: 'algebra', skill: 'alg-lin', title: 'Linear builder', position: 2, origin: 'vp', modules: [] },
  { id: 'alg-t1', kind: 'skill_test', domain: 'algebra', title: 'Algebra Test 1', position: 1, modules: [{ key: 'm', title: 'Algebra', minutes: 35 }] },
  { id: 'rw-t1', kind: 'skill_test', domain: 'craft-and-structure', title: 'Craft Test 1', position: 1, modules: [] },
  {
    id: 'full-01', kind: 'full_test', title: 'Full 1', position: 1,
    modules: [{ key: 'rw1', title: 'RW 1', minutes: 32 }, { key: 'rw2', title: 'RW 2', minutes: 32 }, { key: 'm1', title: 'M 1', minutes: 35 }, { key: 'm2', title: 'M 2', minutes: 35 }],
  },
];
const SKILLS = [
  { slug: 'alg-lin', domain: 'algebra', name: 'Linear Equations in One Variable', position: 1 },
  { slug: 'alg-fun', domain: 'algebra', name: 'Linear Functions', position: 2 },
  { slug: 'words', domain: 'craft-and-structure', name: 'Words in Context', position: 1 },
];
const ITEMS = [
  { id: 'a1', set_id: 'alg-ch1', module: null, domain: 'algebra', skill: 'alg-lin', difficulty: 'easy', held: false },
  { id: 'a2', set_id: 'alg-ch1', module: null, domain: 'algebra', skill: 'alg-lin', difficulty: 'medium', held: false },
  { id: 'a3', set_id: 'alg-ch1', module: null, domain: 'algebra', skill: 'alg-fun', difficulty: 'hard', held: false },
  { id: 'a4', set_id: 'alg-ch1', module: null, domain: 'algebra', skill: 'alg-lin', difficulty: 'hard', held: true },
  { id: 'w1', set_id: 'full-01', module: 'rw1', domain: 'craft-and-structure', skill: 'words', difficulty: 'easy', held: false },
  { id: 'm1', set_id: 'full-01', module: 'm1', domain: 'algebra', skill: 'alg-lin', difficulty: 'easy', held: false },
];
const INDEX = new Map(ITEMS.map((i) => [i.id, i]));

describe('the catalog', () => {
  test('counts by difficulty, module and held', () => {
    const c = setCounts(ITEMS).get('alg-ch1');
    expect(c).toMatchObject({ easy: 1, medium: 1, hard: 1, total: 3, held: 1 });
    expect(c.byModule).toEqual({ '': 3 });
    expect(setCounts(ITEMS).get('full-01').byModule).toEqual({ rw1: 1, m1: 1 });
    expect(countsText(c)).toBe('Easy 1, Medium 1, Hard 1');
    expect(countsText({ easy: 0, medium: 2, hard: 0 })).toBe('Medium 2');
  });

  test('practice sets of a skill: Skill Builder first', () => {
    expect(practiceSetsFor(SETS, 'alg-lin').map((s) => s.id)).toEqual(['alg-sb1', 'alg-ch1']);
    expect(practiceSetsFor(SETS, 'words')).toEqual([]);
  });

  test('skills by domain, all eight domains listed', () => {
    const groups = skillsByDomain(SKILLS);
    expect(groups).toHaveLength(8);
    expect(groups.find((g) => g.domain.slug === 'algebra').skills.map((s) => s.slug)).toEqual(['alg-lin', 'alg-fun']);
  });

  test('tests: skill tests by domain, then the full tests', () => {
    const g = testGroups(SETS);
    expect(g.byDomain.map((x) => x.domain.slug)).toEqual(['craft-and-structure', 'algebra']);
    expect(g.full.map((s) => s.id)).toEqual(['full-01']);
  });

  test('modules, with a skill test listed without any timed by its section', () => {
    expect(modulesOf(SETS[2])).toEqual([{ key: 'm', title: 'Algebra', minutes: 35 }]);
    expect(modulesOf(SETS[3])).toEqual([{ key: null, title: 'Craft Test 1', minutes: 32 }]);
    expect(modulesOf(SETS[0])).toEqual([]);
    expect(nextModule(SETS[4], 'rw1').key).toBe('rw2');
    expect(nextModule(SETS[4], 'rw2').key).toBe('m1');
    expect(nextModule(SETS[4], 'm2')).toBeNull();
  });

  test('a file matches a skill by slug or by name', () => {
    expect(fileSkillMatches({ skill: 'alg-lin' }, SKILLS[0])).toBe(true);
    expect(fileSkillMatches({ skill: 'Linear equations in one variable' }, SKILLS[0])).toBe(true);
    expect(fileSkillMatches({ skill: 'Linear functions' }, SKILLS[0])).toBe(false);
    expect(fileSkillMatches({ skill: null }, SKILLS[0])).toBe(false);
  });

  const FILES = [
    { id: 'l1', collection: 'lesson', domain: 'algebra', skill: 'alg-lin', title: 'Lesson', storage_path: 'lessons/x.pdf', position: 1 },
    { id: 'l2', collection: 'lesson', domain: 'algebra', skill: null, title: 'By path', storage_path: 'lessons/alg-sb1.pdf', position: 2 },
    { id: 'l3', collection: 'lesson', domain: 'algebra', skill: null, title: 'Loose', storage_path: 'lessons/other.pdf', position: 3 },
    { id: 'q1', collection: 'question_bank', domain: 'algebra', skill: 'Linear equations in one variable', difficulty: 'easy', title: 'QB easy', storage_path: 'qb/1.pdf', position: 1 },
    { id: 'q2', collection: 'question_bank', domain: 'algebra', skill: 'alg-lin', difficulty: 'hard', title: 'QB hard', storage_path: 'qb/2.pdf', position: 2 },
    { id: 'q3', collection: 'question_bank', domain: 'algebra', skill: 'Systems of two linear equations', difficulty: 'easy', title: 'QB systems', storage_path: 'qb/3.pdf', position: 3 },
    { id: 'o1', collection: 'official_test', title: 'Official 5', storage_path: 'o/5.pdf', position: 1 },
    { id: 't1', collection: 'test_pdf', title: 'Test 1', storage_path: 't/1.pdf', staff_only: true, position: 1 },
    { id: 'k1', collection: 'answer_key', title: 'Key 1', storage_path: 'k/1.pdf', staff_only: true, position: 2 },
  ];

  test('the library tabs', () => {
    const g = libraryGroups(FILES, SKILLS, SETS);
    expect(g.lessons).toHaveLength(1);
    expect(g.lessons[0].skills[0].files.map((f) => f.id)).toEqual(['l1', 'l2']);
    expect(g.lessons[0].other.map((f) => f.id)).toEqual(['l3']);
    const bank = g.bank[0].skills;
    expect(bank.map((s) => s.label)).toEqual(['Linear Equations in One Variable', 'Systems of two linear equations']);
    expect(Object.keys(bank[0].levels)).toEqual(['easy', 'hard']);
    expect(g.official.map((f) => f.id)).toEqual(['o1']);
    expect(g.staff.map((f) => f.id)).toEqual(['t1', 'k1']);
  });

  test('Command of Evidence: one set of Question Bank PDFs for both skills, listed once in the library', () => {
    const skills = [
      { slug: 'evidence-textual', domain: 'information-and-ideas', name: 'Command of Evidence: Textual', position: 2 },
      { slug: 'evidence-quantitative', domain: 'information-and-ideas', name: 'Command of Evidence: Quantitative', position: 3 },
      { slug: 'inferences', domain: 'information-and-ideas', name: 'Inferences', position: 4 },
    ];
    const files = ['easy', 'medium', 'hard'].map((d, i) => ({
      id: `qb-coe-${d}`, collection: 'question_bank', domain: 'information-and-ideas', skill: 'evidence-textual', difficulty: d,
      title: `Command of Evidence, ${d}`, storage_path: `qb/coe-${d}.pdf`, position: i,
    }));
    files.push({ id: 'qb-inf', collection: 'question_bank', domain: 'information-and-ideas', skill: 'inferences', difficulty: 'easy', title: 'Inferences, Easy', storage_path: 'qb/inf.pdf', position: 9 });
    expect(SHARED_BANK).toEqual({ 'evidence-quantitative': 'evidence-textual' });
    expect(bankSkill(skills[1])).toEqual({ slug: 'evidence-textual', shared: true, label: 'Command of Evidence (textual and quantitative)' });
    expect(bankSkill(skills[2])).toEqual({ slug: 'inferences', shared: false, label: null });
    const quant = skillFiles(files, skills[1], []);
    expect(Object.keys(quant.bank)).toEqual(['easy', 'medium', 'hard']);
    expect(quant.bankLabel).toBe('Command of Evidence (textual and quantitative)');
    const textual = skillFiles(files, skills[0], []);
    expect(Object.keys(textual.bank)).toEqual(['easy', 'medium', 'hard']);
    expect(textual.bankLabel).toBe('Command of Evidence (textual and quantitative)');
    const inf = skillFiles(files, skills[2], []);
    expect(Object.keys(inf.bank)).toEqual(['easy']);
    expect(inf.bankLabel).toBeNull();
    expect(skillFiles([], skills[1], []).bankLabel).toBeNull();
    const rows = libraryGroups(files, skills, []).bank[0].skills;
    expect(rows.map((r) => r.label)).toEqual(['Command of Evidence (textual and quantitative)', 'Inferences']);
    expect(Object.keys(rows[0].levels)).toEqual(['easy', 'medium', 'hard']);
  });

  test('a skill page’s files', () => {
    const f = skillFiles(FILES, SKILLS[0], SETS);
    expect(f.lessons.map((x) => x.id)).toEqual(['l1', 'l2']);
    expect(Object.keys(f.bank)).toEqual(['easy', 'hard']);
  });
});

describe('progress', () => {
  const R = (attempt_id, item_id, response, correct, answered_at = '2026-10-10T10:00:00Z', flagged = false) => ({ attempt_id, item_id, response, correct, answered_at, flagged });
  const RESPONSES = [
    R(1, 'a1', 'B', true, '2026-10-10T10:00:00Z'),
    R(1, 'a2', '7/2', false, '2026-10-11T10:00:00Z'),
    R(1, 'a3', null, null),                // flagged only, never answered
    R(2, 'w1', 'A', true, '2026-10-12T10:00:00Z'),
    R(2, 'm1', 'C', null),                 // a test still running: not scored yet
    R(3, 'gone', 'A', true),               // an item no longer listed (held)
  ];

  test('percent', () => {
    expect(pct(9, 12)).toBe(75);
    expect(pct(2, 3)).toBe(67);
    expect(pct(0, 0)).toBeNull();
  });

  test('per section, domain and skill: only scored answers count', () => {
    const p = progressFrom(RESPONSES, INDEX);
    expect(p.all).toEqual({ answered: 3, correct: 2, last: '2026-10-12T10:00:00Z' });
    expect(p.sections.math).toEqual({ answered: 2, correct: 1, last: '2026-10-11T10:00:00Z' });
    expect(p.sections.rw).toEqual({ answered: 1, correct: 1, last: '2026-10-12T10:00:00Z' });
    expect(p.domains.algebra.answered).toBe(2);
    expect(p.domains['geometry-and-trigonometry']).toEqual({ answered: 0, correct: 0, last: null });
    expect(p.skills['alg-lin']).toEqual({ answered: 2, correct: 1, last: '2026-10-11T10:00:00Z' });
    expect(p.skills['alg-fun']).toBeUndefined();
  });

  test('per attempt: answered and correct, "12 of 18, 9 correct"', () => {
    const c = attemptCounts(RESPONSES);
    expect(c.get(1)).toEqual({ answered: 2, correct: 1 });
    expect(c.get(2)).toEqual({ answered: 2, correct: 1 });
    expect(practiceLine({ answered: 12, correct: 9 }, 18)).toBe('12 of 18, 9 correct');
    expect(practiceLine(undefined, 18)).toBe('0 of 18, 0 correct');
    expect(scoreText(15, 22)).toBe('15 of 22 (68%)');
    expect(scoreText(null, 22)).toBe('');
  });

  const A = (id, set_id, extra = {}) => ({ id, set_id, module: null, sitting: null, mode: 'test', started_at: `2026-10-0${id}T10:00:00Z`, submitted_at: null, correct: null, total: null, ...extra });

  test('best and last scores of a test', () => {
    const list = [
      A(1, 'alg-t1', { submitted_at: '2026-10-01T11:00:00Z', correct: 18, total: 22 }),
      A(2, 'alg-t1', { submitted_at: '2026-10-02T11:00:00Z', correct: 15, total: 22 }),
      A(3, 'alg-t1'),
    ];
    const r = bestAndLast(list);
    expect(r.best.id).toBe(1);
    expect(r.last.id).toBe(2);
    expect(r.attempts.map((a) => a.id)).toEqual([2, 1]);
  });

  test('continue: the newest open attempt of each set', () => {
    const list = [A(1, 'alg-ch1', { mode: 'practice' }), A(2, 'alg-ch1', { mode: 'practice' }), A(3, 'alg-t1', { submitted_at: 'x' }), A(4, 'full-01')];
    expect(continueList(list).map((a) => a.id)).toEqual([4, 2]);
  });

  test('full test sittings, the next module and the raw scores', () => {
    const set = SETS[4];
    const list = [
      A(1, 'full-01', { module: 'rw1', sitting: 's1', submitted_at: 'x', correct: 20, total: 27 }),
      A(2, 'full-01', { module: 'rw2', sitting: 's1', submitted_at: 'x', correct: 22, total: 27 }),
      A(3, 'full-01', { module: 'm1', sitting: 's1' }),
      A(4, 'full-01', { module: 'rw1', sitting: 's2', submitted_at: 'x', correct: 10, total: 27 }),
    ];
    const s = sittings(list, set);
    expect([...s.keys()]).toEqual(['s1', 's2']);
    expect(s.get('s1').done).toBe(false);
    expect(sittingNext(s.get('s1'), set)).toMatchObject({ key: 'm1', attempt: { id: 3 } });
    expect(sittingNext(s.get('s2'), set)).toEqual({ key: 'rw2', attempt: null });
    expect(fullScore(s.get('s1'), set)).toEqual({ sections: { rw: { correct: 42, total: 54 }, math: { correct: 0, total: 0 } }, correct: 42, total: 54 });
    const done = sittings([...list.slice(0, 2),
      A(5, 'full-01', { module: 'm1', sitting: 's1', submitted_at: 'x', correct: 15, total: 22 }),
      A(6, 'full-01', { module: 'm2', sitting: 's1', submitted_at: 'x', correct: 17, total: 22 })], set).get('s1');
    expect(done.done).toBe(true);
    expect(sittingNext(done, set)).toBeNull();
    expect(fullScore(done, set).sections.math).toEqual({ correct: 32, total: 44 });
  });

  test('domain breakdown, review filters and the submit confirm', () => {
    const items = [{ item: 'a1', correct: true, flagged: false }, { item: 'a2', correct: false, flagged: true }, { item: 'w1', correct: false, flagged: false }];
    expect(domainBreakdown(items, INDEX).map((d) => [d.domain.slug, d.correct, d.total])).toEqual([['craft-and-structure', 0, 1], ['algebra', 1, 2]]);
    expect(filterReview(items, 'wrong').map((r) => r.item)).toEqual(['a2', 'w1']);
    expect(filterReview(items, 'flagged').map((r) => r.item)).toEqual(['a2']);
    expect(filterReview(items, 'all')).toHaveLength(3);
    const answers = new Map([['a1', { response: 'B' }], ['a2', { response: '' }]]);
    expect(unansweredCount(['a1', 'a2', 'a3'], answers)).toBe(2);
    expect(submitConfirmText(0)).toMatch(/^Every question has an answer/);
    expect(submitConfirmText(1)).toMatch(/^1 question has no answer and will count as wrong/);
    expect(submitConfirmText(3)).toMatch(/^3 questions have no answer/);
  });

  test('attempt names and results', () => {
    expect(attemptLabel({ module: 'rw2' }, SETS[4])).toBe('Full 1, RW 2');
    expect(attemptLabel({ module: 'm' }, SETS[2])).toBe('Algebra Test 1');
    expect(attemptLabel({}, null)).toBe('SAT set');
    expect(attemptResult({ submitted_at: 'x', correct: 3, total: 4 })).toBe('3 of 4 (75%)');
    expect(attemptResult({ mode: 'practice' }, { answered: 2, correct: 1 }, 5)).toBe('In progress, 2 of 5, 1 correct');
    expect(attemptResult({ mode: 'test' })).toBe('In progress');
  });
});

describe('copy', () => {
  test('no em or en dashes in the SAT modules', async () => {
    const { readFileSync } = await import('node:fs');
    const files = ['sat-model.js', 'sat-doc.js', 'sat-ui.js', 'sat-data.js', 'views/sat.js', 'views/sat-pages.js', 'views/sat-practice.js', 'views/sat-test.js', 'views/sat-review.js'];
    for (const f of files) {
      const text = readFileSync(new URL(`../../portal/js/${f}`, import.meta.url), 'utf8');
      expect(text, f).not.toMatch(/[–—]/);
      // Students never see who wrote a set: only staff code paths may name it
      if (f !== 'views/sat-pages.js') expect(text, f).not.toMatch(/Matthew/);
    }
  });
});

describe('attempts after the security review', () => {
  const NOW = Date.parse('2026-10-14T12:00:00Z');
  test('a test module is open until 30 seconds past its deadline; a practice run until finished', () => {
    expect(isOpen({ mode: 'test', deadline_at: '2026-10-14T11:59:40Z' }, NOW)).toBe(true);
    expect(isOpen({ mode: 'test', deadline_at: '2026-10-14T11:59:20Z' }, NOW)).toBe(false);
    expect(isOpen({ mode: 'test', deadline_at: '2026-10-14T12:30:00Z', submitted_at: 'x' }, NOW)).toBe(false);
    expect(isOpen({ mode: 'practice' }, NOW)).toBe(true);
    expect(continueList([{ id: 1, set_id: 'a', mode: 'test', started_at: '1', deadline_at: '2026-10-14T11:00:00Z' }], NOW)).toEqual([]);
  });

  test('the first attempt per set and module, and per sitting for a full test', () => {
    const A = (id, set_id, started_at, extra = {}) => ({ id, student_id: 's1', set_id, module: null, sitting: null, started_at, ...extra });
    const list = [
      A(1, 'alg-t1', '2026-10-01', { module: 'm' }),
      A(2, 'alg-t1', '2026-10-02', { module: 'm' }),
      A(3, 'alg-ch1', '2026-10-03'),
      A(4, 'full-01', '2026-10-04', { module: 'rw1', sitting: 'x' }),
      A(5, 'full-01', '2026-10-05', { module: 'rw2', sitting: 'x' }),
      A(6, 'full-01', '2026-10-06', { module: 'rw1', sitting: 'y' }),
      A(7, 'full-01', '2026-10-07', { module: 'm1', sitting: 'y' }),
      { ...A(8, 'alg-t1', '2026-10-08', { module: 'm' }), student_id: 's2' },
    ];
    expect([...firstAttemptIds(list)].sort((a, b) => a - b)).toEqual([1, 3, 4, 5, 8]);
  });
});
