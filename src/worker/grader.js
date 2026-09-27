import knex from 'knex';
import fs from 'fs/promises';
import path from 'path';

// Configuration from environment
const DB_PATH = process.env.DB_PATH || './src/db/db.sqlite';
const LLM_ENDPOINT = process.env.LLM_ENDPOINT;
const LLM_KEY = process.env.LLM_KEY;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '5', 10);

const db = knex({
  client: 'sqlite3',
  connection: {
    filename: DB_PATH,
  },
  useNullAsDefault: true,
});

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

  console.log(`Grading batch of ${pending.length} submissions...`);

  // Mark them as processing to avoid duplicate work by other workers
  const ids = pending.map(p => p.id);
  await db('submissions')
    .whereIn('id', ids)
    .update({ status: 'processing' });

  try {
    // Construct prompt
    const prompt = `Grade these homework submissions. Provide a brief feedback and a score (0-100) for each. 
    Format the response as a JSON array of objects with { id: number, feedback: string, score: number }.
    
    Submissions:
    ${pending.map(p => `ID: ${p.id}\nContent: ${p.content_text}`).join('\n---\n')}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    // We expect the LLM to return something like { "results": [...] }
    // The prompt asks for a JSON array, but often models wrap it.
    // We'll try to find the array in the response.
    let results = data.results || data.grades || data.results || data;
    if (!Array.isArray(results)) {
      // Fallback: if it's a single object or wrapped differently
      const content = data.content || data.choices?.[0]?.message?.content;
      if (content) {
        const parsedContent = JSON.parse(content);
        results = Array.isArray(parsedContent) ? parsedContent : (parsedContent.results || []);
      }
    }

    // In a real scenario, we'd be more robust about parsing. 
    // For now, let's assume the results array matches the IDs.
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
