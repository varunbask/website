import { test, expect, describe, beforeEach, vi } from 'vitest';
import { gradeBatch, parseResults, db } from '../src/worker/grader.js';
import { execSync } from 'child_process';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// A 1x1 PNG, enough to stand in for a photo of handwritten work
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// Wraps results the way an OpenAI-style endpoint does in json_object mode
function completion(body) {
  return { choices: [{ message: { content: JSON.stringify(body) } }] };
}

// Helper to reset DB
function resetDb() {
  // Use the .cjs file specifically for the CLI
  execSync('npx knex migrate:latest --knexfile src/db/knexfile.cjs', { stdio: 'inherit' });
  // Clear the table
  execSync('node -e "import knex from \'knex\'; const db = knex({client: \'sqlite3\', connection: {filename: \'./src/db/db.sqlite\'}, useNullAsDefault: true}); db(\'submissions\').truncate().then(() => process.exit(0));"', { stdio: 'inherit' });
}

describe('Grading Worker', () => {
  const DB_PATH = './src/db/db.sqlite';
  const LLM_ENDPOINT = 'http://localhost:8080/v1/chat/completions';
  const LLM_KEY = 'test-key';

  beforeEach(async () => {
    resetDb();
    process.env.LLM_ENDPOINT = LLM_ENDPOINT;
    process.env.LLM_KEY = LLM_KEY;
    process.env.DB_PATH = DB_PATH;
    process.env.BATCH_SIZE = '5';
    
    // Mock fetch globally
    global.fetch = vi.fn();
  });

  test('should fail if LLM config is missing', async () => {
    delete process.env.LLM_ENDPOINT;
    await expect(gradeBatch()).rejects.toThrow('LLM_ENDPOINT and LLM_KEY must be set');
  });

  test('should return 0 processed if no pending submissions', async () => {
    const result = await gradeBatch();
    expect(result.processed).toBe(0);
  });

  test('should correctly process a batch of submissions (Mocked)', async () => {
    // 1. Insert dummy data
    await db('submissions').insert([
      { student_id: 's1', content_text: 'Hello, this is my homework.', status: 'pending' },
      { student_id: 's2', content_text: 'Second homework.', status: 'pending' }
    ]);

    // 2. Mock fetch response
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => completion({
        results: [
          { id: 1, feedback: 'Good work!', score: 95 },
          { id: 2, feedback: 'Needs more detail.', score: 70 }
        ]
      })
    });

    // 3. Run grading
    const result = await gradeBatch();

    // 4. Verify
    expect(result.processed).toBe(2);

    const graded = await db('submissions').where('status', 'graded').select();
    expect(graded).toHaveLength(2);
    
    // Check one of them
    const firstGraded = graded.find(g => g.id === 1);
    expect(JSON.parse(firstGraded.grading_result).score).toBe(95);
  });

  test('should mark as failed if LLM fails to return results for some IDs', async () => {
    await db('submissions').insert([
      { student_id: 's1', content_text: 'HW 1', status: 'pending' },
      { student_id: 's2', content_text: 'HW 2', status: 'pending' }
    ]);

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => completion({
        results: [
          { id: 1, feedback: 'Great!', score: 100 }
          // Missing ID 2
        ]
      })
    });

    await gradeBatch();

    const failed = await db('submissions').where('status', 'failed').select();
    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBe(2);
  });

  test('should rollback to pending if fetch fails', async () => {
    await db('submissions').insert([
      { student_id: 's1', content_text: 'HW 1', status: 'pending' }
    ]);

    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    });

    await expect(gradeBatch()).rejects.toThrow();

    const submissions = await db('submissions').where('id', 1).select();
    expect(submissions[0].status).toBe('pending');
  });

  test('parseResults drops malformed results and ids outside the batch', () => {
    const data = completion({
      results: [
        { id: '1', feedback: 'OK', score: 80 },
        { id: 2, feedback: 'No score' },
        { id: 99, feedback: 'Not in batch', score: 50 }
      ]
    });
    expect(parseResults(data, [1, 2])).toEqual([{ id: 1, feedback: 'OK', score: 80 }]);
  });

  test('parseResults rejects a response without message content', () => {
    expect(() => parseResults({ results: [] }, [1])).toThrow();
  });

  test('asks for structured output with json_schema (Anthropic rejects json_object)', async () => {
    await db('submissions').insert([
      { student_id: 's1', content_text: 'HW 1', status: 'pending' }
    ]);

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ results: [{ id: 1, feedback: 'ok', score: 90 }] }) } }]
      })
    });

    await gradeBatch();

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.response_format.type).toBe('json_schema');
    expect(sent.response_format.json_schema.schema.required).toEqual(['results']);
  });

  test('sends a photo submission to the model as an image, not as OCR text', async () => {
    const photo = path.join(mkdtempSync(path.join(tmpdir(), 'hw-')), 'page.png');
    writeFileSync(photo, TINY_PNG);

    await db('submissions').insert([
      { student_id: 's1', file_path: photo, file_type: 'image/png', status: 'pending' },
      { student_id: 's2', content_text: 'HW 2', file_type: 'text/plain', status: 'pending' }
    ]);

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => completion({
        results: [
          { id: 1, feedback: 'Read from the photo.', score: 88 },
          { id: 2, feedback: 'Fine.', score: 75 }
        ]
      })
    });

    const result = await gradeBatch();
    expect(result.processed).toBe(2);

    const parts = JSON.parse(global.fetch.mock.calls[0][1].body).messages[0].content;
    const imageAt = parts.findIndex(p => p.type === 'image_url');
    expect(imageAt).toBeGreaterThan(0);
    expect(parts[imageAt].image_url.url).toBe(`data:image/png;base64,${TINY_PNG.toString('base64')}`);
    // The part just before the image names the submission it belongs to
    expect(parts[imageAt - 1].text).toContain('ID: 1');
    expect(parts.some(p => p.type === 'text' && p.text.includes('Content: HW 2'))).toBe(true);

    const graded = await db('submissions').where('status', 'graded').select();
    expect(graded).toHaveLength(2);
  });

  test('fails a photo whose file is missing and still grades the rest', async () => {
    await db('submissions').insert([
      { student_id: 's1', file_path: '/nonexistent/page.png', file_type: 'image/png', status: 'pending' },
      { student_id: 's2', content_text: 'HW 2', file_type: 'text/plain', status: 'pending' }
    ]);

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => completion({ results: [{ id: 2, feedback: 'Fine.', score: 75 }] })
    });

    const result = await gradeBatch();
    expect(result.processed).toBe(1);

    const parts = JSON.parse(global.fetch.mock.calls[0][1].body).messages[0].content;
    expect(parts.some(p => p.type === 'image_url')).toBe(false);

    const [photo] = await db('submissions').where('id', 1).select();
    expect(photo.status).toBe('failed');
    expect(photo.grading_result).toContain('could not be read');
    const [text] = await db('submissions').where('id', 2).select();
    expect(text.status).toBe('graded');
  });

  test('does not call the model when the only submission is an unreadable photo', async () => {
    await db('submissions').insert([
      { student_id: 's1', file_path: '/nonexistent/page.png', file_type: 'image/png', status: 'pending' }
    ]);

    const result = await gradeBatch();

    expect(result.processed).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
    const [photo] = await db('submissions').where('id', 1).select();
    expect(photo.status).toBe('failed');
  });
});
