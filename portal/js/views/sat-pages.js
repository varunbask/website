// The SAT browsing pages (views/sat.js routes here). Each section is for one purpose:
//   learnIndex   #/sat/learn           the eight domains, each skill with a progress meter
//   skillPage    #/sat/learn/<skill>   the study guide, the lesson, Check your understanding,
//                                      then on to Solve official questions and Practice
//   problems     #/sat/problems[?skill=]  the official Question Bank PDFs, by domain and skill
//   practiceList #/sat/practice[?skill=]  the generated sets: hard set, then practice set, per skill
//   testsList    #/sat/tests           skill tests, full tests, and the official practice tests (PDF)
//   teacherFiles                       staff-only card for the home page
// Progress is the student on screen's (the student themself, or the one staff
// chose). Staff who open a set or a test try it as themselves (a preview).

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { button, emptyState, skeletonRows } from '../ui.js';
import { firstName, displayName } from '../format.js';
import { shortDay } from '../dates.js';
import {
  SECTIONS, DOMAINS, domainOf, sectionName, skillsByDomain, checkSetsFor, generatedSetsFor, testGroups, modulesOf, fileGroups, skillFiles,
  progressFrom, attemptCounts, practiceLine, countsText, setPurpose, isHardSet, bankSkill, problemsHref, practiceListHref, pct, bestAndLast, sittings, sittingNext, fullScore,
  scoreText, minutesText, practiceHref, testHref, reviewHref, learnHref, satCrumbs, DIFFICULTIES, DIFFICULTY_LABELS,
  isOpen, firstAttemptIds, satPage,
} from '../sat-model.js';
import { getContent, getAttempts, getResponses, getGuide } from '../sat-data.js';
import { satDoc } from '../sat-doc.js';
import { isStaff, meter, accuracyText, pdfButton, typeset, figure, loadError } from '../sat-ui.js';

// Content and the on-screen student's progress, or null after an error (shown)
async function load(ctx, body, what) {
  const sid = ctx.scope.student.id;
  try {
    const [content, attempts, responses] = await Promise.all([getContent(), getAttempts(sid), getResponses(sid)]);
    return { content, attempts, responses, progress: progressFrom(responses, content.index), counts: attemptCounts(responses) };
  } catch (error) {
    if (!ctx.alive()) return null;
    console.error(error);
    loadError(ctx, body, `We couldn’t load ${what}.`);
    ctx.announce(`${what}, could not load`);
    return null;
  }
}

function frame(ctx, opts) {
  ctx.setHeader(opts);
  const body = h('div', { class: 'sat-view' }, skeletonRows(4));
  ctx.host.append(body);
  return body;
}

const whose = (ctx) => (isStaff(ctx) ? `${firstName(displayName(ctx.scope.student))}’s` : 'Your');

const noContent = () => emptyState({ icon: 'exam', text: 'SAT material is still being added. Check back soon.' });

