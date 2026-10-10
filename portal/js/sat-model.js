// Pure SAT model (no DOM, no network): the eight domains and two sections,
// module timing, grid-in scoring (the mirror of private.sat_spr_correct in the
// SAT migration), progress and score maths, the timer's words, and the
// #/sat routes. The views (views/sat*.js) draw what this works out.
//
// Routes (views/sat.js):
//   #/sat                          home: Learn, Problem solving, Practice, Tests, progress
//   #/sat/learn[/<skill>]          study guide, lesson and check-your-understanding set per skill
//   #/sat/problems[?skill=]        the official Question Bank PDFs, by domain and skill
//   #/sat/practice[/<set id>][?skill=]   the generated sets, or the practice runner
//   #/sat/tests                    skill tests and full tests
//   #/sat/test/<set id>[?module=&sitting=]   the timed runner
//   #/sat/review/<attempt id>[?show=wrong|flagged]
//   #/sat/library                  old link: goes to #/sat

import { relativeTime } from './dates.js';

export const SECTIONS = Object.freeze([
  Object.freeze({ key: 'rw', name: 'Reading and Writing', short: 'Reading and Writing' }),
  Object.freeze({ key: 'math', name: 'Math', short: 'Math' }),
]);

export const DOMAINS = Object.freeze([
  ['information-and-ideas', 'Information and Ideas', 'rw'],
  ['craft-and-structure', 'Craft and Structure', 'rw'],
  ['expression-of-ideas', 'Expression of Ideas', 'rw'],
  ['standard-english-conventions', 'Standard English Conventions', 'rw'],
  ['algebra', 'Algebra', 'math'],
  ['advanced-math', 'Advanced Math', 'math'],
  ['problem-solving-and-data-analysis', 'Problem-Solving and Data Analysis', 'math'],
  ['geometry-and-trigonometry', 'Geometry and Trigonometry', 'math'],
].map(([slug, name, section]) => Object.freeze({ slug, name, section })));

const DOMAIN_BY_SLUG = new Map(DOMAINS.map((d) => [d.slug, d]));

// One module of each section on the digital SAT
export const MODULE_TIMING = Object.freeze({
  rw: Object.freeze({ questions: 27, minutes: 32 }),
  math: Object.freeze({ questions: 22, minutes: 35 }),
});
export const FULL_MODULES = Object.freeze(['rw1', 'rw2', 'm1', 'm2']);
export const BREAK_MINUTES = 10;
// The module after which a full test offers its break
export const BREAK_AFTER = 'rw2';
export const LETTERS = Object.freeze(['A', 'B', 'C', 'D']);
export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);
export const DIFFICULTY_LABELS = Object.freeze({ easy: 'Easy', medium: 'Medium', hard: 'Hard' });
// The answer box holds 5 characters, 6 with a minus sign
export const SPR_MAX = 5;
export const SPR_MAX_NEGATIVE = 6;
// The server takes answers until 30 seconds past the deadline
export const GRACE_MS = 30_000;
export const WARN_MS = 5 * 60_000;

export const domainOf = (slug) => DOMAIN_BY_SLUG.get(slug) ?? null;
export const domainName = (slug) => domainOf(slug)?.name ?? '';
export const sectionOf = (domainSlug) => domainOf(domainSlug)?.section ?? null;
export const sectionName = (key) => SECTIONS.find((s) => s.key === key)?.name ?? '';
export const domainsOf = (section) => DOMAINS.filter((d) => d.section === section);

// A module key's section: rw1 and rw2 are Reading and Writing, m1 and m2 Math;
// anything else (a skill test's one module) follows the set's domain
export function moduleSection(key, set = null) {
  if (/^rw/i.test(String(key ?? ''))) return 'rw';
  if (/^m\d/i.test(String(key ?? ''))) return 'math';
  return sectionOf(set?.domain) ?? null;
}

// Practice sets are named by what they are for, never by who made them.
// origin only groups them: 'matthew' sets are a lesson's chapter questions
// (Check your understanding), 'vp' sets are the generated hard and mixed sets.
export const CHECK_PREFIX = 'Check your understanding';
export const isHardSet = (set) => /^hard-/.test(String(set?.id ?? ''));
export const isGeneratedSet = (set) => set?.kind === 'practice' && set?.origin === 'vp';
export const isCheckSet = (set) => set?.kind === 'practice' && set?.origin !== 'vp';

