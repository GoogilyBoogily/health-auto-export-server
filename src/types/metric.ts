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

export type Metric = BaseMetric | BloodPressureMetric | HeartRateMetric | SleepMetric;

/**
 * Common fields shared by all metric types.
 * Used for deduplication (date + source) and type-safe access.
 */
export interface MetricCommon {
  date: Date;
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
  totalSleep?: number;
}

/**
 * Raw sleep segment from Health Auto Export API.
 * Each entry represents a single sleep stage transition.
 */
export interface SleepSegmentRaw {
  endDate: string;
  qty: number;
  startDate: string;
  value: 'Awake' | 'Core' | 'Deep' | 'REM';
  source?: string;
}

/**
 * Sleep stage value types from Health Auto Export.
 */
export type SleepStageValue = 'Awake' | 'Core' | 'Deep' | 'REM';
