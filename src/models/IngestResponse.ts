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
