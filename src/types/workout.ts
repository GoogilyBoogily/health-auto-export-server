/**
 * Workout type definitions.
 * Types for workout data structures from Apple Health.
 */

export interface IHeartRate extends IMeasurement {
  Avg: number;
  Max: number;
  Min: number;
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

export interface WorkoutData {
  duration: number;
  end: Date;
  id: string;
  name: string;
  start: Date;
  activeEnergy?: IQuantityMetric;
  activeEnergyBurned?: IMeasurement;
  distance?: IMeasurement;
  heartRateData?: IHeartRate[];
  heartRateRecovery?: IHeartRate[];
  humidity?: IMeasurement;
  intensity?: IMeasurement;
  route?: ILocation[];
  stepCount?: IQuantityMetric[];
  temperature?: IMeasurement;
}
