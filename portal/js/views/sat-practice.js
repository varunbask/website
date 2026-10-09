// The practice runner, #/sat/practice/<set id>. One question at a time:
// choose an answer (A to D, or the grid-in box), Check, and the result shows
// at once with the correct answer and the explanation; then Next. The first
// answer is final (sat_answer keeps it). Finish scores the set (sat_submit)
// and offers Practice again and Review. Leaving and coming back picks the run
// up where it was (sat_start returns the open run; its answered questions
// come back from sat_review).
//
// Keyboard: A, B, C or D chooses; Enter checks, then goes to the next question.
//
// The run lives in `runs` (by person and set), not in the DOM, so a redraw
// (the app remounts a view when its data changes) shows the same question.
// Staff who open a set answer as themselves: a preview that never touches
// the student's progress.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { button, emptyState, skeletonRows, busy } from '../ui.js';
import { firstName, displayName } from '../format.js';
import {
  originLabel, pct, reviewHref, satCrumbs, domainName, LETTERS, sprValid, answerText,
} from '../sat-model.js';
import { getContent, getItems, start, answer, submit, review, dropProgress, errorCode } from '../sat-data.js';
import {
  isStaff, choiceList, sprField, questionMain, questionLayout, explanation, typeset, numberBadge, difficultyPill, loadError,
} from '../sat-ui.js';

const runs = new Map();   // `${person}|${set}` -> run

const answered = (run, id) => Boolean(run.answers.get(id)?.response);

async function loadRun(setId) {
  const started = await start(setId);
  const [items, prior] = await Promise.all([
    getItems(setId),
    review(started.attempt_id).catch(() => null),
  ]);
  const answers = new Map();
  for (const r of prior?.items ?? []) if (r.response) answers.set(r.item, r);
  const ids = (started.items ?? []).filter((id) => items.has(id));
  const first = ids.findIndex((id) => !answers.has(id));
  return {
    attemptId: started.attempt_id,
    ids,
    items,
    answers,
    drafts: new Map(),
    index: first === -1 ? Math.max(0, ids.length - 1) : first,
    finished: null,
    redraw: null,
  };
}