// What a practice set is for: 'Hard set', 'Practice set' or 'Check your understanding'
export function setPurpose(set) {
  if (isCheckSet(set)) return CHECK_PREFIX;
  return isHardSet(set) ? 'Hard set' : 'Practice set';
}

// The title a student sees, worked out from the data so stored titles do not matter:
//   check sets      "Check your understanding: <skill>" (+ the lesson's title when the skill has two)
//   generated sets  "<skill>: hard set" or "<skill>: practice set"
// Anything else (tests) keeps its own title.
export function setTitle(set, skill, siblings = []) {
  if (!set || set.kind !== 'practice') return set?.title ?? '';
  const lesson = String(set.title ?? '').replace(new RegExp(`^${CHECK_PREFIX}:\\s*`, 'i'), '');
  if (isCheckSet(set)) {
    if (!skill) return `${CHECK_PREFIX}: ${lesson}`;
    const twin = siblings.filter((s) => isCheckSet(s) && s.skill === set.skill).length > 1;
    return twin && lesson && lesson !== skill.name ? `${CHECK_PREFIX}: ${skill.name}, ${lesson}` : `${CHECK_PREFIX}: ${skill.name}`;
  }
  const name = skill?.name ?? String(set.title ?? '').replace(/:\s*(hard|practice) set$/i, '');
  return `${name}: ${isHardSet(set) ? 'hard set' : 'practice set'}`;
}

// The sets with their student-facing titles (a copy; ids and origin are kept)
export function titledSets(sets, skillsBySlug) {
  return (sets ?? []).map((set) => (set.kind === 'practice'
    ? { ...set, title: setTitle(set, skillsBySlug?.get?.(set.skill) ?? null, sets) }
    : set));
}

// An old generated set id (vp-<skill>) is now practice-<skill>
export const currentSetId = (id) => String(id ?? '').replace(/^vp-/, 'practice-');

// ---------------------------------------------------------------------------
// Grid-in answers (student-produced responses)

// The entry as typed, cleaned: trimmed, spaces and a leading + dropped
export function sprClean(text) {
  return String(text ?? '').replace(/\s/g, '').replace(/^\+/, '');
}

// The value of an entry: an integer, a decimal (".5" is 0.5) or a fraction
// a/b with b not 0; null for anything else. No length limit (answer keys).
export function sprValue(text) {
  const s = sprClean(text);
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);
  const m = s.match(/^(-?\d+)\/(\d+)$/);
  if (!m || Number(m[2]) === 0) return null;
  return Number(m[1]) / Number(m[2]);
}

// The longest entry the box takes for what is typed so far
export const sprLimit = (text) => (sprClean(text).startsWith('-') ? SPR_MAX_NEGATIVE : SPR_MAX);

// A complete entry a student could make: a valid form within the length limit
export function sprValid(text) {
  const s = sprClean(text);
  return s.length > 0 && s.length <= sprLimit(s) && sprValue(s) !== null;
}

// What the box keeps while typing: digits, one point, one slash, a leading
// minus, cut to the limit
export function sprInput(text) {
  // a minus sign or a dash typed (or pasted) for "-" counts as one
  let s = String(text ?? '').replace(/[\u2212\u2012\u2013\u2014]/g, '-').replace(/[^0-9./-]/g, '');
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '');
  const firstPoint = s.indexOf('.');
  if (firstPoint !== -1) s = s.slice(0, firstPoint + 1) + s.slice(firstPoint + 1).replace(/\./g, '');
  const firstSlash = s.indexOf('/');
  if (firstSlash !== -1) s = s.slice(0, firstSlash + 1) + s.slice(firstSlash + 1).replace(/\//g, '');
  s = (negative ? '-' : '') + s;
  return s.slice(0, negative ? SPR_MAX_NEGATIVE : SPR_MAX);
}

// An entry as an exact fraction { num, den } (BigInt), or null when it is not
// an integer, a decimal or a fraction a/b with b not 0 ("3.50" is 350/100)
export function sprParts(text) {
  const s = sprClean(text);
  const d = s.match(/^(-?)(\d*)\.?(\d*)$/);
  if (d && /^-?(\d+\.?\d*|\.\d+)$/.test(s)) {
    return { num: BigInt(`${d[1]}${d[2] || '0'}${d[3]}`), den: 10n ** BigInt(d[3].length) };
  }
  const m = s.match(/^(-?\d+)\/(\d+)$/);
  if (!m || BigInt(m[2]) === 0n) return null;
  return { num: BigInt(m[1]), den: BigInt(m[2]) };
}

