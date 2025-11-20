# Quick Start Guide

Get the OSM Changeset Worker up and running in 5 minutes!

## Prerequisites

- Cloudflare account (free tier works!)
- Node.js 18+ installed
- 5 minutes of your time ⏱️

## Installation Steps

### 1. Install Wrangler

```bash
npm install -g wrangler
wrangler login
```

### 2. Clone and Setup

```bash
git clone https://github.com/iandees/osm-changeset-worker.git
cd osm-changeset-worker
npm install
```

### 3. Create Database

```bash
wrangler d1 create osm-changesets
```

Copy the `database_id` from the output and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "osm-changesets"
database_id = "paste-your-database-id-here"  # ← Edit this line
```

### 4. Initialize Database

```bash
wrangler d1 execute osm-changesets --file=./migrations/0001_initial.sql
```

### 5. Deploy!

```bash
npm run deploy
```

✅ Done! Your worker is now live at `https://osm-changeset-worker.YOUR-SUBDOMAIN.workers.dev`

## Test It Out

```bash
# Get stats (will be empty at first)
curl https://osm-changeset-worker.YOUR-SUBDOMAIN.workers.dev/api/stats

# Wait a minute for the cron to run, then check again
curl https://osm-changeset-worker.YOUR-SUBDOMAIN.workers.dev/api/changesets?limit=5
```

## What's Happening?

1. **Every minute**, the cron job runs and fetches new OSM changesets
2. **Changesets are stored** in your D1 database
3. **API endpoints** let you query the data

## Next Steps

- Read [README.md](README.md) for full API documentation
- Check [DEPLOYMENT.md](DEPLOYMENT.md) for advanced configuration
- See [examples/API_EXAMPLES.md](examples/API_EXAMPLES.md) for query examples

## Troubleshooting

**No changesets appearing?**
- Check logs: `wrangler tail`
- Verify cron is running (only works in production, not dev mode)
- Wait a few minutes - it takes time to sync

**Database errors?**
- Verify the database_id in wrangler.toml
- Ensure migrations ran successfully
- Check: `wrangler d1 list`

**Need help?**
- Open an issue on GitHub
- Check the full documentation in README.md

## Cost

With Cloudflare's free tier:
- ✅ 100,000 requests/day
- ✅ Unlimited cron executions
- ✅ 5 GB database storage

Perfect for personal use or small projects!

---

**Enjoy tracking OSM changesets! 🗺️**
