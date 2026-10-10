// The review of one attempt, #/sat/review/<attempt id>[?show=wrong|flagged]:
// every question with the student's answer, the correct one and the
// explanation, filtered to All, Wrong or Flagged. sat_review decides who may
// see it: the student once a test module is submitted (a practice run any
// time, its answered questions only), and staff who teach the student.

import { h } from '../dom.js';
import { emptyState, skeletonRows, segmented } from '../ui.js';
import { firstName, displayName } from '../format.js';
import { shortDay } from '../dates.js';
import {
  attemptLabel, filterReview, scoreText, timeUsed, practiceHref, REVIEW_FILTERS,
} from '../sat-model.js';
import { getContent, getItems, review, errorCode } from '../sat-data.js';
import {
  isStaff, choiceList, sprField, questionMain, questionLayout, explanation, typeset, numberBadge, difficultyPill, loadError,
} from '../sat-ui.js';

const FILTER_LABELS = { all: 'All', wrong: 'Wrong', flagged: 'Flagged' };

function verdict(r) {
  if (r.correct === true) return h('span', { class: 'pill tone-success' }, 'Correct');
  if (r.response) return h('span', { class: 'pill tone-danger' }, 'Incorrect');
  if (r.correct === false) return h('span', { class: 'pill tone-danger' }, 'Not answered');
  return h('span', { class: 'pill tone-neutral' }, 'Not answered yet');
}

function reviewItem(r, item, number) {
  const choices = item.kind === 'mc'
    ? choiceList(item, {
      reveal: { answer: String(r.answer ?? '').toUpperCase(), response: r.response ? String(r.response).toUpperCase() : null },
      label: `Choices for question ${number}`,
    })
    : sprField(item, { value: r.response ?? '', reveal: { correct: Boolean(r.correct) } });
  const head = h('div', { class: 'sat-q-head' },
    numberBadge(number),
    verdict(r),
    r.flagged ? h('span', { class: 'pill tone-warning' }, 'Marked for review') : null,
    difficultyPill(item.difficulty));
  const main = questionMain(item, { head, choices });
  main.append(explanation(item, r));
  return h('li', { class: 'card sat-review-item', dataset: { item: r.item } }, questionLayout(item, main));
}

export async function mount(ctx, where) {
  const { host } = ctx;
  const staff = isStaff(ctx);
  ctx.setHeader({ title: 'Review' });
  const body = h('div', { class: 'sat-view sat-review' }, skeletonRows(4));
  host.append(body);

  let data;
  let content;
  try {
    [data, content] = await Promise.all([review(Number(where.id)), getContent()]);
  } catch (error) {
    if (!ctx.alive()) return;
    const code = errorCode(error);
    if (code === 'not_submitted') {
      body.replaceChildren(emptyState({ icon: 'clock', text: 'This test is still in progress. Its answers show after it is submitted.', action: { label: 'All tests', href: '#/sat/tests' } }));
      ctx.announce('Review not ready');
      return;
    }
    if (code === 'no_such_attempt' || code === 'not_allowed' || /invalid input/i.test(code)) {
      body.replaceChildren(emptyState({ icon: 'magnifying-glass', text: 'We couldn’t find that review.', action: { label: 'All tests', href: '#/sat/tests' } }));
      ctx.announce('Review not found');
      return;
    }
    console.error(error);
    loadError(ctx, body, 'We couldn’t load this review.');
    return;
  }
  if (!ctx.alive()) return;

  const attempt = data.attempt ?? {};
  const set = content.setsById.get(attempt.set_id);
  const label = attemptLabel(attempt, set);
  const practice = attempt.mode === 'practice';
  const crumbs = [
    { label: 'SAT', href: '#/sat' },
    practice ? { label: 'Practice', href: '#/sat/practice' } : { label: 'Tests', href: '#/sat/tests' },
    { label: `Review: ${label}` },
  ];
  const facts = [
    attempt.started_at ? shortDay(attempt.started_at, ctx.now) : null,
    attempt.submitted_at ? scoreText(data.correct ?? 0, data.total ?? 0) : 'In progress',
    timeUsed(attempt) ? `${timeUsed(attempt)} used` : null,
  ].filter(Boolean).join(', ');
  const someoneElse = staff && attempt.student_id && String(attempt.student_id) !== String(ctx.me.id);
  ctx.setHeader({
    title: `Review: ${label}`,
    lede: someoneElse ? `${firstName(displayName(ctx.scope.student))}’s answers. ${facts}` : facts,
    crumbs,
    docTitle: `Review: ${label}`,
  });

  let items;
  try {
    items = await getItems(attempt.set_id, attempt.module);
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    loadError(ctx, body, 'We couldn’t load this review.');
    return;
  }
  if (!ctx.alive()) return;

  const all = (data.items ?? []).filter((r) => items.has(r.item));
  const numberOf = new Map([...items.keys()].map((id, i) => [id, i + 1]));
  const counts = Object.fromEntries(REVIEW_FILTERS.map((f) => [f, filterReview(all, f).length]));
  let show = REVIEW_FILTERS.includes(where.show) ? where.show : 'all';

  const list = h('ol', { class: 'sat-review-list' });
  const status = h('p', { class: 'sat-muted', role: 'status' });
  const fill = () => {
    const shown = filterReview(all, show);
    status.textContent = show === 'all' ? `${shown.length} ${shown.length === 1 ? 'question' : 'questions'}` : `${shown.length} of ${all.length} questions`;
    list.replaceChildren(...(shown.length
      ? shown.map((r) => reviewItem(r, items.get(r.item), numberOf.get(r.item) ?? 0))
      : [h('li', {}, emptyState({ icon: 'check-circle', text: show === 'wrong' ? 'No wrong answers here.' : 'No questions were marked for review.' }))]));
    typeset(list);
  };

  const filter = segmented({
    label: 'Show',
    value: show,
    options: REVIEW_FILTERS.map((f) => ({ value: f, label: `${FILTER_LABELS[f]} ${counts[f]}` })),
    onChange: (value) => {
      show = value;
      ctx.setParams({ show: value === 'all' ? null : value }, { replace: true });
      fill();
    },
  });

  const notes = [];
  if (practice && !attempt.submitted_at) {
    notes.push(h('p', { class: 'sat-note' }, staff
      ? 'This practice set is still in progress. Every question shows, with its answer.'
      : 'This practice set is still in progress, so only the questions you answered show.'));
  }
  const actions = h('div', { class: 'sat-review-actions' },
    filter,
    set && practice && !staff ? h('a', { class: 'link', href: practiceHref(set.id) }, attempt.submitted_at ? 'Practice this set again' : 'Back to the set') : null);

  body.replaceChildren(...notes, actions, status, list);
  fill();
  ctx.announce(`Review: ${label}`);
}
