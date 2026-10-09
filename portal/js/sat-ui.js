// DOM pieces the SAT views share (views/sat*.js): the "not turned on" state,
// progress meters, PDF buttons, and a question drawn the Bluebook way:
// passage, stem, then A to D choice buttons or a grid-in box, with the
// correct and chosen answers marked once they are known.
//
// Markup (portal/css/sat.css, prefix sat-):
//   div.sat-q (+ .has-passage: passage and question side by side at 1024px)
//     div.sat-q-passage > div.sat-doc
//     div.sat-q-main > div.sat-q-head + div.sat-q-stem > div.sat-doc
//       + div.sat-choices[role=radiogroup] > button.sat-choice[role=radio][aria-checked]
//           (+ .is-correct | .is-wrong | .is-dim) > span.sat-choice-letter + div.sat-choice-body
//       | div.sat-spr > label + input.input.sat-spr-input + p.sat-spr-hint
//   section.sat-explain (+ .is-correct | .is-wrong) > p.sat-explain-verdict + div.sat-doc

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, emptyState, errorCallout } from './ui.js';
import { satDoc, satDocText, typesetSatDoc } from './sat-doc.js';
import { fileUrl, openable, resetSat, SAT_BUCKET } from './sat-data.js';
import { wireFileOpen } from './materials-ui.js';
import { LETTERS, SPR_MAX, SPR_MAX_NEGATIVE, sprInput, answerText, pct, DIFFICULTY_LABELS } from './sat-model.js';

export const STAFF = new Set(['tutor', 'admin']);
export const isStaff = (ctx) => STAFF.has(ctx.role);

// A figure in the sat-files bucket, from a short-lived signed link
export const figure = (src) => fileUrl(src);

export function typeset(root) {
  return typesetSatDoc(root);
}

// The page a student sees when SAT is not turned on for them
export function notOnState() {
  return emptyState({
    icon: 'lock-simple',
    text: 'SAT practice is not turned on for you yet. If you would like to use it, ask your tutor.',
    action: { label: 'Back to Overview', href: '#/overview' },
  });
}

// The error callout every SAT page shows when its data cannot load. Try
// again drops what SAT cached and redraws the page.
export function loadError(ctx, body, title) {
  body.replaceChildren(errorCallout({
    title,
    text: 'Check your connection and try again.',
    onRetry: () => {
      resetSat();
      ctx.store.invalidate(ctx.scope?.student?.id ?? null);
    },
  }));
}

// A thin bar showing a percent (null draws an empty track); its words are
// read out instead of the bar
export function meter(percent, label, { tone = null } = {}) {
  const fill = h('span', { class: 'sat-meter-fill' });
  const value = percent === null || percent === undefined ? 0 : Math.max(0, Math.min(100, percent));
  fill.style.setProperty('--pct', `${value}%`);
  return h('span', { class: ['sat-meter', tone ? `is-${tone}` : null].filter(Boolean).join(' '), role: 'img', 'aria-label': label }, fill);
}

// "75% correct, 12 answered" or "Not started"
export function accuracyText(stat) {
  if (!stat?.answered) return 'Not started';
  return `${pct(stat.correct, stat.answered)}% correct, ${stat.answered} answered`;
}

export function difficultyPill(level) {
  if (!DIFFICULTY_LABELS[level]) return null;
  return h('span', { class: `sat-level is-${level}` }, DIFFICULTY_LABELS[level]);
}

// A button that opens a PDF in the sat-files bucket from a signed link
export function pdfButton(ctx, file, { label = 'Open', variant = 'secondary', size = 'sm', ariaLabel, className } = {}) {
  const btn = button({
    label, variant, size, iconEnd: 'arrow-square-out', ariaLabel: ariaLabel ?? `Open ${file.title}`,
    className, focusKey: `sat-pdf-${file.id}`,
  });
  wireFileOpen(btn, openable(file), {
    lazy: true,
    bucket: SAT_BUCKET,
    onError: () => ctx.toast({ text: 'This file could not be opened. Try again.' }),
  });
  return btn;
}

// ---------------------------------------------------------------------------
// A question

// The passage pane, or null
export function passagePane(item) {
  if (!item?.passage) return null;
  return h('div', { class: 'sat-q-passage' }, satDoc(item.passage, { figure }));
}