const sameValue = (a, b) => a.num * b.den === b.num * a.den;
const absBig = (n) => (n < 0n ? -n : n);
// Within one unit of the entry's last decimal place of x, without equalling it
const rounds = (entry, places, x) => absBig(entry.num * x.den - x.num * entry.den) * 10n ** BigInt(places) < absBig(entry.den * x.den);

// The forms a grid-in answer is checked against (mirrors private.sat_spr_correct):
//   exact   the answer, every fraction or whole number in accept, and every
//           decimal in accept that equals one of those or is no rounding of
//           one (a second root): matched by value
//   approx  decimals in accept that round or cut off an exact answer:
//           matched character for character
export function sprForms(answer, accept = []) {
  const entries = (Array.isArray(accept) ? accept : []).map((a) => String(a));
  const exact = [];
  const approx = [];
  const first = sprParts(answer);
  if (first) exact.push(first);
  for (const e of entries) {
    const p = sprParts(e);
    if (p && !sprClean(e).includes('.')) exact.push(p);
  }
  for (const e of entries) {
    const c = sprClean(e);
    const p = sprParts(e);
    if (!p || !c.includes('.')) continue;
    const places = c.split('.')[1].length;
    if (exact.some((x) => sameValue(p, x))) continue;
    if (exact.some((x) => rounds(p, places, x))) approx.push(c);
    else exact.push(p);
  }
  return { exact, approx };
}

// Correct when the entry is valid and within the limit, and it equals an
// exact answer (6/4 = 3/2, 3.50 = 7/2) or is exactly one of the listed
// approximations: for 8/17, ".4706" counts and ".47" does not, though it is
// the value of "0.470", because a repeating decimal must fill the box.
export function sprCorrect(response, answer, accept = []) {
  const s = sprClean(response);
  const r = sprParts(s);
  if (!r || s.length > sprLimit(s)) return false;
  const { exact, approx } = sprForms(answer, accept);
  return exact.some((x) => sameValue(r, x)) || approx.includes(s);
}

export const mcValid = (text) => LETTERS.includes(String(text ?? '').trim().toUpperCase());

// One answer, either kind (mirrors private.sat_is_correct)
export function isCorrect(kind, response, answer, accept = []) {
  if (response === null || response === undefined || String(response).trim() === '' || answer === null || answer === undefined) return false;
  if (kind === 'mc') return String(response).trim().toUpperCase() === String(answer).trim().toUpperCase();
  return sprCorrect(response, answer, accept);
}

// An answer the admin may release an item with: A to D, or a grid-in entry
export function validAnswer(kind, text) {
  return kind === 'mc' ? mcValid(text) : sprValid(text);
}

// "3.5 (also accepted: 7/2)" for a grid-in answer; the letter for a choice
export function answerText(kind, answer, accept = []) {
  if (answer === null || answer === undefined || answer === '') return '';
  if (kind === 'mc') return String(answer).toUpperCase();
  const others = (Array.isArray(accept) ? accept : []).filter((a) => String(a) !== String(answer));
  return others.length ? `${answer} (also accepted: ${others.join(', ')})` : String(answer);
}

// ---------------------------------------------------------------------------
// Timer

// "31:05", or "1:02:03" past an hour; never negative
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// The countdown read out: "31 minutes, 5 seconds left"
export function clockWords(ms) {
  const total = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const parts = [];
  if (m) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
  if (s || !m) parts.push(`${s} ${s === 1 ? 'second' : 'seconds'}`);
  return `${parts.join(', ')} left`;
}

// Milliseconds left until a deadline on the server's clock. skew is the
// server's time minus this device's (from sat_start's server_now).
export function remainingMs(deadline, now = Date.now(), skew = 0) {
  const end = Date.parse(deadline);
  if (!Number.isFinite(end)) return null;
  return end - (Number(now) + Number(skew || 0));
}

// 'warning' (amber) in the last five minutes
export const timerTone = (ms) => (ms !== null && ms <= WARN_MS ? 'warning' : 'normal');

