// people.html: approvals, roles and links (admin, spec 4.2 and 5.14)
import { requireRole } from './session.js';
import { startApp } from './app.js';
import { peopleRoutes } from './routes.js';
import { renderItemDrawer } from './item-drawer.js';

const me = await requireRole(['admin']);

startApp({
  me,
  page: 'people',
  audience: 'staff',
  table: peopleRoutes(),
  // Waiting for approval when anyone is waiting, otherwise Everyone
  defaultRoute: (scope) => (scope?.pending > 0 ? '#/pending' : '#/everyone'),
  loadScope: async ({ store }) => {
    let pending = 0;
    try {
      pending = await store.getPendingCount();
    } catch {
      // the default route falls back to Everyone
    }
    return { student: null, options: [], kind: null, pending };
  },
  drawer: renderItemDrawer,
});
