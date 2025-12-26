import { Metric } from '../models/Metric';

export interface MetricDailyFile {
  version: number;
  date: string; // YYYY-MM-DD
  metrics: Record<string, Metric[]>;
}

export interface WorkoutDailyFile {
  version: number;
  date: string; // YYYY-MM-DD
  workouts: Record<string, StoredWorkout>; // keyed by workoutId
  routes: Record<string, StoredRoute>; // keyed by workoutId
}

export interface StoredWorkout {
  workoutId: string;
  name: string;
  start: Date;
  end: Date;
  duration: number;
  activeEnergyBurned?: {
    qty: number;
    units: string;
    date: Date;
    source: string;
  };
  distance?: {
    qty: number;
    units: string;
    date: Date;
    source: string;
  };
  activeEnergy?: {
    qty: number;
    date: Date;
    units: string;
    source: string;
  };
  heartRateData?: Array<{
    Min: number;
    Avg: number;
    Max: number;
    date: Date;
    units: string;
    source: string;
  }>;
  heartRateRecovery?: Array<{
    Min: number;
    Avg: number;
    Max: number;
    date: Date;
    units: string;
    source: string;
  }>;
  stepCount?: Array<{
    qty: number;
    date: Date;
    units: string;
    source: string;
  }>;
  temperature?: {
    qty: number;
    units: string;
    date: Date;
    source: string;
  };
  humidity?: {
    qty: number;
    units: string;
    date: Date;
    source: string;
  };
  intensity?: {
    qty: number;
    units: string;
    date: Date;
    source: string;
  };
}

export interface StoredRoute {
  workoutId: string;
  locations: Array<{
    latitude: number;
    longitude: number;
    timestamp: Date;
    course?: number;
    courseAccuracy?: number;
    speed?: number;
    speedAccuracy?: number;
    altitude?: number;
    verticalAccuracy?: number;
    horizontalAccuracy?: number;
  }>;
}

export interface QueryOptions {
  from?: Date;
  to?: Date;
}

export interface SaveResult {
  success: boolean;
  saved: number;
  updated: number;
  errors?: string[];
}
