// The answer editor: a full-screen page where a student writes a formatted
// answer, like a short document. It opens from "Write your answer" in the
// submit section (submit-work.js), which owns the draft and the submission.
//
// openAnswerEditor({ title, doc, save, onSubmit, canSubmit, onImage, onClose })
//   title      the assignment's title, shown on top
//   doc        the document to start from (rich-doc.js)
//   save(doc)  keeps the draft (a promise); called a moment after typing stops
//              and on closing, and the status line says how it went
//   onSubmit(doc)  "Submit work" (shown when canSubmit): the editor closes first
//   onImage(file)  an image pasted or dropped in: the submit section attaches it
//   onClose(doc)   after the editor closes, with the latest document
//
// Formatting comes from document.execCommand, with tags (not inline styles),
// and what is kept is only what rich-doc.js allows: the page is read back
// into a document after every edit. Pasted HTML goes through the same
// document first, so nothing else survives a paste either.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button } from './ui.js';
import { normalizeDoc, docToText, wordCount, docToHtml, safeHref, textToDoc } from './rich-doc.js';
import { domToDoc, docNodes, htmlToDoc } from './rich-doc-dom.js';

export const MAX_ANSWER_CHARS = 20000;
const SAVE_DELAY_MS = 1200;

const STYLES = [
  { value: 'p', label: 'Normal text' },
  { value: 'h2', label: 'Heading' },
  { value: 'h3', label: 'Subheading' },
  { value: 'blockquote', label: 'Quote' },
];

// Math the keyboard does not have; inserted as plain characters
export const SYMBOLS = Object.freeze([
  '√', '∛', 'π', 'θ', '∞', '°', '±', '×', '÷', '·', '≈', '≠', '≤', '≥', '∠', '⊥', '∥', '△',
  '→', '⇒', '⇔', '∈', '∉', '⊂', '∪', '∩', '∅', 'ℝ', 'ℤ', '∑', '∫', 'Δ', '½', '⅓', '¼', '¾',
  'α', 'β', 'γ', 'δ', 'λ', 'μ', 'σ', 'φ', 'ω', 'Ω', '′', '″',
]);

const numberFormat = new Intl.NumberFormat('en-US');

