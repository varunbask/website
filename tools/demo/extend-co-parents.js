/* Demo extension: two parents of one child (supabase/migrations/20261022120000_co_parent_bills.sql).
   Loaded by the local demo build right after demo-supabase.js. Adds David Lin,
   Maya's father, linked to Maya but not paying (Grace pays). demo-supabase.js
   my_statements() works like the real one: a parent sees their own statements,
   and another parent's when they share every child that parent pays for, so
   David sees the statements Grace was sent.

   Try it
     ?as=parent   Grace Lin: Billing lists her statements as her own
     ?as=u-david  David Lin: Billing lists the same statements, billed to Grace Lin
     ?as=parent2  Jin Park: no statements
     ?as=admin    /portal/people.html#/everyone  Maya has two parents (Grace pays);
                  Jin Park's row offers Same family as */
(function () {
  'use strict';
  if (!window.portalDemo) return;
  const { db, helpers: h } = window.portalDemo;

  const profiles = [{
    id: 'u-david', full_name: 'David Lin', email: 'david.lin@example.com', role: 'parent', requested_role: null, signup_note: null,
    no_login: false, created_at: h.ago(30), calendar_color: null,
  }];
  const links = [{ parent_id: 'u-david', student_id: 'u-maya', bills: false, created_at: h.ago(30) }];

  window.portalDemo.extend({
    tables: {
      profiles: { rows: profiles },
      parent_students: { rows: links },
    },
  });
}());
