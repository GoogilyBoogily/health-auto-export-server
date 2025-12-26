# Health Auto Export Server

A lightweight Express.js/TypeScript server for ingesting Apple Health data from the [Health Auto Export](https://apple.co/3iqbU2d) iOS app. Data is stored as JSON files organized by date.

## Features

- File-based JSON storage (no database required)
- Atomic writes prevent data corruption
- Automatic deduplication of metrics
- UTC-consistent date handling
- Correlation ID logging for request tracing

## Requirements

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (recommended), or
- [Bun](https://bun.sh/) runtime (for local development)

## Quick Start

### 1. Clone and Configure

```bash
git clone https://github.com/HealthyApps/health-auto-export-server.git
cd health-auto-export-server

# Generate secure tokens
sh ./create-env.sh
```

Or create `.env` manually:

```env
NODE_ENV=production
DATA_DIR=./data
WRITE_TOKEN=sk-your-secure-token-here
```

### 2. Start the Server

**Using Docker (recommended):**

```bash
docker compose up -d
```

**Using Bun (local development):**

```bash
bun install
bun dev
```

The server runs on port `3001`.

### 3. Configure Health Auto Export App

1. Install [Health Auto Export](https://apple.co/3iqbU2d) on your iPhone
2. Navigate to **Automations** tab
3. Create a new automation:
   - **Type:** REST API
   - **URL:** `http://your-server-ip:3001/api/data`
   - **Headers:** `api-key: sk-your-write-token` (from `.env`)
   - **Export Format:** JSON
   - **Aggregate Data:** Enabled
   - **Batch Requests:** Enabled
4. Use **Manual Export** to test the connection

## API Reference

### POST /api/data

Ingest health metrics and/or workouts.

**Headers:**
- `api-key`: Your write token (must start with `sk-`)
- `Content-Type`: `application/json`

**Response Codes:**
- `200`: All data saved successfully
- `207`: Partial success (some data failed)
- `400`: Invalid request format
- `401`: Unauthorized (invalid token)
- `500`: Server error

### GET /health

Health check endpoint (no authentication required).

## Data Storage

Data is stored as JSON files organized by date:

```
data/
├── metrics/
│   └── 2024/
│       └── 01/
│           └── 2024-01-15.json
└── workouts/
    └── 2024/
        └── 01/
            └── 2024-01-15.json
```

### Deduplication

- **Metrics:** Deduplicated by `date + source`
- **Workouts:** Deduplicated by `workoutId`

## Development

```bash
# Install dependencies
bun install

# Start dev server (hot reload)
bun dev

# Lint code
bun lint
bun lint:fix

# Format code
bun format
```

## Docker Commands

```bash
docker compose up -d          # Start
docker compose down           # Stop
docker compose logs -f hae-server  # View logs
docker compose restart hae-server  # Restart
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Environment mode |
| `DATA_DIR` | No | `./data` | Data storage directory |
| `WRITE_TOKEN` | Yes | - | API authentication token (must start with `sk-`) |
| `PORT` | No | `3001` | Server port |
| `LOG_LEVEL` | No | `debug` | Log level (debug/info/warn/error) |

## Supported Metrics

See [`src/models/MetricName.ts`](src/models/MetricName.ts) for the full list of supported health metrics.

## Troubleshooting

**Connection refused:**
- Ensure the server is running (`docker compose ps`)
- Check your firewall allows port 3001
- Verify your computer's IP address

**401 Unauthorized:**
- Verify the `api-key` header matches `WRITE_TOKEN` in `.env`
- Token must start with `sk-`

**View logs:**
```bash
docker compose logs -f hae-server
```

## Support

- [Open an issue](https://github.com/HealthyApps/health-auto-export-server/issues)
- [Discord server](https://discord.gg/PY7urEVDnj)
- [Contact support](https://healthyapps.dev/contact)

## Contributing

Contributions welcome! Please open a pull request with your changes.

## License

MIT