// Attempts of each set, newest first
function bySet(attempts) {
  const out = new Map();
  for (const a of attempts) {
    if (!out.has(a.set_id)) out.set(a.set_id, []);
    out.get(a.set_id).push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// One practice set as a row: where the student is with it, and a way in

function practiceStatus(set, attempts, counts, total) {
  const open = attempts.find((a) => isOpen(a));
  if (open) return { text: `In progress: ${practiceLine(counts.get(open.id), total)}`, action: 'Continue', tone: 'info' };
  const last = attempts.find((a) => a.submitted_at);
  if (last) return { text: `Done: ${practiceLine(counts.get(last.id), total)}`, action: 'Practice again', tone: 'success', last };
  return { text: 'Not started', action: 'Start', tone: null };
}

function practiceRow(ctx, set, data) {
  const c = data.content.counts.get(set.id);
  const total = c?.total ?? 0;
  const status = practiceStatus(set, data.sets.get(set.id) ?? [], data.counts, total);
  return h('li', {},
    h('a', { class: 'sat-set-row', href: practiceHref(set.id), dataset: { focusKey: `sat-set-${set.id}` } },
      h('span', { class: 'sat-set-main' },
        h('span', { class: 'sat-set-title' }, set.title),
        h('span', { class: 'sat-set-meta' },
          h('span', { class: ['sat-purpose', isHardSet(set) ? 'is-hard' : null].filter(Boolean).join(' ') }, setPurpose(set)),
          h('span', {}, total ? `${total} ${total === 1 ? 'question' : 'questions'}${countsText(c) ? `: ${countsText(c)}` : ''}` : 'No questions yet'))),
      h('span', { class: ['sat-set-status', status.tone ? `tone-${status.tone}` : null].filter(Boolean).join(' ') }, status.text),
      h('span', { class: 'sat-set-go' }, status.action, icon('caret-right'))));
}

// ---------------------------------------------------------------------------
// Learn

export async function learnIndex(ctx) {
  const body = frame(ctx, { title: 'Learn', lede: 'Learn each official SAT skill: read the study guide and the lesson, then check your understanding.' });
  const data = await load(ctx, body, 'Learn');
  if (!data || !ctx.alive()) return;
  const groups = skillsByDomain(data.content.skills);
  if (!groups.some((g) => g.skills.length)) {
    body.replaceChildren(noContent());
    ctx.announce('Learn, nothing yet');
    return;
  }
  const guides = new Set(data.content.guides.map((g) => g.skill));
  body.replaceChildren(...SECTIONS.map((section) => h('section', { class: 'sat-section', 'aria-labelledby': `sat-sec-${section.key}` },
    h('h2', { class: 'sat-section-title', id: `sat-sec-${section.key}` }, section.name),
    h('div', { class: 'sat-domain-grid' }, groups.filter((g) => g.domain.section === section.key && g.skills.length).map((g) => {
      const ds = data.progress.domains[g.domain.slug];
      return h('section', { class: 'card sat-domain-card', 'aria-label': g.domain.name },
        h('div', { class: 'card-head' },
          h('h3', { class: 'card-title' }, g.domain.name),
          h('span', { class: 'card-meta' }, accuracyText(ds))),
        h('ul', { class: 'sat-skill-list' }, g.skills.map((skill) => {
          const st = data.progress.skills[skill.slug];
          const p = st?.answered ? pct(st.correct, st.answered) : null;
          return h('li', {},
            h('a', { class: 'sat-skill-row', href: learnHref(skill.slug), dataset: { focusKey: `sat-skill-${skill.slug}` } },
              h('span', { class: 'sat-skill-name' }, skill.name,
                guides.has(skill.slug) ? null : h('span', { class: 'visually-hidden' }, ', no guide yet')),
              meter(p, `${skill.name}: ${accuracyText(st)}`),
              h('span', { class: 'sat-skill-figure num' }, p === null ? 'Not started' : `${p}%`),
              icon('caret-right')));
        })));
    })))));
  ctx.announce('Learn');
}

export async function skillPage(ctx, slug) {
  const body = frame(ctx, { title: 'Skill' });
  const data = await load(ctx, body, 'this skill');
  if (!data || !ctx.alive()) return;
  const skill = data.content.skillsBySlug.get(slug);
  if (!skill) {
    ctx.setHeader({ title: 'Skill not found', crumbs: satCrumbs(ctx.route, { title: 'Not found' }) });
    body.replaceChildren(emptyState({ icon: 'magnifying-glass', text: 'We couldn’t find that skill.', action: { label: 'All skills', href: '#/sat/learn' } }));
    ctx.announce('Skill not found');
    return;
  }
  const domain = domainOf(skill.domain);
  ctx.setHeader({
    title: skill.name,
    lede: [domain?.name, sectionName(domain?.section)].filter(Boolean).join(', '),
    crumbs: satCrumbs(ctx.route, { title: skill.name }),
    docTitle: skill.name,
  });

  // The guide loads beside the rest; the page shows without it first
  const guideBox = h('article', { class: 'sat-guide', 'aria-label': `Study guide: ${skill.name}` }, skeletonRows(3));
  const sets = checkSetsFor(data.content.sets, skill.slug);
  data.sets = bySet(data.attempts);
  const files = skillFiles(data.content.files, skill, data.content.sets);
  const st = data.progress.skills[skill.slug];
  const p = st?.answered ? pct(st.correct, st.answered) : null;

  const lessonCard = h('section', { class: 'card sat-aside-card', 'aria-labelledby': 'sat-skill-lesson' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: 'sat-skill-lesson' }, 'Read the lesson')),
    files.lessons.length
      ? h('ul', { class: 'sat-file-list' }, files.lessons.map((f) => h('li', { class: 'sat-file-row' },
        icon('file-pdf', { size: 20 }), h('span', { class: 'sat-file-title' }, f.title), pdfButton(ctx, f))))
      : h('p', { class: 'sat-muted' }, 'No lesson for this skill yet.'));

  const checkCard = h('section', { class: 'card sat-aside-card', 'aria-labelledby': 'sat-skill-check' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: 'sat-skill-check' }, 'Check your understanding')),
    sets.length
      ? h('ul', { class: 'sat-set-list is-compact' }, sets.map((s) => practiceRow(ctx, s, data)))
      : h('p', { class: 'sat-muted' }, 'No questions for this skill yet.'));

  const nextCard = h('section', { class: 'card sat-aside-card', 'aria-labelledby': 'sat-skill-next' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: 'sat-skill-next' }, 'Next')),
    h('div', { class: 'sat-next-list' },
      button({ label: 'Solve official questions', variant: 'secondary', size: 'sm', href: problemsHref(skill.slug), iconEnd: 'caret-right', focusKey: 'sat-next-problems' }),
      button({ label: 'Practice', variant: 'secondary', size: 'sm', href: practiceListHref(skill.slug), iconEnd: 'caret-right', focusKey: 'sat-next-practice' })));

  const accuracyCard = h('section', { class: 'card sat-aside-card sat-accuracy', 'aria-labelledby': 'sat-skill-accuracy' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: 'sat-skill-accuracy' }, `${whose(ctx)} accuracy`)),
    h('p', { class: p === null ? 'sat-accuracy-figure is-text' : 'sat-accuracy-figure num' }, p === null ? 'Not started' : `${p}%`),
    meter(p, `${skill.name}: ${accuracyText(st)}`),
    h('p', { class: 'sat-muted' }, st?.answered
      ? `${st.correct} of ${st.answered} ${st.answered === 1 ? 'question' : 'questions'} in this skill answered correctly, across practice and tests.`
      : 'No questions in this skill answered yet.'));

  body.replaceChildren(h('div', { class: 'sat-skill-layout' },
    guideBox,
    h('div', { class: 'sat-skill-aside' }, lessonCard, checkCard, nextCard, accuracyCard)));
  ctx.announce(skill.name);

  try {
    const guide = await getGuide(skill.slug);
    if (!ctx.alive()) return;
    if (!guide) {
      guideBox.replaceChildren(emptyState({ icon: 'book-open-text', text: 'The study guide for this skill is on its way. Start with the lesson and the questions.' }));
      return;
    }
    guideBox.replaceChildren(h('h2', { class: 'visually-hidden' }, 'Study guide'), satDoc(guide.body, { figure, className: 'sat-guide-doc read' }));
    typeset(guideBox);
  } catch (error) {
    console.error(error);
    if (ctx.alive()) guideBox.replaceChildren(h('p', { class: 'sat-muted' }, 'The study guide could not be loaded. Reload the page to try again.'));
  }
}

