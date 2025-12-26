/**
 * Console-based logging utility with environment-aware formatting.
 * - Development (NODE_ENV !== 'production'): Pretty, colored output
 * - Production: JSON structured output
 */

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  durationMs?: number;
}

export interface TimerResult {
  end: (level: LogLevel, message: string, context?: LogContext) => void;
}

// Log level priority for filtering
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private correlationId?: string;
  private isProduction: boolean;
  private minLevel: LogLevel;

  constructor(correlationId?: string) {
    this.correlationId = correlationId;
    this.isProduction = process.env.NODE_ENV === 'production';
    this.minLevel = (process.env.LOG_LEVEL as LogLevel) || 'debug';
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private formatError(error: Error | unknown): LogEntry['error'] | undefined {
    if (!error) return undefined;
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    return {
      name: 'UnknownError',
      message: String(error),
    };
  }

  private formatPretty(entry: LogEntry): string {
    const levelColors: Record<LogLevel, string> = {
      debug: colors.gray,
      info: colors.cyan,
      warn: colors.yellow,
      error: colors.red,
    };

    const color = levelColors[entry.level];
    const timestamp = `${colors.dim}${entry.timestamp}${colors.reset}`;
    const level = `${color}${entry.level.toUpperCase().padEnd(5)}${colors.reset}`;
    const correlationId = entry.correlationId
      ? `${colors.dim}[${entry.correlationId}]${colors.reset} `
      : '';
    const duration =
      entry.durationMs !== undefined ? ` ${colors.dim}(${entry.durationMs}ms)${colors.reset}` : '';

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

  private formatJson(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  private log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error | unknown,
    durationMs?: number,
  ): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level,
      message,
      correlationId: this.correlationId,
      context,
      error: this.formatError(error),
      durationMs,
    };

    const output = this.isProduction ? this.formatJson(entry) : this.formatPretty(entry);

    switch (level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    this.log('error', message, context, error);
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

  /**
   * Create a child logger with a bound correlation ID.
   */
  child(correlationId: string): Logger {
    return new Logger(correlationId);
  }
}

// Export singleton instance for general use (non-request contexts)
export const logger = new Logger();
