// Database operations for changesets
import type { Changeset, ReplicationState } from './types';

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
export async function storeChangesets(db: D1Database, changesets: Changeset[]): Promise<void> {
  if (changesets.length === 0) {
    return;
  }

  // Use batch operations for better performance
  const statements: D1PreparedStatement[] = [];

  // Track unique user_id/user_name pairs to update with their most recent timestamp
  const userMappings = new Map<string, { userId: number; userName: string; timestamp: string }>();

  for (const changeset of changesets) {
    // Serialize tags to JSON
    const tagsJson = changeset.tags && Object.keys(changeset.tags).length > 0
      ? JSON.stringify(changeset.tags)
      : null;

    statements.push(
      db.prepare(`
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
      )
    );

    // Track user_id/user_name mapping with changeset timestamp
    if (changeset.user_id && changeset.user_name) {
      const key = `${changeset.user_id}:${changeset.user_name}`;
      const existing = userMappings.get(key);
      // Keep the latest timestamp for each user_id/user_name pair
      if (!existing || changeset.created_at > existing.timestamp) {
        userMappings.set(key, {
          userId: changeset.user_id,
          userName: changeset.user_name,
          timestamp: changeset.created_at
        });
      }
    }
  }

  // Add user_name tracking statements
  // Using INSERT OR REPLACE to handle both new and existing mappings
  for (const { userId, userName, timestamp } of userMappings.values()) {
    statements.push(
      db.prepare(`
        INSERT INTO user_names (user_id, user_name, first_seen, last_seen)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, user_name) 
        DO UPDATE SET last_seen = CASE 
          WHEN excluded.last_seen > last_seen THEN excluded.last_seen 
          ELSE last_seen 
        END
      `).bind(userId, userName, timestamp, timestamp)
    );
  }

  // Execute all statements in a batch
  await db.batch(statements);
}

/**
 * Query changesets with filters
 */
export async function queryChangesets(
  db: D1Database,
  filters: {
    userId?: number;
    userName?: string;
    startDate?: string;
    endDate?: string;
    bbox?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
    tags?: Record<string, string>;
    limit?: number;
    offset?: number;
  }
): Promise<Changeset[]> {
  let query = `
    SELECT c.* FROM changesets c
    WHERE 1=1
  `;
  const bindings: (string | number)[] = [];

  if (filters.userId) {
    query += ' AND c.user_id = ?';
    bindings.push(filters.userId);
  }

  // Filter by username - lookup user_ids from user_names table
  if (filters.userName) {
    query += ` AND c.user_id IN (
      SELECT DISTINCT user_id FROM user_names WHERE user_name = ?
    )`;
    bindings.push(filters.userName);
  }

  if (filters.startDate) {
    query += ' AND c.created_at >= ?';
    bindings.push(filters.startDate);
  }

  if (filters.endDate) {
    query += ' AND c.created_at <= ?';
    bindings.push(filters.endDate);
  }

  if (filters.bbox) {
    query += ` AND c.min_lat IS NOT NULL 
               AND c.max_lat IS NOT NULL 
               AND c.min_lon IS NOT NULL 
               AND c.max_lon IS NOT NULL
               AND c.max_lat >= ? 
               AND c.min_lat <= ?
               AND c.max_lon >= ?
               AND c.min_lon <= ?`;
    bindings.push(
      filters.bbox.minLat,
      filters.bbox.maxLat,
      filters.bbox.minLon,
      filters.bbox.maxLon
    );
  }

  // Filter by tags using SQLite JSON functions
  if (filters.tags && Object.keys(filters.tags).length > 0) {
    for (const [key, value] of Object.entries(filters.tags)) {
      query += ` AND json_extract(c.tags, ?) = ?`;
      bindings.push(`$.${key}`, value);
    }
  }

  query += ' ORDER BY c.created_at DESC';

  if (filters.limit) {
    query += ' LIMIT ?';
    bindings.push(filters.limit);
  }

  if (filters.offset) {
    query += ' OFFSET ?';
    bindings.push(filters.offset);
  }

  const stmt = db.prepare(query);
  const result = await stmt.bind(...bindings).all<Changeset & { tags: string | null }>();

  // Parse JSON tags for each result
  return (result.results || []).map(cs => {
    const changeset = { ...cs };
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
    return changeset as Changeset;
  });
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
