// Main Cloudflare Worker entry point
// This worker handles both HTTP requests (API) and scheduled cron jobs (changeset updates)
import { Hono } from 'hono';
import type { Env } from './types';
import api from './api';
import {
  fetchChangesets,
  fetchReplicationState,
  getLatestSequenceNumber
} from './fetcher';
import {
  getReplicationState,
  updateReplicationState,
  storeChangesets
} from './database';

const app = new Hono<{ Bindings: Env }>();

// Mount API routes
app.route('/api', api);

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'OSM Changeset Worker',
    description: 'A Cloudflare Worker that tracks OpenStreetMap changesets',
    endpoints: {
      api: '/api/changesets',
      stats: '/api/stats',
      changeset: '/api/changesets/:id'
    }
  });
});

/**
 * Scheduled cron handler - runs every minute to fetch new changesets
 * Processes multiple replication files to catch up, up to 40 seconds
 */
async function handleScheduled(env: Env, ctx: ExecutionContext): Promise<void> {
  console.log('Starting scheduled changeset update');

  const startTime = Date.now();
  const maxRunTime = 40000; // 40 seconds in milliseconds
  let processedCount = 0;

  try {
    // Get current replication state from database
    let state = await getReplicationState(env.DB);

    if (!state) {
      // Initialize with latest sequence number if not set
      console.log('No replication state found, initializing...');
      const latestSeq = await getLatestSequenceNumber();

      if (!latestSeq) {
        console.error('Failed to get latest sequence number');
        return;
      }

      // Start from a recent sequence (e.g., 100 sequences ago)
      const startSeq = Math.max(0, latestSeq - 100);
      await updateReplicationState(env.DB, startSeq, new Date().toISOString());
      state = await getReplicationState(env.DB);

      if (!state) {
        console.error('Failed to initialize replication state');
        return;
      }
    }

    console.log(`Starting from sequence: ${state.sequence_number}`);

    // Get the latest available sequence to know how far behind we are
    const latestSeq = await getLatestSequenceNumber();
    if (latestSeq) {
      const behind = latestSeq - state.sequence_number;
      console.log(`Currently ${behind} sequences behind (latest: ${latestSeq})`);
    }

    // Process multiple sequences until we catch up or run out of time
    while (Date.now() - startTime < maxRunTime) {
      // Fetch next sequence
      const nextSequence = state.sequence_number + 1;

      // Check if this sequence exists
      const nextState = await fetchReplicationState(nextSequence);

      if (!nextState) {
        console.log(`Sequence ${nextSequence} not yet available - caught up!`);
        break;
      }

      console.log(`Fetching changesets for sequence ${nextSequence}`);

      // Fetch and parse changesets
      const changesets = await fetchChangesets(nextSequence);

      console.log(`Found ${changesets.length} changesets`);

      if (changesets.length > 0) {
        // Store changesets in database
        await storeChangesets(env.DB, changesets);
        console.log(`Stored ${changesets.length} changesets`);
      }

      // Update replication state
      await updateReplicationState(env.DB, nextSequence, nextState.timestamp);
      console.log(`Updated replication state to sequence ${nextSequence}`);

      // Update state for next iteration
      state.sequence_number = nextSequence;
      processedCount++;

      // Check remaining time
      const elapsed = Date.now() - startTime;
      const remaining = maxRunTime - elapsed;
      console.log(`Processed ${processedCount} sequences, ${Math.round(remaining / 1000)}s remaining`);
    }

    const totalTime = Date.now() - startTime;
    console.log(`Completed: processed ${processedCount} sequences in ${Math.round(totalTime / 1000)}s`);

  } catch (error) {
    console.error('Error in scheduled handler:', error);
  }
}

// Export worker
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(env, ctx));
  }
};
