// Stub with its final signature (foundation F10). U2 replaces this file.
import { emptyState } from '../ui.js';

export function mount(ctx) {
  const title = 'Tasks';
  ctx.setHeader({ title });
  ctx.host.append(emptyState({ icon: 'info', text: 'This view is being built.' }));
  ctx.announce(title);
}
