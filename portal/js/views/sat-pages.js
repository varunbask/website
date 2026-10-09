// The SAT browsing pages (views/sat.js routes here):
//   learnIndex  #/sat/learn            the eight domains, each skill with a progress meter
//   skillPage   #/sat/learn/<skill>    the study guide, then Practice this skill,
//                                      Lesson PDF, Question Bank and the accuracy so far
//   practiceList #/sat/practice        the practice sets by domain and skill
//   testsList   #/sat/tests            skill tests by domain, then full tests
//   library     #/sat/library?tab=     lessons, Question Bank, official tests
//                                      (and the tutor files, for staff)
// Progress is the student on screen's (the student themself, or the one staff
// chose). Staff who open a set or a test try it as themselves (a preview).

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { button, emptyState, skeletonRows } from '../ui.js';
import { firstName, displayName } from '../format.js';
import { shortDay } from '../dates.js';
import {
  SECTIONS, DOMAINS, domainOf, sectionName, skillsByDomain, practiceSetsFor, testGroups, modulesOf, libraryGroups, skillFiles,
  progressFrom, attemptCounts, practiceLine, countsText, originLabel, pct, bestAndLast, sittings, sittingNext, fullScore,
  scoreText, minutesText, practiceHref, testHref, reviewHref, learnHref, satCrumbs, DIFFICULTIES, DIFFICULTY_LABELS,
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

// The origin, for staff: a small pill (students only ever see the label)
function originPill(ctx, set) {
  if (!isStaff(ctx)) return null;
  return h('span', { class: 'sat-origin', title: set.origin === 'vp' ? 'Our own set' : 'From Matthew’s guides' }, set.origin === 'vp' ? 'VP' : 'Matthew');
}

// ---------------------------------------------------------------------------
// One practice set as a row: where the student is with it, and a way in

function practiceStatus(set, attempts, counts, total) {
  const open = attempts.find((a) => !a.submitted_at);
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
          h('span', { class: `sat-kind is-${set.origin === 'vp' ? 'vp' : 'guide'}` }, originLabel(set.origin)),
          originPill(ctx, set),
          h('span', {}, total ? `${total} ${total === 1 ? 'question' : 'questions'}${countsText(c) ? `: ${countsText(c)}` : ''}` : 'No questions yet'))),
      h('span', { class: ['sat-set-status', status.tone ? `tone-${status.tone}` : null].filter(Boolean).join(' ') }, status.text),
      h('span', { class: 'sat-set-go' }, status.action, icon('caret-right'))));
}

// ---------------------------------------------------------------------------
// Learn

