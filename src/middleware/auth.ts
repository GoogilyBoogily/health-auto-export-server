import { timingSafeEqual } from 'node:crypto';

import { NextFunction, Request, Response } from 'express';

import { AuthConfig } from '../config';

/**
 * Determine the reason for auth failure (for logging purposes only).
 */
function getAuthFailureReason(token: string | undefined): string {
  if (!token) return 'missing_token';
  if (!token.startsWith(AuthConfig.tokenPrefix)) return 'invalid_format';
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
 * Defense-in-depth: validates API_TOKEN is configured even though
 * app.ts validates at startup - prevents security issues if middleware
 * is used before environment validation.
 */
export const requireWriteAuth = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers[AuthConfig.headerName] as string;
  const apiToken = process.env[AuthConfig.tokenEnvVar];

  // Log auth attempt with masked token (show first 7 chars: "sk-XXX...")
  const maskedToken = token ? `${token.slice(0, 7)}...` : undefined;
  req.log.debugAuth('Auth attempt received', {
    maskedToken,
    path: req.path,
  });

  // Fail-safe: ensure API_TOKEN is configured (defense-in-depth)
  if (!apiToken || apiToken.length === 0) {
    req.log.debugAuth('Server config error', {
      reason: `${AuthConfig.tokenEnvVar} not configured`,
      success: false,
    });
    req.log.error(`${AuthConfig.tokenEnvVar} not configured - rejecting request`);
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (!token || !token.startsWith(AuthConfig.tokenPrefix) || !isValidToken(token, apiToken)) {
    const reason = getAuthFailureReason(token);
    req.log.debugAuth('Validation failure', {
      path: req.path,
      reason,
      success: false,
    });
    req.log.warn('Write authentication failed', {
      path: req.path,
      reason,
    });
    return res.status(401).json({ error: 'Unauthorized: Invalid write token' });
  }

  req.log.debugAuth('Authentication successful', {
    path: req.path,
    success: true,
  });
  req.log.debug('Write authentication successful');
  next();
};
