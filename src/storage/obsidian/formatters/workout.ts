/**
 * Workout data formatter.
 * Transforms workout data into Obsidian workout tracking frontmatter.
 */

import { logger } from '../../../utils/logger';
import { formatIsoTimestamp, roundTo } from '../utils/dateUtilities';

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
  const newEntries = workouts.map((workout) => workoutToEntry(workout));

  // Merge with existing entries (dedup by appleWorkoutId)
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

  allEntries.sort((a, b) => a.startTime.localeCompare(b.startTime));

  logger.debugLog('TRANSFORM', 'Workout frontmatter created with merge', {
    dateKey,
    existingEntryCount: existing?.workoutEntries.length ?? 0,
    finalEntryCount: allEntries.length,
    newWorkoutCount: workouts.length,
  });

  return { date: dateKey, type: 'workout', workoutEntries: allEntries };
}

/**
 * Group workouts by start date.
 */
export function groupWorkoutsByDate(workouts: WorkoutData[]): Map<string, WorkoutData[]> {
  const byDate = new Map<string, WorkoutData[]>();

  for (const workout of workouts) {
    const dateKey = workout.sourceDate;
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

  // Add heart rate summaries
  if (workout.avgHeartRate?.qty !== undefined) {
    entry.avgHeartRate = Math.round(workout.avgHeartRate.qty);
  }
  if (workout.maxHeartRate?.qty !== undefined) {
    entry.maxHeartRate = Math.round(workout.maxHeartRate.qty);
  }
  if (workout.heartRate?.min?.qty !== undefined) {
    entry.minHeartRate = Math.round(workout.heartRate.min.qty);
  }

  // Add intensity
  if (workout.intensity?.qty !== undefined) {
    entry.intensity = roundTo(workout.intensity.qty, 2);
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

  // Extract raw heart rate readings
  const heartRateReadings = extractHeartRateReadings(workout);
  if (heartRateReadings && heartRateReadings.length > 0) {
    entry.heartRateReadings = heartRateReadings;
  }

  // Extract raw recovery readings
  const recoveryReadings = extractRecoveryReadings(workout);
  if (recoveryReadings && recoveryReadings.length > 0) {
    entry.recoveryReadings = recoveryReadings;
  }

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
      heartRateReadings: heartRateReadings?.length ?? 0,
      intensity: entry.intensity,
      recoveryReadings: recoveryReadings?.length ?? 0,
      workoutId: entry.workoutId,
    },
  );

  return entry;
}
