export interface IngestResponse {
  metrics?: {
    success: boolean;
    message?: string;
    error?: string;
  };
  workouts?: {
    success: boolean;
    message?: string;
    error?: string;
  };
}
