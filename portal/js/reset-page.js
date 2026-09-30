// Choose a new password (portal/reset.html). The checks and the flow are
// unchanged from the previous portal; only the presentation is new (spec 5.15).

import { sb } from './supabase.js';
import { h, showMessage } from './dom.js';
import { icon } from './icons.js';
import { themeToggle } from './theme.js';
import { busy } from './ui.js';

// ---------------------------------------------------------------------------
// Presentation helpers (auth-page.js has the same ones)

function fillIcons(root) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.replaceChildren(icon(el.dataset.icon, { size: Number(el.dataset.iconSize) || 16 }));
  }
}

function passwordReveals(root) {
  for (const wrap of root.querySelectorAll('.auth-pass')) {
    const input = wrap.querySelector('input');
    const toggle = h('button', {
      type: 'button',
      class: 'icon-btn has-tip auth-reveal',
      'aria-controls': input.id,
    });
    // The accessible name follows the visible tooltip (label in name)
    const paint = (shown) => {
      const label = shown ? 'Hide password' : 'Show password';
      toggle.setAttribute('aria-label', label);
      toggle.replaceChildren(
        icon(shown ? 'eye-slash' : 'eye'),
        h('span', { class: 'tip tip-end', 'aria-hidden': 'true' }, label),
      );
    };
    toggle.addEventListener('click', () => {
      const shown = input.type === 'password';
      input.type = shown ? 'text' : 'password';
      paint(shown);
    });
    input.form?.addEventListener('submit', () => {
      input.type = 'password';
      paint(false);
    });
    paint(false);
    wrap.append(toggle);
  }
}

// Only errors are shown here (the form message is role="alert" in the markup);
// success moves focus to the result instead
function say(el, text) {
  showMessage(el, text, 'error');
  if (!text) return;
  el.replaceChildren(icon('warning-circle'), h('span', {}, text));
}

fillIcons(document);
passwordReveals(document);
document.getElementById('theme-toggle')?.replaceWith(themeToggle({ id: 'theme-toggle' }));

// ---------------------------------------------------------------------------
// States: loading (skeleton), form, expired, done

const card = document.getElementById('reset-card');
const loading = document.getElementById('reset-loading');
const form = document.getElementById('reset-form');
const expired = document.getElementById('reset-expired');
const done = document.getElementById('reset-done');
const badge = document.getElementById('reset-icon');

function lead(name) {
  badge.replaceChildren(icon(name, { size: 20 }));
  badge.hidden = false;
}

function ready() {
  loading.remove();
  card.removeAttribute('aria-busy');
}

// The reset email link signs the visitor in with a recovery session (tokens in the URL hash)
let session = null;
try {
  ({ data: { session } } = await sb.auth.getSession());
} catch {
  /* treated as an expired link */
}
ready();
if (!session) {
  lead('clock');
  expired.hidden = false;
} else {
  form.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = form.querySelector('.form-message');
  const data = new FormData(form);
  const password = String(data.get('password'));
  if (password.length < 8) return say(message, 'Use a password of at least 8 characters.');
  if (password !== String(data.get('confirm'))) return say(message, 'The two passwords do not match.');
  await busy(form.querySelector('button[type="submit"]'), 'Saving…', async () => {
    const { error } = await sb.auth.updateUser({ password });
    if (error) return say(message, error.message);
    form.hidden = true;
    lead('check-circle');
    done.hidden = false;
    // The focused submit button is gone; focus the result so it is read out
    document.getElementById('reset-done-text').focus();
  });
});
