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

## Homework drafts with the real model

`extend-homework-ai.js` answers "Draft with AI from lesson photos" with a
made-up draft after about 8 seconds. To try the real model locally, build the
demo and serve it with `serve-ai.mjs`, then add `&ai=live` to the page address:

    node tools/demo/build.mjs /tmp/homework-ai-demo
    node tools/demo/serve-ai.mjs 4265 /tmp/homework-ai-demo --env-file .env
    # http://127.0.0.1:4265/portal/staff.html?as=tutor&student=u-maya&ai=live#/assignments/todo?open=new&kind=assignment

`serve-ai.mjs` listens on 127.0.0.1 only, reads just `LLM_ENDPOINT`,
`LLM_KEY`, `LLM_MODEL` and `HOMEWORK_MODEL` from the env file (the draft uses
`HOMEWORK_MODEL`, default `claude-opus-5-5`), never prints them, and keeps
drafts in memory. Each live draft is a real, paid model call.