// A to D choice buttons. reveal: { answer, response } once the answer is known
// (the correct one is marked, a wrong choice too, the rest are dimmed)
export function choiceList(item, { selected = null, onChoose = null, reveal = null, disabled = false, label = 'Answer choices' } = {}) {
  const choices = Array.isArray(item?.choices) ? item.choices : [];
  const group = h('div', { class: 'sat-choices', role: 'radiogroup', 'aria-label': label });
  choices.forEach((choice, i) => {
    const letter = LETTERS[i] ?? String(i + 1);
    const chosen = selected === letter;
    let state = null;
    if (reveal) {
      if (reveal.answer === letter) state = 'is-correct';
      else if (reveal.response === letter) state = 'is-wrong';
      else state = 'is-dim';
    }
    const words = satDocText(choice);
    // A choice that is only punctuation or a word fragment (",", "; but") is
    // set larger, so a comma can be told from a period
    const mark = state === 'is-correct' ? icon('check', { size: 14 }) : state === 'is-wrong' ? icon('x', { size: 14 }) : null;
    const suffix = state === 'is-correct' ? ', correct answer' : state === 'is-wrong' ? ', your answer, incorrect' : '';
    const short = words.trim().length <= 3 && !JSON.stringify(choice ?? '').includes('"tex"');
    const btn = h('button', {
      type: 'button',
      class: ['sat-choice', state, short ? 'is-short' : null].filter(Boolean).join(' '),
      role: 'radio',
      'aria-checked': chosen || (reveal && reveal.response === letter) ? 'true' : 'false',
      'aria-label': `${letter}. ${words}${suffix}`,
      disabled: disabled || Boolean(reveal),
      dataset: { letter, focusKey: `sat-choice-${letter}` },
      onClick: () => onChoose?.(letter),
    },
    h('span', { class: 'sat-choice-letter', 'aria-hidden': 'true' }, mark ?? letter),
    h('span', { class: 'sat-choice-body', 'aria-hidden': 'true' }, satDoc(choice, { figure })));
    group.append(btn);
  });
  // Arrow keys move between choices, as in any radio group
  group.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const buttons = [...group.querySelectorAll('button.sat-choice:not(:disabled)')];
    const at = buttons.indexOf(document.activeElement);
    if (at === -1) return;
    e.preventDefault();
    const next = buttons[(at + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
    next?.focus();
  });
  return group;
}

// The grid-in box: at most 5 characters (6 with a minus sign)
export function sprField(item, { value = '', onInput = null, disabled = false, reveal = null } = {}) {
  const id = uid('sat-spr');
  const hintId = `${id}-hint`;
  const input = h('input', {
    class: 'input sat-spr-input num',
    id,
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    maxlength: String(SPR_MAX_NEGATIVE),
    'aria-describedby': hintId,
    disabled: disabled || Boolean(reveal),
    dataset: { focusKey: 'sat-spr' },
  });
  input.value = value ?? '';
  input.addEventListener('input', () => {
    const clean = sprInput(input.value);
    if (clean !== input.value) input.value = clean;
    onInput?.(clean);
  });
  const state = reveal ? (reveal.correct ? 'is-correct' : 'is-wrong') : null;
  return h('div', { class: ['sat-spr', state].filter(Boolean).join(' ') },
    h('label', { class: 'field-label', for: id }, reveal ? 'Answer given' : 'Your answer'),
    input,
    h('p', { class: 'sat-spr-hint', id: hintId, hidden: Boolean(reveal) },
      `Up to ${SPR_MAX} characters, ${SPR_MAX_NEGATIVE} with a minus sign. A fraction like 7/2 or a decimal like 3.5 both work.`));
}

// The stem, then the choices or the grid-in box
export function questionMain(item, { head = null, choices }) {
  return h('div', { class: 'sat-q-main' },
    head,
    h('div', { class: 'sat-q-stem' }, satDoc(item.stem, { figure })),
    choices);
}

// Passage and question together
export function questionLayout(item, main) {
  const passage = passagePane(item);
  return h('div', { class: passage ? 'sat-q has-passage' : 'sat-q' }, passage, main);
}

// "Correct" or "Incorrect. The correct answer is C.", then the explanation.
// asKey: staff looking at a question's key, not at anyone's answer
export function explanation(item, result, { heading = 'Explanation', asKey = false } = {}) {
  const right = Boolean(result?.correct);
  const answered = result?.response !== null && result?.response !== undefined && result?.response !== '';
  const ans = answerText(item.kind, result?.answer, result?.accept);
  let verdict;
  if (asKey) verdict = ans ? `Answer on file: ${ans}.` : 'No answer on file.';
  else if (right) verdict = 'Correct.';
  else if (!answered) verdict = ans ? `Not answered. The correct answer is ${ans}.` : 'Not answered.';
  else verdict = ans ? `Incorrect. The correct answer is ${ans}.` : 'Incorrect.';
  const glyph = icon(asKey ? 'info' : right ? 'check-circle' : 'x-circle', { size: 20 });
  glyph.classList.add('sat-explain-icon');
  const tone = asKey ? 'is-key' : right ? 'is-correct' : 'is-wrong';
  return h('section', { class: ['sat-explain', tone].join(' '), 'aria-label': heading },
    h('p', { class: 'sat-explain-verdict' }, glyph, h('span', {}, verdict)),
    result?.explanation ? h('div', { class: 'sat-explain-body' }, h('h3', { class: 'sat-explain-title' }, heading), satDoc(result.explanation, { figure })) : null);
}

// An item number badge: "1"
export const numberBadge = (n) => h('span', { class: 'sat-q-num num', 'aria-hidden': 'true' }, String(n));
