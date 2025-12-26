/**
 * Console-based logging utility with environment-aware formatting.
 * - Development (NODE_ENV !== 'production'): Pretty, colored output
 * - Production: JSON structured output
 */

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

export type LogContext = Record<string, unknown>;

export type LogLevel = 'debug' | 'error' | 'info' | 'warn';

export interface TimerResult {
  end: (level: LogLevel, message: string, context?: LogContext) => void;
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
    this.log('debug', message, context);
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
