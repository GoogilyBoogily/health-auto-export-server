# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

All commands run from project root:

```bash
# Development (hot reload)
bun dev

# Start production server
bun start

# Linting
bun lint
bun lint:fix

# Formatting
bun format
```

Docker (from project root):
```bash
docker compose up -d      # Start services
docker compose down       # Stop services
docker compose logs -f hae-server  # View logs
```

## Architecture

Express.js/TypeScript backend for ingesting Apple Health data (write-only).

**Request Flow:** Routes → Controllers → Storage (file-based JSON)

**Storage Structure:**
- `data/metrics/YYYY/MM/YYYY-MM-DD.json` - Daily metric files
- `data/workouts/YYYY/MM/YYYY-MM-DD.json` - Daily workout files

**API Endpoints:**
- `POST /api/data` - Ingest metrics/workouts (requires WRITE_TOKEN)
- `GET /health` - Health check endpoint (no auth)

**Authentication:** Token-based via `api-key` header. Tokens must start with `sk-`.

## Key Directories

```
src/
├── app.ts           # Express entry point (port 3001)
├── controllers/     # Ingestion business logic
├── routes/          # Ingestion endpoint definitions
├── models/          # TypeScript types (Metric, Workout, MetricName enum)
├── storage/         # FileStorage class for JSON persistence
├── middleware/      # Write auth, request logging
├── utils/           # Logger
└── validation/      # Zod schemas for request validation
```

## Environment Variables

Required in `.env`:
```
NODE_ENV=production|development
DATA_DIR=./data
WRITE_TOKEN=sk-xxx
```

Generate tokens: `sh ./create-env.sh`

## Important Patterns

- **Atomic writes:** Storage uses temp file + rename to prevent corruption
- **Deduplication:** Metrics keyed by `ISO_DATE|SOURCE`
- **Correlation IDs:** All requests tagged with unique ID for log tracing
- **UTC timestamps:** All dates stored and processed in UTC
