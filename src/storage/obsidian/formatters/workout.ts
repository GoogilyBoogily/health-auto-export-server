/**
 * Workout data formatter.
 * Transforms workout data into Obsidian workout tracking frontmatter.
 */

import { logger } from '../../../utils/logger';
import {
  formatIsoTimestamp,
  getDateKey,
  getMonthKey,
  getWeekKey,
  parseDateKey,
  roundTo,
} from '../utils/dateUtilities';

import type {
  HeartRateReading,
  RecoveryReading,
  WorkoutData,
  WorkoutEntry,
  WorkoutFrontmatter,
} from '../../../types';

/**
 * Create workout frontmatter from workouts for a specific date.
 */
export function createWorkoutFrontmatter(
  dateKey: string,
  workouts: WorkoutData[],
  existing?: WorkoutFrontmatter,
): WorkoutFrontmatter {
  const date = parseDateKey(dateKey);

  // Convert workouts to entries
  const newEntries = workouts.map((workout) => workoutToEntry(workout));

  // Merge with existing entries (dedup by appleWorkoutId - the unique workout identifier)
  let allEntries: WorkoutEntry[];
  if (existing?.workoutEntries) {
    const existingMap = new Map(
      existing.workoutEntries.map((entry) => [entry.appleWorkoutId, entry]),
    );
    for (const entry of newEntries) {
      existingMap.set(entry.appleWorkoutId, entry);
    }
    allEntries = [...existingMap.values()];
  } else {
    allEntries = newEntries;
  }

  // Sort entries by start time
  allEntries.sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Calculate aggregates
  const workoutCount = allEntries.length;
  const totalDuration = allEntries.reduce((sum, entry) => sum + entry.duration, 0);
  const totalActiveEnergy = roundTo(
    allEntries.reduce((sum, entry) => sum + (entry.activeEnergy ?? 0), 0),
    2,
  );
  const totalDistance = roundTo(
    allEntries.reduce((sum, entry) => sum + (entry.distance ?? 0), 0),
    2,
  );
  const totalSteps = allEntries.reduce((sum, entry) => sum + (entry.stepCount ?? 0), 0);

  // Calculate heart rate aggregates
  const entriesWithHr = allEntries.filter((entry) => entry.avgHeartRate !== undefined);
  const avgHeartRate =
    entriesWithHr.length > 0
      ? Math.round(
          entriesWithHr.reduce((sum, entry) => sum + (entry.avgHeartRate ?? 0), 0) /
            entriesWithHr.length,
        )
      : undefined;
  const maxHeartRate =
    entriesWithHr.length > 0
      ? Math.max(...entriesWithHr.map((entry) => entry.maxHeartRate ?? 0))
      : undefined;

  // Count by workout type
  const typeCounts: Record<string, number> = {};
  for (const entry of allEntries) {
    const key = `workout_${entry.workoutId}_count` as const;
    typeCounts[key] = (typeCounts[key] ?? 0) + 1;
  }

  const frontmatter: WorkoutFrontmatter = {
    date: dateKey,
    monthKey: getMonthKey(date),
    type: 'workout',
    weekKey: getWeekKey(date),
    workoutCount,
    workoutEntries: allEntries,
    ...typeCounts,
  };

  // Add aggregates only if there are values
  if (totalDuration > 0) frontmatter.totalDuration = totalDuration;
  if (totalActiveEnergy > 0) frontmatter.totalActiveEnergy = totalActiveEnergy;
  if (totalDistance > 0) frontmatter.totalDistance = totalDistance;
  if (totalSteps > 0) frontmatter.totalSteps = totalSteps;
  if (avgHeartRate !== undefined) frontmatter.avgHeartRate = avgHeartRate;
  if (maxHeartRate !== undefined && maxHeartRate > 0) frontmatter.maxHeartRate = maxHeartRate;

  logger.debugLog('TRANSFORM', 'Workout frontmatter created with merge', {
    dateKey,
    existingEntryCount: existing?.workoutEntries.length ?? 0,
    finalEntryCount: allEntries.length,
    newWorkoutCount: workouts.length,
    totals: {
      activeEnergy: totalActiveEnergy,
      distance: totalDistance,
      duration: totalDuration,
      steps: totalSteps,
    },
  });

  return frontmatter;
}

/**
 * Group workouts by start date.
 */
export function groupWorkoutsByDate(workouts: WorkoutData[]): Map<string, WorkoutData[]> {
  const byDate = new Map<string, WorkoutData[]>();

  for (const workout of workouts) {
    const dateKey = getDateKey(workout.start);
    let dateWorkouts = byDate.get(dateKey);
    if (!dateWorkouts) {
      dateWorkouts = [];
      byDate.set(dateKey, dateWorkouts);
    }
    dateWorkouts.push(workout);
  }

  logger.debugLog('TRANSFORM', 'Workouts grouped by date', {
    dateKeys: [...byDate.keys()],
    datesWithWorkouts: byDate.size,
    totalWorkouts: workouts.length,
    workoutsPerDate: Object.fromEntries([...byDate.entries()].map(([k, v]) => [k, v.length])),
  });

  return byDate;
}

