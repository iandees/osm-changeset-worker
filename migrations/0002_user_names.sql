-- Migration: Add user_names table for tracking username changes
-- Description: Track historical user_id to user_name mappings with timestamps

CREATE TABLE IF NOT EXISTS user_names (
  user_id INTEGER NOT NULL,
  user_name TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (user_id, user_name)
);

CREATE INDEX IF NOT EXISTS idx_user_names_user_id ON user_names(user_id);
CREATE INDEX IF NOT EXISTS idx_user_names_user_name ON user_names(user_name);
CREATE INDEX IF NOT EXISTS idx_user_names_last_seen ON user_names(last_seen);

