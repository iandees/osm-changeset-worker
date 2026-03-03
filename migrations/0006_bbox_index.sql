-- Add index on bounding box columns to speed up spatial filtering
CREATE INDEX IF NOT EXISTS idx_changesets_bbox ON changesets(min_lat, max_lat, min_lon, max_lon);
