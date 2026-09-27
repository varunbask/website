# Goal
Implement a homework submission system with file-based storage, Supabase authentication, and automated LLM grading via an OpenAI-compatible endpoint.

# Current context / assumptions
- The current website is a static HTML/CSS/JS site with a "warm paper" aesthetic.
- The project lacks a backend, so a Node.js/Express server must be scaffolded.
- Metadata (submission info, grading status) will be stored in a SQLite database.
- Binary files (images/PDFs) will be stored in a local `./uploads` directory.
- Authentication will be handled by Supabase.
- Grading is triggered by a cron job or when $N$ files accumulate.

# Architecture / proposed approach
A Node.js/Express API will serve as the backend, managing a SQLite database for submission metadata and an `uploads/` directory for files. A background worker will poll the DB for un-graded submissions, batch them, and send them to an OpenAI-compatible endpoint. The frontend will be extended with a new section using existing CSS variables to maintain style.

# Step-by-step tasks

## Phase 1: Backend Scaffolding & Database
- [ ] **Task 1.1: Initialize Node.js project**
  - **Skill**: `wshobson/agents@nodejs-backend-patterns` (46.2K installs)
  - Command: `npm init -y && npm install express multer sqlite3 knex dotenv cors`
  - Verify: `package.json` exists and contains dependencies.
- [ ] **Task 1.2: Setup SQLite Schema with Knex**
  - **Skill**: `agents-inc/skills@api-database-knex` (25 installs) or `darkinno/skills@sql-engineer` (11 installs)
  - File: `src/db/knexfile.js`, `src/db/migrations/YYYYMMDD_create_submissions.js`
  - Code:
    ```javascript
    exports.up = function(knex) {
      return knex.schema.createTable('submissions', (table) => {
        table.increments('id');
        table.string('student_id');
        table.string('file_path');
        table.string('file_type');
        table.text('content_text'); // For text-based homework
        table.string('status').defaultTo('pending'); // pending, processing, graded, failed
        table.text('grading_result');
        table.timestamp('created_at').defaultTo(knex.fn.now());
      });
    };
    ```
  - Verify: Run `npx knex migrate:latest` and check `db.sqlite`.

- [ ] **Task 1.3: Implement File Upload Endpoint**
  - **Skill**: `wshobson/agents@nodejs-backend-patterns`
  - File: `src/server.js`
  - Code: Use `multer` to save files to `./uploads`. Create `POST /api/submit` which writes metadata to SQLite.
  - Verify: `curl -F "file=@test.pdf" -F "student_id=123" http://localhost:3000/api/submit` returns 201 and file exists in `./uploads`.

## Phase 2: Authentication (Supabase)
- [ ] **Task 2.1: Integrate Supabase Client**
  - **Skill**: `supabase/agent-skills@supabase` (293.9K installs)
  - File: `src/auth.js`
  - Code: Initialize `@supabase/supabase-js`.
  - Verify: Mock a login flow and check if session is returned.
- [ ] **Task 2.2: Protect API Routes**
  - **Skill**: `supabase/agent-skills@supabase-postgres-best-practices` (418K installs)
  - File: `src/middleware/auth.js`
  - Code: Middleware to verify Supabase JWT on `POST /api/submit` and `GET /api/submissions`.

## Phase 3: Grading Worker (The Batcher)
- [ ] **Task 3.1: Implement Grading Logic**
  - **Skill**: `jamesrochabrun/skills@openai-prompt-engineer` (201 installs) or `typesafe-ai` (Internal)
  - File: `src/worker/grader.js`
  - Code:
    ```javascript
    async function gradeBatch() {
      const pending = await db('submissions').where('status', 'pending').limit(N);
      if (pending.length === 0) return;
      
      // Batch request to OpenAI-compatible API
      const response = await fetch(process.env.LLM_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.LLM_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: `Grade these: ${pending.map(p => p.content_text).join('\n---\n')}` })
      });
      // Update DB with results
    }
    ```
  - Verify: Run worker in a loop with dummy data.

- [ ] **Task 3.2: Schedule Worker (Cron + Threshold)**
  - **Skill**: `rivet-dev/skills@cron-jobs` (1.2K installs)
  - File: `src/worker/scheduler.js`
  - Code: Use `node-cron` for the interval and a simple count check on every `POST /api/submit`.

## Phase 4: Frontend Integration
- [ ] **Task 4.1: Create Submission UI**
  - **Skill**: `anthropics/skills@frontend-design` (925.5K installs)
  - File: `index.html`, `script.js`, `styles.css`
  - Code: Add a `<section id="homework">` with a form. Use `.btn-primary` and `.section-inner` classes.
  - Verify: Form appears and can upload a file via JS `fetch`.

# Tests / validation
- **Backend**: Unit tests for `grader.js` (mocking fetch) and integration tests for `POST /api/submit`.
- **TDD Cycle**: For every task, create `tests/task_name.test.js` -> Run `npm test` (fail) -> Implement -> Run `npm test` (pass). Use `test-driven-development` skill.

# Risks, tradeoffs, and open questions
- **Risk**: Large PDF files might exceed LLM context limits. *Mitigation*: Implement text extraction (e.g., `pdf-parse`) and chunking.
- **Tradeoff**: SQLite is local; if the site moves to a multi-container setup (like Docker Compose with multiple app instances), the SQLite file and `./uploads` must be in a shared volume.
- **Open Question**: Should the tutor see the "raw" grading result first, or is it automatically posted to the student?
