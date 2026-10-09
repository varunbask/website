// The SAT content bundle, built from Matthew's LaTeX books, the College Board
// Question Bank PDFs and our extra folder (repairs, new practice sets, study
// guides). buildBundle() writes OUT/content.json, figures, lessons and
// report.json, and returns { content, report }. convert.mjs is its command line.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, relative, basename, resolve } from 'node:path';
import { DOMAINS, domainByN, domainBySlug, FULL_MODULES, MODULES, ids, slugify, trimSlug, titleCase, cleanName, matchName, nameKey, classifyTopic, qbSkills, pad2 } from './catalog.mjs';
import { fileSets, setItems, setKeys, splitItem, meaningfulRest, testNumber, bookTitle, chapterTitle, lessonPart, fullTestIndex } from './source.mjs';
import { stripComments } from './tex.mjs';
import { LatexConverter, inlineText, isCaption, docText, DOC_VERSION } from './latex-doc.mjs';
import { mcAnswer, sprAnswer, sprKey, enterable, sameNumber, approximates, stripAnswerLead } from './keys.mjs';
import { Figures, figurePreamble, yearTicks } from './figures.mjs';
import { rewriteExplanation, rewriteRuns, titleText, altText } from './dashes.mjs';
import { buildLessons } from './lessons.mjs';
import { scanQuestionBank, questionBankFiles, officialFiles, bookFiles, measure } from './files.mjs';
import { guideFromMarkdown } from './markdown.mjs';
import { loadOverrides } from './overrides.mjs';
import { repeatedWordSuspect } from './checks.mjs';
import { matchTopics, classifyRw } from './classify.mjs';

