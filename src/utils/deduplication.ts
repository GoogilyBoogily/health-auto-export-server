import type {
  Metric,
  MetricCommon,
  MetricDailyFile,
  WorkoutDailyFile,
  WorkoutData,
} from '../types';

/**
 * Build a hash set from cached metrics for O(1) duplicate lookup.
 */
export function buildMetricHashSet(cachedData: Map<string, MetricDailyFile>): Set<string> {
  const hashSet = new Set<string>();

  for (const dailyFile of cachedData.values()) {
    for (const metrics of Object.values(dailyFile.metrics)) {
      for (const metric of metrics) {
        hashSet.add(createMetricHash(metric));
      }
    }
  }

  return hashSet;
}

/**
 * Build a map of identity keys to array indices for O(1) upsert lookup.
 * Used by CacheStorage to find existing metrics for update.
 */
export function buildMetricIdentityMap(metrics: Metric[], metricType: string): Map<string, number> {
  const identityMap = new Map<string, number>();
  for (const [index, metric] of metrics.entries()) {
    const key = createMetricIdentityKey(metric, metricType);
    identityMap.set(key, index);
  }
  return identityMap;
}

/**
 * Build a set of existing workout IDs from cache.
 */
export function buildWorkoutIdSet(cachedData: Map<string, WorkoutDailyFile>): Set<string> {
  const idSet = new Set<string>();

  for (const dailyFile of cachedData.values()) {
    for (const workoutId of Object.keys(dailyFile.workouts)) {
      idSet.add(workoutId);
    }
  }

  return idSet;
}

/**
 * Create a deterministic hash string for a metric.
 * Two metrics with identical data will produce the same hash.
 *
 * Used by both:
 * - Upstream deduplication (filterDuplicateMetrics) to filter incoming requests
 * - CacheStorage to detect duplicates when writing to cache files
 *
 * Uses a fast path for common BaseMetric types (90%+ of traffic)
 * to avoid expensive recursive normalization.
 */
export function createMetricHash(metric: Metric): string {
  // Fast path for BaseMetric (most common type)
  // These have: date, qty, units, source, and optionally metadata
  const baseMetric = metric as MetricCommon & { qty?: number; units?: string };
  if (
    baseMetric.qty !== undefined &&
    baseMetric.units !== undefined &&
    !('systolic' in metric) &&
    !('Avg' in metric) &&
    !('asleep' in metric)
  ) {
    // Construct a deterministic hash string directly
    const date = new Date(baseMetric.date).toISOString();
    const source = baseMetric.source ?? '';
    const metadata = baseMetric.metadata ? JSON.stringify(baseMetric.metadata) : '';
    return `${date}|${source}|${String(baseMetric.qty)}|${baseMetric.units}|${metadata}`;
  }

  // Slow path for complex metrics (blood pressure, heart rate, sleep)
  const normalized = normalizeValue(metric);
  return JSON.stringify(normalized);
}

/**
 * Create a metric identity key for upsert operations.
 * Identity is based on date + source + metricType, WITHOUT the value.
 * This allows the same metric to be updated when Apple Health sends revised values.
 *
 * Identity rules:
 * - BaseMetric: date|source|metricType
 * - Sleep: sleepStart|source|sleep (unique per sleep session)
 * - HeartRate/BloodPressure: date|source|metricType
 */
export function createMetricIdentityKey(metric: Metric, metricType: string): string {
  const common = metric as MetricCommon;
  const source = common.source ?? '';

  // Sleep metrics use sleepStart as the unique identifier for the session
  if ('sleepStart' in metric) {
    const sleepStart = new Date(metric.sleepStart).toISOString();
    return `${sleepStart}|${source}|sleep`;
  }

  // All other metrics use date
  const date = new Date(common.date).toISOString();
  return `${date}|${source}|${metricType}`;
}

/**
 * Extract unique date keys from metrics using sourceDate.
 * Returns dates in YYYY-MM-DD format based on the original data's local date.
 */
