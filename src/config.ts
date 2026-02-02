/**
 * Centralized configuration for Health Auto Export Server.
 *
 * This file extracts all configurable values from the codebase into a single location.
 * Values can be overridden via environment variables where noted.
 *
 * Configuration categories:
 * - Server: HTTP server settings (port, host, body limits)
 * - Auth: Authentication settings (token format, headers)
 * - RateLimit: Request rate limiting
 * - CORS: Cross-origin resource sharing
 * - FileLock: File locking for concurrent writes
 * - Cache: Cache storage and cleanup
 * - Retry: Retry logic for storage operations
 * - Obsidian: Obsidian vault integration paths and templates
 * - Sleep: Sleep data processing
 * - Metrics: Metric processing settings
 */

import type { TrackingType } from './types';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Safely parse an integer from an environment variable.
 * Throws a descriptive error if the value is not a valid number.
 *
 * @param value - The raw environment variable value (or undefined)
 * @param defaultValue - Default value if env var is not set
 * @param variableName - Name of the environment variable (for error messages)
 * @returns Parsed integer or default value
 * @throws TypeError if value is set but not a valid integer
 */
function parseIntSafe(
  value: string | undefined,
  defaultValue: number,
  variableName: string,
): number {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new TypeError(`Invalid ${variableName}: "${value}" is not a valid integer`);
  }
  return parsed;
}

// =============================================================================
// SERVER CONFIGURATION
// =============================================================================

export const ServerConfig = {
  /**
   * Server port.
   * @env PORT
   * @default 3001
   */
  port: parseIntSafe(process.env.PORT, 3001, 'PORT'),

  /**
   * Server bind address.
   * Use '0.0.0.0' to listen on all interfaces.
   * @default '0.0.0.0'
   */
  host: '0.0.0.0',

  /**
   * Maximum request body size for JSON payloads.
   * Large payloads are common with health data exports.
   * @default '50mb'
   */
  bodyLimit: '50mb',

  /**
   * Graceful shutdown timeout in milliseconds.
   * Server will force exit after this duration if shutdown doesn't complete.
   * @default 10000 (10 seconds)
   */
  shutdownTimeoutMs: 10_000,
} as const;

// =============================================================================
// REQUEST CONFIGURATION
// =============================================================================

export const RequestConfig = {
  /**
   * Maximum request processing time in milliseconds.
   * Requests exceeding this will receive a 408 timeout response.
   * @default 120000 (2 minutes)
   */
  timeoutMs: 120_000,
} as const;

// =============================================================================
// AUTHENTICATION CONFIGURATION
// =============================================================================

export const AuthConfig = {
  /**
   * Required prefix for API tokens.
   * Tokens must start with this prefix to be considered valid.
   * @default 'sk-'
   */
  tokenPrefix: 'sk-',

  /**
   * HTTP header name for the API token.
   * @default 'api-key'
   */
  headerName: 'api-key',

  /**
   * Environment variable name for the API token.
   * @default 'API_TOKEN'
   */
  tokenEnvVar: 'API_TOKEN',
} as const;

// =============================================================================
// RATE LIMITING CONFIGURATION
// =============================================================================

export const RateLimitConfig = {
  /**
   * Maximum requests allowed per IP address within the time window.
   * @default 100
   */
  maxRequests: 100,

  /**
   * Rate limit time window in milliseconds.
   * @default 60000 (1 minute)
   */
  windowMs: 60_000,

  /**
   * Paths excluded from rate limiting.
   * Health check endpoints should be excluded to allow monitoring.
   * @default ['/health']
   */
  skipPaths: ['/health'] as string[],

  /**
   * Multiplier for cleanup interval relative to window size.
   * Cleanup runs every (windowMs * cleanupMultiplier) milliseconds.
   * @default 2
   */
  cleanupMultiplier: 2,
} as const;

// =============================================================================
// CORS CONFIGURATION
// =============================================================================

export const CorsConfig = {
  /**
   * Allowed HTTP headers for CORS requests.
   * @default ['Content-Type', 'Authorization', 'api-key']
   */
  allowedHeaders: ['Content-Type', 'Authorization', 'api-key'] as string[],

  /**
   * Allowed HTTP methods for CORS requests.
   * @default ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
   */
  allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] as string[],

  /**
   * Environment variable name for CORS origins (comma-separated).
   * If not set or set to '*', allows all origins.
   * @env CORS_ORIGINS
   * @default '*'
   */
  originsEnvVar: 'CORS_ORIGINS',
} as const;

// =============================================================================
// FILE LOCKING CONFIGURATION
// =============================================================================

export const FileLockConfig = {
  /**
   * Delay between lock acquisition retry attempts in milliseconds.
   * @default 50
   */
  retryDelayMs: 50,

  /**
   * Maximum number of lock acquisition attempts.
   * Total wait time = retryDelayMs * maxRetries (e.g., 50ms * 100 = 5 seconds).
   * @default 100
   */
  maxRetries: 100,

  /**
   * Time in milliseconds before a lock is considered stale.
   * Stale locks from dead processes will be cleaned up.
   * @default 30000 (30 seconds)
   */
  staleTimeoutMs: 30_000,
} as const;

// =============================================================================
// CACHE CONFIGURATION
// =============================================================================

