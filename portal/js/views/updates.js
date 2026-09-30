// Stub with its final signature (foundation F10). U5 replaces this file.
import { emptyState } from '../ui.js';

export function mount(ctx) {
  const title = ({ student: 'Notes from your tutor', parent: 'Updates from your tutor' })[ctx.role] ?? 'Updates';
  ctx.setHeader({ title });
  ctx.host.append(emptyState({ icon: 'info', text: 'This view is being built.' }));
  ctx.announce(title);
}
