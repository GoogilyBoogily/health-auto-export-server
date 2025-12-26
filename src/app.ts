import { Server } from 'node:http';

import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';

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
const port = parseInt(process.env.PORT || '3001', 10);
let server: Server;

const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'api-key'],
};

// Rate limiter: 100 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

app.use(cors(corsOptions));

// Reduced body limit from 200mb to 50mb to mitigate DoS risk
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Add request logging middleware (before auth and routes)
app.use(requestLogger);

// Apply rate limiting and write auth middleware to data ingestion routes
app.use('/api/data', apiLimiter, requireWriteAuth, ingesterRouter);

// Health check endpoint
app.get('/health', (_req: express.Request, res: express.Response) => {
  res.status(200).send('OK');
});

// Graceful shutdown handler
const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds (unref to not block process exit)
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
};

// Initialize storage and start server
(async () => {
  try {
    // Validate environment before starting
    validateEnv();

    await storage.init();
    server = app.listen(port, '0.0.0.0', () => {
      logger.info('Server started', {
        port,
        host: '0.0.0.0',
        nodeEnv: process.env.NODE_ENV || 'development',
        dataDir: process.env.DATA_DIR || './data',
      });
    });

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to initialize server', error);
    process.exit(1);
  }
})();
