/**
 * Workout type definitions.
 * Types for workout data structures from Apple Health.
 */

export interface IHeartRate extends IMeasurement {
  Avg: number;
  Max: number;
  Min: number;
}

/**
 * Heart rate summary with nested max/avg/min structure.
 * Used for pre-computed heart rate statistics.
 */
export interface IHeartRateSummary {
  avg?: ISimpleMeasurement;
  max?: ISimpleMeasurement;
  min?: ISimpleMeasurement;
}

export interface ILocation {
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
}

export interface IMeasurement {
  date: Date;
  qty: number;
  source: string;
  units: string;
}

export interface IQuantityMetric {
  date: Date;
  qty: number;
  source: string;
  units: string;
}

export interface IRoute {
  locations: ILocation[];
  workoutId: string;
}

/**
 * Simple measurement with only qty and units (no date/source).
 * Used for pre-computed scalar values like maxHeartRate, avgHeartRate, stepCadence.
 */
export interface ISimpleMeasurement {
  qty: number;
  units: string;
}

export interface WorkoutData {
  duration: number;
  end: Date;
  id: string;
  name: string;
  sourceDate: string; // YYYY-MM-DD extracted from raw start date string before timezone conversion
  start: Date;
  activeEnergy?: IQuantityMetric[];
  activeEnergyBurned?: IMeasurement | ISimpleMeasurement;
  avgHeartRate?: ISimpleMeasurement;
  distance?: IMeasurement | ISimpleMeasurement;
  heartRate?: IHeartRateSummary;
  heartRateData?: IHeartRate[];
  heartRateRecovery?: IHeartRate[];
  humidity?: IMeasurement | ISimpleMeasurement;
  intensity?: IMeasurement | ISimpleMeasurement;
  isIndoor?: boolean;
  location?: string;
  maxHeartRate?: ISimpleMeasurement;
  metadata?: Record<string, unknown>;
  route?: ILocation[];
  stepCadence?: ISimpleMeasurement;
  stepCount?: IQuantityMetric[];
  temperature?: IMeasurement | ISimpleMeasurement;
}
