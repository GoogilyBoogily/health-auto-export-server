/**
 * Obsidian tracking file type definitions.
 * Types for YAML frontmatter in Obsidian markdown files.
 */

// ===== HEALTH TRACKING =====

export interface HealthFrontmatter {
  date: string; // YYYY-MM-DD
  monthKey: string; // YYYY-MM
  type: 'health';
  weekKey: string; // YYYY-WXX
  activeEnergy?: number;
  bloodOxygenSaturation?: number;
  heartRateAvg?: number;
  heartRateMax?: number;
  heartRateMin?: number;
  hrvAvg?: number;
  hrvMax?: number;
  hrvMin?: number;
  hrvSamples?: number;
  respiratoryRate?: number;
  restingEnergy?: number;
  restingHeartRate?: number;
  stepCount?: number;
  vo2Max?: number;
  walkingHeartRate?: number;
  walkingRunningDistance?: number;
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
  asleepDuration?: number; // hours
  awakeHours?: number;
  coreHours?: number;
  deepHours?: number;
  inBedDuration?: number; // hours
  remHours?: number;
  sleepEfficiency?: number; // percentage
  sleepEnd?: string; // ISO timestamp with timezone
  sleepSegments?: number; // count of sleep stage transitions
  sleepStages?: SleepStageEntry[];
  sleepStart?: string; // ISO timestamp with timezone
  wristTemperature?: number; // Apple Watch sleeping wrist temperature (°F)
}

/**
 * Individual sleep stage entry for frontmatter output.
 * Each entry represents a single sleep stage with ISO timestamps.
 */
export interface SleepStageEntry {
  duration: number; // hours
  endTime: string; // ISO timestamp with timezone (e.g., "2025-12-29T21:53:36-06:00")
  stage: 'awake' | 'core' | 'deep' | 'rem';
  startTime: string; // ISO timestamp with timezone
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
  avgHeartRate?: number;
  distance?: number; // km or mi
  heartRateReadings?: HeartRateReading[]; // Per-minute HR data during workout
  heartRateRecovery1Min?: number; // HR drop in 1 minute post-workout
  heartRateRecovery2Min?: number; // HR drop in 2 minutes post-workout
  humidity?: number; // percentage
  intensity?: number; // kcal/hr·kg
  isIndoor?: boolean;
  location?: string; // e.g., "Indoor", "Outdoor"
  maxHeartRate?: number;
  minHeartRate?: number;
  recoveryReadings?: RecoveryReading[]; // Post-workout HR recovery data
  restingEnergy?: number;
  stepCadence?: number; // steps per minute
  stepCount?: number;
  temperature?: number; // degrees
}

export interface WorkoutFrontmatter {
  date: string; // YYYY-MM-DD
  monthKey: string; // YYYY-MM
  type: 'workout';
  weekKey: string; // YYYY-WXX
  workoutCount: number;
  workoutEntries: WorkoutEntry[];
  avgHeartRate?: number;
  maxHeartRate?: number;
  totalActiveEnergy?: number;
  totalDistance?: number;
  totalDuration?: number;
  totalSteps?: number;
  // Dynamic fields: workout_[type]_count
  [key: `workout_${string}_count`]: number;
}
