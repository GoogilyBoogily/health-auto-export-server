/**
 * Ingest API type definitions.
 * Types for the data ingestion request and response.
 */

import type { MetricData } from './metric';
import type { WorkoutData } from './workout';

export interface IngestData {
  data: {
    metrics?: MetricData[];
    workouts?: WorkoutData[];
  };
}

export interface IngestResponse {
  metrics?: {
    success: boolean;
    error?: string;
    message?: string;
  };
  workouts?: {
    success: boolean;
    error?: string;
    message?: string;
  };
}
