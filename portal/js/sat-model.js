// Pure SAT model (no DOM, no network): the eight domains and two sections,
// module timing, grid-in scoring (the mirror of private.sat_spr_correct in the
// SAT migration), progress and score maths, the timer's words, and the
// #/sat routes. The views (views/sat*.js) draw what this works out.
//
// Routes (views/sat.js):
//   #/sat                          home: Learn, Practice, Tests, Library, progress
//   #/sat/learn[/<skill>]          study guides, one per official skill
//   #/sat/practice[/<set id>]      the practice sets, or the practice runner
//   #/sat/tests                    skill tests and full tests
//   #/sat/test/<set id>[?module=&sitting=]   the timed runner
//   #/sat/review/<attempt id>[?show=wrong|flagged]
//   #/sat/library[?tab=lessons|bank|official|staff]

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

// Practice sets: our own Skill Builder sets, or the practice in the guides
export function originLabel(origin) {
  return origin === 'vp' ? 'Skill Builder' : 'Guide practice';
}

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
  let s = String(text ?? '').replace(/[^0-9./-]/g, '');
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '');
  const firstPoint = s.indexOf('.');
  if (firstPoint !== -1) s = s.slice(0, firstPoint + 1) + s.slice(firstPoint + 1).replace(/\./g, '');
  const firstSlash = s.indexOf('/');
  if (firstSlash !== -1) s = s.slice(0, firstSlash + 1) + s.slice(firstSlash + 1).replace(/\//g, '');
  s = (negative ? '-' : '') + s;
  return s.slice(0, negative ? SPR_MAX_NEGATIVE : SPR_MAX);
}

