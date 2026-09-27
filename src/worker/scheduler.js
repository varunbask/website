import cron from 'node-cron';
import { gradeBatch, db } from './grader.js';

/**
 * Starts the worker scheduler.
 * @param {object} options
 * @param {string} options.cronExpression - e.g., '* * * * *'
 * @param {number} options.threshold - number of pending submissions to trigger a batch
 */
export async function startScheduler(options = {}) {
  const { cronExpression = '*/5 * * * *', threshold = 5 } = options;

  console.log(`Starting scheduler: interval=${cronExpression}, threshold=${threshold}`);

  // 1. Regular interval-based job
  cron.schedule(cronExpression, async () => {
    console.log('[Scheduler] Running scheduled grading check...');
    try {
      const result = await gradeBatch();
      console.log(`[Scheduler] Batch complete. Processed: ${result.processed}`);
    } catch (err) {
      console.error('[Scheduler] Error in scheduled task:', err.message);
    }
  });

  // 2. We can also export a manual trigger function to be called by the server
  // when a new submission is added and the threshold is reached.
  return {
    checkThreshold: async () => {
      const count = await db('submissions').where('status', 'pending').count('id as count').first();
      const pendingCount = parseInt(count.count, 10);
      
      if (pendingCount >= threshold) {
        console.log(`[Scheduler] Threshold reached (${pendingCount} >= ${threshold}). Triggering batch...`);
        try {
          const result = await gradeBatch();
          console.log(`[Scheduler] Threshold batch complete. Processed: ${result.processed}`);
        } catch (err) {
          console.error('[Scheduler] Error in threshold task:', err.message);
        }
      }
    }
  };
}

// If run directly, start a default scheduler
if (import.meta.url === `file://${process.argv[1]}`) {
  startScheduler().catch(console.error);
}
