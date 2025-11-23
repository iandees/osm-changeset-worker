// Database operations for changesets
import type { Changeset, ReplicationState } from './types';
import { getCoveringGeohashes, getSearchGeohashes } from './geohash';

/**
 * Get the current replication state from database
 */
export async function getReplicationState(db: D1Database): Promise<ReplicationState | null> {
  const result = await db.prepare(
    'SELECT id, sequence_number, timestamp FROM replication_state WHERE id = 1'
  ).first<ReplicationState>();

  return result || null;
}

/**
 * Update the replication state in database
 */
export async function updateReplicationState(
  db: D1Database,
  sequenceNumber: number,
  timestamp: string
): Promise<void> {
  await db.prepare(
    'UPDATE replication_state SET sequence_number = ?, timestamp = ? WHERE id = 1'
  ).bind(sequenceNumber, timestamp).run();
}

/**
 * Store a changeset and its tags in the database
 */
export async function storeChangeset(db: D1Database, changeset: Changeset): Promise<void> {
  // Serialize tags to JSON
  const tagsJson = changeset.tags && Object.keys(changeset.tags).length > 0
    ? JSON.stringify(changeset.tags)
    : null;

  // Insert or replace changeset with tags as JSON
  await db.prepare(`
    INSERT OR REPLACE INTO changesets (
      id, created_at, closed_at, open, user_id, user_name,
      min_lat, max_lat, min_lon, max_lon, num_changes, comments_count, tags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    changeset.id,
    changeset.created_at,
    changeset.closed_at || null,
    changeset.open ? 1 : 0,
    changeset.user_id || null,
    changeset.user_name || null,
    changeset.min_lat || null,
    changeset.max_lat || null,
    changeset.min_lon || null,
    changeset.max_lon || null,
    changeset.num_changes || 0,
    changeset.comments_count || 0,
    tagsJson
  ).run();
}

/**
 * Store multiple changesets in a batch
 */
export async function storeChangesets(db: D1Database, changesets: any[]) {
  // Insert changesets
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO changesets (
      id, created_at, closed_at, min_lat, min_lon, max_lat, max_lon,
      user_id, user_name, num_changes, comments_count, tags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batch = changesets.map(cs => stmt.bind(
    cs.id, cs.created_at, cs.closed_at,
    cs.min_lat, cs.min_lon, cs.max_lat, cs.max_lon,
    cs.user_id, cs.user_name, cs.num_changes, cs.comments_count,
    JSON.stringify(cs.tags)
  ));

  // Insert Geohashes into index table
  const geohashStmt = db.prepare(`
    INSERT OR IGNORE INTO changeset_geohashes (changeset_id, geohash) VALUES (?, ?)
  `);

  const geohashBatch: any[] = [];
  changesets.forEach(cs => {
    if (cs.geohashes && Array.isArray(cs.geohashes)) {
      cs.geohashes.forEach((hash: string) => {
        geohashBatch.push(geohashStmt.bind(cs.id, hash));
      });
    }
  });

  await db.batch([...batch, ...geohashBatch]);
}

/**
 * Query changesets with filters
 */
export async function queryChangesets(
  db: D1Database,
  filters: any
) {
  let query = 'SELECT * FROM changesets WHERE 1=1';
  const params: any[] = [];

  if (filters.userId) {
    query += ' AND user_id = ?';
    params.push(filters.userId);
  }

  // Filter by username - lookup user_ids from user_names table
  if (filters.userName) {
    query += ` AND user_id IN (
      SELECT DISTINCT user_id FROM user_names WHERE user_name = ?
    )`;
    params.push(filters.userName);
  }

  if (filters.startDate) {
    query += ' AND created_at >= ?';
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    query += ' AND created_at <= ?';
    params.push(filters.endDate);
  }

  if (filters.bbox) {
    const { minLon, minLat, maxLon, maxLat } = filters.bbox;

    // Calculate Geohashes that cover this bbox for searching
    // This returns hashes for ALL precision levels to match any indexed changeset
    const geohashes = getSearchGeohashes(minLon, minLat, maxLon, maxLat);

    if (geohashes !== null && geohashes.length > 0) {
      // Add Geohash index filter using subquery
      const placeholders = geohashes.map(() => '?').join(',');
      query += ` AND id IN (SELECT changeset_id FROM changeset_geohashes WHERE geohash IN (${placeholders}))`;
      params.push(...geohashes);
    }
    // If geohashes is null, it means the query area is too large for the index.
    // We skip the index filter and rely on the lat/lon bounds check below.

    // Keep the precise bbox filter for accuracy
    query += ' AND min_lat >= ? AND max_lat <= ? AND min_lon >= ? AND max_lon <= ?';
    params.push(minLat, maxLat, minLon, maxLon);
  }

  // Filter by bbox size (area in square degrees)
  if (filters.bboxSizeMin !== undefined || filters.bboxSizeMax !== undefined) {
    query += ` AND min_lat IS NOT NULL
               AND max_lat IS NOT NULL
               AND min_lon IS NOT NULL
               AND max_lon IS NOT NULL`;

    if (filters.bboxSizeMin !== undefined) {
      query += ` AND ((max_lon - min_lon) * (max_lat - min_lat)) >= ?`;
      params.push(filters.bboxSizeMin);
    }

    if (filters.bboxSizeMax !== undefined) {
      query += ` AND ((max_lon - min_lon) * (max_lat - min_lat)) <= ?`;
      params.push(filters.bboxSizeMax);
    }
  }

  // Filter by tags using SQLite JSON functions
  if (filters.tags && Object.keys(filters.tags).length > 0) {
    for (const [key, value] of Object.entries(filters.tags)) {
      query += ` AND json_extract(tags, ?) = ?`;
      params.push(`$.${key}`, value);
    }
  }

  query += ' ORDER BY created_at DESC';

  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }

  if (filters.offset) {
    query += ' OFFSET ?';
    params.push(filters.offset);
  }

  const stmt = db.prepare(query).bind(...params);
  const { results } = await stmt.all();

  // Parse tags JSON
  return results.map((row: any) => ({
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : {},
    open: Boolean(row.closed_at === null) // Assuming closed_at is null for open changesets
  }));
}

/**
 * Get a single changeset by ID with its tags
 */
export async function getChangesetById(db: D1Database, id: number): Promise<Changeset | null> {
  const changeset = await db.prepare(
    'SELECT * FROM changesets WHERE id = ?'
  ).bind(id).first<Changeset & { tags: string | null }>();

  if (!changeset) {
    return null;
  }

  // Parse JSON tags
  if (changeset.tags && typeof changeset.tags === 'string') {
    try {
      changeset.tags = JSON.parse(changeset.tags);
    } catch (e) {
      changeset.tags = {};
    }
  } else {
    changeset.tags = {};
  }

  // Convert open from integer to boolean
  changeset.open = !!(changeset.open as any);

  return changeset;
}

/**
 * Update or insert a user_id to user_name mapping
 */
export async function updateUserName(
  db: D1Database,
  userId: number,
  userName: string,
  timestamp: string
): Promise<void> {
  // Check if this mapping already exists
  const existing = await db.prepare(
    'SELECT first_seen FROM user_names WHERE user_id = ? AND user_name = ?'
  ).bind(userId, userName).first<{ first_seen: string }>();

  if (existing) {
    // Update last_seen timestamp
    await db.prepare(
      'UPDATE user_names SET last_seen = ? WHERE user_id = ? AND user_name = ?'
    ).bind(timestamp, userId, userName).run();
  } else {
    // Insert new mapping
    await db.prepare(`
      INSERT INTO user_names (user_id, user_name, first_seen, last_seen)
      VALUES (?, ?, ?, ?)
    `).bind(userId, userName, timestamp, timestamp).run();
  }
}

/**
 * Get all usernames for a user_id
 */
export async function getUserNames(db: D1Database, userId: number): Promise<Array<{
  user_name: string;
  first_seen: string;
  last_seen: string;
}>> {
  const result = await db.prepare(
    'SELECT user_name, first_seen, last_seen FROM user_names WHERE user_id = ? ORDER BY last_seen DESC'
  ).bind(userId).all<{ user_name: string; first_seen: string; last_seen: string }>();

  return result.results || [];
}

/**
 * Get user_id(s) for a username
 */
export async function getUserIdsByName(db: D1Database, userName: string): Promise<number[]> {
  const result = await db.prepare(
    'SELECT DISTINCT user_id FROM user_names WHERE user_name = ?'
  ).bind(userName).all<{ user_id: number }>();

  return result.results?.map(r => r.user_id) || [];
}