export const CacheConfig = {
  /**
   * Number of days to retain cache data.
   * Data older than this will be deleted during cleanup.
   * Set to 0 to disable retention/cleanup.
   * @env CACHE_RETENTION_DAYS
   * @default 7
   */
  retentionDays: parseIntSafe(process.env.CACHE_RETENTION_DAYS, 7, 'CACHE_RETENTION_DAYS'),

  /**
   * Maximum consecutive cleanup failures before throwing an error.
   * Prevents silent disk filling if cleanup consistently fails.
   * @default 5
   */
  maxCleanupFailures: 5,

  /**
   * Directory structure patterns for cache files.
   */
  patterns: {
    /** Year directory pattern (e.g., "2024") */
    yearRegex: /^\d{4}$/,
    /** Month directory pattern (e.g., "01", "12") */
    monthRegex: /^\d{2}$/,
    /** Date file pattern (e.g., "2024-01-15.json") */
    dateFileRegex: /^(\d{4}-\d{2}-\d{2})\.json$/,
  },
} as const;

// =============================================================================
// RETRY CONFIGURATION
// =============================================================================

export const RetryConfig = {
  /**
   * Maximum retry attempts for Obsidian storage operations.
   * @default 3
   */
  maxRetries: 3,

  /**
   * Base delay for exponential backoff in milliseconds.
   * Actual delay = baseDelayMs * 2^attemptNumber.
   * @default 1000
   */
  baseDelayMs: 1000,

  /**
   * Debounce interval for cache cleanup in milliseconds.
   * Prevents overlapping cleanup runs from concurrent requests.
   * @default 5000
   */
  cleanupDebounceMs: 5000,
} as const;

// =============================================================================
// OBSIDIAN CONFIGURATION
// =============================================================================

export const ObsidianConfig = {
  /**
   * Tracking folder paths within the Obsidian vault.
   * These paths are relative to OBSIDIAN_VAULT_PATH.
   *
   * Default structure uses Johnny Decimal numbering:
   * - Health: 70-79 Journals & Self-Tracking/78 Health Tracking
   * - Sleep: 70-79 Journals & Self-Tracking/77 Sleep Tracking
   * - Workout: 70-79 Journals & Self-Tracking/76 Workout Tracking
   */
  trackingPaths: {
    health: '70-79 Journals & Self-Tracking/78 Health Tracking',
    sleep: '70-79 Journals & Self-Tracking/77 Sleep Tracking',
    workout: '70-79 Journals & Self-Tracking/76 Workout Tracking',
  } satisfies Record<TrackingType, string>,

  /**
   * Markdown body templates for each tracking type.
   * These are appended after the YAML frontmatter.
   * Use {{date}} placeholder for the date.
   */
  bodyTemplates: {
    health: '# {{date}}\n\n## Health Metrics',
    sleep: '\n## Sleep Log',
    workout: '\n\n## Workout Log',
  } satisfies Record<TrackingType, string>,

  /**
   * Environment variable name for the Obsidian vault path.
   * @env OBSIDIAN_VAULT_PATH
   */
  vaultPathEnvVar: 'OBSIDIAN_VAULT_PATH',

  /**
   * Frontmatter parsing patterns.
   */
  patterns: {
    /** YAML frontmatter extraction regex */
    frontmatterRegex: /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/,
    /** ISO 8601 timestamp with timezone validation */
    isoTimestampRegex: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
  },
} as const;

// =============================================================================
// SLEEP CONFIGURATION
// =============================================================================

export const SleepConfig = {
  /**
   * Hour boundary for assigning sleep to a "night date".
   * Sleep starting before this hour belongs to the previous day's night.
   *
   * Example: Sleep starting at 2 AM Jan 15 → assigned to Jan 14's file.
   * Sleep starting at 10 PM Jan 14 → assigned to Jan 14's file.
   *
   * @default 6 (6 AM)
   */
  nightBoundaryHour: 6,
} as const;

// =============================================================================
// METRICS CONFIGURATION
// =============================================================================

export const MetricsConfig = {
  /**
   * Gap threshold for splitting sleep segments into separate sessions.
   * If the gap between segments exceeds this, a new session starts.
   * @default 30 (minutes)
   */
  sessionGapThresholdMinutes: 30,

  /**
   * Valid sleep stage values from Health Auto Export.
   */
  validSleepStages: ['Awake', 'Core', 'Deep', 'REM'] as const,
} as const;

// =============================================================================
// HTTP STATUS CODES
// =============================================================================

export const HttpStatus = {
  BAD_REQUEST: 400,
  INTERNAL_SERVER_ERROR: 500,
  MULTI_STATUS: 207,
  OK: 200,
  REQUEST_TIMEOUT: 408,
  TOO_MANY_REQUESTS: 429,
  UNAUTHORIZED: 401,
} as const;

// =============================================================================
// COMBINED EXPORT
// =============================================================================

/**
 * Complete application configuration.
 * Import this for access to all configuration sections.
 */
export const config = {
  auth: AuthConfig,
  cache: CacheConfig,
  cors: CorsConfig,
  fileLock: FileLockConfig,
  httpStatus: HttpStatus,
  metrics: MetricsConfig,
  obsidian: ObsidianConfig,
  rateLimit: RateLimitConfig,
  request: RequestConfig,
  retry: RetryConfig,
  server: ServerConfig,
  sleep: SleepConfig,
} as const;

export default config;
