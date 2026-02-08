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
    → Promise.allSettled(saveMetrics, saveWorkouts)  # Fault-tolerant
    → Response: 200 (success), 207 (partial), 500 (failure)
```

### Data Processing Pipeline

Each controller (`metrics.ts`, `workouts.ts`) follows the same pattern:

```
Raw API data
  → Mappers (transform + validation tracking)
  → Deduplication (read Obsidian frontmatter → compare timestamps/IDs → filter)
  → Write to Obsidian (with retry)
```

**Single source of truth:** Obsidian is the only data store. Deduplication reads existing frontmatter to compare against incoming data (metrics by timestamp, workouts by `appleWorkoutId`). The Obsidian formatters also upsert by these same keys, so dedup is an optimization — even if a duplicate passes through, the write is idempotent.

### Key Directories

- `src/controllers/` - `ingester.ts` orchestrates; `metrics.ts` and `workouts.ts` run the pipeline above
- `src/mappers/` - Transform raw API data into typed objects; `metricMapper.ts` tracks validation stats per-request via `MappingContext`
- `src/storage/` - Obsidian storage with file locking and atomic writes
- `src/storage/obsidian/` - Obsidian vault integration (Markdown with YAML frontmatter)
- `src/storage/obsidian/formatters/` - Separate formatters for health, sleep, and workout frontmatter
- `src/types/` - Centralized TypeScript types with barrel export (`index.ts`)
- `src/validation/` - Zod schemas for request validation
- `src/middleware/` - Auth, rate limiting, request timeout, request logging

### Storage System

**ObsidianStorage (Markdown)** - Single source of truth for all health data

Default paths use Johnny Decimal numbering (configurable in `config.ts`):

- Health metrics → `79 Health Tracking/YYYY/MM/YYYY-MM-DD.md`
- Sleep data → `78 Sleep Tracking/YYYY/MM/YYYY-MM-DD.md`
- Workouts → `77 Workout Tracking/YYYY/MM/YYYY-MM-DD.md`

Each Markdown file has YAML frontmatter for Obsidian Dataview queries.

### Storage Internals

- **Atomic writes:** Temp file + rename prevents corruption
- **File locking:** `filePath.lock` with 30s stale detection (`fileHelpers.ts:withLock`)
- **Deduplication:** Metrics by timestamp per metric type, workouts by `appleWorkoutId` — reads existing Obsidian frontmatter
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
OBSIDIAN_HEALTH_PATH   # Health tracking folder (default: 70-79 Journals & Self-Tracking/79 Health Tracking)
OBSIDIAN_SLEEP_PATH    # Sleep tracking folder (default: 70-79 Journals & Self-Tracking/78 Sleep Tracking)
OBSIDIAN_WORKOUT_PATH  # Workout tracking folder (default: 70-79 Journals & Self-Tracking/77 Workout Tracking)

# Optional - Obsidian body templates (use \n for newlines in env vars)
OBSIDIAN_HEALTH_TEMPLATE   # Health file body template (default: # {{date}}\n\n## Health Metrics)
OBSIDIAN_SLEEP_TEMPLATE    # Sleep file body template (default: \n## Sleep Log)
OBSIDIAN_WORKOUT_TEMPLATE  # Workout file body template (default: \n\n## Workout Log)
```

Run `./create-env.sh` to generate a `.env` with a secure token.

### Debug Logging

Enable with `DEBUG_LOGGING=true bun dev`. Categories: `AUTH`, `REQUEST`, `RESPONSE`, `RETRY`, `VALIDATION`, `TRANSFORM`, `DEDUP`, `STORAGE`, `DATA_VALIDATION`.
