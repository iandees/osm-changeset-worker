# Database Schema Documentation

This document describes the D1 database schema used by the OSM Changeset Worker.

## Tables

### `changesets`

Stores the core changeset information from OpenStreetMap.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key. The OSM changeset ID. |
| `created_at` | TEXT | ISO 8601 timestamp when the changeset was created. |
| `closed_at` | TEXT | ISO 8601 timestamp when the changeset was closed. NULL if still open. |
| `open` | INTEGER | 1 if changeset is open, 0 if closed. |
| `user_id` | INTEGER | OSM user ID who created the changeset. NULL if user deleted. |
| `user_name` | TEXT | OSM username who created the changeset. NULL if user deleted. |
| `min_lat` | REAL | Minimum latitude of the changeset bounding box. |
| `max_lat` | REAL | Maximum latitude of the changeset bounding box. |
| `min_lon` | REAL | Minimum longitude of the changeset bounding box. |
| `max_lon` | REAL | Maximum longitude of the changeset bounding box. |
| `num_changes` | INTEGER | Number of changes (creates, modifies, deletes) in the changeset. |
| `comments_count` | INTEGER | Number of discussion comments on the changeset. |

**Indexes:**
- `idx_changesets_created_at` - For date range queries
- `idx_changesets_user_id` - For user-specific queries
- `idx_changesets_closed_at` - For filtering by closure date

### `changeset_tags`

Stores key-value tags associated with changesets.

| Column | Type | Description |
|--------|------|-------------|
| `changeset_id` | INTEGER | Foreign key to `changesets.id`. |
| `key` | TEXT | Tag key (e.g., "comment", "created_by", "imagery_used"). |
| `value` | TEXT | Tag value. |

**Primary Key:** (`changeset_id`, `key`)

**Indexes:**
- `idx_changeset_tags_key` - For searching by tag key
- `idx_changeset_tags_value` - For searching by tag value

**Foreign Key:** `changeset_id` references `changesets(id)` with CASCADE delete

### `replication_state`

Tracks the current position in the OSM replication feed.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Always 1 (single row table). |
| `sequence_number` | INTEGER | Current OSM replication sequence number. |
| `timestamp` | TEXT | ISO 8601 timestamp of last successful update. |

## Common Tag Keys

Changesets commonly include these tags:

| Tag Key | Description | Example Value |
|---------|-------------|---------------|
| `comment` | Changeset comment describing what was changed | "Fixed road names in downtown" |
| `created_by` | Editor used to make the changes | "iD 2.24.1", "JOSM/1.5" |
| `imagery_used` | Aerial imagery used as reference | "Bing", "Mapbox Satellite" |
| `source` | Data source for the changes | "survey", "local knowledge" |
| `hashtags` | Project hashtags | "#hotosm-project-12345" |
| `locale` | Editor locale/language | "en-US" |
| `host` | Host URL of the editor | "https://www.openstreetmap.org/edit" |

## Query Examples

### Get changesets with specific tag

```sql
SELECT c.* 
FROM changesets c
JOIN changeset_tags ct ON c.id = ct.changeset_id
WHERE ct.key = 'created_by' AND ct.value LIKE 'iD%'
LIMIT 10;
```

### Get changesets by user in date range

```sql
SELECT * FROM changesets
WHERE user_id = 123456
  AND created_at >= '2024-01-01T00:00:00Z'
  AND created_at <= '2024-01-31T23:59:59Z'
ORDER BY created_at DESC;
```

### Get changesets in bounding box

```sql
SELECT * FROM changesets
WHERE min_lat IS NOT NULL
  AND max_lat >= 37.7
  AND min_lat <= 37.8
  AND max_lon >= -122.5
  AND min_lon <= -122.4
ORDER BY created_at DESC
LIMIT 50;
```

### Get most active users

```sql
SELECT user_name, COUNT(*) as changeset_count
FROM changesets
WHERE user_id IS NOT NULL
GROUP BY user_id, user_name
ORDER BY changeset_count DESC
LIMIT 20;
```

### Get changesets with specific hashtag

```sql
SELECT c.* 
FROM changesets c
JOIN changeset_tags ct ON c.id = ct.changeset_id
WHERE ct.key = 'hashtags' AND ct.value LIKE '%hotosm%'
ORDER BY c.created_at DESC;
```

## Data Types

### Timestamps

All timestamps are stored in ISO 8601 format:
- Format: `YYYY-MM-DDTHH:MM:SSZ`
- Example: `2024-01-15T14:30:45Z`
- Timezone: Always UTC (Z suffix)

### Coordinates

Coordinates use standard decimal degrees:
- Latitude: -90 to 90 (negative = South, positive = North)
- Longitude: -180 to 180 (negative = West, positive = East)
- Precision: Stored as REAL (floating point)

### Boolean Values

SQLite doesn't have native boolean type:
- Stored as INTEGER
- 0 = false
- 1 = true

## Maintenance

### Database Size Estimation

Approximate storage per changeset:
- Changeset record: ~100 bytes
- Tags (average 5 tags): ~200 bytes
- Total per changeset: ~300 bytes

For 1 million changesets: ~300 MB

### Performance Considerations

1. **Indexes are crucial** for query performance on large datasets
2. **Batch operations** are used for insertions to improve performance
3. **Foreign key constraints** maintain referential integrity
4. **Pagination** is recommended for large result sets

### Cleanup Operations

To remove old changesets:

```sql
-- Delete changesets older than 90 days
DELETE FROM changesets 
WHERE created_at < datetime('now', '-90 days');

-- Orphaned tags are automatically deleted via CASCADE
```

## Migration History

### 0001_initial.sql

Initial schema creation:
- Creates `changesets` table with indexes
- Creates `changeset_tags` table with indexes
- Creates `replication_state` table
- Initializes replication state with sequence 0

## Schema Version

Current version: 1.0.0
Last updated: 2024-01-01
