/* Local demo: student profiles, staff notes and parent contacts. Loaded after
   demo-supabase.js (see tools/demo/build.mjs). Mirrors the rules in
   supabase/migrations/20261017120000_student_profiles.sql, simplified:
     student_profiles  read by anyone who can see the student, written by staff who teach them
     student_notes     staff only; the author (or the admin) deletes
     staff_parent_contacts(p_student)  parents with email (null for placeholder addresses)
                       and the phone the admin keeps for billing */
(function () {
  'use strict';
  if (!window.portalDemo) return;
  const { helpers } = window.portalDemo;
  const db = window.portalDemo.db;
  const PLACEHOLDER = /@people\.varunbaskaran\.com$/i;

  window.portalDemo.extend({
    tables: {
      student_profiles: {
        keys: ['student_id'],
        rows: (h) => [{
          student_id: 'u-maya',
          grade_level: '9th grade',
          school: 'Arcadia High School',
          goals: 'Move from a B to an A in Algebra by the end of the semester, and feel ready for the SAT in the spring.',
          learning_notes: 'Learns best from a worked example first, then one on her own. Gets discouraged after a wrong answer, so start with a problem she can win. Likes to work on paper.',
          updated_by: 'u-daniel',
          updated_at: h.ago(3, '16:20'),
        }],
        read: (r) => helpers.canSee(r.student_id),
        insert: (r) => helpers.canTeach(r.student_id),
        // The database stamps who edited and when; here that happens as the edit is allowed
        write: (r) => {
          if (!helpers.canTeach(r.student_id)) return false;
          r.updated_by = helpers.meId;
          r.updated_at = new Date().toISOString();
          return true;
        },
        defaults: () => ({ updated_by: helpers.meId, updated_at: new Date().toISOString() }),
      },
      student_notes: {
        rows: (h) => [
          {
            id: h.id(), student_id: 'u-maya', author_id: 'u-priya', created_at: h.ago(2, '11:40'),
            body: 'SAT Reading: she rushes the evidence questions. Try "find the line first", then answer. Her timing is fine once she stops re-reading the passage.',
          },
          {
            id: h.id(), student_id: 'u-maya', author_id: 'u-daniel', created_at: h.ago(5, '17:10'),
            body: 'Quick on factoring. Word problems are the weak spot: have her underline the quantity being asked for before she writes any equation.',
          },
        ],
        read: (r) => helpers.canTeach(r.student_id),
        insert: (r) => helpers.canTeach(r.student_id),
        write: (r) => helpers.role() === 'admin' || (r.author_id === helpers.meId && helpers.canTeach(r.student_id)),
        defaults: () => ({ author_id: helpers.meId }),
      },
    },
    rpc: {
      staff_parent_contacts: (args, h) => {
        if (!h.canTeach(args.p_student)) return { data: [], error: null };
        const rows = db.parent_students
          .filter((l) => l.student_id === args.p_student)
          .map((l) => {
            const p = db.profiles.find((x) => x.id === l.parent_id);
            const contact = db.billing_contacts.find((c) => c.parent_id === l.parent_id);
            return {
              parent_id: p.id,
              full_name: p.full_name,
              email: PLACEHOLDER.test(p.email) ? null : p.email,
              phone: contact?.phone?.trim() || null,
            };
          })
          .sort((a, b) => a.full_name.localeCompare(b.full_name));
        return { data: rows, error: null };
      },
    },
  });
})();