// The words to announce when the countdown crosses 5 minutes or 1 minute
// between two readings, else null
export function timerAnnouncement(before, after) {
  for (const [mark, text] of [[60_000, '1 minute left.'], [WARN_MS, '5 minutes left.']]) {
    if (before > mark && after <= mark) return text;
  }
  return null;
}

// "32 min" of a module, or "1 h 10 min"
export function minutesText(minutes) {
  const n = Math.max(0, Math.round(Number(minutes) || 0));
  if (n < 60) return `${n} min`;
  return n % 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${n / 60} h`;
}

// How long an attempt took: "18 min", "under a minute", or null while open
export function timeUsed(attempt) {
  const start = Date.parse(attempt?.started_at);
  const end = Date.parse(attempt?.submitted_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const minutes = Math.round((end - start) / 60_000);
  return minutes < 1 ? 'under a minute' : minutesText(minutes);
}

// ---------------------------------------------------------------------------
// Routes

export const SAT_SUBS = Object.freeze(['learn', 'problems', 'practice', 'tests', 'test', 'review', 'library']);
// The subs whose third segment is an id
export const SAT_ID_SUBS = Object.freeze(['learn', 'practice', 'test', 'review']);
export const REVIEW_FILTERS = Object.freeze(['all', 'wrong', 'flagged']);

// What a #/sat route shows: { page, id, module, sitting, skill, show }
//   page: home | learn | skill | problems | practice | practice-run | tests | test-run | review | library
//   (library is gone: the view sends it home)
export function satPage(route) {
  const sub = route?.sub ?? null;
  const id = route?.id ? String(route.id) : null;
  const p = route?.params ?? {};
  const base = { page: 'home', id: null, module: null, sitting: null, skill: p.skill ? String(p.skill) : null, show: 'all' };
  switch (sub) {
    case 'learn': return { ...base, page: id ? 'skill' : 'learn', id };
    case 'practice': return { ...base, page: id ? 'practice-run' : 'practice', id };
    case 'tests': return { ...base, page: 'tests' };
    case 'test': return id ? { ...base, page: 'test-run', id, module: p.module || null, sitting: p.sitting || null } : { ...base, page: 'tests' };
    case 'review': return id ? { ...base, page: 'review', id, show: REVIEW_FILTERS.includes(p.show) ? p.show : 'all' } : { ...base, page: 'tests' };
    case 'problems': return { ...base, page: 'problems' };
    case 'library': return { ...base, page: 'library' };
    default: return base;
  }
}

const SUB_LABELS = { learn: 'Learn', problems: 'Problem solving', practice: 'Practice', tests: 'Tests', test: 'Tests', review: 'Review' };

// The view title before the data is in (the views set the set's own title)
export function satTitle(route) {
  const page = satPage(route).page;
  if (page === 'home') return 'SAT';
  if (page === 'test-run') return 'SAT test';
  if (page === 'practice-run') return 'SAT practice';
  if (page === 'skill') return 'SAT skill';
  if (page === 'review') return 'SAT review';
  return `SAT ${SUB_LABELS[route?.sub]?.toLowerCase() ?? ''}`.trim();
}

// Breadcrumbs without the student's name (app-model adds it for staff)
export function satCrumbs(route, { title = null } = {}) {
  const sub = route?.sub ?? null;
  if (!sub || !SUB_LABELS[sub]) return [{ label: 'SAT' }];
  const parent = sub === 'test' || sub === 'review' ? 'tests' : sub;
  const crumbs = [{ label: 'SAT', href: '#/sat' }, { label: SUB_LABELS[parent], href: `#/sat/${parent}` }];
  if (route?.id) crumbs.push({ label: title || SUB_LABELS[sub] });
  return crumbs;
}

export const practiceHref = (setId) => `#/sat/practice/${encodeURIComponent(setId)}`;
export const learnHref = (skill) => `#/sat/learn/${encodeURIComponent(skill)}`;
export const problemsHref = (skill = null) => `#/sat/problems${skill ? `?skill=${encodeURIComponent(skill)}` : ''}`;
export const practiceListHref = (skill = null) => `#/sat/practice${skill ? `?skill=${encodeURIComponent(skill)}` : ''}`;
export const reviewHref = (attemptId, show = null) => `#/sat/review/${encodeURIComponent(attemptId)}${show && show !== 'all' ? `?show=${show}` : ''}`;
export function testHref(setId, { module = null, sitting = null } = {}) {
  const params = new URLSearchParams();
  if (module) params.set('module', module);
  if (sitting) params.set('sitting', sitting);
  const q = params.toString();
  return `#/sat/test/${encodeURIComponent(setId)}${q ? `?${q}` : ''}`;
}

