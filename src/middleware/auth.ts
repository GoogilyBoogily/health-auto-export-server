import { timingSafeEqual } from 'node:crypto';

import { NextFunction, Request, Response } from 'express';

/**
 * Determine the reason for auth failure (for logging purposes only).
 */
function getAuthFailureReason(token: string | undefined): string {
  if (!token) return 'missing_token';
  if (!token.startsWith('sk-')) return 'invalid_format';
  return 'token_mismatch';
}

/**
 * Timing-safe token comparison to prevent timing attacks.
 */
function isValidToken(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) {
    return false;
  }
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Authentication middleware for write access.
 * Defense-in-depth: validates WRITE_TOKEN is configured even though
 * app.ts validates at startup - prevents security issues if middleware
 * is used before environment validation.
 */
export const requireWriteAuth = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers['api-key'] as string;
  const writeToken = process.env.WRITE_TOKEN;

  // Fail-safe: ensure WRITE_TOKEN is configured (defense-in-depth)
  if (!writeToken || writeToken.length === 0) {
    req.log.error('WRITE_TOKEN not configured - rejecting request');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (!token || !token.startsWith('sk-') || !isValidToken(token, writeToken)) {
    req.log.warn('Write authentication failed', {
      path: req.path,
      reason: getAuthFailureReason(token),
    });
    return res.status(401).json({ error: 'Unauthorized: Invalid write token' });
  }

  req.log.debug('Write authentication successful');
  next();
};