// ---------------------------------------------------------------------------
// Practice

export async function practiceList(ctx) {
  const only = satPage(ctx.route).skill;
  const body = frame(ctx, {
    title: 'Practice',
    lede: 'Extra practice for each skill: a hard set, then a mixed practice set. After each question you see whether you were right, the answer and an explanation.',
  });
  const data = await load(ctx, body, 'practice');
  if (!data || !ctx.alive()) return;
  data.sets = bySet(data.attempts);
  const practice = data.content.sets.filter((s) => s.kind === 'practice' && s.origin === 'vp');
  if (!practice.length) {
    body.replaceChildren(noContent());
    ctx.announce('Practice, nothing yet');
    return;
  }
  const skills = data.content.skills;
  const pick = only ? skills.find((s) => s.slug === only) ?? null : null;
  const sections = SECTIONS.map((section) => {
    const cards = DOMAINS.filter((d) => d.section === section.key).map((domain) => {
      const domainSkills = skills.filter((s) => s.domain === domain.slug && (!pick || s.slug === pick.slug)).sort((a, b) => a.position - b.position);
      const groups = domainSkills.map((skill) => ({ skill, sets: generatedSetsFor(practice, skill.slug) })).filter((g) => g.sets.length);
      if (!groups.length) return null;
      const ds = data.progress.domains[domain.slug];
      return h('section', { class: 'card sat-domain-card is-list', 'aria-label': domain.name },
        h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, domain.name), h('span', { class: 'card-meta' }, accuracyText(ds))),
        groups.map((g) => h('div', { class: 'sat-skill-group' },
          h('h4', { class: 'sat-skill-heading' }, g.skill.name),
          h('ul', { class: 'sat-set-list' }, g.sets.map((s) => practiceRow(ctx, s, data))))));
    }).filter(Boolean);
    if (!cards.length) return null;
    return h('section', { class: 'sat-section', 'aria-labelledby': `sat-sec-${section.key}` },
      h('h2', { class: 'sat-section-title', id: `sat-sec-${section.key}` }, section.name),
      h('div', { class: 'sat-stack' }, cards));
  }).filter(Boolean);
  body.replaceChildren(...[filterNote(pick, only, '#/sat/practice', 'practice sets'), ...(sections.length ? sections : [noContent()])].filter(Boolean));
  ctx.announce('Practice');
}

