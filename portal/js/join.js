// Claiming an account the admin set up (portal/join.html). The personal link
// carries a token after #, so it never reaches a server log or another site.
// The page asks /api/people whether the link still works, lets the person
// choose an email and password, then signs them in to their home page, where
// everything already linked to the account is waiting.

import { sb } from './supabase.js';
import { HOME } from './session.js';
import { h, showMessage } from './dom.js';
import { icon } from './icons.js';
import { themeToggle } from './theme.js';
import { busy } from './ui.js';
import { joinCopy, joinProblem, joinError, readToken } from './invites-model.js';

const PANELS = ['loading', 'join', 'problem'];

function fillIcons(root) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.replaceChildren(icon(el.dataset.icon, { size: Number(el.dataset.iconSize) || 16 }));
  }
}

// A show/hide toggle inside .auth-pass (the same one the sign-in page has)
function passwordReveals(root) {
  for (const wrap of root.querySelectorAll('.auth-pass')) {
    const input = wrap.querySelector('input');
    const toggle = h('button', { type: 'button', class: 'icon-btn has-tip auth-reveal', 'aria-controls': input.id });
    const paint = (shown) => {
      const label = shown ? 'Hide password' : 'Show password';
      toggle.setAttribute('aria-label', label);
      toggle.replaceChildren(icon(shown ? 'eye-slash' : 'eye'), h('span', { class: 'tip tip-end', 'aria-hidden': 'true' }, label));
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

function show(name) {
  for (const panel of PANELS) document.getElementById(`panel-${panel}`).hidden = panel !== name;
  document.querySelector(`#panel-${name} h1`)?.focus();
}

function problem(kind) {
  const copy = joinProblem(kind);
  document.getElementById('problem-title').textContent = copy.title;
  document.getElementById('problem-text').textContent = copy.text;
  document.title = `${copy.title} | VP Education Group`;
  show('problem');
}

fillIcons(document);
passwordReveals(document);
document.getElementById('theme-toggle')?.replaceWith(themeToggle({ id: 'theme-toggle' }));

// The token is read once, then taken out of the address bar and history
const token = readToken(location);
if (token) history.replaceState(null, '', location.pathname);

const form = document.getElementById('join-form');
const message = form.querySelector('.auth-message');
const submit = form.querySelector('.auth-submit');

function say(text) {
  showMessage(message, text, 'error');
  if (text) message.replaceChildren(icon('warning-circle'), h('span', {}, text));
}

async function start() {
  if (!token) return problem('invalid');
  let res;
  try {
    res = await fetch(`/api/people?t=${encodeURIComponent(token)}`, { cache: 'no-store' });
  } catch {
    return problem('offline');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return problem(body.error ?? 'invalid');
  const copy = joinCopy(body);
  document.getElementById('join-name').textContent = copy.first;
  document.getElementById('join-lede').textContent = copy.lede;
  show('join');
  document.getElementById('join-email').focus();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  say('');
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!email || !email.includes('@')) {
    say('Enter the email you want to sign in with.');
    form.email.focus();
    return;
  }
  if (password.length < 8) {
    say('Use a password of at least 8 characters.');
    form.password.focus();
    return;
  }
  busy(submit, 'Creating your account…', async () => {
    let res;
    try {
      res = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', t: token, email, password }),
      });
    } catch {
      say('Check your connection and try again.');
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 410 || res.status === 404) {
      problem(body.error ?? 'invalid');
      return;
    }
    if (!res.ok) {
      say(joinError(res.status, body));
      return;
    }
    // Signed in with what they just chose, straight to their home page
    const signed = await sb.auth.signInWithPassword({ email: body.email ?? email, password });
    if (signed.error) {
      location.replace('/portal/index.html');
      return;
    }
    const userId = signed.data?.user?.id ?? signed.data?.session?.user?.id;
    const { data } = userId ? await sb.from('profiles').select('role').eq('id', userId).maybeSingle() : { data: null };
    location.replace(HOME[data?.role] ?? '/portal/index.html');
  });
});

start();