// ---------------------------------------------------------------------------
// The catalog: sets, skills, items (an index of light columns) and files

const byPosition = (a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.id ?? a.slug).localeCompare(String(b.id ?? b.slug));

// Per set: { easy, medium, hard, total, held, byModule: { key: n } } of the
// items a student can answer (held ones counted apart)
export function setCounts(items) {
  const out = new Map();
  for (const it of items ?? []) {
    if (!out.has(it.set_id)) out.set(it.set_id, { easy: 0, medium: 0, hard: 0, total: 0, held: 0, byModule: {} });
    const c = out.get(it.set_id);
    if (it.held) {
      c.held += 1;
      continue;
    }
    c.total += 1;
    if (DIFFICULTIES.includes(it.difficulty)) c[it.difficulty] += 1;
    const key = it.module ?? '';
    c.byModule[key] = (c.byModule[key] ?? 0) + 1;
  }
  return out;
}

// "Easy 4, Medium 6, Hard 3" (only the levels it has)
export function countsText(c) {
  if (!c) return '';
  return DIFFICULTIES.filter((d) => c[d]).map((d) => `${DIFFICULTY_LABELS[d]} ${c[d]}`).join(', ');
}

// A skill's chapter questions ("Check your understanding"), by position
export function checkSetsFor(sets, skill) {
  return (sets ?? []).filter((s) => isCheckSet(s) && s.skill === skill).sort(byPosition);
}

// A retired generated set (its old vp-<skill> id, kept only because a student
// has an attempt on it): never listed, but its attempts and reviews still open
export const isRetiredSet = (set) => /^vp-/.test(String(set?.id ?? ''));

// A skill's generated sets: the hard set first, then the practice set
export function generatedSetsFor(sets, skill) {
  return (sets ?? [])
    .filter((s) => isGeneratedSet(s) && !isRetiredSet(s) && s.skill === skill)
    .sort((a, b) => (isHardSet(a) ? 0 : 1) - (isHardSet(b) ? 0 : 1) || byPosition(a, b));
}

// The skills of each domain, in order: [{ domain, skills: [skill] }] for all eight
export function skillsByDomain(skills) {
  return DOMAINS.map((domain) => ({
    domain,
    skills: (skills ?? []).filter((s) => s.domain === domain.slug).sort(byPosition),
  }));
}

// Skill tests by domain, then the full tests: { byDomain: [{ domain, sets }], full: [set] }
export function testGroups(sets) {
  const tests = (sets ?? []).filter((s) => s.kind === 'skill_test');
  return {
    byDomain: DOMAINS.map((domain) => ({ domain, sets: tests.filter((s) => s.domain === domain.slug).sort(byPosition) }))
      .filter((g) => g.sets.length),
    full: (sets ?? []).filter((s) => s.kind === 'full_test').sort(byPosition),
  };
}

// The modules of a test set, with a fallback for a skill test listed without
// any: [{ key, title, minutes }]
export function modulesOf(set) {
  const list = Array.isArray(set?.modules) ? set.modules.filter((m) => m && m.key) : [];
  if (list.length) return list.map((m) => ({ key: String(m.key), title: m.title || set.title, minutes: Number(m.minutes) || MODULE_TIMING[moduleSection(m.key, set) ?? 'math'].minutes }));
  if (set?.kind === 'skill_test') {
    const section = sectionOf(set.domain) ?? 'math';
    return [{ key: null, title: set.title, minutes: MODULE_TIMING[section].minutes }];
  }
  return [];
}

// The module after `key` in a full test, or null after the last
export function nextModule(set, key) {
  const mods = modulesOf(set);
  const at = mods.findIndex((m) => m.key === key);
  return at === -1 || at === mods.length - 1 ? null : mods[at + 1];
}