/**
 * Merge new workout data with existing frontmatter.
 */
export function mergeWorkoutFrontmatter(
  existing: WorkoutFrontmatter,
  newWorkouts: WorkoutData[],
): WorkoutFrontmatter {
  return createWorkoutFrontmatter(existing.date, newWorkouts, existing);
}

/**
 * Calculate heart rate recovery drop at specified minutes after workout end.
 * Returns the drop from maxHeartRate to HR at that time.
 */
function calculateRecoveryDrop(
  workout: WorkoutData,
  maxHeartRate: number | undefined,
  targetMinutes: number,
): number | undefined {
  if (
    !workout.heartRateRecovery ||
    workout.heartRateRecovery.length === 0 ||
    maxHeartRate === undefined
  ) {
    return undefined;
  }

  const endTime = new Date(workout.end).getTime();
  const targetTime = endTime + targetMinutes * 60 * 1000;

  // Find the reading closest to the target time
  let closestReading = workout.heartRateRecovery[0];
  let closestDiff = Math.abs(new Date(closestReading.date).getTime() - targetTime);

  for (const reading of workout.heartRateRecovery) {
    const readingTime = new Date(reading.date).getTime();
    const diff = Math.abs(readingTime - targetTime);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestReading = reading;
    }
  }

  // Only use if within 30 seconds of target
  if (closestDiff > 30_000) {
    return undefined;
  }

  const recoveryHr = Math.round(closestReading.Avg);
  return maxHeartRate - recoveryHr;
}

/**
 * Extract heart rate readings array from workout data.
 * Converts per-minute HR data to HeartRateReading format.
 */
function extractHeartRateReadings(workout: WorkoutData): HeartRateReading[] | undefined {
  if (!workout.heartRateData || workout.heartRateData.length === 0) {
    return undefined;
  }

  return workout.heartRateData.map((hr) => ({
    avg: Math.round(hr.Avg),
    max: Math.round(hr.Max),
    min: Math.round(hr.Min),
    time: formatIsoTimestamp(hr.date) ?? '',
  }));
}

/**
 * Extract heart rate values from workout data.
 * Priority: pre-computed fields > nested summary > calculated from array
 */
function extractHeartRateValues(workout: WorkoutData): {
  avg?: number;
  max?: number;
  min?: number;
} {
  const result: { avg?: number; max?: number; min?: number } = {};
  const hrData = workout.heartRateData;
  const hasHrData = hrData && hrData.length > 0;

  // Track which source was used for debug logging
  let avgSource: string | undefined;
  let maxSource: string | undefined;
  let minSource: string | undefined;

  // Average heart rate
  if (workout.avgHeartRate?.qty !== undefined) {
    result.avg = Math.round(workout.avgHeartRate.qty);
    avgSource = 'avgHeartRate field';
  } else if (workout.heartRate?.avg?.qty !== undefined) {
    result.avg = Math.round(workout.heartRate.avg.qty);
    avgSource = 'heartRate.avg nested';
  } else if (hasHrData) {
    result.avg = Math.round(hrData.reduce((sum, hr) => sum + hr.Avg, 0) / hrData.length);
    avgSource = 'heartRateData array';
  }

  // Max heart rate
  if (workout.maxHeartRate?.qty !== undefined) {
    result.max = Math.round(workout.maxHeartRate.qty);
    maxSource = 'maxHeartRate field';
  } else if (workout.heartRate?.max?.qty !== undefined) {
    result.max = Math.round(workout.heartRate.max.qty);
    maxSource = 'heartRate.max nested';
  } else if (hasHrData) {
    result.max = Math.round(Math.max(...hrData.map((hr) => hr.Max)));
    maxSource = 'heartRateData array';
  }

  // Min heart rate
  if (workout.heartRate?.min?.qty !== undefined) {
    result.min = Math.round(workout.heartRate.min.qty);
    minSource = 'heartRate.min nested';
  } else if (hasHrData) {
    result.min = Math.round(Math.min(...hrData.map((hr) => hr.Min)));
    minSource = 'heartRateData array';
  }

  if (result.avg !== undefined || result.max !== undefined) {
    logger.debugLog('TRANSFORM', 'Heart rate values extracted', {
      heartRateDataPoints: hrData?.length ?? 0,
      sources: { avg: avgSource, max: maxSource, min: minSource },
      values: result,
      workoutName: workout.name,
    });
  }

  return result;
}

