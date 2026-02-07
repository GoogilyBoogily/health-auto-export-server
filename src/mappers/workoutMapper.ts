/**
 * Workout data transformation utilities.
 * Transforms raw workout data from the API into typed workout objects.
 */

import type { IRoute, WorkoutData } from '../types';

const DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})/;

export function mapRoute(data: WorkoutData): IRoute {
  return {
    locations:
      data.route?.map((loc) => ({
        ...loc,
        timestamp: new Date(loc.timestamp),
      })) ?? [],
    workoutId: data.id,
  };
}

export function mapWorkoutData(data: WorkoutData) {
  // Exclude route from workout data - it's stored separately
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- route is intentionally excluded
  const { id, route, ...rest } = data;

  return {
    workoutId: id,
    ...rest,
    end: new Date(rest.end),
    start: new Date(rest.start),
  };
}

/**
 * Enrich raw workout data with sourceDate extracted from the start date string.
 * Must be called before start/end are converted to Date objects.
 */
export function prepareWorkouts(workouts: WorkoutData[]): WorkoutData[] {
  return workouts.map((w) => ({
    ...w,
    sourceDate: extractSourceDate(w.start),
  }));
}

/**
 * Extract the local date (YYYY-MM-DD) from a raw date value.
 * For strings, regex-extracts the date prefix to preserve the user's local date.
 * For Date objects, falls back to server-local extraction.
 */
function extractSourceDate(dateValue: Date | string): string {
  if (typeof dateValue === 'string') {
    const match = DATE_PREFIX_REGEX.exec(dateValue);
    if (match) return match[1];
  }
  const d = new Date(dateValue);
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