// Does a skill's name or slug match a file's skill (files may carry either)?
const squash = (v) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function fileSkillMatches(file, skill) {
  if (!file?.skill || !skill) return false;
  const f = squash(file.skill);
  return f === squash(skill.slug) || f === squash(skill.name);
}

// The official Question Bank keeps some skills in one folder: Command of
// Evidence (textual and quantitative) has one set of PDFs, filed under
// evidence-textual. A skill listed here also shows the files of the skill it
// names, and those files carry a label that says they cover both.
export const SHARED_BANK = Object.freeze({ 'evidence-quantitative': 'evidence-textual' });
export const SHARED_BANK_LABELS = Object.freeze({ 'evidence-textual': 'Command of Evidence (textual and quantitative)' });

// The skill whose Question Bank files a skill shows, and their label (null
// when the files are the skill's own)
export function bankSkill(skill) {
  const shared = SHARED_BANK[skill?.slug] ?? null;
  const slug = shared ?? skill?.slug ?? null;
  return { slug, shared: Boolean(shared), label: SHARED_BANK_LABELS[slug] ?? null };
}

// The files that are not lessons, grouped for their pages. The Question Bank
// is grouped by domain, then skill, each skill with its Easy, Medium and Hard files.
//   bank     [{ domain, skills: [{ skill, label, levels: { easy, medium, hard } }] }]
//   official [file]  (the official practice tests; they live under Tests)
//   staff    [file]  (printable tests and answer keys; staff only)
export function fileGroups(files, skills) {
  const list = [...(files ?? [])].sort(byPosition);
  const skillsOf = (domain) => (skills ?? []).filter((s) => s.domain === domain.slug).sort(byPosition);

  const bank = DOMAINS.map((domain) => {
    const domainSkills = skillsOf(domain);
    const mine = list.filter((f) => f.collection === 'question_bank' && f.domain === domain.slug);
    const groups = new Map();
    for (const f of mine) {
      const skill = domainSkills.find((s) => fileSkillMatches(f, s)) ?? null;
      const key = skill ? skill.slug : squash(f.skill || f.title);
      if (!groups.has(key)) groups.set(key, { skill, label: SHARED_BANK_LABELS[skill?.slug] ?? skill?.name ?? f.skill ?? f.title, levels: {}, position: skill ? skill.position : 1e6 });
      const g = groups.get(key);
      const level = DIFFICULTIES.includes(f.difficulty) ? f.difficulty : 'other';
      if (!g.levels[level]) g.levels[level] = f;
    }
    return { domain, skills: [...groups.values()].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label)) };
  }).filter((g) => g.skills.length);

  return {
    bank,
    official: list.filter((f) => f.collection === 'official_test'),
    staff: list.filter((f) => f.collection === 'test_pdf' || f.collection === 'answer_key'),
  };
}

// The files of one skill page: its lesson PDFs and Question Bank levels
// (shared with another skill when SHARED_BANK says so, then with bankLabel)
export function skillFiles(files, skill, sets = []) {
  const setIds = new Set((sets ?? []).filter((s) => s.skill === skill?.slug).map((s) => s.id));
  const list = [...(files ?? [])].sort(byPosition);
  const lessons = list.filter((f) => f.collection === 'lesson'
    && (fileSkillMatches(f, skill) || [...setIds].some((id) => f.storage_path === `lessons/${id}.pdf`)));
  const from = bankSkill(skill);
  const owner = from.shared ? { slug: from.slug, name: '' } : skill;
  const bank = {};
  for (const f of list) {
    if (f.collection !== 'question_bank' || !(fileSkillMatches(f, owner) || fileSkillMatches(f, skill))) continue;
    const level = DIFFICULTIES.includes(f.difficulty) ? f.difficulty : 'other';
    bank[level] ??= f;
  }
  return { lessons, bank, bankLabel: Object.keys(bank).length ? from.label : null };
}

// ---------------------------------------------------------------------------
// Progress

// Percent, rounded, or null with nothing answered
export const pct = (correct, answered) => (answered > 0 ? Math.round((100 * correct) / answered) : null);

const blankStat = () => ({ answered: 0, correct: 0, last: null });
function add(stat, r) {
  stat.answered += 1;
  if (r.correct) stat.correct += 1;
  if (r.answered_at && (!stat.last || r.answered_at > stat.last)) stat.last = r.answered_at;
}

