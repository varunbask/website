// SAT view, #/sat and its pages (sat-model.js satPage). This file is the
// home page and the staff panels; the other pages live in sat-pages.js
// (Learn, Problem solving, Practice, Tests), sat-practice.js and sat-test.js (the
// runners) and sat-review.js.
//
// A student sees SAT only once the admin turns it on (ctx.scope.sat, read by
// student.js); every page shows a polite "not turned on" otherwise, and row
// level security returns nothing anyway. Staff see SAT for every student:
// the home page adds the access switch (the admin; tutors see it read-only),
// the student's attempts with links to their reviews, and for the admin the
// questions held back, each with Open, Release and Release with answer.
//
// The home page: Continue (a run or a test left open), the Learn, Problem
// solving, Practice and Tests cards (each for one purpose), progress by
// section and domain, and for staff the Teacher files.

import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import { button, emptyState, errorCallout, skeletonRows, busy } from '../ui.js';
import { firstName, displayName } from '../format.js';
import { shortDay } from '../dates.js';
import {
  satPage, SECTIONS, domainsOf, progressFrom, attemptCounts, continueList, pct, practiceHref, testHref, reviewHref,
  attemptLabel, attemptResult, timeUsed, validAnswer, answerText, isOpen, lastText, firstAttemptIds,
} from '../sat-model.js';
import {
  getContent, getAttempts, getResponses, getAccess, setAccess, heldItems, releaseItem, getItems, getKeys, dropContent, errorCode,
} from '../sat-data.js';
import {
  isStaff, notOnState, meter, accuracyText, choiceList, sprField, questionMain, questionLayout, explanation, typeset, numberBadge,
  loadError,
} from '../sat-ui.js';
import * as pages from './sat-pages.js';
import * as practice from './sat-practice.js';
import * as test from './sat-test.js';
import * as review from './sat-review.js';

export function mount(ctx) {
  const where = satPage(ctx.route);
  if (!isStaff(ctx) && ctx.scope?.sat !== true) return notOn(ctx);
  switch (where.page) {
    case 'learn': return pages.learnIndex(ctx);
    case 'skill': return pages.skillPage(ctx, where.id);
    case 'problems': return pages.problems(ctx);
    case 'practice': return pages.practiceList(ctx);
    case 'practice-run': return practice.mount(ctx, where);
    case 'tests': return pages.testsList(ctx);
    case 'test-run': return test.mount(ctx, where);
    case 'review': return review.mount(ctx, where);
    // The Library is gone: its lessons are in Learn, the Question Bank in
    // Problem solving, the official tests in Tests
    case 'library': ctx.go('#/sat', { replace: true }); return undefined;
    default: return home(ctx);
  }
}

function notOn(ctx) {
  ctx.setHeader({ title: 'SAT', crumbs: [{ label: 'SAT' }] });
  ctx.host.append(h('div', { class: 'sat-view' }, notOnState()));
  ctx.announce('SAT is not turned on');
}

// ---------------------------------------------------------------------------
// Home

const TILES = [
  { key: 'learn', title: 'Learn', icon: 'book-open-text', href: '#/sat/learn', text: 'Read the study guide and lesson for each skill, then check your understanding.' },
  { key: 'problems', title: 'Problem solving', icon: 'file-pdf', href: '#/sat/problems', text: 'Official College Board questions for each skill, as Easy, Medium and Hard PDFs.' },
  { key: 'practice', title: 'Practice', icon: 'check-square', href: '#/sat/practice', text: 'A hard set and a mixed set for each skill, with the answer and an explanation after each question.' },
  { key: 'tests', title: 'Tests', icon: 'clock', href: '#/sat/tests', text: 'Timed skill tests and full-length practice tests, plus the official practice tests.' },
];

