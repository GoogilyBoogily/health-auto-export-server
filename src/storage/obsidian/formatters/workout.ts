/**
 * Workout data formatter.
 * Transforms workout data into Obsidian workout tracking frontmatter.
 */

import { logger } from '../../../utils/logger';
import {
  formatTime,
  getDateKey,
  getMonthKey,
  getWeekKey,
  parseDateKey,
  roundTo,
} from '../utils/dateUtilities';

import type { WorkoutData, WorkoutEntry, WorkoutFrontmatter } from '../../../types';

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

  // Merge with existing entries (dedup by sourceId - the unique workout identifier)
  let allEntries: WorkoutEntry[];
  if (existing?.workoutEntries) {
    const existingMap = new Map(existing.workoutEntries.map((entry) => [entry.sourceId, entry]));
    for (const entry of newEntries) {
      existingMap.set(entry.sourceId, entry);
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
    duration: Math.round(workout.duration / 60), // seconds to minutes
    endTime: formatTime(workout.end) ?? '',
    sourceId: workout.id,
    startTime: formatTime(workout.start) ?? '',
    workoutId: toWorkoutId(workout.name),
    workoutType: workout.name,
  };

  // Add optional fields
  if (workout.activeEnergyBurned?.qty) {
    entry.activeEnergy = roundTo(workout.activeEnergyBurned.qty, 2);
  }

  if (workout.distance?.qty) {
    entry.distance = roundTo(workout.distance.qty, 2);
  }

  // Extract heart rate values
  const hrValues = extractHeartRateValues(workout);
  if (hrValues.avg !== undefined) entry.avgHeartRate = hrValues.avg;
  if (hrValues.max !== undefined) entry.maxHeartRate = hrValues.max;
  if (hrValues.min !== undefined) entry.minHeartRate = hrValues.min;

  // Process step count
  if (workout.stepCount && workout.stepCount.length > 0) {
    entry.stepCount = Math.round(workout.stepCount.reduce((sum, s) => sum + s.qty, 0));
  }

  // Add step cadence if available
  if (workout.stepCadence?.qty !== undefined) {
    entry.stepCadence = roundTo(workout.stepCadence.qty, 2);
  }

  // Add location info if available
  if (workout.location !== undefined) {
    entry.location = workout.location;
  }

  if (workout.isIndoor !== undefined) {
    entry.isIndoor = workout.isIndoor;
  }

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
      workoutId: entry.workoutId,
    },
  );

  return entry;
}