/**
 * Extract recovery readings array from workout data.
 * Converts post-workout HR recovery data to RecoveryReading format.
 */
function extractRecoveryReadings(workout: WorkoutData): RecoveryReading[] | undefined {
  if (!workout.heartRateRecovery || workout.heartRateRecovery.length === 0) {
    return undefined;
  }

  return workout.heartRateRecovery.map((hr) => ({
    time: formatIsoTimestamp(hr.date) ?? '',
    value: Math.round(hr.Avg),
  }));
}

/**
 * Add optional scalar fields to a workout entry.
 */
function populateOptionalFields(entry: WorkoutEntry, workout: WorkoutData): void {
  // Add energy/distance
  if (workout.activeEnergyBurned?.qty) {
    entry.activeEnergy = roundTo(workout.activeEnergyBurned.qty, 2);
  }
  if (workout.distance?.qty) {
    entry.distance = roundTo(workout.distance.qty, 2);
  }

  // Add step data
  if (workout.stepCount && workout.stepCount.length > 0) {
    entry.stepCount = Math.round(workout.stepCount.reduce((sum, s) => sum + s.qty, 0));
  }
  if (workout.stepCadence?.qty !== undefined) {
    entry.stepCadence = roundTo(workout.stepCadence.qty, 1);
  }

  // Add intensity
  if (workout.intensity?.qty !== undefined) {
    entry.intensity = roundTo(workout.intensity.qty, 2);
  }

  // Add environmental data
  if (workout.temperature?.qty !== undefined) {
    entry.temperature = roundTo(workout.temperature.qty, 1);
  }
  if (workout.humidity?.qty !== undefined) {
    entry.humidity = Math.round(workout.humidity.qty);
  }

  // Add location info
  if (workout.location !== undefined) {
    entry.location = workout.location;
  }
  if (workout.isIndoor !== undefined) {
    entry.isIndoor = workout.isIndoor;
  }
}

/**
 * Convert workout name to kebab-case ID.
 */
function toWorkoutId(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      // eslint-disable-next-line sonarjs/anchor-precedence -- Intentional: match either start-dash or dash-end
      .replaceAll(/^-|-$/g, '')
  );
}

/**
 * Convert a single workout to a WorkoutEntry.
 */
function workoutToEntry(workout: WorkoutData): WorkoutEntry {
  const entry: WorkoutEntry = {
    appleWorkoutId: workout.id,
    duration: Math.round(workout.duration / 60), // seconds to minutes
    endTime: formatIsoTimestamp(workout.end) ?? '',
    startTime: formatIsoTimestamp(workout.start) ?? '',
    workoutId: toWorkoutId(workout.name),
    workoutType: workout.name,
  };

  // Extract heart rate summary values
  const hrValues = extractHeartRateValues(workout);
  if (hrValues.avg !== undefined) entry.avgHeartRate = hrValues.avg;
  if (hrValues.max !== undefined) entry.maxHeartRate = hrValues.max;
  if (hrValues.min !== undefined) entry.minHeartRate = hrValues.min;

  // Extract heart rate readings array
  const heartRateReadings = extractHeartRateReadings(workout);
  if (heartRateReadings && heartRateReadings.length > 0) {
    entry.heartRateReadings = heartRateReadings;
  }

  // Extract recovery readings and calculate recovery drops
  const recoveryReadings = extractRecoveryReadings(workout);
  if (recoveryReadings && recoveryReadings.length > 0) {
    entry.recoveryReadings = recoveryReadings;
    const recovery1Min = calculateRecoveryDrop(workout, hrValues.max, 1);
    const recovery2Min = calculateRecoveryDrop(workout, hrValues.max, 2);
    if (recovery1Min !== undefined) entry.heartRateRecovery1Min = recovery1Min;
    if (recovery2Min !== undefined) entry.heartRateRecovery2Min = recovery2Min;
  }

  // Populate other optional fields
  populateOptionalFields(entry, workout);

  logger.debugTransform(
    'Workout transformed to entry',
    {
      durationSeconds: workout.duration,
      name: workout.name,
      sourceId: workout.id,
    },
    {
      activeEnergy: entry.activeEnergy,
      distance: entry.distance,
      durationMinutes: entry.duration,
      heartRate: hrValues.avg === undefined ? undefined : hrValues,
      heartRateReadings: heartRateReadings?.length ?? 0,
      intensity: entry.intensity,
      recovery1Min: entry.heartRateRecovery1Min,
      recovery2Min: entry.heartRateRecovery2Min,
      recoveryReadings: recoveryReadings?.length ?? 0,
      workoutId: entry.workoutId,
    },
  );

  return entry;
}
