/**
 * Centralized type exports.
 * All type definitions are exported from this index for consistent imports.
 */

// Ingest types
export type { IngestData, IngestResponse } from './ingest';

// Metric types
export type {
  BaseMetric,
  BloodPressureMetric,
  HeartRateMetric,
  Metric,
  MetricCommon,
  MetricData,
  SleepMetric,
  SleepSegment,
  SleepSegmentRaw,
  SleepStage,
  SleepStageValue,
  WristTemperatureMetric,
} from './metric';

// Metric name enum
export { MetricName } from './metricName';

// Obsidian types
export type {
  BloodPressureReading,
  HealthFrontmatter,
  HeartRateHealthReading,
  HeartRateReading,
  MarkdownFile,
  MetricReading,
  ObsidianFrontmatter,
  RecoveryReading,
  SleepFrontmatter,
  SleepStageEntry,
  TrackingType,
  WorkoutEntry,
  WorkoutFrontmatter,
} from './obsidian';

// Storage types
export type {
  MetricDailyFile,
  QueryOptions,
  SaveResult,
  StoredRoute,
  StoredWorkout,
  WorkoutDailyFile,
} from './storage';

// Workout types
export type {
  IHeartRate,
  ILocation,
  IMeasurement,
  IQuantityMetric,
  IRoute,
  WorkoutData,
} from './workout';
