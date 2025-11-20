# Understanding OSM Replication

This document explains how OpenStreetMap's changeset replication works and how this worker uses it.

## What is OSM Replication?

OpenStreetMap provides several replication feeds that allow you to track changes to the map data:

1. **Minutely** - Updates approximately every minute (what we use)
2. **Hourly** - Updates every hour
3. **Daily** - Updates once per day

## How Replication Works

### Sequence Numbers

Each replication update has a sequence number that increments with each new update:
- Current: `5123456`
- Next: `5123457`
- After that: `5123458`

### File Structure

Replication files are organized in a hierarchical directory structure:

```
https://planet.openstreetmap.org/replication/minute/
  005/123/456.osm.gz      ← Changeset data
  005/123/456.state.txt   ← Metadata about this update
```

For sequence `5123456`:
- Split into: `005` / `123` / `456`
- Padded to 9 digits with leading zeros

### State Files

Each sequence has a `.state.txt` file with metadata:

```
timestamp=2024-01-15T14\:30\:00Z
sequenceNumber=5123456
```

### Changeset Files

Each sequence has a `.osm.gz` file containing changesets in OSM XML format:

```xml
<?xml version="1.0"?>
<osm version="0.6">
  <changeset id="123456789" 
             created_at="2024-01-15T14:25:00Z"
             closed_at="2024-01-15T14:30:00Z"
             open="false"
             user="mapper_name"
             uid="123456"
             min_lat="37.7"
             max_lat="37.8"
             min_lon="-122.5"
             max_lon="-122.4"
             num_changes="50"
             comments_count="2">
    <tag k="comment" v="Fixed some roads"/>
    <tag k="created_by" v="iD 2.24.1"/>
  </changeset>
  <!-- More changesets... -->
</osm>
```

## How This Worker Uses Replication

### 1. Track Position

The worker stores the current sequence number in the database:

```sql
SELECT sequence_number FROM replication_state WHERE id = 1;
-- Returns: 5123456
```

### 2. Fetch Next Sequence

Every minute (via cron), the worker:
1. Gets the current sequence: `5123456`
2. Calculates next sequence: `5123457`
3. Checks if it exists by fetching the state file

### 3. Download and Parse

If the next sequence exists:
1. Download the `.osm.gz` file
2. Decompress the gzip data
3. Parse the XML to extract changeset data
4. Store changesets in the database

### 4. Update Position

After successful processing:
```sql
UPDATE replication_state 
SET sequence_number = 5123457,
    timestamp = '2024-01-15T14:31:00Z'
WHERE id = 1;
```

### 5. Repeat

The cron runs again in 60 seconds and processes sequence `5123458`.

## Handling Edge Cases

### Sequence Not Ready

If the next sequence isn't available yet:
- Worker logs: "Sequence X not yet available"
- Keeps current position
- Tries again next minute

### Empty Changesets

Some sequences contain no changesets:
- This is normal (no activity in that minute)
- Worker updates sequence number anyway
- Continues to next sequence

### Network Errors

If download fails:
- Retry logic attempts 2 more times with backoff
- If all retries fail, keeps current position
- Tries again next minute

### Catching Up

If the worker is behind:
- It processes one sequence per minute
- Takes time to catch up if starting from scratch
- Consider starting from recent sequence (see `src/index.ts`)

## Starting Position

When first deployed, the worker:
1. Checks if `replication_state` has a sequence
2. If not, fetches the current latest sequence from OSM
3. Starts from 100 sequences before latest (configurable)
4. This avoids processing millions of old changesets

You can modify this in `src/index.ts`:

```typescript
// Start from recent sequence (default: 100 before latest)
const startSeq = Math.max(0, latestSeq - 100);

// Or start from latest:
const startSeq = latestSeq;

// Or start from specific sequence:
const startSeq = 5123000;
```

## Replication URLs

Production URLs used by this worker:
- Base: `https://planet.openstreetmap.org/replication/minute`
- State: `https://planet.openstreetmap.org/replication/minute/state.txt`
- Sequence: `https://planet.openstreetmap.org/replication/minute/005/123/456.osm.gz`

Test/dev servers (if available):
- Dev API: `https://api06.dev.openstreetmap.org/`

## Replication Statistics

From OSM Planet:
- **Minutely updates**: ~1,440 per day
- **Average changesets per update**: Varies widely (0-1000+)
- **Peak times**: Weekdays, especially during mapping parties
- **Quiet times**: Late night UTC, weekends

## Monitoring Replication

Check if the worker is keeping up:

```bash
# Get current worker sequence
curl https://your-worker.workers.dev/api/stats

# Compare to OSM's latest
curl https://planet.openstreetmap.org/replication/minute/state.txt

# If difference is growing, worker is falling behind
```

## Best Practices

1. **Don't skip sequences** - Process them in order
2. **Handle gaps gracefully** - Some sequences may be missing
3. **Respect rate limits** - OSM is generous, but don't abuse
4. **Store sequence atomically** - Update only after successful processing
5. **Log progress** - Makes debugging easier

## Further Reading

- [OSM Wiki: Planet.osm](https://wiki.openstreetmap.org/wiki/Planet.osm)
- [OSM Wiki: Replication](https://wiki.openstreetmap.org/wiki/Planet.osm/diffs)
- [Minutely Replication](https://planet.openstreetmap.org/replication/minute/)

## Alternatives

Other ways to track OSM changesets:
- **OSM API**: Query specific changesets (rate limited)
- **Overpass API**: Query by geographic area or tags
- **Osmosis**: Command-line tool for processing OSM data
- **OSMCha**: Web service for changeset monitoring (what we replicate)

This worker combines the reliability of replication feeds with the convenience of a queryable API.
