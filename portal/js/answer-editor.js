// The answer editor: a full-screen page where a student writes a formatted
// answer, like a short document. It opens from "Write your answer" in the
// submit section (submit-work.js), which owns the draft and the submission.
//
// openAnswerEditor({ title, doc, save, onSubmit, canSubmit, onFile, onClose, onSaved, signal })
//   title      the assignment's title, shown on top
//   doc        the document to start from (rich-doc.js)
//   save(doc)  keeps the draft (a promise); called a moment after typing stops,
//              when the page is hidden and on closing; the status says how it went
//   onSubmit(doc)  "Submit work" (shown when canSubmit): the editor closes, the
//              last save finishes, then this runs
//   onFile(file)   a file pasted or dropped in: the submit section attaches it
//              (it returns true when it did)
//   onClose(doc)   right after the editor closes, with the latest document
//   onSaved(ok)    when the save made on closing has finished
//   signal     an AbortSignal (the drawer's): when it aborts, the editor closes
//
// Formatting comes from document.execCommand, with tags (not inline styles),
// and what is kept is only what rich-doc.js allows: the page is read back
// into a document after every edit. Pasted HTML goes through the same
// document first, so nothing else survives a paste either.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button } from './ui.js';
import { toast } from './overlays.js';
import { normalizeDoc, docToText, wordCount, docToHtml, safeHref, textToDoc, isEmptyDoc } from './rich-doc.js';
import { domToDoc, docNodes, htmlToDoc } from './rich-doc-dom.js';

export const MAX_ANSWER_CHARS = 20000;
// The database keeps a document of up to 300,000 characters of JSON; stop a
// little before, so a save never fails on size
export const MAX_DOC_JSON = 290000;
const SAVE_DELAY_MS = 1200;
const NEAR_LIMIT = 18000;
const MOD = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? 'Cmd' : 'Ctrl';
// A save the database refused for its content (too large): trying again will not help
const permanent = (error) => ['23514', '22001', '54000'].includes(error?.code);

const STYLES = [
  { value: 'p', label: 'Normal text' },
  { value: 'h2', label: 'Heading' },
  { value: 'h3', label: 'Subheading' },
  { value: 'blockquote', label: 'Quote' },
];

// Math the keyboard does not have; inserted as plain characters. Each has a
// name, for screen readers and the button's tooltip.
export const SYMBOLS = Object.freeze([
  ['√', 'square root'], ['∛', 'cube root'], ['π', 'pi'], ['θ', 'theta'], ['∞', 'infinity'], ['°', 'degrees'],
  ['±', 'plus or minus'], ['×', 'times'], ['÷', 'divided by'], ['·', 'dot'], ['≈', 'approximately equal'],
  ['≠', 'not equal'], ['≤', 'less than or equal'], ['≥', 'greater than or equal'], ['∠', 'angle'],
  ['⊥', 'perpendicular'], ['∥', 'parallel'], ['△', 'triangle'], ['→', 'arrow'], ['⇒', 'implies'],
  ['⇔', 'if and only if'], ['∈', 'element of'], ['∉', 'not an element of'], ['⊂', 'subset'], ['∪', 'union'],
  ['∩', 'intersection'], ['∅', 'empty set'], ['ℝ', 'real numbers'], ['ℤ', 'integers'], ['∑', 'summation'],
  ['∫', 'integral'], ['Δ', 'delta'], ['½', 'one half'], ['⅓', 'one third'], ['¼', 'one quarter'],
  ['¾', 'three quarters'], ['α', 'alpha'], ['β', 'beta'], ['γ', 'gamma'], ['δ', 'small delta'],
  ['λ', 'lambda'], ['μ', 'mu'], ['σ', 'sigma'], ['φ', 'phi'], ['ω', 'small omega'], ['Ω', 'omega'],
  ['′', 'prime'], ['″', 'double prime'],
].map(([ch, name]) => Object.freeze({ ch, name })));