export function openAnswerEditor({ title = 'Your answer', doc: start, save, onSubmit, canSubmit = false, onImage, onClose } = {}) {
  const opener = document.activeElement;
  const titleId = uid('doc-title');
  let doc = normalizeDoc(start);
  let dirty = false;
  let saving = null;     // the save under way
  let saveTimer = null;
  let closed = false;

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
  const tools = {};
  const tool = (key, { label, glyph, iconName, command, onClick, className }) => {
    const btn = h('button', {
      type: 'button',
      class: ['doc-tool', className].filter(Boolean).join(' '),
      'aria-label': label,
      title: label,
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
  const linkBtn = tool('link', { label: 'Link (Ctrl+K)', iconName: 'link-simple', onClick: openLink });
  const toolbar = h('div', { class: 'doc-toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
    styleSelect, sep(),
    tool('bold', { label: 'Bold (Ctrl+B)', glyph: 'B', command: 'bold' }),
    tool('italic', { label: 'Italic (Ctrl+I)', glyph: 'I', command: 'italic' }),
    tool('underline', { label: 'Underline (Ctrl+U)', glyph: 'U', command: 'underline' }),
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
    tool('undo', { label: 'Undo (Ctrl+Z)', iconName: 'arrow-counter-clockwise', onClick: () => exec('undo') }),
    tool('redo', { label: 'Redo', iconName: 'arrow-counter-clockwise', className: 'is-redo', onClick: () => exec('redo') }));

  // Symbols: a grid that inserts one character at the caret
  const symbols = h('div', { class: 'doc-panel doc-symbols', role: 'group', 'aria-label': 'Math symbols', hidden: true },
    SYMBOLS.map((ch) => {
      const b = h('button', {
        type: 'button',
        class: 'doc-symbol',
        'aria-label': `Insert ${ch}`,
        onClick: () => {
          restoreRange();
          exec('insertText', ch);
        },
      }, ch);
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      return b;
    }));

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
  const status = h('span', { class: 'doc-status', role: 'status' });
  const count = h('span', { class: 'doc-count num' });
  const limit = h('span', { class: 'doc-limit', role: 'alert' });
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
    restoreRange();
    exec('formatBlock', `<${styleSelect.value}>`);
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
    if (value && !/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
    const href = safeHref(value);
    if (!href) {
      linkError.textContent = 'Use a web address, like https://example.com.';
      linkInput.focus();
      return;
    }
    closePanel(linkBar);
    const sel = document.getSelection();
    if (sel?.isCollapsed && !currentLink()) exec('insertText', href);
    // A link around the text just typed (or the selection)
    if (sel?.isCollapsed && !currentLink()) {
      const range = sel.getRangeAt(0);
      range.setStart(range.startContainer, Math.max(0, range.startOffset - href.length));
      sel.removeAllRanges();
      sel.addRange(range);
    }
    exec('createLink', href);
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

  function paintCount() {
    const words = wordCount(doc);
    const chars = docToText(doc).length;
    count.textContent = `${numberFormat.format(words)} ${words === 1 ? 'word' : 'words'}`;
    const over = chars > MAX_ANSWER_CHARS;
    limit.textContent = over
      ? `Too long to submit: ${numberFormat.format(chars)} of ${numberFormat.format(MAX_ANSWER_CHARS)} characters`
      : '';
    if (submitBtn) submitBtn.disabled = over;
  }

  async function saveNow() {
    clearTimeout(saveTimer);
    clearTimeout(readTimer);
    read();
    if (!dirty || !save) return;
    if (saving) await saving.catch(() => {});
    if (!dirty) return;
    dirty = false;
    const snapshot = doc;
    status.textContent = 'Saving…';
    saving = Promise.resolve(save(snapshot));
    try {
      await saving;
      if (!dirty && !closed) status.textContent = 'Draft saved';
    } catch (error) {
      console.error(error);
      dirty = true;
      if (!closed) {
        status.textContent = 'Couldn’t save your draft. It will try again.';
        saveTimer = setTimeout(() => { saveNow(); }, SAVE_DELAY_MS * 4);
      }
    } finally {
      saving = null;
    }
  }

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
    const image = [...(data.files ?? [])].find((f) => f.type === 'image/png' || f.type === 'image/jpeg');
    if (image) {
      onImage?.(image);
      return;
    }
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    const pasted = html ? htmlToDoc(html) : textToDoc(text);
    if (!pasted.blocks.length) return;
    // One paragraph goes in as text at the caret; more keep their blocks.
    // The HTML is built from the checked document, every piece escaped.
    if (pasted.blocks.length === 1 && pasted.blocks[0].t === 'p' && !pasted.blocks[0].c.some((n) => n.m || n.a || n.br)) {
      exec('insertText', pasted.blocks[0].c.map((n) => n.x).join(''));
    } else {
      exec('insertHTML', docToHtml(pasted));
    }
  });

  // A file dropped on the page: an image is attached, anything else is refused
  page.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault();
  });
  page.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    const image = files.find((f) => f.type === 'image/png' || f.type === 'image/jpeg');
    if (image) onImage?.(image);
  });

  // ---- closing -------------------------------------------------------------
  async function finish({ submit = false } = {}) {
    if (closed) return;
    clearTimeout(readTimer);
    read();
    if (submit && docToText(doc).length > MAX_ANSWER_CHARS) return;
    closed = true;
    document.removeEventListener('selectionchange', onSelection);
    // Close first; the draft save finishes behind it
    const last = saveNow();
    if (dialog.open) dialog.close();
    dialog.remove();
    if (opener?.isConnected) opener.focus?.();
    onClose?.(doc);
    if (submit) onSubmit?.(doc);
    await last;
  }
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
