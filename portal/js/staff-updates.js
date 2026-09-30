import { sb } from './supabase.js';
import { h, clear, showMessage, withBusy } from './dom.js';
import { firstName } from './format.js';
import { staffNames, loadUpdates, updateItem } from './updates-feed.js';

export async function renderUpdates(container, { me, student }) {
  const message = h('p', { class: 'form-message', role: 'status', hidden: true });
  const form = h('form', { class: 'composer', novalidate: true },
    h('label', { class: 'field' }, h('span', {}, 'New update'),
      h('textarea', { name: 'body', rows: 4, maxlength: 10000, placeholder: `How is ${firstName(student.full_name)} doing this week?` })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'visible_to_student' }), 'Also show this to the student'),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-primary btn-small' }, 'Post update')),
    message);
  const list = h('div');

  async function drawList() {
    try {
      const [updates, names] = await Promise.all([loadUpdates(student.id), staffNames()]);
      clear(list).append(updates.length
        ? h('ul', { class: 'ruled-list' }, updates.map((u) => updateItem(u, names, {
            showAudience: true,
            onDelete: me.role === 'admin' || u.author_id === me.id ? () => remove(u) : null,
          })))
        : h('p', { class: 'empty' }, 'No updates yet. Parents see these on their dashboard.'));
    } catch {
      clear(list).append(h('p', { class: 'form-message error' }, 'Updates could not be loaded.'));
    }
  }

  async function remove(update) {
    if (!confirm('Delete this update? The family will no longer see it.')) return;
    const { error } = await sb.from('updates').delete().eq('id', update.id);
    if (error) return showMessage(message, `That did not delete: ${error.message}`);
    showMessage(message, 'Deleted.', 'success');
    await drawList();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = form.elements.body.value.trim();
    if (!body) return showMessage(message, 'Write something first.');
    await withBusy(form.querySelector('button[type="submit"]'), 'Posting...', async () => {
      const { error } = await sb.from('updates').insert({
        student_id: student.id,
        body,
        visible_to_student: form.elements.visible_to_student.checked,
      });
      if (error) return showMessage(message, `That did not post: ${error.message}`);
      form.reset();
      showMessage(message, 'Posted. The family can see it now.', 'success');
      await drawList();
    });
  });

  clear(container).append(form, list);
  await drawList();
}
