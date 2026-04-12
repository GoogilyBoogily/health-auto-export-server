import { prepareWorkouts } from '../mappers';

import type { IngestData, WorkoutData } from '../types';
import type { Logger } from '../utils/logger';

/**
 * Result of preparing workouts for storage.
 */
export interface WorkoutsPrepResult {
  newCount: number;
  newWorkouts: WorkoutData[];
}

/**
 * Prepare workouts: map raw data to internal format.
 * Returns prepared data without writing to any storage.
 * Deduplication is handled by the Obsidian formatter during merge (by appleWorkoutId).
 */
export const prepareWorkoutsData = (
  ingestData: IngestData,
  log?: Logger,
): WorkoutsPrepResult | undefined => {
  const timer = log?.startTimer('prepareWorkouts');

  const rawWorkouts = ingestData.data.workouts;

  if (!rawWorkouts || rawWorkouts.length === 0) {
    log?.debug('No workout data provided');
    timer?.end('info', 'No workouts to prepare');
    return undefined;
  }

  // Extract sourceDate from raw date strings before any Date conversion
  const workouts = prepareWorkouts(rawWorkouts);

  log?.debug('Processing workouts', { count: workouts.length });

  // Debug: Log raw workouts input
  log?.debugLog('TRANSFORM', 'Raw workouts input', {
    workoutsCount: workouts.length,
    workoutSummary: workouts.map((w) => ({
      date: w.start,
      duration: w.duration,
      name: w.name,
      workoutId: (w as { id?: string }).id,
    })),
  });

  timer?.end('info', 'Workouts prepared', { newCount: workouts.length });

  return { newCount: workouts.length, newWorkouts: workouts };
};
