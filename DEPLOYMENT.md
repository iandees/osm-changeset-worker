# Deployment Guide

This guide walks you through deploying the OSM Changeset Worker to Cloudflare.

## Prerequisites

1. A Cloudflare account with Workers and D1 enabled
2. Wrangler CLI installed: `npm install -g wrangler`
3. Authenticated with Wrangler: `wrangler login`

## Step-by-Step Deployment

### 1. Clone and Install

```bash
git clone https://github.com/iandees/osm-changeset-worker.git
cd osm-changeset-worker
npm install
```

### 2. Create D1 Database

```bash
wrangler d1 create osm-changesets
```

This will output something like:
```
✅ Successfully created DB 'osm-changesets'!

[[d1_databases]]
binding = "DB"
database_name = "osm-changesets"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 3. Update wrangler.toml

Copy the `database_id` from the previous step and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "osm-changesets"
database_id = "your-actual-database-id-here"  # Replace this
```

### 4. Run Database Migration

```bash
wrangler d1 execute osm-changesets --file=./migrations/0001_initial.sql
```

You should see:
```
🌀 Mapping SQL input into an array of statements
🌀 Parsing 5 statements
🌀 Executing on osm-changesets (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx):
🚣 Executed 5 commands in 0.XXXXms
```

### 5. Test Locally (Optional)

```bash
npm run dev
```

Visit `http://localhost:8787` to test the API locally.

### 6. Deploy to Cloudflare

```bash
npm run deploy
```

You should see:
```
Total Upload: XX.XX KiB / gzip: XX.XX KiB
Uploaded osm-changeset-worker (X.XX sec)
Published osm-changeset-worker (X.XX sec)
  https://osm-changeset-worker.your-subdomain.workers.dev
Current Deployment ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### 7. Verify Deployment

Test the deployed worker:

```bash
# Check root endpoint
curl https://osm-changeset-worker.your-subdomain.workers.dev/

# Check stats (should show empty database initially)
curl https://osm-changeset-worker.your-subdomain.workers.dev/api/stats
```

### 8. Monitor Cron Execution

The cron job will run automatically every minute. To check logs:

```bash
wrangler tail
```

You should see logs like:
```
Starting scheduled changeset update
Current sequence: 0
Fetching changesets for sequence 1
Found X changesets
Stored X changesets
Updated replication state to sequence 1
```

## Troubleshooting

### Database Connection Issues

If you see database connection errors:
- Verify the `database_id` in `wrangler.toml` matches your D1 database
- Ensure migrations were run successfully
- Check database exists: `wrangler d1 list`

### Cron Not Running

- Verify cron trigger in `wrangler.toml`: `crons = ["* * * * *"]`
- Check worker logs: `wrangler tail`
- Cron jobs only run in production, not in local dev mode

### Rate Limiting from OSM

If you see many 429 errors:
- The retry logic should handle temporary issues
- OSM rate limits are generous for replication feeds
- Consider reporting the issue if persistent

### No Changesets Appearing

- Check the replication state: `curl https://your-worker.workers.dev/api/stats`
- Verify the sequence number is incrementing
- Check worker logs for errors
- Ensure internet access from Cloudflare Workers is working

## Custom Domain (Optional)

To use a custom domain:

1. Add route in `wrangler.toml`:
```toml
routes = [
  { pattern = "osm.example.com/*", zone_name = "example.com" }
]
```

2. Deploy again:
```bash
npm run deploy
```

## Monitoring

Monitor your worker in the Cloudflare Dashboard:
1. Go to Workers & Pages
2. Select `osm-changeset-worker`
3. View metrics, logs, and settings

## Updating

To update the worker:

1. Pull latest changes:
```bash
git pull origin main
```

2. Install dependencies:
```bash
npm install
```

3. Deploy:
```bash
npm run deploy
```

## Database Maintenance

### Backup Database

```bash
wrangler d1 export osm-changesets --output=backup.sql
```

### Check Database Size

```bash
wrangler d1 execute osm-changesets --command="SELECT 
  (SELECT COUNT(*) FROM changesets) as changesets,
  (SELECT COUNT(*) FROM changeset_tags) as tags"
```

### Clear Old Data (if needed)

To keep only recent changesets:

```bash
wrangler d1 execute osm-changesets --command="
DELETE FROM changesets 
WHERE created_at < datetime('now', '-30 days')"
```

## Cost Estimates

With Cloudflare's free tier:
- Workers: 100,000 requests/day (sufficient for API usage)
- Cron: 1 execution per minute = ~43,800/month (within free tier)
- D1: 5 GB storage + 5M read/write per day (generous for this use case)

The worker should stay within free tier limits for moderate usage.

## Support

For issues or questions:
- Check GitHub Issues: https://github.com/iandees/osm-changeset-worker/issues
- Review Cloudflare Workers docs: https://developers.cloudflare.com/workers/
- Review D1 docs: https://developers.cloudflare.com/d1/
