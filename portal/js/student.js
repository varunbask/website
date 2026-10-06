// student.html: the student's own work (spec 4.2)
import { requireRole } from './session.js';
import { startApp } from './app.js';
import { familyRoutes } from './routes.js';
import { renderItemDrawer } from './item-drawer.js';

const me = await requireRole(['student']);

startApp({
  me,
  page: 'student',
  audience: 'family',
  table: familyRoutes('student'),
  defaultRoute: () => '#/overview',
  loadScope: async () => ({ student: me, options: [], kind: null }),
  drawer: renderItemDrawer,
});
