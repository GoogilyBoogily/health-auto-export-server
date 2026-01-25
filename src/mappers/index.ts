/**
 * Data mapper exports.
 * Functions for transforming raw API data into typed objects.
 */

export {
  createMappingContext,
  flushValidationStats,
  logValidationWarning,
  mapMetric,
} from './metricMapper';
export type { MappingContext } from './metricMapper';
export { mapRoute, mapWorkoutData } from './workoutMapper';
