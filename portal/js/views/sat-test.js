// The timed runner, #/sat/test/<set id>[?module=&sitting=], made to feel like
// Bluebook: a sticky bar with the module and the countdown (Hide or Show; it
// turns amber and stays shown in the last five minutes), the question with
// Mark for review, and a bottom bar with the question navigator, Back and
// Next. After the last question, Check your work lists every question;
// Submit module asks first and says how many have no answer. When the time
// runs out the module is submitted on its own.
//
// Every answer and flag is saved as it is chosen (sat_answer; a grid-in a
// moment after typing stops), so a reload picks the module up again: the
// server returns the open attempt and its deadline (sat_start) and this
// device's clock is corrected by the server's (server_now).
//
// A skill test is one module. A full test is rw1, rw2, m1 and m2 in one
// sitting (?sitting= in the URL once it starts): after rw2 a 10 minute
// break can be taken, and after m2 the results show Reading and Writing and
// Math raw scores and a breakdown by domain. Results never show before a
// module is submitted. Staff answer as themselves (a preview).

import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import { button, emptyState, skeletonRows, busy } from '../ui.js';
import { firstName, displayName } from '../format.js';
import { shortDay } from '../dates.js';
import {
  modulesOf, nextModule, BREAK_AFTER, BREAK_MINUTES, formatClock, clockWords, remainingMs, timerTone, timerAnnouncement,
  minutesText, satCrumbs, reviewHref, scoreText, pct, unansweredCount, submitConfirmText, sittings, sittingNext, fullScore,
  domainBreakdown, sectionName, LETTERS, testHref, GRACE_MS, isOpen,
} from '../sat-model.js';
import {
  getContent, getItems, getAttempts, start, answer, submit, review, dropProgress, errorCode, attemptResponses,
} from '../sat-data.js';
import {
  isStaff, choiceList, sprField, questionMain, questionLayout, typeset, numberBadge, meter, loadError,
} from '../sat-ui.js';

const runs = new Map();   // `${person}|${set}` -> the module being taken
const SPR_SAVE_MS = 700;
const RETRY_MS = 3000;