// opts: { sat, qb, out, extra, plan, figures = true, lessons = true, jobs = 4, dashes = 'all',
//         keepExplanationDashes = false, log }
export async function buildBundle(opts) {
  const SAT = resolve(opts.sat);
  const QB = opts.qb ? resolve(opts.qb) : null;
  const OUT = resolve(opts.out);
  const EXTRA = opts.extra ? resolve(opts.extra) : null;
  const PLAN = opts.plan ? resolve(opts.plan) : null;
  const JOBS = Math.max(1, Number(opts.jobs) || 4);
  const log = opts.log ?? (() => {});
  const args = { figures: opts.figures !== false, lessons: opts.lessons !== false, dashes: opts.dashes ?? 'all', explanationDashes: !opts.keepExplanationDashes };

  mkdirSync(join(OUT, 'lessons'), { recursive: true });
  rmSync(join(OUT, 'figures'), { recursive: true, force: true });
  mkdirSync(join(OUT, 'figures'), { recursive: true });
  const CACHE = join(OUT, '.cache');

  const report = {
    built_at: new Date().toISOString(),
    inputs: { sat: SAT, qb: QB, out: OUT, extra: EXTRA, plan: PLAN, dashes: args.dashes },
    counts: {},
    parse_failures: [],
    figure_failures: [],
    lesson_failures: [],
    unknown_macros: [],
    key_checks: { missing_keys: [], keys_without_item: [], unnumbered_keys: [], duplicate_keys: [], mc_answer_not_a_to_d: [], spr_not_enterable: [], spr_dropped_forms: [], spr_conflicts: [] },
    item_notes: [],
    difficulty_missing: [],
    full_test_classification: { by_domain: {}, by_skill: {}, unclassified: [], reordered_modules: [], rw_by_comment: [] },
    taxonomy: { source: null, notes: [] },
    overrides: { files: 0, entries: 0, applied: 0, repaired: [], recalibrated: 0, unmatched: [], errors: [] },
    repeated_word_suspects: [],
    figure_year_ticks: 0,
    figure_year_tick_figures: [],
    lesson_year_tick_axes: 0,
    dash_changes: 0,
    dashes_kept_in_explanations: 0,
    dash_samples: [],
    caption_dash_changes: 0,
    title_dash_changes: 0,
    guides: { count: 0, errors: [] },
    vp_sets: [],
    notes: [],
  };

  const rel = (p) => relative(SAT, p).split('\\').join('/');
  const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
  const read = (p) => readFileSync(p, 'utf8');

  // ---------- books ----------
  const books = readdirSync(SAT).filter((d) => /^\d\d-/.test(d) && isDir(join(SAT, d))).sort().map((dir) => {
    const n = Number(dir.slice(0, 2));
    const style = existsSync(join(SAT, dir, 'style.tex')) ? read(join(SAT, dir, 'style.tex')) : read(join(SAT, 'style.tex'));
    return {
      n,
      dir,
      path: join(SAT, dir),
      domain: domainByN(n),
      preamble: figurePreamble(style),
      title: existsSync(join(SAT, dir, 'master.tex')) ? bookTitle(read(join(SAT, dir, 'master.tex'))) : null,
    };
  });
  const rootPreamble = figurePreamble(existsSync(join(SAT, 'style.tex')) ? read(join(SAT, 'style.tex')) : books[0].preamble);

  // ---------- skills (taxonomy) ----------
  const qbEntries = scanQuestionBank(QB);
  const qbSkillList = qbSkills(qbEntries.map((e) => ({ domainFolder: e.domainFolder, skillFolder: e.skillFolder })));
  let skills = [];
  let chapterSkill = new Map(); // "05-algebra/01-linear..." -> skill slug
  let plan = null;
  if (PLAN && existsSync(PLAN)) {
    try {
      plan = JSON.parse(read(PLAN));
    } catch (e) {
      report.taxonomy.notes.push(`plan.json could not be read: ${e.message}`);
    }
  }
  const taxonomy = Array.isArray(plan?.taxonomy) ? plan.taxonomy : null;
  if (taxonomy) {
    report.taxonomy.source = 'plan';
    const perDomain = new Map();
    taxonomy.forEach((t, k) => {
      const domain = domainBySlug(t.domain) ?? DOMAINS.find((d) => nameKey(d.name) === nameKey(t.domain ?? ''));
      const name = t.cb_skill ?? t.name ?? t.title ?? t.skill ?? t.slug;
      if (!domain || !name) {
        report.taxonomy.notes.push(`taxonomy entry ${k} has no usable domain or name`);
        return;
      }
      const slug = t.slug ? trimSlug(slugify(t.slug)) : ids.skill(domain.abbr, name);
      // position within the domain, in the taxonomy's order unless it gives one
      perDomain.set(domain.slug, (perDomain.get(domain.slug) ?? 0) + 1);
      skills.push({ slug, domain: domain.slug, name: titleCase(cleanName(name)), position: Number(t.position) || perDomain.get(domain.slug), raw: t });
      for (const dir of t.matthew_chapter_dirs ?? []) {
        const key = String(dir).replace(/^\.?\/*/, '').replace(/\/chapter\.tex$/, '').replace(/\/+$/, '');
        if (!chapterSkill.has(key)) chapterSkill.set(key, slug);
        else report.taxonomy.notes.push(`chapter ${key} is listed under two skills; using ${chapterSkill.get(key)}`);
      }
    });
  } else {
    report.taxonomy.source = 'question-bank folders';
    report.taxonomy.notes.push(PLAN ? `no taxonomy in ${PLAN}; skills come from the Question Bank folders and each chapter is its own skill` : 'no --plan given; skills come from the Question Bank folders and each chapter is its own skill');
    for (const s of qbSkillList) {
      const domain = domainBySlug(s.domain);
      skills.push({ slug: ids.skill(domain.abbr, s.name), domain: s.domain, name: titleCase(s.name), position: s.position });
    }
  }
  const skillBySlug = (slug) => skills.find((s) => s.slug === slug) ?? null;
  const findSkill = (domain, name) => matchName(name, skills.filter((s) => s.domain === domain));

  // The skill of a chapter folder: from the taxonomy, else the chapter itself
  function skillForChapter(book, chapterDir, title, chapterN) {
    const key = `${book.dir}/${chapterDir}`;
    const hit = chapterSkill.get(key) ?? chapterSkill.get(chapterDir);
    if (hit && skillBySlug(hit)) return hit;
    const slug = ids.skill(book.domain.abbr, chapterDir.replace(/^\d+-/, ''));
    if (!skillBySlug(slug)) {
      skills.push({ slug, domain: book.domain.slug, name: plainTitle(title) ?? titleCase(chapterDir.replace(/^\d+-/, '').replace(/-/g, ' ')), position: 100 + chapterN, chapter: true });
      report.taxonomy.notes.push(`chapter ${key} is not in the taxonomy; it is its own skill (${slug})`);
    }
    return slug;
  }

  function plainTitle(tex) {
    if (!tex) return null;
    return inlineText(new LatexConverter({ dashes: 'all' }).inlines(tex)).trim();
  }

  // ---------- overrides ----------
  const overrides = loadOverrides(EXTRA ? join(EXTRA, 'overrides') : null, report.overrides);

  // ---------- conversion state ----------
  const sets = [];
  const items = [];
  const keys = [];
  const unknownAll = new Map(); // macro -> { count, items: Set }
  const figures = new Figures({ outDir: OUT, cacheDir: join(CACHE, 'figures'), jobs: JOBS, log });
  const allFigureImgs = [];
  const dashPool = [];

  function noteUnknown(map, itemId) {
    for (const [name, count] of map) {
      const entry = unknownAll.get(name) ?? { count: 0, items: new Set() };
      entry.count += count;
      entry.items.add(itemId);
      unknownAll.set(name, entry);
    }
  }

  // Passage-side blocks of a Reading and Writing question: everything up to the
  // last passage, table, figure or caption, when there is a passage and a question after it
  function splitPassage(blocks, section) {
    if (section !== 'rw') return { passage: null, stem: blocks };
    let last = -1;
    blocks.forEach((b, k) => {
      if (b.t === 'passage' || b.t === 'img' || b.t === 'table' || isCaption(b)) last = k;
    });
    const lead = blocks.slice(0, last + 1);
    const stem = blocks.slice(last + 1);
    if (last < 0 || !lead.some((b) => b.t === 'passage') || !stem.length) return { passage: null, stem: blocks };
    return { passage: lead, stem };
  }

  const doc = (blocks) => ({ v: DOC_VERSION, blocks });

  // One question and its key -> item and key rows (or a parse failure)
  function convertItem(q) {
    const { set, module, n, tex, keyTex, domain, section, skill, preamble, source, multi } = q;
    const id = ids.item(set.id, n, set.kind === 'full_test' ? module : null);
    const where = { file: source.file, set: source.set, q: n };
    const fail = (reason) => report.parse_failures.push({ ...where, item: id, reason });
    const ov = overrides.take(source.file, source.set, n, { multi });
    let itemTex = tex;
    let keyBody = keyTex;
    let repaired = false;
    let diffOverride = null;
    for (const o of ov) {
      if (typeof o.item_tex === 'string') {
        itemTex = stripComments(o.item_tex).replace(/^\s*\\item(?![a-zA-Z])/, '');
        repaired = true;
      }
      if (typeof o.key_tex === 'string') {
        keyBody = stripComments(o.key_tex);
        repaired = true;
      }
      if (o.difficulty) diffOverride = String(o.difficulty).toLowerCase();
    }
    if (repaired) report.overrides.repaired.push(id);
    if (diffOverride) report.overrides.recalibrated++;

    const split = splitItem(itemTex);
    const unknown = new Map();
    let figN = 0;
    const imgs = [];
    const conv = new LatexConverter({
      unknown,
      dashes: args.dashes,
      figure: (sourceTex, img) => {
        if (!args.figures) return false;
        figN++;
        const figId = figN === 1 ? id : `${id}-${figN}`;
        // years on an axis print without the thousands comma
        const fixed = yearTicks(sourceTex);
        if (fixed.touched) {
          report.figure_year_ticks++;
          report.figure_year_tick_figures.push(figId);
        }
        figures.add({ id: figId, source: fixed.source, preamble, where: { ...where, item: id }, img });
        imgs.push(img);
        return true;
      },
    });
    let difficulty = diffOverride ?? split.difficulty;
    if (difficulty && !['easy', 'medium', 'hard'].includes(difficulty)) {
      report.item_notes.push({ ...where, item: id, note: `unknown difficulty "${difficulty}"` });
      difficulty = null;
    }
    if (!difficulty) report.difficulty_missing.push({ ...where, item: id });

    let stemBlocks = conv.blocks(split.stem);
    if (split.rest && meaningfulRest(split.rest)) {
      stemBlocks = [...stemBlocks, ...conv.blocks(split.rest)];
      report.item_notes.push({ ...where, item: id, note: 'text after the choices was kept at the end of the stem' });
    }
    const parts = splitPassage(stemBlocks, section);
  // figure captions and alt text follow the explanations' dash rule
  const captions = (blocks) => {
    for (const b of blocks) {
      if (isCaption(b) && args.explanationDashes) {
        const r = rewriteRuns(b.c, { italic: true });
        b.c = r.c;
        report.caption_dash_changes += r.changed;
      } else if (b.t === 'img' && args.explanationDashes) b.alt = altText(b.alt);
      else if (b.t === 'passage') captions(b.blocks);
    }
  };
  captions(stemBlocks);
    const choices = split.choices ? split.choices.map((c) => doc(conv.blocks(c))) : null;
    const kind = choices ? 'mc' : 'spr';
    if (choices && split.spr) report.item_notes.push({ ...where, item: id, note: 'marked student-produced response but has choices; kept as multiple choice' });
    if (!choices && !split.spr) report.item_notes.push({ ...where, item: id, note: 'no choices and no student-produced response mark; kept as a grid-in' });
    if (choices && choices.some((c) => !c.blocks.length)) report.item_notes.push({ ...where, item: id, note: 'an empty answer choice' });
    if (!parts.stem.length && !parts.passage) {
      fail('empty question');
      return;
    }

    if (keyBody === undefined || keyBody === null) {
      fail('no key in the answer key');
      report.key_checks.missing_keys.push({ ...where, item: id });
      return;
    }
    let answer;
    let accept = [];
    if (kind === 'mc') {
      answer = mcAnswer(keyBody);
      if (!answer) {
        fail('the key gives no letter A to D');
        report.key_checks.mc_answer_not_a_to_d.push({ ...where, item: id, start: keyBody.trim().slice(0, 80) });
        return;
      }
    } else {
      const found = sprAnswer(keyBody);
      if (!found) {
        fail('the key gives no grid-in value');
        return;
      }
      const k = sprKey(found.values);
      answer = k.answer;
      accept = k.accept;
      if (k.dropped.length) report.key_checks.spr_dropped_forms.push({ ...where, item: id, answer, dropped: k.dropped, reason: 'a shortened decimal must fill the grid-in box' });
      if (!enterable(answer) && !accept.some(enterable)) report.key_checks.spr_not_enterable.push({ ...where, item: id, answer });
      if (found.how === 'label' && found.grids?.length) {
        const g = found.grids[0][0];
        if (g && !sameNumber(g, found.values[0]) && !approximates(g, found.values[0]) && !k.accept.includes(g)) {
          report.key_checks.spr_conflicts.push({ ...where, item: id, label: found.values[0], grid: g });
        }
      }
    }
    // the answer label the explanation opens with repeats the portal's verdict line
    let explanation = doc(conv.blocks(stripAnswerLead(keyBody, kind === 'spr' ? { answer, accept } : {})));
    // no em or en dashes in explanations (passages, stems and choices keep theirs)
    if (args.explanationDashes) {
      const r = rewriteExplanation(explanation);
      explanation = r.doc;
      report.dash_changes += r.changed;
      report.dashes_kept_in_explanations += r.kept;
      for (const sample of r.samples) dashPool.push({ item: id, ...sample });
    }
    noteUnknown(unknown, id);
    allFigureImgs.push(...imgs.map((img) => ({ img, item: id })));

    const item = {
      id,
      set: set.id,
      module: module ?? null,
      position: n,
      domain,
      skill: skill ?? null,
      difficulty,
      kind,
      passage: parts.passage ? doc(parts.passage) : null,
      stem: doc(parts.stem),
      choices,
      source: { ...source, q: n, ...(repaired ? { repaired: true } : {}) },
    };
    items.push(item);
    keys.push({ item: id, answer, accept, explanation });

    if (kind === 'mc') {
      const suspect = repeatedWordSuspect(item);
      if (suspect) report.repeated_word_suspects.push({ ...where, item: id, ...suspect });
    }
  }

  // One question set (an mcq list and its key) -> items
  function convertSet({ set, rawSet, module, domainFor, section, skill, preamble, source, multi = false, rematch = false }) {
    const list = setItems(rawSet.mcq);
    const { keys: keyMap, odd, dup } = setKeys(rawSet.solutions);
    if (!rawSet.solutions) report.parse_failures.push({ file: source.file, set: source.set, q: null, reason: 'no answer key (solutions) after this question list' });
    for (const label of odd) report.key_checks.unnumbered_keys.push({ file: source.file, set: source.set, label });
    for (const q of dup) report.key_checks.duplicate_keys.push({ file: source.file, set: source.set, q });
    for (const q of keyMap.keys()) if (q > list.length || q < 1) report.key_checks.keys_without_item.push({ file: source.file, set: source.set, q });
    // topic comments that no longer sit by their questions are matched to them by content
    let topics = rawSet.topics;
    if (rematch && topics.size) {
      const m = matchTopics(list.map((it) => ({ q: it.q, text: `${it.tex}\n${(keyMap.get(it.q) ?? '').slice(0, 800)}`, spr: !splitItem(it.tex).choices })), topics, { topicDomain: (t) => classifyTopic(t, section)?.domain ?? null });
      topics = m.topics;
      if (m.reordered) report.full_test_classification.reordered_modules.push({ set: set.id, module, weak: m.weak.map((q) => ids.item(set.id, q, module)) });
    }
    for (const it of list) {
      const topic = topics.get(it.q) ?? null;
      const d = domainFor(it, topic);
      convertItem({
        set, module, n: it.q, tex: it.tex, keyTex: keyMap.get(it.q), domain: d.domain, section,
        skill: d.skill === undefined ? skill : d.skill, preamble, multi,
        source: { ...source, ...(topic ? { topic } : {}) },
      });
    }
    return list.length;
  }

  // The plain question, passage and choices of a Reading and Writing item (for classifyRw)
  function rwParts(tex) {
    const split = splitItem(tex);
    const conv = new LatexConverter({ dashes: 'all' });
    const parts = splitPassage(conv.blocks(split.stem), 'rw');
    return {
      stem: docText({ blocks: parts.stem }),
      passage: parts.passage ? docText({ blocks: parts.passage }) : '',
      choices: (split.choices ?? []).map((c) => docText({ blocks: conv.blocks(c) }).trim()),
    };
  }

  // ---------- domain books: chapters and skill tests ----------
  const lessonJobs = [];
  for (const book of books.filter((b) => b.n >= 1 && b.n <= 8)) {
    const { domain } = book;
    const section = domain.section;
    const chapterDirs = readdirSync(book.path).filter((d) => /^\d\d-/.test(d) && existsSync(join(book.path, d, 'chapter.tex'))).sort();
    for (const chapterDir of chapterDirs) {
      const chapterN = Number(chapterDir.slice(0, 2));
      const file = join(book.path, chapterDir, 'chapter.tex');
      const raw = read(file);
      const title = chapterTitle(raw);
      const skill = skillForChapter(book, chapterDir, title, chapterN);
      const setId = ids.practice(domain.abbr, chapterN);
      const found = fileSets(raw);
      if (found.length !== 1) report.notes.push(`${rel(file)} holds ${found.length} question lists (expected 1)`);
      const set = { id: setId, kind: 'practice', domain: domain.slug, skill, title: plainTitle(title) ?? setId, position: chapterN, modules: [], origin: 'matthew', labels: found.map((f) => f.label) };
      sets.push(set);
      found.forEach((rawSet, k) => {
        // a second list in one chapter would need its own set; none of the books has one
        if (k > 0) {
          report.parse_failures.push({ file: rel(file), set: rawSet.label, q: null, reason: 'a second practice list in one chapter was not converted' });
          return;
        }
        convertSet({ set, rawSet, module: null, domainFor: () => ({ domain: domain.slug }), section, skill, preamble: book.preamble, multi: found.length > 1, source: { origin: 'matthew', file: rel(file), set: rawSet.label ?? 'Practice Set' } });
      });
      lessonJobs.push(lessonJob(book, chapterDir, chapterN, raw, setId, skill, title));
    }

    // skill tests: every file in practice-tests holding question lists
    const testDir = join(book.path, 'practice-tests');
    const testFiles = isDir(testDir) ? readdirSync(testDir).filter((f) => f.endsWith('.tex')).sort() : [];
    const tests = [];
    for (const f of testFiles) {
      const raw = read(join(testDir, f));
      const inFile = fileSets(raw);
      inFile.forEach((rawSet, k) => tests.push({ file: join(testDir, f), multi: inFile.length > 1, rawSet, n: testNumber(rawSet.label) ?? testNumber(f.replace(/[-_]/g, ' ').replace(/exam/i, 'Test')) ?? k + 1 }));
    }
    tests.sort((a, b) => a.n - b.n);
    const moduleKey = section === 'rw' ? 'rw' : 'm';
    const seen = new Set();
    for (const t of tests) {
      if (seen.has(t.n)) {
        report.parse_failures.push({ file: rel(t.file), set: t.rawSet.label, q: null, reason: `a second "Test ${t.n}" in this book was not converted` });
        continue;
      }
      seen.add(t.n);
      const set = {
        id: ids.skillTest(domain.abbr, t.n), kind: 'skill_test', domain: domain.slug, skill: null,
        title: `${domain.name} Test ${t.n}`, position: t.n,
        modules: [{ key: moduleKey, title: domain.name, minutes: MODULES[section].minutes }], origin: 'matthew', labels: [t.rawSet.label],
      };
      sets.push(set);
      const count = convertSet({
        set, rawSet: t.rawSet, module: moduleKey, section, skill: null, preamble: book.preamble, multi: t.multi,
        domainFor: (it, topic) => {
          const c = (section === 'rw' ? classifyRw(rwParts(it.tex)) : null) ?? (topic ? classifyTopic(topic, section) : null);
          const found = c && c.domain === domain.slug ? findSkill(domain.slug, c.skillName) : null;
          return { domain: domain.slug, skill: found?.slug ?? null };
        },
        source: { origin: 'matthew', file: rel(t.file), set: t.rawSet.label ?? `Practice Test ${t.n}` },
      });
      if (count !== MODULES[section].count) report.notes.push(`${set.id} has ${count} questions (a ${section === 'rw' ? 'Reading and Writing' : 'Math'} module has ${MODULES[section].count})`);
    }
  }

  function lessonJob(book, chapterDir, chapterN, raw, setId, skill, title) {
    const overrideFile = EXTRA ? join(EXTRA, 'lesson-overrides', `${book.dir}__${chapterDir}.tex`) : null;
    const useOverride = overrideFile && existsSync(overrideFile);
    if (useOverride) report.notes.push(`lesson ${setId} built from ${basename(overrideFile)}`);
    // year axes in the lesson's graphs lose the thousands comma too
    const years = yearTicks(useOverride ? lessonPart(read(overrideFile)) : lessonPart(raw));
    report.lesson_year_tick_axes += years.touched;
    return {
      id: setId,
      bookDir: book.path,
      title: book.title,
      chapter: chapterN,
      body: years.source,
      out: join(OUT, 'lessons', `${setId}.pdf`),
      file: {
        id: `lesson-${setId}`,
        collection: 'lesson',
        domain: book.domain?.slug ?? null,
        skill,
        difficulty: null,
        title: plainTitle(title) ?? setId,
        path: `lessons/${setId}.pdf`,
        staff_only: false,
        position: book.n * 100 + chapterN,
        ...(useOverride ? { repaired: true } : {}),
      },
    };
  }

  // ---------- the cumulative book: review chapters and full tests ----------
  const master = books.find((b) => b.n === 9);
  if (master) {
    const chapterDirs = readdirSync(master.path).filter((d) => /^\d\d-/.test(d) && existsSync(join(master.path, d, 'chapter.tex'))).sort();
    for (const chapterDir of chapterDirs) {
      const chapterN = Number(chapterDir.slice(0, 2));
      const raw = read(join(master.path, chapterDir, 'chapter.tex'));
      const title = chapterTitle(raw);
      const job = lessonJob(master, chapterDir, chapterN, raw, `sat-ch${chapterN}`, null, title);
      job.file.domain = null;
      lessonJobs.push(job);
    }
    const testDir = join(master.path, 'practice-tests');
    const exams = readdirSync(testDir).filter((f) => /^exam-\d+\.tex$/.test(f)).sort();
    for (const f of exams) {
      const n = Number(/\d+/.exec(f)[0]);
      const index = fullTestIndex(read(join(testDir, f)));
      const set = { id: ids.fullTest(n), kind: 'full_test', domain: null, skill: null, title: `Full Practice Test ${n}`, position: n, modules: FULL_MODULES.map(({ key, title, minutes }) => ({ key, title, minutes })), origin: 'matthew', labels: [index.title] };
      sets.push(set);
      for (const mod of FULL_MODULES) {
        const modFile = join(testDir, `exam-${pad2(n)}-${mod.key}.tex`);
        if (!existsSync(modFile)) {
          report.parse_failures.push({ file: rel(modFile), set: index.title, q: null, reason: `module ${mod.key} file is missing` });
          continue;
        }
        const raw = read(modFile);
        const found = fileSets(raw);
        if (found.length !== 1) report.notes.push(`${rel(modFile)} holds ${found.length} question lists (expected 1)`);
        const banner = index.modules.find((m) => m.file && m.file.endsWith(`-${mod.key}.tex`))?.label ?? null;
        const count = found.length ? convertSet({
          set, rawSet: found[0], module: mod.key, section: mod.section, skill: null, preamble: master.preamble, rematch: mod.section === 'math',
          domainFor: (it, topic) => classifyFull(it, topic, mod.section, `${set.id}-${mod.key}-${pad2(it.q)}`),
          source: { origin: 'matthew', file: rel(modFile), set: index.title ?? `Practice Test ${n}`, ...(banner ? { module_label: banner } : {}) },
        }) : 0;
        const expected = mod.section === 'rw' ? 27 : 22;
        if (count !== expected) report.notes.push(`${set.id} ${mod.key} has ${count} questions (expected ${expected})`);
      }
    }
  }

  // A full-test question's domain and skill: Reading and Writing from the
  // question's wording, Math from its topic comment (a question with neither
  // is put in the section's first domain and reported)
  function classifyFull(it, topic, section, itemId) {
    const fc = report.full_test_classification;
    let c = section === 'rw' ? classifyRw(rwParts(it.tex)) : null;
    if (!c && topic) {
      c = classifyTopic(topic, section);
      if (c && section === 'rw') fc.rw_by_comment.push({ item: itemId, topic });
    }
    if (!c) {
      const fallback = section === 'rw' ? 'information-and-ideas' : 'algebra';
      fc.unclassified.push({ item: itemId, topic, domain: fallback });
      fc.by_domain[fallback] = (fc.by_domain[fallback] ?? 0) + 1;
      return { domain: fallback, skill: null };
    }
    fc.by_domain[c.domain] = (fc.by_domain[c.domain] ?? 0) + 1;
    const found = findSkill(c.domain, c.skillName);
    fc.by_skill[found?.slug ?? c.skillName] = (fc.by_skill[found?.slug ?? c.skillName] ?? 0) + 1;
    return { domain: c.domain, skill: found?.slug ?? null };
  }

  // ---------- extra: new practice sets ----------
  if (EXTRA && isDir(join(EXTRA, 'new'))) {
    for (const domainDir of readdirSync(join(EXTRA, 'new')).sort()) {
      const dir = join(EXTRA, 'new', domainDir);
      if (!isDir(dir)) continue;
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.tex')).sort()) {
        const file = join(dir, f);
        const relFile = `new/${domainDir}/${f}`;
        const raw = read(file);
        const meta = {};
        for (const m of raw.matchAll(/^%\s*SET\s+([a-z_]+)\s*=\s*(.*?)\s*$/gim)) meta[m[1].toLowerCase()] = m[2];
        const domain = domainBySlug(meta.domain ?? domainDir);
        const setId = meta.id ? trimSlug(slugify(meta.id)) : trimSlug(`vp-${slugify(basename(f, '.tex'))}`);
        if (!domain) {
          report.parse_failures.push({ file: relFile, set: meta.title ?? null, q: null, reason: 'unknown domain in %SET domain=' });
          continue;
        }
        let skill = meta.skill ? trimSlug(slugify(meta.skill)) : null;
        if (skill && !skillBySlug(skill)) {
          const byName = findSkill(domain.slug, meta.skill.replace(/-/g, ' '));
          if (byName) skill = byName.slug;
          else report.notes.push(`${relFile}: skill "${meta.skill}" is not in the skill list`);
        }
        const found = fileSets(raw);
        if (found.length !== 1) report.notes.push(`${relFile} holds ${found.length} question lists (expected 1)`);
        if (sets.some((s) => s.id === setId)) {
          report.parse_failures.push({ file: relFile, set: meta.title ?? setId, q: null, reason: `set id ${setId} is already used` });
          continue;
        }
        const set = { id: setId, kind: 'practice', domain: domain.slug, skill, title: meta.title ?? setId, position: Number(meta.position) || 0, modules: [], origin: 'vp', labels: [] };
        sets.push(set);
        const before = items.length;
        if (found[0]) convertSet({ set, rawSet: found[0], module: null, section: domain.section, skill, preamble: books.find((b) => b.n === domain.n)?.preamble ?? rootPreamble, domainFor: () => ({ domain: domain.slug }), source: { origin: 'vp', file: relFile, set: set.title } });
        report.vp_sets.push({ id: setId, file: relFile, items: items.length - before });
      }
    }
  }

  // ---------- figures ----------
  if (args.figures) {
    const result = await figures.run();
    report.figure_failures = result.failed;
    const failedIds = new Set(result.failed.map((f) => f.id));
    // a picture that could not be drawn leaves its question without it: hold-worthy, so report it
    const dropFailed = (blocks) => blocks.filter((b) => !(b.t === 'img' && failedIds.has(b.src.replace(/^figures\/|\.png$/g, '')))).map((b) => (b.t === 'passage' ? { ...b, blocks: dropFailed(b.blocks) } : b));
    if (failedIds.size) {
      for (const it of items) {
        for (const part of ['passage', 'stem']) if (it[part]) it[part].blocks = dropFailed(it[part].blocks);
        if (it.choices) for (const c of it.choices) c.blocks = dropFailed(c.blocks);
      }
      for (const k of keys) k.explanation.blocks = dropFailed(k.explanation.blocks);
    }
  }

  // ---------- lessons ----------
  let lessonFiles = [];
  if (args.lessons) {
    const result = await buildLessons(lessonJobs, { cacheDir: join(CACHE, 'lessons'), workers: Math.max(1, Math.min(JOBS, 4)), log });
    report.lesson_failures = result.failed;
    const missing = new Set(result.failed.filter((f) => !f.partial).map((f) => f.id));
    lessonFiles = lessonJobs.filter((j) => !missing.has(j.id) && existsSync(j.out)).map((j) => ({ ...j.file, local: j.out }));
  } else {
    lessonFiles = lessonJobs.filter((j) => existsSync(j.out)).map((j) => ({ ...j.file, local: j.out }));
    if (lessonFiles.length) report.notes.push('--no-lessons: lesson PDFs from an earlier build were reused');
  }

  // ---------- files ----------
  const skillForQb = (e) => {
    const dn = /^\s*(\d+)/.exec(e.domainFolder);
    const domain = dn ? domainByN(dn[1]) : null;
    if (!domain) return null;
    const folderOf = (t) => t.qb_folder ?? t.qb_dir ?? null;
    const tax = taxonomy?.find((t) => folderOf(t) && cleanName(String(folderOf(t)).split('/').pop()) === cleanName(e.skillFolder));
    if (tax) return skills.find((s) => s.raw === tax) ?? null;
    return findSkill(domain.slug, cleanName(e.skillFolder));
  };
  const files = [...questionBankFiles(qbEntries, skillForQb), ...officialFiles(SAT), ...bookFiles(SAT), ...lessonFiles];
  for (const f of files) {
    if (f.collection === 'question_bank' && !f.skill) report.notes.push(`Question Bank file ${f.title} matched no skill`);
    if (f.collection === 'question_bank' && !f.difficulty) report.notes.push(`Question Bank file ${f.local} has no difficulty in its name`);
  }
  await measure(files);
  const fileIds = new Set();
  for (const f of files) {
    if (fileIds.has(f.id)) report.parse_failures.push({ file: f.local, set: null, q: null, reason: `file id ${f.id} is used twice` });
    fileIds.add(f.id);
  }

  // ---------- guides ----------
  const guides = [];
  if (EXTRA && isDir(join(EXTRA, 'guides'))) {
    for (const f of readdirSync(join(EXTRA, 'guides')).filter((x) => x.endsWith('.md')).sort()) {
      try {
        const { meta, body } = guideFromMarkdown(read(join(EXTRA, 'guides', f)));
        const skill = meta.skill ? String(meta.skill) : basename(f, '.md');
        const domain = domainBySlug(meta.domain) ?? (skillBySlug(skill) ? domainBySlug(skillBySlug(skill).domain) : null);
        if (!domain) throw new Error('no known domain');
        if (!skillBySlug(skill)) report.guides.errors.push({ file: f, error: `skill ${skill} is not in the skill list` });
        guides.push({ skill, domain: domain.slug, title: meta.title ?? skillBySlug(skill)?.name ?? skill, position: Number(meta.position) || 0, body });
      } catch (e) {
        report.guides.errors.push({ file: f, error: e.message });
      }
    }
  }
  report.guides.count = guides.length;

  // ---------- checks ----------
  const itemIds = new Set();
  for (const it of items) {
    if (itemIds.has(it.id)) report.parse_failures.push({ file: it.source.file, set: it.source.set, q: it.source.q, reason: `item id ${it.id} is used twice` });
    itemIds.add(it.id);
    if (!/^[a-z0-9-]{1,60}$/.test(it.id)) report.parse_failures.push({ file: it.source.file, set: it.source.set, q: it.source.q, reason: `item id ${it.id} is not a valid id` });
  }
  const keyCount = new Map();
  for (const k of keys) keyCount.set(k.item, (keyCount.get(k.item) ?? 0) + 1);
  const keyProblems = items.filter((it) => keyCount.get(it.id) !== 1).map((it) => it.id);
  if (keyProblems.length) report.notes.push(`items without exactly one key: ${keyProblems.join(', ')}`);
  const mcBad = keys.filter((k) => items.find((it) => it.id === k.item)?.kind === 'mc' && !/^[A-D]$/.test(k.answer));
  if (mcBad.length) report.notes.push(`multiple-choice keys that are not A to D: ${mcBad.map((k) => k.item).join(', ')}`);
  for (const s of sets) {
    if (!/^[a-z0-9-]{1,60}$/.test(s.id)) report.parse_failures.push({ file: null, set: s.id, q: null, reason: 'set id is not a valid id' });
    delete s.labels;
  }
  const unusedOverrides = overrides.unused();
  report.overrides.unmatched = unusedOverrides;
  report.overrides.applied = report.overrides.entries - unusedOverrides.length;
  // 25 dash rewrites for review, picked the same way every build
  report.dash_samples = pick(dashPool, 25, 2552);
  report.unknown_macros = [...unknownAll.entries()].sort((a, b) => b[1].count - a[1].count)
    .map(([macro, v]) => ({ macro, count: v.count, items: v.items.size, examples: [...v.items].slice(0, 8) }));

  // no em or en dashes in titles and names either
  const retitle = (obj, key) => {
    const next = titleText(obj[key]);
    if (next !== obj[key]) report.title_dash_changes++;
    obj[key] = next;
  };
  if (args.explanationDashes) {
    for (const x of sets) retitle(x, 'title');
    for (const x of skills) retitle(x, 'name');
    for (const x of files) retitle(x, 'title');
    for (const x of guides) retitle(x, 'title');
  }

  // ---------- counts ----------
  const counts = { items: { total: items.length, by_domain: {}, by_kind: { mc: 0, spr: 0 }, by_set_kind: {}, by_origin: {} }, sets: {}, figures: 0, lessons: lessonFiles.length, files: {}, guides: guides.length, skills: skills.length, keys: keys.length };
  const setKind = new Map(sets.map((s) => [s.id, s]));
  for (const it of items) {
    const d = (counts.items.by_domain[it.domain] ??= { mc: 0, spr: 0, total: 0, practice: 0, skill_test: 0, full_test: 0 });
    d[it.kind]++;
    d.total++;
    const s = setKind.get(it.set);
    d[s.kind]++;
    counts.items.by_kind[it.kind]++;
    counts.items.by_set_kind[s.kind] = (counts.items.by_set_kind[s.kind] ?? 0) + 1;
    counts.items.by_origin[s.origin] = (counts.items.by_origin[s.origin] ?? 0) + 1;
  }
  for (const s of sets) counts.sets[s.kind] = (counts.sets[s.kind] ?? 0) + 1;
  counts.figures = existsSync(join(OUT, 'figures')) ? readdirSync(join(OUT, 'figures')).filter((f) => f.endsWith('.png')).length : 0;
  for (const f of files) counts.files[f.collection] = (counts.files[f.collection] ?? 0) + 1;
  counts.file_bytes = files.reduce((n, f) => n + (f.bytes ?? 0), 0);
  report.counts = counts;

  // ---------- write ----------
  const content = {
    version: 1,
    built_at: report.built_at,
    skills: skills.map(({ slug, domain, name, position }) => ({ slug, domain, name, position })),
    sets,
    items,
    keys,
    files: files.map(({ repaired, ...f }) => f),
    guides,
  };
  writeFileSync(join(OUT, 'content.json'), JSON.stringify(content));
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  return { content, report };

}

// n items from a list, picked by a seeded shuffle (the same each build)
function pick(list, n, seed) {
  let x = seed >>> 0;
  const rand = () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copy = [...list];
  for (let k = copy.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [copy[k], copy[j]] = [copy[j], copy[k]];
  }
  return copy.slice(0, n);
}

// A short printed summary of a build
export function printSummary({ report, content }, log = console.log) {
  const counts = report.counts;
  const OUT = report.inputs.out;
  const line = (label, value) => log(`  ${label.padEnd(26)} ${value}`);
  log('\nSAT bundle');
  line('out', OUT);
  line('items', `${counts.items.total} (mc ${counts.items.by_kind.mc}, spr ${counts.items.by_kind.spr}); keys ${counts.keys}`);
  for (const d of DOMAINS) {
    const c = counts.items.by_domain[d.slug];
    if (c) line(`  ${d.slug}`, `${c.total} (mc ${c.mc}, spr ${c.spr}; practice ${c.practice}, skill tests ${c.skill_test}, full tests ${c.full_test})`);
  }
  line('sets', Object.entries(counts.sets).map(([k, v]) => `${k} ${v}`).join(', '));
  line('skills', `${content.skills.length} (${report.taxonomy.source})`);
  line('figures', `${counts.figures} drawn, ${report.figure_failures.length} failed`);
  line('lessons', `${counts.lessons} built, ${report.lesson_failures.length} with problems`);
  line('files', Object.entries(counts.files).map(([k, v]) => `${k} ${v}`).join(', ') + ` (${(counts.file_bytes / 1e6).toFixed(1)} MB)`);
  line('guides', `${content.guides.length}${report.guides.errors.length ? `, ${report.guides.errors.length} with problems` : ''}`);
  line('overrides', `${report.overrides.applied} applied (${report.overrides.repaired.length} repaired, ${report.overrides.recalibrated} recalibrated), ${report.overrides.unmatched.length} unmatched`);
  line('parse failures', report.parse_failures.length);
  for (const f of report.parse_failures.slice(0, 20)) log(`    ${f.file} | ${f.set} | Q${f.q}: ${f.reason}`);
  line('unknown macros', report.unknown_macros.length ? report.unknown_macros.map((u) => `${u.macro} x${u.count}`).join(', ') : 'none');
  line('difficulty missing', report.difficulty_missing.length);
  line('spr notes', `${report.key_checks.spr_dropped_forms.length} dropped forms, ${report.key_checks.spr_conflicts.length} conflicts, ${report.key_checks.spr_not_enterable.length} not enterable`);
  line('repeated-word suspects', report.repeated_word_suspects.length);
  line('explanation dashes', `${report.dash_changes} rewritten, ${report.dashes_kept_in_explanations} kept (quotes, italics, sentences about dashes)`);
  line('year axes', `${report.figure_year_ticks} figures and ${report.lesson_year_tick_axes} lesson graphs without the thousands comma on year ticks`);
  line('full-test domains', Object.entries(report.full_test_classification.by_domain).map(([k, v]) => `${k} ${v}`).join(', '));
  line('report', join(OUT, 'report.json'));
}
