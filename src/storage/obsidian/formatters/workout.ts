/**
 * Workout data formatter.
 * Transforms workout data into Obsidian workout tracking frontmatter.
 */

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

  // Process heart rate data
  if (workout.heartRateData && workout.heartRateData.length > 0) {
    const hrData = workout.heartRateData;
    entry.avgHeartRate = Math.round(hrData.reduce((sum, hr) => sum + hr.Avg, 0) / hrData.length);
    entry.maxHeartRate = Math.round(Math.max(...hrData.map((hr) => hr.Max)));
    entry.minHeartRate = Math.round(Math.min(...hrData.map((hr) => hr.Min)));
  }

  // Process step count
  if (workout.stepCount && workout.stepCount.length > 0) {
    entry.stepCount = Math.round(workout.stepCount.reduce((sum, s) => sum + s.qty, 0));
  }

  return entry;
}