function tiles() {
  return h('nav', { class: 'sat-tiles', 'aria-label': 'SAT sections' }, TILES.map((t) => h('a', {
    class: `sat-tile is-${t.key}`, href: t.href, dataset: { focusKey: `sat-tile-${t.key}` },
  },
  h('span', { class: 'sat-tile-icon', 'aria-hidden': 'true' }, icon(t.icon, { size: 20 })),
  h('span', { class: 'sat-tile-main' },
    h('span', { class: 'sat-tile-title' }, t.title),
    h('span', { class: 'sat-tile-text' }, t.text)),
  icon('caret-right'))));
}

function continueCard(ctx, list, content, counts, { staff, name }) {
  if (!list.length) return null;
  const rows = list.map((a) => {
    const set = content.setsById.get(a.set_id);
    if (!set) return null;
    const total = content.counts.get(set.id)?.total ?? 0;
    const href = a.mode === 'practice' ? practiceHref(set.id) : testHref(set.id, { module: a.module, sitting: a.sitting });
    const what = a.mode === 'practice' ? 'Practice' : 'Timed test';
    return h('li', { class: 'sat-continue-row' },
      h('span', { class: 'sat-continue-main' },
        h('span', { class: 'sat-continue-title' }, attemptLabel(a, set)),
        h('span', { class: 'sat-continue-meta' }, `${what}, ${attemptResult(a, counts.get(a.id), total).replace(/^In progress, /, '').toLowerCase()}`)),
      staff ? null : button({ label: 'Continue', variant: 'primary', size: 'sm', href, focusKey: `sat-continue-${a.id}` }));
  }).filter(Boolean);
  if (!rows.length) return null;
  return h('section', { class: 'card sat-continue', 'aria-labelledby': 'sat-continue-title' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: 'sat-continue-title' }, staff ? `${name} has started` : 'Pick up where you left off')),
    h('ul', { class: 'sat-continue-list' }, rows));
}

function sectionBlock(section, progress, now) {
  const stat = progress.sections[section.key];
  const p = pct(stat.correct, stat.answered);
  return h('div', { class: 'sat-progress-section' },
    h('div', { class: 'sat-progress-head' },
      h('h3', { class: 'sat-progress-name' }, section.name),
      h('p', { class: p === null ? 'sat-progress-figure is-text' : 'sat-progress-figure num' }, p === null ? 'Not started' : `${p}%`),
      h('p', { class: 'sat-progress-meta' }, stat.answered
        ? `${stat.answered} answered, last ${lastText(stat.last, now)}`
        : 'No questions answered yet')),
    h('ul', { class: 'sat-domain-list' }, domainsOf(section.key).map((d) => {
      const ds = progress.domains[d.slug];
      const dp = pct(ds.correct, ds.answered);
      return h('li', { class: 'sat-domain-row' },
        h('span', { class: 'sat-domain-name' }, d.name),
        meter(dp, `${d.name}: ${accuracyText(ds)}`),
        h('span', { class: 'sat-domain-figure num' }, ds.answered ? `${dp}% of ${ds.answered}` : 'None yet'));
    })));
}

function progressCard(progress, now, { staff, name }) {
  return h('section', { class: 'card sat-progress', 'aria-labelledby': 'sat-progress-title' },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title', id: 'sat-progress-title' }, staff ? `${name}’s progress` : 'Your progress'),
      h('span', { class: 'card-meta' }, 'Percent correct of the questions answered')),
    h('div', { class: 'sat-progress-grid' }, SECTIONS.map((s) => sectionBlock(s, progress, now))));
}

async function home(ctx) {
  const { host } = ctx;
  const staff = isStaff(ctx);
  const student = ctx.scope.student;
  const name = firstName(displayName(student));
  ctx.setHeader({
    title: 'SAT',
    lede: staff ? `${name}’s SAT learning, problem solving, practice and tests.` : 'Learn each skill, solve official questions, practice and take timed tests for the digital SAT.',
  });
  const body = h('div', { class: 'sat-view sat-home' }, skeletonRows(4));
  host.append(body);

  let content;
  let attempts;
  let responses;
  try {
    [content, attempts, responses] = await Promise.all([getContent(), getAttempts(student.id), getResponses(student.id)]);
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    loadError(ctx, body, 'We couldn’t load SAT.');
    ctx.announce('SAT, could not load');
    return;
  }
  if (!ctx.alive()) return;

  const progress = progressFrom(responses, content.index);
  const counts = attemptCounts(responses);
  const parts = [];
  if (staff) parts.push(accessCard(ctx, student));
  parts.push(continueCard(ctx, continueList(attempts, ctx.now), content, counts, { staff, name }));
  parts.push(tiles());
  parts.push(progressCard(progress, ctx.now, { staff, name }));
  if (staff) parts.push(attemptsCard(ctx, attempts, content, counts, name));
  if (ctx.role === 'admin') parts.push(heldCard(ctx));
  if (staff) parts.push(pages.teacherFiles(ctx, content));
  body.replaceChildren(...parts.filter(Boolean));
  ctx.announce('SAT');
}

