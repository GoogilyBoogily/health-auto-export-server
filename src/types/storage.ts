/**
 * Storage layer type definitions.
 * Types for persisted data structures.
 */

import type { Metric } from './metric';

export interface MetricDailyFile {
  date: string; // YYYY-MM-DD
  metrics: Record<string, Metric[]>;
  version: number;
}

export interface QueryOptions {
  from?: Date;
  to?: Date;
}

export interface SaveResult {
  saved: number;
  success: boolean;
  updated: number;
  errors?: string[];
}

export interface StoredRoute {
  locations: {
    latitude: number;
    longitude: number;
    timestamp: Date;
    altitude?: number;
    course?: number;
    courseAccuracy?: number;
    horizontalAccuracy?: number;
    speed?: number;
    speedAccuracy?: number;
    verticalAccuracy?: number;
  }[];
  workoutId: string;
}

export interface StoredWorkout {
  duration: number;
  end: Date;
  name: string;
  start: Date;
  workoutId: string;
  activeEnergy?: {
    date: Date;
    qty: number;
    source: string;
    units: string;
  }[];
  activeEnergyBurned?: {
    qty: number;
    units: string;
    date?: Date;
    source?: string;
  };
  avgHeartRate?: {
    qty: number;
    units: string;
  };
  distance?: {
    qty: number;
    units: string;
    date?: Date;
    source?: string;
  };
  heartRate?: {
    avg?: { qty: number; units: string };
    max?: { qty: number; units: string };
    min?: { qty: number; units: string };
  };
  heartRateData?: {
    Avg: number;
    date: Date;
    Max: number;
    Min: number;
    source: string;
    units: string;
  }[];
  heartRateRecovery?: {
    Avg: number;
    date: Date;
    Max: number;
    Min: number;
    source: string;
    units: string;
  }[];
  humidity?: {
    qty: number;
    units: string;
    date?: Date;
    source?: string;
  };
  intensity?: {
    qty: number;
    units: string;
    date?: Date;
    source?: string;
  };
  isIndoor?: boolean;
  location?: string;
  maxHeartRate?: {
    qty: number;
    units: string;
  };
  metadata?: Record<string, unknown>;
  stepCadence?: {
    qty: number;
    units: string;
  };
  stepCount?: {
    date: Date;
    qty: number;
    source: string;
    units: string;
  }[];
  temperature?: {
    qty: number;
    units: string;
    date?: Date;
    source?: string;
  };
}

export interface WorkoutDailyFile {
  date: string; // YYYY-MM-DD
  routes: Record<string, StoredRoute>; // keyed by workoutId
  version: number;
  workouts: Record<string, StoredWorkout>; // keyed by workoutId
}
