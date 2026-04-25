/**
 * Workout data transformation utilities.
 * Transforms raw workout data from the API into typed workout objects.
 */

import type { WorkoutData } from '../types';

const DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})/;

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
