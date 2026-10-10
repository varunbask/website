/* Demo extension: two parents with one name, and a sign-up that could be
   either (the Grace case of 2026-10-09). Loaded by the local demo build right
   after demo-supabase.js.

   Try it:  /portal/people.html?as=admin#/pending

   Added without a login   Grace (Camila's mom, pays for Camila Reyes)
                           Grace (Gordon’s Mom) (pays for Gordon)
                           Gordon (a student, with Grace (Gordon’s Mom) as parent)
   Waiting for approval    Grace Young, asked to join as a parent
   Signs in separately     Gordon Young, approved as a new student by mistake,
                           with nothing linked: People > Everyone offers
                           "Merge Gordon Young into Gordon" on Gordon's row

   The card offers both Graces with their families, picks neither, and asks
   for the child's first name before using one. Not a test of the real rules. */
(function () {
  'use strict';
  if (!window.portalDemo) return;

  const mail = (id) => `no-login+${id}@people.varunbaskaran.com`;
  const person = (id, name, role, extra = {}) => ({
    id, full_name: name, email: mail(id), role, requested_role: null, signup_note: null, no_login: true, ...extra,
  });

  window.portalDemo.extend({
    tables: {
      profiles: {
        rows: (h) => [
          person('u-grace-camila', 'Grace', 'parent', { created_at: h.ago(4) }),
          person('u-camila', 'Camila Reyes', 'student', { created_at: h.ago(4) }),
          person('u-grace-gordon', 'Grace (Gordon’s Mom)', 'parent', { created_at: h.ago(2) }),
          person('u-gordon', 'Gordon', 'student', { created_at: h.ago(2) }),
          {
            id: 'u-gordon-young', full_name: 'Gordon Young', email: '46405@students.example.org', role: 'student',
            requested_role: 'student', signup_note: null, no_login: false, created_at: h.ago(0.04),
          },
          {
            id: 'u-grace-young', full_name: 'Grace Young', email: 'grace.young@example.com', role: 'pending',
            requested_role: 'parent', signup_note: null, no_login: false, created_at: h.ago(0.05),
          },
        ],
      },
      parent_students: {
        rows: (h) => [
          { parent_id: 'u-grace-camila', student_id: 'u-camila', bills: true, created_at: h.ago(4) },
          { parent_id: 'u-grace-gordon', student_id: 'u-gordon', bills: true, created_at: h.ago(2) },
        ],
      },
    },
  });
})();
