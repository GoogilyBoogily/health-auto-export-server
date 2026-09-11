import { prepareWorkouts } from '../mappers';
import { WorkoutDataSchema } from '../validation/schemas';

import type { IngestData, WorkoutData } from '../types';
import type { Logger } from '../utils/logger';

/**
 * Result of preparing workouts for storage.
 */
export interface WorkoutsPrepResult {
  newCount: number;
  newWorkouts: WorkoutData[];
  skippedRecords: number;
}

/**
 * Validate workouts one at a time.
 * A malformed workout is dropped and counted rather than failing the whole request, so one
 * bad entry cannot discard the others in the same payload.
 */
function validateWorkouts(
  rawWorkouts: unknown[],
  log?: Logger,
): { skipped: number; valid: WorkoutData[] } {
  const valid: WorkoutData[] = [];
  let skipped = 0;

  for (const candidate of rawWorkouts) {
    const parsed = WorkoutDataSchema.safeParse(candidate);
    if (parsed.success) {
      valid.push(parsed.data as unknown as WorkoutData);
      continue;
    }

    skipped++;
    log?.warn('Skipping malformed workout', {
      id: (candidate as null | { id?: unknown })?.id,
      issues: parsed.error.issues.slice(0, 3),
    });
  }

  return { skipped, valid };
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

  const { skipped: skippedRecords, valid } = validateWorkouts(rawWorkouts, log);

  // Extract sourceDate from raw date strings before any Date conversion
  const workouts = prepareWorkouts(valid);

  log?.debug('Processing workouts', { count: workouts.length, skippedRecords });

  // Debug: Log raw workouts input
  log?.debugLog('TRANSFORM', 'Raw workouts input', {
    workoutsCount: workouts.length,
    workoutSummary: workouts.map((w) => ({
      date: w.start,
      duration: w.duration,
      name: w.name,
      workoutId: w.id,
    })),
  });

  timer?.end('info', 'Workouts prepared', { newCount: workouts.length, skippedRecords });

  return { newCount: workouts.length, newWorkouts: workouts, skippedRecords };
};
