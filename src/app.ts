import { Server } from 'node:http';

import cors from 'cors';
import express from 'express';

import { requireWriteAuth } from './middleware/auth';
import { requestLogger } from './middleware/requestLogger';
import ingesterRouter from './routes/ingester';
import { storage } from './storage';
import { logger } from './utils/logger';

/**
 * Validate required environment variables at startup.
 * Fails fast if critical configuration is missing.
 */
function validateEnv(): void {
  const writeToken = process.env.WRITE_TOKEN;
  if (!writeToken) {
    throw new Error('WRITE_TOKEN environment variable is required');
  }
  if (!writeToken.startsWith('sk-')) {
    throw new Error('WRITE_TOKEN must start with "sk-"');
  }
}

const app = express();
app.disable('x-powered-by'); // Prevent version disclosure
const port = Number.parseInt(process.env.PORT ?? '3001', 10);
let server: Server;

const corsOptions = {
  allowedHeaders: ['Content-Type', 'Authorization', 'api-key'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  origin: '*',
};

// eslint-disable-next-line sonarjs/cors -- CORS is intentionally enabled for API access
app.use(cors(corsOptions));

// Reduced body limit from 200mb to 50mb to mitigate DoS risk
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
    logger.info('Server closed');
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit -- Intentional server shutdown
    process.exit(0);
  });

  // Force exit after 10 seconds (unref to not block process exit)
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit -- Intentional forced shutdown
    process.exit(1);
  }, 10_000).unref();
};

// Initialize storage and start server
try {
  // Validate environment before starting
  validateEnv();

  await storage.init();
  server = app.listen(port, '0.0.0.0', () => {
    logger.info('Server started', {
      dataDir: process.env.DATA_DIR ?? './data',
      host: '0.0.0.0',
      nodeEnv: process.env.NODE_ENV ?? 'development',
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