// "Showing one skill. Show all skills" above a page filtered by ?skill=
function filterNote(pick, only, allHref, what) {
  if (!only) return null;
  return h('p', { class: 'sat-muted sat-filter-note' },
    pick ? `Showing ${what} for ${pick.name}.` : 'We couldn’t find that skill.',
    h('a', { class: 'link', href: allHref }, 'Show all skills'));
}

// ---------------------------------------------------------------------------
// Problem solving: the official Question Bank

export async function problems(ctx) {
  const only = satPage(ctx.route).skill;
  const body = frame(ctx, {
    title: 'Problem solving',
    lede: 'Official College Board questions for each skill, as Easy, Medium and Hard PDFs. Work them on paper or on screen.',
  });
  let content;
  try {
    content = await getContent();
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    loadError(ctx, body, 'We couldn’t load the Question Bank.');
    return;
  }
  if (!ctx.alive()) return;
  const groups = fileGroups(content.files, content.skills).bank;
  const pick = only ? content.skillsBySlug.get(only) ?? null : null;
  // Command of Evidence (textual and quantitative) shares one set of PDFs
  const wanted = pick ? bankSkill(pick).slug : null;
  const shown = pick
    ? groups.map((g) => ({ ...g, skills: g.skills.filter((r) => r.skill?.slug === wanted || r.skill?.slug === pick.slug) })).filter((g) => g.skills.length)
    : groups;
  const note = h('p', { class: 'sat-note' }, 'Answers are not included; check them with your tutor.');
  const cards = shown.map((g) => h('section', { class: 'card sat-domain-card is-list', 'aria-label': g.domain.name },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, g.domain.name)),
    h('ul', { class: 'sat-bank-list' }, g.skills.map((r) => h('li', { class: 'sat-bank-row' },
      h('span', { class: 'sat-bank-skill' }, r.label),
      h('span', { class: 'sat-bank-levels' }, [...DIFFICULTIES, 'other'].filter((d) => r.levels[d]).map((d) => pdfButton(ctx, r.levels[d], {
        label: DIFFICULTY_LABELS[d] ?? 'Open', ariaLabel: `Open the ${DIFFICULTY_LABELS[d] ?? ''} Question Bank PDF for ${r.label}`, className: `sat-level-btn is-${d}`,
      }))))))));
  const note2 = filterNote(pick, only, '#/sat/problems', 'questions');
  body.replaceChildren(h('div', { class: 'sat-stack' }, note2, groups.length ? note : null,
    ...(cards.length ? cards : [emptyState({ icon: 'file-pdf', text: groups.length ? 'No Question Bank PDFs for this skill yet.' : 'No Question Bank PDFs yet.' })])));
  ctx.announce('Problem solving');
}

