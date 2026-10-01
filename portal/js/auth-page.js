// Sign in, sign up, forgot password and waiting-for-approval (portal/index.html).
// The flows, route(), the FRIENDLY map and validation are unchanged from the
// previous portal; only the presentation is new (spec 5.15).

import { sb } from './supabase.js';
import { currentProfile, HOME } from './session.js';
import { h, showMessage } from './dom.js';
import { firstName } from './format.js';
import { icon } from './icons.js';
import { themeToggle } from './theme.js';
import { busy } from './ui.js';

const PANELS = ['sign-in', 'sign-up', 'check-email', 'forgot', 'waiting'];

// ---------------------------------------------------------------------------
// Presentation helpers (reset-page.js has the same ones)

// Static markup marks icon slots with data-icon; icons come from icons.js
function fillIcons(root) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.replaceChildren(icon(el.dataset.icon, { size: Number(el.dataset.iconSize) || 16 }));
  }
}

// A show/hide toggle inside every .auth-pass wrapper. The field goes back to
// hidden when its form submits, so password managers still see a password.
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

// Confirmations are spoken through #auth-status, a role="status" region that is
// always in the page, so the text arrives after the region exists. The short
// delay also lets the same confirmation be announced again on a resubmit.
const statusRegion = document.getElementById('auth-status');
let statusTimer = 0;
function announce(text) {
  if (!statusRegion) return;
  clearTimeout(statusTimer);
  statusRegion.textContent = '';
  if (text) statusTimer = setTimeout(() => { statusRegion.textContent = text; }, 100);
}

// showMessage() plus a tone icon. An error keeps the visible message as the
// alert; a confirmation shows quietly and is announced by the status region.
function say(el, text, kind = 'error') {
  const confirmation = Boolean(text) && kind !== 'error';
  if (confirmation) el.removeAttribute('role');
  else el.setAttribute('role', 'alert');
  showMessage(el, text, kind);
  announce(confirmation ? text : '');
  if (!text) return;
  el.replaceChildren(icon(confirmation ? 'check-circle' : 'warning-circle'), h('span', {}, text));
}

fillIcons(document);
passwordReveals(document);
document.getElementById('theme-toggle')?.replaceWith(themeToggle({ id: 'theme-toggle' }));

// ---------------------------------------------------------------------------
// Panels and routing

// The tab title follows the panel on screen
const PANEL_TITLES = {
  'sign-in': 'Sign in',
  'sign-up': 'Request an account',
  'check-email': 'Check your email',
  forgot: 'Reset your password',
  waiting: 'Waiting for approval',
};

function show(name, focus = true) {
  for (const panel of PANELS) document.getElementById(`panel-${panel}`).hidden = panel !== name;
  document.title = `${PANEL_TITLES[name] ?? 'Sign in'} | VP Education Group`;
  if (focus) document.querySelector(`#panel-${name} h1`)?.focus();
}

document.querySelectorAll('[data-show]').forEach((button) => {
  button.addEventListener('click', () => show(button.dataset.show));
});

// Signed-in people go to their home page; pending ones see the waiting panel
async function route() {
  let profile = null;
  try {
    profile = await currentProfile();
  } catch {
    /* fall through to sign in */
  }
  if (!profile) {
    show('sign-in', false);
    return;
  }
  if (profile.role === 'pending') {
    document.getElementById('waiting-name').textContent = firstName(profile.full_name);
    show('waiting', false);
    return;
  }
  location.replace(HOME[profile.role]);
}

const FRIENDLY = {
  'Invalid login credentials': 'That email and password do not match.',
  'Email not confirmed': 'Confirm your email first. The link is in your inbox.',
};
const friendly = (error) => FRIENDLY[error.message] ?? error.message;
const submitButton = (form) => form.querySelector('button[type="submit"]');

// ---------------------------------------------------------------------------
// Forms

const signInForm = document.getElementById('sign-in-form');
signInForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = signInForm.querySelector('.form-message');
  const data = new FormData(signInForm);
  say(message, '');
  await busy(submitButton(signInForm), 'Signing in…', async () => {
    const { error } = await sb.auth.signInWithPassword({
      email: String(data.get('email')).trim(),
      password: String(data.get('password')),
    });
    if (error) return say(message, friendly(error));
    await route();
  });
});

const signUpForm = document.getElementById('sign-up-form');
signUpForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = signUpForm.querySelector('.form-message');
  const data = new FormData(signUpForm);
  const fullName = String(data.get('full_name')).trim();
  const email = String(data.get('email')).trim();
  const password = String(data.get('password'));
  if (!fullName) return say(message, 'Enter your full name.');
  if (!email.includes('@')) return say(message, 'Enter a valid email address.');
  if (password.length < 8) return say(message, 'Use a password of at least 8 characters.');
  say(message, '');
  await busy(submitButton(signUpForm), 'Sending request…', async () => {
    const { data: result, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${location.origin}/portal/index.html`,
        // Hints for the admin only; the database always starts a new account as pending
        data: {
          full_name: fullName,
          requested_role: String(data.get('requested_role')),
          signup_note: String(data.get('signup_note') ?? '').trim(),
        },
      },
    });
    if (error) return say(message, friendly(error));
    if (result.session) return route();
    document.getElementById('check-email-address').textContent = email;
    show('check-email');
  });
});

const forgotForm = document.getElementById('forgot-form');
forgotForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = forgotForm.querySelector('.form-message');
  const email = String(new FormData(forgotForm).get('email')).trim();
  if (!email.includes('@')) return say(message, 'Enter a valid email address.');
  await busy(submitButton(forgotForm), 'Sending…', async () => {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/portal/reset.html` });
    if (error?.status === 429) return say(message, 'Too many requests. Try again in a few minutes.');
    // Same answer whether or not the account exists
    say(message, 'If that email has an account, a reset link is on its way.', 'success');
  });
});

const signOutButton = document.getElementById('waiting-sign-out');
signOutButton.addEventListener('click', async () => {
  await busy(signOutButton, 'Signing out…', () => sb.auth.signOut());
  show('sign-in');
});

route();
