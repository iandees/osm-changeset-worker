-- Migration: Store tags as JSON blob with optional index table for filtering
-- Description: Convert changeset_tags to a JSON column on changesets table,
--              with an optional lightweight index table for tag filtering

-- Add tags column to changesets table
ALTER TABLE changesets ADD COLUMN tags TEXT;

-- Create a lightweight index table for tag filtering (optional - only populate for tags you want to filter on)
-- CREATE TABLE IF NOT EXISTS changeset_tag_index (
--   changeset_id INTEGER NOT NULL,
--   key TEXT NOT NULL,
--   value TEXT NOT NULL,
--   PRIMARY KEY (changeset_id, key),
--   FOREIGN KEY (changeset_id) REFERENCES changesets(id) ON DELETE CASCADE
-- );

-- CREATE INDEX IF NOT EXISTS idx_changeset_tag_index_key_value ON changeset_tag_index(key, value);

-- Migrate existing data from changeset_tags to JSON format
UPDATE changesets
SET tags = (
  SELECT json_group_object(key, value)
  FROM changeset_tags
  WHERE changeset_tags.changeset_id = changesets.id
)
WHERE EXISTS (
  SELECT 1 FROM changeset_tags WHERE changeset_tags.changeset_id = changesets.id
);

-- Optionally populate tag index with commonly filtered tags (e.g., comment, created_by, host)
-- Uncomment and customize based on which tags you want to filter on:
-- INSERT INTO changeset_tag_index (changeset_id, key, value)
-- SELECT changeset_id, key, value
-- FROM changeset_tags
-- WHERE key IN ('comment', 'created_by', 'host', 'imagery_used', 'source');

-- Drop the old changeset_tags table and its indexes
DROP INDEX IF EXISTS idx_changeset_tags_key;
DROP INDEX IF EXISTS idx_changeset_tags_value;
DROP TABLE IF EXISTS changeset_tags;
