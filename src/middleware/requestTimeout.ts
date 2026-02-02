/**
 * Request timeout middleware.
 * Prevents requests from hanging indefinitely by setting a maximum processing time.
 */

import { NextFunction, Request, Response } from 'express';

import { RequestConfig } from '../config';

/**
 * Create a request timeout middleware with configurable timeout.
 *
 * @param timeoutMs - Maximum time allowed for request processing (default: from config)
 * @returns Express middleware function
 */
export function createRequestTimeout(timeoutMs: number = RequestConfig.timeoutMs) {
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
 * Default request timeout middleware (configured timeout).
 */
export const requestTimeout = createRequestTimeout();
