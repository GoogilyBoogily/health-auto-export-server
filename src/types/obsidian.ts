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

export interface NapSession {
  duration: number; // hours
  endTime: string; // HH:MM
  startTime: string; // HH:MM
}

// ===== WORKOUT TRACKING =====

export type ObsidianFrontmatter = HealthFrontmatter | SleepFrontmatter | WorkoutFrontmatter;

export interface SleepFrontmatter {
  date: string; // YYYY-MM-DD
  monthKey: string; // YYYY-MM
  type: 'sleep';
  weekKey: string; // YYYY-WXX
  asleepDuration?: number; // hours
  awakeHours?: number;
  coreHours?: number;
  deepHours?: number;
  inBedDuration?: number; // hours
  napCount?: number;
  napDuration?: number; // hours
  napSessions?: NapSession[];
  remHours?: number;
  sleepEfficiency?: number; // percentage
  sleepEnd?: string; // HH:MM
  sleepSegments?: number; // count of sleep stage transitions
  sleepStart?: string; // HH:MM
  source?: string;
  wristTemp?: number; // wrist temperature in degrees
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
  maxHeartRate?: number;
  minHeartRate?: number;
  restingEnergy?: number;
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
