// API routes using Hono framework
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { XMLParser } from 'fast-xml-parser';
import type { Env, Changeset } from './types';
import {
  queryChangesets,
  getChangesetById,
  getUserNames,
  getUserIdsByName,
  getTopMappers24h,
  getTopEditors24h
} from './database';
import { validateBbox } from './utils';

const api = new Hono<{ Bindings: Env }>();

// Enable CORS for API endpoints
api.use('/*', cors());

/**
 * GET /api/changesets - List changesets with filters
 * Query parameters:
 * - user_id: Filter by user ID
 * - user_name: Filter by username (searches user_names table for all user_ids with this name)
 * - start_date: Filter by start date (ISO 8601)
 * - end_date: Filter by end date (ISO 8601)
 * - bbox: Bounding box (format: min_lon,min_lat,max_lon,max_lat)
 * - bbox_size_min: Minimum bounding box size in square degrees
 * - bbox_size_max: Maximum bounding box size in square degrees
 * - tags: Filter by tags (format: key=value, can specify multiple e.g., ?tags=comment=test&tags=created_by=JOSM)
 * - limit: Maximum number of results (default: 100)
 * - offset: Offset for pagination (default: 0)
 */
api.get('/changesets', async (c) => {
  const userId = c.req.query('user_id');
  const userName = c.req.query('user_name');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  const bboxStr = c.req.query('bbox');
  const bboxSizeMinStr = c.req.query('bbox_size_min');
  const bboxSizeMaxStr = c.req.query('bbox_size_max');
  const tagsParams = c.req.queries('tags');
  const limitStr = c.req.query('limit');
  const offsetStr = c.req.query('offset');

  const filters: {
    userId?: number;
    userName?: string;
    startDate?: string;
    endDate?: string;
    bbox?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
    bboxSizeMin?: number;
    bboxSizeMax?: number;
    tags?: Record<string, string>;
    limit?: number;
    offset?: number;
  } = {
    limit: limitStr ? parseInt(limitStr) : 100,
    offset: offsetStr ? parseInt(offsetStr) : 0
  };

  if (userId) {
    filters.userId = parseInt(userId);
  }

  if (userName) {
    filters.userName = userName;
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

  if (bboxSizeMinStr) {
    const bboxSizeMin = parseFloat(bboxSizeMinStr);
    if (!isNaN(bboxSizeMin) && bboxSizeMin >= 0) {
      filters.bboxSizeMin = bboxSizeMin;
    } else {
      return c.json({ error: 'Invalid bbox_size_min value' }, 400);
    }
  }

  if (bboxSizeMaxStr) {
    const bboxSizeMax = parseFloat(bboxSizeMaxStr);
    if (!isNaN(bboxSizeMax) && bboxSizeMax >= 0) {
      filters.bboxSizeMax = bboxSizeMax;
    } else {
      return c.json({ error: 'Invalid bbox_size_max value' }, 400);
    }
  }

  // Parse tags filter - format: key=value
  if (tagsParams && tagsParams.length > 0) {
    filters.tags = {};
    for (const tagParam of tagsParams) {
      const [key, value] = tagParam.split('=', 2);
      if (key && value !== undefined) {
        filters.tags[key] = value;
      } else {
        return c.json({ error: 'Invalid tag format. Use: tags=key=value' }, 400);
      }
    }
  }

  try {
    const changesets = await queryChangesets(c.env.DB, filters);

    // Tags are already parsed from JSON in queryChangesets
    // Convert open from integer to boolean (already done in queryChangesets)
    return c.json({
      type: 'FeatureCollection',
      features: changesets.map(changesetToFeature)
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
 * GET /api/users/:id/names - Get username history for a user ID
 */
api.get('/users/:id/names', async (c) => {
  const id = parseInt(c.req.param('id'));

  if (isNaN(id)) {
    return c.json({ error: 'Invalid user ID' }, 400);
  }

  try {
    const names = await getUserNames(c.env.DB, id);

    return c.json({
      user_id: id,
      names: names
    });
  } catch (error) {
    console.error('Error fetching user names:', error);
    return c.json({ error: 'Failed to fetch user names' }, 500);
  }
});

/**
 * GET /api/users/by-name/:name - Get user ID(s) for a username
 */
api.get('/users/by-name/:name', async (c) => {
  const name = c.req.param('name');

  if (!name) {
    return c.json({ error: 'Username is required' }, 400);
  }

  try {
    const userIds = await getUserIdsByName(c.env.DB, name);

    return c.json({
      user_name: name,
      user_ids: userIds
    });
  } catch (error) {
    console.error('Error fetching user IDs:', error);
    return c.json({ error: 'Failed to fetch user IDs' }, 500);
  }
});

/**
 * GET /api/stats/24h - Get statistics for the last 24 hours
 */
api.get('/stats/24h', async (c) => {
  try {
    const [topMappers, topEditors] = await Promise.all([
      getTopMappers24h(c.env.DB),
      getTopEditors24h(c.env.DB)
    ]);

    return c.json({
      top_mappers: topMappers,
      top_editors: topEditors
    });
  } catch (error) {
    console.error('Error fetching 24h stats:', error);
    return c.json({ error: 'Failed to fetch stats' }, 500);
  }
});

/**
 * GET /api/changesets/:id/adiff - Get augmented diff for a changeset as GeoJSON
 */
api.get('/changesets/:id/adiff', async (c) => {
  const id = parseInt(c.req.param('id'));

  if (isNaN(id)) {
    return c.json({ error: 'Invalid changeset ID' }, 400);
  }

  try {
    const response = await fetch(`https://adiffs.osmcha.org/changesets/${id}.adiff`);

    if (!response.ok) {
      return c.json({ error: 'Failed to fetch adiff from OSMCha' }, response.status as any);
    }

    const xmlData = await response.text();
    const geojson = convertAdiffToGeoJSON(xmlData);

    return c.json(geojson);
  } catch (error) {
    console.error('Error fetching adiff:', error);
    return c.json({ error: 'Failed to process adiff' }, 500);
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

/**
 * Convert Augmented Diff XML to GeoJSON
 */
function convertAdiffToGeoJSON(xmlData: string) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    isArray: (name) => ["action", "node", "way", "relation", "nd", "member", "tag"].indexOf(name) !== -1
  });
  const jsonObj = parser.parse(xmlData);

  const features: any[] = [];

  if (jsonObj.osm && jsonObj.osm.action) {
    const actions = Array.isArray(jsonObj.osm.action) ? jsonObj.osm.action : [jsonObj.osm.action];

    for (const action of actions) {
      const type = action.type; // create, modify, delete

      if (type === 'create') {
        // For create actions, the element is directly under the action node
        extractFeatures(action, features, type, 'new');
      } else {
        if (action.old) {
          extractFeatures(action.old, features, type, 'old');
        }

        if (action.new && type !== 'delete') {
          extractFeatures(action.new, features, type, 'new');
        }
      }
    }
  }

  return {
    type: "FeatureCollection",
    features: features
  };
}

function extractFeatures(container: any, features: any[], actionType: string, version: string) {
  if (container.node) {
    container.node.forEach((node: any) => {
      const f = nodeToFeature(node);
      if (f) {
        f.properties = { ...f.properties, changeType: actionType, version };
        features.push(f);
      }
    });
  }
  if (container.way) {
    container.way.forEach((way: any) => {
      const f = wayToFeature(way);
      if (f) {
        f.properties = { ...f.properties, changeType: actionType, version };
        features.push(f);
      }
    });
  }
}

function nodeToFeature(node: any) {
  if (!node.lat || !node.lon) return null;
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [parseFloat(node.lon), parseFloat(node.lat)]
    },
    properties: {
      type: "node",
      id: node.id,
      tags: parseTags(node.tag)
    }
  };
}

function wayToFeature(way: any) {
  if (!way.nd || way.nd.length === 0) return null;

  const coordinates = way.nd
    .filter((nd: any) => nd.lat && nd.lon)
    .map((nd: any) => [parseFloat(nd.lon), parseFloat(nd.lat)]);

  if (coordinates.length < 2) return null;

  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: coordinates
    },
    properties: {
      type: "way",
      id: way.id,
      tags: parseTags(way.tag)
    }
  };
}

function parseTags(tags: any) {
  if (!tags) return {};
  const result: Record<string, string> = {};
  const tagArray = Array.isArray(tags) ? tags : [tags];
  tagArray.forEach((t: any) => {
    if (t.k && t.v) result[t.k] = t.v;
  });
  return result;
}

export default api;