export function extractDatesFromMetrics(metricsByType: Record<string, Metric[]>): string[] {
  const dates = new Set<string>();

  for (const metrics of Object.values(metricsByType)) {
    for (const metric of metrics) {
      dates.add((metric as MetricCommon).sourceDate);
    }
  }

  return [...dates];
}

/**
 * Extract unique date keys from workouts using sourceDate.
 * Returns dates in YYYY-MM-DD format based on the original data's local date.
 */
export function extractDatesFromWorkouts(workouts: WorkoutData[]): string[] {
  const dates = new Set<string>();

  for (const workout of workouts) {
    dates.add(workout.sourceDate);
  }

  return [...dates];
}

/**
 * Filter metrics to remove exact duplicates that exist in cache.
 * Returns only genuinely new metrics.
 *
 * Uses a separate Set for within-batch deduplication to avoid
 * memory leaks from modifying the cache hash set.
 */
export function filterDuplicateMetrics(
  incoming: Record<string, Metric[]>,
  cachedData: Map<string, MetricDailyFile>,
): {
  duplicateCount: number;
  newCount: number;
  newMetrics: Record<string, Metric[]>;
} {
  const existingHashes = buildMetricHashSet(cachedData);
  // Separate set for within-batch deduplication to avoid memory leak
  const batchHashes = new Set<string>();
  const newMetrics: Record<string, Metric[]> = {};
  let duplicateCount = 0;
  let newCount = 0;

  for (const [metricType, metrics] of Object.entries(incoming)) {
    const filtered: Metric[] = [];

    for (const metric of metrics) {
      const hash = createMetricHash(metric);
      if (existingHashes.has(hash) || batchHashes.has(hash)) {
        duplicateCount++;
      } else {
        filtered.push(metric);
        // Add to batch set to prevent duplicates within same batch
        // (don't modify existingHashes - that would cause memory leak)
        batchHashes.add(hash);
        newCount++;
      }
    }

    if (filtered.length > 0) {
      newMetrics[metricType] = filtered;
    }
  }

  return { duplicateCount, newCount, newMetrics };
}

/**
 * Filter workouts to remove those already in cache.
 * Uses workoutId as the unique identifier.
 *
 * Uses a separate Set for within-batch deduplication to avoid
 * memory leaks from modifying the cache ID set.
 */
export function filterDuplicateWorkouts(
  incoming: WorkoutData[],
  cachedData: Map<string, WorkoutDailyFile>,
): {
  duplicateCount: number;
  newCount: number;
  newWorkouts: WorkoutData[];
} {
  const existingIds = buildWorkoutIdSet(cachedData);
  // Separate set for within-batch deduplication to avoid memory leak
  const batchIds = new Set<string>();
  const newWorkouts: WorkoutData[] = [];
  let duplicateCount = 0;

  for (const workout of incoming) {
    if (existingIds.has(workout.id) || batchIds.has(workout.id)) {
      duplicateCount++;
    } else {
      newWorkouts.push(workout);
      // Add to batch set to prevent duplicates within same batch
      // (don't modify existingIds - that would cause memory leak)
      batchIds.add(workout.id);
    }
  }

  return {
    duplicateCount,
    newCount: newWorkouts.length,
    newWorkouts,
  };
}

/**
 * Normalize a value for deterministic JSON stringification.
 * - Converts Dates to ISO strings
 * - Sorts object keys alphabetically
 * - Handles nested structures recursively
 */
function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  // Handle Date objects
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Handle strings that look like dates
  if (typeof value === 'string') {
    // Check if it's an ISO date string and normalize it
    if (value.includes('T') && value.includes('-')) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
    return value;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  // Handle objects (sort keys for deterministic output)
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value);

    keys.sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      sorted[key] = normalizeValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  // Primitives (numbers, booleans) pass through unchanged
  return value;
}