// ---------------------------------------------------------------------------
// Staff: SAT access

function accessCard(ctx, student) {
  const admin = ctx.role === 'admin';
  const name = firstName(displayName(student));
  const titleId = uid('sat-access');
  const card = h('section', { class: 'card sat-access', 'aria-labelledby': titleId },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: titleId }, 'SAT access')),
    h('p', { class: 'sat-access-note' }, 'Checking…'));

  const draw = (row) => {
    const on = Boolean(row);
    const since = row?.granted_at ? ` since ${shortDay(row.granted_at, ctx.now)}` : '';
    const note = on
      ? `On${since}. ${name} sees the SAT tab.`
      : `Off. ${name} does not see the SAT tab${admin ? '' : ', and only the admin can turn it on'}.`;
    const noteEl = h('p', { class: 'sat-access-note', id: `${titleId}-note` }, note);
    const parts = [card.firstChild];
    if (admin) {
      const sw = h('button', {
        type: 'button',
        class: 'sat-switch',
        role: 'switch',
        'aria-checked': on ? 'true' : 'false',
        'aria-describedby': `${titleId}-note`,
        dataset: { focusKey: 'sat-access-switch' },
        onClick: () => toggle(sw, !on),
      },
      h('span', { class: 'sat-switch-track', 'aria-hidden': 'true' }, h('span', { class: 'sat-switch-thumb' })),
      h('span', { class: 'sat-switch-label' }, `SAT for ${name}`));
      parts.push(h('div', { class: 'sat-access-row' }, sw, noteEl));
    } else {
      parts.push(h('div', { class: 'sat-access-row' },
        h('span', { class: ['pill', on ? 'tone-success' : 'tone-neutral'].join(' ') }, icon(on ? 'check-circle' : 'minus-circle', { size: 14 }), h('span', {}, on ? 'On' : 'Off')),
        noteEl));
    }
    card.replaceChildren(...parts);
  };

  async function toggle(sw, next) {
    const ok = await ctx.confirm(next
      ? { title: `Turn on SAT for ${name}?`, body: 'They will see the SAT tab.', confirmLabel: 'Turn on', tone: 'primary' }
      : { title: `Turn off SAT for ${name}?`, body: 'They will no longer see the SAT tab. Their answers and scores are kept.', confirmLabel: 'Turn off', tone: 'danger' });
    if (!ok || !ctx.alive()) return;
    try {
      const row = await busy(sw, null, () => setAccess(student.id, next));
      if (!ctx.alive()) return;
      draw(row);
      card.querySelector('.sat-switch')?.focus();
      ctx.toast({ text: next ? `SAT is on for ${name}.` : `SAT is off for ${name}.` });
    } catch (error) {
      console.error(error);
      ctx.toast({ text: 'That did not save. Try again.' });
    }
  }

  getAccess(student.id).then((row) => { if (ctx.alive()) draw(row); }, (error) => {
    console.error(error);
    if (ctx.alive()) card.querySelector('.sat-access-note').textContent = 'Could not check whether SAT is on.';
  });
  return card;
}

// ---------------------------------------------------------------------------
// Staff: the student's attempts

