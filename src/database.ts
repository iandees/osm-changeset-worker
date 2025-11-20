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
  // Insert or replace changeset
  await db.prepare(`
    INSERT OR REPLACE INTO changesets (
      id, created_at, closed_at, open, user_id, user_name,
      min_lat, max_lat, min_lon, max_lon, num_changes, comments_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    changeset.comments_count || 0
  ).run();
  
  // Store tags if present
  if (changeset.tags && Object.keys(changeset.tags).length > 0) {
    // Delete existing tags for this changeset
    await db.prepare('DELETE FROM changeset_tags WHERE changeset_id = ?')
      .bind(changeset.id)
      .run();
    
    // Insert new tags
    for (const [key, value] of Object.entries(changeset.tags)) {
      await db.prepare(`
        INSERT INTO changeset_tags (changeset_id, key, value)
        VALUES (?, ?, ?)
      `).bind(changeset.id, key, value).run();
    }
  }
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
  
  for (const changeset of changesets) {
    statements.push(
      db.prepare(`
        INSERT OR REPLACE INTO changesets (
          id, created_at, closed_at, open, user_id, user_name,
          min_lat, max_lat, min_lon, max_lon, num_changes, comments_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        changeset.comments_count || 0
      )
    );
    
    // Add tag deletion and insertion statements
    if (changeset.tags && Object.keys(changeset.tags).length > 0) {
      statements.push(
        db.prepare('DELETE FROM changeset_tags WHERE changeset_id = ?')
          .bind(changeset.id)
      );
      
      for (const [key, value] of Object.entries(changeset.tags)) {
        statements.push(
          db.prepare(`
            INSERT INTO changeset_tags (changeset_id, key, value)
            VALUES (?, ?, ?)
          `).bind(changeset.id, key, value)
        );
      }
    }
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
    startDate?: string;
    endDate?: string;
    bbox?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
    limit?: number;
    offset?: number;
  }
): Promise<Changeset[]> {
  let query = `
    SELECT DISTINCT c.* FROM changesets c
    WHERE 1=1
  `;
  const bindings: (string | number)[] = [];
  
  if (filters.userId) {
    query += ' AND c.user_id = ?';
    bindings.push(filters.userId);
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
  const result = await stmt.bind(...bindings).all<Changeset>();
  
  return result.results || [];
}

/**
 * Get a single changeset by ID with its tags
 */
export async function getChangesetById(db: D1Database, id: number): Promise<Changeset | null> {
  const changeset = await db.prepare(
    'SELECT * FROM changesets WHERE id = ?'
  ).bind(id).first<Changeset>();
  
  if (!changeset) {
    return null;
  }
  
  // Fetch tags
  const tags = await db.prepare(
    'SELECT key, value FROM changeset_tags WHERE changeset_id = ?'
  ).bind(id).all<{ key: string; value: string }>();
  
  if (tags.results && tags.results.length > 0) {
    changeset.tags = {};
    tags.results.forEach(tag => {
      changeset.tags![tag.key] = tag.value;
    });
  }
  
  // Convert open from integer to boolean
  changeset.open = !!(changeset.open as any);
  
  return changeset;
}
