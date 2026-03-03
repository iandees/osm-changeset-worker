-- Drop and recreate the geohash table to clear old multi-precision data.
-- Data will be rebuilt by the /api/backfill-geohashes endpoint.
DROP TABLE IF EXISTS changeset_geohashes;

CREATE TABLE changeset_geohashes (
  changeset_id INTEGER NOT NULL,
  geohash TEXT NOT NULL,
  PRIMARY KEY (changeset_id, geohash)
);

CREATE INDEX idx_changeset_geohashes_geohash ON changeset_geohashes(geohash);