function attemptsCard(ctx, attempts, content, counts, name) {
  const titleId = uid('sat-attempts');
  const list = attempts.filter((a) => content.setsById.has(a.set_id));
  // Retakes after seeing the answers are allowed: the first try is marked
  const firsts = firstAttemptIds(list);
  const rows = list.map((a) => {
    const set = content.setsById.get(a.set_id);
    const total = content.counts.get(set.id)?.total ?? 0;
    const used = timeUsed(a);
    return h('li', {},
      h('a', { class: 'sat-attempt-row', href: reviewHref(a.id), dataset: { focusKey: `sat-attempt-${a.id}` } },
        h('span', { class: 'sat-attempt-date num' }, shortDay(a.started_at, ctx.now)),
        h('span', { class: 'sat-attempt-title' }, attemptLabel(a, set),
          h('span', { class: 'sat-attempt-kind' }, a.mode === 'practice' ? 'Practice' : 'Test'),
          firsts.has(a.id) ? h('span', { class: 'sat-first' }, 'First attempt') : null),
        h('span', { class: 'sat-attempt-score num' }, attemptResult(a, counts.get(a.id), total)),
        h('span', { class: 'sat-attempt-time num' }, used ?? (isOpen(a, ctx.now) ? 'Open' : '')),
        icon('caret-right')));
  });
  return h('section', { class: 'card sat-attempts', 'aria-labelledby': titleId },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title', id: titleId }, `${name}’s attempts`),
      h('span', { class: 'card-meta' }, list.length ? `${list.length} in all` : '')),
    rows.length
      ? [h('div', { class: 'sat-attempt-cols', 'aria-hidden': 'true' },
        h('span', {}, 'Date'), h('span', {}, 'Set'), h('span', {}, 'Score'), h('span', {}, 'Time used')),
      h('ul', { class: 'sat-attempt-list', 'aria-label': `${name}’s attempts` }, rows)]
      : h('p', { class: 'sat-muted' }, `${name} has not started any SAT practice or tests yet.`));
}

// ---------------------------------------------------------------------------
// Admin: questions held back

function heldCard(ctx) {
  const titleId = uid('sat-held');
  const list = h('div', { class: 'sat-held-body' }, skeletonRows(2));
  const meta = h('span', { class: 'card-meta' });
  const card = h('section', { class: 'card sat-held', 'aria-labelledby': titleId },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: titleId }, 'Questions held back'), meta),
    h('p', { class: 'sat-muted' }, 'Students never see these. Release one when its question and answer are right.'),
    list);

  async function load() {
    let rows;
    try {
      rows = await heldItems();
    } catch (error) {
      console.error(error);
      if (ctx.alive()) list.replaceChildren(errorCallout({ title: 'We couldn’t load the held questions.', onRetry: load }));
      return;
    }
    if (!ctx.alive()) return;
    meta.textContent = rows.length ? `${rows.length} held` : '';
    if (!rows.length) {
      list.replaceChildren(emptyState({ icon: 'check-circle', text: 'No questions are held back.' }));
      return;
    }
    list.replaceChildren(h('ul', { class: 'sat-held-list' }, rows.map((row) => heldRow(ctx, row, load))));
  }
  load();
  return card;
}