export async function mount(ctx, where) {
  const { host } = ctx;
  const staff = isStaff(ctx);
  const setId = where.id;
  const key = `${ctx.me.id}|${setId}`;
  ctx.setHeader({ title: 'Test', crumbs: satCrumbs(ctx.route, { title: 'Test' }) });
  const body = h('div', { class: 'sat-view sat-runner is-test' }, skeletonRows(3));
  host.append(body);

  let content;
  try {
    content = await getContent();
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    loadError(ctx, body, 'We couldn’t load this test.');
    return;
  }
  if (!ctx.alive()) return;
  const set = content.setsById.get(setId);
  if (!set || (set.kind !== 'skill_test' && set.kind !== 'full_test')) {
    ctx.setHeader({ title: 'Test not found', crumbs: satCrumbs(ctx.route, { title: 'Not found' }) });
    body.replaceChildren(emptyState({ icon: 'magnifying-glass', text: 'We couldn’t find that test.', action: { label: 'All tests', href: '#/sat/tests' } }));
    ctx.announce('Test not found');
    return;
  }
  const full = set.kind === 'full_test';
  const mods = modulesOf(set);
  ctx.setHeader({ title: set.title, crumbs: satCrumbs(ctx.route, { title: set.title }), docTitle: set.title });

  const live = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const say = (text) => {
    live.textContent = '';
    setTimeout(() => { if (ctx.alive()) live.textContent = text; }, 50);
  };
  const previewNote = () => (staff
    ? h('p', { class: 'sat-preview-note' }, icon('info'), h('span', {}, `Preview: you are answering as yourself. ${firstName(displayName(ctx.scope.student))}’s progress does not change.`))
    : null);
  const modOf = (k) => mods.find((m) => m.key === k) ?? null;
  const modTitle = (k) => modOf(k)?.title ?? set.title;
  const modNumber = (k) => mods.findIndex((m) => m.key === k) + 1;

  // The module being taken, kept across redraws
  let run = runs.get(key) ?? null;
  const wanted = full ? where.module : (where.module ?? mods[0]?.key ?? null);
  if (run && (run.module !== wanted || (where.sitting && run.sitting !== where.sitting))) run = null;
  let timer = null;

  // ---- Screens before and between modules ---------------------------------

  function screen(...children) {
    stopTimer();
    body.replaceChildren(...[previewNote(), ...children, live].filter(Boolean));
    body.querySelector('.sat-screen-title')?.focus({ preventScroll: true });
  }

  function introCard({ kicker, title, lines, action }) {
    return h('section', { class: 'card sat-intro', 'aria-labelledby': 'sat-intro-title' },
      kicker ? h('p', { class: 'sat-kicker' }, kicker) : null,
      h('h2', { class: 'sat-screen-title', id: 'sat-intro-title', tabindex: '-1' }, title),
      h('ul', { class: 'sat-intro-list' }, lines.filter(Boolean).map((t) => h('li', {}, icon('check', { size: 14 }), h('span', {}, t)))),
      h('div', { class: 'sat-intro-actions' }, action));
  }

  function moduleIntro(moduleKey, sitting) {
    const m = modOf(moduleKey) ?? mods[0];
    const n = content.counts.get(set.id)?.byModule?.[moduleKey ?? ''] ?? content.counts.get(set.id)?.total ?? 0;
    const startBtn = button({
      label: full ? `Start module ${modNumber(m.key)}` : 'Start the test', variant: 'primary', size: 'lg', focusKey: 'sat-start',
      onClick: (e) => begin(e.currentTarget, m.key, sitting),
    });
    screen(introCard({
      kicker: full ? `${set.title}, module ${modNumber(m.key)} of ${mods.length}` : set.title,
      title: m.title ?? set.title,
      lines: [
        `${n} ${n === 1 ? 'question' : 'questions'}, ${minutesText(m.minutes)}.`,
        'The timer starts when you choose Start and keeps running if you leave the page.',
        'Your answers save as you go. Mark for review flags a question to come back to.',
        'When time runs out, the module is submitted for you. Your score and the explanations come after.',
      ],
      action: startBtn,
    }));
    ctx.announce(`${m.title}, ready to start`);
  }

  async function fullOverview() {
    let attempts = [];
    try {
      attempts = await getAttempts(ctx.me.id);
    } catch (error) {
      console.error(error);
    }
    if (!ctx.alive()) return;
    const sits = [...sittings(attempts, set).values()].sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
    const open = sits.find((s) => !s.done && sittingNext(s, set));
    const next = open ? sittingNext(open, set) : null;
    const minutes = mods.reduce((t, m) => t + m.minutes, 0);
    const action = open
      ? button({ label: `Continue: ${modTitle(next.key)}`, variant: 'primary', size: 'lg', href: testHref(set.id, { module: next.key, sitting: open.sitting }), focusKey: 'sat-start' })
      : button({ label: 'Start module 1', variant: 'primary', size: 'lg', focusKey: 'sat-start', onClick: (e) => begin(e.currentTarget, mods[0].key, null) });
    const done = sits.filter((s) => s.done);
    screen(
      introCard({
        kicker: 'Full practice test',
        title: set.title,
        lines: [
          `${mods.length} modules: ${mods.map((m) => `${m.title} (${minutesText(m.minutes)})`).join(', ')}.`,
          `${minutesText(minutes)} in all, with an optional ${BREAK_MINUTES} minute break before Math.`,
          'Each module is timed on its own. Once you submit a module you cannot go back to it.',
          'Your results show after the last module: raw scores for Reading and Writing and for Math, and how you did in each domain.',
        ],
        action,
      }),
      done.length ? h('section', { class: 'card sat-past', 'aria-labelledby': 'sat-past-title' },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: 'sat-past-title' }, 'Past results')),
        h('ul', { class: 'sat-review-links' }, done.map((s) => {
          const sc = fullScore(s, set);
          return h('li', {}, `${shortDay(s.started_at)}: ${sc.correct} of ${sc.total} (${pct(sc.correct, sc.total)}%) `,
            ...mods.map((m, i) => [i ? ', ' : '', h('a', { class: 'link', href: reviewHref(s.modules[m.key].id) }, `review ${m.title}`)]));
        }))) : null);
    ctx.announce(set.title);
  }

  function breakScreen(sitting, nextKey) {
    const ends = Date.now() + BREAK_MINUTES * 60_000;
    const clock = h('p', { class: 'sat-break-clock num', role: 'timer', 'aria-label': 'Break time left' }, formatClock(ends - Date.now()));
    const go = button({ label: `Resume testing: ${modTitle(nextKey)}`, variant: 'primary', size: 'lg', focusKey: 'sat-resume', onClick: () => moduleIntro(nextKey, sitting) });
    screen(h('section', { class: 'card sat-intro sat-break', 'aria-labelledby': 'sat-break-title' },
      h('p', { class: 'sat-kicker' }, 'Reading and Writing is done'),
      h('h2', { class: 'sat-screen-title', id: 'sat-break-title', tabindex: '-1' }, `Take a ${BREAK_MINUTES} minute break`),
      clock,
      h('p', { class: 'sat-muted' }, 'Stretch, get some water, rest your eyes. Math is next: two modules, and a calculator is allowed. Resume whenever you are ready.'),
      h('div', { class: 'sat-intro-actions' }, go)));
    const tick = () => {
      if (!ctx.alive() || !clock.isConnected) return;
      const left = ends - Date.now();
      clock.textContent = left > 0 ? formatClock(left) : 'Break is over';
      if (left > 0) setTimeout(tick, 500);
      else say('Your break is over.');
    };
    tick();
    ctx.announce('Break');
  }

  function betweenScreen(sitting, doneKey) {
    const next = nextModule(set, doneKey);
    if (!next) return finalResults(sitting);
    if (doneKey === BREAK_AFTER) return breakScreen(sitting, next.key);
    const startBtn = button({
      label: `Start module ${modNumber(next.key)}`, variant: 'primary', size: 'lg', focusKey: 'sat-start',
      onClick: (e) => begin(e.currentTarget, next.key, sitting),
    });
    screen(h('section', { class: 'card sat-intro', 'aria-labelledby': 'sat-between-title' },
      h('p', { class: 'sat-kicker' }, `${modTitle(doneKey)} submitted`),
      h('h2', { class: 'sat-screen-title', id: 'sat-between-title', tabindex: '-1' }, `Next: ${next.title}`),
      h('p', { class: 'sat-muted' }, `${content.counts.get(set.id)?.byModule?.[next.key] ?? 0} questions, ${minutesText(next.minutes)}. The timer starts when you choose Start.`),
      h('div', { class: 'sat-intro-actions' }, startBtn)));
    ctx.announce(`${modTitle(doneKey)} submitted`);
  }

  // ---- Results ---------------------------------------------------------------

  function breakdownList(rows, label) {
    if (!rows.length) return null;
    return h('ul', { class: 'sat-breakdown', 'aria-label': label }, rows.map((r) => {
      const p = pct(r.correct, r.total);
      return h('li', { class: 'sat-breakdown-row' },
        h('span', { class: 'sat-breakdown-name' }, r.name),
        meter(p, `${r.name}: ${r.correct} of ${r.total} correct`),
        h('span', { class: 'sat-breakdown-figure num' }, `${r.correct} of ${r.total}`));
    }));
  }

  function moduleResults(result) {
    const items = result?.items ?? [];
    const correct = result?.correct ?? items.filter((r) => r.correct).length;
    const total = result?.total ?? items.length;
    // A skill test covers one domain: break it down by skill
    const bySkill = new Map();
    for (const r of items) {
      const it = content.index.get(r.item);
      const name = content.skillsBySlug.get(it?.skill)?.name ?? 'Other';
      const c = bySkill.get(name) ?? { name, correct: 0, total: 0 };
      c.total += 1;
      if (r.correct) c.correct += 1;
      bySkill.set(name, c);
    }
    screen(h('section', { class: 'card sat-result', 'aria-labelledby': 'sat-result-title' },
      h('p', { class: 'sat-kicker' }, run?.auto ? 'Time is up: your answers were submitted' : 'Module submitted'),
      h('h2', { class: 'sat-screen-title', id: 'sat-result-title', tabindex: '-1' }, 'Your results'),
      h('div', { class: 'sat-result-score' },
        h('p', { class: 'sat-result-figure num' }, `${correct} of ${total}`),
        h('p', { class: 'sat-result-pct num' }, `${pct(correct, total) ?? 0}% correct`)),
      bySkill.size ? h('h3', { class: 'sat-sub-title' }, 'By skill') : null,
      breakdownList([...bySkill.values()], 'By skill'),
      h('div', { class: 'sat-intro-actions' },
        button({ label: 'Review answers', variant: 'primary', href: reviewHref(result?.attempt?.id), focusKey: 'sat-review' }),
        button({ label: 'All tests', variant: 'secondary', href: '#/sat/tests' }))));
    say(`Your results: ${correct} of ${total} correct.`);
  }

  async function finalResults(sitting) {
    screen(skeletonRows(3));
    let sit;
    let reviews = [];
    try {
      dropProgress(ctx.me.id);
      const attempts = await getAttempts(ctx.me.id);
      sit = sittings(attempts, set).get(sitting);
      reviews = await Promise.all(mods.map((m) => (sit?.modules[m.key] ? review(sit.modules[m.key].id) : null)));
    } catch (error) {
      console.error(error);
    }
    if (!ctx.alive()) return;
    if (!sit) {
      screen(emptyState({ icon: 'warning-circle', text: 'We couldn’t load the results. They are saved; open them from Tests.', action: { label: 'All tests', href: '#/sat/tests' } }));
      return;
    }
    const score = fullScore(sit, set);
    const items = reviews.flatMap((r) => r?.items ?? []);
    const domains = domainBreakdown(items, content.index).map((d) => ({ name: d.domain.name, correct: d.correct, total: d.total }));
    const block = (key) => {
      const s = score.sections[key];
      return h('div', { class: 'sat-result-section' },
        h('p', { class: 'sat-result-label' }, sectionName(key)),
        h('p', { class: 'sat-result-figure num' }, `${s.correct}/${s.total}`),
        h('p', { class: 'sat-result-pct num' }, s.total ? `${pct(s.correct, s.total)}% correct` : 'No questions'));
    };
    screen(h('section', { class: 'card sat-result', 'aria-labelledby': 'sat-result-title' },
      h('p', { class: 'sat-kicker' }, set.title),
      h('h2', { class: 'sat-screen-title', id: 'sat-result-title', tabindex: '-1' }, 'Full practice test complete'),
      h('div', { class: 'sat-result-sections' }, block('rw'), block('math')),
      h('p', { class: 'sat-muted' }, `Total: ${score.correct} of ${score.total} correct. These are raw scores: a practice test like this has no official 200 to 1600 score.`),
      domains.length ? [h('h3', { class: 'sat-sub-title' }, 'By domain'), breakdownList(domains, 'By domain')] : null,
      h('h3', { class: 'sat-sub-title' }, 'Review each module'),
      h('ul', { class: 'sat-review-links' }, mods.map((m) => (sit.modules[m.key]
        ? h('li', {}, h('a', { class: 'link', href: reviewHref(sit.modules[m.key].id) }, `${m.title}: ${scoreText(sit.modules[m.key].correct ?? 0, sit.modules[m.key].total ?? 0)}`))
        : null))),
      h('div', { class: 'sat-intro-actions' }, button({ label: 'All tests', variant: 'secondary', href: '#/sat/tests' }))));
    say(`Full practice test complete. Reading and Writing ${score.sections.rw.correct} of ${score.sections.rw.total}. Math ${score.sections.math.correct} of ${score.sections.math.total}.`);
  }

  // ---- Starting a module -------------------------------------------------------

  async function begin(btn, moduleKey, sitting) {
    let next;
    try {
      next = await busy(btn, 'Starting…', () => openRun(moduleKey, sitting));
    } catch (error) {
      console.error(error);
      const code = errorCode(error);
      ctx.toast({
        text: code === 'already_taken' ? 'You already submitted this module.'
          : code === 'previous_module_open' ? 'Finish the module before this one first.'
            : 'We couldn’t start the test. Try again.',
      });
      return;
    }
    if (!ctx.alive()) return;
    run = next;
    runs.set(key, run);
    if (full && (where.module !== run.module || where.sitting !== run.sitting)) {
      ctx.setParams({ module: run.module, sitting: run.sitting }, { replace: true });
    }
    play();
  }

  async function openRun(moduleKey, sitting) {
    const started = await start(set.id, moduleKey, sitting);
    const [items, saved] = await Promise.all([getItems(set.id, started.module), attemptResponses(started.attempt_id)]);
    dropProgress(ctx.me.id);
    const answers = new Map();
    for (const r of saved) answers.set(r.item_id, { response: r.response ?? '', flagged: Boolean(r.flagged) });
    const ids = (started.items ?? []).filter((id) => items.has(id));
    return {
      module: started.module,
      sitting: started.sitting,
      attemptId: started.attempt_id,
      deadline: started.deadline_at,
      skew: Date.parse(started.server_now) - Date.now() || 0,
      ids,
      items,
      answers,
      index: 0,
      phase: 'question',
      hideClock: false,
      navOpen: false,
      pending: new Map(),
      saving: null,
      saveError: false,
      sprTimer: null,
      lastMs: null,
      result: null,
      redraw: null,
    };
  }

  // ---- Saving ----------------------------------------------------------------

  const answerOf = (id) => run.answers.get(id) ?? { response: '', flagged: false };

  function queueSave(id, patch) {
    run.pending.set(id, { ...(run.pending.get(id) ?? {}), ...patch });
    flush();
  }

  function flush() {
    if (run.saving) return run.saving;
    const r = run;
    r.saving = (async () => {
      while (r.pending.size && !r.result) {
        const [id, patch] = r.pending.entries().next().value;
        r.pending.delete(id);
        try {
          await answer(r.attemptId, id, 'response' in patch ? patch.response : null, 'flagged' in patch ? patch.flagged : null);
          r.saveError = false;
        } catch (error) {
          const code = errorCode(error);
          if (code === 'time_up' || code === 'submitted') {
            r.pending.clear();
            if (r === run) setTimeout(() => autoSubmit(), 0);
            break;
          }
          console.error(error);
          r.pending.set(id, { ...patch, ...(r.pending.get(id) ?? {}) });
          if (!r.saveError && r === run) say('An answer has not saved yet. Trying again.');
          r.saveError = true;
          setTimeout(() => { if (runs.get(key) === r) flush(); }, RETRY_MS);
          break;
        }
      }
      r.saving = null;
      if (r === run) drawStatus();
    })();
    drawStatus();
    return r.saving;
  }

  function flushSpr() {
    if (!run?.sprTimer) return;
    clearTimeout(run.sprTimer.timer);
    queueSave(run.sprTimer.id, { response: run.sprTimer.value });
    run.sprTimer = null;
  }

  async function settleSaves() {
    flushSpr();
    for (let i = 0; i < 3 && (run.pending.size || run.saving); i += 1) await (run.saving ?? flush());
    return run.pending.size === 0;
  }

  // ---- The timer -------------------------------------------------------------

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function tick() {
    if (!ctx.alive() || !run || run.result) {
      stopTimer();
      return;
    }
    const ms = remainingMs(run.deadline, Date.now(), run.skew);
    const clock = body.querySelector('.sat-clock');
    if (clock) {
      const tone = timerTone(ms);
      clock.classList.toggle('is-warning', tone === 'warning');
      const hidden = run.hideClock && tone !== 'warning';
      clock.classList.toggle('is-hidden', hidden);
      const time = clock.querySelector('.sat-clock-time');
      time.textContent = hidden ? '' : formatClock(ms);
      time.setAttribute('aria-label', clockWords(ms));
      const toggle = clock.querySelector('.sat-clock-toggle .btn-label');
      if (toggle) toggle.textContent = hidden ? 'Show' : 'Hide';
      clock.querySelector('.sat-clock-toggle').hidden = tone === 'warning';
    }
    if (run.lastMs !== null) {
      const words = timerAnnouncement(run.lastMs, ms);
      if (words) say(words);
    }
    run.lastMs = ms;
    if (ms <= 0 && (run.phase === 'question' || run.phase === 'check')) autoSubmit();
  }

  function startTimer() {
    stopTimer();
    timer = setInterval(tick, 500);
    ctx.signal.addEventListener('abort', stopTimer, { once: true });
    tick();
  }

  // ---- Submitting ------------------------------------------------------------

  async function finishModule({ auto = false } = {}) {
    if (run.phase === 'submitting' || run.result) return;
    const r = run;
    r.phase = 'submitting';
    r.auto = auto;
    const all = await settleSaves();
    if (!all && !auto && remainingMs(r.deadline, Date.now(), r.skew) > -GRACE_MS) {
      r.phase = 'check';
      redraw();
      ctx.toast({ text: 'Some answers have not saved yet. Check your connection, then submit again.' });
      return;
    }
    redraw();
    let result = null;
    for (let i = 0; i < 3 && !result; i += 1) {
      try {
        result = await submit(r.attemptId);
      } catch (error) {
        console.error(error);
        await new Promise((res) => setTimeout(res, 1500));
      }
    }
    dropProgress(ctx.me.id);
    if (!result) {
      r.phase = 'check';
      if (runs.get(key) === r) redraw();
      ctx.toast({ text: 'The module did not submit. Check your connection and try again.' });
      return;
    }
    r.result = result;
    stopTimer();
    if (runs.get(key) !== r) return;
    after();
  }

  function autoSubmit() {
    if (!run || run.result || run.phase === 'submitting') return;
    const dialog = document.getElementById('confirm');
    if (dialog?.open) dialog.close();
    say('Time is up. Your answers are being submitted.');
    finishModule({ auto: true });
  }

  async function submitClicked(btn) {
    flushSpr();
    const left = unansweredCount(run.ids, new Map([...run.answers].filter(([, a]) => a.response)));
    const ok = await ctx.confirm({
      title: `Submit ${full ? modTitle(run.module) : 'this test'}?`,
      body: submitConfirmText(left),
      confirmLabel: 'Submit module',
      tone: 'primary',
    });
    if (!ok || !ctx.alive() || run.result) return;
    await busy(btn, 'Submitting…', () => finishModule());
  }

  // After a submit: results, or the break, or the next module. The finished
  // run stays in `runs` so a redraw of this page shows the same screen.
  function after() {
    if (!ctx.alive()) return;
    const r = run;
    if (!full) moduleResults(r.result);
    else betweenScreen(r.sitting, r.module);
  }

  // ---- The runner ------------------------------------------------------------

  function statusText() {
    if (run.saveError) return 'Not saved yet. Trying again…';
    if (run.saving || run.pending.size || run.sprTimer) return 'Saving…';
    return 'All answers saved';
  }

  function drawStatus() {
    const el = body.querySelector('.sat-save');
    if (!el) return;
    el.textContent = statusText();
    el.classList.toggle('is-error', run.saveError);
  }

  function topBar() {
    const timeEl = h('span', { class: 'sat-clock-time num', role: 'timer' });
    const toggle = button({
      label: 'Hide', variant: 'ghost', size: 'sm', className: 'sat-clock-toggle', focusKey: 'sat-clock-toggle',
      onClick: () => {
        run.hideClock = !run.hideClock;
        tick();
      },
    });
    return h('div', { class: 'sat-test-bar' },
      h('div', { class: 'sat-test-bar-title' },
        h('span', { class: 'sat-test-bar-module' }, modTitle(run.module)),
        h('span', { class: 'sat-test-bar-set' }, full ? `${set.title}, module ${modNumber(run.module)} of ${mods.length}` : 'Skill test')),
      h('div', { class: 'sat-clock' }, icon('clock'), h('span', { class: 'visually-hidden' }, 'Time left: '), timeEl, toggle),
      h('p', { class: 'sat-save' }, statusText()));
  }

  function navGrid({ onPick, current = null }) {
    return h('ol', { class: 'sat-nav-grid' }, run.ids.map((id, i) => {
      const a = answerOf(id);
      const state = [a.response ? 'is-answered' : 'is-open', a.flagged ? 'is-flagged' : null, current === i ? 'is-current' : null].filter(Boolean).join(' ');
      const words = [`Question ${i + 1}`, a.response ? 'answered' : 'unanswered', a.flagged ? 'marked for review' : null, current === i ? 'current' : null].filter(Boolean).join(', ');
      return h('li', {}, h('button', {
        type: 'button', class: `sat-nav-btn ${state}`, 'aria-label': words, 'aria-current': current === i ? 'step' : undefined,
        dataset: { focusKey: `sat-nav-${i}` }, onClick: () => onPick(i),
      }, h('span', { class: 'num' }, String(i + 1)), a.flagged ? icon('bookmark-simple', { size: 12 }) : null));
    }));
  }

  const legend = () => h('ul', { class: 'sat-nav-legend', 'aria-hidden': 'true' },
    h('li', {}, h('span', { class: 'sat-nav-key is-current' }), 'Current'),
    h('li', {}, h('span', { class: 'sat-nav-key is-open' }), 'Unanswered'),
    h('li', {}, h('span', { class: 'sat-nav-key is-answered' }), 'Answered'),
    h('li', {}, icon('bookmark-simple', { size: 12 }), 'For review'));

  function questionView() {
    const id = run.ids[run.index];
    const item = run.items.get(id);
    const a = answerOf(id);
    const flag = h('button', {
      type: 'button',
      class: ['sat-flag', a.flagged ? 'is-on' : null].filter(Boolean).join(' '),
      'aria-pressed': a.flagged ? 'true' : 'false',
      dataset: { focusKey: 'sat-flag' },
      onClick: () => {
        const next = !answerOf(id).flagged;
        run.answers.set(id, { ...answerOf(id), flagged: next });
        queueSave(id, { flagged: next });
        redraw({ focus: 'sat-flag' });
      },
    }, icon('bookmark-simple'), h('span', {}, 'Mark for review'));
    const choices = item.kind === 'mc'
      ? choiceList(item, {
        selected: a.response || null,
        onChoose: (letter) => choose(id, letter),
      })
      : sprField(item, {
        value: a.response,
        onInput: (value) => {
          run.answers.set(id, { ...answerOf(id), response: value });
          if (run.sprTimer && run.sprTimer.id !== id) flushSpr();
          if (run.sprTimer) clearTimeout(run.sprTimer.timer);
          run.sprTimer = { id, value, timer: setTimeout(() => flushSpr(), SPR_SAVE_MS) };
          drawStatus();
        },
      });
    const head = h('div', { class: 'sat-q-head' }, numberBadge(run.index + 1), flag);
    const main = questionMain(item, { head, choices });
    main.setAttribute('tabindex', '-1');
    main.classList.add('sat-focus-target');
    return questionLayout(item, main);
  }

  function choose(id, letter) {
    run.answers.set(id, { ...answerOf(id), response: letter });
    queueSave(id, { response: letter });
    redraw({ focus: `sat-choice-${letter}` });
  }

  function bottomBar() {
    const last = run.index === run.ids.length - 1;
    const panelId = uid('sat-nav');
    const navBtn = h('button', {
      type: 'button', class: 'sat-nav-toggle', 'aria-expanded': run.navOpen ? 'true' : 'false', 'aria-controls': panelId,
      dataset: { focusKey: 'sat-nav-toggle' },
      onClick: () => {
        run.navOpen = !run.navOpen;
        redraw({ focus: 'sat-nav-toggle' });
      },
    }, h('span', { class: 'num' }, `Question ${run.index + 1} of ${run.ids.length}`), icon('caret-up-down'));
    const panel = run.navOpen ? h('div', { class: 'sat-nav-panel', id: panelId, role: 'group', 'aria-label': 'Questions' },
      h('p', { class: 'sat-nav-title' }, full ? modTitle(run.module) : set.title),
      legend(),
      navGrid({ current: run.index, onPick: (i) => go(i) }),
      button({ label: 'Go to Check your work', variant: 'secondary', size: 'sm', onClick: () => toCheck() })) : null;
    return h('div', { class: 'sat-test-foot' },
      panel,
      navBtn,
      h('span', { class: 'sat-run-foot-gap' }),
      button({ label: 'Back', variant: 'secondary', icon: 'caret-left', disabled: run.index === 0, onClick: () => go(run.index - 1), focusKey: 'sat-back' }),
      button({ label: last ? 'Check your work' : 'Next', variant: 'primary', iconEnd: 'caret-right', onClick: () => (last ? toCheck() : go(run.index + 1)), focusKey: 'sat-next' }));
  }

  function checkView() {
    const left = run.ids.filter((id) => !answerOf(id).response).length;
    const flagged = run.ids.filter((id) => answerOf(id).flagged).length;
    const submitBtn = button({ label: 'Submit module', variant: 'primary', focusKey: 'sat-submit', onClick: (e) => submitClicked(e.currentTarget) });
    if (run.phase === 'submitting') submitBtn.disabled = true;
    return h('section', { class: 'card sat-check', 'aria-labelledby': 'sat-check-title' },
      h('h2', { class: 'sat-screen-title', id: 'sat-check-title', tabindex: '-1' }, 'Check your work'),
      h('p', { class: 'sat-muted' }, [
        left ? `${left} ${left === 1 ? 'question has' : 'questions have'} no answer.` : 'Every question has an answer.',
        flagged ? `${flagged} marked for review.` : null,
        'Select a number to go back to a question. When you are ready, submit the module.',
      ].filter(Boolean).join(' ')),
      legend(),
      navGrid({ onPick: (i) => { run.phase = 'question'; go(i); } }),
      h('div', { class: 'sat-intro-actions' },
        button({ label: 'Back to questions', variant: 'secondary', icon: 'caret-left', onClick: () => { run.phase = 'question'; go(run.ids.length - 1); } }),
        submitBtn));
  }

  function draw({ focus = null } = {}) {
    if (!ctx.alive() || !run) return;
    const parts = [previewNote(), topBar()];
    if (run.phase === 'submitting' && !run.result) {
      parts.push(h('section', { class: 'card sat-intro' }, h('h2', { class: 'sat-screen-title', tabindex: '-1' }, 'Submitting your answers…'), skeletonRows(1)));
    } else if (run.phase === 'check') {
      parts.push(checkView());
    } else {
      parts.push(questionView(), bottomBar());
    }
    parts.push(live);
    body.replaceChildren(...parts.filter(Boolean));
    if (run.phase === 'question') typeset(body);
    tick();
    if (focus === 'question') body.querySelector('.sat-focus-target')?.focus({ preventScroll: true });
    else if (focus === 'title') body.querySelector('.sat-screen-title')?.focus({ preventScroll: true });
    else if (focus) body.querySelector(`[data-focus-key="${focus}"]`)?.focus({ preventScroll: true });
  }
  const redraw = (opts) => run?.redraw?.(opts);

  function go(i) {
    if (i < 0 || i >= run.ids.length) return;
    flushSpr();
    run.index = i;
    run.navOpen = false;
    run.phase = 'question';
    redraw({ focus: 'question' });
    window.scrollTo?.(0, 0);
  }

  function toCheck() {
    flushSpr();
    run.navOpen = false;
    run.phase = 'check';
    redraw({ focus: 'title' });
    window.scrollTo?.(0, 0);
  }

  function play() {
    run.redraw = draw;
    draw({ focus: 'question' });
    startTimer();
    ctx.announce(`${full ? modTitle(run.module) : set.title}, question ${run.index + 1} of ${run.ids.length}`);
    // Time already up (a module left open): submit it now
    if (remainingMs(run.deadline, Date.now(), run.skew) <= 0) autoSubmit();
  }

  // Keys: A to D choose; Enter on a choice goes to the next question
  document.addEventListener('keydown', (e) => {
    if (!ctx.alive() || !run || run.result || run.phase !== 'question' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const target = e.target;
    if (target?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
    const id = run.ids[run.index];
    const item = run.items.get(id);
    if (/^[a-d]$/i.test(e.key) && item?.kind === 'mc') {
      const letter = e.key.toUpperCase();
      if (LETTERS.indexOf(letter) >= (item.choices?.length ?? 0)) return;
      e.preventDefault();
      choose(id, letter);
      return;
    }
    if (e.key === 'Enter' && target?.closest?.('.sat-choices')) {
      e.preventDefault();
      body.querySelector('[data-focus-key="sat-next"]')?.click();
    }
  }, { signal: ctx.signal });

  // ---- Which screen ----------------------------------------------------------

  if (run && run.result) {
    // A redraw of the results (or the screen after a module) shows them again;
    // coming back to the test later starts from its first screen
    if (ctx.isRefresh) {
      if (!full) moduleResults(run.result);
      else betweenScreen(run.sitting, run.module);
      return;
    }
    runs.delete(key);
    run = null;
  }
  if (run) {
    play();
    return;
  }
  if (full && !where.module) {
    await fullOverview();
    return;
  }
  if (!modOf(wanted) && mods.length) {
    body.replaceChildren(emptyState({ icon: 'magnifying-glass', text: 'We couldn’t find that module.', action: { label: 'All tests', href: '#/sat/tests' } }));
    return;
  }

  let attempts = [];
  try {
    attempts = await getAttempts(ctx.me.id);
  } catch (error) {
    console.error(error);
  }
  if (!ctx.alive()) return;
  const sameModule = (a) => a.set_id === set.id && (a.module ?? null) === (wanted ?? null);
  const open = attempts.find((a) => sameModule(a) && isOpen(a) && (!full || !where.sitting || a.sitting === where.sitting));
  if (open) {
    try {
      run = await openRun(wanted, full ? open.sitting : null);
      runs.set(key, run);
    } catch (error) {
      if (!ctx.alive()) return;
      console.error(error);
      loadError(ctx, body, 'We couldn’t open this test.');
      return;
    }
    if (!ctx.alive()) return;
    if (full && where.sitting !== run.sitting) ctx.setParams({ module: run.module, sitting: run.sitting }, { replace: true });
    play();
    return;
  }
  if (full && where.sitting) {
    const done = attempts.find((a) => sameModule(a) && a.sitting === where.sitting && a.submitted_at);
    if (done) {
      betweenScreen(where.sitting, wanted);
      return;
    }
  }
  moduleIntro(wanted, full ? where.sitting : null);
}