// ---------------------------------------------------------------------------
// Tests

function reviewLinks(attempts, label) {
  if (!attempts.length) return null;
  return h('ul', { class: 'sat-review-links', 'aria-label': label }, attempts.slice(0, 5).map((a) => h('li', {},
    h('a', { class: 'link', href: reviewHref(a.id) }, `Review ${a.submitted_at ? shortDay(a.submitted_at) : ''}: ${scoreText(a.correct ?? 0, a.total ?? 0)}`))));
}

function skillTestRow(ctx, set, data) {
  const mods = modulesOf(set);
  const minutes = mods.reduce((t, m) => t + m.minutes, 0);
  const total = data.content.counts.get(set.id)?.total ?? 0;
  const mine = data.sets.get(set.id) ?? [];
  const open = mine.find((a) => isOpen(a));
  const { best, last, attempts } = bestAndLast(mine);
  const staff = isStaff(ctx);
  // Staff see the first attempt apart: it is the one taken before any answers were seen
  const firstId = staff ? [...firstAttemptIds(mine)][0] ?? null : null;
  const first = firstId ? mine.find((a) => a.id === firstId && a.submitted_at) : null;
  const action = open ? 'Continue' : attempts.length ? 'Take again' : 'Start';
  return h('li', { class: 'sat-test-row' },
    h('div', { class: 'sat-test-main' },
      h('h4', { class: 'sat-test-title' }, set.title),
      h('p', { class: 'sat-test-meta' }, `${total} ${total === 1 ? 'question' : 'questions'}, ${minutesText(minutes)}`),
      first ? h('p', { class: 'sat-test-scores num' }, h('span', { class: 'sat-first' }, 'First attempt'), ` ${scoreText(first.correct, first.total)}`) : null,
      best ? h('p', { class: 'sat-test-scores num' }, `Best ${scoreText(best.correct, best.total)}`, h('span', { class: 'sat-dot', 'aria-hidden': 'true' }), `Last ${scoreText(last.correct, last.total)}`) : null,
      open ? h('p', { class: 'sat-test-open' }, staff ? 'A test is in progress.' : 'You have this test in progress.') : null,
      reviewLinks(attempts, `Reviews of ${set.title}`)),
    h('div', { class: 'sat-test-action' }, button({
      label: staff ? 'Preview' : action, variant: open && !staff ? 'primary' : 'secondary', size: 'sm',
      href: testHref(set.id, open && !staff ? { module: open.module } : {}), focusKey: `sat-test-${set.id}`,
    })));
}

function fullTestRow(ctx, set, data) {
  const mods = modulesOf(set);
  const minutes = mods.reduce((t, m) => t + m.minutes, 0);
  const staff = isStaff(ctx);
  const sits = [...sittings(data.sets.get(set.id) ?? [], set).values()].sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
  const openSit = sits.find((s) => !s.done && sittingNext(s, set));
  const next = openSit ? sittingNext(openSit, set) : null;
  const done = sits.filter((s) => s.done);
  return h('li', { class: 'sat-test-row' },
    h('div', { class: 'sat-test-main' },
      h('h4', { class: 'sat-test-title' }, set.title),
      h('p', { class: 'sat-test-meta' }, `${mods.length} modules, ${minutesText(minutes)} plus a 10 minute break`),
      openSit ? h('p', { class: 'sat-test-open' }, `In progress: up to ${mods.find((m) => m.key === next.key)?.title ?? 'the next module'}.`) : null,
      done.length ? h('ul', { class: 'sat-review-links', 'aria-label': `Results of ${set.title}` }, done.slice(0, 3).map((s) => {
        const score = fullScore(s, set);
        return h('li', {},
          h('span', { class: 'num' }, `${shortDay(s.started_at)}: ${score.sections.rw.correct}/${score.sections.rw.total} Reading and Writing, ${score.sections.math.correct}/${score.sections.math.total} Math`),
          ' ',
          ...mods.map((m, i) => (s.modules[m.key] ? [i ? ', ' : '', h('a', { class: 'link', href: reviewHref(s.modules[m.key].id) }, `review ${m.key}`)] : null)));
      })) : null),
    h('div', { class: 'sat-test-action' }, button({
      label: staff ? 'Preview' : openSit ? 'Continue' : done.length ? 'Take again' : 'Start',
      variant: openSit && !staff ? 'primary' : 'secondary',
      size: 'sm',
      href: openSit && !staff ? testHref(set.id, { module: next.key, sitting: openSit.sitting }) : testHref(set.id),
      focusKey: `sat-test-${set.id}`,
    })));
}

