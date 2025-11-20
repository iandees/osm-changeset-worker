// API routes using Hono framework
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Changeset } from './types';
import { queryChangesets, getChangesetById } from './database';
import { validateBbox } from './utils';

const api = new Hono<{ Bindings: Env }>();

// Enable CORS for API endpoints
api.use('/*', cors());

/**
 * GET /api/changesets - List changesets with filters
 * Query parameters:
 * - user_id: Filter by user ID
 * - start_date: Filter by start date (ISO 8601)
 * - end_date: Filter by end date (ISO 8601)
 * - bbox: Bounding box (format: min_lon,min_lat,max_lon,max_lat)
 * - limit: Maximum number of results (default: 100)
 * - offset: Offset for pagination (default: 0)
 */
api.get('/changesets', async (c) => {
  const userId = c.req.query('user_id');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  const bboxStr = c.req.query('bbox');
  const limitStr = c.req.query('limit');
  const offsetStr = c.req.query('offset');
  
  const filters: {
    userId?: number;
    startDate?: string;
    endDate?: string;
    bbox?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
    limit?: number;
    offset?: number;
  } = {
    limit: limitStr ? parseInt(limitStr) : 100,
    offset: offsetStr ? parseInt(offsetStr) : 0
  };
  
  if (userId) {
    filters.userId = parseInt(userId);
  }
  
  if (startDate) {
    filters.startDate = startDate;
  }
  
  if (endDate) {
    filters.endDate = endDate;
  }
  
  if (bboxStr) {
    const [minLon, minLat, maxLon, maxLat] = bboxStr.split(',').map(parseFloat);
    if (!isNaN(minLon) && !isNaN(minLat) && !isNaN(maxLon) && !isNaN(maxLat)) {
      const bbox = { minLat, maxLat, minLon, maxLon };
      if (validateBbox(bbox)) {
        filters.bbox = bbox;
      } else {
        return c.json({ error: 'Invalid bounding box coordinates' }, 400);
      }
    } else {
      return c.json({ error: 'Invalid bounding box format' }, 400);
    }
  }
  
  try {
    const changesets = await queryChangesets(c.env.DB, filters);
    
    // Fetch tags for each changeset
    const changesetsWithTags = await Promise.all(
      changesets.map(async (cs) => {
        const tags = await c.env.DB.prepare(
          'SELECT key, value FROM changeset_tags WHERE changeset_id = ?'
        ).bind(cs.id).all<{ key: string; value: string }>();
        
        if (tags.results && tags.results.length > 0) {
          cs.tags = {};
          tags.results.forEach(tag => {
            cs.tags![tag.key] = tag.value;
          });
        }
        
        // Convert open from integer to boolean
        cs.open = !!(cs.open as any);
        
        return cs;
      })
    );
    
    return c.json({
      type: 'FeatureCollection',
      features: changesetsWithTags.map(changesetToFeature)
    });
  } catch (error) {
    console.error('Error querying changesets:', error);
    return c.json({ error: 'Failed to query changesets' }, 500);
  }
});

/**
 * GET /api/changesets/:id - Get a single changeset by ID
 */
api.get('/changesets/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  
  if (isNaN(id)) {
    return c.json({ error: 'Invalid changeset ID' }, 400);
  }
  
  try {
    const changeset = await getChangesetById(c.env.DB, id);
    
    if (!changeset) {
      return c.json({ error: 'Changeset not found' }, 404);
    }
    
    return c.json(changesetToFeature(changeset));
  } catch (error) {
    console.error('Error fetching changeset:', error);
    return c.json({ error: 'Failed to fetch changeset' }, 500);
  }
});

/**
 * GET /api/stats - Get database statistics
 */
api.get('/stats', async (c) => {
  try {
    const totalChangesets = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM changesets'
    ).first<{ count: number }>();
    
    const totalUsers = await c.env.DB.prepare(
      'SELECT COUNT(DISTINCT user_id) as count FROM changesets WHERE user_id IS NOT NULL'
    ).first<{ count: number }>();
    
    const replicationState = await c.env.DB.prepare(
      'SELECT sequence_number, timestamp FROM replication_state WHERE id = 1'
    ).first<{ sequence_number: number; timestamp: string }>();
    
    return c.json({
      total_changesets: totalChangesets?.count || 0,
      total_users: totalUsers?.count || 0,
      replication_state: replicationState
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return c.json({ error: 'Failed to fetch stats' }, 500);
  }
});

/**
 * Convert changeset to GeoJSON feature (OSMCha-like format)
 */
function changesetToFeature(changeset: Changeset): any {
  const geometry = changeset.min_lat && changeset.max_lat && 
                   changeset.min_lon && changeset.max_lon
    ? {
        type: 'Polygon',
        coordinates: [[
          [changeset.min_lon, changeset.min_lat],
          [changeset.max_lon, changeset.min_lat],
          [changeset.max_lon, changeset.max_lat],
          [changeset.min_lon, changeset.max_lat],
          [changeset.min_lon, changeset.min_lat]
        ]]
      }
    : null;
  
  return {
    type: 'Feature',
    id: changeset.id,
    geometry,
    properties: {
      id: changeset.id,
      created_at: changeset.created_at,
      closed_at: changeset.closed_at,
      open: changeset.open,
      user: changeset.user_name,
      uid: changeset.user_id,
      bbox: changeset.min_lat ? [
        changeset.min_lon,
        changeset.min_lat,
        changeset.max_lon,
        changeset.max_lat
      ] : null,
      num_changes: changeset.num_changes,
      comments_count: changeset.comments_count,
      tags: changeset.tags || {}
    }
  };
}

export default api;
