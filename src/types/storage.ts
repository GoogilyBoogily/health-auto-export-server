/**
 * Storage layer type definitions.
 */

export interface SaveResult {
  saved: number;
  success: boolean;
  updated: number;
  errors?: string[];
}
