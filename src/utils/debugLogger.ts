/**
 * Debug logging utilities for troubleshooting data flow.
 * Enabled via DEBUG_LOGGING=true environment variable.
 *
 * Categories:
 * - REQUEST: Raw incoming request bodies
 * - RESPONSE: Outgoing response bodies
 * - VALIDATION: Zod schema validation details
 * - TRANSFORM: Data mapping/transformation steps
 * - DEDUP: Deduplication operations
 * - STORAGE: File and storage operations
 * - DATA_VALIDATION: Runtime data quality issues (invalid dates, unknown stages, etc.)
 */

import { Logger } from './logger';

import type { LogContext } from './logger';

// Data validation issue types for structured logging
export type DataValidationIssue =
  | 'DATE_BOUNDARY'
  | 'INVALID_DATE'
  | 'TYPE_MISMATCH'
  | 'UNKNOWN_SLEEP_STAGE';

// Debug categories for filtering/identification
export type DebugCategory =
  | 'DATA_VALIDATION'
  | 'DEDUP'
  | 'REQUEST'
  | 'RESPONSE'
  | 'STORAGE'
  | 'TRANSFORM'
  | 'VALIDATION';

// Validation statistics for summary logging
export interface ValidationStats {
  invalidDates: number;
  processedRecords: number;
  skippedRecords: number;
  typeMismatches: number;
  unknownStages: number;
}

/**
 * Log date falling on timezone boundary (UTC vs local date differs).
 */
export function debugDateBoundary(
  logger: Logger,
  rawDate: Date,
  utcDateKey: string,
  localDateKey: string,
  context: string,
): void {
  if (!isDebugEnabled()) return;

  debugLog(logger, 'DATA_VALIDATION', 'Date falls on timezone boundary', {
    action: 'info',
    context,
    issue: 'DATE_BOUNDARY' satisfies DataValidationIssue,
    localKey: localDateKey,
    rawDate: rawDate.toISOString(),
    utcKey: utcDateKey,
  });
}

/**
 * Log deduplication operation.
 */
export function debugDedup(
  logger: Logger,
  operation: string,
  details: {
    duplicateCount: number;
    inputCount: number;
    newCount: number;
    duplicateSamples?: unknown[];
  },
): void {
  if (!isDebugEnabled()) return;

  debugLog(logger, 'DEDUP', operation, details);
}

/**
 * Log invalid date detection (NaN after parsing).
 * Logger is optional to support request-scoped contexts.
 */
export function debugInvalidDate(
  logger: Logger | undefined,
  rawValue: unknown,
  context: string,
): void {
  if (!isDebugEnabled() || !logger) return;

  debugLog(logger, 'DATA_VALIDATION', 'Invalid date detected', {
    action: 'skipped',
    context,
    issue: 'INVALID_DATE' satisfies DataValidationIssue,
    rawData: rawValue,
  });
}

/**
 * Core debug logging function.
 * Only logs if DEBUG_LOGGING is enabled.
 */
export function debugLog(
  logger: Logger,
  category: DebugCategory,
  message: string,
  data?: unknown,
): void {
  if (!isDebugEnabled()) return;

  const context: LogContext = {
    debugCategory: category,
  };

  if (data !== undefined) {
    context.data = data;
  }

  logger.debug(`[DEBUG:${category}] ${message}`, context);
}

/**
 * Log metric-specific details for troubleshooting data mapping issues.
 * Logger is optional to support request-scoped contexts.
 */
export function debugMetricMapping(
  logger: Logger | undefined,
  metricName: string,
  inputData: unknown[],
  outputData: unknown[],
): void {
  if (!isDebugEnabled() || !logger) return;

  debugLog(logger, 'TRANSFORM', `Mapping metric: ${metricName}`, {
    inputCount: inputData.length,
    inputSample: inputData[0],
    outputCount: outputData.length,
    outputSample: outputData[0],
  });
}

/**
 * Log raw request body.
 */
export function debugRequest(logger: Logger, body: unknown, metadata?: LogContext): void {
  if (!isDebugEnabled()) return;

  const bodySize = JSON.stringify(body ?? {}).length;
  debugLog(logger, 'REQUEST', `Raw request body (${String(bodySize)} bytes)`, {
    body,
    ...metadata,
  });
}

