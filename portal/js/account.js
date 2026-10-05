// account.html: billing and payroll (admin). Every number is priced from the
// calendar's sessions by billing-model.js; see the billing migration for what
// is stored and who may read it.
import { requireRole } from './session.js';
import { startApp } from './app.js';
import { accountRoutes } from './routes.js';
import { renderItemDrawer } from './item-drawer.js';

const me = await requireRole(['admin']);

startApp({
  me,
  page: 'account',
  audience: 'staff',
  table: accountRoutes(),
  defaultRoute: () => '#/dashboard',
  loadScope: async () => ({ student: null, options: [], kind: null }),
  drawer: renderItemDrawer,
});
