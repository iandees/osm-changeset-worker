# Contributing to osm-changeset-worker

Thank you for your interest in contributing to this project!

## Development Setup

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.dev.vars` if needed
4. Create a D1 database for local testing:
   ```bash
   wrangler d1 create osm-changesets-dev
   ```
5. Update `wrangler.toml` with your dev database ID
6. Run migrations:
   ```bash
   wrangler d1 execute osm-changesets-dev --file=./migrations/0001_initial.sql
   ```
7. Start the dev server: `npm run dev`

## Code Style

- Use TypeScript for all code
- Follow existing code formatting
- Run `npm run type-check` before committing

## Testing

- Test your changes locally with `npm run dev`
- Test cron functionality with Wrangler's local cron triggers
- Ensure API endpoints return expected data format

## Pull Requests

1. Create a feature branch from `main`
2. Make your changes with clear, descriptive commits
3. Ensure TypeScript compiles without errors
4. Update documentation if needed
5. Submit a pull request with a clear description

## Questions?

Open an issue for any questions or concerns.
