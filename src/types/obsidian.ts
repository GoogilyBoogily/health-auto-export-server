/**
 * Obsidian tracking file type definitions.
 * Types for YAML frontmatter in Obsidian markdown files.
 */

// ===== HEALTH TRACKING =====

export interface BloodPressureReading {
  diastolic: number;
  systolic: number;
  time: string; // ISO timestamp with timezone
  source?: string;
}

export interface HealthFrontmatter {
  date: string; // YYYY-MM-DD
  type: 'health';
  [metricName: string]: (BloodPressureReading | HeartRateHealthReading | MetricReading)[] | string;
}

/**
 * Heart rate reading for health tracking (distinct from workout HeartRateReading).
 */
export interface HeartRateHealthReading {
  avg: number;
  max: number;
  min: number;
  time: string; // ISO timestamp with timezone
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

export interface MarkdownFile {
  body: string;
  frontmatter: ObsidianFrontmatter;
}

export interface MetricReading {
  time: string; // ISO timestamp with timezone
  value: number;
  source?: string;
}

export type ObsidianFrontmatter = HealthFrontmatter | SleepFrontmatter | WorkoutFrontmatter;

/**
 * Heart rate recovery reading after workout ends.
 */
export interface RecoveryReading {
  time: string; // ISO timestamp with timezone
  value: number;
}

// ===== SLEEP TRACKING =====

export interface SleepFrontmatter {
  date: string; // YYYY-MM-DD
  sleepStages?: SleepStageEntry[];
}

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

// ===== COMMON TYPES =====

export type TrackingType = 'health' | 'sleep' | 'workout';

export interface WorkoutEntry {
  appleWorkoutId: string; // Original workout ID from Apple Health
  duration: number; // minutes
  endTime: string; // ISO timestamp with timezone
  startTime: string; // ISO timestamp with timezone
  workoutId: string; // kebab-case derived from name
  workoutType: string; // Display name
  activeEnergy?: number; // kcal
  avgHeartRate?: number; // bpm
  distance?: number; // km or mi
  heartRateReadings?: HeartRateReading[]; // Per-minute HR data during workout
  intensity?: number; // kcal/hr·kg
  isIndoor?: boolean;
  location?: string; // e.g., "Indoor", "Outdoor"
  maxHeartRate?: number; // bpm
  minHeartRate?: number; // bpm
  recoveryReadings?: RecoveryReading[]; // Post-workout HR recovery data
  stepCadence?: number; // steps per minute
  stepCount?: number;
}

export interface WorkoutFrontmatter {
  date: string; // YYYY-MM-DD
  type: 'workout';
  workoutEntries: WorkoutEntry[];
}
