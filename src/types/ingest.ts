/**
 * Ingest API type definitions.
 * Types for the data ingestion request and response.
 */

/**
 * The request body as it arrives, after only envelope validation.
 * Elements stay `unknown` until the controllers validate them one at a time, so a single
 * malformed entry is skipped and counted instead of rejecting the whole payload.
 */
export interface IngestData {
  data: {
    metrics?: unknown[];
    workouts?: unknown[];
  };
}

export interface IngestResponse {
  metrics?: {
    success: boolean;
    error?: string;
    message?: string;
    skippedRecords?: number; // Records dropped during validation (invalid date / missing fields / bad sleep stage)
  };
  workouts?: {
    success: boolean;
    error?: string;
    message?: string;
    skippedRecords?: number; // Workouts dropped because they failed schema validation
  };
}
