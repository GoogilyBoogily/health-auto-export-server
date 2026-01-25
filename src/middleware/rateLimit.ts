/**
 * Simple in-memory rate limiting middleware.
 * Uses sliding window algorithm with configurable limits.
 *
 * Note: This is suitable for single-instance deployments.
 * For multi-instance deployments, use Redis-based rate limiting.
 */

import { NextFunction, Request, Response } from 'express';

export interface RateLimitOptions {
  /** Maximum number of requests allowed in the time window */
  maxRequests: number;
  /** Skip rate limiting for specific paths (e.g., health checks) */
  skipPaths?: string[];
  /** Time window in milliseconds */
  windowMs: number;
}

interface RequestRecord {
  count: number;
  resetTime: number;
}

const DEFAULT_OPTIONS: RateLimitOptions = {
  maxRequests: 100, // 100 requests per minute
  skipPaths: ['/health'],
  windowMs: 60_000, // 1 minute
};

/**
 * In-memory request tracking store.
 * Key is IP address, value is request count and reset time.
 */
const requestStore = new Map<string, RequestRecord>();

/**
 * Cleanup expired entries periodically to prevent memory leaks.
 */
let cleanupInterval: ReturnType<typeof setInterval> | undefined;

/**
 * Create a rate limiting middleware with configurable options.
 *
 * @param options - Rate limit configuration
 * @returns Express middleware function
 */
export function createRateLimit(options: Partial<RateLimitOptions> = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };

  // Start cleanup interval
  startCleanup(config.windowMs);

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip rate limiting for excluded paths
    if (config.skipPaths?.includes(req.path)) {
      next();
      return;
    }

    const clientIp = getClientIp(req);
    const now = Date.now();

    let record = requestStore.get(clientIp);

    // Initialize or reset expired window
    if (!record || record.resetTime <= now) {
      record = {
        count: 0,
        resetTime: now + config.windowMs,
      };
      requestStore.set(clientIp, record);
    }

    record.count++;

    // Set rate limit headers
    const remaining = Math.max(0, config.maxRequests - record.count);
    const resetSeconds = Math.ceil((record.resetTime - now) / 1000);

    res.setHeader('X-RateLimit-Limit', String(config.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetSeconds));

    // Check if rate limit exceeded
    if (record.count > config.maxRequests) {
      // Note: req.log may not be set if rate limiter runs before requestLogger
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- req.log may be undefined at runtime
      req.log?.warn('Rate limit exceeded', {
        clientIp,
        limit: config.maxRequests,
        path: req.path,
        requests: record.count,
        resetIn: resetSeconds,
      });

      res.setHeader('Retry-After', String(resetSeconds));
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded. Try again in ${String(resetSeconds)} seconds.`,
        retryAfter: resetSeconds,
      });
    }

    next();
  };
}

/**
 * Get client IP address from request.
 * Handles common proxy headers (X-Forwarded-For, X-Real-IP).
 */
function getClientIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // X-Forwarded-For can be comma-separated list; take first IP
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return ips.split(',')[0].trim();
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

function startCleanup(windowMs: number): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of requestStore) {
      if (record.resetTime <= now) {
        requestStore.delete(key);
      }
    }
  }, windowMs * 2); // Cleanup every 2 windows

  // Don't block process exit
  cleanupInterval.unref();
}

/**
 * Default rate limiting middleware.
 * Allows 100 requests per minute per IP address.
 */
export const rateLimit = createRateLimit();
