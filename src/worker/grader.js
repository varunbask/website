import knex from 'knex';
import { readFile } from 'fs/promises';
import knexfile from '../db/knexfile.cjs';

// Configuration from environment
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '5', 10);

// Same knexfile as the server, so both always resolve the same database file
const db = knex(knexfile);

/**
 * Structured-output request. `json_schema` is accepted by OpenAI and by
 * Anthropic's OpenAI-compatible endpoint, and returns bare JSON in this
 * shape. Anthropic rejects the older `json_object` mode with a 400, and
 * with no format at all it wraps the JSON in a code fence.
 */
const RESULTS_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'grading_results',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'feedback', 'score'],
            properties: {
              id: { type: 'integer' },
              feedback: { type: 'string' },
              score: { type: 'number' }
            }
          }
        }
      }
    }
  }
};

// Image limits of the API: 10 MB per base64-encoded image and 32 MB per
// request. The request budget leaves room for the text and the JSON envelope.
const MAX_IMAGE_BASE64 = 10 * 1024 * 1024;
const MAX_REQUEST_IMAGE_BASE64 = 24 * 1024 * 1024;

const INSTRUCTIONS = `Grade these homework submissions. Provide a brief feedback and a score (0-100) for each.
Some submissions are photos of handwritten work. Read the photo itself, and if part of it is illegible, say which part in the feedback rather than guessing.
Format the response as a JSON object { "results": [...] } where each item is { id: number, feedback: string, score: number }.

Submissions:`;

const isImage = (submission) =>
  typeof submission.file_type === 'string' && submission.file_type.startsWith('image/');

/**
 * Builds the user message for a batch: a text part per submission, and for a
 * photo submission the image itself right after the part that names its id.
 * Returns the message parts, the ids included in the request, and the photos
 * that can never be graded (file missing or too large). A photo that only
 * exceeds this request's size budget is left out and stays pending.
 */
export async function buildMessageParts(pending) {
  const parts = [{ type: 'text', text: INSTRUCTIONS }];
  const ids = [];
  const unreadable = [];
  let imageBytes = 0;

  for (const p of pending) {
    if (!isImage(p)) {
      parts.push({ type: 'text', text: `ID: ${p.id}\nContent: ${p.content_text}` });
      ids.push(p.id);
      continue;
    }

    let base64;
    try {
      base64 = (await readFile(p.file_path)).toString('base64');
    } catch {
      unreadable.push({ id: p.id, reason: 'The uploaded photo could not be read for grading' });
      continue;
    }
    if (base64.length > MAX_IMAGE_BASE64) {
      unreadable.push({ id: p.id, reason: 'The photo is too large to grade (limit is about 7 MB)' });
      continue;
    }
    if (imageBytes + base64.length > MAX_REQUEST_IMAGE_BASE64) continue;

    imageBytes += base64.length;
    parts.push({ type: 'text', text: `ID: ${p.id}\nContent: the photo that follows.` });
    parts.push({ type: 'image_url', image_url: { url: `data:${p.file_type};base64,${base64}` } });
    ids.push(p.id);
  }

  return { parts, ids, unreadable };
}

/**
 * Pulls the grading array out of an OpenAI-style chat completion.
 * Only well-formed results for ids in this batch are kept.
 */
export function parseResults(data, batchIds) {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('LLM response has no choices[0].message.content');
  }

  // The schema asks for { results: [...] }; a bare array or a `grades` key is still tolerated
  const parsed = JSON.parse(content);
  const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.grades);
  if (!Array.isArray(results)) {
    throw new Error('LLM response content is not an array of results');
  }

  return results
    .map(r => ({ id: Number(r?.id), feedback: r?.feedback, score: r?.score }))
    .filter(r => batchIds.includes(r.id)
      && typeof r.feedback === 'string'
      && typeof r.score === 'number');
}

/**
 * Grades a batch of pending submissions using an OpenAI-compatible LLM.
 */
export async function gradeBatch() {
  // Check variables inside the function to catch environment changes during tests
  const endpoint = process.env.LLM_ENDPOINT;
  const key = process.env.LLM_KEY;

  if (!endpoint || !key) {
    throw new Error('LLM_ENDPOINT and LLM_KEY must be set');
  }

  const pending = await db('submissions')
    .where('status', 'pending')
    .limit(BATCH_SIZE);

  if (pending.length === 0) {
    return { processed: 0 };
  }

  const { parts, ids, unreadable } = await buildMessageParts(pending);

  // A photo that can never be sent is failed now, so it is not retried forever
  for (const { id, reason } of unreadable) {
    await db('submissions')
      .where('id', id)
      .update({ status: 'failed', grading_result: reason });
  }

  if (ids.length === 0) {
    return { processed: 0 };
  }

  console.log(`Grading batch of ${ids.length} submissions...`);

  // Mark them as processing to avoid duplicate work by other workers
  await db('submissions')
    .whereIn('id', ids)
    .update({ status: 'processing' });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'gpt-4o',
        messages: [{ role: 'user', content: parts }],
        response_format: RESULTS_FORMAT
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const results = parseResults(data, ids);

    for (const result of results) {
      const submissionId = result.id;
      const gradingResult = JSON.stringify({
        feedback: result.feedback,
        score: result.score
      });

      await db('submissions')
        .where('id', submissionId)
        .update({
          status: 'graded',
          grading_result: gradingResult
        });
    }

    // Handle cases where LLM returned fewer results than requested
    const processedIds = results.map(r => r.id);
    const missedIds = ids.filter(id => !processedIds.includes(id));

    if (missedIds.length > 0) {
      await db('submissions')
        .whereIn('id', missedIds)
        .update({ status: 'failed', grading_result: 'LLM failed to return result for this ID in batch' });
    }

    return { processed: results.length };
  } catch (error) {
    console.error('Error during grading batch:', error);
    // Rollback status to pending for the whole batch so it can be retried
    await db('submissions')
      .whereIn('id', ids)
      .update({ status: 'pending' });
    throw error;
  }
}

// Export for testing/scheduling
export { db };
