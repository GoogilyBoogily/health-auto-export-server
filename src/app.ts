import { Server } from 'node:http';

import cors from 'cors';
import express from 'express';

import { AuthConfig, CorsConfig, ServerConfig } from './config';
import { requireWriteAuth } from './middleware/auth';
import { rateLimit } from './middleware/rateLimit';
import { requestLogger } from './middleware/requestLogger';
import { requestTimeout } from './middleware/requestTimeout';
import ingesterRouter from './routes/ingester';
import { initObsidianStorage } from './storage';
import { logger } from './utils/logger';

/**
 * Validate required environment variables at startup.
 * Fails fast if critical configuration is missing.
 */
function validateEnv(): { obsidianVaultPath: string } {
  const apiToken = process.env[AuthConfig.tokenEnvVar];
  if (!apiToken) {
    throw new Error(`${AuthConfig.tokenEnvVar} environment variable is required`);
  }
  if (!apiToken.startsWith(AuthConfig.tokenPrefix)) {
    throw new Error(`${AuthConfig.tokenEnvVar} must start with "${AuthConfig.tokenPrefix}"`);
  }

  const obsidianVaultPath = process.env.OBSIDIAN_VAULT_PATH;
  if (!obsidianVaultPath) {
    throw new Error('OBSIDIAN_VAULT_PATH environment variable is required');
  }

  return { obsidianVaultPath };
}

const app = express();
app.disable('x-powered-by'); // Prevent version disclosure
const port = ServerConfig.port;
let server: Server;

// Configure CORS origins from environment variable (comma-separated list)
// If not set, defaults to '*' (allow all) for development convenience
// In production, set CORS_ORIGINS to restrict allowed origins
function getCorsOrigins(): string[] {
  const corsOriginsEnv = process.env[CorsConfig.originsEnvVar];
  const isProduction = process.env.NODE_ENV === 'production';

  if (!corsOriginsEnv || corsOriginsEnv === '*') {
    // Warn in production if CORS is allowing all origins
    if (isProduction) {
      logger.warn(
        'CORS_ORIGINS not set in production - allowing all origins. ' +
          'Set CORS_ORIGINS environment variable to restrict allowed origins.',
      );
    }
    // Default: allow all origins (development mode)
    return ['*'];
  }

  // Parse comma-separated origins
  return corsOriginsEnv.split(',').map((origin) => origin.trim());
}

const corsOptions = {
  allowedHeaders: CorsConfig.allowedHeaders,
  methods: CorsConfig.allowedMethods,
  origin: getCorsOrigins(),
};

app.use(cors(corsOptions));

// Body size limit (mitigate DoS risk)
app.use(express.json({ limit: ServerConfig.bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: ServerConfig.bodyLimit }));

// Add rate limiting (100 requests per minute per IP, excludes /health)
app.use(rateLimit);

// Add request timeout middleware (2 minute default)
app.use(requestTimeout);

// Add request logging middleware (before auth and routes)
app.use(requestLogger);

// Apply write auth middleware to data ingestion routes
app.use('/api/data', requireWriteAuth, ingesterRouter);

// Health check endpoint
app.get('/health', (_req: express.Request, res: express.Response) => {
  res.status(200).send('OK');
});

// Graceful shutdown handler
const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  server.close(() => {
    logger.info('Shutdown complete');
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit -- Intentional server shutdown
    process.exit(0);
  });

  // Force exit after timeout (unref to not block process exit)
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit -- Intentional forced shutdown
    process.exit(1);
  }, ServerConfig.shutdownTimeoutMs).unref();
};

// Initialize storage and start server
try {
  // Validate environment before starting
  const { obsidianVaultPath } = validateEnv();

  // Initialize Obsidian storage
  const obsidianStorage = initObsidianStorage(obsidianVaultPath);
  await obsidianStorage.init();

  server = app.listen(port, ServerConfig.host, () => {
    logger.info('Server started', {
      host: ServerConfig.host,
      nodeEnv: process.env.NODE_ENV ?? 'development',
      obsidianVault: obsidianVaultPath,
      port,
    });
  });

  process.on('SIGTERM', () => {
    gracefulShutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    gracefulShutdown('SIGINT');
  });
} catch (error) {
  logger.error('Failed to initialize server', error);
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit -- Fatal startup error
  process.exit(1);
}
