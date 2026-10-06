/* Demo extension: more people without a login, one for each invite state, so
   the Invites filter on People > Everyone has something to show.
   Loaded by the local demo build right after demo-supabase.js.

   Try it:  /portal/people.html?as=admin#/everyone

   Needs an invite        Mateo Diaz (demo base), Priyanka Nair, Mina Nair, Kenji Sato, Noor Haddad, Jun Zhang
   Invited, not joined    Rosa Diaz (demo base), Hana Sato (emailed), Tomas Novak (link copied, not emailed),
                          Wei Zhang (an old link that expired, then a new one: the latest wins)
   Invite expired         Omar Haddad, Lucia Fernandez
   Joined, not refreshed  Fatima Khan (her link was used but the profile still says no login: counted
                          in none of the three, and her row says so)

   Not a test of the real rules: portal_invites reads and writes come from the demo base (admin only). */
(function () {
  'use strict';
  if (!window.portalDemo) return;

  const mail = (id) => `no-login+${id}@people.varunbaskaran.com`;
  const person = (id, name, role, extra = {}) => ({
    id, full_name: name, email: mail(id), role, requested_role: null, signup_note: null, no_login: true, ...extra,
  });
  let n = 9000;
  const link = (h, profile, createdDaysAgo, extra = {}) => ({
    id: n++,
    profile_id: profile,
    token_hash: String(n).padStart(64, 'e'),
    created_by: 'u-admin',
    created_at: h.ago(createdDaysAgo),
    expires_at: h.ago(createdDaysAgo - 30),
    used_at: null,
    emailed_to: null,
    emailed_at: null,
    ...extra,
  });

  window.portalDemo.extend({
    tables: {
      profiles: {
        rows: (h) => [
          person('u-priyanka', 'Priyanka Nair', 'parent', { created_at: h.ago(6) }),
          person('u-mina', 'Mina Nair', 'student', { created_at: h.ago(6) }),
          person('u-hana', 'Hana Sato', 'parent', { created_at: h.ago(9) }),
          person('u-kenji', 'Kenji Sato', 'student', { created_at: h.ago(9) }),
          person('u-tomas', 'Tomas Novak', 'parent', { created_at: h.ago(8) }),
          person('u-omar', 'Omar Haddad', 'parent', { created_at: h.ago(45) }),
          person('u-noor', 'Noor Haddad', 'student', { created_at: h.ago(45) }),
          person('u-lucia', 'Lucia Fernandez', 'parent', { created_at: h.ago(44) }),
          person('u-wei', 'Wei Zhang', 'parent', { created_at: h.ago(50) }),
          person('u-jun', 'Jun Zhang', 'student', { created_at: h.ago(50) }),
          person('u-fatima', 'Fatima Khan', 'parent', { created_at: h.ago(5) }),
        ],
      },
      parent_students: {
        rows: (h) => [
          { parent_id: 'u-priyanka', student_id: 'u-mina', bills: true, created_at: h.ago(6) },
          { parent_id: 'u-hana', student_id: 'u-kenji', bills: true, created_at: h.ago(9) },
          { parent_id: 'u-omar', student_id: 'u-noor', bills: true, created_at: h.ago(45) },
          { parent_id: 'u-wei', student_id: 'u-jun', bills: true, created_at: h.ago(50) },
        ],
      },
      portal_invites: {
        rows: (h) => [
          link(h, 'u-hana', 3, { emailed_to: 'hana.sato@example.com', emailed_at: h.ago(3) }),
          link(h, 'u-tomas', 1),
          link(h, 'u-omar', 40, { emailed_to: 'omar.haddad@example.com', emailed_at: h.ago(40) }),
          link(h, 'u-lucia', 36),
          // an old link that lapsed, then a new one: invited
          link(h, 'u-wei', 45),
          link(h, 'u-wei', 4, { emailed_to: 'wei.zhang@example.com', emailed_at: h.ago(4) }),
          // used, but the profile has not been updated yet
          link(h, 'u-fatima', 2, { used_at: h.ago(1) }),
        ],
      },
    },
  });
})();
