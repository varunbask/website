import { sb } from './supabase.js';
import { currentProfile, HOME } from './session.js';
import { showMessage, withBusy } from './dom.js';
import { firstName } from './format.js';

const PANELS = ['sign-in', 'sign-up', 'check-email', 'forgot', 'waiting'];

function show(name, focus = true) {
  for (const panel of PANELS) document.getElementById(`panel-${panel}`).hidden = panel !== name;
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

const signInForm = document.getElementById('sign-in-form');
signInForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = signInForm.querySelector('.form-message');
  const data = new FormData(signInForm);
  showMessage(message, '');
  await withBusy(submitButton(signInForm), 'Signing in...', async () => {
    const { error } = await sb.auth.signInWithPassword({
      email: String(data.get('email')).trim(),
      password: String(data.get('password')),
    });
    if (error) return showMessage(message, friendly(error));
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
  if (!fullName) return showMessage(message, 'Enter your full name.');
  if (!email.includes('@')) return showMessage(message, 'Enter a valid email address.');
  if (password.length < 8) return showMessage(message, 'Use a password of at least 8 characters.');
  showMessage(message, '');
  await withBusy(submitButton(signUpForm), 'Creating account...', async () => {
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
    if (error) return showMessage(message, friendly(error));
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
  if (!email.includes('@')) return showMessage(message, 'Enter a valid email address.');
  await withBusy(submitButton(forgotForm), 'Sending...', async () => {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/portal/reset.html` });
    if (error?.status === 429) return showMessage(message, 'Too many requests. Try again in a few minutes.');
    // Same answer whether or not the account exists
    showMessage(message, 'If that email has an account, a reset link is on its way.', 'success');
  });
});

document.getElementById('waiting-sign-out').addEventListener('click', async () => {
  await sb.auth.signOut();
  show('sign-in');
});

route();
