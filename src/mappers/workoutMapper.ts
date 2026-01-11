/**
 * Workout data transformation utilities.
 * Transforms raw workout data from the API into typed workout objects.
 */

import type { IRoute, WorkoutData } from '../types';

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
