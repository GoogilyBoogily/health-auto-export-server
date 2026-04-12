# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
bun install          # Install dependencies
bun dev              # Start dev server with hot reload
bun start            # Production server

# Code quality
bun lint             # Check for lint violations
bun lint:fix         # Auto-fix lint issues
bun format           # Format with prettier

# Docker
docker compose up -d              # Start containerized
docker compose logs -f hae-server # View logs
docker compose down               # Stop
```

No test suite exists. There is no `bun test` or equivalent.

## Architecture

**Health Auto Export Server** - A write-only, file-based health data ingestion server for Apple Health data exported via the Health Auto Export iOS app.

**Tech Stack:** Bun runtime, Express.js 5.x, TypeScript 5.7 (strict), Zod 4.x validation

### Request Flow

```
POST /api/data
  → cors → json parser (50mb) → rateLimit → requestTimeout → requestLogger
  → requireWriteAuth (timing-safe token comparison)
  → ingestData controller
    → Zod validation (IngestDataSchema)
    → Phase 1: Promise.allSettled(prepareMetrics, prepareWorkouts)  # Parallel mapping
    → Phase 2: obsidianStorage.saveDailyData()  # Single unified write per date
    → Response: 200 (success), 207 (partial), 500 (failure)
```

### Data Processing Pipeline

Each preparation step (`metrics.ts`, `workouts.ts`) maps raw API data to internal types:

```
Raw API data
  → Mappers (transform + validation tracking)
  → Write to Obsidian (with retry and file locking)
```

Deduplication is handled by the Obsidian formatters during merge — health metrics deduplicate by timestamp, workouts by `appleWorkoutId`, sleep overwrites entirely.

### Key Directories

- `src/controllers/` - `ingester.ts` orchestrates; `metrics.ts` and `workouts.ts` handle preparation (mapping)
- `src/mappers/` - Transform raw API data into typed objects; `metricMapper.ts` tracks validation stats per-request via `MappingContext`
- `src/storage/obsidian/` - Obsidian vault integration (Markdown with YAML frontmatter)
- `src/storage/obsidian/formatters/` - Separate formatters for health, sleep, and workout frontmatter
- `src/types/` - Centralized TypeScript types with barrel export (`index.ts`)
- `src/validation/` - Zod schemas for request validation
- `src/middleware/` - Auth, rate limiting, request timeout, request logging

### Obsidian Storage

All data merges into a single daily file using Johnny Decimal numbering (configurable in `config.ts`):

- Daily tracking → `72 Daily Tracking/YYYY/MM/YYYY-MM-DD.md`

Each file has YAML frontmatter with health metrics, sleep stages, and workout entries. The file may also contain non-health data (moods, habits, weather) from other apps — the server preserves these during writes.

### Storage Internals

- **Atomic writes:** Temp file + rename prevents corruption
- **File locking:** `filePath.lock` with 30s stale detection (`fileHelpers.ts:withLock`)
- **Deduplication:** Health metrics by timestamp upsert, workouts by `appleWorkoutId` upsert
- **Lazy initialization:** ObsidianStorage initialized after env validation in `app.ts`

### Logger

`src/utils/logger.ts` - Dual-mode logging (pretty in dev, JSON in prod). Request-scoped logger with `startTimer()` for operation timing.

## Configuration

All configurable values are centralized in `src/config.ts` with JSDoc annotations. Values marked `@env` can be overridden via environment variables. Edit `config.ts` directly for non-env-configurable values.

## Code Style

ESLint flat config (`eslint.config.mjs`) with strict TypeScript checking and plugins: typescript-eslint, unicorn, sonarjs, perfectionist, regexp, promise, node.

Key rules:

- No `any` types allowed
- Underscore-prefixed unused parameters allowed (`argsIgnorePattern: '^_'`)
- Perfectionist handles import/object/type sorting (natural order, partitioned by comment/newline)
- Express abbreviations allowed: `req`, `res`, `err`, `env`, `acc`
- Filenames: camelCase or PascalCase

## Environment Variables

```bash
# Required
API_TOKEN            # API auth token (must start with "sk-")
OBSIDIAN_VAULT_PATH  # Path to Obsidian vault for Markdown output

# Optional - Docker
PUID                 # Host user ID for volume permissions (default: 1000)
PGID                 # Host group ID for volume permissions (default: 1000)

# Optional - Server
NODE_ENV             # development|production (default: development)
PORT                 # Server port (default: 3001)
LOG_LEVEL            # debug|info|warn|error (default: debug)
DEBUG_LOGGING        # true|false - Enable verbose debug logging (default: false)

# Optional - Metrics
SLEEP_SESSION_GAP_MINUTES  # Gap threshold for sleep sessions in minutes (default: 30)

# Optional - Obsidian paths (relative to OBSIDIAN_VAULT_PATH)
OBSIDIAN_DAILY_PATH    # Daily tracking folder (default: 70-79 Journals & Self-Tracking/72 Daily Tracking)

# Optional - Obsidian body template (use \n for newlines in env vars)
OBSIDIAN_DAILY_TEMPLATE    # Daily file body template (default: ## Habit Log\n\n## Mood Log\n\n## Bullet Journal\n\n## Workout Log\n\n## Sleep Log\n\n# {{date}}\n\n## Health Metrics)
```

Run `./create-env.sh` to generate a `.env` with a secure token.

### Debug Logging

Enable with `DEBUG_LOGGING=true bun dev`. Categories: `AUTH`, `REQUEST`, `RESPONSE`, `RETRY`, `VALIDATION`, `TRANSFORM`, `STORAGE`, `DATA_VALIDATION`.
