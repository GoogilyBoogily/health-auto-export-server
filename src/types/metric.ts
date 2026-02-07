/**
 * Metric type definitions.
 * Types for health metrics data structures from Apple Health.
 */

import type { MetricName } from './metricName';

export interface BaseMetric extends MetricCommon {
  qty: number;
  units: string;
}

export interface BloodPressureMetric extends MetricCommon {
  diastolic: number;
  systolic: number;
  units: string;
}

export interface HeartRateMetric extends MetricCommon {
  Avg: number;
  Max: number;
  Min: number;
  units: string;
}

export type Metric =
  | BaseMetric
  | BloodPressureMetric
  | HeartRateMetric
  | SleepMetric
  | WristTemperatureMetric;

/**
 * Common fields shared by all metric types.
 * Used for deduplication (date + source) and type-safe access.
 */
export interface MetricCommon {
  date: Date;
  sourceDate: string; // YYYY-MM-DD extracted from raw date string before timezone conversion
  metadata?: Record<string, string>;
  source?: string;
}

export interface MetricData {
  data: Metric[];
  name: MetricName | string;
  units: string;
}

export interface SleepMetric extends MetricCommon {
  awake: number;
  core: number;
  deep: number;
  inBed: number;
  inBedEnd: Date;
  inBedStart: Date;
  rem: number;
  sleepEnd: Date;
  sleepStart: Date;
  units: string;
  asleep?: number;
  segmentCount?: number;
  segments?: SleepSegment[];
  totalSleep?: number;
}

/**
 * Processed sleep segment with typed stage and Date objects.
 * Used for preserving individual sleep stages in the output.
 */
export interface SleepSegment {
  duration: number; // hours
  endTime: Date;
  stage: SleepStage;
  startTime: Date;
  source?: string;
}

/**
 * Raw sleep segment from Health Auto Export API.
 * Each entry represents a single sleep stage transition.
 */
export interface SleepSegmentRaw {
  endDate: string;
  qty: number;
  startDate: string;
  value: 'Asleep' | 'Awake' | 'Core' | 'Deep' | 'In Bed' | 'REM';
  source?: string;
}

/**
 * Lowercase sleep stage types for output formatting.
 */
export type SleepStage = 'asleep' | 'awake' | 'core' | 'deep' | 'rem';

/**
 * Sleep stage value types from Health Auto Export.
 */
export type SleepStageValue = 'Asleep' | 'Awake' | 'Core' | 'Deep' | 'In Bed' | 'REM';

/**
 * Wrist temperature metric from Apple Watch during sleep.
 * Includes end date for accurate night attribution.
 */
export interface WristTemperatureMetric extends MetricCommon {
  endDate: Date; // End of measurement period (morning after sleep)
  qty: number;
  units: string;
}
