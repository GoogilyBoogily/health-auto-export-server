/**
 * Request timeout middleware.
 * Prevents requests from hanging indefinitely by setting a maximum processing time.
 */

import { NextFunction, Request, Response } from 'express';

// Default timeout: 2 minutes (large payloads can take time to process)
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Create a request timeout middleware with configurable timeout.
 *
 * @param timeoutMs - Maximum time allowed for request processing (default: 2 minutes)
 * @returns Express middleware function
 */
export function createRequestTimeout(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Set socket timeout
    req.socket.setTimeout(timeoutMs);

    // Set response timeout using a timer
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        // Note: req.log may not be set if timeout middleware runs before requestLogger
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- req.log may be undefined at runtime
        req.log?.warn('Request timeout exceeded', {
          method: req.method,
          path: req.path,
          timeoutMs,
        });
        res.status(408).json({
          error: 'Request timeout',
          message: `Request processing exceeded ${String(timeoutMs / 1000)} seconds`,
        });
      }
    }, timeoutMs);

    // Clear the timer when response finishes
    res.on('finish', () => {
      clearTimeout(timer);
    });

    res.on('close', () => {
      clearTimeout(timer);
    });

    next();
  };
}

/**
 * Default request timeout middleware (2 minutes).
 */
export const requestTimeout = createRequestTimeout();
