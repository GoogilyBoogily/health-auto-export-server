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

// ===== SLEEP TRACKING =====

export interface MarkdownFile {
  body: string;
  frontmatter: ObsidianFrontmatter;
}

export type ObsidianFrontmatter = HealthFrontmatter | SleepFrontmatter | WorkoutFrontmatter;

// ===== WORKOUT TRACKING =====

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
  duration: number; // minutes
  endTime: string; // HH:MM
  sourceId: string; // Original workout ID from Health Auto Export
  startTime: string; // HH:MM
  workoutId: string; // kebab-case derived from name
  workoutType: string; // Display name
  activeEnergy?: number; // kcal
  avgHeartRate?: number;
  distance?: number; // km or mi
  isIndoor?: boolean;
  location?: string; // e.g., "Indoor", "Outdoor"
  maxHeartRate?: number;
  minHeartRate?: number;
  restingEnergy?: number;
  stepCadence?: number; // steps per minute
  stepCount?: number;
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
