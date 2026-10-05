// A typed answer on the review page (spec 5.9), shown like the submitted file
// beside it: a slim bar (attempt, word count, Full screen) over a stage that
// holds the answer as a page. Full screen opens it read-only on the same page
// the student wrote it on (the answer editor's look, without the tools).
//
// docPreview(sub, { attempt, title, author, signal }) -> HTMLElement
//   attempt  the attempt number, shown in the bar
//   title    the assignment's title, the full-screen page's heading
//   author   the student's first name ("Leo’s answer, attempt 1")
//   signal   aborts when the view unmounts: a full-screen page still open closes
//
// openDocReader(sub, { title, eyebrow, signal }) -> { close }

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button } from './ui.js';
import { answerContent, answerWords } from './rich-doc-dom.js';

const wordsText = (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'word' : 'words'}`;

// The answer as page content: the formatted document, or the plain text
function pageNodes(sub) {
  const content = answerContent(sub);
  return content.formatted ? content.nodes : [h('p', { class: 'is-pre' }, content.text)];
}

export function docPreview(sub, { attempt = null, title = '', author = '', signal } = {}) {
  const attemptText = attempt ? `attempt ${attempt}` : null;
  const eyebrow = [author ? `${author}’s answer` : 'Answer', attemptText].filter(Boolean).join(', ');
  const full = button({
    label: 'Full screen',
    icon: 'corners-out',
    variant: 'ghost',
    size: 'sm',
    className: 'rvw-file-open',
    ariaLabel: `Read ${author ? `${author}’s` : 'the'} answer full screen`,
    onClick: () => openDocReader(sub, { title, eyebrow, signal }),
  });
  const bar = h('div', { class: 'rvw-file-bar' },
    h('span', { class: 'rvw-file-kind' }, icon('file-text'),
      h('span', {}, 'Document'),
      attemptText ? h('span', { class: 'rvw-file-attempt' }, attemptText) : null),
    h('span', { class: 'rvw-file-size num' }, wordsText(answerWords(sub))),
    full);
  const sheet = h('div', {
    class: 'rvw-doc-sheet doc-view read',
    tabindex: '0',
    role: 'document',
    'aria-label': eyebrow,
  }, pageNodes(sub));
  return h('section', { class: 'rvw-file rvw-doc', 'aria-label': 'Typed answer' },
    bar,
    h('div', { class: 'rvw-doc-stage' }, sheet));
}

export function openDocReader(sub, { title = '', eyebrow = 'Answer', signal } = {}) {
  const opener = document.activeElement;
  const titleId = uid('doc-title');
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', close);
    if (dialog.open) dialog.close();
    dialog.remove();
    if (opener?.isConnected) opener.focus?.();
  };

  const page = h('article', { class: 'doc-page doc-view read is-reading', tabindex: '-1', 'aria-labelledby': titleId }, pageNodes(sub));
  const dialog = h('dialog', { class: 'doc-editor doc-reader', 'aria-labelledby': titleId },
    h('div', { class: 'doc-editor-inner' },
      h('header', { class: 'doc-head' },
        h('div', { class: 'doc-head-title' },
          h('span', { class: 'doc-eyebrow' }, eyebrow),
          h('h2', { class: 'doc-title', id: titleId }, title || 'Answer')),
        h('span', { class: 'doc-status' }, wordsText(answerWords(sub))),
        h('button', { type: 'button', class: 'icon-btn doc-close', 'aria-label': 'Close full screen', onClick: close }, icon('x'))),
      h('div', { class: 'doc-scroll' }, page)));

  dialog.addEventListener('close', close);
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  signal?.addEventListener('abort', close, { once: true });

  document.body.append(dialog);
  dialog.showModal();
  page.focus({ preventScroll: true });
  return { close };
}
