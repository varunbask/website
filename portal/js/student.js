// student.html: the student's own work (spec 4.2)
import { requireRole } from './session.js';
import { startApp } from './app.js';
import { familyRoutes } from './routes.js';
import { renderItemDrawer } from './item-drawer.js';
import { isAllowed } from './sat-data.js';

const me = await requireRole(['student']);

startApp({
  me,
  page: 'student',
  audience: 'family',
  table: familyRoutes('student'),
  defaultRoute: () => '#/overview',
  // sat: whether the admin turned SAT on for this student (the nav shows it then)
  loadScope: async () => ({ student: me, options: [], kind: null, sat: await isAllowed(me.id) }),
  drawer: renderItemDrawer,
});
