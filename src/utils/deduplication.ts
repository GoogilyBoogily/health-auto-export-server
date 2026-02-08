import { formatIsoTimestamp } from '../storage/obsidian/utils/dateUtilities';
import { snakeToCamelCase } from './stringUtilities';

import type {
  BaseMetric,
  HealthFrontmatter,
  Metric,
  MetricCommon,
  SleepFrontmatter,
  SleepMetric,
  WorkoutData,
  WorkoutFrontmatter,
} from '../types';

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
 * Filter metrics to remove duplicates that already exist in Obsidian frontmatter.
 * Compares by timestamp per metric type — if a reading with the same time exists, it's a duplicate.
 *
 * This is an optimization, not a correctness requirement. The Obsidian formatter
 * already upserts by timestamp, so passing a duplicate through would simply
 * result in an identical file write.
 */
export function filterDuplicateMetrics(
  incoming: Record<string, Metric[]>,
  existingFrontmatter: Map<string, HealthFrontmatter>,
): {
  duplicateCount: number;
  newCount: number;
  newMetrics: Record<string, Metric[]>;
} {
  const existingTimestamps = buildExistingTimestamps(existingFrontmatter);
  const batchTimestamps = new Map<string, Set<string>>();
  const newMetrics: Record<string, Metric[]> = {};
  let duplicateCount = 0;
  let newCount = 0;

  for (const [metricType, metrics] of Object.entries(incoming)) {
    const camelKey = snakeToCamelCase(metricType);
    const existingTimes = existingTimestamps.get(camelKey);
    let batchTimes = batchTimestamps.get(camelKey);
    if (!batchTimes) {
      batchTimes = new Set<string>();
      batchTimestamps.set(camelKey, batchTimes);
    }

    const filtered: Metric[] = [];

    for (const metric of metrics) {
      const time = formatIsoTimestamp((metric as BaseMetric).date) ?? '';

      if ((existingTimes?.has(time) ?? false) || batchTimes.has(time)) {
        duplicateCount++;
      } else {
        filtered.push(metric);
        batchTimes.add(time);
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
 * Filter sleep metrics to remove duplicates that already exist in Obsidian frontmatter.
 * Compares by segment startTime — if all segments from a sleep entry already exist, it's a duplicate.
 *
 * Like health dedup, this is an optimization. The sleep formatter replaces all data
 * for a date, so passing a duplicate through results in an identical file write.
 */
export function filterDuplicateSleepMetrics(
  incomingSleepMetrics: SleepMetric[],
  existingFrontmatter: Map<string, SleepFrontmatter>,
): {
  duplicateCount: number;
  newCount: number;
  newSleepMetrics: SleepMetric[];
} {
  const existingStartTimes = buildExistingSleepStartTimes(existingFrontmatter);
  const newSleepMetrics: SleepMetric[] = [];
  let duplicateCount = 0;

  for (const metric of incomingSleepMetrics) {
    const existingTimes = existingStartTimes.get(metric.sourceDate);

    if (!existingTimes || !metric.segments || metric.segments.length === 0) {
      newSleepMetrics.push(metric);
      continue;
    }

    const allExist = metric.segments.every((segment) => {
      const isoTime = formatIsoTimestamp(segment.startTime);
      return isoTime ? existingTimes.has(isoTime) : false;
    });

    if (allExist) {
      duplicateCount++;
    } else {
      newSleepMetrics.push(metric);
    }
  }

  return {
    duplicateCount,
    newCount: newSleepMetrics.length,
    newSleepMetrics,
  };
}

/**
 * Filter workouts to remove those already in Obsidian frontmatter.
 * Compares by appleWorkoutId — if an entry with the same ID exists, it's a duplicate.
 */
export function filterDuplicateWorkouts(
  incoming: WorkoutData[],
  existingFrontmatter: Map<string, WorkoutFrontmatter>,
): {
  duplicateCount: number;
  newCount: number;
  newWorkouts: WorkoutData[];
} {
  const existingIds = buildExistingWorkoutIds(existingFrontmatter);
  const batchIds = new Set<string>();
  const newWorkouts: WorkoutData[] = [];
  let duplicateCount = 0;

  for (const workout of incoming) {
    if (existingIds.has(workout.id) || batchIds.has(workout.id)) {
      duplicateCount++;
    } else {
      newWorkouts.push(workout);
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
 * Extract timestamps from an array of readings and add them to the timestamps map.
 */
function addTimestampsFromReadings(
  timestampsByType: Map<string, Set<string>>,
  key: string,
  readings: unknown[],
): void {
  let existing = timestampsByType.get(key);
  if (!existing) {
    existing = new Set<string>();
    timestampsByType.set(key, existing);
  }
  for (const reading of readings) {
    if (typeof reading === 'object' && reading !== null && 'time' in reading) {
      existing.add((reading as { time: string }).time);
    }
  }
}

/**
 * Build a set of existing sleep stage startTimes per date from sleep frontmatter.
 */
function buildExistingSleepStartTimes(
  existingFrontmatter: Map<string, SleepFrontmatter>,
): Map<string, Set<string>> {
  const startTimesByDate = new Map<string, Set<string>>();

  for (const [dateKey, frontmatter] of existingFrontmatter) {
    if (frontmatter.sleepStages) {
      const times = new Set(frontmatter.sleepStages.map((stage) => stage.startTime));
      startTimesByDate.set(dateKey, times);
    }
  }

  return startTimesByDate;
}

/**
 * Build a set of existing timestamps per metric type from health frontmatter.
 */
function buildExistingTimestamps(
  existingFrontmatter: Map<string, HealthFrontmatter>,
): Map<string, Set<string>> {
  const timestampsByType = new Map<string, Set<string>>();

  for (const frontmatter of existingFrontmatter.values()) {
    for (const [key, value] of Object.entries(frontmatter)) {
      if (key === 'date' || key === 'type' || !Array.isArray(value)) continue;
      addTimestampsFromReadings(timestampsByType, key, value);
    }
  }

  return timestampsByType;
}

/**
 * Build a set of existing workout IDs from workout frontmatter.
 */
function buildExistingWorkoutIds(
  existingFrontmatter: Map<string, WorkoutFrontmatter>,
): Set<string> {
  const ids = new Set<string>();

  for (const frontmatter of existingFrontmatter.values()) {
    for (const entry of frontmatter.workoutEntries) {
      ids.add(entry.appleWorkoutId);
    }
  }

  return ids;
}
