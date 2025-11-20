-- Migration: Initial schema for OSM changesets
-- Description: Create tables for storing OSM changeset data

CREATE TABLE IF NOT EXISTS changesets (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  open INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER,
  user_name TEXT,
  min_lat REAL,
  max_lat REAL,
  min_lon REAL,
  max_lon REAL,
  num_changes INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_changesets_created_at ON changesets(created_at);
CREATE INDEX IF NOT EXISTS idx_changesets_user_id ON changesets(user_id);
CREATE INDEX IF NOT EXISTS idx_changesets_closed_at ON changesets(closed_at);

CREATE TABLE IF NOT EXISTS changeset_tags (
  changeset_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (changeset_id, key),
  FOREIGN KEY (changeset_id) REFERENCES changesets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_changeset_tags_key ON changeset_tags(key);
CREATE INDEX IF NOT EXISTS idx_changeset_tags_value ON changeset_tags(value);

-- Table for tracking replication state
CREATE TABLE IF NOT EXISTS replication_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sequence_number INTEGER NOT NULL DEFAULT 0,
  timestamp TEXT NOT NULL
);

-- Initialize replication state
INSERT OR IGNORE INTO replication_state (id, sequence_number, timestamp) 
VALUES (1, 0, datetime('now'));
