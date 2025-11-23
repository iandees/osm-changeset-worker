CREATE TABLE IF NOT EXISTS changeset_geohashes (
  changeset_id INTEGER NOT NULL,
  geohash TEXT NOT NULL,
  PRIMARY KEY (changeset_id, geohash)
);

CREATE INDEX IF NOT EXISTS idx_changeset_geohashes_geohash ON changeset_geohashes(geohash);

-- Note: Backfilling geohashes for existing changesets requires complex calculation logic
-- that is not feasible to implement in standard SQLite SQL.
-- This data should be backfilled using a script that utilizes the application's geohash logic.
