# osm-changeset-worker

A Cloudflare Worker that tracks OpenStreetMap changesets in real-time. It fetches changeset data from the OSM replication feed every minute and stores it in a Cloudflare D1 database, with a Hono-based API for querying the data (similar to OSMCha).

## Features

- **Automated Changeset Tracking**: Runs every minute via Cloudflare cron to fetch new changesets
- **D1 Database Storage**: Stores all changeset metadata including:
  - Changeset ID, creation/closure timestamps
  - User information (ID and name)
  - Bounding box coordinates
  - Number of changes and comments
  - All changeset tags
- **RESTful API**: Query changesets with various filters
- **Web Interface**:
  - Interactive map visualization using MapLibre GL
  - **Augmented Diff (Adiff)** visualization to see exactly what changed (geometry and tags)
  - Real-time filtering by user, tags, bounding box, and size
  - Keyboard shortcuts for rapid review (`j`/`k` navigation, `r` read status)
  - Read/Unread status tracking (local storage)
  - RSS feed generation for custom filters
- **OSMCha-Compatible**: API format similar to OSMCha for easy integration

## Setup

### Prerequisites

- Node.js 18+ and npm
- Cloudflare account with Workers and D1 access
- Wrangler CLI installed globally or via npm

### Installation

1. Clone the repository:
```bash
git clone https://github.com/iandees/osm-changeset-worker.git
cd osm-changeset-worker
```

2. Install dependencies:
```bash
npm install
```

3. Create a D1 database:
```bash
wrangler d1 create osm-changesets
```

4. Update `wrangler.toml` with your database ID:
```toml
[[d1_databases]]
binding = "DB"
database_name = "osm-changesets"
database_id = "your-database-id-here"
```

5. Run the initial migration:
```bash
wrangler d1 execute osm-changesets --file=./migrations/0001_initial.sql
```

### Development

Run the worker locally:
```bash
npm run dev
```

### Deployment

Deploy to Cloudflare:
```bash
npm run deploy
```

## API Endpoints

### GET /api/changesets

List changesets with optional filters.

**Query Parameters:**
- `user_name` - Filter by OSM username
- `user_id` - Filter by OSM user ID
- `start_date` - Filter by start date (ISO 8601 format)
- `end_date` - Filter by end date (ISO 8601 format)
- `bbox` - Bounding box filter (format: `min_lon,min_lat,max_lon,max_lat`)
- `bbox_size_min` - Minimum bounding box area (square degrees)
- `bbox_size_max` - Maximum bounding box area (square degrees)
- `tags` - Filter by tags (e.g., `key=value`, `key!=value`, `key~value`). Can be specified multiple times.
- `limit` - Maximum number of results (default: 100)
- `offset` - Offset for pagination (default: 0)

**Example:**
```bash
curl "https://your-worker.workers.dev/api/changesets?user_name=mapper&limit=10"
```

**Response:**
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": 123456789,
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[...]]]
      },
      "properties": {
        "id": 123456789,
        "created_at": "2024-01-01T12:00:00Z",
        "closed_at": "2024-01-01T12:30:00Z",
        "open": false,
        "user": "mapper",
        "uid": 123456,
        "bbox": [-122.5, 37.7, -122.4, 37.8],
        "num_changes": 50,
        "comments_count": 2,
        "tags": {
          "comment": "Fixed roads",
          "created_by": "iD 2.0"
        }
      }
    }
  ]
}
```

### GET /api/changesets/:id

Get a single changeset by ID.

**Example:**
```bash
curl "https://your-worker.workers.dev/api/changesets/123456789"
```

### GET /api/changesets/:id/adiff

Get the augmented diff (Adiff) for a changeset in GeoJSON format, showing created, modified, and deleted elements.

**Example:**
```bash
curl "https://your-worker.workers.dev/api/changesets/123456789/adiff"
```

### GET /api/stats

Get database statistics.

**Example:**
```bash
curl "https://your-worker.workers.dev/api/stats"
```

**Response:**
```json
{
  "total_changesets": 150000,
  "total_users": 5000,
  "replication_state": {
    "sequence_number": 5123456,
    "timestamp": "2024-01-01T12:00:00Z"
  }
}
```

## Database Schema

### changesets table
- `id` (INTEGER PRIMARY KEY) - Changeset ID
- `created_at` (TEXT) - Creation timestamp
- `closed_at` (TEXT) - Closure timestamp
- `open` (INTEGER) - Whether changeset is still open
- `user_id` (INTEGER) - OSM user ID
- `user_name` (TEXT) - OSM username
- `min_lat`, `max_lat`, `min_lon`, `max_lon` (REAL) - Bounding box
- `num_changes` (INTEGER) - Number of changes in changeset
- `comments_count` (INTEGER) - Number of comments

### changeset_tags table
- `changeset_id` (INTEGER) - Foreign key to changesets
- `key` (TEXT) - Tag key
- `value` (TEXT) - Tag value

### replication_state table
- `id` (INTEGER PRIMARY KEY) - Always 1
- `sequence_number` (INTEGER) - Current replication sequence
- `timestamp` (TEXT) - Last update timestamp

## How It Works

1. **Cron Trigger**: Every minute, the worker's scheduled handler runs
2. **Fetch State**: Retrieves current replication sequence from database
3. **Check for Updates**: Queries OSM for the next replication sequence
4. **Download Data**: Fetches and decompresses the changeset XML file
5. **Parse XML**: Extracts changeset data and tags
6. **Store Data**: Saves changesets and tags to D1 database
7. **Update State**: Updates replication sequence for next run

## License

See LICENSE file for details.
