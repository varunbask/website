import { sb } from './supabase.js';
import { showMessage, withBusy } from './dom.js';

// The reset email link signs the visitor in with a recovery session (tokens in the URL hash)
const form = document.getElementById('reset-form');
const { data: { session } } = await sb.auth.getSession();
if (!session) {
  form.hidden = true;
  document.getElementById('reset-expired').hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = form.querySelector('.form-message');
  const data = new FormData(form);
  const password = String(data.get('password'));
  if (password.length < 8) return showMessage(message, 'Use a password of at least 8 characters.');
  if (password !== String(data.get('confirm'))) return showMessage(message, 'The two passwords do not match.');
  await withBusy(form.querySelector('button[type="submit"]'), 'Saving...', async () => {
    const { error } = await sb.auth.updateUser({ password });
    if (error) return showMessage(message, error.message);
    form.hidden = true;
    document.getElementById('reset-done').hidden = false;
  });
});