// Questions answered and right, per section, domain and skill, from the
// student's responses and the item index (id -> { domain, skill }). Only
// scored answers count: a test module still running has none yet.
//   -> { all, sections: { rw, math }, domains: { slug: stat }, skills: { slug: stat } }
//   stat: { answered, correct, last }
export function progressFrom(responses, itemIndex) {
  const out = { all: blankStat(), sections: { rw: blankStat(), math: blankStat() }, domains: {}, skills: {} };
  for (const d of DOMAINS) out.domains[d.slug] = blankStat();
  for (const r of responses ?? []) {
    if (r.response === null || r.response === undefined || r.correct === null || r.correct === undefined) continue;
    const item = itemIndex?.get?.(r.item_id) ?? null;
    if (!item) continue;
    add(out.all, r);
    const section = sectionOf(item.domain);
    if (section) add(out.sections[section], r);
    if (out.domains[item.domain]) add(out.domains[item.domain], r);
    if (item.skill) add(out.skills[item.skill] ??= blankStat(), r);
  }
  return out;
}

// Answered and right per attempt: Map attempt id -> { answered, correct }
export function attemptCounts(responses) {
  const out = new Map();
  for (const r of responses ?? []) {
    if (r.response === null || r.response === undefined) continue;
    const c = out.get(r.attempt_id) ?? { answered: 0, correct: 0 };
    c.answered += 1;
    if (r.correct) c.correct += 1;
    out.set(r.attempt_id, c);
  }
  return out;
}

// A practice run in words: "12 of 18, 9 correct"
export function practiceLine(counts, total) {
  const answered = counts?.answered ?? 0;
  const correct = counts?.correct ?? 0;
  return `${answered} of ${total}, ${correct} correct`;
}

// "15 of 22 (68%)"
export function scoreText(correct, total) {
  if (correct === null || correct === undefined || !total) return '';
  return `${correct} of ${total} (${pct(correct, total)}%)`;
}

// A test's attempts, newest first: { best, last, attempts } (submitted only)
export function bestAndLast(attempts) {
  const done = (attempts ?? []).filter((a) => a.submitted_at && a.total).sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
  let best = null;
  for (const a of done) if (!best || a.correct / a.total > best.correct / best.total) best = a;
  return { best, last: done[0] ?? null, attempts: done };
}

// Is an attempt still going? A practice run until it is finished; a test
// module until 30 seconds past its deadline (the server then submits it, so
// an abandoned test reads as taken)
export function isOpen(attempt, now = Date.now()) {
  if (!attempt || attempt.submitted_at) return false;
  if (attempt.mode !== 'test' || !attempt.deadline_at) return true;
  return Date.parse(attempt.deadline_at) + GRACE_MS >= Number(now instanceof Date ? now.getTime() : now);
}

// The unfinished runs and modules, newest first, one per set (the newest)
export function continueList(attempts, now = Date.now()) {
  const seen = new Set();
  const out = [];
  for (const a of [...(attempts ?? [])].sort((x, y) => String(y.started_at).localeCompare(String(x.started_at)))) {
    if (!isOpen(a, now) || seen.has(a.set_id)) continue;
    seen.add(a.set_id);
    out.push(a);
  }
  return out;
}

// Full test sittings: Map sitting -> { sitting, set_id, modules: { key: attempt }, started_at, done }
export function sittings(attempts, set) {
  const out = new Map();
  const keys = modulesOf(set).map((m) => m.key);
  for (const a of attempts ?? []) {
    if (a.set_id !== set?.id || !a.sitting) continue;
    if (!out.has(a.sitting)) out.set(a.sitting, { sitting: a.sitting, set_id: a.set_id, modules: {}, started_at: a.started_at });
    const s = out.get(a.sitting);
    s.modules[a.module] = a;
    if (String(a.started_at) < String(s.started_at)) s.started_at = a.started_at;
  }
  for (const s of out.values()) s.done = keys.length > 0 && keys.every((k) => s.modules[k]?.submitted_at);
  return out;
}

// The module a sitting is up to: { key, attempt } (an open one, or the next
// to start), or null when every module is submitted
export function sittingNext(sitting, set) {
  for (const m of modulesOf(set)) {
    const a = sitting?.modules?.[m.key];
    if (!a || !a.submitted_at) return { key: m.key, attempt: a ?? null };
  }
  return null;
}

