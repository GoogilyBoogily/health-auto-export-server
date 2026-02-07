# Health Auto Export Server

**A write-only health data ingestion server for Apple Health with Obsidian vault integration.**

---

## Overview

A self-hosted server for ingesting Apple Health data exported via the [Health Auto Export](https://www.healthexportapp.com/) iOS app. Data is stored in two complementary formats:

- **Obsidian Markdown** — Human-readable files with YAML frontmatter, queryable via [Dataview](https://blacksmithgu.github.io/obsidian-dataview/)
- **JSON cache** — Date-organized deduplication cache for fast lookups

Obsidian is the authoritative store. The JSON cache only updates after Obsidian writes succeed, preventing drift between the two.

**Key Philosophy:** Write once, own forever.

---

## Features

- **Obsidian Vault Integration** — YAML frontmatter files for health, sleep, and workout tracking
- **Dual Storage System** — Obsidian Markdown (authoritative) + JSON cache (deduplication)
- **Write-Only API** — Single-purpose ingestion endpoint
- **Bun Runtime** — Fast startup and execution
- **Atomic Writes** — Temp file + rename prevents data corruption
- **File Locking** — Concurrent write protection with stale lock detection
- **Deduplication** — Metrics by `date|source` hash, workouts by `workoutId`
- **Retry with Exponential Backoff** — Automatic retries for Obsidian storage operations
- **Rate Limiting** — 100 requests per minute per IP
- **Request Timeout** — 2-minute request processing limit
- **Timing-Safe Auth** — Constant-time token comparison
- **Sleep Session Analysis** — Automatic session splitting with configurable gap threshold
- **Zod 4.x Validation** — Type-safe request validation
- **Configurable Obsidian Paths & Templates** — Customizable folder structure and body templates
- **Graceful Shutdown** — Clean server termination with in-flight request handling
- **Docker Ready** — Production-ready containerization with health checks
- **100+ Health Metrics** — Comprehensive Apple Health metric support

---

## Supported Health Metrics

| Category | Examples |
|----------|----------|
| **Activity** | Steps, active energy, exercise time, stand hours, flights climbed |
| **Heart & Vitals** | Heart rate, HRV, resting heart rate, blood pressure, blood oxygen |
| **Body** | Weight, height, body fat percentage, BMI, lean body mass |
| **Sleep** | Sleep analysis, time asleep, time in bed, sleep stages |
| **Nutrition** | Calories, macros (protein, carbs, fat), vitamins, minerals, water |
| **Respiratory** | Respiratory rate, VO2 max, forced vital capacity |
| **Mobility** | Walking speed, step length, walking asymmetry, stair speed |
| **Workouts** | All workout types with GPS routes, heart rate zones, and metadata |
| **Cycling** | Distance, speed, cadence, power |
| **Running** | Ground contact time, stride length, vertical oscillation |
| **Other** | Mindful minutes, handwashing, environmental audio, UV exposure |

See [`src/types/metricName.ts`](src/types/metricName.ts) for the complete list.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.0+ (for local development)
- Docker and Docker Compose (for containerized deployment)

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/GoogilyBoogily/health-auto-export-server.git
cd health-auto-export-server

# Generate environment configuration
./create-env.sh

# Set your Obsidian vault path in .env
# OBSIDIAN_VAULT_PATH=/path/to/your/vault

# Start the server
docker compose up -d

# View logs
docker compose logs -f hae-server
```

### Option 2: Local Development

```bash
# Clone the repository
git clone https://github.com/GoogilyBoogily/health-auto-export-server.git
cd health-auto-export-server

# Install dependencies
bun install

# Generate environment configuration
./create-env.sh

# Set your Obsidian vault path in .env
# OBSIDIAN_VAULT_PATH=/path/to/your/vault

# Start development server (with hot reload)
bun dev

# Or start production server
bun start
```

The server runs on **port 3001** by default.

---

## Configure Health Auto Export App

1. Install [Health Auto Export](https://www.healthexportapp.com/) on your iPhone
2. Navigate to **Automations** tab
3. Create a new automation:
   - **Type:** REST API
   - **URL:** `http://your-server-ip:3001/api/data`
   - **Headers:** `api-key: sk-your-write-token` (from `.env`)
   - **Export Format:** JSON
   - **Batch Requests:** Enabled
4. Use **Manual Export** to test the connection

---

## Configuration

### Environment Variables

Create a `.env` file or run `./create-env.sh` to generate one:

#### Required

| Variable | Description |
|----------|-------------|
| `API_TOKEN` | API authentication token (must start with `sk-`) |
| `OBSIDIAN_VAULT_PATH` | Absolute path to Obsidian vault for Markdown output |

#### Docker

| Variable | Default | Description |
|----------|---------|-------------|
| `PUID` | `1000` | Host user ID for volume permissions |
| `PGID` | `1000` | Host group ID for volume permissions |

Set these to match the owner of your Obsidian vault directory (`id -u` and `id -g`).

#### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment mode (`development` or `production`) |
| `PORT` | `3001` | Server port |
| `DATA_DIR` | `./data` | Directory for JSON cache files |
| `LOG_LEVEL` | `debug` | Log level (`debug` / `info` / `warn` / `error`) |
| `DEBUG_LOGGING` | `false` | Enable verbose debug logging |
| `CORS_ORIGINS` | `*` | Comma-separated allowed CORS origins |

#### Cache

| Variable | Default | Description |
|----------|---------|-------------|
| `CACHE_RETENTION_DAYS` | `7` | Days to retain cache data (`0` disables cleanup) |

#### Metrics

| Variable | Default | Description |
|----------|---------|-------------|
| `SLEEP_SESSION_GAP_MINUTES` | `30` | Gap threshold (minutes) for splitting sleep sessions |

#### Obsidian Paths

Relative to `OBSIDIAN_VAULT_PATH`. Default structure uses [Johnny Decimal](https://johnnydecimal.com/) numbering.

| Variable | Default |
|----------|---------|
| `OBSIDIAN_HEALTH_PATH` | `70-79 Journals & Self-Tracking/79 Health Tracking` |
| `OBSIDIAN_SLEEP_PATH` | `70-79 Journals & Self-Tracking/78 Sleep Tracking` |
| `OBSIDIAN_WORKOUT_PATH` | `70-79 Journals & Self-Tracking/77 Workout Tracking` |

#### Obsidian Body Templates

Use `\n` for newlines in environment variable values. Use `{{date}}` placeholder for the date.

| Variable | Default |
|----------|---------|
| `OBSIDIAN_HEALTH_TEMPLATE` | `# {{date}}\n\n## Health Metrics` |
| `OBSIDIAN_SLEEP_TEMPLATE` | `\n## Sleep Log` |
| `OBSIDIAN_WORKOUT_TEMPLATE` | `\n\n## Workout Log` |

### Token Generation

```bash
# Automatically generates a secure token
./create-env.sh
```

---

## API Reference

### Ingest Data

```
POST /api/data
```

Ingests metrics and workouts from Health Auto Export app.

**Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `api-key` | Yes | Your `API_TOKEN` value |
| `Content-Type` | Yes | `application/json` |

**Response Codes:**

| Code | Meaning |
|------|---------|
| `200` | All data saved successfully |
| `207` | Partial success (some data failed) |
| `400` | Invalid request format |
| `401` | Unauthorized (invalid token) |
| `408` | Request timeout (exceeded 2 minutes) |
| `429` | Rate limited (exceeded 100 req/min) |
| `500` | Server error |

**Response Body:**

```json
{
  "metrics": {
    "saved": 42,
    "skipped": 3,
    "errors": 0
  },
  "workouts": {
    "saved": 1,
    "skipped": 0,
    "errors": 0
  }
}
```

### Health Check

```
GET /health
```

Returns `OK` with status 200 if the server is running. No authentication required.

---

## Data Storage Structure

### JSON Cache (Deduplication)

```
data/
├── metrics/
│   └── 2025/
│       └── 01/
│           ├── 2025-01-01.json
│           └── 2025-01-02.json
└── workouts/
    └── 2025/
        └── 01/
            └── 2025-01-01.json
```

### Obsidian Markdown (Authoritative Store)

```
Obsidian Vault/
├── 77 Workout Tracking/
│   └── 2025-01-01.md
├── 78 Sleep Tracking/
│   └── 2025-01-01.md
└── 79 Health Tracking/
    └── 2025-01-01.md
```

Each Markdown file has YAML frontmatter for [Dataview](https://blacksmithgu.github.io/obsidian-dataview/) queries:

```markdown
---
date: "2025-01-01"
type: health
steps:
  - time: "2025-01-01T08:30:00-05:00"
    value: 1250
    source: "Apple Watch"
  - time: "2025-01-01T09:15:00-05:00"
    value: 830
    source: "Apple Watch"
heart_rate:
  - time: "2025-01-01T08:30:00-05:00"
    value: 72
    source: "Apple Watch"
---
# 2025-01-01

## Health Metrics
```

### Deduplication

- **Metrics:** Deduplicated by `date + source`
- **Workouts:** Deduplicated by `workoutId`

---

## Project Structure

```
.
├── src/
│   ├── app.ts                          # Express entry point
│   ├── config.ts                       # Centralized configuration
│   ├── controllers/
│   │   ├── ingester.ts                 # Ingestion orchestrator
│   │   ├── metrics.ts                  # Metrics processing pipeline
│   │   └── workouts.ts                 # Workout processing pipeline
│   ├── mappers/
│   │   ├── index.ts                    # Barrel export
│   │   ├── metricMapper.ts             # Metric transformation + validation
│   │   └── workoutMapper.ts            # Workout transformation
│   ├── middleware/
│   │   ├── auth.ts                     # Timing-safe token authentication
│   │   ├── rateLimit.ts                # IP-based rate limiting
│   │   ├── requestLogger.ts            # Request/response logging
│   │   └── requestTimeout.ts           # 2-minute request timeout
│   ├── routes/
│   │   └── ingester.ts                 # API route definitions
│   ├── storage/
│   │   ├── CacheStorage.ts             # JSON cache with expiry
│   │   ├── fileHelpers.ts              # Atomic writes + file locking
│   │   ├── index.ts                    # Barrel export
│   │   └── obsidian/
│   │       ├── ObsidianStorage.ts      # Obsidian vault integration
│   │       ├── constants.ts            # Storage constants
│   │       ├── index.ts                # Barrel export
│   │       ├── formatters/
│   │       │   ├── health.ts           # Health frontmatter formatter
│   │       │   ├── sleep.ts            # Sleep frontmatter formatter
│   │       │   └── workout.ts          # Workout frontmatter formatter
│   │       └── utils/
│   │           ├── dateUtilities.ts     # Date formatting helpers
│   │           └── markdownUtilities.ts # Markdown/YAML helpers
│   ├── types/
│   │   ├── index.ts                    # Barrel export
│   │   ├── ingest.ts                   # Ingestion request/response types
│   │   ├── metric.ts                   # Metric data types
│   │   ├── metricName.ts               # 100+ metric name enum
│   │   ├── obsidian.ts                 # Obsidian frontmatter types
│   │   ├── storage.ts                  # Storage interface types
│   │   └── workout.ts                  # Workout data types
│   ├── utils/
│   │   ├── deduplication.ts            # Hash-based deduplication
│   │   ├── logger.ts                   # Dual-mode logger (pretty/JSON)
│   │   └── retry.ts                    # Exponential backoff retry
│   └── validation/
│       └── schemas.ts                  # Zod request schemas
├── data/                               # JSON cache (gitignored)
├── docker-compose.yaml
├── Dockerfile
├── package.json
└── create-env.sh
```

---

## Development

```bash
# Install dependencies
bun install

# Start with hot reload
bun dev

# Lint code
bun lint

# Fix lint issues
bun lint:fix

# Format code
bun format
```

### Docker Commands

```bash
docker compose up -d              # Start
docker compose down               # Stop
docker compose logs -f hae-server # View logs
docker compose restart hae-server # Restart
```

---

## Use Cases

- **Obsidian Health Dashboard** — Query health data with Dataview in your Obsidian vault
- **Personal Health Archive** — Store years of health data in portable formats
- **Custom Analytics** — Build dashboards from JSON cache or Obsidian frontmatter
- **Data Ownership** — Keep health data on your own infrastructure
- **Backup** — Simple file-based backup with any standard backup solution

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | [Bun](https://bun.sh/) |
| Framework | [Express.js](https://expressjs.com/) 5.x |
| Language | [TypeScript](https://www.typescriptlang.org/) 5.7 |
| Validation | [Zod](https://zod.dev/) 4.x |
| YAML | [yaml](https://eemeli.org/yaml/) |
| Container | Docker with Alpine Linux |

---

## Acknowledgments

This project is a specialized fork of [health-auto-export-server](https://github.com/HealthyApps/health-auto-export-server) by HealthyApps. Thank you to the original authors for creating the foundation that made this variant possible.

This variant adds:

- **Obsidian vault integration** with YAML frontmatter for Dataview queries
- **Dual storage system** for reliability and human-readable output
- **Raw readings storage** instead of computed aggregates
- **Configurable paths and templates** for vault organization

---

## License

MIT — See [LICENSE](LICENSE) for details.
