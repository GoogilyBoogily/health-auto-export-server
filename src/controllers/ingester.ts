import { Request, Response } from 'express';

import { saveMetrics } from './metrics';
import { saveWorkouts } from './workouts';
import { IngestData } from '../models/IngestData';
import { IngestResponse } from '../models/IngestResponse';
import { IngestDataSchema } from '../validation/schemas';

export const ingestData = async (req: Request, res: Response) => {
  const { log } = req;
  const timer = log.startTimer('ingestData');
  let response: IngestResponse = {};

  try {
    // Validate request body with Zod
    const parseResult = IngestDataSchema.safeParse(req.body);
    if (!parseResult.success) {
      log.warn('Invalid request body', { errors: parseResult.error.issues });
      res.status(400).json({
        error: 'Invalid request format',
        details: parseResult.error.issues,
      });
      return;
    }

    const data = parseResult.data as IngestData;

    log.info('Processing ingestion request', {
      hasMetrics: !!data.data?.metrics?.length,
      metricsCount: data.data?.metrics?.length || 0,
      hasWorkouts: !!data.data?.workouts?.length,
      workoutsCount: data.data?.workouts?.length || 0,
    });

    // Use Promise.allSettled for fault tolerance - one failure doesn't stop the other
    const results = await Promise.allSettled([saveMetrics(data, log), saveWorkouts(data, log)]);

    const [metricsResult, workoutsResult] = results;
    if (metricsResult.status === 'fulfilled') {
      response = { ...response, ...metricsResult.value };
    } else {
      log.error('Metrics save failed', metricsResult.reason);
      response.metrics = {
        success: false,
        error: metricsResult.reason?.message || 'Unknown error',
      };
    }
    if (workoutsResult.status === 'fulfilled') {
      response = { ...response, ...workoutsResult.value };
    } else {
      log.error('Workouts save failed', workoutsResult.reason);
      response.workouts = {
        success: false,
        error: workoutsResult.reason?.message || 'Unknown error',
      };
    }

    const hasErrors = Object.values(response).some((r) => !r.success);
    const allFailed = Object.values(response).every((r) => !r.success);

    if (allFailed) {
      timer.end('error', 'Ingestion completely failed', { response });
      res.status(500).json(response);
      return;
    }

    timer.end(hasErrors ? 'warn' : 'info', 'Ingestion completed', {
      hasPartialErrors: hasErrors,
      metricsResult: response.metrics,
      workoutsResult: response.workouts,
    });

    res.status(hasErrors ? 207 : 200).json(response);
  } catch (error) {
    timer.end('error', 'Failed to process ingestion request', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'Failed to process request',
      message: error instanceof Error ? error.message : 'An error occurred',
    });
  }
};
