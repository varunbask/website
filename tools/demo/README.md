# Local demo

`npm run demo` builds the whole site into `.demo/` and serves it on
http://localhost:4180 with the portal wired to `demo-supabase.js`: made-up
people, sessions, homework and billing kept in memory. Nothing reaches
Supabase or the real APIs, and a reload starts fresh.

- Pick a role with `?as=`: admin, tutor, tutor2, student, student2, parent,
  parent2 or pending, for example `/portal/staff.html?as=admin#/today`.
- Or sign in on `/portal/` with any demo address (any password), such as
  daniel.ortiz@example.com.
- `node tools/demo/build.mjs out --src ../other-checkout` builds another
  checkout (a feature branch) with this demo client.

The access rules in the demo are a simplified copy of the real row level
security, enough to show each role what it would see. They are not a test of
the real policies (`npm run test:rls` does that against Supabase).
