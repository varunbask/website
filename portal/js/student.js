import { requireRole, mountHeader } from './session.js';
import { firstName } from './format.js';
import { renderStudentView } from './student-view.js';

const me = await requireRole(['student']);
mountHeader(me);
document.getElementById('greeting').textContent = `Hi, ${firstName(me.full_name)}`;
await renderStudentView(document.getElementById('student-view'), { studentId: me.id });