const numberFormat = new Intl.NumberFormat('en-US');

export function openAnswerEditor({
  title = 'Your answer', doc: start, save, onSubmit, canSubmit = false, onFile, onClose, onSaved, signal,
} = {}) {
  const opener = document.activeElement;
  const titleId = uid('doc-title');
  let doc = normalizeDoc(start);
  let dirty = false;
  let saving = null;     // the save under way
  let saveTimer = null;
  let closed = false;
  let lastSaveOk = true;
  let stopRetrying = false;
  let wasOver = false;

  // ---- the page ------------------------------------------------------------
  const page = h('div', {
    class: 'doc-page read',
    contenteditable: 'true',
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': 'Your answer',
    spellcheck: 'true',
    'data-placeholder': 'Start writing your answer. Show your work for each question.',
  });
  fill(doc);

  function fill(next) {
    const nodes = docNodes(next, { links: 'edit' });
    page.replaceChildren(...(nodes.length ? nodes : [h('p', {}, h('br'))]));
    page.classList.toggle('is-empty', !nodes.length);
  }

  // ---- toolbar -------------------------------------------------------------
  const styleSelect = h('select', { class: 'doc-style', 'aria-label': 'Text style' },
    STYLES.map((s) => h('option', { value: s.value }, s.label)));
  // Arrow keys on a closed select change it at once: then focus stays there
  let styleByKeys = false;
  styleSelect.addEventListener('keydown', () => { styleByKeys = true; });
  styleSelect.addEventListener('pointerdown', () => { styleByKeys = false; });
  const tools = {};
  const tool = (key, { label, glyph, iconName, command, onClick, className }) => {
    const btn = h('button', {
      type: 'button',
      class: ['doc-tool', className].filter(Boolean).join(' '),
      'aria-label': label,
      title: label,
      tabindex: '-1',
      'aria-pressed': command ? 'false' : undefined,
      onClick: () => {
        restoreRange();
        if (onClick) onClick();
        else exec(command);
      },
    }, iconName ? icon(iconName) : h('span', { class: `doc-glyph is-${key}`, 'aria-hidden': 'true' }, glyph));
    // A press must not take the selection out of the page
    btn.addEventListener('pointerdown', (e) => e.preventDefault());
    tools[key] = { btn, command };
    return btn;
  };
  const sep = () => h('span', { class: 'doc-sep', 'aria-hidden': 'true' });

  const symbolsBtn = tool('symbols', { label: 'Math symbols', glyph: '√π', onClick: () => toggle(symbols) });
  symbolsBtn.removeAttribute('aria-pressed');
  symbolsBtn.setAttribute('aria-expanded', 'false');
  const linkBtn = tool('link', { label: `Link (${MOD}+K)`, iconName: 'link-simple', onClick: openLink });
  const toolbar = h('div', { class: 'doc-toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
    styleSelect, sep(),
    tool('bold', { label: `Bold (${MOD}+B)`, glyph: 'B', command: 'bold' }),
    tool('italic', { label: `Italic (${MOD}+I)`, glyph: 'I', command: 'italic' }),
    tool('underline', { label: `Underline (${MOD}+U)`, glyph: 'U', command: 'underline' }),
    tool('strike', { label: 'Strikethrough', glyph: 'S', command: 'strikeThrough' }),
    sep(),
    tool('sup', { label: 'Superscript, like x²', glyph: 'x²', command: 'superscript' }),
    tool('sub', { label: 'Subscript, like H₂O', glyph: 'x₂', command: 'subscript' }),
    symbolsBtn,
    sep(),
    tool('ul', { label: 'Bulleted list', iconName: 'list', command: 'insertUnorderedList' }),
    tool('ol', { label: 'Numbered list', glyph: '1.', command: 'insertOrderedList' }),
    linkBtn,
    sep(),
    tool('undo', { label: `Undo (${MOD}+Z)`, iconName: 'arrow-counter-clockwise', onClick: () => exec('undo') }),
    tool('redo', { label: 'Redo', iconName: 'arrow-counter-clockwise', className: 'is-redo', onClick: () => exec('redo') }));

  // The toolbar is one Tab stop: the arrow keys move between its buttons
  const toolButtons = Object.values(tools).map((t) => t.btn);
  toolButtons[0].setAttribute('tabindex', '0');
  toolbar.addEventListener('keydown', (e) => {
    const at = toolButtons.indexOf(document.activeElement);
    if (at < 0) return;
    let next = null;
    if (e.key === 'ArrowRight') next = (at + 1) % toolButtons.length;
    else if (e.key === 'ArrowLeft') next = (at - 1 + toolButtons.length) % toolButtons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = toolButtons.length - 1;
    if (next === null) return;
    e.preventDefault();
    toolButtons[at].setAttribute('tabindex', '-1');
    toolButtons[next].setAttribute('tabindex', '0');
    toolButtons[next].focus();
  });

  // Symbols: a grid that inserts one character at the caret. From the
  // keyboard, focus stays on the symbol, so several can go in one after another.
  const symbolsId = uid('doc-symbols');
  const symbols = h('div', { class: 'doc-panel doc-symbols', id: symbolsId, role: 'group', 'aria-label': 'Math symbols', hidden: true },
    SYMBOLS.map(({ ch, name }) => {
      const b = h('button', {
        type: 'button',
        class: 'doc-symbol',
        'aria-label': `Insert ${name}`,
        title: name,
        onClick: (e) => {
          const fromKeys = e.detail === 0;
          restoreRange();
          exec('insertText', ch);
          rememberRange();
          if (fromKeys) b.focus();
        },
      }, ch);
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      return b;
    }));
  symbolsBtn.setAttribute('aria-controls', symbolsId);

  // Links: a small bar under the toolbar
  const linkInput = h('input', {
    class: 'input doc-link-input',
    type: 'url',
    inputmode: 'url',
    placeholder: 'https://',
    'aria-label': 'Link address',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const linkError = h('span', { class: 'doc-link-error', role: 'alert' });
  const linkBar = h('div', { class: 'doc-panel doc-linkbar', hidden: true },
    linkInput,
    button({ label: 'Apply', variant: 'primary', size: 'sm', onClick: applyLink }),
    button({ label: 'Remove link', variant: 'ghost', size: 'sm', onClick: removeLink }),
    button({ label: 'Cancel', variant: 'ghost', size: 'sm', onClick: () => closePanel(linkBar) }),
    linkError);
  linkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyLink();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePanel(linkBar);
    }
  });

  // ---- head and foot -------------------------------------------------------
  // Not live regions: a status that changed every save would be read out
  // constantly. Problems are also said through a toast.
  const status = h('span', { class: 'doc-status' });
  const count = h('span', { class: 'doc-count num' });
  const limit = h('span', { class: 'doc-limit' });
  const submitBtn = canSubmit
    ? button({ label: 'Submit work', variant: 'primary', icon: 'upload-simple', onClick: () => finish({ submit: true }) })
    : null;
  const doneBtn = button({ label: canSubmit ? 'Save and close' : 'Done', variant: canSubmit ? 'secondary' : 'primary', onClick: () => finish() });

  const dialog = h('dialog', { class: 'doc-editor', 'aria-labelledby': titleId },
    h('div', { class: 'doc-editor-inner' },
      h('header', { class: 'doc-head' },
        h('div', { class: 'doc-head-title' },
          h('span', { class: 'doc-eyebrow' }, 'Your answer'),
          h('h2', { class: 'doc-title', id: titleId }, title)),
        status,
        h('button', { type: 'button', class: 'icon-btn doc-close', 'aria-label': 'Close the editor', onClick: () => finish() }, icon('x'))),
      toolbar, linkBar, symbols,
      h('div', { class: 'doc-scroll' }, page),
      h('footer', { class: 'doc-foot' },
        h('span', { class: 'doc-meta' }, count, limit),
        h('span', { class: 'doc-actions' }, doneBtn, submitBtn))));

  // ---- editing -------------------------------------------------------------
  let savedRange = null;
  const inPage = (node) => node && (node === page || page.contains(node));
  function rememberRange() {
    const sel = document.getSelection();
    if (sel?.rangeCount && inPage(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  }
  function restoreRange() {
    page.focus({ preventScroll: true });
    if (!savedRange) return;
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  function exec(command, value = null) {
    // Tags, not style attributes (the CSP would drop those, and rich-doc.js ignores them)
    document.execCommand('styleWithCSS', false, false);
    document.execCommand(command, false, value);
    changed();
    paintState();
  }

  styleSelect.addEventListener('change', () => {
    const keys = styleByKeys;
    restoreRange();
    if (styleSelect.value !== 'p' && anchorElement()?.closest('li')) {
      // A heading inside a list item would not be kept
      styleSelect.value = 'p';
      toast({ text: 'Headings and quotes can’t go inside a list. End the list first.' });
    } else {
      exec('formatBlock', `<${styleSelect.value}>`);
    }
    rememberRange();
    if (keys) styleSelect.focus();
  });

  function paintState() {
    if (!inPage(document.getSelection()?.anchorNode)) return;
    for (const { btn, command } of Object.values(tools)) {
      if (!command) continue;
      let on = false;
      try {
        on = document.queryCommandState(command);
      } catch {
        // an unsupported command is just not lit
      }
      // Links are drawn underlined, which the browser reports as underline
      if (command === 'underline' && currentLink()) on = Boolean(anchorElement()?.closest('u'));
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const block = String(document.queryCommandValue('formatBlock') || 'p').toLowerCase().replace(/[<>]/g, '');
    styleSelect.value = STYLES.some((s) => s.value === block) ? block : 'p';
    linkBtn.setAttribute('aria-pressed', currentLink() ? 'true' : 'false');
  }

  function anchorElement() {
    const node = document.getSelection()?.anchorNode;
    return node?.nodeType === 1 ? node : node?.parentElement ?? null;
  }
  function currentLink() {
    const a = anchorElement()?.closest?.('a');
    return a && page.contains(a) ? a : null;
  }

  function toggle(panel) {
    if (panel.hidden) openPanel(panel);
    else closePanel(panel);
  }
  function openPanel(panel) {
    rememberRange();
    for (const other of [linkBar, symbols]) if (other !== panel) other.hidden = true;
    panel.hidden = false;
    symbolsBtn.setAttribute('aria-expanded', symbols.hidden ? 'false' : 'true');
  }
  function closePanel(panel) {
    panel.hidden = true;
    symbolsBtn.setAttribute('aria-expanded', symbols.hidden ? 'false' : 'true');
    restoreRange();
  }

  function openLink() {
    rememberRange();
    linkError.textContent = '';
    linkInput.value = currentLink()?.getAttribute('href') ?? '';
    openPanel(linkBar);
    linkInput.focus();
  }
  function applyLink() {
    let value = linkInput.value.trim();
    // An email address becomes a mail link; anything without a scheme is a web address
    if (/^[^@\s/:]+@[^@\s/]+\.[^@\s/]+$/.test(value)) value = `mailto:${value}`;
    else if (value && !/^(https?|mailto):/i.test(value)) value = `https://${value}`;
    const href = safeHref(value);
    if (!href) {
      linkError.textContent = 'Use a web address, like https://example.com.';
      linkInput.focus();
      return;
    }
    closePanel(linkBar);
    const sel = document.getSelection();
    const existing = currentLink();
    if (existing) {
      // The caret or selection is in a link: change where it goes
      existing.setAttribute('href', href);
      changed();
      return;
    }
    if (!sel?.rangeCount) return;
    if (sel.isCollapsed) {
      // Nothing selected: the address goes in as a link, and the caret after it
      const range = sel.getRangeAt(0);
      const a = h('a', { href }, href);
      range.insertNode(a);
      range.setStartAfter(a);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      changed();
      return;
    }
    exec('createLink', href);
    // The caret after the new link, so typing does not replace it
    const made = currentLink() ?? anchorElement()?.querySelector?.('a');
    if (made) {
      const range = document.createRange();
      range.setStartAfter(made);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      sel.collapseToEnd();
    }
    rememberRange();
  }
  function removeLink() {
    closePanel(linkBar);
    const a = currentLink();
    if (a) {
      const range = document.createRange();
      range.selectNodeContents(a);
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    exec('unlink');
  }

  // ---- reading the page back, counting and saving ---------------------------
  let readTimer = null;
  function changed() {
    dirty = true;
    status.textContent = 'Editing…';
    clearTimeout(readTimer);
    readTimer = setTimeout(read, 150);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveNow(); }, SAVE_DELAY_MS);
  }

  function read() {
    doc = domToDoc(page);
    page.classList.toggle('is-empty', !doc.blocks.length);
    paintCount();
  }

  const tooBig = () => JSON.stringify(doc).length > MAX_DOC_JSON;
  function paintCount() {
    const words = wordCount(doc);
    const chars = docToText(doc).length;
    count.textContent = `${numberFormat.format(words)} ${words === 1 ? 'word' : 'words'}`;
    const over = chars > MAX_ANSWER_CHARS;
    const big = !over && tooBig();
    if (over) limit.textContent = `Too long to submit: ${numberFormat.format(chars)} of ${numberFormat.format(MAX_ANSWER_CHARS)} characters`;
    else if (big) limit.textContent = 'Too much formatting to save. Shorten the answer, or attach part of it as a file.';
    else if (chars >= NEAR_LIMIT) limit.textContent = `${numberFormat.format(chars)} of ${numberFormat.format(MAX_ANSWER_CHARS)} characters`;
    else limit.textContent = '';
    limit.classList.toggle('is-over', over || big);
    // Said once, when the answer goes over
    if ((over || big) && !wasOver) toast({ text: limit.textContent });
    wasOver = over || big;
    if (submitBtn) submitBtn.disabled = over || big || isEmptyDoc(doc);
  }

  // Resolves true when what is on the page is saved
  async function saveNow() {
    clearTimeout(saveTimer);
    clearTimeout(readTimer);
    read();
    if (!save) return true;
    if (saving) await saving.catch(() => {});
    if (!dirty) return lastSaveOk;
    if (tooBig()) {
      status.textContent = 'Not saved: too much to save';
      lastSaveOk = false;
      return false;
    }
    dirty = false;
    const snapshot = doc;
    status.textContent = 'Saving…';
    saving = Promise.resolve(save(snapshot));
    try {
      await saving;
      lastSaveOk = true;
      if (!dirty && !closed) status.textContent = 'Draft saved';
    } catch (error) {
      console.error(error);
      dirty = true;
      lastSaveOk = false;
      stopRetrying = permanent(error);
      const text = stopRetrying ? 'This draft can’t be saved. It is too large.' : 'Couldn’t save your draft. It will try again.';
      if (!closed) {
        status.textContent = text;
        toast({ text });
        if (!stopRetrying) saveTimer = setTimeout(() => { saveNow(); }, SAVE_DELAY_MS * 4);
      }
    } finally {
      saving = null;
    }
    return lastSaveOk && !dirty;
  }

  // A hidden page (another tab, a locked phone) saves what is there now
  const onHidden = () => {
    if (document.visibilityState === 'hidden' && dirty) saveNow();
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', onHidden);

  page.addEventListener('input', changed);
  page.addEventListener('keyup', paintState);
  page.addEventListener('mouseup', paintState);
  page.addEventListener('focus', paintState);
  const onSelection = () => {
    if (inPage(document.getSelection()?.anchorNode)) {
      rememberRange();
      paintState();
    }
  };
  document.addEventListener('selectionchange', onSelection);

  page.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openLink();
    }
  });

  // A click on a link places the caret; it never leaves the page
  page.addEventListener('click', (e) => {
    if (e.target.closest?.('a')) e.preventDefault();
  });

  // Paste: an image goes to the submit section as the attached file; text and
  // HTML come in through the document, so only allowed formatting survives
  page.addEventListener('paste', (e) => {
    const data = e.clipboardData;
    if (!data) return;
    e.preventDefault();
    e.stopPropagation();
    // Text wins over an image that came with it (Word and spreadsheets send both)
    if (insertTransfer(data)) return;
    const file = [...(data.files ?? [])][0];
    if (file) onFile?.(file);
  });

  // Text or HTML from a paste or a drop goes in through the document; the
  // HTML is built from the checked document, every piece escaped. One plain
  // paragraph goes in as text at the caret; more keep their blocks.
  function insertTransfer(data) {
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    if (!html && !text) return false;
    const pasted = html ? htmlToDoc(html) : textToDoc(text);
    if (!pasted.blocks.length) return Boolean(text || html);
    if (pasted.blocks.length === 1 && pasted.blocks[0].t === 'p' && !pasted.blocks[0].c.some((n) => n.m || n.a || n.br)) {
      exec('insertText', pasted.blocks[0].c.map((n) => n.x).join(''));
    } else {
      exec('insertHTML', docToHtml(pasted));
    }
    return true;
  }

  // A drop: a file is handed to the submit section; text or HTML (dragged from
  // another page) goes in where it was dropped, through the document like a paste
  page.addEventListener('dragover', (e) => e.preventDefault());
  page.addEventListener('drop', (e) => {
    const data = e.dataTransfer;
    if (!data) return;
    e.preventDefault();
    const file = [...(data.files ?? [])][0];
    if (file) {
      onFile?.(file);
      return;
    }
    const at = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (at) {
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(at);
    }
    insertTransfer(data);
  });

  // ---- closing -------------------------------------------------------------
  async function finish({ submit = false } = {}) {
    if (closed) return;
    clearTimeout(readTimer);
    read();
    if (submit && (docToText(doc).length > MAX_ANSWER_CHARS || tooBig() || isEmptyDoc(doc))) return;
    closed = true;
    document.removeEventListener('selectionchange', onSelection);
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', onHidden);
    signal?.removeEventListener('abort', onAbort);
    // Close first; the draft save finishes behind it. A submit waits for it,
    // so a late save cannot bring back the draft the submission removes.
    const last = saveNow();
    if (dialog.open) dialog.close();
    dialog.remove();
    if (opener?.isConnected) opener.focus?.();
    onClose?.(doc);
    const ok = await last.catch(() => false);
    onSaved?.(ok);
    if (submit) onSubmit?.(doc);
  }
  const onAbort = () => finish();
  signal?.addEventListener('abort', onAbort, { once: true });
  // A close by any other way (the browser's own) still finishes properly
  dialog.addEventListener('close', () => { if (!closed) finish(); });
  dialog.addEventListener('cancel', (e) => {
    // Escape closes a panel first, then the editor
    if (!linkBar.hidden || !symbols.hidden) {
      e.preventDefault();
      closePanel(linkBar.hidden ? symbols : linkBar);
      return;
    }
    e.preventDefault();
    finish();
  });

  document.body.append(dialog);
  dialog.showModal();
  document.execCommand('defaultParagraphSeparator', false, 'p');
  paintCount();
  status.textContent = doc.blocks.length ? 'Draft saved' : '';
  page.focus();
  // Start at the end of what is there
  const range = document.createRange();
  range.selectNodeContents(page);
  range.collapse(false);
  const sel = document.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  rememberRange();

  return {
    close: () => finish(),
    get doc() { return doc; },
  };
}
