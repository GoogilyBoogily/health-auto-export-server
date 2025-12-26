interface IQuantityMetric {
  qty: number;
  date: Date;
  units: string;
  source: string;
}

interface IMeasurement {
  qty: number;
  units: string;
  date: Date;
  source: string;
}

interface IHeartRate extends IMeasurement {
  Min: number;
  Avg: number;
  Max: number;
  date: Date;
  units: string;
  source: string;
}

export interface ILocation {
  latitude: number;
  longitude: number;
  course?: number;
  courseAccuracy?: number;
  speed?: number;
  speedAccuracy?: number;
  altitude?: number;
  verticalAccuracy?: number;
  horizontalAccuracy?: number;
  timestamp: Date;
}

export interface IRoute {
  workoutId: string;
  locations: ILocation[];
}

export interface WorkoutData {
  id: string;
  name: string;
  start: Date;
  end: Date;
  duration: number;
  // --- Optional fields ---
  distance?: IMeasurement;
  activeEnergyBurned?: IMeasurement;
  activeEnergy?: IQuantityMetric;
  heartRateData?: IHeartRate[];
  heartRateRecovery?: IHeartRate[];
  stepCount?: IQuantityMetric[];
  temperature?: IMeasurement;
  humidity?: IMeasurement;
  intensity?: IMeasurement;
  route?: ILocation[];
}

export function mapWorkoutData(data: WorkoutData) {
  const { id, route, ...rest } = data;
  void route; // Intentionally unused - route is stored separately

  return {
    workoutId: id,
    ...rest,
    start: new Date(rest.start),
    end: new Date(rest.end),
  };
}

export function mapRoute(data: WorkoutData): IRoute {
  return {
    workoutId: data.id,
    locations:
      data.route?.map((loc) => ({
        ...loc,
        timestamp: new Date(loc.timestamp),
      })) || [],
  };
}
