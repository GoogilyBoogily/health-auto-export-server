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
bun run check        # Assertion self-check (no framework)
bun report:vault     # Read-only vault diagnostics

# Docker
docker compose up -d              # Start containerized
docker compose logs -f hae-server # View logs
docker compose down               # Stop
```

**Deployment is manual.** The server runs as a container that the maintainer releases and updates
by hand — there is no CI deploy, no watchtower, and no auto-pull. Merging to `main` does not ship
anything. `docker-compose.yaml` declares `build:` with no `image:` or `pull_policy`, so a bare
`up -d` can silently reuse a stale local image; rebuild with `--no-cache` when releasing.


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

Deduplication is handled by the Obsidian formatters during merge — health metrics upsert by a metric-aware instant key (see below), workouts by `appleWorkoutId`, sleep stages by same-stage interval overlap.

**Reading dedup identity** (`dedupKey`, `formatters/health.ts`) keys on the *parsed instant*, not
the timestamp text, so one moment spelled under two UTC offsets is one reading. Metrics the
exporter delivers as one bucket per hour (`HOURLY_BUCKETED_METRICS` in `config.ts`) additionally
fold to the hour, because it re-buckets the same samples against a different anchor every sync.
Event totals (`EVENT_TOTAL_METRICS` — dietary and per-occurrence counters) never fold: two entries
in one hour are two entries. Discrete metrics keep their exact instant. Where readings collapse,
the larger value wins — insertion order is not freshness order.

`source` remains in the key, so readings attributed to different device sets stay distinct. That
leaves same-hour readings any consumer summing them will over-count; `bun report:vault` reports
this as its own figure rather than hiding it. `bun run scripts/heal-vault.ts` collapses historical
files (dry run by default).


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
- **Deduplication:** Health metrics by a metric-aware instant key, workouts by `appleWorkoutId` upsert
- **Lock wait:** 20s (`FileLockConfig`), above a real 15.4s hold observed in production and below
  the 30s stale timeout, so a live lock is waited out and a dead one is still broken
- **Unreadable frontmatter:** backed up to `<file>.corrupt.<ts>.bak`, then the write is refused.
  The backup keeps the bytes; the refusal keeps a day of metrics from being replaced unread
- **Lazy initialization:** ObsidianStorage initialized after env validation in `app.ts`

### Known gap: fused frontmatter

Eight daily notes carry more than two `---` fences. `FRONTMATTER_REGEX` is non-greedy, so it takes
block 1 and returns everything after as *body*, which the storage layer then preserves verbatim —
a second block of real readings ends up invisible to this server, to `bun report:vault`, and to
every downstream consumer. `bun report:vault` detects and lists them.

`scripts/repair-fused-frontmatter.ts` is `WRITES_DISABLED` and must stay that way. Run once against
the live vault, it silently discarded sleep stages, three workouts, a habit entry and two days of
weather; the faults are structural and documented at the top of the file. Its dry run still finds
the notes. There is no automated merge today.

Three of the eight have a parseable second block — roughly 568 readings that exist nowhere else —
but every one of them conflicts on `dailySummary`, where two weather writers disagree field by
field. A human picks the winner. The other five have a second block no parser can read: two YAML
lines welded into one by an interrupted write (`autonomy: 5 duration: 0.92`, a mood field spliced
onto a sleep-stage field). Reconstructing the lost newline is a human job.

Do not run the vault's `00-09 Meta & System/03 Scripts/dawarich-backfill-weather.js` until its
line 791 merges rather than strips. Its "defensive" regex replaces a leading second block with the
empty string, which deletes roughly 439 KB across seven of the eight notes.

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
SLEEP_WINDOW_CUTOFF_HOUR   # Local hour from which sleep-window metrics are filed to the next day (default: 18)
OBSIDIAN_TEMPLATE_BACKFILL_DAYS  # Days back within which an empty note body is re-templated (default: 7)

# Optional - Obsidian paths (relative to OBSIDIAN_VAULT_PATH)
OBSIDIAN_DAILY_PATH    # Daily tracking folder (default: 70-79 Journals & Self-Tracking/72 Daily Tracking)

# Optional - Obsidian body template (use \n for newlines in env vars)
OBSIDIAN_DAILY_TEMPLATE    # Daily file body template (default: ## Habit Log\n\n## Mood Log\n\n## Bullet Journal\n\n## Workout Log\n\n## Sleep Log\n\n# {{date}}\n\n## Health Metrics)
```

Run `./create-env.sh` to generate a `.env` with a secure token.

### Debug Logging

Enable with `DEBUG_LOGGING=true bun dev`. Categories: `AUTH`, `REQUEST`, `RESPONSE`, `RETRY`, `VALIDATION`, `TRANSFORM`, `STORAGE`, `DATA_VALIDATION`.