function heldRow(ctx, row, reload) {
  const where = [row.set_title, row.module ? `module ${row.module}` : null, `question ${row.position}`].filter(Boolean).join(', ');
  const preview = h('div', { class: 'sat-held-preview', hidden: true });
  const form = h('div', { class: 'sat-held-form', hidden: true });
  let opened = false;

  const openBtn = button({ label: 'Open', size: 'sm', variant: 'ghost', icon: 'eye', focusKey: `sat-held-open-${row.id}` });
  openBtn.setAttribute('aria-expanded', 'false');
  openBtn.addEventListener('click', async () => {
    const show = preview.hidden;
    preview.hidden = !show;
    openBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show && !opened) {
      opened = true;
      preview.replaceChildren(skeletonRows(1));
      try {
        const [itemsMap, keys] = await Promise.all([getItems(row.set_id, row.module), getKeys([row.id])]);
        const item = itemsMap.get(row.id);
        const key = keys.get(row.id) ?? null;
        if (!item) throw new Error('missing item');
        const choices = item.kind === 'mc'
          ? choiceList(item, { reveal: { answer: key?.answer ?? null, response: null }, label: `Choices for ${where}` })
          : sprField(item, { value: key?.answer ?? '', reveal: { correct: true } });
        const main = questionMain(item, { head: h('div', { class: 'sat-q-head' }, numberBadge(row.position)), choices });
        main.append(explanation(item, { answer: key?.answer ?? null, accept: key?.accept ?? [], explanation: key?.explanation ?? null }, { heading: 'Explanation on file', asKey: true }));
        preview.replaceChildren(questionLayout(item, main));
        typeset(preview);
      } catch (error) {
        console.error(error);
        opened = false;
        preview.replaceChildren(h('p', { class: 'sat-muted' }, 'This question could not be loaded.'));
      }
    }
  });

  const release = async (btn, answerValue = null) => {
    try {
      await busy(btn, 'Releasing…', () => releaseItem(row.id, answerValue));
    } catch (error) {
      const code = errorCode(error);
      ctx.toast({
        text: code === 'no_answer' ? 'This question has no answer on file. Use Release with answer.'
          : code === 'bad_answer' ? 'That answer is not valid for this question.'
            : 'That did not save. Try again.',
      });
      return;
    }
    dropContent();
    ctx.toast({ text: 'Released. Students can see this question now.' });
    reload();
  };

  const releaseBtn = button({ label: 'Release', size: 'sm', variant: 'secondary', focusKey: `sat-held-release-${row.id}` });
  releaseBtn.addEventListener('click', async () => {
    const ok = await ctx.confirm({
      title: 'Release this question?',
      body: row.answer ? `Students will see it, with the answer on file: ${answerText(row.kind, row.answer)}.` : 'Students will see it.',
      confirmLabel: 'Release',
      tone: 'primary',
    });
    if (ok && ctx.alive()) release(releaseBtn);
  });

  const withBtn = button({ label: 'Release with answer…', size: 'sm', variant: 'secondary', focusKey: `sat-held-with-${row.id}` });
  withBtn.setAttribute('aria-expanded', 'false');
  withBtn.addEventListener('click', () => {
    form.hidden = !form.hidden;
    withBtn.setAttribute('aria-expanded', form.hidden ? 'false' : 'true');
    if (!form.hidden) form.querySelector('input')?.focus();
  });
  const inputId = uid('sat-held-answer');
  const input = h('input', {
    class: 'input sat-held-input num', id: inputId, type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '6',
    placeholder: row.kind === 'mc' ? 'A, B, C or D' : 'For example 7/2',
  });
  const error = h('p', { class: 'field-error', hidden: true, role: 'alert' });
  const save = button({ label: 'Release', size: 'sm', variant: 'primary' });
  const submit = () => {
    const value = input.value.trim();
    if (!validAnswer(row.kind, value)) {
      error.hidden = false;
      error.textContent = row.kind === 'mc' ? 'Enter A, B, C or D.' : 'Enter a grid-in answer: a whole number, a decimal or a fraction, up to 5 characters (6 with a minus sign).';
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    error.hidden = true;
    input.removeAttribute('aria-invalid');
    release(save, value);
  };
  save.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  form.append(
    h('label', { class: 'field-label', for: inputId }, 'Answer'),
    h('div', { class: 'sat-held-form-row' }, input, save),
    error);

  return h('li', { class: 'sat-held-row' },
    h('div', { class: 'sat-held-main' },
      h('p', { class: 'sat-held-where' }, where),
      h('p', { class: 'sat-held-reason' }, row.hold_reason || 'No reason given.'),
      row.review_note ? h('p', { class: 'sat-held-note' }, `Note: ${row.review_note}`) : null,
      h('p', { class: 'sat-held-answer' }, row.answer ? `Answer on file: ${answerText(row.kind, row.answer)}` : 'No answer on file')),
    h('div', { class: 'sat-held-actions' }, openBtn, releaseBtn, withBtn),
    form,
    preview);
}