// Correct when the entry is valid and within the limit, and its value is the
// answer's or an accepted form's (within 1e-9). A rounded or cut-off decimal
// of a repeating value counts only when it is listed in accept.
export function sprCorrect(response, answer, accept = []) {
  const s = sprClean(response);
  const v = sprValue(s);
  if (v === null || s.length > sprLimit(s)) return false;
  const targets = [answer, ...(Array.isArray(accept) ? accept : [])];
  return targets.some((t) => {
    const tv = sprValue(t);
    return tv !== null && Math.abs(v - tv) <= 1e-9;
  });
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

export const SAT_SUBS = Object.freeze(['learn', 'practice', 'tests', 'test', 'review', 'library']);
// The subs whose third segment is an id
export const SAT_ID_SUBS = Object.freeze(['learn', 'practice', 'test', 'review']);
export const LIBRARY_TABS = Object.freeze(['lessons', 'bank', 'official', 'staff']);
export const REVIEW_FILTERS = Object.freeze(['all', 'wrong', 'flagged']);

// What a #/sat route shows: { page, id, module, sitting, tab, show }
//   page: home | learn | skill | practice | practice-run | tests | test-run | review | library
export function satPage(route) {
  const sub = route?.sub ?? null;
  const id = route?.id ? String(route.id) : null;
  const p = route?.params ?? {};
  const base = { page: 'home', id: null, module: null, sitting: null, tab: null, show: 'all' };
  switch (sub) {
    case 'learn': return { ...base, page: id ? 'skill' : 'learn', id };
    case 'practice': return { ...base, page: id ? 'practice-run' : 'practice', id };
    case 'tests': return { ...base, page: 'tests' };
    case 'test': return id ? { ...base, page: 'test-run', id, module: p.module || null, sitting: p.sitting || null } : { ...base, page: 'tests' };
    case 'review': return id ? { ...base, page: 'review', id, show: REVIEW_FILTERS.includes(p.show) ? p.show : 'all' } : { ...base, page: 'tests' };
    case 'library': return { ...base, page: 'library', tab: LIBRARY_TABS.includes(p.tab) ? p.tab : 'lessons' };
    default: return base;
  }
}

const SUB_LABELS = { learn: 'Learn', practice: 'Practice', tests: 'Tests', test: 'Tests', review: 'Review', library: 'Library' };

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

// Practice sets of a skill: Skill Builder first, then by position
export function practiceSetsFor(sets, skill) {
  return (sets ?? [])
    .filter((s) => s.kind === 'practice' && s.skill === skill)
    .sort((a, b) => (a.origin === 'vp' ? 0 : 1) - (b.origin === 'vp' ? 0 : 1) || byPosition(a, b));
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

// The library tabs. Lessons and the Question Bank are grouped by domain, then
// skill; the Question Bank gives each skill its Easy, Medium and Hard files.
//   lessons  [{ domain, skills: [{ skill, files }] , other: [file] }]
//   bank     [{ domain, skills: [{ skill, label, levels: { easy, medium, hard } }] }]
//   official [file]
//   staff    [file] (test PDFs and answer keys; staff only)
export function libraryGroups(files, skills, sets = []) {
  const list = [...(files ?? [])].sort(byPosition);
  const skillsOf = (domain) => (skills ?? []).filter((s) => s.domain === domain.slug).sort(byPosition);
  const lessonSkill = (file, domainSkills) => domainSkills.find((s) => fileSkillMatches(file, s)
    || sets.some((set) => set.skill === s.slug && file.storage_path === `lessons/${set.id}.pdf`)) ?? null;

  const lessons = DOMAINS.map((domain) => {
    const domainSkills = skillsOf(domain);
    const mine = list.filter((f) => f.collection === 'lesson' && f.domain === domain.slug);
    const rows = domainSkills.map((skill) => ({ skill, files: mine.filter((f) => lessonSkill(f, domainSkills) === skill) }))
      .filter((r) => r.files.length);
    const other = mine.filter((f) => !lessonSkill(f, domainSkills));
    return { domain, skills: rows, other };
  }).filter((g) => g.skills.length || g.other.length);

  const bank = DOMAINS.map((domain) => {
    const domainSkills = skillsOf(domain);
    const mine = list.filter((f) => f.collection === 'question_bank' && f.domain === domain.slug);
    const groups = new Map();
    for (const f of mine) {
      const skill = domainSkills.find((s) => fileSkillMatches(f, s)) ?? null;
      const key = skill ? skill.slug : squash(f.skill || f.title);
      if (!groups.has(key)) groups.set(key, { skill, label: skill?.name ?? f.skill ?? f.title, levels: {}, position: skill ? skill.position : 1e6 });
      const g = groups.get(key);
      const level = DIFFICULTIES.includes(f.difficulty) ? f.difficulty : 'other';
      if (!g.levels[level]) g.levels[level] = f;
    }
    return { domain, skills: [...groups.values()].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label)) };
  }).filter((g) => g.skills.length);

  return {
    lessons,
    bank,
    official: list.filter((f) => f.collection === 'official_test'),
    staff: list.filter((f) => f.collection === 'test_pdf' || f.collection === 'answer_key'),
  };
}

// The files of one skill page: its lesson PDFs and Question Bank levels
export function skillFiles(files, skill, sets = []) {
  const setIds = new Set((sets ?? []).filter((s) => s.skill === skill?.slug).map((s) => s.id));
  const list = [...(files ?? [])].sort(byPosition);
  const lessons = list.filter((f) => f.collection === 'lesson'
    && (fileSkillMatches(f, skill) || [...setIds].some((id) => f.storage_path === `lessons/${id}.pdf`)));
  const bank = {};
  for (const f of list) {
    if (f.collection !== 'question_bank' || !fileSkillMatches(f, skill)) continue;
    const level = DIFFICULTIES.includes(f.difficulty) ? f.difficulty : 'other';
    bank[level] ??= f;
  }
  return { lessons, bank };
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

// Is an unsubmitted attempt still worth continuing? A practice run always
// is; a test module until its deadline (a later one is picked up and
// submitted when opened)
export function isOpen(attempt) {
  return Boolean(attempt) && !attempt.submitted_at;
}

// The unfinished runs and modules, newest first, one per set (the newest)
export function continueList(attempts) {
  const seen = new Set();
  const out = [];
  for (const a of [...(attempts ?? [])].sort((x, y) => String(y.started_at).localeCompare(String(x.started_at)))) {
    if (!isOpen(a) || seen.has(a.set_id)) continue;
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
