// Type definitions for OSM changeset data structures

export interface Env {
  DB: D1Database;
}

export interface Changeset {
  id: number;
  created_at: string;
  closed_at?: string;
  open: boolean;
  user_id?: number;
  user_name?: string;
  min_lat?: number;
  max_lat?: number;
  min_lon?: number;
  max_lon?: number;
  num_changes?: number;
  comments_count?: number;
  tags?: Record<string, string>;
}

export interface ChangesetTag {
  changeset_id: number;
  key: string;
  value: string;
}

export interface ReplicationState {
  id: number;
  sequence_number: number;
  timestamp: string;
}

export interface OsmApiChangeset {
  id: string;
  created_at: string;
  closed_at?: string;
  open: string;
  user?: string;
  uid?: string;
  min_lat?: string;
  max_lat?: string;
  min_lon?: string;
  max_lon?: string;
  num_changes?: string;
  comments_count?: string;
  tag?: Array<{ k: string; v: string }> | { k: string; v: string };
}
