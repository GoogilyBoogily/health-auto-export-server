/**
 * Console-based logging utility with environment-aware formatting.
 * - Development (NODE_ENV !== 'production'): Pretty, colored output
 * - Production: JSON structured output
 *
 * Debug logging is enabled via DEBUG_LOGGING=true environment variable.
 *
 * Debug Categories:
 * - AUTH: Authentication attempts and results
 * - REQUEST: Raw incoming request bodies
 * - RESPONSE: Outgoing response bodies
 * - RETRY: Retry operation tracking
 * - VALIDATION: Zod schema validation details
 * - TRANSFORM: Data mapping/transformation steps
 * - DEDUP: Deduplication operations
 * - STORAGE: File and storage operations
 * - DATA_VALIDATION: Runtime data quality issues (invalid dates, unknown stages, etc.)
 */

// Module-level flag for debug logging - checked once at startup, not on every call
// This avoids the performance overhead of checking process.env on every debug() call
const isDebugEnabled = process.env.DEBUG_LOGGING === 'true';

// ANSI color codes for terminal output
const colors = {
  blue: '\u001B[34m',
  cyan: '\u001B[36m',
  dim: '\u001B[2m',
  gray: '\u001B[90m',
  red: '\u001B[31m',
  reset: '\u001B[0m',
  yellow: '\u001B[33m',
} as const;

// Data validation issue types for structured logging
export type DataValidationIssue =
  | 'DATE_BOUNDARY'
  | 'INVALID_DATE'
  | 'TYPE_MISMATCH'
  | 'UNKNOWN_SLEEP_STAGE';

// Debug categories for filtering/identification
export type DebugCategory =
  | 'AUTH'
  | 'DATA_VALIDATION'
  | 'DEDUP'
  | 'REQUEST'
  | 'RESPONSE'
  | 'RETRY'
  | 'STORAGE'
  | 'TRANSFORM'
  | 'VALIDATION';

export type LogContext = Record<string, unknown>;

export type LogLevel = 'debug' | 'error' | 'info' | 'warn';

export interface TimerResult {
  end: (level: LogLevel, message: string, context?: LogContext) => void;
}

// Validation statistics for summary logging
export interface ValidationStats {
  invalidDates: number;
  processedRecords: number;
  skippedRecords: number;
  typeMismatches: number;
  unknownStages: number;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  correlationId?: string;
  durationMs?: number;
  error?: {
    message: string;
    name: string;
    stack?: string;
  };
}

// Log level priority for filtering
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  error: 3,
  info: 1,
  warn: 2,
};

export class Logger {
  private correlationId?: string;
  private isProduction: boolean;
  private minLevel: LogLevel;

  constructor(correlationId?: string) {
    this.correlationId = correlationId;
    this.isProduction = process.env.NODE_ENV === 'production';
    this.minLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'debug';
  }

  /**
   * Create a child logger with a bound correlation ID.
   */
  child(correlationId: string): Logger {
    return new Logger(correlationId);
  }

  debug(message: string, context?: LogContext): void {
    // Only log debug messages when DEBUG_LOGGING=true (checked at module load)
    if (!isDebugEnabled) return;
    this.log('debug', message, context);
  }

  /**
   * Log authentication operation.
   */
  debugAuth(
    operation: string,
    details: {
      maskedToken?: string;
      path?: string;
      reason?: string;
      success?: boolean;
    },
  ): void {
    this.debugLog('AUTH', operation, details);
  }

