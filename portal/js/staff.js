// staff.html[?student=<id>]: the tutor and admin workspace (spec 4.2)
import { requireRole } from './session.js';
import { startApp } from './app.js';
import { staffRoutes } from './routes.js';
import { renderItemDrawer } from './item-drawer.js';

const me = await requireRole(['admin', 'tutor']);

startApp({
  me,
  page: 'staff',
  audience: 'staff',
  table: staffRoutes(),
  defaultRoute: (scope) => (scope?.student ? '#/overview' : '#/today'),
  // The database limits a tutor to assigned students; an admin sees everyone.
  // A ?student= that isn't in the list is removed and the route goes to Today.
  loadScope: async ({ search, store }) => {
    const ws = await store.getWorkspace();
    const wanted = search.get('student');
    if (!wanted) return { student: null, options: ws.students, kind: 'student' };
    const student = ws.students.find((s) => s.id === wanted);
    if (!student) {
      return {
        student: null,
        options: ws.students,
        kind: 'student',
        search: '',
        hash: '#/today',
        message: 'That student isn’t in your list.',
      };
    }
    return { student, options: ws.students, kind: 'student' };
  },
  drawer: renderItemDrawer,
});