export async function mount(ctx, where) {
  const { host } = ctx;
  const staff = isStaff(ctx);
  const setId = where.id;
  const key = `${ctx.me.id}|${setId}`;
  ctx.setHeader({ title: 'Practice', crumbs: satCrumbs(ctx.route, { title: 'Practice' }) });
  const body = h('div', { class: 'sat-view sat-runner is-practice' }, skeletonRows(3));
  host.append(body);

  let content;
  try {
    content = await getContent();
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    loadError(ctx, body, 'We couldn’t load this practice set.');
    return;
  }
  if (!ctx.alive()) return;
  const set = content.setsById.get(setId);
  if (!set || set.kind !== 'practice') {
    ctx.setHeader({ title: 'Practice set not found', crumbs: satCrumbs(ctx.route, { title: 'Not found' }) });
    body.replaceChildren(emptyState({ icon: 'magnifying-glass', text: 'We couldn’t find that practice set.', action: { label: 'All practice sets', href: '#/sat/practice' } }));
    ctx.announce('Practice set not found');
    return;
  }
  const skill = content.skillsBySlug.get(set.skill);
  ctx.setHeader({
    title: set.title,
    lede: [originLabel(set.origin), skill && skill.name !== set.title ? skill.name : domainName(set.domain)].filter(Boolean).join(', '),
    crumbs: satCrumbs(ctx.route, { title: set.title }),
    docTitle: set.title,
  });

  let run = runs.get(key);
  if (!run) {
    try {
      run = await loadRun(setId);
    } catch (error) {
      if (!ctx.alive()) return;
      console.error(error);
      loadError(ctx, body, 'We couldn’t start this practice set.');
      return;
    }
    runs.set(key, run);
  }
  if (!ctx.alive()) return;
  if (!run.ids.length) {
    runs.delete(key);
    body.replaceChildren(emptyState({ icon: 'info', text: 'This practice set has no questions yet.', action: { label: 'All practice sets', href: '#/sat/practice' } }));
    ctx.announce(`${set.title}, no questions`);
    return;
  }

  const live = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const say = (text) => {
    live.textContent = '';
    setTimeout(() => { if (ctx.alive()) live.textContent = text; }, 50);
  };
  const preview = staff
    ? h('p', { class: 'sat-preview-note' }, icon('info'), h('span', {}, `Preview: you are answering as yourself. ${firstName(displayName(ctx.scope.student))}’s progress does not change.`))
    : null;

  // ---- Drawing ------------------------------------------------------------

  function progressBar() {
    const done = run.ids.filter((id) => answered(run, id)).length;
    const right = run.ids.filter((id) => run.answers.get(id)?.correct).length;
    const fill = h('span', { class: 'sat-bar-fill' });
    fill.style.setProperty('--pct', `${pct(done, run.ids.length) ?? 0}%`);
    return h('div', { class: 'sat-run-bar' },
      h('div', { class: 'sat-run-bar-row' },
        h('span', { class: 'sat-run-count num' }, `Question ${run.index + 1} of ${run.ids.length}`),
        h('span', { class: 'sat-run-tally num' }, `${done} answered, ${right} correct`),
        button({ label: 'Finish', variant: 'ghost', size: 'sm', onClick: (e) => finish(e.currentTarget), focusKey: 'sat-finish' })),
      h('div', {
        class: 'sat-bar', role: 'progressbar', 'aria-label': 'Answered', 'aria-valuemin': '0', 'aria-valuemax': String(run.ids.length), 'aria-valuenow': String(done),
      }, fill));
  }

  function questionView() {
    const id = run.ids[run.index];
    const item = run.items.get(id);
    const result = run.answers.get(id) ?? null;
    const checked = Boolean(result?.response);
    const draft = run.drafts.get(id) ?? null;
    let choices;
    if (item.kind === 'mc') {
      choices = choiceList(item, {
        selected: checked ? result.response : draft,
        reveal: checked ? { answer: String(result.answer ?? '').toUpperCase(), response: result.response } : null,
        onChoose: (letter) => {
          run.drafts.set(id, letter);
          draw({ focus: `sat-choice-${letter}` });
        },
      });
    } else {
      choices = sprField(item, {
        value: checked ? result.response : (draft ?? ''),
        reveal: checked ? result : null,
        onInput: (value) => {
          run.drafts.set(id, value);
          const checkBtn = body.querySelector('[data-focus-key="sat-check"]');
          if (checkBtn) checkBtn.disabled = !sprValid(value);
        },
      });
    }
    const head = h('div', { class: 'sat-q-head' }, numberBadge(run.index + 1), difficultyPill(item.difficulty));
    const main = questionMain(item, { head, choices });
    main.setAttribute('tabindex', '-1');
    main.classList.add('sat-focus-target');
    if (checked) main.append(explanation(item, result));
    return questionLayout(item, main);
  }

  function footer() {
    const id = run.ids[run.index];
    const item = run.items.get(id);
    const checked = answered(run, id);
    const draft = run.drafts.get(id);
    const last = run.index === run.ids.length - 1;
    const back = button({ label: 'Back', variant: 'secondary', icon: 'caret-left', disabled: run.index === 0, onClick: () => move(-1), focusKey: 'sat-back' });
    let primary;
    if (!checked) {
      const ready = item.kind === 'mc' ? LETTERS.includes(draft) : sprValid(draft ?? '');
      primary = button({ label: 'Check', variant: 'primary', disabled: !ready, onClick: (e) => check(e.currentTarget), focusKey: 'sat-check' });
    } else if (last) {
      primary = button({ label: 'Finish', variant: 'primary', onClick: (e) => finish(e.currentTarget), focusKey: 'sat-next' });
    } else {
      primary = button({ label: 'Next', variant: 'primary', iconEnd: 'caret-right', onClick: () => move(1), focusKey: 'sat-next' });
    }
    const skip = !checked && !last ? button({ label: 'Skip', variant: 'ghost', onClick: () => move(1), focusKey: 'sat-skip' }) : null;
    return h('div', { class: 'sat-run-foot' }, back, h('span', { class: 'sat-run-foot-gap' }), skip, primary);
  }

  function finishView() {
    const r = run.finished;
    const total = r.total ?? run.ids.length;
    const correct = r.correct ?? 0;
    const p = pct(correct, total) ?? 0;
    return h('section', { class: 'card sat-finish', 'aria-labelledby': 'sat-finish-title' },
      h('span', { class: 'sat-finish-icon', 'aria-hidden': 'true' }, icon('check-circle', { size: 28 })),
      h('h2', { class: 'sat-finish-title', id: 'sat-finish-title', tabindex: '-1' }, 'Practice set complete'),
      h('p', { class: 'sat-finish-score num' }, `${correct} of ${total} correct`),
      h('p', { class: 'sat-finish-pct num' }, `${p}%`),
      h('div', { class: 'sat-finish-actions' },
        button({ label: 'Practice again', variant: 'primary', icon: 'arrow-counter-clockwise', onClick: (e) => again(e.currentTarget), focusKey: 'sat-again' }),
        button({ label: 'Review answers', variant: 'secondary', href: reviewHref(r.attempt?.id ?? run.attemptId), focusKey: 'sat-review' }),
        button({ label: 'More practice', variant: 'ghost', href: '#/sat/practice' })));
  }

  function draw({ focus = null } = {}) {
    if (!ctx.alive()) return;
    if (run.finished) {
      body.replaceChildren(preview ?? '', finishView(), live);
      body.querySelector('#sat-finish-title')?.focus();
      return;
    }
    body.replaceChildren(...[preview, progressBar(), questionView(), footer(), live].filter(Boolean));
    typeset(body);
    if (focus === 'question') body.querySelector('.sat-focus-target')?.focus({ preventScroll: true });
    else if (focus) body.querySelector(`[data-focus-key="${focus}"]`)?.focus({ preventScroll: true });
  }
  run.redraw = draw;
  const redraw = (opts) => run.redraw?.(opts);

  // ---- Actions --------------------------------------------------------------

  function move(step) {
    const next = run.index + step;
    if (next < 0 || next >= run.ids.length) return;
    run.index = next;
    redraw({ focus: 'question' });
    body.scrollIntoView?.({ block: 'start' });
  }

  async function check(btn) {
    const id = run.ids[run.index];
    const item = run.items.get(id);
    const draft = run.drafts.get(id);
    if (answered(run, id) || !(item.kind === 'mc' ? LETTERS.includes(draft) : sprValid(draft ?? ''))) return;
    let result;
    try {
      result = await busy(btn, 'Checking…', () => answer(run.attemptId, id, draft));
    } catch (error) {
      console.error(error);
      if (errorCode(error) === 'submitted') {
        runs.delete(key);
        ctx.toast({ text: 'This practice set was finished in another tab.' });
        return;
      }
      ctx.toast({ text: 'Your answer did not save. Try again.' });
      return;
    }
    dropProgress(ctx.me.id);
    run.answers.set(id, result);
    run.drafts.delete(id);
    redraw({ focus: 'sat-next' });
    // The result and explanation are what the student reads next
    body.querySelector('.sat-explain')?.scrollIntoView?.({ block: 'nearest' });
    const ans = answerText(item.kind, result.answer, result.accept);
    say(result.correct ? 'Correct.' : `Incorrect. The correct answer is ${ans}.`);
  }

  async function finish(btn) {
    const left = run.ids.filter((id) => !answered(run, id)).length;
    if (left) {
      const ok = await ctx.confirm({
        title: 'Finish this practice set?',
        body: `${left} ${left === 1 ? 'question has' : 'questions have'} no answer and will count as wrong.`,
        confirmLabel: 'Finish',
        tone: 'primary',
      });
      if (!ok || !ctx.alive()) return;
    }
    try {
      run.finished = await busy(btn, 'Finishing…', () => submit(run.attemptId));
    } catch (error) {
      console.error(error);
      ctx.toast({ text: 'That did not save. Try again.' });
      return;
    }
    dropProgress(ctx.me.id);
    redraw();
    say(`Practice set complete. ${run.finished.correct ?? 0} of ${run.finished.total ?? run.ids.length} correct.`);
  }

  async function again(btn) {
    let fresh;
    try {
      fresh = await busy(btn, 'Starting…', () => loadRun(setId));
    } catch (error) {
      console.error(error);
      ctx.toast({ text: 'We couldn’t start a new run. Try again.' });
      return;
    }
    dropProgress(ctx.me.id);
    run = fresh;
    run.redraw = draw;
    runs.set(key, run);
    draw({ focus: 'question' });
  }

  // A to D choose, Enter checks or goes on (never while typing elsewhere or in a dialog)
  document.addEventListener('keydown', (e) => {
    if (!ctx.alive() || run.finished || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const target = e.target;
    const typing = target?.matches?.('input, textarea, select, [contenteditable="true"]');
    const id = run.ids[run.index];
    const item = run.items.get(id);
    if (!typing && /^[a-d]$/i.test(e.key) && item.kind === 'mc' && !answered(run, id)) {
      e.preventDefault();
      const letter = e.key.toUpperCase();
      if (letter.charCodeAt(0) - 65 >= (item.choices?.length ?? 0)) return;
      run.drafts.set(id, letter);
      redraw({ focus: `sat-choice-${letter}` });
      return;
    }
    if (e.key !== 'Enter') return;
    if (target?.closest?.('a, button') && !target.closest('.sat-choices')) return;
    if (typing && !target.classList.contains('sat-spr-input')) return;
    const primary = body.querySelector('[data-focus-key="sat-check"], [data-focus-key="sat-next"]');
    if (!primary || primary.disabled) return;
    e.preventDefault();
    primary.click();
  }, { signal: ctx.signal });

  draw();
  ctx.announce(run.finished ? `${set.title}, complete` : `${set.title}, question ${run.index + 1} of ${run.ids.length}`);
}