/**
 * Log response body.
 */
export function debugResponse(
  logger: Logger,
  statusCode: number,
  body: unknown,
  metadata?: LogContext,
): void {
  if (!isDebugEnabled()) return;

  debugLog(logger, 'RESPONSE', `Response (${String(statusCode)})`, {
    body,
    statusCode,
    ...metadata,
  });
}

/**
 * Log sleep segment aggregation details.
 * Logger is optional to support request-scoped contexts.
 */
export function debugSleepAggregation(
  logger: Logger | undefined,
  segments: unknown[],
  sessions: unknown[],
  aggregated: unknown[],
): void {
  if (!isDebugEnabled() || !logger) return;

  debugLog(logger, 'TRANSFORM', 'Sleep segment aggregation', {
    aggregatedOutput: aggregated,
    inputSegments: segments.length,
    sessionsDetected: sessions.length,
  });
}

/**
 * Log storage operation.
 */
export function debugStorage(
  logger: Logger,
  operation: string,
  details: {
    data?: unknown;
    filePath?: string;
    fileType?: string;
    metadata?: LogContext;
  },
): void {
  if (!isDebugEnabled()) return;

  debugLog(logger, 'STORAGE', operation, details);
}

/**
 * Log data transformation.
 */
export function debugTransform(
  logger: Logger,
  operation: string,
  input: unknown,
  output: unknown,
  metadata?: LogContext,
): void {
  if (!isDebugEnabled()) return;

  debugLog(logger, 'TRANSFORM', operation, {
    input,
    output,
    ...metadata,
  });
}

/**
 * Log type mismatch - missing required fields on metrics.
 * Logger is optional to support request-scoped contexts.
 */
export function debugTypeMismatch(
  logger: Logger | undefined,
  metricType: string,
  expectedFields: string[],
  actualData: unknown,
): void {
  if (!isDebugEnabled() || !logger) return;

  debugLog(logger, 'DATA_VALIDATION', 'Type mismatch - missing required fields', {
    action: 'skipped',
    actual: actualData,
    expected: expectedFields,
    issue: 'TYPE_MISMATCH' satisfies DataValidationIssue,
    metricType,
  });
}

/**
 * Log unknown sleep stage value.
 * Logger is optional to support request-scoped contexts.
 * Valid values are passed as parameter to avoid hard-coding domain knowledge.
 */
export function debugUnknownSleepStage(
  logger: Logger | undefined,
  value: unknown,
  validValues: readonly string[],
  segmentData?: unknown,
): void {
  if (!isDebugEnabled() || !logger) return;

  debugLog(logger, 'DATA_VALIDATION', 'Unknown sleep stage', {
    action: 'skipped',
    issue: 'UNKNOWN_SLEEP_STAGE' satisfies DataValidationIssue,
    segment: segmentData,
    validValues,
    value,
  });
}

/**
 * Log validation results.
 */
export function debugValidation(
  logger: Logger,
  success: boolean,
  input?: unknown,
  errors?: unknown,
): void {
  if (!isDebugEnabled()) return;

  if (success) {
    debugLog(logger, 'VALIDATION', 'Validation passed', { input });
  } else {
    debugLog(logger, 'VALIDATION', 'Validation failed', { errors, input });
  }
}

/**
 * Log validation summary after processing a batch.
 */
export function debugValidationSummary(logger: Logger, stats: ValidationStats): void {
  if (!isDebugEnabled()) return;

  const hasIssues =
    stats.invalidDates > 0 ||
    stats.typeMismatches > 0 ||
    stats.unknownStages > 0 ||
    stats.skippedRecords > 0;

  if (!hasIssues) return;

  debugLog(logger, 'DATA_VALIDATION', 'Validation summary', {
    invalidDates: stats.invalidDates,
    processed: stats.processedRecords,
    skipped: stats.skippedRecords,
    typeMismatches: stats.typeMismatches,
    unknownStages: stats.unknownStages,
  });
}

/**
 * Check if debug logging is enabled.
 */
export function isDebugEnabled(): boolean {
  return process.env.DEBUG_LOGGING === 'true';
}
