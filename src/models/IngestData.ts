import { MetricData } from './Metric';
import { WorkoutData } from './Workout';

export interface IngestData {
  data: {
    metrics?: MetricData[];
    workouts?: WorkoutData[];
  };
}
