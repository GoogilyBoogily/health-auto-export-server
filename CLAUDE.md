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

## Architecture

**Health Auto Export Server** - A write-only, file-based health data ingestion server for Apple Health data exported via the Health Auto Export iOS app.

**Tech Stack:** Bun runtime, Express.js 5.x, TypeScript 5.7 (strict), Zod 4.x validation

### Request Flow

```
POST /api/data
  → cors → json parser (50mb) → requestLogger → requireWriteAuth (timing-safe)
  → ingestData controller
    → Zod validation (IngestDataSchema)
    → Promise.allSettled(saveMetrics, saveWorkouts)  # Fault-tolerant
    → Response: 200 (success), 207 (partial), 500 (failure)
```

### Key Directories

- `src/controllers/` - Request handlers (`ingester.ts` orchestrates, `metrics.ts` and `workouts.ts` process)
- `src/storage/` - Dual storage system with file locking and atomic writes
- `src/storage/obsidian/` - Obsidian vault integration with Markdown/YAML frontmatter
- `src/types/` - Centralized TypeScript types with barrel export (`index.ts`)
- `src/validation/` - Zod schemas for request validation
- `src/middleware/` - Auth (`auth.ts`) and logging (`requestLogger.ts`)

### Dual Storage System

Data is written to two storage backends simultaneously:

**1. FileStorage (JSON)** - Raw data archive
```
data/metrics/YYYY/MM/YYYY-MM-DD.json
data/workouts/YYYY/MM/YYYY-MM-DD.json
```

**2. ObsidianStorage (Markdown)** - Human-readable tracking files in Obsidian vault

Default paths use Johnny Decimal numbering (configurable in `config.ts`):

- Health metrics → `70-79 Journals & Self-Tracking/79 Health Tracking/YYYY-MM-DD.md`
- Sleep data → `70-79 Journals & Self-Tracking/78 Sleep Tracking/YYYY-MM-DD.md`
- Workouts → `70-79 Journals & Self-Tracking/77 Workout Tracking/YYYY-MM-DD.md`

Each Markdown file has YAML frontmatter for Obsidian Dataview queries.

### Storage Internals

- **Atomic writes:** Temp file + rename prevents corruption
- **File locking:** `filePath.lock` with 30s stale detection (see `fileHelpers.ts:withLock`)
- **Deduplication:** Metrics by `date|source`, workouts by `workoutId`
- **Lazy initialization:** ObsidianStorage initialized after env validation

### Logger

`src/utils/logger.ts` - Dual-mode logging:

- Development: Pretty colored output
- Production: JSON structured logs

## Configuration

All configurable values are centralized in `src/config.ts`. This includes:

- **ServerConfig**: Port, host, body size limit, shutdown timeout
- **RequestConfig**: Request processing timeout
- **AuthConfig**: Token prefix, header name, env var name
- **RateLimitConfig**: Max requests, window duration, skip paths
- **CorsConfig**: Allowed headers, methods, origins env var
- **FileLockConfig**: Retry delays, max retries, stale timeout
- **CacheConfig**: Retention days, max cleanup failures, file patterns
- **RetryConfig**: Max retries, base delay, cleanup debounce
- **ObsidianConfig**: Tracking paths, body templates, frontmatter patterns
- **MetricsConfig**: Session gap threshold, valid sleep stages

To customize behavior, edit `config.ts` directly. Values marked with `@env` can be overridden via environment variables.

## Code Style

ESLint with strict TypeScript checking and multiple plugins (typescript-eslint, unicorn, sonarjs, perfectionist, regexp, promise, node).

Key rules:

- No `any` types allowed
- Underscore-prefixed unused parameters allowed (`argsIgnorePattern: '^_'`)
- Perfectionist handles import/object/type sorting (natural order)
- Express abbreviations allowed: `req`, `res`, `err`, `env`, `acc`
- Filenames: camelCase or PascalCase

## Environment Variables

```bash
API_TOKEN            # Required - API auth token (must start with "sk-")
OBSIDIAN_VAULT_PATH  # Required - Path to Obsidian vault for Markdown output
NODE_ENV             # Optional - development|production (default: development)
DATA_DIR             # Optional - Data directory (default: ./data)
PORT                 # Optional - Server port (default: 3001)
LOG_LEVEL            # Optional - debug|info|warn|error (default: debug)
DEBUG_LOGGING        # Optional - true|false - Enable verbose debug logging (default: false)
```

Run `./create-env.sh` to generate a `.env` with a secure token.

### Debug Logging

Enable verbose debug logging by setting `DEBUG_LOGGING=true`. This provides detailed output for troubleshooting:

**Debug Categories:**

- `AUTH` - Authentication attempts and results (masked tokens, success/failure)
- `REQUEST` - Raw incoming request bodies (truncated for large payloads)
- `RESPONSE` - Outgoing response bodies
- `RETRY` - Retry logic execution (attempt counts, delays, final outcomes)
- `VALIDATION` - Zod schema validation input/output and errors
- `TRANSFORM` - Data mapping and transformation (metric mapping, sleep aggregation)
- `DEDUP` - Deduplication operations (what was filtered, counts)
- `STORAGE` - File operations (paths, frontmatter being written)
- `DATA_VALIDATION` - Runtime data quality issues:
  - Invalid dates (NaN after parsing)
  - Unknown sleep stage values
  - Missing required fields on metrics (type mismatches)
  - Date boundary cases (UTC vs local date differences near midnight)

**Example usage:**

```bash
DEBUG_LOGGING=true bun dev
```
