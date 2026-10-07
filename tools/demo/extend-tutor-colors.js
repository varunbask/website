/* Demo extension: lessons colored by tutor (portal/js/tutor-colors-model.js).
   Loaded by the local demo build right after demo-supabase.js. Adds the
   profiles.calendar_color column to the demo people, a calendar_colors() rpc
   like the real one, and one more tutor with no color chosen, so the automatic
   color shows beside the chosen ones.

   Try it
     ?as=admin    /portal/staff.html#/calendar?scope=all  three tutors, a legend of tutors
                  /portal/people.html#/everyone           each tutor and admin row has a Calendar color select
     ?as=tutor    Daniel Ortiz (violet): the week grid, Today
     ?as=parent   Grace Lin: Maya's calendar has violet (Daniel) and blue (Priya) lessons
     ?as=parent2  Jin Park: Leo's calendar has violet (Daniel) and an automatic color (Jordan Ames)
     ?as=student  Maya Lin, the same colors as her mother

   Colors
     Varun Baskaran (admin)  red     Daniel Ortiz (tutor)  violet
     Priya Shah (tutor2)     blue    Jordan Ames (tutor)   automatic */
(function () {
  'use strict';
  if (!window.portalDemo) return;
  const { db, helpers: h } = window.portalDemo;

  // Every demo person carries the column (null until the admin picks a color), like the real table
  const chosen = { 'u-admin': 'red', 'u-daniel': 'violet', 'u-priya': 'blue' };
  for (const p of db.profiles) p.calendar_color = chosen[p.id] ?? p.calendar_color ?? null;

  const profiles = [{
    id: 'u-jordan', full_name: 'Jordan Ames', email: 'jordan.ames@example.com', role: 'tutor', requested_role: null, signup_note: null,
    no_login: false, created_at: h.ago(40), calendar_color: null,
  }];
  const links = [{ tutor_id: 'u-jordan', student_id: 'u-leo', subject: 'Science', created_at: h.ago(30) }];

  // Jordan teaches Leo on Thursdays and Saturdays, a few weeks either side of today
  const sessions = [];
  const weekday = (off) => new Date(`${h.dayKey(off)}T12:00:00Z`).getUTCDay();
  for (let off = -21; off <= 35; off += 1) {
    if (![4, 6].includes(weekday(off))) continue;
    const past = off < 0;
    const saturday = weekday(off) === 6;
    sessions.push({
      id: h.id(), student_id: 'u-leo', tutor_id: 'u-jordan', series_id: null, subject: 'Science',
      starts_at: h.pt(off, saturday ? '11:00' : '15:30'), ends_at: h.pt(off, saturday ? '12:00' : '16:30'),
      location: saturday ? null : 'VP Education Group, San Gabriel', meeting_url: saturday ? 'https://meet.google.com/demo-science' : null,
      notes: null, status: 'scheduled', attendance: past ? 'present' : null, recap: past ? 'Lab write-up and a unit review.' : null,
      moved_from: null, changed_at: null, created_by: 'u-jordan', created_at: h.ago(30), updated_at: h.ago(30), cancelled_at: null,
      google_event_id: null, google_link: null, sync_state: 'synced',
    });
  }

  window.portalDemo.extend({
    tables: {
      profiles: { rows: profiles },
      tutor_students: { rows: links },
      sessions: { rows: sessions },
    },
    rpc: {
      // The colors of tutors and admins, by id and nothing else; nobody still waiting for approval gets them
      calendar_colors: async () => {
        if (h.role() === 'pending') return { data: [], error: null };
        return {
          data: db.profiles
            .filter((p) => ['tutor', 'admin'].includes(p.role) && p.calendar_color)
            .map((p) => ({ profile_id: p.id, color: p.calendar_color })),
          error: null,
        };
      },
    },
  });
}());
