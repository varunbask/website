// Builds an element. Text children and the `text` prop always go through
// textContent, so database text can never become markup.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (/^on[a-z]/i.test(key)) throw new Error('Inline event handlers are blocked by the CSP; pass a function');
    else if (key === 'style') throw new Error('Inline styles are blocked by the CSP; add a class to a portal stylesheet');
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

// Shows text in a .form-message element; empty text hides it
export function showMessage(el, text, kind = 'error') {
  el.textContent = text ?? '';
  el.classList.remove('error', 'success');
  if (text) el.classList.add(kind);
  el.hidden = !text;
}

// A page-unique id for label/for and aria-describedby pairs
let uidCount = 0;
export function uid(prefix = 'id') {
  uidCount += 1;
  return `${prefix}-${uidCount}`;
}
