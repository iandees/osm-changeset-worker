CREATE TABLE changeset_tags (
  changeset_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (changeset_id, key)
);
CREATE INDEX idx_changeset_tags_key_value ON changeset_tags(key, value);
