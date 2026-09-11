/**
 * Obsidian tracking file type definitions.
 * Types for YAML frontmatter in Obsidian markdown files.
 */

import type { Metric } from './metric';

// ===== HEALTH TRACKING =====

export interface BloodPressureReading {
  diastolic: number;
  systolic: number;
  time: string; // ISO timestamp with timezone
  units: string; // e.g. "mmHg" - the app's unit setting is a user preference, never assume
  source?: string;
}

/**
 * Unified daily tracking frontmatter.
 * Contains health metrics, sleep stages, workout entries, plus any
 * external data (moods, habits, weather, etc.) from other apps.
 */
export interface DailyFrontmatter {
  date: string; // YYYY-MM-DD
  sleepStages?: SleepStageEntry[];
  sleepSummary?: SleepSummary;
  workoutEntries?: WorkoutEntry[];
  [key: string]: unknown; // health metrics + external data preserved during merge
}

/**
 * Heart rate reading for health tracking (distinct from workout HeartRateReading).
 */
export interface HeartRateHealthReading {
  avg: number;
  max: number;
  min: number;
  time: string; // ISO timestamp with timezone
  units: string; // e.g. "count/min"
  source?: string;
}

// ===== WORKOUT TRACKING =====

/**
 * Heart rate reading during a workout (per-minute data).
 */
export interface HeartRateReading {
  avg: number;
  max: number;
  min: number;
  time: string; // ISO timestamp with timezone
}

export interface MetricReading {
  time: string; // ISO timestamp with timezone
  units: string; // e.g. "kcal", "mi", "mcg" - vitamin_b6 (mg) and vitamin_b12 (mcg) are
  // indistinguishable without this, and flipping the app's unit setting would otherwise
  // silently mix scales with no way to disambiguate history.
  value: number;
  source?: string;
}

/**
 * Metrics grouped by type name (e.g., "heart_rate" → HeartRateMetric[]).
 */
export type MetricsByType = Record<string, Metric[]>;

/**
 * Heart rate recovery reading after workout ends.
 */
export interface RecoveryReading {
  time: string; // ISO timestamp with timezone
  value: number;
}

// ===== SLEEP TRACKING =====

/**
 * Individual sleep stage entry for frontmatter output.
 * Each entry represents a single sleep stage with ISO timestamps.
 */
export interface SleepStageEntry {
  duration: number; // hours
  endTime: string; // ISO timestamp with timezone (e.g., "2025-12-29T21:53:36-06:00")
  stage: 'asleep' | 'awake' | 'core' | 'deep' | 'rem';
  startTime: string; // ISO timestamp with timezone
  source?: string;
}

/**
 * Nightly sleep totals, in hours.
 *
 * Always derived from the stored `sleepStages` array rather than from a single request, so a
 * partial re-send cannot leave a summary that contradicts the stages sitting beside it.
 *
 * Deliberately has no `inBed` field. Apple never sends an "In Bed" segment, so any bed window
 * we could compute would be exactly `totalSleep + awake` — the same number under a name that
 * claims more than it knows.
 */
export interface SleepSummary {
  awake: number;
  core: number;
  deep: number;
  rem: number;
  segmentCount: number;
  sleepEnd: string; // ISO timestamp with timezone
  sleepStart: string; // ISO timestamp with timezone
  totalSleep: number; // core + deep + rem + asleep; excludes awake
  asleep?: number; // only present when Apple reports an undifferentiated "Asleep" stage
}

// ===== WORKOUT ENTRY =====

export interface WorkoutEntry {
  duration: number; // minutes
  endTime: string; // ISO timestamp with timezone
  startTime: string; // ISO timestamp with timezone
  workoutId: string; // kebab-case derived from name
  workoutType: string; // Display name
  activeEnergy?: number; // total for the workout, unit in activeEnergyUnits
  activeEnergySeries?: WorkoutSeriesReading[]; // per-interval active energy
  activeEnergyUnits?: string;
  // Original workout ID from Apple Health. Optional because 1,546 of the 2,782 workouts already
  // stored — the whole pre-2021 backfill — do not have one. Declaring it required told the
  // compiler a fallback key was dead code while the merge was silently dropping those workouts.
  appleWorkoutId?: string;
  avgHeartRate?: number; // bpm
  basalEnergySeries?: WorkoutSeriesReading[]; // per-interval basal energy
  distance?: number;
  distanceUnits?: string; // e.g. "mi", "km" - never assume
  elevationUp?: number;
  elevationUpUnits?: string; // e.g. "ft", "m"
  flightsClimbed?: number;
  heartRateReadings?: HeartRateReading[]; // Per-minute HR data during workout
  humidity?: number; // percent
  intensity?: number;
  intensityUnits?: string; // e.g. "kcal/hr·kg"
  isIndoor?: boolean;
  location?: string; // e.g., "Indoor", "Outdoor"
  maxHeartRate?: number; // bpm
  minHeartRate?: number; // bpm
  recoveryReadings?: RecoveryReading[]; // Post-workout HR recovery data
  speed?: number;
  speedUnits?: string; // e.g. "mi/hr", "km/hr"
  stepCadence?: number; // steps per minute
  stepCount?: number;
  temperature?: number;
  temperatureUnits?: string; // e.g. "degF", "degC"
  totalEnergy?: number; // active + basal, unit in totalEnergyUnits
  totalEnergyUnits?: string;
  walkingRunningDistanceSeries?: WorkoutSeriesReading[]; // per-interval distance
}

/**
 * A per-interval sample inside a workout (energy burned per minute, distance per minute, ...).
 * Carries its own units so the number is never ambiguous.
 */
export interface WorkoutSeriesReading {
  time: string; // ISO timestamp with timezone
  units: string;
  value: number;
}
