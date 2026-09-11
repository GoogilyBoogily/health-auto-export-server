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
 * - Retry: Retry logic for storage operations
 * - Obsidian: Obsidian vault integration paths and templates
 * - Metrics: Metric processing settings
 */

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

/**
 * Parse a template string from an environment variable.
 * Converts literal `\n` in env var values to actual newlines.
 */
function parseTemplate(envVariable: string | undefined, defaultValue: string): string {
  return envVariable?.replaceAll(String.raw`\n`, '\n') ?? defaultValue;
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

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_CLEANUP_MULTIPLIER = 2;

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
  windowMs: RATE_LIMIT_WINDOW_MS,

  /**
   * Paths excluded from rate limiting.
   * Health check endpoints should be excluded to allow monitoring.
   * @default ['/health']
   */
  skipPaths: ['/health'] as string[],

  /**
   * Multiplier for cleanup interval relative to window size.
   * @default 2
   */
  cleanupMultiplier: RATE_LIMIT_CLEANUP_MULTIPLIER,

  /**
   * Computed cleanup interval in milliseconds.
   * Cleanup runs every (windowMs * cleanupMultiplier) milliseconds.
   */
  cleanupIntervalMs: RATE_LIMIT_WINDOW_MS * RATE_LIMIT_CLEANUP_MULTIPLIER,
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

const FILE_LOCK_RETRY_DELAY_MS = 50;
// 20s of patience. A real ingest was observed holding one daily file for 15,370 ms, so the
// previous 5s ceiling made a concurrent writer throw while the lock was still legitimately held —
// and `staleTimeoutMs` never fired either, because 15.4s is well under 30s. Stays below
// `staleTimeoutMs` so a lock from a dead process is still broken rather than waited out.
const FILE_LOCK_MAX_RETRIES = 400;

export const FileLockConfig = {
  /**
   * Delay between lock acquisition retry attempts in milliseconds.
   * @default 50
   */
  retryDelayMs: FILE_LOCK_RETRY_DELAY_MS,

  /**
   * Maximum number of lock acquisition attempts.
   * @default 400
   */
  maxRetries: FILE_LOCK_MAX_RETRIES,

  /**
   * Time in milliseconds before a lock is considered stale.
   * Stale locks from dead processes will be cleaned up.
   * @default 30000 (30 seconds)
   */
  staleTimeoutMs: 30_000,

  /**
   * Computed maximum wait time for lock acquisition in milliseconds.
   * Equal to retryDelayMs * maxRetries.
   */
  totalMaxWaitMs: FILE_LOCK_RETRY_DELAY_MS * FILE_LOCK_MAX_RETRIES,
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
} as const;

// =============================================================================
// OBSIDIAN CONFIGURATION
// =============================================================================

export const ObsidianConfig = {
  /**
   * Daily tracking folder path within the Obsidian vault.
   * Relative to OBSIDIAN_VAULT_PATH. Uses Johnny Decimal numbering.
   * @env OBSIDIAN_DAILY_PATH
   */
  dailyPath: process.env.OBSIDIAN_DAILY_PATH ?? '70-79 Journals & Self-Tracking/72 Daily Tracking',

  /**
   * Markdown body template for daily tracking files.
   * Appended after YAML frontmatter. Use {{date}} placeholder for the date.
   * Use `\n` in env var values for newlines.
   * @env OBSIDIAN_DAILY_TEMPLATE
   */
  bodyTemplate: parseTemplate(
    process.env.OBSIDIAN_DAILY_TEMPLATE,
    '## Habit Log\n\n## Mood Log\n\n## Bullet Journal\n\n## Workout Log\n\n## Sleep Log\n\n# {{date}}\n\n## Health Metrics',
  ),

  /**
   * Days back from today within which an empty note body is replaced with the body template.
   *
   * Only applies to notes whose body is empty or whitespace-only. A note with real body content
   * is preserved regardless of age. Without this bound, a full-history re-export would retro-fill
   * the template into hundreds of notes that have been empty since the vault was migrated.
   * @env OBSIDIAN_TEMPLATE_BACKFILL_DAYS
   * @default 7 (days)
   */
  templateBackfillDays: parseIntSafe(
    process.env.OBSIDIAN_TEMPLATE_BACKFILL_DAYS,
    7,
    'OBSIDIAN_TEMPLATE_BACKFILL_DAYS',
  ),

  /**
   * Environment variable name for the Obsidian vault path.
   * @env OBSIDIAN_VAULT_PATH
   */
  vaultPathEnvVar: 'OBSIDIAN_VAULT_PATH',
} as const;

// =============================================================================
// METRICS CONFIGURATION
// =============================================================================

export const MetricsConfig = {
  /**
   * Gap threshold for splitting sleep segments into separate sessions.
   * If the gap between segments exceeds this, a new session starts.
   * @env SLEEP_SESSION_GAP_MINUTES
   * @default 30 (minutes)
   */
  sessionGapThresholdMinutes: parseIntSafe(
    process.env.SLEEP_SESSION_GAP_MINUTES,
    30,
    'SLEEP_SESSION_GAP_MINUTES',
  ),

  /**
   * Local hour from which a sleep-window measurement is attributed to the NEXT day.
   *
   * Apple stamps `apple_sleeping_wrist_temperature` and `breathing_disturbances` in the evening
   * (20:00-22:00 observed), but they describe the night that ends the following morning — which
   * is the day the sleep stages themselves are filed under. Without this shift a single night's
   * data is split across two daily files.
   *
   * Raise it for a late sleeper, lower it for someone who turns in before 18:00.
   * @env SLEEP_WINDOW_CUTOFF_HOUR
   * @default 18
   */
  sleepWindowCutoffHour: parseIntSafe(
    process.env.SLEEP_WINDOW_CUTOFF_HOUR,
    18,
    'SLEEP_WINDOW_CUTOFF_HOUR',
  ),

  /**
   * Valid sleep stage values from Health Auto Export.
   */
  validSleepStages: ['Asleep', 'Awake', 'Core', 'Deep', 'In Bed', 'REM'] as const,
} as const;

// =============================================================================
// METRIC SHAPE CLASSIFICATION
// =============================================================================

/**
 * Frontmatter keys the server has written that no current `MetricName` member maps to.
 *
 * The enum is not the set of keys this server owns — the default mapper branch writes whatever
 * metric name arrives, so a name Apple has since renamed leaves a key behind that nothing in the
 * enum reproduces. `alcoholConsumption` is one: readings exist in the vault in `MetricReading`
 * shape, and `number_of_alcoholic_beverages` does not camel-case to it.
 */
export const LEGACY_OWNED_KEYS = ['alcoholConsumption'] as const;

/**
 * Metrics Health Auto Export delivers as one bucket per hour.
 *
 * These are the only metrics safe to deduplicate by hour. The exporter re-buckets the same
 * samples against a different anchor on each sync, so two readings landing in one hour are the
 * same hour re-reported, never two distinct measurements.
 */
export const HOURLY_BUCKETED_METRICS: ReadonlySet<string> = new Set([
  'activeEnergy',
  'appleExerciseTime',
  'appleMoveTime',
  'appleStandHour',
  'appleStandTime',
  'basalEnergyBurned',
  'cyclingDistance',
  'distanceDownhillSnowSports',
  'flightsClimbed',
  'stepCount',
  'swimmingDistance',
  'swimStrokeCount',
  'timeInDaylight',
  'walkingRunningDistance',
  'wheelchairDistance',
  'wheelchairPushCount',
]);

/**
 * Cumulative metrics logged per event rather than per hour.
 *
 * Every dietary metric is a per-entry total from a food logger, and the activity counters below
 * record discrete occurrences. Two entries inside one hour are two real events — a 09:00 meal and
 * a 09:02 meal are not the same meal — so these must never be folded to the hour even though they
 * are cumulative and summing them is meaningful.
 */
export const EVENT_TOTAL_METRICS: ReadonlySet<string> = new Set([
  'alcoholConsumption',
  'biotin',
  'caffeine',
  'calcium',
  'carbohydrates',
  'chloride',
  'cholesterol',
  'chromium',
  'copper',
  'dietaryEnergy',
  'dietarySugar',
  'dietaryWater',
  'fiber',
  'folate',
  'handwashing',
  'inhalerUsage',
  'insulinDelivery',
  'iodine',
  'iron',
  'magnesium',
  'manganese',
  'mindfulMinutes',
  'molybdenum',
  'monounsaturatedFat',
  'niacin',
  'numberOfAlcoholicBeverages',
  'numberOfTimeFallen',
  'pantothenicAcid',
  'phosphorus',
  'polyunsaturatedFat',
  'potassium',
  'protein',
  'riboflavin',
  'saturatedFat',
  'selenium',
  'sexualActivity',
  'sodium',
  'thiamin',
  'toothbrushing',
  'totalFat',
  'vitaminA',
  'vitaminB6',
  'vitaminB12',
  'vitaminC',
  'vitaminD',
  'vitaminE',
  'vitaminK',
  'zinc',
]);

/** Every metric whose readings are meaningful to sum over a day. */
export const CUMULATIVE_METRICS: ReadonlySet<string> = new Set([
  ...EVENT_TOTAL_METRICS,
  ...HOURLY_BUCKETED_METRICS,
]);

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
  cors: CorsConfig,
  fileLock: FileLockConfig,
  httpStatus: HttpStatus,
  metrics: MetricsConfig,
  obsidian: ObsidianConfig,
  rateLimit: RateLimitConfig,
  request: RequestConfig,
  retry: RetryConfig,
  server: ServerConfig,
} as const;
