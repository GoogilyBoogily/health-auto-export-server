import { NextFunction, Request, Response } from 'express';

import { LogContext, Logger } from '../utils/logger';

// Extend Express Request interface to include logging properties
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId: string;
      log: Logger;
      startTime: number;
    }
  }
}

/**
 * Request logging middleware.
 * Generates correlation ID, attaches logger to request, logs request/response.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Generate correlation ID and attach to request
  req.correlationId = generateCorrelationId();
  req.startTime = Date.now();
  req.log = new Logger(req.correlationId);

  // Log incoming request
  req.log.info('Incoming request', {
    headers: getSafeHeaders(req),
    ip: req.ip ?? req.socket.remoteAddress,
    method: req.method,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
  });

  // Capture original end method (bound to response)
  const originalEnd = res.end.bind(res);

  // Override end to log response
  res.end = function (
    this: Response,
    chunk?: unknown,
    encoding?: BufferEncoding | (() => void),
    callback?: () => void,
  ): Response {
    const durationMs = Date.now() - req.startTime;
    const statusCode = res.statusCode;

    // Determine log level based on status code
    let logLevel: 'error' | 'info' | 'warn' = 'info';
    if (statusCode >= 500) {
      logLevel = 'error';
    } else if (statusCode >= 400) {
      logLevel = 'warn';
    }

    req.log[logLevel]('Request completed', {
      contentLength: res.get('content-length'),
      durationMs,
      method: req.method,
      path: req.path,
      statusCode,
    });

    // Call original end method
    return originalEnd.call(this, chunk, encoding as BufferEncoding, callback);
  };

  next();
}

/**
 * Generate a unique correlation ID for request tracing.
 */
function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  // eslint-disable-next-line sonarjs/pseudo-random -- Not security-critical, just for request tracing
  const random = Math.random().toString(36).slice(2, 8);
  return `req-${timestamp}-${random}`;
}

/**
 * Extract safe headers for logging (masks sensitive values).
 */
function getSafeHeaders(req: Request): LogContext {
  const headers: LogContext = {};

  if (req.headers['content-type']) {
    headers.contentType = req.headers['content-type'];
  }
  if (req.headers['content-length']) {
    headers.contentLength = req.headers['content-length'];
  }
  if (req.headers['user-agent']) {
    headers.userAgent = req.headers['user-agent'];
  }
  // Log presence of api-key but never the value
  if (req.headers['api-key']) {
    headers.hasApiKey = true;
    headers.apiKeyPrefix = maskSensitiveValue(req.headers['api-key'] as string);
  }

  return headers;
}

/**
 * Mask sensitive header values for safe logging.
 */
function maskSensitiveValue(value: string): string {
  if (!value) return '';
  if (value.startsWith('sk-') && value.length > 6) {
    return `sk-****${value.slice(-4)}`;
  }
  return '****';
}