export async function learnIndex(ctx) {
  const body = frame(ctx, { title: 'Learn', lede: 'A study guide for each official SAT skill, with practice sets and PDFs.' });
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
  const sets = practiceSetsFor(data.content.sets, skill.slug);
  data.sets = bySet(data.attempts);
  const files = skillFiles(data.content.files, skill, data.content.sets);
  const st = data.progress.skills[skill.slug];
  const p = st?.answered ? pct(st.correct, st.answered) : null;

  const practiceCard = h('section', { class: 'card sat-aside-card', 'aria-labelledby': 'sat-skill-practice' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: 'sat-skill-practice' }, 'Practice this skill')),
    sets.length
      ? h('ul', { class: 'sat-set-list is-compact' }, sets.map((s) => practiceRow(ctx, s, data)))
      : h('p', { class: 'sat-muted' }, 'No practice sets for this skill yet.'));

  const lessonCard = h('section', { class: 'card sat-aside-card', 'aria-labelledby': 'sat-skill-lesson' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: 'sat-skill-lesson' }, 'Lesson PDF')),
    files.lessons.length
      ? h('ul', { class: 'sat-file-list' }, files.lessons.map((f) => h('li', { class: 'sat-file-row' },
        icon('file-pdf', { size: 20 }), h('span', { class: 'sat-file-title' }, f.title), pdfButton(ctx, f))))
      : h('p', { class: 'sat-muted' }, 'No lesson PDF for this skill yet.'));

  const levels = DIFFICULTIES.filter((d) => files.bank[d]);
  const bankFor = files.bankLabel ?? skill.name;
  const bankCard = h('section', { class: 'card sat-aside-card', 'aria-labelledby': 'sat-skill-bank' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: 'sat-skill-bank' }, 'Question Bank')),
    levels.length
      ? [files.bankLabel ? h('p', { class: 'sat-bank-label' }, files.bankLabel) : null,
        h('div', { class: 'sat-bank-levels' }, levels.map((d) => pdfButton(ctx, files.bank[d], {
          label: DIFFICULTY_LABELS[d], ariaLabel: `Open the ${DIFFICULTY_LABELS[d]} Question Bank PDF for ${bankFor}`, className: `sat-level-btn is-${d}`,
        }))),
      h('p', { class: 'sat-note' }, 'Official College Board questions. Answers are not included; check them with your tutor.')]
      : h('p', { class: 'sat-muted' }, 'No Question Bank PDFs for this skill yet.'));

  const accuracyCard = h('section', { class: 'card sat-aside-card sat-accuracy', 'aria-labelledby': 'sat-skill-accuracy' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: 'sat-skill-accuracy' }, `${whose(ctx)} accuracy`)),
    h('p', { class: p === null ? 'sat-accuracy-figure is-text' : 'sat-accuracy-figure num' }, p === null ? 'Not started' : `${p}%`),
    meter(p, `${skill.name}: ${accuracyText(st)}`),
    h('p', { class: 'sat-muted' }, st?.answered
      ? `${st.correct} of ${st.answered} ${st.answered === 1 ? 'question' : 'questions'} in this skill answered correctly, across practice and tests.`
      : 'No questions in this skill answered yet.'));

  body.replaceChildren(h('div', { class: 'sat-skill-layout' },
    guideBox,
    h('div', { class: 'sat-skill-aside' }, practiceCard, lessonCard, bankCard, accuracyCard)));
  ctx.announce(skill.name);

  try {
    const guide = await getGuide(skill.slug);
    if (!ctx.alive()) return;
    if (!guide) {
      guideBox.replaceChildren(emptyState({ icon: 'book-open-text', text: 'The study guide for this skill is on its way. Start with the practice sets and PDFs.' }));
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
  const body = frame(ctx, {
    title: 'Practice',
    lede: 'Practice sets by skill. After each question you see whether you were right, the answer and an explanation.',
  });
  const data = await load(ctx, body, 'practice');
  if (!data || !ctx.alive()) return;
  data.sets = bySet(data.attempts);
  const practice = data.content.sets.filter((s) => s.kind === 'practice');
  if (!practice.length) {
    body.replaceChildren(noContent());
    ctx.announce('Practice, nothing yet');
    return;
  }
  const skills = data.content.skills;
  const sections = SECTIONS.map((section) => {
    const cards = DOMAINS.filter((d) => d.section === section.key).map((domain) => {
      const domainSkills = skills.filter((s) => s.domain === domain.slug).sort((a, b) => a.position - b.position);
      const known = new Set(domainSkills.map((s) => s.slug));
      // Sets whose skill is not listed still show, under the domain itself
      const loose = practice.filter((s) => s.domain === domain.slug && !known.has(s.skill)).sort((a, b) => a.position - b.position);
      const groups = domainSkills.map((skill) => ({ skill, sets: practiceSetsFor(practice, skill.slug) })).filter((g) => g.sets.length);
      if (!groups.length && !loose.length) return null;
      const ds = data.progress.domains[domain.slug];
      return h('section', { class: 'card sat-domain-card is-list', 'aria-label': domain.name },
        h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, domain.name), h('span', { class: 'card-meta' }, accuracyText(ds))),
        groups.map((g) => h('div', { class: 'sat-skill-group' },
          h('h4', { class: 'sat-skill-heading' },
            h('a', { class: 'link', href: learnHref(g.skill.slug) }, g.skill.name)),
          h('ul', { class: 'sat-set-list' }, g.sets.map((s) => practiceRow(ctx, s, data))))),
        loose.length ? h('ul', { class: 'sat-set-list' }, loose.map((s) => practiceRow(ctx, s, data))) : null);
    }).filter(Boolean);
    if (!cards.length) return null;
    return h('section', { class: 'sat-section', 'aria-labelledby': `sat-sec-${section.key}` },
      h('h2', { class: 'sat-section-title', id: `sat-sec-${section.key}` }, section.name),
      h('div', { class: 'sat-stack' }, cards));
  }).filter(Boolean);
  body.replaceChildren(...sections);
  ctx.announce('Practice');
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
  const open = mine.find((a) => !a.submitted_at);
  const { best, last, attempts } = bestAndLast(mine);
  const staff = isStaff(ctx);
  const action = open ? 'Continue' : attempts.length ? 'Take again' : 'Start';
  return h('li', { class: 'sat-test-row' },
    h('div', { class: 'sat-test-main' },
      h('h4', { class: 'sat-test-title' }, set.title),
      h('p', { class: 'sat-test-meta' }, `${total} ${total === 1 ? 'question' : 'questions'}, ${minutesText(minutes)}`),
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
  if (!groups.byDomain.length && !groups.full.length) {
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
  body.replaceChildren(...parts);
  ctx.announce('Tests');
}

// ---------------------------------------------------------------------------
// Library

const TAB_LABELS = { lessons: 'Lessons', bank: 'Question Bank', official: 'Official practice tests', staff: 'Tutor files' };

function fileRow(ctx, f, meta = null) {
  return h('li', { class: 'sat-file-row' },
    icon('file-pdf', { size: 20 }),
    h('span', { class: 'sat-file-main' },
      h('span', { class: 'sat-file-title' }, f.title),
      meta || f.pages ? h('span', { class: 'sat-file-meta' }, [meta, f.pages ? `${f.pages} ${f.pages === 1 ? 'page' : 'pages'}` : null].filter(Boolean).join(', ')) : null),
    pdfButton(ctx, f));
}

export async function library(ctx, tab) {
  const staff = isStaff(ctx);
  const current = tab === 'staff' && !staff ? 'lessons' : tab;
  const tabs = ['lessons', 'bank', 'official', ...(staff ? ['staff'] : [])].map((key) => ({
    label: TAB_LABELS[key], href: `#/sat/library?tab=${key}`, current: key === current,
  }));
  const body = frame(ctx, { title: 'Library', lede: 'PDFs to read, print or work through on paper.', tabs, tabsLabel: 'Library sections' });
  let content;
  try {
    content = await getContent();
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    loadError(ctx, body, 'We couldn’t load the library.');
    return;
  }
  if (!ctx.alive()) return;
  const groups = libraryGroups(content.files, content.skills, content.sets);
  const empty = (text) => emptyState({ icon: 'file-pdf', text });
  let parts;
  if (current === 'bank') {
    parts = groups.bank.length
      ? [h('p', { class: 'sat-note' }, 'Official College Board questions. Answers are not included; check them with your tutor.'),
        ...groups.bank.map((g) => h('section', { class: 'card sat-domain-card is-list', 'aria-label': g.domain.name },
          h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, g.domain.name)),
          h('ul', { class: 'sat-bank-list' }, g.skills.map((s) => h('li', { class: 'sat-bank-row' },
            h('span', { class: 'sat-bank-skill' }, s.label),
            h('span', { class: 'sat-bank-levels' }, [...DIFFICULTIES, 'other'].filter((d) => s.levels[d]).map((d) => pdfButton(ctx, s.levels[d], {
              label: DIFFICULTY_LABELS[d] ?? 'Open', ariaLabel: `Open the ${DIFFICULTY_LABELS[d] ?? ''} Question Bank PDF for ${s.label}`, className: `sat-level-btn is-${d}`,
            })))))))) ]
      : [empty('No Question Bank PDFs yet.')];
  } else if (current === 'official') {
    parts = groups.official.length
      ? [h('section', { class: 'card is-list' }, h('ul', { class: 'sat-file-list' }, groups.official.map((f) => fileRow(ctx, f))))]
      : [empty('No official practice tests yet.')];
  } else if (current === 'staff') {
    parts = groups.staff.length
      ? [h('p', { class: 'sat-note' }, 'Only tutors and the admin see these: printable tests and answer keys.'),
        h('section', { class: 'card is-list' }, h('ul', { class: 'sat-file-list' }, groups.staff.map((f) => fileRow(ctx, f, f.collection === 'answer_key' ? 'Answer key' : 'Printable test'))))]
      : [empty('No tutor files yet.')];
  } else {
    parts = groups.lessons.length
      ? groups.lessons.map((g) => h('section', { class: 'card sat-domain-card is-list', 'aria-label': g.domain.name },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, g.domain.name)),
        h('ul', { class: 'sat-file-list' },
          g.skills.flatMap((r) => r.files.map((f) => fileRow(ctx, f, r.skill.name))),
          g.other.map((f) => fileRow(ctx, f)))))
      : [empty('No lesson PDFs yet.')];
  }
  body.replaceChildren(h('div', { class: 'sat-stack' }, parts));
  ctx.announce(`Library, ${TAB_LABELS[current]}`);
}