// A full test's raw scores from its submitted modules:
//   { sections: { rw: { correct, total }, math: { correct, total } }, correct, total }
export function fullScore(sitting, set) {
  const sections = { rw: { correct: 0, total: 0 }, math: { correct: 0, total: 0 } };
  for (const m of modulesOf(set)) {
    const a = sitting?.modules?.[m.key];
    if (!a?.submitted_at) continue;
    const s = sections[moduleSection(m.key, set) ?? 'math'];
    s.correct += a.correct ?? 0;
    s.total += a.total ?? 0;
  }
  return { sections, correct: sections.rw.correct + sections.math.correct, total: sections.rw.total + sections.math.total };
}

// Per domain from review items and the item index: [{ domain, correct, total }]
export function domainBreakdown(reviewItems, itemIndex) {
  const out = new Map();
  for (const r of reviewItems ?? []) {
    const domain = itemIndex?.get?.(r.item)?.domain;
    if (!domain) continue;
    const c = out.get(domain) ?? { correct: 0, total: 0 };
    c.total += 1;
    if (r.correct) c.correct += 1;
    out.set(domain, c);
  }
  return DOMAINS.filter((d) => out.has(d.slug)).map((d) => ({ domain: d, ...out.get(d.slug) }));
}

// The review list for a filter: all, wrong (answered wrong or left blank) or flagged
export function filterReview(items, show = 'all') {
  const list = items ?? [];
  if (show === 'wrong') return list.filter((r) => r.correct === false);
  if (show === 'flagged') return list.filter((r) => r.flagged);
  return list;
}

// The navigator's state for one question: 'answered' | 'unanswered', plus flagged
export function questionState(answer) {
  return { answered: Boolean(answer?.response), flagged: Boolean(answer?.flagged) };
}

// How many of the questions have no answer
export function unansweredCount(ids, answers) {
  return (ids ?? []).filter((id) => !answers?.get?.(id)?.response).length;
}

// The confirm before submitting a module
export function submitConfirmText(unanswered) {
  if (!unanswered) return 'Every question has an answer. You cannot change your answers after you submit.';
  return `${unanswered} ${unanswered === 1 ? 'question has' : 'questions have'} no answer and will count as wrong. You cannot change your answers after you submit.`;
}

// An attempt's name: the set's title, with the module for a full test
export function attemptLabel(attempt, set) {
  if (!set) return 'SAT set';
  const mod = attempt?.module ? modulesOf(set).find((m) => m.key === attempt.module) : null;
  return set.kind === 'full_test' && mod ? `${set.title}, ${mod.title}` : set.title;
}

// An attempt's result in words: "15 of 22 (68%)" once submitted; a practice
// run still going says how far it got
export function attemptResult(attempt, counts = null, total = 0) {
  if (attempt?.submitted_at) return scoreText(attempt.correct ?? 0, attempt.total ?? 0) || 'No questions';
  if (attempt?.mode === 'practice') return `In progress, ${practiceLine(counts, total)}`;
  return 'In progress';
}

// When something last happened, after "last": "just now", "5 minutes ago", "on Oct 5"
export function lastText(iso, now = new Date()) {
  if (!iso) return '';
  const t = relativeTime(iso, now).text;
  if (t === 'Just now' || t === 'Yesterday') return t.toLowerCase();
  return /ago$/.test(t) ? t : `on ${t}`;
}

// Each student's first attempt at a set (per module for a skill test, per
// sitting for a full test: its first sitting's modules): the one taken before
// they could have seen any answers. -> Set of attempt ids
export function firstAttemptIds(attempts) {
  const firstSitting = new Map();   // set id -> the sitting started first
  const first = new Map();          // student|set|module -> attempt
  const byStart = [...(attempts ?? [])].sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)) || a.id - b.id);
  for (const a of byStart) {
    if (a.sitting) {
      const k = `${a.student_id}|${a.set_id}`;
      if (!firstSitting.has(k)) firstSitting.set(k, a.sitting);
      if (firstSitting.get(k) !== a.sitting) continue;
    }
    const key = `${a.student_id}|${a.set_id}|${a.module ?? ''}`;
    if (!first.has(key)) first.set(key, a);
  }
  return new Set([...first.values()].map((a) => a.id));
}
