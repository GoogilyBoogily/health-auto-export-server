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

export interface IRoute {
  locations: ILocation[];
  workoutId: string;
}

export interface WorkoutData {
  activeEnergy?: IQuantityMetric;
  activeEnergyBurned?: IMeasurement;
  // --- Optional fields ---
  duration: number;
  end: Date;
  id: string;
  name: string;
  start: Date;
  distance?: IMeasurement;
  heartRateData?: IHeartRate[];
  heartRateRecovery?: IHeartRate[];
  humidity?: IMeasurement;
  intensity?: IMeasurement;
  route?: ILocation[];
  stepCount?: IQuantityMetric[];
  temperature?: IMeasurement;
}

interface IHeartRate extends IMeasurement {
  Avg: number;
  date: Date;
  Max: number;
  Min: number;
  source: string;
  units: string;
}

interface IMeasurement {
  date: Date;
  qty: number;
  source: string;
  units: string;
}

interface IQuantityMetric {
  date: Date;
  qty: number;
  source: string;
  units: string;
}

export function mapRoute(data: WorkoutData): IRoute {
  return {
    locations:
      data.route?.map((loc) => ({
        ...loc,
        timestamp: new Date(loc.timestamp),
      })) ?? [],
    workoutId: data.id,
  };
}

export function mapWorkoutData(data: WorkoutData) {
  // Exclude route from workout data - it's stored separately
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- route is intentionally excluded
  const { id, route, ...rest } = data;

  return {
    workoutId: id,
    ...rest,
    end: new Date(rest.end),
    start: new Date(rest.start),
  };
}