export async function testsList(ctx) {
  const body = frame(ctx, { title: 'Tests', lede: 'Timed like the digital SAT. Your score, the answers and explanations come after you submit.' });
  const data = await load(ctx, body, 'tests');
  if (!data || !ctx.alive()) return;
  data.sets = bySet(data.attempts);
  const groups = testGroups(data.content.sets);
  const official = fileGroups(data.content.files, data.content.skills).official;
  if (!groups.byDomain.length && !groups.full.length && !official.length) {
    body.replaceChildren(noContent());
    ctx.announce('Tests, nothing yet');
    return;
  }
  const parts = [];
  if (groups.byDomain.length) {
    parts.push(h('section', { class: 'sat-section', 'aria-labelledby': 'sat-sec-skill-tests' },
      h('h2', { class: 'sat-section-title', id: 'sat-sec-skill-tests' }, 'Skill tests'),
      h('p', { class: 'sat-muted' }, 'One timed module on one domain.'),
      h('div', { class: 'sat-domain-grid' }, groups.byDomain.map((g) => h('section', { class: 'card sat-domain-card', 'aria-label': g.domain.name },
        h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, g.domain.name)),
        h('ul', { class: 'sat-test-list' }, g.sets.map((s) => skillTestRow(ctx, s, data))))))));
  }
  if (groups.full.length) {
    parts.push(h('section', { class: 'sat-section', 'aria-labelledby': 'sat-sec-full-tests' },
      h('h2', { class: 'sat-section-title', id: 'sat-sec-full-tests' }, 'Full practice tests'),
      h('p', { class: 'sat-muted' }, 'Two Reading and Writing modules, a break, then two Math modules. Raw scores only: these tests have no official scaled score.'),
      h('section', { class: 'card is-list' }, h('ul', { class: 'sat-test-list' }, groups.full.map((s) => fullTestRow(ctx, s, data))))));
  }
  if (official.length) {
    parts.push(h('section', { class: 'sat-section', 'aria-labelledby': 'sat-sec-official' },
      h('h2', { class: 'sat-section-title', id: 'sat-sec-official' }, 'Official practice tests (PDF, take on paper or in Bluebook)'),
      h('section', { class: 'card is-list' }, h('ul', { class: 'sat-file-list' }, official.map((f) => fileRow(ctx, f))))));
  }
  body.replaceChildren(...parts);
  ctx.announce('Tests');
}

// ---------------------------------------------------------------------------
// PDFs

function fileRow(ctx, f, meta = null) {
  return h('li', { class: 'sat-file-row' },
    icon('file-pdf', { size: 20 }),
    h('span', { class: 'sat-file-main' },
      h('span', { class: 'sat-file-title' }, f.title),
      meta || f.pages ? h('span', { class: 'sat-file-meta' }, [meta, f.pages ? `${f.pages} ${f.pages === 1 ? 'page' : 'pages'}` : null].filter(Boolean).join(', ')) : null),
    pdfButton(ctx, f));
}

// Staff only: printable tests and answer keys. Null for anyone else or with none.
export function teacherFiles(ctx, content) {
  if (!isStaff(ctx)) return null;
  const files = fileGroups(content.files, content.skills).staff;
  if (!files.length) return null;
  return h('section', { class: 'card sat-teacher', 'aria-labelledby': 'sat-teacher-title' },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title', id: 'sat-teacher-title' }, 'Teacher files'),
      h('span', { class: 'card-meta' }, 'Only tutors and the admin see these')),
    h('ul', { class: 'sat-file-list' }, files.map((f) => fileRow(ctx, f, f.collection === 'answer_key' ? 'Answer key' : 'Printable test'))));
}
