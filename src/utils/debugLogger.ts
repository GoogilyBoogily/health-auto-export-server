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
 */

import { Logger } from './logger';

import type { LogContext } from './logger';

// Debug categories for filtering/identification
export type DebugCategory =
  | 'DEDUP'
  | 'REQUEST'
  | 'RESPONSE'
  | 'STORAGE'
  | 'TRANSFORM'
  | 'VALIDATION';

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
 */
export function debugMetricMapping(
  logger: Logger,
  metricName: string,
  inputData: unknown[],
  outputData: unknown[],
): void {
  if (!isDebugEnabled()) return;

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
 */
export function debugSleepAggregation(
  logger: Logger,
  segments: unknown[],
  sessions: unknown[],
  aggregated: unknown[],
): void {
  if (!isDebugEnabled()) return;

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
 * Check if debug logging is enabled.
 */
export function isDebugEnabled(): boolean {
  return process.env.DEBUG_LOGGING === 'true';
}