  /**
   * Log date falling on timezone boundary (UTC vs local date differs).
   */
  debugDateBoundary(
    rawDate: Date,
    utcDateKey: string,
    localDateKey: string,
    context: string,
  ): void {
    this.debugLog('DATA_VALIDATION', 'Date falls on timezone boundary', {
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
  debugDedup(
    operation: string,
    details: {
      duplicateCount: number;
      inputCount: number;
      newCount: number;
      duplicateSamples?: unknown[];
    },
  ): void {
    this.debugLog('DEDUP', operation, details);
  }

  /**
   * Log invalid date detection (NaN after parsing).
   */
  debugInvalidDate(rawValue: unknown, context: string): void {
    this.debugLog('DATA_VALIDATION', 'Invalid date detected', {
      action: 'skipped',
      context,
      issue: 'INVALID_DATE' satisfies DataValidationIssue,
      rawData: rawValue,
    });
  }

  /**
   * Core debug logging with category prefix.
   */
  debugLog(category: DebugCategory, message: string, data?: unknown): void {
    const context: LogContext = {
      debugCategory: category,
    };

    if (data !== undefined) {
      context.data = data;
    }

    this.debug(`[DEBUG:${category}] ${message}`, context);
  }

  /**
   * Log metric-specific details for troubleshooting data mapping issues.
   */
  debugMetricMapping(metricName: string, inputData: unknown[], outputData: unknown[]): void {
    this.debugLog('TRANSFORM', `Mapping metric: ${metricName}`, {
      inputCount: inputData.length,
      inputSample: inputData[0],
      outputCount: outputData.length,
      outputSample: outputData[0],
    });
  }

  /**
   * Log raw request body.
   */
  debugRequest(body: unknown, metadata?: LogContext): void {
    const bodySize = JSON.stringify(body ?? {}).length;
    this.debugLog('REQUEST', `Raw request body (${String(bodySize)} bytes)`, {
      body,
      ...metadata,
    });
  }

  /**
   * Log response body.
   */
  debugResponse(statusCode: number, body: unknown, metadata?: LogContext): void {
    this.debugLog('RESPONSE', `Response (${String(statusCode)})`, {
      body,
      statusCode,
      ...metadata,
    });
  }

  /**
   * Log retry operation.
   */
  debugRetry(
    operation: string,
    details: {
      attempt?: number;
      delay?: number;
      error?: string;
      maxRetries?: number;
      operationName?: string;
      success?: boolean;
    },
  ): void {
    this.debugLog('RETRY', operation, details);
  }

  /**
   * Log sleep segment aggregation details.
   */
  debugSleepAggregation(segments: unknown[], sessions: unknown[], aggregated: unknown[]): void {
    this.debugLog('TRANSFORM', 'Sleep segment aggregation', {
      aggregatedOutput: aggregated,
      inputSegments: segments.length,
      sessionsDetected: sessions.length,
    });
  }

  /**
   * Log storage operation.
   */
  debugStorage(
    operation: string,
    details: {
      data?: unknown;
      filePath?: string;
      fileType?: string;
      metadata?: LogContext;
    },
  ): void {
    this.debugLog('STORAGE', operation, details);
  }

  /**
   * Log data transformation.
   */
  debugTransform(operation: string, input: unknown, output: unknown, metadata?: LogContext): void {
    this.debugLog('TRANSFORM', operation, {
      input,
      output,
      ...metadata,
    });
  }

  /**
   * Log type mismatch - missing required fields on metrics.
   */
  debugTypeMismatch(metricType: string, expectedFields: string[], actualData: unknown): void {
    this.debugLog('DATA_VALIDATION', 'Type mismatch - missing required fields', {
      action: 'skipped',
      actual: actualData,
      expected: expectedFields,
      issue: 'TYPE_MISMATCH' satisfies DataValidationIssue,
      metricType,
    });
  }

  /**
   * Log unknown sleep stage value.
   * Valid values are passed as parameter to avoid hard-coding domain knowledge.
   */
  debugUnknownSleepStage(
    value: unknown,
    validValues: readonly string[],
    segmentData?: unknown,
  ): void {
    this.debugLog('DATA_VALIDATION', 'Unknown sleep stage', {
      action: 'skipped',
      issue: 'UNKNOWN_SLEEP_STAGE' satisfies DataValidationIssue,
      segment: segmentData,
      validValues,
      value,
    });
  }

  /**
   * Log failed validation.
   */
  debugValidationFailed(input: unknown, errors: unknown): void {
    this.debugLog('VALIDATION', 'Validation failed', { errors, input });
  }

  /**
   * Log successful validation.
   */
  debugValidationPassed(input?: unknown): void {
    this.debugLog('VALIDATION', 'Validation passed', { input });
  }

  /**
   * Log validation summary after processing a batch.
   */
  debugValidationSummary(stats: ValidationStats): void {
    const hasIssues =
      stats.invalidDates > 0 ||
      stats.typeMismatches > 0 ||
      stats.unknownStages > 0 ||
      stats.skippedRecords > 0;

    if (!hasIssues) return;

    this.debugLog('DATA_VALIDATION', 'Validation summary', {
      invalidDates: stats.invalidDates,
      processed: stats.processedRecords,
      skipped: stats.skippedRecords,
      typeMismatches: stats.typeMismatches,
      unknownStages: stats.unknownStages,
    });
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    this.log('error', message, context, error);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * Start a timer for measuring operation duration.
   * Returns an object with an `end` method to log the completion.
   */
  startTimer(operation: string): TimerResult {
    const startTime = Date.now();
    this.debug(`Starting: ${operation}`);

    return {
      end: (level: LogLevel, message: string, context?: LogContext) => {
        const durationMs = Date.now() - startTime;
        this.log(level, message, context, undefined, durationMs);
      },
    };
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  private formatError(error: unknown): LogEntry['error'] | undefined {
    if (!error) return undefined;
    if (error instanceof Error) {
      return {
        message: error.message,
        name: error.name,
        stack: error.stack,
      };
    }
    // Handle non-Error objects safely
    const message =
      typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : JSON.stringify(error);
    return {
      message,
      name: 'UnknownError',
    };
  }

  private formatJson(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  private formatPretty(entry: LogEntry): string {
    const levelColors: Record<LogLevel, string> = {
      debug: colors.gray,
      error: colors.red,
      info: colors.cyan,
      warn: colors.yellow,
    };

    const color = levelColors[entry.level];
    const timestamp = `${colors.dim}${entry.timestamp}${colors.reset}`;
    const level = `${color}${entry.level.toUpperCase().padEnd(5)}${colors.reset}`;
    const correlationId = entry.correlationId
      ? `${colors.dim}[${entry.correlationId}]${colors.reset} `
      : '';
    const duration =
      entry.durationMs === undefined
        ? ''
        : ` ${colors.dim}(${String(entry.durationMs)}ms)${colors.reset}`;

    let output = `${timestamp} ${level} ${correlationId}${entry.message}${duration}`;

    if (entry.context && Object.keys(entry.context).length > 0) {
      output += `\n  ${colors.dim}${JSON.stringify(entry.context)}${colors.reset}`;
    }

    if (entry.error) {
      output += `\n  ${colors.red}${entry.error.name}: ${entry.error.message}${colors.reset}`;
      if (entry.error.stack) {
        output += `\n${colors.dim}${entry.error.stack}${colors.reset}`;
      }
    }

    return output;
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: unknown,
    durationMs?: number,
  ): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      context,
      correlationId: this.correlationId,
      durationMs,
      error: this.formatError(error),
      level,
      message,
      timestamp: this.formatTimestamp(),
    };

    const output = this.isProduction ? this.formatJson(entry) : this.formatPretty(entry);

    switch (level) {
      case 'error': {
        console.error(output);
        break;
      }
      case 'warn': {
        console.warn(output);
        break;
      }
      default: {
        console.log(output);
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }
}

// Export singleton instance for general use (non-request contexts)
export const logger = new Logger();
