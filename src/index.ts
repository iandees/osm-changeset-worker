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
import { getCoveringGeohashes } from './geohash';

const app = new Hono<{ Bindings: Env }>();

// Mount API routes first (so they take precedence)
app.route('/api', api);

// Serve index.html for changeset permalinks
app.get('/changeset/:id', async (c) => {
  // @ts-ignore - ASSETS binding
  if (c.env.ASSETS) {
    // Create a new request for index.html
    const url = new URL(c.req.url);
    url.pathname = '/';
    // @ts-ignore
    return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
  }
  return c.notFound();
});

// Serve static assets - fallback to ASSETS binding if available
app.get('*', async (c) => {
  // @ts-ignore - ASSETS binding
  if (c.env.ASSETS) {
    // @ts-ignore
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.notFound();
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

      // Enrich changesets with Geohashes for indexing
      const changesetsWithGeohash = changesets.map(cs => {
        const hasBbox =
          cs.min_lon !== undefined && cs.min_lon !== null &&
          cs.min_lat !== undefined && cs.min_lat !== null &&
          cs.max_lon !== undefined && cs.max_lon !== null &&
          cs.max_lat !== undefined && cs.max_lat !== null;

        return {
          ...cs,
          // Ensure undefined values are converted to null for D1
          min_lon: cs.min_lon ?? null,
          min_lat: cs.min_lat ?? null,
          max_lon: cs.max_lon ?? null,
          max_lat: cs.max_lat ?? null,
          closed_at: cs.closed_at ?? null,
          geohashes: hasBbox
            ? getCoveringGeohashes(cs.min_lon, cs.min_lat, cs.max_lon, cs.max_lat)
            : []
        };
      });

      console.log(`Found ${changesets.length} changesets`);

      if (changesets.length > 0) {
        // Store changesets in database
        await storeChangesets(env.DB, changesetsWithGeohash);
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
