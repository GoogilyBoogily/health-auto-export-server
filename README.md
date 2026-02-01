# Health Auto Export Server

**A write-only, file-based health data ingestion server for Apple Health.**

---

## Overview

This project provides a lightweight, self-hosted server for ingesting Apple Health data exported via the [Health Auto Export](https://www.healthexportapp.com/) iOS app. Data is stored as plain JSON files organized by date, giving you complete ownership and portability of your health data.

**Key Philosophy:** Write once, own forever.

---

## Features

- **File-Based Storage** - Data stored as JSON in `YYYY/MM/YYYY-MM-DD.json` structure
- **Write-Only API** - Single-purpose ingestion endpoint
- **Bun Runtime** - Fast startup and execution with modern JavaScript runtime
- **Atomic Writes** - Temp file + rename pattern prevents data corruption
- **File Locking** - Concurrent write protection with automatic stale lock detection
- **Deduplication** - Metrics keyed by `date|source` to prevent duplicates
- **Zod Validation** - Type-safe request validation
- **Graceful Shutdown** - Clean server termination with in-flight request handling
- **Docker Ready** - Production-ready containerization with health checks
- **100+ Health Metrics** - Comprehensive Apple Health metric support

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

See [`src/models/MetricName.ts`](src/models/MetricName.ts) for the complete list.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.0+ (for local development)
- Docker and Docker Compose (for containerized deployment)

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/your-username/health-auto-export-server.git
cd health-auto-export-server

# Generate environment configuration
./create-env.sh

# Start the server
docker compose up -d

# View logs
docker compose logs -f hae-server
```

### Option 2: Local Development

```bash
# Clone the repository
git clone https://github.com/your-username/health-auto-export-server.git
cd health-auto-export-server

# Install dependencies
bun install

# Generate environment configuration
./create-env.sh

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
   - **Aggregate Data:** Enabled
   - **Batch Requests:** Enabled
4. Use **Manual Export** to test the connection

---

## Configuration

### Environment Variables

Create a `.env` file or run `./create-env.sh` to generate one:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_TOKEN` | Yes | - | API authentication token (must start with `sk-`) |
| `NODE_ENV` | No | `development` | Environment mode (`development` or `production`) |
| `DATA_DIR` | No | `./data` | Directory for storing JSON data files |
| `PORT` | No | `3001` | Server port |
| `LOG_LEVEL` | No | `debug` | Log level (debug/info/warn/error) |

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

- `200` - All data saved successfully
- `207` - Partial success (some data failed)
- `400` - Invalid request format
- `401` - Unauthorized (invalid token)
- `500` - Server error

### Health Check

```
GET /health
```

Returns `OK` with status 200 if the server is running. No authentication required.

---

## Data Storage Structure

Data is organized by type and date:

```
data/
├── metrics/
│   └── 2025/
│       └── 01/
│           ├── 2025-01-01.json
│           ├── 2025-01-02.json
│           └── ...
└── workouts/
    └── 2025/
        └── 01/
            ├── 2025-01-01.json
            └── ...
```

### Deduplication

- **Metrics:** Deduplicated by `date + source`
- **Workouts:** Deduplicated by `workoutId`

---

## Project Structure

```
.
├── src/
│   ├── app.ts              # Express entry point
│   ├── controllers/        # Request handlers
│   │   ├── ingester.ts     # Main ingestion orchestrator
│   │   ├── metrics.ts      # Metrics processing
│   │   └── workouts.ts     # Workout processing
│   ├── middleware/         # Express middleware
│   │   ├── auth.ts         # Token authentication
│   │   └── requestLogger.ts
│   ├── models/             # TypeScript types
│   │   ├── Metric.ts
│   │   ├── MetricName.ts   # 100+ metric enums
│   │   └── Workout.ts
│   ├── routes/             # API route definitions
│   ├── storage/            # File persistence layer
│   ├── utils/
│   │   └── logger.ts
│   └── validation/         # Zod schemas
├── data/                   # Health data (gitignored)
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

- **Personal Health Archive** - Store years of health data in portable JSON format
- **Custom Analytics** - Build your own dashboards and analysis tools
- **Data Ownership** - Keep health data on your own infrastructure
- **Research** - Export and analyze data with any tool that reads JSON
- **Backup** - Simple file-based backup with any standard backup solution

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | [Bun](https://bun.sh/) |
| Framework | [Express.js](https://expressjs.com/) 5.x |
| Language | [TypeScript](https://www.typescriptlang.org/) 5.7 |
| Validation | [Zod](https://zod.dev/) |
| Container | Docker with Alpine Linux |

---

## Acknowledgments

This project is a specialized fork of [health-auto-export-server](https://github.com/HealthyApps/health-auto-export-server) by HealthyApps. Thank you to the original authors for creating the foundation that made this variant possible.

This variant focuses on:

- **File-based JSON storage** for data portability
- **Write-only API** for simple ingestion
- **Bun runtime** for fast execution
- **Data ownership** and self-hosting

---

## License

MIT - See [LICENSE](LICENSE) for details.
